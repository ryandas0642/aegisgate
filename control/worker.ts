import { setTimeout } from 'node:timers/promises';
import { investigate } from './agent.js';
import { Provider, inferenceConfig } from './provider.js';
import { boundedJson } from './http.js';
import type { Evidence, Incident } from './types.js';

const origin = process.env.AEGIS_CONTROL_ORIGIN || 'http://127.0.0.1:4174';
const token = process.env.AEGIS_AGENT_TOKEN;
if (!token || token.length < 32)
  throw new Error('Investigator requires its scoped control-plane token');
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
async function api(path: string, value?: unknown): Promise<any> {
  const response = await fetch(origin + path, {
    method: value ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: value ? JSON.stringify(value) : undefined,
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  const data = await boundedJson(response);
  if (!response.ok) throw new Error('Investigator operation rejected by the control plane');
  return data;
}
while (!stopping) {
  try {
    const job = (await api('/internal/next')) as {
      jobId: string;
      incident: Incident;
      detection: Evidence;
    } | null;
    if (!job) {
      await setTimeout(750);
      continue;
    }
    const provider = new Provider(inferenceConfig(process.env, ''));
    const record = async (type: string, value: unknown) => {
      await api('/internal/record', { jobId: job.jobId, type, value });
    };
    try {
      const result = await investigate(job.incident, job.detection, {
        decide: (context, evidence, emit) => provider.decide(context, evidence, emit),
        record,
        tool: (request) => api('/internal/tool', { jobId: job.jobId, request }),
        propose: (proposal, mode) => api('/internal/propose', { jobId: job.jobId, proposal, mode }),
      });
      await api('/internal/finish', { jobId: job.jobId, result });
    } catch (error) {
      await api('/internal/finish', { jobId: job.jobId, error: (error as Error).message });
    }
  } catch {
    if (!stopping) await setTimeout(1000);
  }
}
