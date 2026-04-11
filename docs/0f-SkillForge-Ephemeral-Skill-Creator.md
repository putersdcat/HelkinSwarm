# HelkinSwarm Project Specification

## 0f. SkillForge – Ephemeral Skill Creator

**Feature Specification**  
**Version:** 1.0 (Unchained Edition)  
**Date:** March 2026  
**Status:** Draft – Ready for implementation

### 1. Core Concept

SkillForge is the **secure, ephemeral “creator” container** that gives HelkinSwarm the ability to prototype and submit brand-new skills when no existing tool in the capability map matches the user request.

It is **not** part of the main orchestrator or any persistent sub-agent. It spins up on demand, works in complete isolation, and self-destructs after the job. Its only purpose: turn a natural-language request into a fully-tested, manifest-compliant skill + PR, ready for human review and hot-reload.

### 2. Trigger & Orchestrator Hand-Off

- Orchestrator receives user request → scans modular `skills/` library (see **0a**) → no match.
- Instead of replying “I can’t do that,” it routes the request to SkillForge with the raw prompt + minimal session summary.
- `/forge` may be invoked directly by the user **or** suggested/escalated by the orchestrator after it recognizes that no existing skill/tool can satisfy the request but that a new skill is plausibly buildable.
- Spawns SkillForge as a separate Durable Activity (or Azure Container Instance job).
- SkillForge runs in its own clean LLM session (fresh context, no inherited state).
- Full safety pipeline (see **0e**) is applied to the incoming request and every reasoning step inside the container.

### 2.5 Stage 3 — Artifact Persistence

Before any repo handoff occurs, SkillForge should persist a durable review bundle so the work can be:

- reviewed
- resumed
- promoted
- audited

Current prototype work has already proven the value of this slice via bundle persistence (`skillForgeBundleStore.ts` and persisted bundle paths returned by `skillForgePrototypeActivity`).

Longer term, this bundle store may remain Blob-backed or be abstracted over a broader low-license document-storage skill once that capability exists for the wider system. In other words, Stage 3 persistence should be treated as a durable architecture seam, not as a one-off scratch hack.

### 3. Container Architecture & Base Image

- **Runtime**: Ephemeral Docker container (Azure Container Instances preferred for auto-scale & kill rules; fallback to Durable Functions container group).
- **Base Image**: `HelkinSwarm-skillforge:base` (pre-built and cached in ACR).
  - Pre-installed & ready at boot:
    - Node 22 + pnpm
    - TypeScript, ESLint, Prettier, tsc
    - gh CLI (GitHub CLI)
    - Playwright + puppeteer (for any web tasks)
    - git, curl
    - Warm npm cache from the main repo’s lockfile
    - All HelkinSwarm-specific dev tooling and skill manifest templates
- **Startup Sequence** (sub-10-second cold start):
  1. Pull repo diff only (`git fetch && git rebase origin/main`).
  2. Load GitHub App installation token (see section 4).
  3. `pnpm install` (cache hit → near-instant).
  4. LLM session starts with full toolset already present.

### 4. Authentication (GitHub App – No PATs)

- Uses a dedicated **GitHub App** (private, org-installed on the HelkinSwarm repo).
- Private key stored in Azure Key Vault; injected at container startup via managed identity.
- Bootstrap script:
  - Generates RS256 JWT (app ID + installation ID).
  - Exchanges for 60-minute installation access token (scoped: repo contents read/write + pull requests write only).
- Token used for `git push`, `gh pr create`, branch creation.
- Token auto-refreshes if job exceeds 60 min (rare — most prototypes finish in <10 min).

### 5. Sandbox & Security Boundaries

- **Network**: Outbound-only firewall (public internet allowed for npm, docs, APIs). All internal endpoints explicitly blocked at Azure network level.
- **Identity**: Zero Entra/Graph tokens ever injected. SkillForge cannot touch corporate or personal data.
- **Storage**: Ephemeral filesystem — destroyed on exit. No persistent volume.
- **Resource Guardrails**:
  - CPU >80% for 5 consecutive minutes → auto-kill + alert.
  - Memory cap + timeout (15 min default).
  - No sudo, no Docker-in-Docker, no host mounts.
- **Prompt Shields**: Applied continuously to every LLM thought, terminal output, and code generation step (see **0e**).

### 6. SkillForge Prompt & Behavior

