# HelkinSwarm Project Specification – Addendum Series
## 0o-Microsoft-Teams-App-Expansion-with-Tabs.md

**Version:** 1.1 (Unchained Edition)  
**Status:** UI Enhancement – MVP Blocking for Control Features  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-19

> **2026-03-19 — Architecture Update:** The tab hosting decision has been locked in GitHub issue #107.  
> **TL;DR:** A single global SPA on Azure Storage static website ($0.001/GB, scale-to-zero) hosts all tab front-ends. Per-stamp Function App backends serve the real data. The manifest uses a build-time `{{TAB_HOST_URL}}` placeholder substituted by `teams-package.yml`. This keeps the manifest global and single while all tab data remains stamp-resident.

### 1. Purpose & Vision
The Microsoft Teams App Expansion introduces dedicated tabs to the personal app, evolving it from a basic chat window into a comprehensive control hub. This addresses visibility gaps in costs, health, telemetry, and configuration while maintaining minimalism for mobile compatibility.

Aligned with the digital body ethos (0l), tabs serve as "sensory organs" — providing at-a-glance insights into the organism's state without disrupting the core conversational "brain" (chat). It emphasizes cost efficiency (tabs don't prevent durable functions from sleeping), user configurability, and historical accuracy (baked costs/telemetry).

This expansion integrates deeply with observability (13) and DevLoop (0g), making the system more self-aware and tunable.

### 2. Core Concepts
- **Top-Level Tabs**: Limited to 1-2 (Getting Started, Control Center) to preserve horizontal space on mobile.
- **Sub-Structure**: Each top tab loads a multi-tabbed web page for deeper navigation, hosted on a global static SPA that allows the underlying stamp Functions to sleep.
- **Global SPA + Per-Stamp Backends**: The tab front-end is a single global Azure Storage static website (scale-to-zero, ~$0.001/GB). All real data comes from per-stamp Function App API backends called with the user's Teams JWT. See #107 for the architecture decision.
- **Manifest-Driven**: Tabs defined in `appPackage/manifest.json`; `{{TAB_HOST_URL}}` placeholder substituted by `teams-package.yml` at build time.
- **Minimalism**: Sparse layouts, responsive design; prioritize high-value metrics.
- **Data Sourcing**: Tab SPA fetches from stamp backends (App Insights, Cosmos, config APIs) using Teams JWT (OBO flow).
- **Baking Historical Data**: Costs/tokens calculated and stored at runtime to handle pricing fluctuations.

### 3. Target Architecture (MVP Requirement)

