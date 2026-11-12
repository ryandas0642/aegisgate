import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Demo } from '../control/demo.js';

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
});
