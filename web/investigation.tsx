import { useState } from 'react';
import type { Incident } from '../control/types';
import { api, short, statusText, time, type ConsoleState } from './api';
import { Badge, Empty, Icon, Panel } from './primitives';

export function IncidentSelect({
  state,
  selected,
  change,
}: {
  state: ConsoleState;
  selected: string;
  change: (value: string) => void;
}) {
  return (
    <div className="selection-bar">
      <label htmlFor="incident-select">Inspect an incident</label>
      <select
        id="incident-select"
        value={selected || state.incidents[0]?.id || ''}
        onChange={(e) => change(e.target.value)}
      >
        {state.incidents.map((i) => (
          <option key={i.id} value={i.id}>
            {i.kind === 'security' ? 'Source violations' : 'Backend health'} ·{' '}
            {i.source || i.backend} · {time(i.createdAt)} · {i.eventId.startsWith((state.snapshot?.epoch ?? '') + ':') ? 'Current' : 'Historical'}
          </option>
        ))}
      </select>
    </div>
  );
}
export function EvidenceButton({ id }: { id: string }) {
  const [evidence, setEvidence] = useState<unknown>(null),
    [error, setError] = useState('');
  return (
    <>
      <button
        className="evidence-chip"
        title={id}
        onClick={async () => {
          try {
            setError('');
            setEvidence(await api('/api/evidence/' + encodeURIComponent(id)));
          } catch {
            setError(
              'This evidence is retained in the investigation trace; expand its tool result below.',
            );
          }
        }}
      >
        {short(id, 23)}
      </button>
      {(evidence !== null || error) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setEvidence(null);
            setError('');
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Evidence record"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close evidence"
              onClick={() => {
                setEvidence(null);
                setError('');
              }}
            >
              <Icon name="close" />
            </button>
            <span className="eyebrow">ACTUAL EVIDENCE RECORD</span>
            <h2>Inspect the observation.</h2>
            <code>{id}</code>
            {error ? <p>{error}</p> : <pre>{JSON.stringify(evidence, null, 2)}</pre>}
          </section>
        </div>
      )}
    </>
  );
}
export function IncidentSummary({ incident }: { incident: Incident }) {
  return (
    <div className="selection-summary">
      <span className={`incident-symbol ${incident.kind}`}>
        <Icon name={incident.kind === 'security' ? 'shield' : 'server'} size={20} />
      </span>
      <div>
        <h2>
          {incident.kind === 'security' ? 'Source violation threshold' : 'Backend health degraded'}
        </h2>
        <p>
          <code>{incident.source || incident.backend}</code> · {time(incident.createdAt)} ·
          Deterministic detection
        </p>
      </div>
      <Badge tone="amber">{statusText(incident.status)}</Badge>
    </div>
  );
}
export function InvestigationView({
  state,
  selected,
  change,
  response,
  refresh,
}: {
  state: ConsoleState;
  selected: string;
  change: (id: string) => void;
  response: () => void;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const incident = state.incidents.find((i) => i.id === selected) || state.incidents[0];
  if (!incident)
    return (
      <Panel title="Investigation workspace">
        <Empty
          title="An investigation needs a real signal"
          detail="Send synthetic traffic or stop a demo backend. Its deterministic detection will open an investigation here."
          icon="agent"
        />
      </Panel>
    );
  const trace = state.audit.filter(
    (row) => row.type.startsWith('investigation.') && row.payload.incidentId === incident.id,
  );
  const plan = trace.find((row) => row.type === 'investigation.agent.decision')?.payload.data
    ?.decision?.plan as string[] | undefined;
  const finding = incident.finding;
  return (
    <>
      <IncidentSelect state={state} selected={incident.id} change={change} />
      <IncidentSummary incident={incident} />
      {error && <div className="notice error">{error}</div>}
      <div className="detail-layout">
        <div>
          <Panel
            title="Investigation finding"
            eyebrow="MODEL ASSESSMENT"
            action={
              <Badge tone={finding ? 'cyan' : 'muted'}>
                {finding
                  ? `${incident.mode === 'fixture' ? 'Test fixture' : 'Live model'} result`
                  : 'No model finding'}
              </Badge>
            }
          >
            <div className="detail-body">
              {finding ? (
                <>
                  <p className="finding-summary">{finding.summary}</p>
                  <h3>Observed evidence</h3>
                  {finding.observations.map((observation, index) => (
                    <div className="observation" key={index}>
                      <p>{observation.text}</p>
                      {observation.evidenceIds.map((id) => (
                        <EvidenceButton id={id} key={id} />
                      ))}
                    </div>
                  ))}
                  <h3>Alternative explanations</h3>
                  <ul className="alternatives">
                    {finding.alternatives.map((alternative, index) => (
                      <li key={index}>{alternative}</li>
                    ))}
                  </ul>
                  <h3>Uncertainty</h3>
                  <p>{finding.uncertainty}</p>
                  <h3>Recommendation</h3>
                  <p>{finding.recommendation}</p>
                  <button className="button secondary" onClick={response}>
                    Review responses
                    <Icon name="arrow" size={15} />
                  </button>
                </>
              ) : (
                <>
                  <Empty
                    title={
                      incident.status === 'investigating'
                        ? 'Investigator is gathering evidence'
                        : incident.status === 'unavailable'
                          ? 'Live investigation unavailable'
                          : 'Waiting for the investigator'
                    }
                    detail={
                      incident.status === 'unavailable'
                        ? 'The proxy and deterministic controls continue running. Configure the provider or use a clearly labeled manual response.'
                        : 'The agent will choose bounded evidence tools and return a finding with alternatives and uncertainty.'
                    }
                    icon="agent"
                  />
                  {incident.status !== 'investigating' && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(`/api/incidents/${incident.id}/investigate`, {});
                          await refresh();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Icon name="refresh" size={15} />
                      {busy ? 'Queuing…' : 'Retry live investigation'}
                    </button>
                  )}
                </>
              )}
            </div>
          </Panel>
          <Panel title="Actual model and tool activity" eyebrow="INSPECTABLE EXECUTION">
            <div className="trace">
              {trace.length ? (
                trace
                  .slice()
                  .reverse()
                  .map((row) => (
                    <details key={row.id}>
                      <summary>
                        <Icon name={row.type.includes('tool') ? 'terminal' : 'agent'} size={15} />
                        <span>{row.type.replace('investigation.', '').replaceAll('.', ' / ')}</span>
                        <Badge tone={row.payload.phase === 'verification' ? 'green' : 'muted'}>
                          {row.payload.phase || 'investigation'}
                        </Badge>
                        <time>{time(row.time)}</time>
                      </summary>
                      <pre>{JSON.stringify(row.payload.data || row.payload, null, 2)}</pre>
                    </details>
                  ))
              ) : (
                <Empty
                  title="No model or tool activity yet"
                  detail="Only actual calls and returned evidence appear in this trace."
                  icon="terminal"
                />
              )}
            </div>
          </Panel>
        </div>
        <div>
          <Panel title="Current investigation plan" eyebrow="AGENT-SELECTED STEPS">
            <div className="detail-body">
              {plan ? (
                <ol className="plan-list">
                  {plan.map((step, index) => (
                    <li key={index}>
                      <span>{index + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>The plan appears after the model returns its first decision.</p>
              )}
            </div>
          </Panel>
          <Panel title="Detection evidence" eyebrow="DETERMINISTIC OBSERVATION">
            <div className="detail-body">
              <p>
                {incident.kind === 'security'
                  ? 'The configured source-violation threshold was exceeded. This does not establish malicious intent.'
                  : 'Configured health checks failed. The proxy automatically changes routing independently of the agent.'}
              </p>
              <EvidenceButton id={incident.eventId} />
            </div>
          </Panel>
          <Panel title="Authority boundary">
            <div className="detail-body">
              <div className="control-list">
                <div>
                  <span className="control-check">
                    <Icon name="check" size={14} />
                  </span>
                  <span>Read scoped evidence</span>
                </div>
                <div>
                  <span className="control-check">
                    <Icon name="check" size={14} />
                  </span>
                  <span>Propose a bounded response</span>
                </div>
                <div>
                  <span className="control-check">
                    <Icon name="lock" size={14} />
                  </span>
                  <span>Human approval required</span>
                </div>
              </div>
              <p>
                The investigator cannot approve actions, execute commands, or access enforcement
                credentials.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
