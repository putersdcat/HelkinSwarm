**HelkinSwarm – Skills System & Autonomous Virtual Company Pipeline Spec**  
**Version:** 2026-03-25 (Enhanced AGI-Driven Vision – Full Reasoning Pass)  
**Purpose:** This is the single source-of-truth document for every skills-related feature, enhancement, architectural construct, and long-term virtual-company planning point discussed across all sessions today. It now includes the new **Virtual Web Browser** skill and secure text storage expansions with **full fidelity**. Use this directly to create GitHub issues, epics, backlog items, manifest schema updates, instruction files, and recurring maintenance tasks.

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
| `virtualEmployeeCompatible` | Boolean |
| `requiresOrchestratorApproval` | Boolean (for high-risk actions) |
| `licenseAvoidant` | Boolean (prefer Blob over SharePoint etc.) |

### 4. Specific Skills Defined Today

**4.1 Deep Research / Extended Research Skill**  
- Long-running, heavy-reasoning session (beyond normal sub-session limits).  
- Outputs: Markdown native + optional PDF/DOCX/ZIP via Document Translator dependency.  
- May spawn sub-agents/multi-personas (code-level or router).  
- Primary target for token budgeting.  
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
- Now explicitly includes **secure text storage** for company credit cards, passkeys for 2FA, API keys, and any other sensitive non-password strings.  
- Lifecycle rules apply (uninstall behaviour, credential cleanup, etc.).

**4.6 Cost Estimation & Budgeting Skill**  
- Dual-facing (LLM tool call + end-user).  
- Real-time cost guesstimates/spreads across models.  
- Historical spend, budget status queries.  
- Critical for virtual-employee fiscal rails (hard budgets until revenue offsets).  
- Hooks to Azure billing APIs.

**4.7 Entra ID Directory Lookup & Write Skill**  
- Basic company-directory lookups + write capabilities using Microsoft Graph `user` resource.  
- Canonical properties (full set from dump).  
- Future virtual-employee creation: orchestrator (first-line manager) must be able to **modify** Job Title, phone, email, names, etc. for subordinates it oversees.

**4.8 Virtual Web Browser Skill (Major New Gap – Playwright Full-Access)**  
- Full Playwright instance with extensions, giving the AI **KVM-style interactive browser access** + full DevTools console access.  
- Not limited to headless scripting — supports real interactive navigation, form filling, CAPTCHA handling, file uploads, multi-tab workflows, and arbitrary web interactions.  
- Primary use cases for virtual employees:  
  - Direct online banking (incoming/outgoing payments when no API exists).  
  - Uploading advertisements or interacting on bidding platforms.  
  - One-time web-based data submissions or legacy system interactions.  
  - Any human-facing web tool that lacks an API.  
- Dependencies: **Password Manager** (auto-injects credentials/passkeys/credit cards securely).  
- Security model: runs in isolated container/sandbox; all actions logged and approval-gated for high-risk operations.  
- Manifest flag: `requiresInteractiveBrowser: true`.

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
- Highest-risk actions (payments, transfers, purchases, legal bindings, etc.) are **always gated**.  
- Virtual employees can prepare/execute up to the final step, but the orchestrator (acting as first-line managing director) must give explicit “authorization / signature / approval”.  
- Manifest field `requiresOrchestratorApproval`.

### 6. Autonomous Virtual Company & Employee Pipeline (Deep AGI Self-Organization Vision)

Short-term capital covers burn while the collective discovers purpose. Long-term: zero tolerance for cash-burn without revenue. The orchestrator + virtual employees must self-organize, map the digital world, and invent viable revenue sources. Human investor receives periodic high-level updates but does not dictate the business plan.

**Projected Bare-Minimum Virtual Employee Personas (build tools for these today)**

| Persona | Role | Primary Skills/Tools Needed (build now) | Revenue Angle | Cost-Control Note |
|---------|------|-----------------------------------------|---------------|-------------------|
| Research & Intelligence | Deep web/market research | Deep Research + Virtual Web Browser + Language Translation + Document Translator + Image Generation | Sell research reports, trend briefings | Budget gating mandatory |
| Content & Media | Generate articles, visuals, social | Deep Research + Image Generation + Language Translation + Document Translator + Virtual Web Browser | Freelance content, AI art licensing | Output-first design |
| Finance & Bookkeeping | Track burn, invoice, payments | Cost Estimation & Budgeting + Password Manager + Virtual Web Browser (for banking) + Entra ID Write | Automated micro-invoicing | Orchestrator retains final approval on all payments |
| Sales & Outreach | Proposals, lead qualification | Entra ID + Language Translation + Document Translator + Human Relations (email) + Virtual Web Browser | Cold outreach for gigs | Rate-limited + approval-gated |
| Operations & Coordination | Task delegation, status reporting | All above + AI-Native Document Storage (Blob) | Internal efficiency | License-avoidant |
| Human Relations | Periodic updates to human investor | Human Relations skill + charting + activity log aggregation | Required for oversight | Weekly PDF/email summary |

**Critical New Skill – AI-Native Lightweight Document Storage**  
- Backend: Azure Blob Storage + Cosmos DB metadata/indexing.  
- Features: save, share, version, search, agent comments.  
- Cost: pennies per GB — avoids per-employee SharePoint/OneDrive licenses.  
- Manifest flag: `licenseAvoidant: true`.

**Virtual Web Browser Skill – The General-Purpose “Brute Force” Tool**  
- Full Playwright with extensions + KVM-style + DevTools console access.  
- Enables any web interaction that lacks an API (online banking, bidding platforms, ad uploads, legacy systems).  
- Secure credential injection via Password Manager (including credit cards, passkeys, 2FA).  
- All actions logged; high-risk actions require orchestrator approval.  
- Essential for virtual employees to operate in the real digital economy.

**Approval Gating & Oversight**  
- Orchestrator retains final “signature” on all high-risk actions even after delegating roles.  
- Virtual employees get execution rights but not final release.

**Recurring Maintenance Addition**  
- Every new skill must be evaluated against virtual-company requirements (delegation safety, approval gating, license avoidance, revenue potential).

### 7. Enforcement & Recurring Maintenance
- Dedicated instruction file: `.github/instructions/skills-library.instructions.md`.  
- Update existing never-close recurring maintenance issue to include virtual-company compatibility review for every skill.
