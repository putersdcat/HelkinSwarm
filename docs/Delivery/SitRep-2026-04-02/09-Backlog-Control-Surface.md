# Backlog Control Surface — For Repeated Ignition Runs

## Purpose

This is the compact operating surface for future repeated backlog-reduction runs.

Use this file so the agent does **not** re-rank the entire open backlog from scratch every time.

The main lesson from the SitRep is that the backlog is too large and mixed to be treated as one giant flat list.

## Constitutional update — 2026-04-02 Living Mind Contract

The creation of:
- `#494` — `[EPIC] Living Mind Runtime – Single-Session Temporal Consciousness`
- `#498` — `Implement Limbic System + MindSessionGuard + Chrono-Backplane (0za)`

changed the operating model for repeated ignition runs.

This means ordinary campaign ordering is now subordinate to one rule:

> If the current target issue is explicitly blocked by the Living Mind constitutional foundation, the ignition loop must clear the blocker work first instead of churning on the downstream ticket.

---

## Core operating rules

### 0. Constitutional blockers outrank normal zone order
If an issue in Zone A or Zone B is explicitly blocked by the Living Mind foundation (`#494` / `#498`), the loop must not keep selecting that downstream issue as though the block does not exist.

Instead:
- treat the blocker-removal work as the active campaign,
- prefer `#498` as the executable target,
- treat `#494` as the governing epic / control surface,
- and if `#498` is too large for one honest run, split the smallest real child slice and work that.

### 1. Only Zone A issues compete by default
Future ignition runs should choose from **Zone A — Now** unless:
- every Zone A issue is honestly complete,
- or every Zone A issue is blocked,
- or the user explicitly changes the campaign.

### 2. Epics are control surfaces, not default implementation targets
Issues like `#194`, `#448`, `#462`, and `#472` should usually be treated as:
- campaign anchors
- issue selectors
- design boundaries

They should **not** be the default implementation target unless a run is explicitly doing epic decomposition or the epic itself contains a narrow executable slice.

The same now applies to `#494`: it governs the work, but `#498` (or a smaller child split from it) is the normal executable target.

### 3. Recurring issues do not compete with shipping work
These remain important, but they are non-competing rails:
- `#3`
- `#5`
- `#202`
- `#372`

Use them to sync docs/architecture after meaningful delivery, not as the main target of a shipping run.

### 4. Confidence classes
Use this shorthand in issue comments and reasoning:
- **C0** — concept only
- **C1** — researched
- **C2** — repo-grounded
- **C3** — locally validated
- **C4** — live validated

### 5. Closure discipline
For user-facing issues, closure comments should ideally include a proof bundle:
- files changed
- tests run
- build result
- live validation status
- exact boundary of what was and was not proven

---

## Constitutional Gate — Active Now

## Active campaign: Living Mind Foundation Campaign

This campaign still outranks the ordinary Trust Recovery order wherever the target issue is explicitly blocked by the Living Mind Contract.

However, the constitutional surface is now **much narrower** than it was when this file was first written.

### Recently cleared first-wave slices (no longer competing)

These are now shipped/closed and should not continue to masquerade as the active front:

- `#525` — capacity-aware impairment routing
- `#526` — autonomic sub-session preservation
- `#527` — enforced Limbic ingress lifecycle

Other major bridge slices under `#498` / `#520` have also been cleared since this control surface was first drafted, including steering injection, chrono continuity, interruption breadcrumbing, interruption-depth cap behavior, paused-task paging seams, and the explicit `awaiting-ingress` drain window.

### Current live constitutional stack

| Order | Issue | Lane | Confidence | Why it is here now |
|---|---|---|---|---|
| 0 | `#498` | Constitutional foundation / runtime continuity | C3 | The parent first-wave enforcement issue remains open, but most of its major bridge pieces are now shipped. The remaining gap is concentrated in the last hard single-session/event-drain/runtime-continuity tranche. |
| 0a | `#494` | Constitutional epic / control surface | C2 | Governing epic and blocker anchor. Still the constitutional source of truth, but not the default direct implementation target. |
| 0b | `#516` | Hard single-session enforcement | C2 | This is now the main open constitutional child: the runtime still preserves compatibility-managed behavior instead of proving a hard one-living-session invariant. |
| 0c | `#520` | Event-draining living session architecture | C2 | The active architectural parent below `#516`: the runtime has a multi-turn ingress seam now, but it still does not honestly prove a fully reliable event-draining living session during active processing. |
| 0d | `#556` | Active-processing event drain blocker | C2/C4-failed | Current deepest blocker. A `NewMessage` raised into an already-active living overseer can still be accepted as delivered without later showing `LivingSessionNewMessageDrained`, `ReplySent`, or a visible final reply. |
| 0e | `#554` | Ordinary Teams overlap outside `awaiting-ingress` | C2 | Still a real user-facing seam, but no longer the deepest blocker. Ordinary Teams overlap remains queue-first outside the narrow proven-safe `awaiting-ingress` window. |
| 0f | `#555` | Drained turn sub-orchestrator identity seam | C3 local / C4 failed | A real corrective fix has already shipped here, but live proof showed it was not sufficient. Treat this as a subordinate seam unless `#556` is cleared first. |

