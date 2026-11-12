import { useEffect, useRef, useState } from 'react';
import { api, time, type ConsoleState } from './api';
import type { Demo } from '../control/demo';
import { isScenarioIncident } from '../control/scenario';
import { Badge, Icon, Panel } from './primitives';
import { EvidenceButton } from './investigation';

const tools: Record<string, string> = {
  recent_events: 'Read the source event timeline',
  metrics: 'Inspect traffic counters',
  backend_health: 'Check service availability',
  active_rules: 'Inspect existing blocks',
  compare_sources: 'Compare suspicious and normal clients',
  containment_preview: 'Check containment scope and collateral impact',
};
type DemoState = ReturnType<Demo['state']>;

export function CyberDemo({
  state,
  refresh,
}: {
  state: ConsoleState;
  refresh: () => Promise<void>;
}) {
  const [demo, setDemo] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [approvedHash, setApprovedHash] = useState('');
  const probes = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    const poll = () =>
      api<DemoState>('/api/demo')
        .then((value) => {
          if (active) setDemo(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const incident =
    demo?.scenario &&
    state.incidents.find((item) => isScenarioIncident(item, demo.scenario, state.snapshot?.epoch));
  const proposal =
    incident && state.proposals.find((item) => item.content.incidentId === incident.id);
  const trace = incident
    ? state.audit
        .filter(
          (row) => row.payload.incidentId === incident.id && row.type.startsWith('investigation.'),
        )
        .slice()
        .reverse()
    : [];
  const decisions = trace.filter((row) => row.type === 'investigation.agent.decision');
  const plan = decisions.at(-1)?.payload.data?.decision?.plan as string[] | undefined;
  const activity = trace.filter((row) =>
    [
      'investigation.tool.completed',
      'investigation.agent.decision',
      'investigation.completed',
      'investigation.unavailable',
    ].includes(row.type),
  );
  const reviewed = proposal?.verification?.modelReview as
    | { finding?: { summary: string }; mode?: string }
    | undefined;
  const verified =
    !!proposal?.verification?.deniedEvidence && !!proposal?.verification?.controlTrafficEvidence;
  const online = state.connection.online && Date.now() - (state.connection.receivedAt ?? 0) < 3000;
  const ready = online && state.snapshot?.backends.some((backend) => backend.healthy);
  const disabled = busy || !!demo?.busy || !demo?.enabled;
  const waiting = !!incident && ['detected', 'investigating'].includes(incident.status);
  const contained = state.snapshot?.rules.some((rule) => rule.source === '127.0.0.2');
  const pending = !!proposal && ['proposed', 'executing', 'uncertain'].includes(proposal.status);
  const coolingDown = !!demo?.scenario && Date.now() - demo.scenario.startedAt < 31000;
  const run = async (action: string) => {
    setBusy(true);
    setError('');
    try {
      setDemo(await api('/api/demo', { action }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, input: unknown) => {
    setBusy(true);
    setError('');
    try {
      await api(path, input);
      setApprovedHash('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Verification is traffic generation only; the broker determines success from proxy evidence.
  useEffect(() => {
    if (
      !demo?.enabled ||
      !proposal ||
      !['applied', 'inconclusive', 'uncertain'].includes(proposal.status) ||
      probes.current.has(proposal.id)
    )
      return;
    probes.current.add(proposal.id);
    void api('/api/demo', { action: 'verify' })
      .then(refresh)
      .catch((e) => {
        probes.current.delete(proposal.id);
        setError('Automatic check could not run: ' + e.message);
      });
  }, [proposal?.id, proposal?.status, demo?.enabled]);
  return (
    <div className="cyber-demo">
      <section className="cyber-intro">
        <div>
          <span className="eyebrow">HTTP ABUSE INVESTIGATION & CONTAINMENT</span>
          <h2>One suspicious source. One reviewed response.</h2>
          <p>
            Send a local test burst. Watch the AI gather evidence, compare clients, and assess a
            temporary block. You decide whether to apply it.
          </p>
          <div className="cyber-status">
            <Badge tone={ready ? 'green' : 'amber'}>
              {ready ? 'Protected service ready' : 'Waiting for a healthy service'}
            </Badge>
            <Badge tone={state.provider.configured ? 'cyan' : 'amber'}>
              {state.provider.configured
                ? `Live AI configured · ${state.provider.model}`
                : 'Live AI not configured'}
            </Badge>
            <Badge tone="muted">Local synthetic traffic</Badge>
          </div>
        </div>
        <button
          className="button primary"
          disabled={disabled || !ready || waiting || contained || pending || coolingDown}
          onClick={() => void run('scenario')}
        >
          <Icon name="shield" size={18} />
          {busy ? 'Working…' : demo?.scenario ? 'Run another scenario' : 'Start cyber demo'}
        </button>
      </section>
      {!demo?.enabled && (
        <p className="notice">Launch with npm run demo or Demo.cmd to enable the local scenario.</p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <ol className="cyber-stages">
        {[
          [
            'Detect',
            incident ? 'Source threshold crossed' : 'Waiting for test traffic',
            !!incident,
          ],
          [
            'Investigate',
            incident?.finding
              ? 'AI assessment returned'
              : incident?.status === 'unavailable'
                ? 'AI unavailable'
                : incident
                  ? 'AI gathering evidence'
                  : 'Waiting for detection',
            !!incident?.finding,
          ],
          [
            'Contain',
            proposal
              ? proposal.status === 'proposed'
                ? 'Your approval required'
                : `Response: ${proposal.status}`
              : 'No block proposed',
            !!proposal?.approvedBy,
          ],
          [
            'Verify',
            verified ? 'Target denied · normal client served' : 'Checks run after approval',
            verified,
          ],
        ].map(([title, detail, done], index) => (
          <li className={done ? 'complete' : ''} key={String(title)}>
            <span>{done ? <Icon name="check" size={15} /> : index + 1}</span>
            <div>
              <strong>{title}</strong>
              <small>{detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="cyber-columns">
        <div>
          <Panel
            title="Watch the investigation"
            eyebrow="ACTUAL AGENT ACTIVITY"
            action={
              <Badge tone="cyan">
                {decisions.length} decisions ·{' '}
                {trace.filter((row) => row.type === 'investigation.tool.completed').length} tool
                results
              </Badge>
            }
          >
            <div className="detail-body">
              {plan ? (
                <ol className="cyber-plan">
                  {plan.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              ) : (
                <p>
                  {incident
                    ? 'The investigator is preparing its first evidence query.'
                    : 'Start the demo. The agent’s plan and completed tool calls will appear here.'}
                </p>
              )}
              <div className="cyber-activity" aria-live="polite">
                {activity.map((row) => (
                  <div key={row.id}>
                    <Icon name={row.type.includes('tool') ? 'terminal' : 'agent'} size={16} />
                    <div>
                      <strong>
                        {row.type === 'investigation.tool.completed'
                          ? tools[row.payload.data?.request?.tool] || 'Evidence tool completed'
                          : row.type === 'investigation.agent.decision'
                            ? row.payload.data?.decision?.requests?.length
                              ? 'AI chose its next evidence checks'
                              : 'AI returned an assessment'
                            : row.type === 'investigation.unavailable'
                              ? 'Live investigation unavailable'
                              : row.payload.phase === 'verification'
                                ? 'AI reviewed the containment outcome'
                                : 'Investigation completed'}
                      </strong>
                      <small>
                        {time(row.time)} ·{' '}
                        {row.payload.phase === 'verification'
                          ? 'Post-response review'
                          : 'Investigation'}
                      </small>
                      {row.type === 'investigation.tool.completed' && (
                        <details>
                          <summary>Inspect returned evidence</summary>
                          <pre>{JSON.stringify(row.payload.data?.result, null, 2)}</pre>
                        </details>
                      )}
                      {row.type === 'investigation.unavailable' && <p>{row.payload.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {incident && (
                <details>
                  <summary>Detection evidence</summary>
                  <EvidenceButton id={incident.eventId} />
                </details>
              )}
              {incident &&
                ['unavailable', 'investigated'].includes(incident.status) &&
                !proposal && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void mutate(`/api/incidents/${incident.id}/investigate`, {})}
                  >
                    Retry live investigation
                  </button>
                )}
            </div>
          </Panel>
          {incident?.finding && (
            <Panel title="What the AI found" eyebrow="EVIDENCE-BASED ASSESSMENT">
              <div className="detail-body">
                <p className="finding-summary">{incident.finding.summary}</p>
                {incident.finding.observations.map((observation, index) => (
                  <div className="observation" key={index}>
                    <p>{observation.text}</p>
                    {observation.evidenceIds.map((id) => (
                      <EvidenceButton key={id} id={id} />
                    ))}
                  </div>
                ))}
                <h3>What remains uncertain</h3>
                <p>{incident.finding.uncertainty}</p>
                <details>
                  <summary>Alternative explanations</summary>
                  <ul>
                    {incident.finding.alternatives.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </details>
                <p>{incident.finding.recommendation}</p>
              </div>
            </Panel>
          )}
        </div>
        <div>
          <Panel title="Your containment decision" eyebrow="HUMAN APPROVAL">
            <div className="detail-body">
              {proposal ? (
                <>
                  <Badge tone={proposal.mode === 'live' ? 'cyan' : 'amber'}>
                    {proposal.mode === 'live'
                      ? 'Live AI proposal'
                      : proposal.mode === 'fixture'
                        ? 'TEST FIXTURE proposal'
                        : 'Manual operator proposal'}
                  </Badge>
                  <h3>
                    Block {proposal.content.source}/32 for {proposal.content.ttlSeconds} seconds
                  </h3>
                  <p>{proposal.content.rationale}</p>
                  <p>{proposal.content.expectedImpact}</p>
                  <p>
                    Every user sharing this source IP is affected. The block expires automatically.
                  </p>
                  <details>
                    <summary>Exact proposal and evidence</summary>
                    <code className="cyber-hash">{proposal.hash}</code>
                    {proposal.content.evidenceIds.map((id) => (
                      <EvidenceButton key={id} id={id} />
                    ))}
                  </details>
                  {proposal.status === 'proposed' ? (
                    <>
                      <label className="consent">
                        <input
                          type="checkbox"
                          checked={approvedHash === proposal.hash}
                          onChange={(e) => setApprovedHash(e.target.checked ? proposal.hash : '')}
                        />
                        <span>
                          I reviewed the source, evidence, duration, and impact. I approve this
                          temporary block.
                        </span>
                      </label>
                      <button
                        className="button primary"
                        disabled={
                          busy ||
                          !online ||
                          approvedHash !== proposal.hash ||
                          proposal.approvalDeadline < Date.now()
                        }
                        onClick={() =>
                          void mutate(`/api/proposals/${proposal.id}/approve`, {
                            hash: proposal.hash,
                          })
                        }
                      >
                        <Icon name="lock" size={16} />
                        Approve containment
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void mutate(`/api/proposals/${proposal.id}/reject`, {
                            hash: proposal.hash,
                          })
                        }
                      >
                        Reject
                      </button>
                      <small className="cyber-deadline">
                        {proposal.approvalDeadline > Date.now()
                          ? `Review within ${Math.ceil((proposal.approvalDeadline - Date.now()) / 1000)} seconds`
                          : 'Review window expired. Run a fresh scenario.'}
                      </small>
                    </>
                  ) : (
                    <Badge tone={verified ? 'green' : 'muted'}>{proposal.status}</Badge>
                  )}
                </>
              ) : (
                <>
                  <p>
                    {incident?.finding
                      ? 'The AI has not proposed a block. Review its recommendation; containment is optional.'
                      : 'The AI can recommend a short block for the exact source. Nothing is applied until you approve.'}
                  </p>
                  <p>
                    Rate limiting protects the service immediately while the investigation runs.
                  </p>
                  {incident?.status === 'unavailable' && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void mutate(`/api/incidents/${incident.id}/propose`, {
                          source: incident.source,
                          ttlSeconds: 60,
                          evidenceIds: [incident.eventId],
                          rationale:
                            'Manual demo containment based on actual source violation evidence. Live AI was unavailable; this is an operator decision.',
                          expectedImpact:
                            'Block only the synthetic test source for 60 seconds; all users sharing that source address would be affected.',
                        })
                      }
                    >
                      Create manual fallback · 60 seconds
                    </button>
                  )}
                </>
              )}
            </div>
          </Panel>
          <Panel title="Did containment work?" eyebrow="OBSERVED OUTCOME">
            <div className="detail-body">
              <div className="cyber-proof">
                <span>Suspicious client blocked</span>
                <Badge tone={proposal?.verification?.deniedEvidence ? 'green' : 'muted'}>
                  {proposal?.verification?.deniedEvidence
                    ? 'HTTP 403 observed'
                    : 'Not verified yet'}
                </Badge>
              </div>
              <div className="cyber-proof">
                <span>Normal client still served</span>
                <Badge tone={proposal?.verification?.controlTrafficEvidence ? 'green' : 'muted'}>
                  {proposal?.verification?.controlTrafficEvidence
                    ? 'Success observed'
                    : 'Not verified yet'}
                </Badge>
              </div>
              {proposal?.approvedBy && (
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => void run('verify')}
                >
                  Run checks again
                </button>
              )}
              {reviewed?.finding ? (
                <>
                  <h3>AI follow-up review</h3>
                  <p>{reviewed.finding.summary}</p>
                </>
              ) : (
                verified && (
                  <p>
                    The AI is reviewing the observed outcome. Containment success above comes from
                    proxy evidence.
                  </p>
                )
              )}
              {!!proposal?.verification?.expiryObserved && (
                <p>Automatic block expiration observed.</p>
              )}
              <p className="muted">
                A successful check shows a local containment outcome. It does not establish that the
                source was malicious.
              </p>
            </div>
          </Panel>
        </div>
      </div>
      <details className="cyber-extras">
        <summary>Demo controls and interview talking points</summary>
        <p>
          “This is a small security operations workflow for HTTP abuse. The agent investigates real
          proxy evidence and checks the impact of containment. I approve the response, and the
          system checks that the source is blocked while normal traffic still works.”
        </p>
        <p>
          Scope: source-based request abuse, temporary containment, evidence and audit. The current
          detector does not inspect payloads for SQL injection or establish a compromise.
        </p>
        <button
          className="button secondary"
          disabled={disabled}
          onClick={() => void run('stop-traffic')}
        >
          Stop demo traffic
        </button>
        <button className="button secondary" disabled={disabled} onClick={() => void run('stop-a')}>
          Stop backend A
        </button>
        <button
          className="button secondary"
          disabled={disabled}
          onClick={() => void run('start-a')}
        >
          Restart backend A
        </button>
        <p>
          Keep this page open for automatic post-approval checks. Normal traffic stops after five
          minutes. Between runs, finish any pending review, wait for the temporary block to expire,
          and allow at least 31 seconds between starts.
        </p>
      </details>
    </div>
  );
}
