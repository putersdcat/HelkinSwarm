**HelkinSwarm – Skills System & Autonomous Virtual Company Pipeline Spec**  
**Version:** 2026-03-25 (Complete Brain-Dump Capture – All Sessions)  
**Purpose:** This is the single source-of-truth document for every skills-related feature, enhancement, architectural construct, and long-term virtual-company planning point discussed across both voice dumps today. It contains **full fidelity** of every detail. Use this directly to create GitHub issues, epics, backlog items, manifest schema updates, instruction files, and recurring maintenance tasks.

### 1. Skills Library Tab (3rd Teams App Tab)
- **Tab name**: Short, mobile-friendly → **“Skills”** (preferred) or “Library”.  
- **Position**: Third top-level tab (after “Getting Started” and renamed Control Center).  
- **Constraint**: Maximum of three tabs total.  
- **Functionality**: Dynamic list from `skills/` folder + linked repos. Install/uninstall toggles. User-triggered reload only (hot preferred, full Functions restart fallback). Skills Forge auto-adds new skills as “Available”.

### 2. Existing Tab Naming Tweaks
- “Control Center” → shorten (gear icon recommended).  
- “Getting Started” → keep full length if possible.  
- Avoid reserved names (“About”, “Help”).

### 3. Skills Manifest / Schema – Required Fields (Core Standardization)
Every skill **must** include these fields (enforced by dedicated instruction file + recurring maintenance pass):

| Field | Description / Notes |
|-------|---------------------|
| `shortName` | Internal identifier |
| `displayName` | UI name |
| `shortDescription` | One-line description |
| `iconUrl` | Blob storage link |
| `deploymentScenario` | `"personal-user-centric"` or `"enterprise-commercial"` |
| `dependencies` | Array of required skills |
| `requiredPermissions` | Entra/Graph permissions |
| `externalAccountsNeeded` | Outside accounts/keys |
| `onboardingMethod` | `"automatic-agentic"`, `"post-install-link"`, or `"both"` |
| `version` | Simple versioning |
| `softOnboarding` | First-run personality prefs |
| `lifecycleRules` | Uninstall/reset behaviour |
| `maintenanceTasks` | Scheduled/event-driven tasks |
| `supportsBudgeting` | Boolean flag for token/cost budgets |
| `costModel` | Optional model cost spreads |

### 4. Specific Skills Defined Today

**4.1 Deep Research / Extended Research Skill**  
- Long-running, heavy-reasoning session (beyond normal sub-session limits).  
- Outputs: Markdown native + optional PDF/DOCX/ZIP via Document Translator dependency.  
- May spawn sub-agents/multi-personas (code-level or router).  
- Primary target for token budgeting (see 5.1).  
- Requires periodic intermediate outputs to survive budget cutoffs.

**4.2 Document Translator Skill**  
- Markdown ↔ DOCX ↔ PDF (embedded images supported).  
- Dependency candidate for Deep Research and other output-heavy skills.  
- Licensing note: evaluate PandaDoc or alternatives for enterprise/personal compatibility.

**4.3 Language Translation Skill**  
- Canonized frame for final-step translation (keeps earlier steps native for token efficiency).  
- Optional in-situ translation.  
- May route to dedicated high-quality model.

**4.4 Image Generation Skill**  
- Wraps provisioned image models (DALL-E, Flux, etc.).  
- Text-to-image; future image-input/contextualization.  
- Outputs as blob URI for chat/reports/Deep Research documents.  
- Usable directly by user or as dependency.

**4.5 Password Manager Skill**  
- **Core skill** (default-installed).  
- Backend: Azure Key Vault.  
- Dual-facing: user manual storage + agentic use (e.g., auto-create low-risk accounts).  
- Lifecycle rules apply.

**4.6 Cost Estimation & Budgeting Skill**  
- Dual-facing (LLM tool call + end-user).  
- Real-time cost guesstimates/spreads across models.  
- Historical spend, budget status queries.  
- Critical for virtual-employee fiscal rails (hard budgets until revenue offsets).  
- Hooks to Azure billing APIs.

