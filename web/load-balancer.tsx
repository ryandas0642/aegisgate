import { useEffect, useRef, useState } from 'react';
import { api, type ConsoleState } from './api';
import { Badge, Icon, Panel } from './primitives';
import type { Evidence } from '../control/types';

type DemoStatus = { enabled: boolean; running?: boolean; busy?: boolean };
type Packet = { event: Evidence; expires: number };

export function LoadBalancer({ state }: { state: ConsoleState }) {
  const [demo, setDemo] = useState<DemoStatus>({ enabled: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [packets, setPackets] = useState<Packet[]>([]);
  const cursor = useRef({ epoch: '', sequence: 0 });
  const snapshot = state.snapshot;
  const online = state.connection.online && Date.now() - (state.connection.receivedAt ?? 0) < 3000;
  const backends = snapshot?.backends ?? [];
  const total = backends.reduce((sum, backend) => sum + backend.requests, 0);
  const height = Math.max(360, backends.length * 140 + 80),
    middle = height / 2 - 20;
  const backendY = (index: number) =>
    backends.length === 1 ? middle : 75 + (index * (height - 165)) / (backends.length - 1);
  const ingress = `M 180 ${middle} L 330 ${middle}`;
  const route = (index: number) =>
    `M 330 ${middle} L 470 ${middle} C 570 ${middle} 580 ${backendY(index)} 690 ${backendY(index)}`;
  const rejection = `M 330 ${middle} L 420 ${middle} L 420 ${height - 45}`;
  useEffect(() => {
    let active = true;
    const poll = () =>
      api<DemoStatus>('/api/demo')
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
  useEffect(() => {
    if (!snapshot) return;
    if (cursor.current.epoch !== snapshot.epoch) {
      cursor.current = { epoch: snapshot.epoch, sequence: snapshot.sequence };
      setPackets([]);
      return;
    }
    const previous = cursor.current.sequence;
    cursor.current.sequence = Math.max(previous, snapshot.sequence);
    if (!online) {
      setPackets([]);
      return;
    }
    const arrivals = state.events
      .filter(
        (event) =>
          event.epoch === snapshot.epoch &&
          event.sequence > previous &&
          event.type === 'request.completed' &&
          Date.now() - Date.parse(event.time) < 4000,
      )
      .slice(0, 12);
    if (arrivals.length)
      setPackets((current) =>
        [
          ...current.filter((packet) => packet.expires > Date.now()),
          ...arrivals.map((event) => ({ event, expires: Date.now() + 1400 })),
        ].slice(-24),
      );
  }, [snapshot?.epoch, snapshot?.sequence, online, state.events]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setPackets((current) =>
          current.length ? current.filter((packet) => packet.expires > Date.now()) : current,
        ),
      250,
    );
    return () => clearInterval(timer);
  }, []);
  const run = async (action: string) => {
    setBusy(true);
    setError('');
    try {
      setDemo(await api('/api/demo', { action }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || !!demo.busy || !demo.enabled || !online;
  return (
    <section className="load-balancer" aria-label="Load balancer visualizer">
      <Panel
        title="Load balancer visualizer"
        eyebrow="OBSERVED REQUEST ROUTING"
        action={
          <Badge tone={online ? 'green' : 'amber'} dot>
            {online ? 'Live proxy' : 'Telemetry offline'}
          </Badge>
        }
      >
        <div className="lb-controls">
          <button
            className="button primary"
            disabled={busy || !!demo.busy || !demo.enabled || (!online && !demo.running)}
            onClick={() => void run(demo.running ? 'stop-traffic' : 'traffic')}
          >
            <Icon name="traffic" size={15} />
            {demo.running ? 'Stop traffic' : 'Start normal traffic'}
          </button>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => void run('stop-a')}
          >
            Stop backend A
          </button>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => void run('start-a')}
          >
            Restart backend A
          </button>
          <span>Start traffic → stop A → watch B take over → restart A.</span>
        </div>
        {!demo.enabled && (
          <p className="lb-note">
            Start with npm run dev to use the local traffic and backend buttons.
          </p>
        )}
        {error && (
          <p className="lb-note error" role="alert">
            {error}
          </p>
        )}
        <div className="lb-diagram">
          <svg
            viewBox={`0 0 900 ${height}`}
            role="img"
            aria-label="Clients send requests through AegisGate to healthy backends. Rejected requests stop at the proxy."
          >
            <path d={ingress} className="lb-link" />
            {backends.map((backend, index) => (
              <path
                key={backend.id}
                d={route(index)}
                className={`lb-link ${online && backend.healthy ? 'lb-active' : 'lb-inactive'}`}
              />
            ))}
            <path d={rejection} className="lb-reject-link" />
            {packets.map(({ event }) => {
              const index = backends.findIndex((backend) => backend.id === event.backend);
              const destination = index >= 0 ? route(index) : rejection;
              return (
                <circle
                  key={event.id}
                  r="5"
                  fill={Number(event.status) < 400 ? '#49e4cf' : '#f0b966'}
                  className="lb-packet"
                  opacity="0"
                >
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    keyTimes="0;.05;.9;1"
                    dur="1.3s"
                    fill="freeze"
                  />
                  <animateMotion
                    path={`${ingress} ${destination.replace('M', 'L')}`}
                    dur="1.3s"
                    fill="freeze"
                  />
                  <title>
                    {event.source} → {event.backend ?? 'proxy rejection'} · HTTP {event.status}
                  </title>
                </circle>
              );
            })}
            <g className="lb-node">
              <rect x="25" y={middle - 43} width="155" height="86" rx="12" />
              <text x="102" y={middle - 8} textAnchor="middle" className="lb-node-title">
                HTTP clients
              </text>
              <text x="102" y={middle + 17} textAnchor="middle">
                Normal + test traffic
              </text>
            </g>
            <g className="lb-node lb-proxy">
              <rect x="330" y={middle - 53} width="140" height="106" rx="14" />
              <text x="400" y={middle - 15} textAnchor="middle" className="lb-node-title">
                AegisGate
              </text>
              <text x="400" y={middle + 9} textAnchor="middle">
                Rate limit · route
              </text>
              <text x="400" y={middle + 30} textAnchor="middle">
                Round robin
              </text>
            </g>
            {backends.map((backend, index) => (
              <g
                key={backend.id}
                className={`lb-node ${online && backend.healthy ? 'lb-healthy' : 'lb-down'}`}
                data-backend={backend.id}
                data-healthy={online ? String(backend.healthy) : 'unknown'}
              >
                <rect x="690" y={backendY(index) - 43} width="185" height="90" rx="12" />
                <circle cx="707" cy={backendY(index) - 21} r="4" />
                <text x="719" y={backendY(index) - 16} className="lb-node-title">
                  {backend.id}
                </text>
                <text x="707" y={backendY(index) + 7}>
                  {online
                    ? backend.healthy
                      ? 'Healthy · accepting traffic'
                      : backend.failures
                        ? 'Unavailable · removed from pool'
                        : 'Checking health'
                    : 'Last observed state'}
                </text>
                <text x="707" y={backendY(index) + 30}>
                  {backend.requests.toLocaleString()} selections ·{' '}
                  {total ? Math.round((backend.requests / total) * 100) : 0}%
                </text>
              </g>
            ))}
            {!backends.length && (
              <text x="710" y={middle} textAnchor="middle">
                Waiting for backend telemetry
              </text>
            )}
            <text x="420" y={height - 22} textAnchor="middle" className="lb-reject-label">
              {snapshot
                ? `${snapshot.metrics.limited} rate limited · ${snapshot.metrics.denied} denied`
                : 'Waiting for counters'}
            </text>
          </svg>
        </div>
        <div className="lb-legend">
          <span>
            <i className="dot cyan" />
            Forwarded request
          </span>
          <span>
            <i className="dot amber" />
            Rejected / failed request
          </span>
          <span>Dashed route: unavailable backend</span>
        </div>
        <div className="panel-footnote">
          Dots replay newly observed completed requests (up to 12 per update); they are not an
          in-flight packet capture. Counts and shares cover this proxy lifetime.{' '}
          {online
            ? 'Unhealthy backends leave the routing pool after health checks.'
            : 'Telemetry is stale; live animation is paused.'}
        </div>
      </Panel>
    </section>
  );
}
