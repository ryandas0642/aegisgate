# Threat model and operational limits

## Intended environment

A single trusted operator runs a synthetic local demonstration. Untrusted clients can reach only the data listener. The operator browser, host, configured backends, configuration files, and dependency distribution channels are trusted. Containers demonstrate network separation; they are not a sandbox for executing model-authored programs.

Considered threats include spoofed forwarding headers, malformed or oversized HTTP messages, repeated per-source requests, accidental overbroad responses, model-generated invalid arguments, approval replay, changed state, cross-origin operator requests, and model-provider failure. Compromised hosts/backends, malicious dependency maintainers, external network floods, botnets, and protection of an Internet-facing production deployment are outside the MVP.

## Deterministic controls

- IPv4 CIDR deny rules take precedence. If an allow list is nonempty, other sources are denied. The peer socket supplies identity.
- A per-client token bucket enforces the configured rate and burst. The proxy retains at most 4,096 client buckets and removes idle entries after five minutes. Saturated client tracking rejects new sources rather than growing without bound.
- Header/body limits, active connection caps, fixed upstream destinations, and deadlines constrain supported traffic. These do not establish resistance to distributed denial of service.
- Repeated denied/rate-limited requests create a deterministic incident after the configured threshold/window. A per-source 30-second incident cooldown reduces duplicate detections.
- Backend health thresholds control routing without model involvement.

These controls do not constitute a general firewall, WAF, SIEM, malware detector, or DDoS defense. A source violation is an observation, not proof of malicious intent. NAT can combine several users behind one address.

## Operator and investigator access

The local console uses a random configured password, HttpOnly/SameSite=Strict session cookies, a one-hour session lifetime, a bounded session collection, login throttling, Host/Origin checks, and CSRF tokens for operator mutations. These are local HTTP sessions; a remote deployment would require TLS, identity management, and a new security review.

The investigator has a separate token for incident-scoped read tools, sanitized activity records, findings, and proposals. That token cannot authenticate an operator approval. The proxy's management bearer token is separate and is not included in the investigator's environment or model context. OS permissions do not isolate hostile worker code from every host file; the model receives no file or command tool.

## Action catalog

Only `temporary_deny` is supported: one canonical IPv4 source (`/32`), 60–600 seconds, within configured eligibility, excluding protected sources and backend addresses. At most 64 temporary rules can exist. Native demo eligibility is `127.0.0.2/32`; container eligibility is `172.30.0.11/32`.

Evidence must include the incident detection and belong to its source. The detection must be from the current proxy lifetime and no more than five minutes old. The proposal contains target, duration, rationale, expected impact, evidence IDs, epoch, and revision. An exact-content SHA-256 fingerprint binds the operator approval. A two-minute review window, authenticated operator session, one-time approval consumption, and proxy-side version checks reject stale or altered requests.

The proxy uses a monotonic clock for expiration. A control-plane outage cannot extend the TTL. A proxy restart clears temporary controls and starts a new epoch; historical approvals cannot reinstall them. A missing acknowledgement remains uncertain until reconciliation. An explicit proxy refusal is a failed action.

## Privacy and audit

Proxy events deliberately omit request paths, query strings, bodies, cookies, authorization headers, and arbitrary client headers. They include source IP, timestamp, status, backend identifier, duration, and rule reasons. Use only synthetic traffic in portfolio captures. No production log collection or generalized secret-detection guarantee is claimed.

Model calls receive scoped structured telemetry and tool results. Authentication headers and private model reasoning fields are excluded from persisted records. A sanitization pass redacts common credential fields and token patterns; minimizing collected data is the primary protection.

SQLite retains events, proposals, decisions, and a hash-linked audit sequence. This detects accidental or partial record editing, not a malicious host owner who can rewrite the database and hashes. There is no external signing service, immutable storage, automatic archival, or retention policy yet. Keep `.env`, `.runtime`, `.deps`, databases, and generated logs out of Git and public artifacts.
