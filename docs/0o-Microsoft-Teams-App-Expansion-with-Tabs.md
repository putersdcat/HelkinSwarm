# HelkinSwarm Project Specification – Addendum Series
## 0o-Microsoft-Teams-App-Expansion-with-Tabs.md

**Version:** 1.0 (Unchained Edition)  
**Status:** UI Enhancement – MVP Blocking for Control Features  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-16

### 1. Purpose & Vision
The Microsoft Teams App Expansion introduces dedicated tabs to the personal app, evolving it from a basic chat window into a comprehensive control hub. This addresses visibility gaps in costs, health, telemetry, and configuration while maintaining minimalism for mobile compatibility.

Aligned with the digital body ethos (0l), tabs serve as "sensory organs" — providing at-a-glance insights into the organism's state without disrupting the core conversational "brain" (chat). It emphasizes cost efficiency (tabs don't prevent durable functions from sleeping), user configurability, and historical accuracy (baked costs/telemetry).

This expansion integrates deeply with observability (13) and DevLoop (0g), making the system more self-aware and tunable.

### 2. Core Concepts
- **Top-Level Tabs**: Limited to 1-2 (Getting Started, Control Center) to preserve horizontal space on mobile.
- **Sub-Structure**: Each top tab loads a multi-tabbed web page for deeper navigation, hosted on non-durable endpoints (e.g., static Azure Web Apps) to allow sleep states.
- **Manifest-Driven**: Tabs defined in `appPackage/manifest.json`; changes require app repackaging and re-upload (12).
- **Minimalism**: Sparse layouts, responsive design; prioritize high-value metrics.
- **Data Sourcing**: Pull from App Insights (13), Cosmos (skill vaults 0i, durable hooks 0h), Azure Billing APIs, and external providers (e.g., OpenRouter costs).
- **Baking Historical Data**: Costs/tokens calculated and stored at runtime to handle pricing fluctuations.

### 3. Target Architecture (MVP Requirement)
1. **Tab Endpoints** (`src/functions/tab*.ts` extensions):
   - Fixed URLs in manifest (e.g., `/api/tab/getting-started`, `/api/tab/control-center`).
   - Render TypeScript/HTML views; fetch data via authenticated APIs.

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
- Tabs require Teams auth; sensitive data (costs, logs) owner-gated.
- No live billing access needed; use baked data to avoid admin perms.
- All views run through content safety checks.
- In EU mode, ensure data pulls respect boundaries.

### 7. What NOT to Do
- Do **not** add more than 2 top tabs — use sub-tabs instead.
- Do **not** host on durable functions; use sleep-friendly endpoints.
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
