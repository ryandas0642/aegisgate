import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDecision } from '../control/decision.js';
const evidence = new Set(['event-1']);
export const finding = { summary: 'Observed repeated rate-limit violations.', observations: [{ text: 'The proxy recorded violations.', evidenceIds: ['event-1'] }], alternatives: ['A legitimate load test could explain this.'], uncertainty: 'Client intent is unknown.', recommendation: 'Review a temporary source deny.' };
test('strict decisions reject invented evidence, unauthorized tools, and malformed arguments', () => {
  const valid = { plan: ['Read the incident.'], requests: [], finding, proposal: null };
  assert.ok(validateDecision(valid, evidence));
  assert.throws(() => validateDecision({ ...valid, shell: 'anything' }, evidence));
  assert.throws(() => validateDecision({ ...valid, finding: { ...finding, observations: [{ text: 'Claim', evidenceIds: ['invented'] }] } }, evidence));
  assert.throws(() => validateDecision({ plan: ['Inspect'], requests: [{ tool: 'shell', arguments: { limit: 1 } }], finding: null, proposal: null }, evidence));
  assert.throws(() => validateDecision({ plan: ['Inspect'], requests: [{ tool: 'metrics', arguments: { limit: 10000 } }], finding: null, proposal: null }, evidence));
});
