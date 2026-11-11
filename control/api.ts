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
  // api setup
}
