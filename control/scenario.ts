import type { Incident } from './types.js';

/** Match monotonic proxy sequence numbers; event timestamps only have second precision. */
export function isScenarioIncident(
  incident: Incident,
  scenario: { epoch?: string; afterSequence?: number } | null | undefined,
  currentEpoch: string | undefined,
) {
  return (
    !!scenario &&
    incident.kind === 'security' &&
    incident.source === '127.0.0.2' &&
    incident.proxyEpoch === currentEpoch &&
    incident.proxyEpoch === scenario.epoch &&
    Number(incident.eventId.split(':').at(-1)) > (scenario.afterSequence ?? Infinity)
  );
}
