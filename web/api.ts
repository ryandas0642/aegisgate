import type { Evidence, Incident, Proposal, Snapshot } from '../control/types';
export type Audit = { seq: number; id: string; time: string; type: string; payload: any; previous: string; digest: string };
export type ConsoleState = { snapshot: Snapshot | null; connection: { online: boolean; receivedAt?: number; error?: string }; incidents: Incident[]; proposals: Proposal[]; events: Evidence[]; audit: Audit[]; auditIntegrity: boolean; samples: { at: number; requests: number; denied: number; limited: number; errors: number }[]; provider: { name: string; model: string; configured: boolean; mode: string } };
let csrf = '';
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function api<T = any>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(path, input === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(input) });
  const value = await response.json();
  if (!response.ok) throw new ApiError(value.error || `HTTP ${response.status}`, response.status);
  if (typeof value?.csrf === 'string') csrf = value.csrf;
  return value;
}
export const time = (value: string | number | undefined) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
export const short = (value: string, count = 12) => value.length > count ? value.slice(0, count) + '…' : value;
export const statusText = (value: string) => ({ awaiting_approval: 'Needs review', unavailable: 'AI unavailable', proposed: 'Needs approval', investigating: 'Investigating', investigated: 'Investigated', inconclusive: 'Awaiting evidence', interrupted: 'Interrupted', stale: 'Stale proposal', uncertain: 'Reconciling', expired: 'Expired', executing: 'Applying', verified: 'Verified', applied: 'Applied', rejected: 'Rejected', detected: 'Detected' }[value] || value);
