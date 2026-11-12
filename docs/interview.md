# AegisGate interview walkthrough

## What you built

A small security operations workflow for suspicious HTTP traffic. The proxy detects repeated source violations. An AI agent gathers evidence and checks what a temporary block would affect. You approve the exact response, then real requests test whether it worked.

The load balancer keeps the application reachable. The cyber story is detection, investigation, scoped containment, verification, and audit.

## Your demo

Launch `Demo.cmd`, sign in, and stay on **Cyber demo**.

1. **Start cyber demo:** “I'm generating normal traffic and a controlled burst from a separate test client.”
2. **Watch the investigation:** “The rate limiter detects the behavior. The agent decides which evidence to inspect, compares clients, and checks the impact of a block.” Open one returned evidence record if asked.
3. **Review and approve:** “This is a containment exercise. The agent proposes a short block for this exact address. It cannot approve its own proposal.” Read the target and duration before checking the box and clicking **Approve containment**.
4. **Observed outcome:** “The test source received 403, and a different client still reached the backend. Those are proxy observations. The AI reviews the result afterward.” Wait for the actual indicators before saying this.

If the model declines an action, explain its finding. If it fails, the screen says so; a clearly labeled manual fallback can demonstrate the same approval and verification controls. Never describe a manual proposal as an AI result.

## Questions you should be able to answer

- **What makes it agentic?** The model chooses evidence tools over multiple turns, updates its plan from returned results, decides whether to propose containment, and reviews actual outcomes. The application bounds its tools and execution budget.
- **Why use AI here?** To investigate and explain a signal, assess alternatives, and prepare a scoped response. Rate limiting, routing, authorization, and outcome verification are deterministic.
- **Why require approval?** Blocking a shared IP can affect innocent users. The approval binds the exact target, duration, evidence, and configuration state.
- **What if the AI fails?** Forwarding and existing controls continue. The console records the failure and offers a labeled manual path.
- **What does it detect?** Repeated denied or rate-limited requests from one source. It does not inspect payloads for SQL injection or establish compromise, malicious intent, or a distributed attack.
- **What would you improve next?** Richer application evidence, evaluation against benign bursts and abuse cases, and stronger identity than a source IP. These are future work.
