import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Demo } from '../control/demo.js';
import { isScenarioIncident } from '../control/scenario.js';
import { seed } from './fixtures.js';

test('demo sends bounded real traffic from distinct clients and only fixed backend operations', async (t) => {
  const peers: string[] = [],
    operations: string[] = [];
  const server = http.createServer((req, res) => {
    peers.push(req.socket.remoteAddress!);
    res.writeHead(req.socket.remoteAddress === '127.0.0.2' ? 429 : 200, { 'Content-Length': 0 });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const demo = new Demo(
    async (action) => {
      operations.push(action);
    },
    (server.address() as { port: number }).port,
  );
  t.after(async () => {
    demo.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const burst = await demo.run('burst');
  assert.deepEqual((burst.last as any).responses, { '429': 80 });
  const verify = await demo.run('verify');
  assert.equal((verify.last as any).targetStatus, 429);
  assert.equal((verify.last as any).normalStatus, 200);
  assert.ok(peers.includes('127.0.0.1') && peers.includes('127.0.0.2'));
  await demo.run('stop-a');
  await demo.run('start-a');
  assert.deepEqual(operations, ['stop-a', 'start-a']);
  await assert.rejects(demo.run('shell' as any), /Unknown/);
  await demo.run('traffic');
  assert.equal(demo.state().running, true);
  await demo.run('stop-traffic');
  assert.equal(demo.state().running, false);
  const scenario = await demo.run('scenario');
  assert.equal(scenario.busy, false);
  assert.equal(scenario.running, true);
  assert.ok(scenario.scenario?.startedAt);
  assert.equal((scenario.last as any).normalStatus, 200);
  assert.equal((scenario.last as any).responses['429'], 80);
  await assert.rejects(demo.run('scenario'), /31 seconds/);
  await demo.run('stop-traffic');
});

test('scenario selects by proxy sequence even when detection time rounds before the start', (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  const current = { ...incident, eventId: 'test-epoch:34', createdAt: '2026-11-11T13:00:00Z' };
  const boundary = {
    epoch: 'test-epoch',
    afterSequence: 3,
    startedAt: Date.parse('2026-11-11T13:00:00.864Z'),
  };
  assert.ok(isScenarioIncident(current, boundary, 'test-epoch'));
  assert.equal(
    isScenarioIncident({ ...current, eventId: 'test-epoch:2' }, boundary, 'test-epoch'),
    false,
  );
  assert.equal(isScenarioIncident(current, boundary, 'new-epoch'), false);
  assert.equal(
    isScenarioIncident({ ...current, source: '127.0.0.1' }, boundary, 'test-epoch'),
    false,
  );
  assert.equal(isScenarioIncident(current, null, 'test-epoch'), false);
});
