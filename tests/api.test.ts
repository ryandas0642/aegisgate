import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApi } from '../control/api.js';
import { seed, action, FakeProxy } from './fixtures.js';

test('operator and worker credentials stay separate; Host, Origin, and CSRF protect approvals', async (t) => {
  const { store, incident } = seed(),
    proxy = new FakeProxy(),
    password = 'x',
    agentToken = 'synthetic-agent-token-longer-than-32-characters';
  const app = createApi({
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
  assert.equal((await post('/api/login', { password: 'wrong' })).status, 409);
  assert.equal(
    (await post('/api/login', { password }, { Origin: 'https://attacker.invalid' })).status,
    403,
  );
  const login = await post('/api/login', { password }),
    cookie = login.headers.get('set-cookie')!.split(';')[0],
    session = (await login.json()) as { csrf: string };
  const p = await app.broker.propose(incident.id, action(), 'fixture');
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