> **Architecture Decision (#107):** Tabs use a **global SPA host + per-stamp backends** pattern.  
> See issue #107 for full rationale. The key insight: Teams manifest is a single global artifact; tab data is 95% stamp-specific. The solution is a stateless global SPA that routes to stamp-resident API backends client-side using Teams JWT identity.

1. **Tab Front-End — Global SPA** (`https://helkinswarm-tabs.z6.web.core.windows.net`):
   - Single-page app (vanilla JS + HTML) hosted on **Azure Storage static website** ($0.001/GB, scale-to-zero).
   - Served from `rg-helkinswarm-tabs` via the router UAMI.
   - One deployment, one URL, serves all users.
   - Built and deployed via `deploy-tabs.yml` (new workflow).
   - `{{TAB_HOST_URL}}` placeholder in `appPackage/manifest.json` substituted by `teams-package.yml` at build time.
   - During the furious development phase, the tab host also carries a source-controlled RG budget and post-deploy cost assertions so monitor resources cannot silently appear there (`#580`).

2. **Tab Backends — Per-Stamp Function App Endpoints** (`src/functions/tab*.ts`):
   - Each stamp's Function App exposes tab API endpoints (e.g., `/api/tab/getting-started`, `/api/tab/control-center`).
   - Return JSON/HTML; read from stamp's Cosmos DB, App Insights, and config.
   - Authenticated via Teams JWT (OBO flow — tab presents user's Entra token, stamp validates against known user list).
   - Stamp backends are implemented in Phase 3-4 alongside the features they display.

3. **Client-Side Routing**:
   - SPA reads `aadObjectId` from the Teams tab context JWT.
   - Looks up the user's stamp alias from `user-map.json` (bundled in the SPA at build time).
   - Calls `https://helkinswarm-func-{alias}.{domain}/api/tab/{name}` with the user's OBO token.
   - Gracefully handles unknown users (redirects to an error state, never a hard crash).

2. **Getting Started Tab**:
   - Static intro page with bootstrap guidance, onboarding ritual (0i), and help sub-area.
   - Links to repeat onboarding or advance to chat.

3. **Control Center Tab** (multi-sub-tabbed):
   - **User Configuration Sub-Tab**: Settings UI for preferences, model selections (global/EU toggle), safety mode.
   - **Debug Logs/Telemetry Viewer Sub-Tab**: Session logs with tokens/costs (guesstimated from metadata); historical roll-ups.
   - **Health View/Dashboard Sub-Tab**: Uptime, wake-up averages, model configs, RTT pings, token consumption.
   - **Dedicated Costs Sub-Tab**: Breakdown from Azure RG billing + external (OpenRouter); scoped to sessions/projects.

4. **Data Integration**:
   - Use UAMI for Azure Billing pulls; store baked costs in Cosmos for persistence.
   - External costs via provider APIs (e.g., OpenRouter last-30-days), integrated modularly (0a).

### 4. Key Use Cases (must work Day 1)
- New user opens Getting Started → Guided through onboarding, sees help docs.
- Owner checks Control Center → Views health metrics, toggles config, reviews session costs.
- Cost tracking: Displays Azure + OpenRouter breakdown for last 30 days, with baked historical accuracy.
- Mobile: Tabs render cleanly in horizontal view without overflow.

### 5. Integration Points
- **Teams Interface (10)**: Extends existing bot with tab definitions in manifest.
- **Deployment (12)**: Repackaging via `teams-package.yml`; auto-bump version on changes.
- **Observability (13)**: Sources metrics/telemetry; feeds dashboard views.
- **Auth (11)**: UAMI for billing; owner-only access to sensitive sub-tabs.
- **DevLoop (0g)**: Allows querying tab data via relay (e.g., "DEVQUERY: show health").
- **BYOK (0c)**: Modular external cost integration.

### 6. Security & Safety Considerations
- Tabs require Teams auth (via OBO JWT); sensitive data (costs, logs) owner-gated.
- The SPA validates the calling user's `aadObjectId` against the user-map before proxying to any stamp.
- Stamp backends verify the JWT before returning any data.
- No live billing access needed; use baked data to avoid admin perms.
- All views run through content safety checks.
- In EU mode, ensure data pulls respect boundaries.

### 7. What NOT to Do
- Do **not** add more than 2 top tabs — use sub-tabs instead.
- Do **not** host tab front-ends on durable Functions or Container Apps — use the global Azure Storage SPA (scale-to-zero, ~$0.001/GB). See #107.
- Do **not** store per-user tab data in the global SPA blob — keep all user data in the stamp's Cosmos/App Insights.
- Do **not** recalculate historical costs — bake at runtime.
- Do **not** overload with metrics; focus on high-value roll-ups.

### 8. Acceptance Criteria
- Tabs appear in Teams app after re-upload; render correctly on mobile/desktop.
- Getting Started guides onboarding successfully.
- Control Center sub-tabs pull and display real data (health, costs, logs).
- Cost breakdown includes Azure + external, with accurate baking.
- Changes require manifest update and cache refresh.

### 9. Backlog Linkage
- Extends 10 (Teams Interface), 13 (Observability), 12 (Deployment).
- Supports 0g (DevLoop), 0c (BYOK), 0l (Ethos — sensory insights).
- Ties into future virtual employees (0j) status views.

### 10. Implementation Phases

| Phase | Workstream | Deliverable |
|-------|-----------|-------------|
| **2.5** | Global tab host infra | `rg-helkinswarm-tabs` deployed, placeholder `index.html` served from Storage static website, `{{TAB_HOST_URL}}` in manifest verified resolving |
| **3** | SPA skeleton | Vanilla JS SPA deployed to Storage, tab navigation working, `user-map.json` bundled |
| **3** | Tab API stubs | `/api/tab/getting-started`, `/api/tab/control-center` return static data from each stamp |
| **4** | Full Control Center | Real data from Cosmos + App Insights via stamp tab backends |
| **4** | Dev Console | Real session/correlaton data via stamp tab backend, owner-gated |
