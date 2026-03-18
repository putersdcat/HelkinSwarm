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
- Spawns SkillForge as a separate Durable Activity (or Azure Container Instance job).
- SkillForge runs in its own clean LLM session (fresh context, no inherited state).
- Full safety pipeline (see **0e**) is applied to the incoming request and every reasoning step inside the container.

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