### Constitutional gate execution rule
- If the next candidate issue is explicitly marked blocked by `#494` and/or `#498`, do not run the normal Zone A ordering.
- Prefer the active live constitutional stack above rather than the now-cleared `#525` / `#526` / `#527` tranche.
- Default next-work bias inside the constitutional gate is now:
	1. `#556`
	2. then `#554`
	3. then collapse `#520`
	4. then close `#516`
	5. then close `#498`
- Resume ordinary Zone A ordering only when the blocker has been cleared, narrowed, or explicitly re-bucketed.

---

## Zone A — Now

## Active campaign: Trust Recovery Campaign

This is the default campaign once the constitutional gate is honestly cleared enough to stop blocking downstream work.

These issues remain important, but the table below must now be read with one caveat in mind:
- `#485` and `#479` remain constitutionally downstream of the Living Mind runtime work
- `#484` appears partially delivered in repo code already and may need narrowing/re-bucketing rather than greenfield implementation

This tranche continues until these issues are either:
- live-validated and closed, or
- honestly re-bucketed as blocked / superseded / split.

| Order | Issue | Lane | Confidence | Why it is here |
|---|---|---|---|---|
| 1 | `#484` | Trust / UX honesty | C2-C3 | Still an important trust/UX target, but no longer an untouched concept gap. Backend operational-state modeling and tab rendering exist; remaining work appears to be semantics cleanup, consistency, and honest closure review. |
| 2 | `#485` | Trust / UX honesty | C2 | Important trust issue and still constitutionally downstream. Follow-up execution-proof routing appears partially hardened in code, but not yet honestly live-proven. |
| 3 | `#479` | Runtime bug / trust | C2 | Concrete Outlook execution drift remains open. Deterministic Outlook execution shortcuts now exist in code, but deployed primary/secondary-lane proof is still missing. |

### Zone A execution rule
Future ignition runs should normally work these in the order above.

Exception: if the selected issue is explicitly blocked by `#494` / `#498`, the Constitutional Gate above takes precedence.

If one fails live validation and spawns a narrower follow-up bug, the new bug may replace it in Zone A if it is the more honest next slice.

### Recently cleared Zone A item

- `#480` — closed; remove it from active competition.

---

## Zone B — Next

## Next campaign: Enterprise Readiness Campaign

These issues are the strongest next wave **after Zone A**, not during it by default.

| Issue | Lane | Confidence | Role |
|---|---|---|---|
| `#501` | LLM provider stability / quota relief | C2 | High-priority runtime/provider abstraction to relieve Foundry quota pressure and stabilize orchestrator reasoning; strong promotion candidate once the constitutional gate and trust tranche are under control |
| `#462` | Microsoft / M365 strategic capability | C1 | Epic control surface for official Microsoft MCP operational-control work |
| `#472` | Microsoft / M365 strategic capability | C1 | Sub-epic control surface for operational admin workflows |
| `#476` | Runtime readiness / M365 | C1 | Best first narrow implementation slice in the M365 admin family |
| `#481` | Platform / MCP hygiene | C1 | Keeps integrated MCP skills maintainable and traceable |
| `#482` | Platform / MCP hygiene | C1 | Improves discovery honesty between installed skills and external candidates |
| `#439` | Runtime bug / capability completion | C2 | Good follow-on once Outlook read/search execution is trustworthy |
| `#243` | Microsoft / directory capability | C1 | High-value strategic skill, but should follow readiness honesty improvements |

### Zone B promotion rule
Promote a Zone B item into Zone A only when:
- the active Trust Recovery Campaign is complete enough,
- or Zone A is blocked,
- or the user explicitly chooses to switch campaigns.

