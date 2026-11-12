# Repeatable local demonstration

## Guided cyber demo: stay on one screen

Run `npm run demo` (or double-click `Demo.cmd` on Windows), open http://127.0.0.1:4174, and sign in. **Cyber demo** is the opening screen. Restart an older running stack once to load the new server controls.

1. Click **Start cyber demo**. Normal traffic and a bounded burst start together. The page follows the exact new detection using proxy sequence numbers.
2. Watch the live plan and completed tools. The agent compares source behavior, checks containment scope, and returns a finding. This can take a few seconds or longer, depending on the provider.
3. Read its proposal, check the consent box, and click **Approve containment**. The source, duration, impact, evidence, and exact proposal fingerprint are shown on the same page.
4. Stay on the page. Test requests run automatically after approval. **HTTP 403 observed** plus **Success observed** establish target denial and successful normal traffic. The agent then reviews those actual results.

The scenario explicitly asks for a synthetic containment exercise, not a verdict that the client is malicious. The agent may decline a proposal if the evidence or current state does not support it. If live inference fails, **Create manual fallback · 60 seconds** creates an explicitly human-authored proposal; it still needs consent and approval. Retry live investigation is also available. Neither path fabricates a model result.

For another run, finish any pending review, wait for the temporary block to expire, and allow at least 31 seconds between starts. Normal traffic runs for up to five minutes. **Demo controls and interview talking points** contains **Stop demo traffic** and the optional Backend A stop/restart buttons.

The harness operates only through the native launcher. Standalone or container consoles show the controls as unavailable. Demo controls require the operator session and CSRF token; the investigator cannot use them. They never approve a security response or clear audit history.

The command-line walkthrough below remains available for inspecting individual steps.

Use synthetic data only. Start the stack as described in the README, sign into the console, and wait for both backends to become healthy. The proxy is at `http://127.0.0.1:8180`; the console is at `http://127.0.0.1:4174`.

## Security scenario

1. In another terminal run `npm run demo:traffic`. This sends normal traffic from `127.0.0.1` for one minute. The summary explicitly identifies synthetic requests and actual response counts.
2. Run `npm run demo:traffic -- --mode burst`. This sends 80 bounded requests from the designated `127.0.0.2` test client. Observe actual 429 responses and a deterministic detection.
3. Open Incidents → Investigation. With a configured provider, inspect the actual plan, selected tool calls, evidence references, alternatives, and uncertainty. No tool call is relabeled as a model finding.
4. If the provider is unavailable, inspect the unavailable record, open Response center, and choose **Create manual proposal**. Its source is fixed to the incident; select a duration and supply an evidence-based rationale. The proposal remains explicitly manual.
5. Review the proposal target, duration, impact, evidence and fingerprint. Open **Review & approve**, check the consent box, then explicitly approve. Review within two minutes; stale proposals require fresh review. Do not leave the scenario pending for more than five minutes because stale incident evidence cannot support a new action.
6. Repeat the burst and send normal traffic again. The target should receive 403 while the normal client still reaches a backend. The verifier remains inconclusive until it observes both after the action.
7. Inspect the enforcement acknowledgement, verification evidence, optional agent review, and audit chain. Wait for expiry and send a new target request; the rule must disappear and routing resume. An application restart does not silently reapprove old proposals.

IP identity comes from the socket. Changing X-Forwarded-For cannot impersonate the designated test client. Native loopback alias support can vary by host; the container scenario supplies distinct network addresses explicitly.

## Reliability scenario

Keep normal traffic running. In the terminal running `npm run dev`, type `stop a`, then press Enter. After the configured failed checks, Backend A becomes unavailable and new requests route to Backend B. The incident's investigation explains actual health evidence. Type `start a` to restore it; configured successful checks return it to routing. Automatic health routing is distinct from an approved security action.

To exercise no-healthy-backend behavior, stop both and observe HTTP 503, then restart both. Use the CLI commands only in the demo launcher, not as model tools.

## Container equivalents

```sh
npm run setup
docker compose up --build -d
docker compose --profile demo up -d normal
docker compose --profile demo up --force-recreate burst
docker compose stop backend-a
docker compose start backend-a
```

For post-action verification, recreate `normal` and `burst` so both sources produce new evidence. The Compose client services have fixed addresses; use `up`, not an unverified one-off client with an unknown address. Client addresses are `172.30.0.10` and `.11`.

`docker compose down` stops the demonstration while retaining the audit volume. Removing that volume deletes history; do so only when you intend that cleanup. The current validation report states whether an actual container run was executed on the development host.

## Interview walkthrough

Explain the peer-IP trust model, bounded HTTP contract, lack of automatic POST retries, deterministic routing, model tool choices, evidence freshness, exact approval hash, proxy-side version check, monotonic TTL, uncertain acknowledgements, and the difference between installed and behaviorally verified actions. Avoid claiming production security guarantees, live inference during a fixture run, or simulated capacity as real autoscaling.