Fixed system prompt (loaded from `skillforge-prompt.md`):
```
You are SkillForge, a secure skill prototype agent.
Rules:
- Only prototype TypeScript skills that follow the HelkinSwarm manifest format.
- Use only allowed tools: bash, git, gh, pnpm, tsc, eslint, playwright, curl.
- Build → lint → test → commit → open PR to dev branch.
- Include: capability JSON entry, domain instructions markdown, Activity Function stub, tests.
- Never request or use internal credentials.
- If you need something outside scope, reply "cannot do — need human".
Output final PR link or "cannot do".
```

The LLM thinks aloud, uses terminal tools, fixes lint errors live, iterates until clean, then creates the PR.

### 7. Output & Integration Back to Orchestrator

- On success:
  - Opens PR with complete skill package.
  - GitHub Actions workflow auto-adds **Copilot** as reviewer (security scan, jailbreak check, dependency scan, test run).
  - SkillForge pings orchestrator via callback: “SkillForge job complete — PR #42 ready: <link>”.
- Orchestrator replies to user in Teams:
  “I didn’t have a tool for that, so SkillForge prototyped one. PR #42 is ready for your review. Once merged, I’ll load it automatically.”
- User reviews + merges → orchestrator hot-reloads capability map on next orchestration step or via `/reload skills`.

### 7.1 Stage 4 — PR / repo handoff clarification

The intended in-product SkillForge behavior **does include branch + PR creation**.

This is a critically important scope clarification:

- the trunk-only / no-PR / no-branch directives in the Copilot instructions apply to **VS Code backlog agents working on the core HelkinSwarm repo directly**
- they do **not** prohibit the productized SkillForge feature from creating branches and pull requests as part of its own controlled workflow

SkillForge should therefore continue to target a PR-based handoff path where appropriate, even while core backlog work remains trunk-only.

### 7.2 Stage 4.5 — Isolated development execution path

There is a missing middle stage between “draft bundle / branch exists” and “PR is ready for human review”.

That stage is the actual coding/execution environment where SkillForge (or an attached coding agent) develops the generated skill on its branch until it is ready to submit for review.

Candidate implementations include:

- Azure-hosted isolated development box / coding container
- GitHub-hosted coding-agent execution (Copilot coding agent / cloud agent)
- complexity-based routing between those paths

#### Initial chosen subset

The initial Stage 4.5 execution path should be **GitHub-hosted coding-agent execution on the generated branch**.

Why this is the preferred first subset:

- it matches the existing PR-centric SkillForge lifecycle better than inventing a second bespoke execution plane first
- it keeps the development box attached to the repository/branch where the generated files already live
- it reuses GitHub’s existing review / workflow / artifact surfaces instead of forcing HelkinSwarm to build a full Azure-hosted coding workspace first
- it preserves the distinction between:
  - **VS Code backlog agents** working trunk-only on the core repo
  - **in-product SkillForge** working on controlled generated branches as part of the product workflow

Azure-hosted isolated execution remains a valid later path for cases that require stricter runtime isolation, custom tooling, or capabilities that GitHub-hosted execution cannot provide cleanly.

#### Initial routing decision

For the first usable Stage 4.5 slice:

- generated SkillForge work should route to **GitHub-hosted execution only**
- Azure-hosted execution remains a documented future extension, not a first required dependency
- complexity-based routing remains a future evolution after one execution lane is proven operationally

This means the system can honestly document an initial subset without pretending that both execution lanes are already productized.

#### Guardrails for the chosen execution path

Because GitHub-hosted coding-agent execution consumes metered resources, Stage 4.5 must stay budget-aware from day one.

Initial guardrails:

- max **1 active Stage 4.5 execution job per requester/stamp** at a time
- max **3 coding-agent iteration rounds** before returning for human intervention
- max **2 workflow/job retries** for the same generated branch before the run is marked failed
- prefer the **smallest viable validation set** before escalating into broader review gates
- enforce a **hard wall-clock timeout** for the isolated execution stage; if the job does not converge promptly, fail closed and return the artifact for human review instead of looping indefinitely
- keep the execution scope **branch-local** to the generated SkillForge branch; no direct write-back to `main` from the Stage 4.5 lane
- consume GitHub Actions minutes / premium requests as an explicit budgeted feature, not an invisible free background behavior

#### Handoff clarity

The intended first-pass lifecycle is therefore:

1. **Stage 4** — SkillForge creates/persists the draft bundle and branch/PR handoff metadata
2. **Stage 4.5** — GitHub-hosted coding-agent execution develops the generated branch under the guardrails above
3. **Stage 5** — automated review / validation / intelligent review gates run before the result returns for final human approval

