import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compilerRuntimePath } from './compiler_runtime.js';
import { settings } from '../control/settings.js';
const config = settings(),
  children = new Map<string, ChildProcess>();
const executable = resolve(
  'build',
  process.platform === 'win32' ? 'aegis-proxy.exe' : 'aegis-proxy',
);
if (!existsSync(executable)) throw new Error('Build the proxy first: npm run build:proxy');
if (!existsSync('dist/index.html')) throw new Error('Build the dashboard first: npm run build');
function launch(name: string, command: string, args: string[], extra: Record<string, string> = {}) {
  if (children.has(name)) return;
  const child = spawn(command, args, {
    stdio:
      name === 'console'
        ? ['ignore', 'inherit', 'inherit', 'ipc']
        : ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    env: {
      ...process.env,
      PATH: compilerRuntimePath(),
      ...extra,
    },
  });
  children.set(name, child);
  child.on('exit', () => children.delete(name));
  child.on('error', (error) => console.error(`${name}: ${error.message}`));
  if (name === 'console')
    child.on('message', async (message: any) => {
      if (
        message?.type !== 'demo.backend' ||
        !['stop-a', 'start-a'].includes(message.action) ||
        typeof message.id !== 'string'
      )
        return;
      try {
        if (message.action === 'start-a') startBackend('a');
        else {
          const backend = children.get('a');
          if (backend)
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('Backend did not stop')), 4000);
              backend.once('exit', () => {
                clearTimeout(timer);
                resolve();
              });
              backend.kill();
            });
        }
        if (child.connected) child.send({ id: message.id, ok: true });
      } catch {
        if (child.connected) child.send({ id: message.id, ok: false });
      }
    });
}
const startBackend = (name: string) =>
  launch(name, process.execPath, [
    '--import',
    'tsx',
    'scripts/backend.ts',
    '--id',
    name === 'a' ? 'backend-a' : 'backend-b',
    '--port',
    name === 'a' ? '8101' : '8102',
  ]);
startBackend('a');
startBackend('b');
launch('proxy', executable, [resolve('configs/local.json')], {
  AEGIS_PROXY_TOKEN: config.proxyToken,
});
launch('console', process.execPath, ['--import', 'tsx', 'control/server.ts'], {
  AEGIS_DEMO_ENABLED: '1',
});
console.log(
  'Local synthetic backends started. Type "stop a", "start a", "stop b", or "start b" to demonstrate health failover. Ctrl+C stops this local stack.',
);
process.stdin.setEncoding('utf8');
let pending = '';
process.stdin.on('data', (chunk) => {
  pending += chunk;
  while (pending.includes('\n')) {
    const end = pending.indexOf('\n'),
      command = pending.slice(0, end).trim();
    pending = pending.slice(end + 1);
    const match = command.match(/^(start|stop) ([ab])$/);
    if (!match) {
      if (command) console.log('Supported commands: stop a, start a, stop b, start b');
      continue;
    }
    if (match[1] === 'start') startBackend(match[2]);
    else children.get(match[2])?.kill();
  }
});
let closing = false;
const stop = () => {
  if (closing) return;
  closing = true;
  for (const child of children.values()) {
    if (process.platform === 'win32' && child.pid)
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    else child.kill();
  }
  setTimeout(() => process.exit(), 1500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
