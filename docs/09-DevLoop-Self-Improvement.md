# HelkinSwarm Project Specification

## 9. DevLoop Self-Improvement (Refined)

### Purpose

DevLoop is the **closed-loop self-improvement engine** that turns HelkinSwarm from a static system into a living, evolving organism.  

It allows the VS Code-side agent (powered by GitHub Copilot Chat + custom MCP extension) to directly interrogate, benchmark, steer, and auto-tune the live runtime without any human intervention. This is the mechanism that keeps tool presentation, prompt strategies, and model behavior optimal as new global frontier models or EU DataZoneStandard variants become available.

### Core Architecture (Bidirectional Relay – 0g)

DevLoop and the runtime communicate through a **dedicated, secure relay** (Durable Functions + `ide-messages` Cosmos container):

- Prefix-based protocol: `DEVLOOP:`, `DEVQUERY:`, `HELKIN-REPLY:`, `SWARM-TOOL-REPORT:`
- Structured JSON payloads with correlation IDs
- Support for steering injections (non-terminating) and session resurrection
- Full tracing in the Dev Console tab (global SPA front-end; data served from stamp tab backend — see #107)

This channel is the primary way DevLoop asks the runtime “what tools do you currently see?” and receives accurate, model-specific answers.

### Key Capabilities

| Capability                     | Description |
|--------------------------------|-----------|
| **Live Interrogation**         | `DEVQUERY: list all current tools and active model` — runtime self-reports with full visibility into the Tool Registry and active profiles |
| **Model-Specific Tuning**      | Tests different tool masks, progressive reveal strategies, and naming conventions per model (0b) |
| **Benchmark Harness**          | Runs synthetic + real tasks via the Teams Test Harness MCP across all models; scores success rate, latency, token efficiency, safety compliance, and verification pass rate |
| **Auto-Promotion**             | Winning configurations are saved to `model-profiles/` and become the new default |
| **Regression Guard**           | If a new profile drops score ≥10 %, it is automatically rolled back and an alert is raised |
| **Session Resurrection**       | `DEVLOOP: the dev session just OOM’d — restart with ignition prompt v3` |

### TIK-TOK Autonomous Cycle (Ignition Prompt)

The master DevLoop ignition prompt (stored in `Proomptz/DevLoopIgnitionPrompt.md`) drives a continuous loop:

**TIK — DELIVER**  
Select highest-priority open issue → implement → push → deploy → validate with `teams_test_full_probe` across all models → close + label “devloop-validated”.

**TOK — RE-VALIDATE**  
Select closed issues missing the label → re-test with full harness → add label or reopen.

**Discovery Mode** (when backlog is empty)  
Interrogate runtime, probe each model, audit memory consistency, compare code vs instructions, generate new issues.

The loop runs indefinitely until everything is done — or dies trying.

### Integration Points

- **Teams Test Harness MCP** — the only safe way to send test messages (hardcoded safe chat ID)
- **Bidirectional Relay (0g)** — direct steering and introspection
- **Model Profiles (0b)** — versioned JSON artifacts committed to Git
- **Safety Pipeline (0e)** — DevLoop messages run through the exact same four-eyes verification
- **Skill Memory & Hydra-Net (0i + 0k)** — can query and test memory injection behaviour
- **Virtual Employees (0j)** — future extension (DevLoop can spawn and test child instances)

### Key Files

| File | Responsibility |
|------|----------------|
| `src/mcp/teamsTestHarness/` | Secure communication bridge |
| `src/orchestrator/devLoopInterrogation.ts` | Runtime self-reporting tools |
| `model-profiles/` | Versioned tuning artifacts (auto-generated) |
| `Proomptz/DevLoopIgnitionPrompt.md` | Master autonomous cycle prompt |

### What NOT to Do

- ❌ Never use user-impersonated tokens long-term in DevLoop
- ❌ Never rely on Playwright for message injection
- ❌ Never treat the bidirectional channel as just another tool — it is core infrastructure
- ❌ Never allow DevLoop to bypass safety gates or verification pipeline
