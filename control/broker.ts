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
  async approve(id: string, approvedHash: string, actor: string): Promise<Proposal> {
    const current = await this.proxy.snapshot();
    const proposal = this.store.proposal(id);
    if (!proposal || proposal.status !== 'proposed' || actor !== 'local-operator' || approvedHash !== proposal.hash || hash(proposal.content) !== proposal.hash) throw new Error('Missing, altered, unauthorized, or already consumed approval');
    if (Date.now() > proposal.approvalDeadline || current.epoch !== proposal.content.expectedEpoch || current.revision !== proposal.content.expectedRevision) {
      proposal.status = 'stale'; this.store.putProposal(proposal); this.store.audit('approval.rejected', { id, reason: 'expired or changed state' }); throw new Error('Proposal expired or proxy state changed; investigate and propose again');
    }
    this.store.transaction(() => {
      proposal.status = 'executing'; proposal.approvedBy = actor; this.store.putProposal(proposal);
      this.store.audit('human.approved', { id, proposalHash: approvedHash, actor, content: proposal.content });
      this.store.audit('action.requested', { id, expectedEpoch: current.epoch, expectedRevision: current.revision });
    });
    const input = { actionId: id, proposalHash: proposal.hash, source: proposal.content.source, ttlSeconds: proposal.content.ttlSeconds, expectedEpoch: proposal.content.expectedEpoch, expectedRevision: proposal.content.expectedRevision };
    try {
      proposal.execution = await this.proxy.deny(input); proposal.status = 'applied';
      this.store.transaction(() => { this.store.putProposal(proposal); this.store.audit('action.applied', { id, result: proposal.execution }); });
    } catch {
      // A lost response does not establish whether the proxy applied the action.
      proposal.status = 'uncertain'; this.store.putProposal(proposal); this.store.audit('action.uncertain', { id, note: 'Reconcile against the proxy action ledger before any retry.' });
    }
    return proposal;
  }
  reject(id: string, expectedHash: string): Proposal {
    const proposal = this.store.proposal(id);
    if (!proposal || proposal.status !== 'proposed' || proposal.hash !== expectedHash) throw new Error('Proposal changed or is no longer pending');
    proposal.status = 'rejected';
    this.store.transaction(() => { this.store.putProposal(proposal); this.store.audit('human.rejected', { id, proposalHash: expectedHash, actor: 'local-operator' }); });
    return proposal;
  }
  // broker methods
}
