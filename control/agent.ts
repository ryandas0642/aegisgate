import { validateDecision } from './decision.js';
import type { Decision, Evidence, Incident, ModelReply, ToolRequest } from './types.js';

export type AgentDependencies = {
  decide: (
    context: unknown,
    evidence: Set<string>,
    record: (type: string, value: unknown) => Promise<void>,
  ) => Promise<ModelReply>;
  tool: (request: ToolRequest) => Promise<unknown>;
  record: (type: string, value: unknown) => Promise<void>;
  propose: (proposal: NonNullable<Decision['proposal']>, mode: string) => Promise<unknown>;
};

export async function investigate(
  incident: Incident,
  detection: Evidence,
  dependencies: AgentDependencies,
) {
  const evidence = new Set([detection.id]);
  for (const event of incident.verificationEvidence ?? []) evidence.add(event.id);
  const history: unknown[] = [];
  let tools = 0;
  const deadline = Date.now() + 120000;
  for (let turn = 0; turn < 6; turn++) {
    if (Date.now() > deadline) throw new Error('Investigation deadline exhausted');
    const reply = await dependencies.decide(
      { incident, detection, history, remainingTurns: 6 - turn },
      evidence,
      dependencies.record,
    );
    const decision = validateDecision(reply.decision, evidence);
    await dependencies.record('agent.decision', { turn, ...reply });
    history.push({ decision });
    if (decision.requests.length) {
      for (const request of decision.requests) {
        if (++tools > 12) throw new Error('Investigation tool budget exhausted');
        await dependencies.record('tool.requested', request);
        const result = await dependencies.tool(request);
        const collect = (value: unknown): void => {
          if (Array.isArray(value)) value.forEach(collect);
          else if (value && typeof value === 'object') {
            const object = value as Record<string, unknown>;
            if (typeof object.id === 'string') evidence.add(object.id);
            Object.values(object).forEach(collect);
          }
        };
        collect(result);
        history.push({ request, result });
        await dependencies.record('tool.completed', { request, result });
      }
      continue;
    }
    if (decision.proposal) {
      if (incident.phase === 'verification')
        throw new Error('Verification reviews cannot propose another action');
      if (!tools)
        throw new Error('An action proposal requires an actual investigation tool result');
      if (
        incident.kind !== 'security' ||
        decision.proposal.source !== incident.source ||
        !decision.proposal.evidenceIds.includes(detection.id)
      )
        throw new Error('Proposal exceeds the incident boundary');
      await dependencies.propose(decision.proposal, reply.mode);
    }
    return {
      finding: decision.finding!,
      mode: reply.mode,
      requestId: reply.requestId,
      model: reply.model,
      toolCalls: tools,
    };
  }
  throw new Error('Investigation turn budget exhausted before a finding');
}
