import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, time, type ConsoleState } from './api';
import { Icon, Badge } from './primitives';
import { Overview, TrafficChart, BackendHealth, IncidentTable } from './overview';
import { Panel } from './primitives';
import { InvestigationView } from './investigation';
import { ResponseView } from './response';
import { AuditView } from './audit';

const navigation = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'traffic', label: 'Traffic & health', icon: 'traffic' },
  { id: 'incidents', label: 'Incidents', icon: 'incident' },
  { id: 'investigation', label: 'Investigation', icon: 'agent' },
  { id: 'response', label: 'Response center', icon: 'response' },
  { id: 'audit', label: 'Audit trail', icon: 'audit' },
];
export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [state, setState] = useState<ConsoleState | null>(null),
    [tab, setTab] = useState('overview');
  const [selected, setSelected] = useState(''),
    [demo, setDemo] = useState(false);
  useEffect(() => {
    if (!state) return;
    setSelected(current => state.incidents.some(incident => incident.id === current) ? current : state.incidents[0]?.id || '');
  }, [state]);
  useEffect(() => {
    api('/api/session')
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
  }, []);
  const refresh = async () => {
    try {
      setState(await api<ConsoleState>('/api/state'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthenticated(false);
      else setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!authenticated) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [authenticated]);
  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/login', { password });
      setPassword('');
      setAuthenticated(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (authenticated !== true)
    return (
      <main className="login">
        <div className="login-decoration" />
        <div className="login-card">
          <div className="brand large">
            <span className="brand-icon">
              <Icon name="shield" size={29} />
            </span>
            <span>
              AegisGate<small>SECURITY OPERATIONS</small>
            </span>
          </div>
          <span className="eyebrow">LOCAL OPERATOR ACCESS</span>
          <h1>Control with confidence.</h1>
          <p>Inspect real traffic. Investigate the evidence. Decide what happens next.</p>
          <form onSubmit={signIn}>
            <label htmlFor="password">Operator password</label>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your local operator password"
              required
            />
            <button className="button primary" disabled={busy || authenticated === null}>
              {busy
                ? 'Signing in…'
                : authenticated === null
                  ? 'Connecting…'
                  : 'Open operations console'}
              <Icon name="arrow" size={17} />
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="login-note">
            <Icon name="lock" size={15} />
            <span>
              Your password is in <code>.runtime/secrets.json</code> or your configured environment.
            </span>
          </div>
        </div>
        <div className="login-footer">
          AEGISGATE <span>Human-supervised security. Evidence at every step.</span>
        </div>
      </main>
    );
  const online =
    !!state?.connection.online && Date.now() - (state.connection.receivedAt ?? 0) < 3000;
  const pending = state?.proposals.filter((p) => p.status === 'proposed').length ?? 0;
  const choose = (id: string, next = 'investigation') => {
    setSelected(id);
    setTab(next);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Icon name="shield" size={26} />
          </span>
          <span>
            AegisGate<small>OPERATIONS CONSOLE</small>
          </span>
        </div>
        <div className="workspace">
          <span className="workspace-avatar">AG</span>
          <div>
            Local environment
            <small>
              <i className={online ? 'dot green' : 'dot amber'} />
              {online ? 'Proxy connected' : 'Awaiting proxy'}
            </small>
          </div>
          <Icon name="chevron" size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'nav-item active' : 'nav-item'}
              onClick={() => setTab(item.id)}
              title={item.label}
                aria-label={item.label}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.id === 'response' && pending > 0 && <b>{pending}</b>}
              {item.id === 'incidents' && !!state?.incidents.length && (
                <small>{state.incidents.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="supervision">
            <Icon name="lock" size={18} />
            <strong>Human in control</strong>
            <p>
              Models investigate.
              <br />
              You authorize responses.
            </p>
          </div>
          <button
            className="operator"
            onClick={async () => {
              await api('/api/logout', {});
              setAuthenticated(false);
              setState(null);
            }}
          >
            <span className="operator-avatar">OP</span>
            <span>
              Local operator<small>Authenticated session</small>
            </span>
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <Icon name="chevron" size={13} />
            <strong>{navigation.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment-tag">LOCAL</span>
            <span className="updated">Updated {time(state?.connection.receivedAt)}</span>
            <Badge tone={online ? 'green' : 'amber'} dot>
              {online ? 'Live telemetry' : 'Telemetry offline'}
            </Badge>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                AEGISGATE / {tab === 'overview' ? 'LIVE OPERATIONS' : tab.toUpperCase()}
              </div>
              <h1>
                {
                  (
                    {
                      overview: 'Your perimeter, in view.',
                      traffic: 'Every request has a route.',
                      incidents: 'Signals worth your attention.',
                      investigation: 'Follow the evidence.',
                      response: 'Your decision. Bounded action.',
                      audit: 'A record of every decision.',
                    } as Record<string, string>
                  )[tab]
                }
              </h1>
              <p>
                {
                  (
                    {
                      overview: 'Real traffic. Observable decisions. Human-supervised response.',
                      traffic: 'Routing distribution and backend health from the running proxy.',
                      incidents: 'Deterministic detections, with context before conclusions.',
                      investigation:
                        'Inspect the plan, tools, evidence, and uncertainty behind each finding.',
                      response: 'Review the exact target and impact before authorizing a change.',
                      audit:
                        'Detections, model activity, operator decisions, and verified outcomes.',
                    } as Record<string, string>
                  )[tab]
                }
              </p>
            </div>
            <button className="button secondary" onClick={() => setDemo(true)}>
              <Icon name="terminal" size={16} />
              Run a demo
            </button>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          {state && !online && <div className="notice"><span>Proxy telemetry is offline. Displayed values were last observed at {time(state.connection.receivedAt)}. Approvals require fresh proxy state.</span></div>}
          {state && tab === 'overview' && (
            <Overview state={state} navigate={setTab} choose={choose} />
          )}
          {state && tab === 'traffic' && (
            <>
              <div className="overview-grid">
                <Panel title="Observed request rates" eyebrow="LIVE PROXY COUNTERS">
                  <TrafficChart state={state} />
                </Panel>
                <Panel title="Backend routing" eyebrow="REAL HEALTH CHECKS">
                  <BackendHealth state={state} />
                </Panel>
              </div>
              <Panel title="Recent request outcomes" eyebrow="METADATA ONLY">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>TIME</th>
                        <th>SOURCE</th>
                        <th>BACKEND</th>
                        <th>STATUS</th>
                        <th>EVIDENCE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.events
                        .filter((e) => e.type === 'request.completed' && e.epoch === state.snapshot?.epoch)
                        .slice(0, 25)
                        .map((event) => (
                          <tr key={event.id}>
                            <td className="mono muted">{time(event.time)}</td>
                            <td>
                              <code>{event.source}</code>
                            </td>
                            <td>{event.backend || '—'}</td>
                            <td>
                              <Badge tone={Number(event.status) < 400 ? 'green' : 'amber'}>
                                {event.status}
                              </Badge>
                            </td>
                            <td>
                              <code title={event.id}>{event.id.slice(-14)}</code>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {state && tab === 'incidents' && (
            <Panel title="Detected incidents" eyebrow="RULE-BASED SIGNALS">
              <IncidentTable state={state} choose={choose} />
              <div className="panel-footnote">
                A threshold crossing establishes observed behavior; client intent remains unknown.
              </div>
            </Panel>
          )}
          {state && tab === 'investigation' && (
            <InvestigationView
              state={state}
              selected={selected}
              change={setSelected}
              response={() => setTab('response')}
              refresh={refresh}
            />
          )}
          {state && tab === 'response' && (
            <ResponseView
              state={state}
              selected={selected}
              change={setSelected}
              refresh={refresh}
            />
          )}
          {state && tab === 'audit' && <AuditView state={state} />}
          {!state && <div className="loading">Connecting to the operations control plane…</div>}
          <footer className="content-footer">
            <span>
              <Icon name="shield" size={13} /> AegisGate · Local development environment
            </span>
            <span>AI stays outside the forwarding path.</span>
          </footer>
        </main>
      </div>
      {demo && (
        <div className="modal-backdrop" onClick={() => setDemo(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close demo guide"
              onClick={() => setDemo(false)}
            >
              <Icon name="close" />
            </button>
            <span className="eyebrow">CONTROLLED, SYNTHETIC TRAFFIC</span>
            <h2 id="demo-title">See the full lifecycle.</h2>
            <p>
              Keep normal traffic running in one terminal. Send a bounded burst from the designated
              test client in another.
            </p>
            <label>01 / Normal traffic</label>
            <pre>npm run demo:traffic</pre>
            <label>02 / Controlled burst</label>
            <pre>npm run demo:traffic -- --mode burst</pre>
            <p>
              Inspect the incident and live investigation. If the model is unavailable, a manual
              proposal is explicitly labeled. Review and approve, then repeat both clients to
              collect verification evidence.
            </p>
            <label>03 / Backend failover</label>
            <pre>stop a{String.fromCharCode(10)}start a</pre>
            <p>
              Type these in the <code>npm run dev</code> terminal. With containers, use{' '}
              <code>docker compose stop backend-a</code> and{' '}
              <code>docker compose start backend-a</code>.
            </p>
            <Badge tone="cyan">No requests leave the local demo environment</Badge>
          </section>
        </div>
      )}
    </div>
  );
}
