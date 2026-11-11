# Agent workflow, provider configuration, and approval

The application runs one investigator in a separate Node process. Coordination is a fixed bounded application loop; the model chooses which allowed tools to request, can revise its plan, and chooses whether a response is justified. There are no nominal specialist agents, hidden shell tools, or production mock responses.

## Live inference

Run `npm run setup`, then set `OPENROUTER_API_KEY` in the ignored `.env`. `OPENROUTER_MODEL` is an explicit provider/model ID; the default is `openai/gpt-4.1-mini`. Select a model supporting the requested strict JSON Schema response format. Restart the local stack after changing configuration.

The adapter calls the fixed OpenRouter HTTPS endpoint, rejects redirects, caps response bytes, records public request/model identifiers and usage, and locally validates every decision with AJV. A missing key, refused request, malformed decision, missing response identity, truncation, timeout, unauthorized tool, or invented citation stops the investigation. Private reasoning fields are never persisted.

An investigation has at most six decision turns, twelve tool requests, eight HTTP inference attempts, a 20-second per-attempt deadline, and an overall bounded job lifetime. Transient HTTP errors receive at most one retry per decision. These are execution limits, not a dollar budget; configure provider-side spending controls separately.

## Bounded tools

| Tool | Actual evidence | Boundaries |
| --- | --- | --- |
| `recent_events` | Retained events for the incident source or backend | 1–100 requested records; no arbitrary query or URL |
| `metrics` | Proxy-lifetime counters and a bounded source sample | Sample counts are explicitly not a complete traffic history |
| `backend_health` | Current configured backend health and routing selections | Read only |
| `active_rules` | Current temporary rules, rate limits, epoch and revision | Read only |

All tools require fresh proxy telemetry. Tool output receives a durable evidence reference. A final finding contains observations with citations, alternative explanations, uncertainty, and a recommendation. The agent may finish without proposing an action. An action proposal requires at least one actual tool result and must cite the incident detection. A model verdict alone never changes proxy state.

## Approval and outcome review

The operator sees the exact source, duration, expected impact, evidence, and proposal hash. Opening the approval dialog does nothing to enforcement. The explicit authenticated approval consumes that proposal; the broker records intent before calling the private proxy API. Changed content, a consumed decision, a different epoch/revision, or an expired review window is rejected.

The deterministic verifier first checks installation, then looks for post-action HTTP 403 evidence from the target and successful traffic from a different client. Missing traffic yields an inconclusive result. Verification evidence is retained even after it leaves the recent-event view. A separate job asks the same investigator to review the actual verification results; it cannot propose another action during that review. Model commentary does not replace or override the deterministic outcome.

## Provider outage and test fixtures

With no key or a failed provider, the UI explicitly shows no live finding. The operator can inspect deterministic evidence and create a **manual operator proposal**, followed by the same separate approval process. This is a real local fallback, not simulated model output.

Automated tests inject a provider/decision fixture and label its results `fixture`; they do not establish live model behavior or quality. The browser acceptance script uses the actual running APIs and synthetic traffic, and does not supply a fake model result or execute an approval. Live provider success has not been claimed merely because adapter fixtures pass.
