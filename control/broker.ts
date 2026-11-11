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
  constructor(
    readonly store: Store,
    readonly proxy: Enforcement,
  ) {}
  async propose(
    incidentId: string,
    input: NonNullable<Decision['proposal']>,
    mode: string,
  ): Promise<Proposal> {
    const incident = this.store.incident(incidentId);
    if (
      !incident ||
      incident.kind !== 'security' ||
      input.source !== incident.source ||
      isIP(input.source) !== 4
    )
      throw new Error('Proposal target must be the security incident source');
    if (
      Object.keys(input).sort().join(',') !==
        'evidenceIds,expectedImpact,rationale,source,ttlSeconds' ||
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < 60 ||
      input.ttlSeconds > 600
    )
      throw new Error('Proposal parameters exceed the action catalog');
    if (
      ![input.rationale, input.expectedImpact].every(
        (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 1200,
      )
    )
      throw new Error('A bounded rationale and impact are required');
    if (
      !Array.isArray(input.evidenceIds) ||
      input.evidenceIds.length > 12 ||
      !input.evidenceIds.includes(incident.eventId) ||
      input.evidenceIds.some((id) => this.store.evidence(id)?.source !== incident.source)
    )
      throw new Error('Proposal requires actual evidence for this source');
    if (
      this.store
        .proposals()
        .some(
          (p) =>
            p.content.incidentId === incidentId &&
            ['proposed', 'executing', 'applied', 'verified', 'uncertain'].includes(p.status),
        )
    )
      throw new Error('This incident already has an active proposal');
    const snapshot = await this.proxy.snapshot();
    const content = {
      ...structuredClone(input),
      incidentId,
      expectedEpoch: snapshot.epoch,
      expectedRevision: snapshot.revision,
    };
    const proposal: Proposal = {
      id: randomUUID(),
      content,
      hash: hash(content),
      status: 'proposed',
      createdAt: new Date().toISOString(),
      approvalDeadline: Date.now() + 120000,
      mode,
    };
    this.store.transaction(() => {
      if (this.store.proposals().some(p => p.content.incidentId === incidentId && ['proposed', 'executing', 'applied', 'verified', 'uncertain', 'inconclusive'].includes(p.status))) throw new Error('This incident already has an active proposal');
      this.store.putProposal(proposal);
      incident.status = 'awaiting_approval';
      this.store.putIncident(incident);
      this.store.audit('action.proposed', proposal);
    });
    return proposal;
  }
  async approve(id: string, approvedHash: string, actor: string): Promise<Proposal> {
    const current = await this.proxy.snapshot();
    const proposal = this.store.proposal(id);
    if (
      !proposal ||
      proposal.status !== 'proposed' ||
      actor !== 'local-operator' ||
      approvedHash !== proposal.hash ||
      hash(proposal.content) !== proposal.hash
    )
      throw new Error('Missing, altered, unauthorized, or already consumed approval');
    if (
      Date.now() > proposal.approvalDeadline ||
      current.epoch !== proposal.content.expectedEpoch ||
      current.revision !== proposal.content.expectedRevision
    ) {
      proposal.status = 'stale';
      this.store.putProposal(proposal);
      this.store.audit('approval.rejected', { id, reason: 'expired or changed state' });
      throw new Error('Proposal expired or proxy state changed; investigate and propose again');
    }
    this.store.transaction(() => {
      proposal.status = 'executing';
      proposal.approvedBy = actor;
      this.store.putProposal(proposal);
      this.store.audit('human.approved', {
        id,
        proposalHash: approvedHash,
        actor,
        content: proposal.content,
      });
      this.store.audit('action.requested', {
        id,
        expectedEpoch: current.epoch,
        expectedRevision: current.revision,
      });
    });
    const input = {
      actionId: id,
      proposalHash: proposal.hash,
      source: proposal.content.source,
      ttlSeconds: proposal.content.ttlSeconds,
      expectedEpoch: proposal.content.expectedEpoch,
      expectedRevision: proposal.content.expectedRevision,
    };
    try {
      proposal.execution = await this.proxy.deny(input);
      proposal.status = 'applied';
      this.store.transaction(() => {
        this.store.putProposal(proposal);
        this.store.audit('action.applied', { id, result: proposal.execution });
      });
    } catch (error) {
      // A lost response does not establish whether the proxy applied the action.
      const refused = !!error && typeof error === 'object' && 'definitive' in error;
      proposal.status = refused ? 'failed' : 'uncertain';
      this.store.putProposal(proposal);
      this.store.audit(refused ? 'action.refused' : 'action.uncertain', {
        id,
        note: refused ? 'The enforcement endpoint rejected this action.' : 'Reconcile against the proxy action ledger before any retry.',
      });
    }
    return proposal;
  }
  reject(id: string, expectedHash: string): Proposal {
    const proposal = this.store.proposal(id);
    if (!proposal || proposal.status !== 'proposed' || proposal.hash !== expectedHash)
      throw new Error('Proposal changed or is no longer pending');
    proposal.status = 'rejected';
    this.store.transaction(() => {
      this.store.putProposal(proposal);
      const incident = this.store.incident(proposal.content.incidentId);
      if (incident) { incident.status = incident.finding ? 'investigated' : 'unavailable'; this.store.putIncident(incident); }
      this.store.audit('human.rejected', {
        id,
        proposalHash: expectedHash,
        actor: 'local-operator',
      });
    });
    return proposal;
  }
  reconcile(snapshot: Snapshot): void {
    for (const proposal of this.store.proposals()) {
      if (proposal.status === 'proposed' && (Date.now() > proposal.approvalDeadline || snapshot.epoch !== proposal.content.expectedEpoch || snapshot.revision !== proposal.content.expectedRevision)) {
        proposal.status = 'stale'; this.store.putProposal(proposal);
        const incident = this.store.incident(proposal.content.incidentId);
        if (incident) { incident.status = incident.finding ? 'investigated' : 'unavailable'; this.store.putIncident(incident); }
        this.store.audit('proposal.invalidated', { id: proposal.id, reason: 'Approval window expired or configuration changed' });
        continue;
      }
      if (
        !['executing', 'uncertain', 'applied', 'verified', 'inconclusive'].includes(proposal.status)
      )
        continue;
      const previous = proposal.status;
      if (snapshot.epoch !== proposal.content.expectedEpoch) {
        proposal.status = 'interrupted';
        proposal.verification = {
          outcome: 'interrupted',
          reason:
            'Proxy restarted; previous temporary controls are gone. A new approval is required.',
        };
      } else {
        const action = snapshot.actions.find((item) => item.actionId === proposal.id);
        if (!action) continue;
        proposal.execution = action;
        const event = this.store
          .events(500)
          .find((e) => e.type === 'rule.applied' && e.actionId === proposal.id);
        const after = event
          ? this.store
              .events(500)
              .filter(
                (e) =>
                  e.epoch === snapshot.epoch &&
                  e.sequence > event.sequence &&
                  e.type === 'request.completed',
              )
          : [];
        const denied = after.find((e) => e.source === proposal.content.source && e.status === 403) || (typeof proposal.verification?.deniedEvidence === 'string' ? this.store.evidence(proposal.verification.deniedEvidence) : undefined);
        const control = after.find(
          (e) =>
            e.source !== proposal.content.source &&
            Number(e.status) >= 200 &&
            Number(e.status) < 400,
        ) || (typeof proposal.verification?.controlTrafficEvidence === 'string' ? this.store.evidence(proposal.verification.controlTrafficEvidence) : undefined);
        const installed = snapshot.rules.some(
          (rule) => rule.actionId === proposal.id && rule.source === proposal.content.source,
        );
        if (Date.now() >= action.expiresAtMs && !installed) {
          proposal.status = 'expired';
          proposal.verification = {
            ...proposal.verification,
            expiryObserved: true,
            expiryObservedAt: snapshot.observedAt,
          };
        } else if (installed) {
          proposal.status = denied && control ? 'verified' : 'inconclusive';
          proposal.verification = {
            ...proposal.verification,
            outcome: proposal.status,
            ruleInstalled: true,
            deniedEvidence: denied?.id ?? null,
            controlTrafficEvidence: control?.id ?? null,
            observedAt: snapshot.observedAt,
            note:
              denied && control
                ? 'Target denied; a different client still reached a backend.'
                : 'Rule installed; both target and control observations are needed.',
          };
        }
      }
      this.store.putProposal(proposal);
      if (proposal.status !== previous) {
        this.store.audit('action.verification', {
          id: proposal.id,
          status: proposal.status,
          verification: proposal.verification,
        });
        if (['verified', 'inconclusive'].includes(proposal.status))
          this.store.set('review:' + proposal.id, {
            status: 'pending',
            incidentId: proposal.content.incidentId,
          });
      }
    }
  }
}
