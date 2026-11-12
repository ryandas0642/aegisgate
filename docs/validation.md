# Executed validation

Recorded on **November 10, 2026 (America/Chicago)**. These are observations from local execution, not performance, model-quality, or production-readiness guarantees.

## Environments

- Windows native: Node.js 22.14.0, Python 3.12.5, MSYS2 GCC 15.1.0, pinned Boost 1.90.0.
- Linux proxy: Ubuntu 24.04 under WSL, GCC 13.3.0, the same Boost headers and source, real Python HTTP backend fixtures.
- Browser: installed Microsoft Edge through Playwright, desktop 1512×1060 and mobile viewport 390×844.

## Results

| Check | Observed result | Scope |
| --- | --- | --- |
| `python scripts/build_proxy.py --core` | Passed | Actual IPv4/CIDR assertions; malformed octets and extreme prefixes |
| `npm test` | **15 passed, 0 failed** | Agent tools/budgets, strict decisions, provider transport fixtures, authorization, approval tampering, stale evidence, reconciliation, verified-evidence retention, audit integrity |
| `python tests/proxy_integration.py` on Windows | **7 passed, 1 explicitly skipped** | Actual executable, sockets, two HTTP backends, routing, health removal/recovery, no healthy backends, upstream failures/deadlines, source/rate controls, malformed framing, request/response limits, connection caps, management authentication and action-version/idempotency guards |
| Same proxy integration suite on Ubuntu WSL | **8 passed, 0 failed** | Includes real POSIX SIGTERM draining of an in-flight request |
| `npm run test:e2e` | **1 passed** | Real proxy and traffic; explicit fixture-model tool selection; simulated authenticated operator decision; real enforcement and target/control verification; 60-second TTL expiry after stopping the control plane |
| Actual worker with missing provider key | Passed in E2E | Investigation becomes unavailable; forwarding still returns successful responses |
| `npm run build` | Passed | TypeScript checks, production React/Vite bundle, distributable dependency notices |
| `npm run build:runtime` | Passed | Compiled Node application and worker entry points |
| `npm run test:browser` | Passed | Actual sign-in, real synthetic detection, all views, stable incident selection, manual proposal creation, checkbox-disabled/enabled approval gate, cancellation/rejection without enforcement, responsive layout, no page runtime errors |
| Browser checks against compiled JavaScript server | Passed | Actual compiled server/worker branch, separate temporary local database and port, same running proxy |
| `npm audit` | **0 advisories reported** | Lockfile at check time; not a complete security audit |
| Compose YAML parse | Passed | Syntax parse only, not Docker orchestration validation |

The E2E provider fixture is injected only by the test. The test starts the actual investigator with no model key to exercise a real provider-unavailable path, then uses a clearly labeled model fixture for the response lifecycle. It does not submit a live inference request or establish that an actual human attended its automated approval.

## Browser evidence

The captured UI uses actual synthetic local traffic and actual stored records. Manual response screenshots explicitly identify their browser-test rationale. The approval screenshot shows a selected checkbox; the script cancels rather than sending the enforcement approval. Its test proposals are rejected afterward. No screenshot is offered as a live model result.

- [Overview](screenshots/overview.png)
- [Manual response proposal](screenshots/response-center.png)
- [Explicit approval review](screenshots/approval-review.png)
- [Mobile layout](screenshots/mobile.png)

## Unexecuted paths and limits

- **At the initial November 10 validation, live provider acceptance was not run:** no OpenRouter API key was configured. The November 11 cyber-demo record below documents the subsequent configured live run. Fixture results alone still do not establish model quality.
- **Docker build/run was not executed:** Docker was not installed on this host. Container files were prepared and parsed, the Linux proxy was built/tested, and the compiled application entry point was exercised natively. These do not establish that Compose orchestration or image builds passed.
- **The optional CMake build and remote CI workflow were not executed.** Verified native builds used the supplied Python compiler wrapper. CI is defined for a future repository push; no GitHub remote was created or published here.
- **Windows graceful draining is not claimed.** The launcher stops owned Windows process trees; the drain test specifically runs on POSIX.
- **No benchmark, live-model accuracy measurement, penetration test, or production certification was performed.**

## Reproduction

Follow the README setup, then rerun the listed commands. The browser check requires the local stack to be running and a usable browser; it can trigger a configured runtime investigator through actual detections. Fixture tests use isolated temporary databases and clean them up instead of mixing their records into the application audit history.

## Guided demo update — November 11, 2026

- `npm test`: **16 passed, 0 failed**, including bounded demo traffic and operator/CSRF protection for demo controls.
- `npm run demo`: production UI build and native stack startup passed. `npm run build:runtime` passed.
- Actual Edge browser: signed in, started normal traffic, generated a burst with HTTP 429 responses, stopped Backend A and observed unhealthy status, restarted it and observed recovery, sent target/control verification requests, and stopped traffic. No page runtime errors occurred.
- Provider configuration was disabled only for this browser-check process. These checks do not establish live OpenRouter behavior or approval/enforcement; the existing response lifecycle tests cover that flow with explicit fixtures.

## Cyber investigation and containment update — November 11, 2026

- `npm test`: **20 passed, 0 failed**, including current-lifetime source comparison, read-only collateral preview, required tool checks at the investigator API, exact scenario selection despite second-resolution timestamps, and old-incident queue exclusion.
- Production UI and compiled runtime builds passed. The real-proxy E2E passed, including the two required cyber tools and 60-second rule expiry with the control plane stopped.
- A configured **live OpenRouter / `openai/gpt-4.1-mini`** run returned a proposal after choosing `recent_events`, `active_rules`, `compare_sources`, and `containment_preview`. Automated browser interaction reviewed the isolated synthetic exercise, checked consent, and approved the exact proposal. Actual requests established target HTTP 403 and successful control traffic. A subsequent real model outcome review completed.
- Earlier exploratory live attempts demonstrated a no-action assessment and rejected invalid citations/proposals. The final tested prompt supplies explicit allowed evidence and target constraints. This remains stochastic model behavior; a successful exercise does not guarantee future provider responses or security classification accuracy.
- The separate offline browser run passed with an explicitly **manual** proposal, consent-disabled approval before review, actual approval and verification, no page runtime errors, and desktop/mobile overflow checks. `npm run test:cyber` reproduces this isolated fallback check; add `-- --live` to opt into model calls.
- [Live synthetic containment capture](screenshots/cyber-demo.png). It records an actual exercise, not proof of malicious traffic. Browser approvals were automated test-operator actions, not an assertion that a person attended the test.

The existing user stack was left running. Verification used owned processes on separate ports and separate ignored databases; the test processes were stopped afterward. No remote service was deployed.