This makes Stage 4.5 explicit without violating the core repo’s trunk-only rule for ordinary backlog-agent work.

Tracked follow-on issue:
- `#401` — Stage 4.5 isolated development execution path for generated skill branches

### 7.3 Stage 5 — Automated review before final human/chat-participant review

Before a generated SkillForge PR is ever returned to the original requester for final approval, the system should be able to run:

- automated testing
- security review / policy checks
- manifest/schema validation
- intelligent review (including Copilot/cloud-agent-assisted review where appropriate)
- explicit verification that the generated skill appears to satisfy the original request

Only after those review layers pass should the PR come back for final human/chat-participant review and merge to `main`, followed by hot reload / validation in the requester’s named stamp.

Tracked follow-on issue:
- `#402` — Stage 5 automated validation and intelligent review before final human merge

### 8. Failure & Fallback

- “cannot do” → orchestrator replies: “I can’t handle this yet — would you like me to file a GitHub issue instead?”
- Crash / timeout → container auto-destroys, full transcript logged, user notified.

### 9. Logging & Audit Trail

Every SkillForge job logs to App Insights / Sentinel with:
- Full correlation ID linking original user request.
- Complete LLM reasoning transcript.
- Every terminal command + output.
- npm installs, git commits, PR metadata.
- Prompt Shields detection results.
- CPU/memory usage (for anomaly detection).

### 10. Development & Runtime Configuration

- `SKILLFORGE_ENABLED`: boolean toggle
- `SKILLFORGE_TIMEOUT_MINUTES`: 15
- `SKILLFORGE_CPU_KILL_THRESHOLD`: 80
- Base image rebuild triggered on any change to dev tooling.

SkillForge gives HelkinSwarm the adaptive power users love while keeping the entire process sandboxed, auditable, and human-gated. It is the only component allowed to “invent” new capabilities — and it does so under the strictest controls in the system (see **0e** for the full safety pipeline).
### 11. MCP Registry as Concept Source (not just as integration target)

The [official MCP Registry](https://registry.modelcontextprotocol.io/) is a discovery surface for two distinct purposes in HelkinSwarm:

**Direct onboarding path** — when a registry candidate can be integrated directly via McpForge (`helkin_mcp_forge`): full external-server integration with safety review, manifest wrapping, and tool surfacing.

**Concept-mining path** — when a registry candidate is better used as a *research input* for a HelkinSwarm-native first-party skill:
- Do **not** install the external MCP server as a runtime dependency
- Do **not** expose its tool surface directly in the registry
- Instead: study its tool concepts, auth shape, UX assumptions, and edge-case handling
- Then build a HelkinSwarm-native skill (`skills/<domain>/`) that follows the HelkinSwarm manifest schema, safety model, and operational posture

#### When to choose concept-mining over direct onboarding

| Signal | Prefer direct onboarding | Prefer concept mining |
|--------|--------------------------|-----------------------|
| Auth model compatible with Bot Framework OAuth | ✅ Strong fit | |
| Requires QR-code, polling, or user-local state (e.g. WhatsApp Web) | | ✅ Build native |
| Manifest structure already production-quality | ✅ Strong fit | |
| Implementation reveals patterns we want to adapt, not depend on | | ✅ Build native |
| External server is from a trusted, maintained source | ✅ Consider onboarding | |
| External server is a community prototype / research quality | | ✅ Mine concepts |

#### Reference case: WhatsApp skill (#458)

The [whatsapp-mcp](https://github.com/meharajM/whatsapp-mcp) repository shows:
- TypeScript MCP server with `connect`, `disconnect`, `send_message`, `ask_question`, `get_status` tool concepts
- WhatsApp Web authentication via QR code + session persistence
- Allowed-number restrictions

**Decision**: Use as concept reference only. The QR-code auth model is incompatible with HelkinSwarm's OAuth-linked bot identity. The tool concepts (`send_message`, `get_messages`, status checks) should be replicated in a native `skills/whatsapp/` skill once the auth model is resolved.

#### Process

Registry discovery output can now produce three explicit outcomes (tracked in `#453`):
1. **Onboard**: integrate the external server via McpForge
2. **Mine and build**: use the server as a design reference, build a native skill
3. **Defer**: log the candidate for future evaluation

All three are first-class decisions to be documented in the relevant backlog issue.