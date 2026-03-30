**HelkinSwarm – Skills System Enhancement & Standardization Spec**  
**Version:** 2026-03-24 (Full Brain-Dump Capture)  
**Purpose:** This document captures **every detail** from the full brain-dump session with complete fidelity. It is ready to be turned directly into GitHub issues, backlog items, manifest schema updates, instruction files, and recurring maintenance tasks.

### 1. Skills Library Tab (3rd Teams App Tab)
- **Tab name**: Short and mobile-friendly → **“Skills”** (or “Library” if even shorter is preferred).  
- **Position**: Third top-level tab (after “Getting Started” and the renamed Control Center).  
- **No additional tabs** beyond the existing three (Teams mobile UX constraint).  
- **Functionality**:
  - Dynamically loads and displays the full list of skills from the backend `skills/` folder + any linked external repos.  
  - Each skill card shows: short name, display name, short description, icon (pulled from blob storage or manifest link).  
  - Install / Uninstall toggle button (state-aware).  
  - After any install/uninstall: user-triggered reload prompt (hot reload preferred; full Durable Functions restart as safe fallback).  
  - **Explicit rule**: Reload is **user-only** — never exposed to orchestrator/LLM for security and stability.  
  - Skills Forge integration: newly forged skills automatically appear in the list as “Available” (not yet installed).

### 2. Existing Tab Naming Tweaks (Quick Issue)
- “Control Center” → shorten (gear icon recommended for space).  
- “Getting Started” → “Get Started” 
- Avoid reserved Teams tab names (“About”, “Help”).  

### 3. Skills Manifest / Schema – Required Fields (Core Standardization)
Every skill **must** include a JSON manifest with these fields (enforced in `.github/instructions/skills-library.instructions.md` and recurring maintenance pass):

| Field | Description | Example / Notes | Field Required yes/no |
|-------|-------------|-----------------|----------------|
| `shortName` | Internal identifier | `"web-search"` | Yes |
| `displayName` | UI-friendly name | `"Web Search"` | Yes |
| `shortDescription` | One-line UI description | `"Perform internet searches"` | Yes |
| `iconUrl` | Link to blob storage icon | `https://.../web-search.png` | Yes |
| `deploymentScenario` | Personal vs enterprise | `"personal-user-centric"` or `"enterprise-commercial"` | Yes |
| `dependencies` | Array of required skills | `["password-manager", "web-search"]` | No |
| `requiredPermissions` | Entra/Graph permissions needed | `["User.Read", "Mail.Read"]` | No |
| `externalAccountsNeeded` | Outside accounts required | `["Bing API key", "WhatsApp Business"]` | No |
| `onboardingMethod` | How credentials/permissions are obtained | `"automatic-agentic"`, `"post-install-link"`, or `"both"` | Yes |
| `version` | Simple versioning | `"1.0"` or `"RC-2026-03"` | Yes |
| `softOnboarding` | First-run personality prefs | Object with keys like `preferredAddress`, `responseStyle` (concise/long) | No |
| `lifecycleRules` | Behaviour on uninstall / reset | `"keep-credentials"`, `"close-external-account"`, `"ask-user"`, etc. | Yes |
| `maintenanceTasks` | Scheduled/event-driven tasks | Array of tasks (credential rotation, key refresh, etc.) | No |

### 4. Lifecycle Management & Identity Lifecycle
- On **uninstall** of a skill: manifest declares whether to keep credentials, close external accounts, or ask the user.  
- On **reset / reposition** of a skill: manifest defines scope (overwrite old account, reuse existing, prompt user).  
- **Identity lifecycle tasks**: periodic credential updates, key rotation, expiration handling — all declared in manifest.  
- These tasks feed into the new **Skills Maintenance Tasks** framework (see below).

### 5. Skills Maintenance Tasks Framework (Generalized & Skill-Agnostic)
- New construct: **Skills Maintenance Tasks** list in the manifest.  
- Scheduled or event-driven (e.g., “rotate API key 7 days before expiry”).  
- Folds into existing long-running external automations tracking.  
- Orchestrator periodically queries all installed skills’ maintenance tasks and delegates execution automatically.  
- Goal: zero manual intervention; everything runs agentically and reliably.

### 6. Onboarding & Dependency Handling
- **Pre-install confirmation popup** in Skills Library UI: clearly states exactly what will happen (automatic actions, post-install `/link` steps, or both).  
- User must explicitly continue/cancel.  
- **Dependencies**: if a skill lists another skill as required, install is blocked or auto-suggests/enables the dependency.  
- **Core skills** = default-installed on new stamped instance; still go through the exact same automated onboarding pipeline.  
- **Soft onboarding** (personality/creature comfort): reusable module for first-run questions (how to address user, preferred response length, etc.).

#### 6.1 Rollout classification for config-gated skills

The manifest onboarding mode is necessary but not sufficient for rollout.

Operationally, every skill must also be classified as one of:

- `automatic-agentic`
- `post-install-link`
- `both`
- `operator/backend-config-required`

