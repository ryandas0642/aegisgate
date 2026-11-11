import http from 'node:http';

export const demoActions = ['traffic', 'stop-traffic', 'burst', 'verify', 'stop-a', 'start-a'] as const;
export type DemoAction = typeof demoActions[number];

/** Local synthetic harness. It has no approval or enforcement grant. */
export class Demo {
  private timer?: ReturnType<typeof setInterval>;
  private pending = false;
  private busy = false;
  private until = 0;
  private normal: Record<string, number> = {};
  private last: unknown = null;
  constructor(private backend: (action: 'stop-a' | 'start-a') => Promise<void>) {}
  state() { return { enabled: true, running: !!this.timer, busy: this.busy, until: this.until, normal: this.normal, last: this.last }; }
  private request(source: string): Promise<number> {
    return new Promise(resolve => {
      const req = http.get('http://127.0.0.1:8180/', { localAddress: source, timeout: 4000, headers: { 'X-Aegis-Demo': 'synthetic' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); res.on('error', () => resolve(0)); });
      req.on('error', () => resolve(0)); req.on('timeout', () => req.destroy());
    });
  }
  async run(action: DemoAction) {
    if (!demoActions.includes(action)) throw new Error('Unknown demo action');
    if (this.busy) throw new Error('A demo action is already running');
    this.busy = true;
    try {
      if (action === 'traffic') {
        if (!this.timer) {
          this.until = Date.now() + 300000; this.normal = {};
          this.timer = setInterval(async () => {
            if (Date.now() >= this.until) { this.close(); return; }
            if (this.pending) return;
            this.pending = true;
            try { const status = String(await this.request('127.0.0.1')); this.normal[status] = (this.normal[status] || 0) + 1; } finally { this.pending = false; }
          }, 500);
        }
        this.last = { action, message: 'Normal synthetic traffic started for up to five minutes.' };
      } else if (action === 'stop-traffic') { this.close(); this.last = { action, message: 'Normal traffic stopped.' }; }
      else if (action === 'burst') {
        const responses: Record<string, number> = {};
        for (let i = 0; i < 80; i++) { const code = String(await this.request('127.0.0.2')); responses[code] = (responses[code] || 0) + 1; }
        this.last = { action, source: '127.0.0.2', requests: 80, responses };
      } else if (action === 'verify') {
        this.last = { action, targetStatus: await this.request('127.0.0.2'), normalStatus: await this.request('127.0.0.1'), message: 'Actual requests sent. The response view reports verification.' };
      } else { await this.backend(action); this.last = { action, message: action === 'stop-a' ? 'Backend A stopped. Watch the health checks.' : 'Backend A started. Wait for healthy checks.' }; }
      return this.state();
    } finally { this.busy = false; }
  }
  close() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
