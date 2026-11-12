import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, snapshot, detection, finding, action } from './fixtures.js';
import { investigateTool } from '../control/tools.js';
import { investigate } from '../control/agent.js';

test('cyber tools compare actual current-lifetime traffic and preview collateral scope without enforcement', (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  const current = snapshot();
  current.sequence = 5;
  current.events = [
    { ...detection, id: 'old', epoch: 'previous-epoch', type: 'request.completed', status: 429 },
    { ...detection, id: 'target', sequence: 2, type: 'request.completed', status: 429 },
    {
      ...detection,
      id: 'normal',
      sequence: 3,
      source: '127.0.0.1',
      type: 'request.completed',
      status: 200,
    },
    { ...detection, id: 'target-ok', sequence: 4, type: 'request.completed', status: 200 },
  ];
  store.ingest(current);
  const compare = investigateTool(store, incident, {
    tool: 'compare_sources',
    arguments: { limit: 100 },
  }) as any;
  assert.equal(compare.sampleSize, 3);
  assert.equal(compare.target.requests, 2);
  assert.equal(compare.target.limited, 1);
  assert.equal(compare.otherClients.successful, 1);
  assert.ok(!compare.target.evidence.some((event: { id: string }) => event.id === 'old'));
  const preview = investigateTool(store, incident, {
    tool: 'containment_preview',
    arguments: { limit: 100 },
  }) as any;
  assert.equal(preview.target, '127.0.0.2/32');
  assert.equal(preview.affectedSampleRequests, 2);
  assert.equal(preview.otherSampleRequests, 1);
  assert.equal(preview.approvalRequired, true);
  assert.match(preview.caveat, /sharing this source IP/);
  assert.equal(store.proposals().length, 0);
  assert.deepEqual(store.get<any>('snapshot').rules, []);
  const bounded = investigateTool(store, incident, {
    tool: 'compare_sources',
    arguments: { limit: 1 },
  }) as any;
  assert.equal(bounded.sampleSize, 1);
  store.set('connection', { online: true, receivedAt: Date.now() - 5000 });
  assert.throws(
    () =>
      investigateTool(store, incident, { tool: 'containment_preview', arguments: { limit: 10 } }),
    /stale/,
  );
  store.set('connection', { online: true, receivedAt: Date.now() });
  assert.throws(
    () =>
      investigateTool(
        store,
        { ...incident, proxyEpoch: 'old' },
        { tool: 'compare_sources', arguments: { limit: 10 } },
      ),
    /previous/,
  );
});

test('agent cannot propose containment without both source and collateral checks', async () => {
  let turn = 0,
    proposals = 0;
  await assert.rejects(
    investigate(
      {
        id: 'case',
        eventId: detection.id,
        kind: 'security',
        source: detection.source,
        createdAt: detection.time,
        status: 'investigating',
      },
      detection,
      {
        decide: async () => ({
          decision:
            turn++ === 0
              ? {
                  plan: ['Inspect counters'],
                  requests: [{ tool: 'metrics', arguments: { limit: 1 } }],
                  finding: null,
                  proposal: null,
                }
              : { plan: ['Contain'], requests: [], finding, proposal: action() },
          mode: 'fixture',
          requestId: 'fixture',
          model: 'test/fixture',
          usage: null,
        }),
        tool: async () => ({ id: 'tool:metrics' }),
        record: async () => {},
        propose: async () => {
          proposals++;
        },
      },
    ),
    /source comparison and impact preview/,
  );
  assert.equal(proposals, 0);
});
