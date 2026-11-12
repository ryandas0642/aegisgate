import test from 'node:test';
import assert from 'node:assert/strict';
import { investigate } from '../control/agent.js';
import { investigateTool } from '../control/tools.js';
import { Broker } from '../control/broker.js';
import { seed, detection, finding, action, FakeProxy } from './fixtures.js';
import type { Decision } from '../control/types.js';

test('fixture model chooses actual evidence tools before an evidence-backed proposal', async (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  const broker = new Broker(store, new FakeProxy());
  let turns = 0;
  const decisions: Decision[] = [
    {
      plan: ['Compare clients and preview containment impact.'],
      requests: [
        { tool: 'compare_sources', arguments: { limit: 100 } },
        { tool: 'containment_preview', arguments: { limit: 100 } },
      ],
      finding: null,
      proposal: null,
    },
    {
      plan: ['Correlate source violations; offer a narrow response.'],
      requests: [],
      finding,
      proposal: action(),
    },
  ];
  const result = await investigate(incident, detection, {
    decide: async () => ({
      decision: decisions[turns++],
      requestId: 'fixture-request',
      model: 'test/fixture',
      usage: null,
      mode: 'fixture',
    }),
    tool: async (request) => investigateTool(store, incident, request),
    record: async (type, data) => store.audit(type, data),
    propose: (proposal, mode) => broker.propose(incident.id, proposal, mode),
  });
  assert.equal(result.mode, 'fixture');
  assert.equal(result.toolCalls, 2);
  assert.equal(store.proposals()[0].status, 'proposed');
  assert.equal(store.proposals()[0].mode, 'fixture');
  assert.ok(store.verifyAudit());
});
test('provider failure produces no action and tools reject expanded arguments', async (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  await assert.rejects(
    investigate(incident, detection, {
      decide: async () => {
        throw new Error('provider unavailable');
      },
      tool: async () => {
        throw new Error('must not run');
      },
      record: async () => {},
      propose: async () => {
        throw new Error('must not run');
      },
    }),
    /unavailable/,
  );
  assert.equal(store.proposals().length, 0);
  assert.throws(
    () => investigateTool(store, incident, { tool: 'shell', arguments: { limit: 1 } }),
    /grant/,
  );
  assert.throws(
    () =>
      investigateTool(store, incident, {
        tool: 'metrics',
        arguments: { limit: 1, command: 'anything' },
      }),
    /Malformed/,
  );
});
test('an endless model investigation stops at its turn budget', async (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  let calls = 0;
  await assert.rejects(
    investigate(incident, detection, {
      decide: async () => {
        calls++;
        return {
          decision: {
            plan: ['Inspect'],
            requests: [{ tool: 'metrics', arguments: { limit: 1 } }],
            finding: null,
            proposal: null,
          },
          requestId: 'fixture',
          model: 'test/fixture',
          usage: null,
          mode: 'fixture',
        };
      },
      tool: async (request) => investigateTool(store, incident, request),
      record: async () => {},
      propose: async () => {},
    }),
    /budget/,
  );
  assert.equal(calls, 6);
});

test('verification reviews can cite supplied outcome evidence and cannot propose another action', async (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  const reviewIncident = {
    ...incident,
    phase: 'verification' as const,
    verificationEvidence: [{ ...detection, id: 'post-action-evidence', status: 403 }],
  };
  const assessed = {
    ...finding,
    observations: [
      {
        text: 'Actual post-action target request was denied.',
        evidenceIds: ['post-action-evidence'],
      },
    ],
  };
  const dependencies = {
    decide: async () => ({
      decision: {
        plan: ['Review the actual outcome.'],
        requests: [],
        finding: assessed,
        proposal: null,
      } as Decision,
      requestId: 'fixture-review',
      model: 'test/fixture',
      usage: null,
      mode: 'fixture' as const,
    }),
    tool: async () => ({}),
    record: async () => {},
    propose: async () => {
      throw new Error('must not execute');
    },
  };
  assert.equal(
    (await investigate(reviewIncident, detection, dependencies)).finding.observations[0]
      .evidenceIds[0],
    'post-action-evidence',
  );
  await assert.rejects(
    investigate(reviewIncident, detection, {
      ...dependencies,
      decide: async () => ({
        ...(await dependencies.decide()),
        decision: { plan: ['Review'], requests: [], finding: assessed, proposal: action() },
      }),
    }),
    /Verification reviews/,
  );
});