**4.7 Entra ID Directory Lookup & Write Skill**  
- Basic company-directory lookups using Microsoft Graph `user` resource with explicit `$select` and appropriate permissions (`User.Read.All` or `Directory.Read.All`).  
- Canonical properties (full set from dump): `id`, `displayName`, `givenName`, `surname`, `userPrincipalName`, `mail`, `otherMails`, `mailNickname`, `jobTitle`, `department`, `companyName`, `officeLocation`, `businessPhones`, `mobilePhone`, `preferredLanguage`, `employeeId`, `employeeType`, `manager` (relationship), `directReports` (relationship), `memberOf`, `assignedLicenses`, `assignedPlans`, `accountEnabled`, `onPremisesSamAccountName`, `onPremisesSyncEnabled`, `onPremisesExtensionAttributes`, `extensions`, `createdDateTime`, `signInActivity`.  
- Future virtual-employee creation: orchestrator (first-line manager) must be able to **modify** Job Title, phone, email, names, etc. for subordinates it oversees.

### 5. Cross-Cutting Features

**5.1 Token Budgeting & Spending Limits**  
- User/agent sets monetary budget → translated to token cap (with overage buffer).  
- Graceful termination + partial output extraction.  
- Periodic outputs required for long-running skills.  
- Manifest flag `supportsBudgeting`.

**5.2 Enhanced Dependency Framework (Bidirectional & State-Aware)**  
- Install-time enforcement.  
- Uninstall protection: query long-term state/memory → block or warn with explicit list of upstream dependents.

**5.3 Skills Maintenance Tasks Framework**  
- Generalized, skill-agnostic list in manifest.  
- Folds into long-running external automations.  
- Orchestrator auto-delegates credential rotation, key refresh, etc.

**5.4 Application-Level RBAC / Roles**  
- Introduce roles (e.g., “Lead Developer” = full GitHub issue control).  
- MVP: hard-coded in app logic (only primary user has it now).  
- Future: Entra ID groups / JWT claims for other stamps.

**5.5 Key Vault Protection**  
- Soft-delete + purge protection on all stamped Key Vaults.  
- Non-human participants cannot delete vaults.  
- Shadow-retain / restorable (long-term design goal for two-layer autonomy).

**5.6 Approval Gating for High-Risk Actions (Inverse of oversightOnly)**  
- Highest-risk actions (payments, transfers, purchases, financial commitments, legal bindings, etc.) are **always gated**.  
- Virtual employees can prepare/execute up to the final step, but the orchestrator (acting as first-line managing director) must give explicit “authorization / signature / approval”.  
- This gating is enforced at the orchestrator level even after delegation of roles to subordinates.  
- Manifest field or orchestration rule to mark actions as “requiresOrchestratorApproval”.

### 6. Autonomous Virtual Company & Employee Pipeline (Long-Term Vision + Projections)

This is **not academic** — it will be a real, self-sustaining virtual company managed by stamped orchestrator instances. Initial outside funding is acceptable; long-term burn without revenue is not.

**Bare-minimum virtual employee personas needed (build tools for these today):**
- **Finance / Accounting** — initially direct orchestrator control; later delegated to dedicated Virtual Finance Employee. Orchestrator transitions to oversight-only role (view-only access, approval gates, audit trails).
- **Operations / Execution** — handles day-to-day task execution.
- **Sales / Revenue** — generates billable work to offset costs.
- **Compliance / Risk** — ensures fiscal and security guardrails.

**Skills/tools we must build into the pipeline today (5-steps-ahead thinking):**
- Full Entra ID Directory + Write capabilities (already scoped in 4.7).
- Budgeting skill + real-time Azure billing hooks.
- Cost-aware task routing (model selection based on budget).
- Lifecycle management for virtual employee accounts (creation, modification, termination).
- Oversight tooling for orchestrator (view-only finance dashboards, approval workflows).
- Revenue-tracking primitives (so virtual company can self-fund).
- Approval gating for all high-risk actions (payments, transfers, purchases) — orchestrator retains final signature even after delegation.

**Manifest & orchestration implications:**
- Add `virtualEmployeeCompatible` flag to manifest.
- Add `oversightOnly` mode for orchestrator when delegating to subordinates.
- Add `requiresOrchestratorApproval` flag for high-risk actions.
- All skills must support both direct execution **and** oversight delegation.

**Recurring maintenance addition:**
- Every new skill must be evaluated against virtual-company requirements (can it be delegated safely? Does it expose fiscal controls? Does it need approval gating?).

### 7. Enforcement & Recurring Maintenance
- Dedicated instruction file: `.github/instructions/skills-library.instructions.md`.  
- Update existing never-close recurring maintenance issue to include:  
  - Backport new manifest fields.  
  - Virtual-company compatibility review for every skill.  
  - Entra ID write capabilities and approval gating for orchestrator-managed virtual employees.

