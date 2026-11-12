import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { Store } from '../control/store.js';
import { createApi } from '../control/api.js';
import { ProxyClient } from '../control/proxy.js';
import { investigate } from '../control/agent.js';
import { investigateTool } from '../control/tools.js';
import type { Decision, Snapshot } from '../control/types.js';
import { compilerRuntimePath } from '../scripts/compiler_runtime.js';

async function until<T>(
  operation: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  milliseconds = 5000,
): Promise<T> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (predicate(value)) return value;
    } catch {}
    await setTimeout(80);
  }
  throw new Error('End-to-end acceptance condition timed out');
}
async function freePort() {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((r) => child.once('exit', () => r()));
  child.kill();
  await Promise.race([exited, setTimeout(4000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
function traffic(port: number, source = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${port}/`,
      { localAddress: source, timeout: 2000 },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy());
  });
}

test(
  'E2E: real detection → FIXTURE model tool use → operator session → real enforcement → verification → offline TTL expiry',
  { timeout: 90000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'aegis-e2e-')),
      store = new Store(join(root, 'test.sqlite'));
    const token = 'synthetic-e2e-proxy-token-of-at-least-32-characters',
      agentToken = 'synthetic-e2e-investigator-token-with-32-characters',
      password = 'synthetic-e2e-operator-password';
    const backend = http.createServer((req, res) => {
      const body = JSON.stringify({ service: 'synthetic-e2e', synthetic: true });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    });
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
    const configuration = {
      ...JSON.parse(readFileSync('configs/local.json', 'utf8')),
      port: await freePort(),
      adminPort: await freePort(),
      healthIntervalMs: 100,
      healthTimeoutMs: 100,
      ratePerSecond: 2,
      burst: 4,
      violationThreshold: 2,
      backends: [
        { id: 'e2e', host: '127.0.0.1', port: (backend.address() as net.AddressInfo).port },
      ],
    };
    const configPath = join(root, 'proxy.json');
    writeFileSync(configPath, JSON.stringify(configuration));
    const env = {
      ...process.env,
      AEGIS_PROXY_TOKEN: token,
      PATH: compilerRuntimePath(),
    };
    const processProxy = spawn(
      resolve('build', process.platform === 'win32' ? 'aegis-proxy.exe' : 'aegis-proxy'),
      [configPath],
      { env, windowsHide: true, stdio: 'ignore' },
    );
    const proxy = new ProxyClient(`http://127.0.0.1:${configuration.adminPort}`, token);
    const app = createApi({
      store,
      proxy,
      password,
      agentToken,
      model: 'test/fixture',
      providerConfigured: false,
    });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(app.server.address() as net.AddressInfo).port}`;
    let worker: ChildProcess | undefined,
      apiClosed = false;
    t.after(async () => {
      if (worker) await stop(worker);
      await stop(processProxy);
      if (!apiClosed) await new Promise<void>((r) => app.server.close(() => r()));
      await new Promise<void>((r) => backend.close(() => r()));
      store.db.close();
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
      rmSync(root, { recursive: true, force: true });
    });
    await until(
      () => proxy.snapshot(),
      (s: Snapshot) => s.backends[0].healthy,
    );
    for (let i = 0; i < 9; i++) await traffic(configuration.port, '127.0.0.2');
    await app.poll();
    const incident = store.incidents()[0];
    assert.ok(incident, 'real rate-limit traffic must create an incident');
    worker = spawn(process.execPath, ['--import', 'tsx', 'control/worker.ts'], {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        AEGIS_AGENT_TOKEN: agentToken,
        AEGIS_CONTROL_ORIGIN: origin,
        AEGIS_ENV_FILE: join(root, 'absent.env'),
        OPENROUTER_MODEL: 'test/unavailable',
      },
      windowsHide: true,
      stdio: 'ignore',
    });
    await until(
      () => store.incident(incident.id),
      (value) => value?.status === 'unavailable',
    );
    assert.equal(
      await traffic(configuration.port),
      200,
      'actual provider outage must not stop forwarding',
    );
    await stop(worker);
    worker = undefined;
    const evidence = store.evidence(incident.eventId)!;
    let turns = 0;
    const decisions: Decision[] = [
      {
        plan: ['Inspect actual source events.'],
        requests: [{ tool: 'recent_events', arguments: { limit: 50 } }],
        finding: null,
        proposal: null,
      },
      {
        plan: ['Explain violations and propose a temporary deny.'],
        requests: [],
        finding: {
          summary: 'Fixture model assessment of real source violations.',
          observations: [
            { text: 'Actual events contain repeated rejections.', evidenceIds: [evidence.id] },
          ],
          alternatives: ['A synthetic load test is the expected cause.'],
          uncertainty: 'This fixture does not establish live model quality.',
          recommendation: 'Review a one-minute deny for the designated synthetic client.',
        },
        proposal: {
          source: incident.source!,
          ttlSeconds: 60,
          evidenceIds: [evidence.id],
          rationale: 'Explicit fixture proposal supported by actual proxy detections.',
          expectedImpact: 'Deny only the designated synthetic source for 60 seconds.',
        },
      },
    ];
    await investigate(incident, evidence, {
      decide: async () => ({
        decision: decisions[turns++],
        requestId: 'fixture-e2e-request',
        model: 'test/fixture',
        usage: null,
        mode: 'fixture',
      }),
      tool: async (request) => investigateTool(store, incident, request),
      record: async (type, payload) => store.audit('fixture.' + type, payload),
      propose: (proposal, mode) => app.broker.propose(incident.id, proposal, mode),
    });
    const proposal = store.proposals()[0];
    assert.equal(proposal.mode, 'fixture');
    assert.equal(
      (await proxy.snapshot()).rules.length,
      0,
      'a recommendation cannot change enforcement',
    );
    const post = (path: string, value: unknown, headers: Record<string, string> = {}) =>
      fetch(origin + path, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(value),
      });
    const login = await post('/api/login', { password }),
      cookie = login.headers.get('set-cookie')!.split(';')[0],
      { csrf } = (await login.json()) as { csrf: string };
    const approved = await post(
      `/api/proposals/${proposal.id}/approve`,
      { hash: proposal.hash },
      { Cookie: cookie, 'X-CSRF-Token': csrf },
    );
    assert.equal(approved.status, 200);
    assert.equal(await traffic(configuration.port, '127.0.0.2'), 403);
    assert.equal(await traffic(configuration.port), 200);
    await app.poll();
    assert.equal(store.proposal(proposal.id)?.status, 'verified');
    assert.ok(store.verifyAudit());
    await new Promise<void>((r) => app.server.close(() => r()));
    apiClosed = true;
    await until(
      () => traffic(configuration.port, '127.0.0.2'),
      (status) => status === 200,
      63000,
    );
    assert.equal(
      (await proxy.snapshot()).rules.length,
      0,
      'proxy must expire the deny while its control plane is stopped',
    );
    await app.poll();
    assert.equal(store.proposal(proposal.id)?.status, 'expired');
    const types = store.auditRecords().map((row) => row.type);
    for (const type of [
      'incident.detected',
      'action.proposed',
      'human.approved',
      'action.applied',
      'action.verification',
      'investigation.unavailable',
    ])
      assert.ok(types.includes(type), type);
  },
);
