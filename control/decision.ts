import Ajv from 'ajv';
import type { Decision } from './types.js';

const text = { type: 'string', minLength: 1, maxLength: 1200 };
const ids = {
  type: 'array',
  maxItems: 12,
  items: { type: 'string', minLength: 1, maxLength: 100 },
  uniqueItems: true,
};
export const decisionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['plan', 'requests', 'finding', 'proposal'],
  properties: {
    plan: { type: 'array', minItems: 1, maxItems: 6, items: text },
    requests: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tool', 'arguments'],
        properties: {
          tool: {
            type: 'string',
            enum: ['recent_events', 'metrics', 'backend_health', 'active_rules'],
          },
          arguments: {
            type: 'object',
            additionalProperties: false,
            required: ['limit'],
            properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
          },
        },
      },
    },
    finding: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['summary', 'observations', 'alternatives', 'uncertainty', 'recommendation'],
          properties: {
            summary: text,
            observations: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'evidenceIds'],
                properties: { text, evidenceIds: { ...ids, minItems: 1 } },
              },
            },
            alternatives: { type: 'array', minItems: 1, maxItems: 4, items: text },
            uncertainty: text,
            recommendation: text,
          },
        },
      ],
    },
    proposal: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'ttlSeconds', 'evidenceIds', 'rationale', 'expectedImpact'],
          properties: {
            source: { type: 'string', pattern: '^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$' },
            ttlSeconds: { type: 'integer', minimum: 60, maximum: 600 },
            evidenceIds: { ...ids, minItems: 1 },
            rationale: text,
            expectedImpact: text,
          },
        },
      ],
    },
  },
} as const;
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(decisionSchema);

export function validateDecision(value: unknown, evidenceIds: Set<string>): Decision {
  if (!validate(value)) throw new Error('Model decision failed local schema validation');
  const decision = value as Decision;
  if (decision.requests.length && (decision.finding || decision.proposal))
    throw new Error('Tool requests and final findings must use separate turns');
  if (!decision.requests.length && !decision.finding)
    throw new Error('The agent must inspect evidence or finish with a finding');
  const references = [
    ...(decision.finding?.observations.flatMap((item) => item.evidenceIds) ?? []),
    ...(decision.proposal?.evidenceIds ?? []),
  ];
  if (references.some((id) => !evidenceIds.has(id)))
    throw new Error('Model cited evidence it has not received');
  return decision;
}
