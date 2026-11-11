import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';
import { ProxyClient } from './proxy.js';
import { settings } from './settings.js';
import { Store } from './store.js';

const config = settings(),
  store = new Store(resolve(config.directory, 'aegis.sqlite'));
for (const incident of store.incidents())
  if (incident.status === 'investigating') {
    incident.status = 'unavailable';
    store.putIncident(incident);
    store.audit('investigation.interrupted', { incidentId: incident.id });
  }
const app = createApi({
  store,
  proxy: new ProxyClient(config.proxyOrigin, config.proxyToken),
  password: config.operatorPassword,
  agentToken: config.agentToken,
  model: config.inference.model,
  providerConfigured: !!config.inference.key,
  devOrigin: config.devOrigin,
});
const childEnvironment = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]!]] : [],
  ),
);
app.server.listen(config.port, config.bind, () => {
  console.log(`AegisGate console: http://127.0.0.1:${config.port}`);
  console.log(
    `Operator password is stored locally in ${resolve(config.directory, 'secrets.json')}`,
  );
  console.log(
    config.inference.key
      ? 'Live provider configured.'
      : 'Model provider unavailable. Deterministic controls and manual operator review remain available.',
  );
  const workerArguments = import.meta.url.endsWith('.ts')
    ? ['--import', 'tsx', 'control/worker.ts']
    : [fileURLToPath(new URL('./worker.js', import.meta.url))];
  const worker = spawn(process.execPath, workerArguments, {
    cwd: process.cwd(),
    env: {
      ...childEnvironment,
      AEGIS_AGENT_TOKEN: config.agentToken,
      AEGIS_CONTROL_ORIGIN: `http://127.0.0.1:${config.port}`,
      OPENROUTER_API_KEY: config.inference.key,
      OPENROUTER_MODEL: config.inference.model,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    worker.kill();
    app.server.close(() => {
      store.db.close();
      process.exit();
    });
    setTimeout(() => process.exit(), 4000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  worker.on('exit', (code) => {
    if (!closing) {
      store.audit('worker.stopped', { code });
      console.error('Investigator stopped; restart the console to resume model investigations.');
    }
  });
});
app.server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
