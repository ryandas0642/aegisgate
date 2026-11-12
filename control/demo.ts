import http from 'node:http';

export const demoActions = [
  'scenario',
  'traffic',
  'stop-traffic',
  'burst',
  'verify',
  'stop-a',
  'start-a',
] as const;
export type DemoAction = (typeof demoActions)[number];

/** Local synthetic harness. It has no approval or enforcement grant. */
export class Demo {
  private timer?: ReturnType<typeof setInterval>;
  private pending = false;
  private busy = false;
  private until = 0;
  private normal: Record<string, number> = {};
  private last: unknown = null;
  private scenario: {
    id: string;
    startedAt: number;
    epoch?: string;
    afterSequence?: number;
  } | null = null;
  constructor(
    private backend: (action: 'stop-a' | 'start-a') => Promise<void>,
    private port = 8180,
  ) {}
  state() {
    return {
      enabled: true,
      running: !!this.timer,
      busy: this.busy,
      until: this.until,
      normal: this.normal,
      last: this.last,
      scenario: this.scenario,
    };
  }
  private startTraffic() {
    if (this.timer) return;
    this.until = Date.now() + 300000;
    this.normal = {};
    this.timer = setInterval(async () => {
      if (Date.now() >= this.until) return this.close();
      if (this.pending) return;
      this.pending = true;
      try {
        const status = String(await this.request('127.0.0.1'));
        this.normal[status] = (this.normal[status] || 0) + 1;
      } finally {
        this.pending = false;
      }
    }, 500);
  }
  private async burst() {
    const responses: Record<string, number> = {};
    const deadline = Date.now() + 10000;
    for (let i = 0; i < 80 && Date.now() < deadline; i++) {
      const code = String(await this.request('127.0.0.2'));
      responses[code] = (responses[code] || 0) + 1;
      if (code === '0') break;
    }
    return {
      source: '127.0.0.2',
      requests: Object.values(responses).reduce((sum, n) => sum + n, 0),
      responses,
    };
  }
  private request(source: string): Promise<number> {
    return new Promise((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${this.port}/`,
        { localAddress: source, timeout: 4000, headers: { 'X-Aegis-Demo': 'synthetic' } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode || 0));
          res.on('error', () => resolve(0));
        },
      );
      req.on('error', () => resolve(0));
      req.on('timeout', () => req.destroy());
    });
  }
  async run(action: DemoAction, boundary?: { epoch: string; afterSequence: number }) {
    if (!demoActions.includes(action)) throw new Error('Unknown demo action');
    if (this.busy) throw new Error('A demo action is already running');
    this.busy = true;
    try {
      if (action === 'scenario') {
        if (this.scenario && Date.now() - this.scenario.startedAt < 31000)
          throw new Error(
            'Wait 31 seconds between scenarios so the detector can open a fresh incident.',
          );
        const previous = this.scenario;
        this.scenario = { id: crypto.randomUUID(), startedAt: Date.now(), ...boundary };
        this.startTraffic();
        const normalStatus = await this.request('127.0.0.1');
        if (normalStatus < 200 || normalStatus >= 400) {
          this.scenario = previous;
          this.close();
          throw new Error(
            'Normal traffic cannot reach a healthy backend. Wait for the stack to be ready.',
          );
        }
        this.last = {
          action,
          normalStatus,
          ...(await this.burst()),
          message:
            'Synthetic HTTP abuse scenario sent. The live investigator will assess the detection.',
        };
      } else if (action === 'traffic') {
        this.startTraffic();
        this.last = { action, message: 'Normal synthetic traffic started for up to five minutes.' };
      } else if (action === 'stop-traffic') {
        this.close();
        this.last = { action, message: 'Normal traffic stopped.' };
      } else if (action === 'burst') {
        this.last = { action, ...(await this.burst()) };
      } else if (action === 'verify') {
        this.last = {
          action,
          targetStatus: await this.request('127.0.0.2'),
          normalStatus: await this.request('127.0.0.1'),
          message: 'Actual requests sent. The response view reports verification.',
        };
      } else {
        await this.backend(action);
        this.last = {
          action,
          message:
            action === 'stop-a'
              ? 'Backend A stopped. Watch the health checks.'
              : 'Backend A started. Wait for healthy checks.',
        };
      }
    } finally {
      this.busy = false;
    }
    return this.state();
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
