import { boundedJson } from './http.js';
import type { Snapshot } from './types.js';

export class EnforcementRejection extends Error {
  readonly definitive = true;
}

export class ProxyClient {
  constructor(
    readonly origin: string,
    private token: string,
  ) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/')
      throw new Error('Proxy control URL must be a private HTTP origin');
  }
  async call(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(this.origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const data = await boundedJson(response);
    if (!response.ok)
      throw new EnforcementRejection(`Proxy refused the operation (HTTP ${response.status})`);
    return data;
  }
  async snapshot(): Promise<Snapshot> {
    const value = (await this.call('/v1/state')) as Snapshot;
    if (
      !value ||
      typeof value.epoch !== 'string' ||
      !Number.isSafeInteger(value.revision) ||
      !Number.isSafeInteger(value.sequence) ||
      !Array.isArray(value.events) ||
      !Array.isArray(value.backends) ||
      !Array.isArray(value.rules) ||
      !Array.isArray(value.actions) ||
      !value.metrics
    )
      throw new Error('Malformed proxy snapshot');
    return value;
  }
  async deny(input: unknown): Promise<Record<string, unknown>> {
    return (await this.call('/v1/actions/deny', input)) as Record<string, unknown>;
  }
}
