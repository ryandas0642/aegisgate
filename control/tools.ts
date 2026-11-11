import { Store } from './store.js';
import type { Incident, Snapshot, ToolRequest } from './types.js';
import { hash } from './security.js';

export function investigateTool(store: Store, incident: Incident, request: ToolRequest): unknown {
  if (!['recent_events', 'metrics', 'backend_health', 'active_rules'].includes(request.tool))
    throw new Error('Tool not granted to the investigator');
  const args = request.arguments;
  if (
    !args ||
    Object.keys(args).length !== 1 ||
    !Number.isInteger(args.limit) ||
    Number(args.limit) < 1 ||
    Number(args.limit) > 100
  )
    throw new Error('Malformed or unbounded tool arguments');
  const snapshot = store.get<Snapshot>('snapshot');
  const connection = store.get<{ online: boolean; receivedAt: number }>('connection');
  if (!snapshot || !connection?.online || Date.now() - connection.receivedAt > 3000)
    throw new Error('Proxy evidence is unavailable or stale');
  const id =
    'tool:' +
    hash({
      epoch: snapshot.epoch,
      sequence: snapshot.sequence,
      tool: request.tool,
      limit: args.limit,
      incidentId: incident.id,
    });
  const events = store
    .events(500)
    .filter((event) =>
      incident.source ? event.source === incident.source : event.backend === incident.backend,
    )
    .slice(0, Number(args.limit));
  switch (request.tool) {
    case 'recent_events':
      return { id, observedAt: snapshot.observedAt, evidence: events };
    case 'metrics':
      return {
        id,
        observedAt: snapshot.observedAt,
        counters: snapshot.metrics,
        sourceSample: {
          source: incident.source ?? null,
          sampleSize: events.filter((e) => e.type === 'request.completed').length,
          denied: events.filter((e) => e.status === 403).length,
          limited: events.filter((e) => e.status === 429).length,
        },
        note: 'Counters are lifetime totals; source figures describe only the bounded retained sample.',
      };
    case 'backend_health':
      return { id, observedAt: snapshot.observedAt, backends: snapshot.backends };
    case 'active_rules':
      return {
        id,
        observedAt: snapshot.observedAt,
        rules: snapshot.rules,
        limits: snapshot.limits,
        version: { epoch: snapshot.epoch, revision: snapshot.revision },
      };
  }
}
