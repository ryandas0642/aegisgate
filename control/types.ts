export type Evidence = {
  id: string;
  sequence: number;
  epoch: string;
  time: string;
  type: string;
  source?: string;
  backend?: string;
  status?: number;
  reason?: string;
  [key: string]: unknown;
};
export type Snapshot = {
  epoch: string;
  revision: number;
  sequence: number;
  oldestSequence: number;
  observedAt: string;
  metrics: {
    requests: number;
    forwarded: number;
    denied: number;
    limited: number;
    errors: number;
    connections: number;
  };
  limits: { ratePerSecond: number; burst: number; maxConnections: number };
  backends: {
    id: string;
    healthy: boolean;
    requests: number;
    failures: number;
    successes: number;
  }[];
  rules: { source: string; actionId: string; expiresAtMs: number }[];
  actions: {
    actionId: string;
    source: string;
    expiresAtMs: number;
    epoch: string;
    revision: number;
    status: 'applied';
  }[];
  events: Evidence[];
};
export type Incident = {
  exercise?: { kind: 'containment_validation'; source: string; requestedTtlSeconds: 60 };
  proxyEpoch?: string;
  phase?: 'verification';
  verification?: Record<string, unknown>;
  verificationEvidence?: Evidence[];
  id: string;
  eventId: string;
  kind: 'security' | 'reliability';
  source?: string;
  backend?: string;
  createdAt: string;
  status: string;
  finding?: Finding;
  mode?: string;
};
export type Finding = {
  summary: string;
  observations: { text: string; evidenceIds: string[] }[];
  alternatives: string[];
  uncertainty: string;
  recommendation: string;
};
export type ProposalContent = {
  incidentId: string;
  source: string;
  ttlSeconds: number;
  expectedEpoch: string;
  expectedRevision: number;
  evidenceIds: string[];
  rationale: string;
  expectedImpact: string;
};
export type Proposal = {
  id: string;
  hash: string;
  content: ProposalContent;
  status: string;
  createdAt: string;
  approvalDeadline: number;
  approvedBy?: string;
  execution?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  mode: string;
};
export type ToolRequest = { tool: string; arguments: Record<string, unknown> };
export type Decision = {
  plan: string[];
  requests: ToolRequest[];
  finding: Finding | null;
  proposal: {
    source: string;
    ttlSeconds: number;
    evidenceIds: string[];
    rationale: string;
    expectedImpact: string;
  } | null;
};
export type ModelReply = {
  decision: Decision;
  requestId: string;
  model: string;
  usage: unknown;
  mode: 'live' | 'fixture';
};
