import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApi } from '../control/api.js';
import { seed, action, FakeProxy } from './fixtures.js';
import { Demo } from '../control/demo.js';

test('operator and worker credentials stay separate; Host, Origin, and CSRF protect approvals', async (t) => {
  const { store, incident } = seed(),
    proxy = new FakeProxy(),
    password = 'x',
    agentToken = 'synthetic-agent-token-longer-than-32-characters';
  const app = createApi({
    demo: new Demo(async () => {}),
    store,
    proxy,
    password,
    agentToken,
    model: 'test/fixture',
    providerConfigured: false,
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    store.db.close();
  });
  const origin = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown, headers = {}) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(origin + '/api/state')).status, 401);
  assert.equal(
    (await post('/api/demo', { action: 'stop-a' }, { Authorization: 'Bearer ' + agentToken }))
      .status,
    401,
  );
  assert.equal((await post('/api/login', { password: 'wrong' })).status, 409);
  assert.equal(
    (await post('/api/login', { password }, { Origin: 'https://attacker.invalid' })).status,
    403,
  );
  const login = await post('/api/login', { password }),
    cookie = login.headers.get('set-cookie')!.split(';')[0],
    session = (await login.json()) as { csrf: string };
  const p = await app.broker.propose(incident.id, action(), 'fixture');
  assert.equal((await post('/api/demo', { action: 'stop-a' }, { Cookie: cookie })).status, 401);
  assert.equal(
    (await post('/api/demo', { action: 'shell' }, { Cookie: cookie, 'X-CSRF-Token': session.csrf }))
      .status,
    409,
  );
  assert.equal(
    (
      await post(
        '/api/demo',
        { action: 'stop-a' },
        { Cookie: cookie, 'X-CSRF-Token': session.csrf },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        `/api/proposals/${p.id}/approve`,
        { hash: p.hash },
        { Authorization: 'Bearer ' + agentToken },
      )
    ).status,
    401,
  );
  assert.equal(
    (await post(`/api/proposals/${p.id}/approve`, { hash: p.hash }, { Cookie: cookie })).status,
    401,
  );
  assert.equal(
    (
      await post(
        `/api/proposals/${p.id}/approve`,
        { hash: 'changed' },
        { Cookie: cookie, 'X-CSRF-Token': session.csrf },
      )
    ).status,
    409,
  );
  assert.equal(proxy.calls, 0);
  assert.equal(
    (
      await post(
        `/api/proposals/${p.id}/approve`,
        { hash: p.hash },
        { Cookie: cookie, 'X-CSRF-Token': session.csrf },
      )
    ).status,
    200,
  );
  assert.equal(proxy.calls, 1);
  assert.equal(
    (await fetch(origin + '/internal/next', { headers: { Cookie: cookie } })).status,
    403,
  );
  assert.equal((await fetch(origin + '/.env')).status, 404);
  const badHost = await new Promise<number>((resolve, reject) => {
    const req = http.get(origin + '/health', { headers: { Host: 'attacker.invalid' } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on('error', reject);
  });
  assert.equal(badHost, 403);
});

test('investigator API requires completed comparison and impact tools before proposing', async (t) => {
  const { store, incident } = seed();
  store.putIncident({
    ...incident,
    id: 'older-case',
    eventId: 'old-epoch:1',
    proxyEpoch: 'old-epoch',
  });
  const agentToken = 'synthetic-investigator-token-for-risk-checks';
  const proxy = new FakeProxy();
  const app = createApi({
    store,
    proxy,
    password: 'x',
    agentToken,
    model: 'test/fixture',
    providerConfigured: false,
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    store.db.close();
  });
  const origin = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const headers = { Authorization: 'Bearer ' + agentToken, 'Content-Type': 'application/json' };
  const job = (await (await fetch(origin + '/internal/next', { headers })).json()) as {
    jobId: string;
  };
  const post = (path: string, value: unknown) =>
    fetch(origin + path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jobId: job.jobId, ...(value as object) }),
    });
  assert.equal((await post('/internal/propose', { mode: 'live', proposal: action() })).status, 409);
  assert.equal(
    (
      await post('/internal/tool', {
        request: { tool: 'compare_sources', arguments: { limit: 100 } },
      })
    ).status,
    200,
  );
  assert.equal((await post('/internal/propose', { mode: 'live', proposal: action() })).status, 409);
  assert.equal(
    (
      await post('/internal/tool', {
        request: { tool: 'containment_preview', arguments: { limit: 100 } },
      })
    ).status,
    200,
  );
  assert.equal((await post('/internal/propose', { mode: 'live', proposal: action() })).status, 200);
  assert.equal(store.proposals()[0].content.incidentId, incident.id);
  assert.equal(proxy.calls, 0, 'tool checks and proposal must not apply a block');
});
