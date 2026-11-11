import { Store } from '../control/store.js';
import type { Decision, Evidence, Snapshot } from '../control/types.js';
export const finding = {
  summary: 'Observed repeated rate-limit violations.',
  observations: [{ text: 'The proxy recorded violations.', evidenceIds: ['event-1'] }],
  alternatives: ['A legitimate load test could explain this.'],
  uncertainty: 'Client intent is unknown.',
  recommendation: 'Review a temporary source deny.',
};
export const detection: Evidence = {
  id: 'event-1',
  sequence: 1,
  epoch: 'test-epoch',
  time: new Date().toISOString(),
  type: 'detection.security',
  source: '127.0.0.2',
  reason: 'rate_limit_burst',
  violations: 10,
};
export function snapshot(): Snapshot {
  return {
    epoch: 'test-epoch',
    revision: 0,
    sequence: 1,
    oldestSequence: 1,
    observedAt: new Date().toISOString(),
    metrics: { requests: 20, forwarded: 10, denied: 0, limited: 10, errors: 0, connections: 0 },
    limits: { ratePerSecond: 10, burst: 20, maxConnections: 64 },
    backends: [{ id: 'a', healthy: true, requests: 10, failures: 0, successes: 2 }],
    rules: [],
    actions: [],
    events: [structuredClone(detection)],
  };
}
export const action = (): NonNullable<Decision['proposal']> => ({
  source: '127.0.0.2',
  ttlSeconds: 60,
  evidenceIds: ['event-1'],
  rationale: 'Repeated violations from this exact source.',
  expectedImpact: 'Deny only this synthetic client for one minute.',
});
export function seed() {
  const store = new Store();
  store.ingest(snapshot());
  return { store, incident: store.incidents()[0] };
}
export class FakeProxy {
  state = snapshot();
  calls = 0;
  failAfterApply = false;
  async snapshot() {
    return structuredClone(this.state);
  }
  async deny(input: any): Promise<Record<string, unknown>> {
    if (input.expectedEpoch !== this.state.epoch || input.expectedRevision !== this.state.revision)
      throw new Error('stale');
    this.calls++;
    this.state.revision++;
    const result = {
      actionId: input.actionId,
      source: input.source,
      expiresAtMs: Date.now() + input.ttlSeconds * 1000,
      epoch: this.state.epoch,
      revision: this.state.revision,
      status: 'applied' as const,
    };
    this.state.actions.push(result);
    this.state.rules.push({
      source: input.source,
      actionId: input.actionId,
      expiresAtMs: result.expiresAtMs,
    });
    this.state.events.push({
      id: 'applied-2',
      sequence: 2,
      epoch: this.state.epoch,
      time: new Date().toISOString(),
      type: 'rule.applied',
      actionId: input.actionId,
    });
    this.state.sequence = 2;
    if (this.failAfterApply) throw new Error('lost response');
    return result;
  }
}
