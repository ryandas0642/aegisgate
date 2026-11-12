/** Isolated real proxy and browser acceptance. Use --live to opt into provider calls. */
import http from 'node:http';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { createApi } from '../control/api.js';
import { Store } from '../control/store.js';
import { Demo } from '../control/demo.js';
import { ProxyClient } from '../control/proxy.js';
import { inferenceConfig } from '../control/provider.js';
import { compilerRuntimePath } from './compiler_runtime.js';
async function port() {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
async function until(fn: () => Promise<boolean>, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(150);
  }
  throw Error('Condition timed out');
}
// Live provider calls are opt-in; the default validates the explicitly manual fallback.
const noModel = !process.argv.includes('--live');
const suffix = noModel ? 'offline' : 'live';
const root = resolve('.runtime', 'cyber-review-' + suffix + '-' + Date.now());
mkdirSync(root, { recursive: true });
const inference = noModel ? { key: '', model: 'openai/gpt-4.1-mini' } : inferenceConfig();
const password = 'synthetic-browser-review';
const token = 'synthetic-proxy-review-token-at-least-32-characters';
const agentToken = 'synthetic-agent-review-token-at-least-32-characters';
const proxyPort = await port(),
  adminPort = await port();
const backend = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Length': 2 });
  res.end('ok');
});
await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
const config = {
  ...JSON.parse(readFileSync('configs/local.json', 'utf8')),
  port: proxyPort,
  adminPort,
  backends: [
    { id: 'review-backend', host: '127.0.0.1', port: (backend.address() as net.AddressInfo).port },
  ],
};
writeFileSync(resolve(root, 'proxy.json'), JSON.stringify(config));
const proxyProcess = spawn(
  resolve('build', process.platform === 'win32' ? 'aegis-proxy.exe' : 'aegis-proxy'),
  [resolve(root, 'proxy.json')],
  {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, PATH: compilerRuntimePath(), AEGIS_PROXY_TOKEN: token },
  },
);
const store = new Store(resolve(root, 'review.sqlite'));
const demo = new Demo(async () => {}, proxyPort);
const proxy = new ProxyClient('http://127.0.0.1:' + adminPort, token);
const app = createApi({
  store,
  proxy,
  demo,
  password,
  agentToken,
  model: inference.model,
  providerConfigured: !!inference.key,
});
let worker: ChildProcess | undefined, browser: Browser | undefined;
try {
  await until(async () => {
    try {
      return (await proxy.snapshot()).backends[0].healthy;
    } catch {
      return false;
    }
  });
  await app.poll();
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + (app.server.address() as net.AddressInfo).port;
  worker = spawn(process.execPath, ['--import', 'tsx', 'control/worker.ts'], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      AEGIS_AGENT_TOKEN: agentToken,
      AEGIS_CONTROL_ORIGIN: origin,
      OPENROUTER_API_KEY: inference.key,
      OPENROUTER_MODEL: inference.model,
      AEGIS_ENV_FILE: resolve(root, 'absent.env'),
    },
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.AEGIS_BROWSER_EXECUTABLE
      ? { executablePath: process.env.AEGIS_BROWSER_EXECUTABLE }
      : process.platform === 'win32'
        ? { channel: 'msedge' }
        : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1512, height: 1060 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByLabel('Operator password').fill(password);
  await page.getByRole('button', { name: 'Open operations console' }).click();
  await page.getByRole('button', { name: 'Start cyber demo', exact: true }).click();
  await until(async () => !!store.incidents().find((i) => i.kind === 'security'));
  await page.screenshot({ path: resolve(root, 'investigating.png'), fullPage: true });
  await until(
    async () =>
      store
        .incidents()
        .some((i) => ['awaiting_approval', 'investigated', 'unavailable'].includes(i.status)),
    130000,
  );
  const current = store.incidents().find((i) => i.kind === 'security')!;
  if (current.finding) await page.getByText(current.finding.summary, { exact: true }).waitFor();
  const failure = store
    .auditRecords(500)
    .find((r: any) => r.type === 'investigation.unavailable') as any;
  console.log(
    JSON.stringify({
      mode: suffix,
      status: current.status,
      error: failure?.payload?.error,
      toolCalls: store
        .auditRecords(500)
        .filter((r) => r.type === 'investigation.tool.completed')
        .map((r: any) => r.payload.data.request.tool),
    }),
  );
  if (current.status === 'unavailable')
    await page.getByRole('button', { name: 'Create manual fallback · 60 seconds' }).click();
  if (store.proposals().length) {
    const button = page.getByRole('button', { name: 'Approve containment', exact: true });
    await button.waitFor();
    assert.equal(await button.isDisabled(), true);
    assert.equal((await proxy.snapshot()).rules.length, 0);
    await page.getByRole('checkbox').check();
    await button.click();
    await until(async () => store.proposals()[0]?.status === 'verified', 10000);
    if (inference.key && current.status !== 'unavailable')
      await until(
        async () =>
          !!store.proposals()[0]?.verification?.modelReview ||
          store.get<any>('review:' + store.proposals()[0].id)?.status === 'unavailable',
        125000,
      );
    await page.getByText('HTTP 403 observed', { exact: true }).waitFor();
    if (store.proposals()[0].verification?.modelReview)
      await page.getByRole('heading', { name: 'AI follow-up review', exact: true }).waitFor();
    assert.ok(store.proposals()[0].verification?.controlTrafficEvidence);
    console.log(
      JSON.stringify({
        response: store.proposals()[0].status,
        modelReview: !!store.proposals()[0].verification?.modelReview,
        mode: store.proposals()[0].mode,
      }),
    );
  } else {
    console.log('Live agent recommended no containment; no fake proposal added.');
  }
  await page.screenshot({ path: resolve(root, 'cyber-demo.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(root, 'mobile.png'), fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'mobile must not overflow',
  );
  assert.deepEqual(errors, []);
  assert.ok(store.verifyAudit());
  writeFileSync(
    resolve('.runtime', 'cyber-review-' + suffix + '-result.json'),
    JSON.stringify({
      root,
      status: current.status,
      proposal: store.proposals()[0]?.status,
      mode: store.proposals()[0]?.mode,
      modelReview: !!store.proposals()[0]?.verification?.modelReview,
    }),
  );
  console.log('PASS: ' + suffix + ' browser flow; screenshot folder ' + root);
} finally {
  demo.close();
  if (browser) await browser.close();
  if (worker) {
    worker.kill();
    await delay(300);
  }
  proxyProcess.kill();
  await delay(300);
  await new Promise<void>((r) => app.server.close(() => r()));
  await new Promise<void>((r) => backend.close(() => r()));
  store.db.close();
}
