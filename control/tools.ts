import { Store } from './store.js';
import type { Incident, Snapshot, ToolRequest } from './types.js';
import { hash } from './security.js';

export function investigateTool(store: Store, incident: Incident, request: ToolRequest): unknown {
  if (
    ![
      'recent_events',
      'metrics',
      'backend_health',
      'active_rules',
      'compare_sources',
      'containment_preview',
    ].includes(request.tool)
  )
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
  if (incident.proxyEpoch && incident.proxyEpoch !== snapshot.epoch)
    throw new Error('Incident belongs to a previous proxy lifetime');
  const id =
    'tool:' +
    hash({
      epoch: snapshot.epoch,
      sequence: snapshot.sequence,
      tool: request.tool,
      limit: args.limit,
      incidentId: incident.id,
    });
  const current = store.events(500).filter((event) => event.epoch === snapshot.epoch);
  const events = current
    .filter((event) =>
      incident.source ? event.source === incident.source : event.backend === incident.backend,
    )
    .slice(0, Number(args.limit));
  switch (request.tool) {
    case 'compare_sources': {
      const sample = current
        .filter((event) => event.type === 'request.completed')
        .slice(0, Number(args.limit));
      const summarize = (items: typeof sample) => ({
        requests: items.length,
        successful: items.filter(
          (event) => Number(event.status) >= 200 && Number(event.status) < 400,
        ).length,
        limited: items.filter((event) => event.status === 429).length,
        denied: items.filter((event) => event.status === 403).length,
        evidence: items.slice(0, 4),
      });
      return {
        id,
        observedAt: snapshot.observedAt,
        source: incident.source ?? null,
        target: summarize(sample.filter((event) => event.source === incident.source)),
        otherClients: summarize(sample.filter((event) => event.source !== incident.source)),
        sampleSize: sample.length,
        note: 'Bounded current-lifetime sample, newest first. Missing traffic is unknown, not proof of safety. Rate-limit violations alone do not prove malicious intent or a DDoS attack.',
      };
    }
    case 'containment_preview': {
      if (incident.kind !== 'security' || !incident.source)
        throw new Error('Containment preview requires a security source');
      const sample = current
        .filter((event) => event.type === 'request.completed')
        .slice(0, Number(args.limit));
      return {
        id,
        observedAt: snapshot.observedAt,
        source: incident.source,
        target: incident.source + '/32',
        action: 'temporary_source_deny',
        ttlRangeSeconds: [60, 600],
        affectedSampleRequests: sample.filter((event) => event.source === incident.source).length,
        otherSampleRequests: sample.filter((event) => event.source !== incident.source).length,
        existingRule: snapshot.rules.find((rule) => rule.source === incident.source) ?? null,
        healthyBackends: snapshot.backends
          .filter((backend) => backend.healthy)
          .map((backend) => backend.id),
        version: { epoch: snapshot.epoch, revision: snapshot.revision },
        approvalRequired: true,
        caveat:
          'Every user sharing this source IP would be blocked. Identity and intent are unknown. Preview only: no rule was installed; other clients retain their existing controls.',
      };
    }
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