Current note:
- `#501` is now the strongest non-constitutional infrastructure candidate in Zone B because it directly targets Foundry quota instability and reasoning reliability.
- Near-term planning directive: once the Living Mind constitutional gate is cleared enough to permit promotion, `#501` should be treated as the most likely next campaign pivot because repeated fallback onto `gpt-5.4-mini` is not considered a strong enough long-term orchestrator reasoning substrate for the new runtime reality. The desired outcome is to restore Grok 4.1 Fast as the normal reasoning lane via the OpenRouter provider abstraction from `0zb`, while keeping the switch reversible.

---

## Zone C — Later

These are real and valuable, but they should not compete with the two campaigns above right now.

| Issue | Lane | Confidence | Why deferred |
|---|---|---|---|
| `#448` | Platform / MCP | C1 | Important epic, but not the best immediate execution target while trust and readiness debt are still active |
| `#194` | Skills platform | C2 | Broad epic; should absorb honest state/lifecycle work after current trust slices settle |
| `#473` | Microsoft / M365 | C1 | Depends on clearer readiness and control-plane shape |
| `#474` | Microsoft / M365 | C1 | Same |
| `#475` | Microsoft / M365 | C1 | Same |
| `#467` | Platform / Foundry | C1 | Strategic, but not current bottleneck |
| `#468` | Research | C0-C1 | Interesting, but not pressure-worthy now |
| `#392` | Infra / safety | C1 | Valuable substrate, but not current top leverage for user trust |
| `#434` | Skills / LLM specialist | C1 | Expansion work, not current campaign |
| `#435` | Skills / LLM specialist | C1 | Expansion work, not current campaign |
| `#436` | Testing / benchmark | C1 | Useful later, but not more urgent than the trust and enterprise readiness paths |
| `#398` | Cost / GitHub visibility | C1 | Nice strategic enhancement, not near-term control surface |
| `#397` | Cost / GitHub visibility | C1 | Same |
| `#249` | Virtual company | C1 | Northbound strategic capability, not next practical tranche |
| `#244` | Skills / memory | C1 | High-value, but currently outcompeted by trust and M365 readiness |
| `#240` | Skills | C1 | Valuable but not now |
| `#239` | Skills | C1 | Valuable but not now |
| `#238` | Skills | C1 | Valuable but not now |

---

## Zone D — Icebox / speculative / non-competing

These should remain visible, but they should not pressure ordinary ignition runs.

### Personal / speculative skills
- `#455`
- `#456`
- `#457`
- `#458`
- `#459`
- `#460`
- `#176`
- `#180`

### Research-heavy or long-horizon concept work
- `#157`
- `#161`
- `#162`
- `#179`
- `#207`
- `#461`

### Dreaming / optional Night Watch concepts (parked behind `0z` signal)
- `#489` — Dreaming remains conceptually promising as subconscious memory maintenance, but it should not pressure implementation until the Living Mind foundation has real runtime signal.
- `#493` — Night Watch is now deprioritized as a generic system and retained only as a possible later specialization / Virtual Employee use case.

### Major future architecture north-stars
- `#101`
- `#102`
- `#103`
- `#90`
- `#94`
- `#88`
- `#68`
- `#69`
- `#70`
- `#71`
- `#75`
- `#76`
- `#78`

These are not unimportant. They are simply not allowed to crowd the current shipping loop unless explicitly promoted.

---

## Practical ignition behavior

When future ignition runs start, the agent should behave as follows:

1. Read this file first.
2. Check whether the Constitutional Gate is active for the next candidate issue.
3. Choose from the Constitutional Gate first when it blocks the downstream target; otherwise choose from Zone A.
4. Treat the top non-blocked item from the active surface as the default next target.
5. Use confidence class language in progress comments.
6. Do not widen back to the whole open backlog unless the Constitutional Gate, Zone A, and Zone B all require reconfiguration.

---

## Current recommendation encoded in this control surface

### Default next-work bias
- clear the Living Mind constitutional blocker honestly whenever it blocks downstream work
- treat the active remaining constitutional stack as:
	- `#556`
	- then `#554`
	- then collapse `#520`
	- then `#516`
	- then `#498`
- once that gate is honestly cleared enough, continue the Trust Recovery Campaign
- then move to Enterprise Readiness Campaign
- only then reopen broader platform/skills expansion pressure

### Refresh note — 2026-04-04

This control surface now reflects the main post-SitRep decomposition that happened after the original draft:
- the early constitutional bridge slices are no longer the active front
- the remaining constitutional work is concentrated in the hard active-session event-drain / hard-single-session-enforcement seam
- the strongest immediate blocker is `#556`

That is the intended operating model until explicitly changed.