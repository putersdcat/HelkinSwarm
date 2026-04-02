**Here is the clean, full Markdown specification** ready for handoff to the Copilot / DevLoop agents.

```markdown
# HelkinSwarm Project Specification – Addendum Series
## 0s-Personal-vs-Business-Skills-Taxonomy-Meta-Ecosystem-Integrations-and-Virtual-Tax-Advisor.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Ready for implementation backlog  
**Owner:** Principal Developer  
**Date:** 2026-04-01

**Backlog umbrella:** #455 — [EPIC] Personal Skills Suite – Personal / Private Skill Track

### 1. Purpose & Vision

HelkinSwarm is intentionally designed as a **dual-use platform** — equally viable for personal and business/commercial use cases while remaining one unified codebase.

This addendum records the taxonomy, architecture decisions, and specific personal skills that have been discussed so the Copilot/DevLoop agents can begin implementation without ambiguity.

### 2. Skills Taxonomy & Manifest Clarification

Skills in HelkinSwarm are defined via declarative JSON manifests (see **0a-Modularity-and-Config.md**).

**Related backlog / schema references:**
- #194 — Skills Library System
- #196 — Skills Manifest Schema v2

**Important clarification on dependencies:**

- **Manifest-level dependencies** (`dependsOn`) are **skill-to-skill only**.  
  Example: `facebook-marketplace` can declare a dependency on `facebook-core` for shared auth and session state.
- **Infrastructure dependencies** (Cosmos DB, Foundry endpoint, OBO tokens, Key Vault, etc.) are **not** declared in the manifest.  
  These are handled at the bootstrap/config layer (Bicep parameters, environment variables, or skill-bootstrap hooks).

This keeps manifests clean, user-facing, and focused on functional relationships between skills.

Skills can be categorized as:
- **Personal / Private** — tied to an individual user’s accounts
- **Business / Commercial** — enterprise or team-facing
- **Hybrid** — rare; avoided where possible
- **Agnostic** — meta-skills (e.g. skill search) that do not fit either category

### 3. Personal-Facing Skills (Priority for Initial Development)

The following personal skills should be prioritized in the backlog:

#### 3.1 Facebook Personal Skill
- **Backlog issue**: #456
- **Prior related research**: #158 (closed as not planned)
- **Purpose**: On-demand life summaries of friends, family, and relations (primarily West Coast US network).
- **Key functionality**:
  - Natural-language queries: “What’s new with my family?” or “Summarize posts from Bob and Alice in the last week.”
  - Pull recent posts, photos, life events.
  - No real-time feed — pull on demand only.
- **Authentication**: User-linked personal Facebook account (OAuth or browser-based if API is restricted).

#### 3.2 Facebook Marketplace Skill
- **Backlog issue**: #457
- Separate skill (not merged into core Facebook).
- Can declare a manifest dependency on `facebook-core` for shared authentication.
- Focus: Search, browse, and notifications for personal buying/selling.

#### 3.3 Instagram Skill (Low Priority)
- **Backlog issue**: #459
- Image/video heavy microblogging platform.
- Very low priority due to token cost and limited personal use.
- Could be added later if demand increases.

#### 3.4 WhatsApp Skill
- **Backlog issue**: #458
- **Prior related research**: #156 (closed as not planned)
- Messaging integration.
- Potential secondary input/output stream (in addition to Teams).
- Long-term possibility: alternate delivery channel for certain notifications or conversations.

#### 3.5 Facebook Messenger Skill
- **Backlog issue**: #460
- **Prior related research**: #158 (closed as not planned)
- Treated as its own micro-app integration (separate from main Facebook feed).
- Messaging-focused.

**General rule**: Meta ecosystem apps should be implemented as **separate skills** rather than one monolithic hybrid skill. This aligns with the modular architecture (0a) and avoids mixing concerns.

### 4. Future Virtual Tax Advisor Employee (Post-MVP / Holy Grail)

**High-visibility backlog item** under the Virtual Employees framework (**0j**).

- **Backlog issue**: #461
- **Framework epic**: #101 — Virtual Employees & Nested Orchestrators

- Once the base platform can reliably spawn full nested orchestrators, one of the first virtual employees should be a **Virtual Tax Advisor / CPA**.
- Scope: Handle complex US tax situation (historical filings, amendments, payments).
- Leverage:
  - Outlook / document skills for receipt gathering
  - Memory vaults for historical tax data
  - Reasoning models for form completion and strategy
  - Human confirmation gates for final filing decisions
- This is a concrete example of turning a painful personal task into an autonomous virtual employee.

### 5. Commercial / Resellability Considerations

All skills and architecture decisions must preserve the ability to resell or open-source HelkinSwarm later.  
Key points:
- Clear separation between personal and business skill sets
- No hard-coded personal credentials or assumptions
- Manifests remain clean and reusable
- Safety pipeline and delegated identity model stay enterprise-grade

### 6. Backlog Items to Create / Update

- Existing epic / umbrella:
  - #455 — Personal Skills Suite
- Existing framework / schema issues:
  - #194 — Skills Library System
  - #196 — Skills Manifest Schema v2
  - #101 — Virtual Employees & Nested Orchestrators
- Related prior research already in the tracker:
  - #158 — Facebook Private Account Integration (closed as not planned)
  - #156 — WhatsApp Messaging Integration (closed as not planned)
- Child backlog issues created from this addendum:
  - #456 — Facebook Personal Skill (on-demand life summaries)
  - #457 — Facebook Marketplace Skill (dependent on core Facebook)
  - #458 — WhatsApp personal messaging integration
  - #459 — Instagram Skill (low priority)
  - #460 — Facebook Messenger Skill
  - #461 — Virtual Tax Advisor Employee (under the #101 framework)

### 7. What NOT to Do

- Do **not** create hybrid Meta mega-skills
- Do **not** put infrastructure dependencies in skill manifests
- Do **not** block personal skill development while maintaining commercial viability

---

**End of Addendum 0s**  
This document is ready for direct handoff to the Copilot / DevLoop agents.

We are the bridge.
```

---

Copy the entire block above and hand it off to the Copilot devs (or drop it into a new GitHub issue).  

It captures everything we just discussed cleanly, consistently with the rest of the spec library, and gives the agents clear, actionable direction.  

Let me know if you want any tweaks before you send it.