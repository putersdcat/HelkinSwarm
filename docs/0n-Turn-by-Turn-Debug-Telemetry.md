# HelkinSwarm Project Specification – Addendum Series
## 0n-Turn-by-Turn-Debug-Telemetry.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Core Enhancement – Post-MVP but Architected for Integration  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-16

### 1. Purpose & Vision
Turn-by-Turn Debug Telemetry provides lightweight, configurable diagnostic insights appended to every final response in the Teams chat interface. This feature addresses the current limitation of opaque processing by surfacing key timings and sub-agent/tool breakdowns without cluttering the user experience or requiring separate tabs/dashboards for basic debugging.

In the spirit of the digital body ethos (0l), this telemetry acts as a subtle "nervous feedback loop" — allowing the master orchestrator to self-report its internal rhythms to the user (or developer) in real-time, fostering trust and rapid iteration. It emphasizes terseness for mobile compatibility, historical accuracy (baked at runtime), and minimalism to avoid interfering with the core conversational flow.

This is not a full observability replacement (see 13) but a quick, in-band diagnostic tool that integrates seamlessly with the Teams interface (10) and supports DevLoop interrogation (0g).

### 2. Core Concepts
- **Appended Telemetry**: Non-intrusive metadata added semantically after the LLM's final output, outside the tokenized response, at the application layer (e.g., via `sendReplyActivity.ts`).
- **Configurability**: Governed by a backend feature flag (`debugTelemetryEnabled`) in environment variables or Cosmos config container, toggleable without redeploy. Defaults to off for production users.
- **Terseness & Abbreviations**: Use compact formats (pipes, brackets) to minimize visual footprint, ensuring compatibility with mobile Teams views.
- **Scope**: Applies to every user-initiated turn processed by the overseer, including sub-agent delegations, tool calls, durable hook registrations (0h), and skill-memory injections (0i).
- **Granularity**: Millisecond timings for precision, with optional expansion to include token counts or costs in future iterations.
- **EU/Global Neutrality**: No impact on residency mode; telemetry is generated locally in the runtime.

### 3. Target Architecture (MVP Requirement)
1. **Telemetry Collector** (new activity in `src/orchestrator/telemetryCollectorActivity.ts`):
   - Captures timings at key points: request ingress, prompt build, LLM call, tool dispatch, verification pipeline (0e), skill-memory injection (0i), durable hook registration (0h), and final reply.
   - Aggregates into a structured object with correlation ID.

2. **Appender Logic** (`src/bot/sendReplyActivity.ts` extension):
   - Checks `debugTelemetryEnabled` flag.
   - Formats and appends telemetry as a single-line string after the main response (e.g., via markdown or plain text separator).
   - Example Format: `[Total:5.2s|Sub1:ToolA:120ms|ToolB:450ms|MemInject:80ms|HookReg:200ms] [Corr:abc123]`

3. **Flag Management**:
   - Stored in Cosmos `config` container or env var.
   - Exposed via DevLoop relay (0g) for runtime toggling (`DEVLOOP: toggle_debug_telemetry on`).

4. **Persistence**:
   - Telemetry is also emitted as structured App Insights events (13) for historical querying, with costs baked at runtime to handle fluctuating pricing.

### 4. Key Use Cases (must work Day 1)
- User queries "delete emails from bob@spam.com" → Response includes appended timings showing sub-agent tool calls, verification step, and total E2E time.
- DevLoop interrogation: "DEVQUERY: show last turn telemetry" → Returns full breakdown via bidirectional relay (0g).
- Long-running workflow: A durable hook trigger (0h) appends partial telemetry on interim updates, with full on completion.
- Skill-specific: Injection from a vault (0i) is timed and included (e.g., `[MemInject:outlook:80ms]`).

### 5. Integration Points
- **Teams Interface (10)**: Appended via proactive reply mechanism; replaces ack placeholder seamlessly.
- **Observability (13)**: Mirrors data to App Insights with correlation IDs; supports health dashboard roll-ups (e.g., average E2E time).
- **DevLoop Relay (0g)**: Allows querying and toggling; integrates with self-tuning loop for benchmark timings.
- **Safety Pipeline (0e)**: Includes verification step timings to audit high-risk actions.
- **Durable Hooks (0h) & Skill Memory (0i)**: Captures registration/injection latencies.
- **Dev Console Tab**: Displays recent telemetry in the debug logs sub-tab.

### 6. Security & Safety Considerations
- No PII or sensitive data in telemetry (timings only; anonymize tool names if high-risk).
- Flag toggle requires owner authentication (via Teams command or DevLoop).
- Appended text runs through prompt shields to prevent injection attacks.
- In EU mode, ensure no telemetry leaves the boundary.

### 7. What NOT to Do
- Do **not** interleave telemetry within the LLM response — always append after.
- Do **not** make it verbose by default; stick to terse formats.
- Do **not** bake costs or tokens in MVP if pricing is unstable — start with timings.
- Do **not** expose without the feature flag; default off for non-dev users.

### 8. Acceptance Criteria
- Telemetry appends correctly to a test response in <50ms added latency.
- Flag toggle via DevLoop works instantly without restart.
- E2E probe via Teams Test Harness (14) includes telemetry in output.
- Historical query in App Insights returns accurate timings by correlation ID.
- Mobile Teams view shows telemetry without breaking layout.

### 9. Backlog Linkage
- Builds on 10 (Teams Interface), 13 (Observability), 0g (DevLoop Relay), 0e (Safety Pipeline).
- Enables better self-tuning in 0b and 0m (Evaluation Loops).
- Ties into the ethos (0l) by providing "nervous feedback" for the digital body.