The last category is the danger class for skills that still depend on backend keys, tenant setup, billing activation, allow-lists, or other operator-side work that a normal user cannot complete in the moment.

If a skill falls into `operator/backend-config-required`, it must **not** be exposed as normally available until:

- prerequisite presence is verified
- a lightweight test call proves readiness
- the orchestrator has a graceful fallback path
- the user-facing response explains the situation clearly instead of surfacing a backend-only failure

#### 6.2 Required rollout checklist before exposure

Before a skill is shown as ready for ordinary use, verify:

- [ ] all backend credentials/config exist
- [ ] a readiness/preflight check exists
- [ ] missing-config state has a humane fallback
- [ ] dependency/install state is explicit
- [ ] voice/chat requests cannot dead-end in operator-only setup instructions

### 7. Password Manager Skill (Specific Example)
- **Core skill** (default-installed).  
- Backend: Azure Key Vault.  
- User-facing + bot-facing: manual password storage + agentic use (e.g., auto-create low-risk accounts during Playwright tasks).  
- Other skills may declare `password-manager` as a dependency.  
- Lifecycle rules apply (uninstall behaviour, credential cleanup, etc.).

### 8. Web Search Skill (Concrete Failure Example & Fix)
- Delivered broken → returned “missing Bing API key”.  
- **Requirement**: Fully agentic onboarding — create account, obtain key, store in Key Vault, enable skill.  
- No user-facing “missing config” errors allowed.  
- Orchestrator must trap and resolve such failures intelligently.  
- Will become a dependency for any skill needing current web data.

Updated anti-pattern framing:

- the specific provider changed (Bing retired; current repo uses Brave Search), but the UX failure mode is the same
- if `skills/web/handlers.ts` can still throw because `BRAVE_SEARCH_API_KEY` is absent, then the skill is not rollout-ready for normal users
- that means web search must either:
  - complete its backend/operator setup before exposure,
  - remain classified as `operator/backend-config-required`, or
  - provide a clear fallback path instead of letting a normal user request die in backend-config instructions

This example should be treated as the standing warning for any future API-key skill.

### 9. Virtual Employees Context (End-Game Reinforcement)
- Virtual employees = future sub-stamped instances of HelkinSwarm (lightweight, agentic-only, no full web UI).  
- They inherit **all** skills from the master instance, but may only have a subset enabled based on their role.
- Every skill must be 100 % functional out-of-the-box after stamping. (excluding user facing configuration steps, but including all agentic onboarding and dependency handling).  
- Reinforces the strict rule: **no broken skills** — all prerequisites, credentials, accounts, and maintenance must be handled automatically by the installation pipeline and/or in stamp orchestrator, or if not possible the overseeing / top level agent that is provisioning the stamp new.

### 10. Enforcement & Recurring Maintenance
- Dedicated instruction file: `.github/instructions/skills-library.instructions.md` — enforces manifest standards, onboarding, lifecycle, dependencies, etc. 
- Ensure all new skills conform before they reach production.
- Add to existing **recurring maintenance issue** (never-close):  
  - Backport any new manifest fields, standards, or lifecycle rules to previously delivered skills (grandfathering).  

### 11. Enhanced Dependency Framework – Uninstall Protection
- The dependency system must be bidirectional and state-aware.  
- When a user (or agent) attempts to uninstall a skill, the system **must** query the dedicated skills long-term state storage / memory to detect any upstream dependent skills.  
- Behaviour on uninstall attempt:
  - **Block** the uninstall if critical dependencies exist, **or**  
  - Clearly warn the user with an explicit list of all upstream skills that will break (e.g., “Uninstalling Password Manager will break: political-comic-gen, movie-booking-agent”).  
- This check must be enforced both in the Skills Library UI (pre-uninstall confirmation) **and** in any backend uninstall orchestration flow.

### 12. Password Manager Skill – Key Vault Provisioning & Protection Notes
- The Key Vault (already provisioned as core infrastructure in every stamped instance) must be configured with:
  - **Soft-delete** enabled (with a defined retention period for deleted secrets/passwords).  
  - **Purge protection** enabled so deleted items cannot be permanently purged without explicit higher-level action.  
- Default IaC permissions on all Key Vaults:
  - Cannot be deleted by non-human participants (virtual employees or sub-orchestrators).  
  - If deletion is attempted, the vault must be shadow-retained / restorable (long-term design goal).  
- This protection is especially critical for the future virtual-employee stamping scenario where the human-in-the-loop is two layers removed (master HelkinSwarm → virtual employee → actions).  
- These flags and protections must be explicitly declared in the IaC (Bicep) for every stamped deployment and referenced in the Password Manager skill manifest.

---

**Ready for Backlog**  
This document now contains **complete fidelity** of every point discussed across the entire session.  
You can copy-paste any section directly into GitHub issues or use the whole file as `docs/specs/skills-system-enhancement-2026-03-24.md`.

Let me know if you want me to split this into individual issue templates next.