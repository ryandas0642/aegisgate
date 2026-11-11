import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { inferenceConfig } from './provider.js';

export function settings() {
  const local = (existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}) as Record<
    string,
    string
  >;
  const value = (key: string) => process.env[key] || local[key];
  const directory = resolve(value('AEGIS_RUNTIME_DIR') || '.runtime');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, 'secrets.json');
  if (!existsSync(path))
    writeFileSync(
      path,
      JSON.stringify(
        {
          proxyToken: randomBytes(32).toString('hex'),
          agentToken: randomBytes(32).toString('hex'),
          operatorPassword: randomBytes(18).toString('base64url'),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: 'wx' },
    );
  const generated = JSON.parse(readFileSync(path, 'utf8')) as {
    proxyToken: string;
    agentToken: string;
    operatorPassword: string;
  };
  const port = Number(value('AEGIS_PORT') || 4174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid AEGIS_PORT');
  return {
    directory,
    port,
    bind: value('AEGIS_BIND') || '127.0.0.1',
    proxyOrigin: value('AEGIS_PROXY_ORIGIN') || 'http://127.0.0.1:9090',
    proxyToken: value('AEGIS_PROXY_TOKEN') || generated.proxyToken,
    agentToken: value('AEGIS_AGENT_TOKEN') || generated.agentToken,
    operatorPassword: value('AEGIS_OPERATOR_PASSWORD') || generated.operatorPassword,
    inference: inferenceConfig(),
    devOrigin: value('AEGIS_DEV_ORIGIN'),
  };
}
