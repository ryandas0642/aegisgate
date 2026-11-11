import http from 'node:http';
import { setTimeout } from 'node:timers/promises';
const args = process.argv.slice(2), value = (key: string, fallback: string) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const mode = value('--mode', 'normal'), source = value('--source', process.env.AEGIS_SOURCE || (mode === 'burst' ? '127.0.0.2' : '127.0.0.1'));
const url = new URL(value('--origin', process.env.AEGIS_TRAFFIC_ORIGIN || 'http://127.0.0.1:8180/'));
const count = Number(value('--count', mode === 'burst' ? '80' : '120')), interval = Number(value('--interval', mode === 'burst' ? '0' : '500'));
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', 'proxy'].includes(url.hostname) || !['normal', 'burst'].includes(mode) || !Number.isInteger(count) || count < 1 || count > 1000 || !Number.isInteger(interval) || interval < 0 || interval > 5000) throw new Error('Traffic is restricted to the local demo proxy, with bounded count and interval');
console.log(`SYNTHETIC ${mode} traffic: ${count} requests; source ${source}; ${url.origin}`);
const codes: Record<string, number> = {};
for (let index = 0; index < count; index++) {
  const code = await new Promise<string>(resolve => {
    const request = http.get(url, { ...(source === 'auto' ? {} : { localAddress: source }), headers: { 'X-Aegis-Demo': 'synthetic' }, timeout: 5000 }, response => { response.resume(); response.on('end', () => resolve(String(response.statusCode))); });
    request.on('error', () => resolve('connection_error')); request.on('timeout', () => request.destroy());
  });
  codes[code] = (codes[code] || 0) + 1;
  if (interval) await setTimeout(interval);
}
console.log(JSON.stringify({ synthetic: true, source, requests: count, responses: codes }, null, 2));
