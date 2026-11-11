import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { hash } from './security.js';
import { Store } from './store.js';
import type { Decision, Proposal, Snapshot } from './types.js';

export interface Enforcement {
  snapshot(): Promise<Snapshot>;
  deny(input: unknown): Promise<Record<string, unknown>>;
}
export class Broker {
  constructor(readonly store: Store, readonly proxy: Enforcement) {}
  async propose(incidentId: string, input: NonNullable<Decision['proposal']>, mode: string): Promise<Proposal> {
    const incident = this.store.incident(incidentId);
    if (!incident || incident.kind !== 'security' || input.source !== incident.source || isIP(input.source) !== 4) throw new Error('Proposal target must be the security incident source');
    if (Object.keys(input).sort().join(',') !== 'evidenceIds,expectedImpact,rationale,source,ttlSeconds' || !Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 60 || input.ttlSeconds > 600) throw new Error('Proposal parameters exceed the action catalog');
    if (![input.rationale, input.expectedImpact].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1200)) throw new Error('A bounded rationale and impact are required');
    if (!Array.isArray(input.evidenceIds) || input.evidenceIds.length > 12 || !input.evidenceIds.includes(incident.eventId) || input.evidenceIds.some(id => this.store.evidence(id)?.source !== incident.source)) throw new Error('Proposal requires actual evidence for this source');
    if (this.store.proposals().some(p => p.content.incidentId === incidentId && ['proposed', 'executing', 'applied', 'verified', 'uncertain'].includes(p.status))) throw new Error('This incident already has an active proposal');
    const snapshot = await this.proxy.snapshot();
    const content = { ...structuredClone(input), incidentId, expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision };
    const proposal: Proposal = { id: randomUUID(), content, hash: hash(content), status: 'proposed', createdAt: new Date().toISOString(), approvalDeadline: Date.now() + 120000, mode };
    this.store.transaction(() => { this.store.putProposal(proposal); incident.status = 'awaiting_approval'; this.store.putIncident(incident); this.store.audit('action.proposed', proposal); });
    return proposal;
  }
  // broker methods
}
