import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Auth } from './auth.js';
import { equalSecret } from './security.js';
import { Store } from './store.js';
import { Broker, type Enforcement } from './broker.js';
import { redact } from './redact.js';
import { investigateTool } from './tools.js';
import { validateDecision } from './decision.js';
import type { Incident, Snapshot } from './types.js';

type Options = { store: Store; proxy: Enforcement; password: string; agentToken: string; model: string; providerConfigured: boolean; staticRoot?: string; devOrigin?: string };
type Job = { id: string; incidentId: string; reviewId?: string; evidenceIds: string[]; expires: number; status: string };

async function body(request: IncomingMessage, maximum = 16384): Promise<Record<string, any>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected application/json');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > maximum) throw new Error('Request body too large'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value;
}

export function createApi(options: Options) {
  const { store, proxy } = options, auth = new Auth(options.password), broker = new Broker(store, proxy);
  const staticRoot = resolve(options.staticRoot ?? 'dist');
  let polling = false;
  const samples: { at: number; requests: number; denied: number; limited: number; errors: number }[] = [];
  let sampleEpoch = '';
  const json = (response: ServerResponse, status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(redact(value))); };
  const jobFor = (id: string): Job => {
    const job = store.get<Job>('job:' + id);
    if (!job || job.status !== 'running' || Date.now() > job.expires) throw new Error('Investigation job is unavailable or expired');
    return job;
  };
  const poll = async () => {
    if (polling) return; polling = true;
    try {
      const snapshot = await proxy.snapshot(); store.ingest(snapshot); broker.reconcile(snapshot);
      if (sampleEpoch !== snapshot.epoch) { samples.length = 0; sampleEpoch = snapshot.epoch; }
      samples.push({ at: Date.now(), requests: snapshot.metrics.requests, denied: snapshot.metrics.denied, limited: snapshot.metrics.limited, errors: snapshot.metrics.errors });
      if (samples.length > 120) samples.shift();
    } catch {
      if (store.get<{ online: boolean }>('connection')?.online) store.audit('telemetry.disconnected', { reason: 'Proxy control connection unavailable' });
      store.set('connection', { online: false, receivedAt: store.get<{ receivedAt: number }>('connection')?.receivedAt ?? 0, error: 'Proxy telemetry unavailable' });
    } finally { polling = false; }
  };
  const claim = () => {
    const connection = store.get<{ online: boolean; receivedAt: number }>('connection');
    if (!connection?.online || Date.now() - connection.receivedAt > 3000) return null;
    const review = store.proposals().find(p => store.get<{ status: string }>('review:' + p.id)?.status === 'pending');
    const incident = review ? store.incident(review.content.incidentId) : store.incidents().reverse().find(item => item.status === 'detected');
    if (!incident) return null;
    const detection = store.evidence(incident.eventId); if (!detection) return null;
    const job: Job = { id: randomUUID(), incidentId: incident.id, ...(review ? { reviewId: review.id } : {}), evidenceIds: [detection.id], expires: Date.now() + 125000, status: 'running' };
    store.transaction(() => {
      if (review) store.set('review:' + review.id, { status: 'running', incidentId: incident.id });
      else { incident.status = 'investigating'; store.putIncident(incident); }
      store.set('job:' + job.id, job); store.audit('investigation.started', { jobId: job.id, incidentId: incident.id, phase: review ? 'verification' : 'investigation', mode: 'live' });
    });
    return { jobId: job.id, incident: review ? { ...incident, verification: review.verification, phase: 'verification', instruction: 'Review these deterministic verification results. Inspect current evidence if useful. Do not propose another action.' } : incident, detection };
  };
  const internal = async (request: IncomingMessage, response: ServerResponse, path: string) => {
    if (!equalSecret(request.headers.authorization, 'Bearer ' + options.agentToken)) return json(response, 403, { error: 'Investigator grant required' });
    if (request.method === 'GET' && path === '/internal/next') return json(response, 200, claim());
    if (request.method !== 'POST') return json(response, 404, { error: 'Unknown investigator route' });
    const input = await body(request, 512 * 1024), job = jobFor(input.jobId), incident = store.incident(job.incidentId)!;
    if (path === '/internal/tool') {
      const result = investigateTool(store, incident, input.request);
      const collect = (value: unknown): void => { if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') { const o = value as Record<string, unknown>; if (typeof o.id === 'string' && !job.evidenceIds.includes(o.id)) job.evidenceIds.push(o.id); Object.values(o).forEach(collect); } };
      collect(result); store.set('job:' + job.id, job); return json(response, 200, result);
    }
    if (path === '/internal/record') {
      if (!['model.requested', 'model.completed', 'model.rejected', 'agent.decision', 'tool.requested', 'tool.completed'].includes(input.type)) throw new Error('Audit event is outside the investigator grant');
      store.audit('investigation.' + input.type, { jobId: job.id, incidentId: incident.id, phase: job.reviewId ? 'verification' : 'investigation', data: input.value }); return json(response, 200, { recorded: true });
    }
    if (path === '/internal/propose') {
      if (job.reviewId || input.mode !== 'live') throw new Error('This job cannot propose an action');
      return json(response, 200, await broker.propose(incident.id, input.proposal, 'live'));
    }
    if (path === '/internal/finish') {
      if (input.result) {
        if (input.result.mode !== 'live') throw new Error('Production investigator requires an actual provider result');
        validateDecision({ plan: ['Complete review'], requests: [], finding: input.result.finding, proposal: null }, new Set(job.evidenceIds));
        if (job.reviewId) {
          const proposal = store.proposal(job.reviewId)!;
          proposal.verification = { ...proposal.verification, modelReview: input.result }; store.putProposal(proposal); store.set('review:' + job.reviewId, { status: 'completed' });
        } else { incident.finding = input.result.finding; incident.mode = 'live'; incident.status = store.proposals().some(p => p.content.incidentId === incident.id && p.status === 'proposed') ? 'awaiting_approval' : 'investigated'; store.putIncident(incident); }
        store.audit('investigation.completed', { jobId: job.id, incidentId: incident.id, phase: job.reviewId ? 'verification' : 'investigation', result: input.result });
      } else {
        if (job.reviewId) store.set('review:' + job.reviewId, { status: 'unavailable' });
        else { incident.status = 'unavailable'; store.putIncident(incident); }
        store.audit('investigation.unavailable', { jobId: job.id, incidentId: incident.id, error: String(input.error || 'Investigation failed').slice(0, 500), mode: 'live' });
      }
      job.status = 'completed'; store.set('job:' + job.id, job); return json(response, 200, { completed: true });
    }
    return json(response, 404, { error: 'Unknown investigator route' });
  };
  // api setup
}
