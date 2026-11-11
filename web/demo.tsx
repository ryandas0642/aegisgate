import { useEffect, useState } from 'react';
import { api, type ConsoleState } from './api';
import { Badge, Icon } from './primitives';

export function DemoPanel({
  close,
  openIncident,
}: {
  close: () => void;
  openIncident: (id: string, response: boolean) => void;
}) {
  const [state, setState] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () =>
      api('/api/demo')
        .then((value) => {
          if (active) setState(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const run = async (action: string) => {
    setBusy(true);
    setError('');
    try {
      setState(await api('/api/demo', { action }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = async (response: boolean) => {
    try {
      const current = await api<ConsoleState>('/api/state');
      const incident = current.incidents.find(
        (i) => i.source === '127.0.0.2' && i.eventId.startsWith(current.snapshot?.epoch + ':'),
      );
      if (!incident) throw new Error('The incident is still arriving. Try again in a moment.');
      openIncident(incident.id, response);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const disabled = busy || !state?.enabled || state?.busy;
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal demo-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" aria-label="Close demo guide" onClick={close}>
          <Icon name="close" />
        </button>
        <span className="eyebrow">GUIDED LOCAL DEMO</span>
        <h2 id="demo-title">Run it from here.</h2>
        <p>These buttons send real synthetic traffic and control your local test backend.</p>
        {state && !state.enabled && (
          <div className="notice">
            Start the app with <code>npm run demo</code> to enable these controls.
          </div>
        )}
        <div className="demo-step">
          <strong>1. Show normal traffic</strong>
          <p>Watch requests reach both healthy backends.</p>
          <button
            className="button secondary"
            disabled={disabled || state?.running}
            onClick={() => run('traffic')}
          >
            {state?.running ? 'Normal traffic running' : 'Start normal traffic'}
          </button>
          {state?.running && (
            <button className="text-button" disabled={disabled} onClick={() => run('stop-traffic')}>
              Stop traffic
            </button>
          )}
        </div>
        <div className="demo-step">
          <strong>2. Create an incident</strong>
          <p>
            Send a controlled burst from the test client. Then inspect what the investigator finds.
          </p>
          <button className="button secondary" disabled={disabled} onClick={() => run('burst')}>
            Send traffic burst
          </button>
          <button className="text-button" disabled={busy} onClick={() => inspect(false)}>
            Review incident <Icon name="arrow" size={14} />
          </button>
        </div>
        <div className="demo-step">
          <strong>3. Review and approve</strong>
          <p>
            In Response center, review the proposed deny and approve it yourself. If the AI is
            unavailable, create a labeled manual proposal.
          </p>
        </div>
        <div className="demo-step">
          <strong>4. Check what changed</strong>
          <p>After approval, test the blocked client and a normal client.</p>
          <button className="button secondary" disabled={disabled} onClick={() => run('verify')}>
            Check response
          </button>
          <button className="text-button" disabled={busy} onClick={() => inspect(true)}>
            View response <Icon name="arrow" size={14} />
          </button>
        </div>
        <div className="demo-step">
          <strong>Try backend failover</strong>
          <p>Stop Backend A, watch traffic move to B, then bring A back.</p>
          <button className="button secondary" disabled={disabled} onClick={() => run('stop-a')}>
            Stop backend A
          </button>
          <button className="button secondary" disabled={disabled} onClick={() => run('start-a')}>
            Restart backend A
          </button>
        </div>
        {state?.last && (
          <div className="verification" aria-live="polite">
            <strong>Last demo result</strong>
            <p>{state.last.message}</p>
            {state.last.responses && (
              <p>
                {Object.entries(state.last.responses)
                  .map(
                    ([code, count]) =>
                      `${count} × HTTP ${code === '0' ? 'connection error' : code}`,
                  )
                  .join(' · ')}
              </p>
            )}
            {state.last.targetStatus !== undefined && (
              <p>
                Test client: HTTP {state.last.targetStatus || 'connection error'} · Normal client:
                HTTP {state.last.normalStatus || 'connection error'}
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Badge tone="cyan">Synthetic traffic · Explicit approval stays in your hands</Badge>
      </section>
    </div>
  );
}
