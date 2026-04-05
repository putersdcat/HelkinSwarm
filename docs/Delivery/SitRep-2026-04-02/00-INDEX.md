# SitRep — 2026-04-02

Backlog issue: `#483`  
GitHub: https://github.com/putersdcat/HelkinSwarm/issues/483

## Why this dossier exists

This dossier was created at explicit user request to perform a holistic, multi-pass assessment of the current HelkinSwarm state versus:

- intended architecture
- delivery documentation
- open and closed backlog issues
- current shipped runtime and end-user Teams UX

The immediate trigger was a concern that the current app is drifting away from the intended product shape, especially around:

- skill readiness / operational-state UX
- follow-up continuity and quoted-reply behavior
- end-user exposure to confusing orchestration-heavy output
- possible optimism drift between "issue closed", "skill loaded", and "fully usable"

## Current audit status

This pass is evidence-backed but still intentionally conservative.

### Verified already

- The `graphenterprise` skill is **loaded** in the runtime and has a real MCP connector/auth path.
- The current readiness API and Skills UI **do conflate** loaded/installed state with actual operational readiness.
- The repo already contains **documentation warning against exactly this class of rollout drift**, but the current runtime behavior does not fully honor that guidance.
- Quoted-reply context is preserved into prompt construction, but I do **not** currently see it promoted into a first-class deterministic routing/follow-up mechanism.
- There is existing quoted-reply / clarification regression history in the backlog, so the current user confusion is not isolated or unprecedented.

### Not yet claimed

- I am **not** claiming the overall Graph Enterprise connector is fake; evidence points to a real integration path.
- I am **not** claiming the current quoted-reply experience is entirely broken in every path; there is clear history of partial fixes and feature slices.
- I am **not** claiming a single root cause yet for all perceived drift; the evidence currently supports **multiple overlapping drift vectors**.

## Headline assessment

At this moment, the strongest verified concern is **semantic drift in product-state reporting**:

- the codebase currently has no clean separation between **loaded**, **installed**, **linked**, **activation-ready**, and **fully operational**
- the Skills Library and install-readiness outputs can therefore present a capability as effectively ready while still listing operator/tenant/bootstrap steps that are outside normal chat-first user recovery

That is a user-trust problem, not just a wording nit.

The second strong concern is **continuity brittleness**:

- quoted replies and follow-up turns appear to rely heavily on prompt-level context carryover
- I do not yet see enough deterministic orchestration support to guarantee clean follow-up handling outside specific clarification-loop paths
- that makes the UX vulnerable to confusing, orchestration-flavored responses leaking into normal user interactions

## Artifact map

- `01-Findings-and-Evidence.md` — current verified findings with code/doc/issue evidence
- `02-Timeline-and-Execution-Options.md` — delivery timeline, current open topic map, and strategy options
- `03-Open-Workstreams-Snapshot.md` — compact appendix of major open workstreams and the recent closure wave
- `04-Issue-Thread-Deep-Dive.md` — second-pass archaeology of key issue/comment chains
- `05-Codepath-Deep-Dive.md` — second-pass audit of the most relevant runtime codepaths
- `06-Claims-vs-Reality-Matrix.md` — third-pass decision matrix comparing docs/issues/code/runtime reality
- `07-Delivery-Path-Options.md` — concrete route choices for the next delivery wave, with tradeoffs and a recommended default
- `08-Backlog-Attack-Ideas.md` — new ideas for governing and attacking the large open backlog after the SitRep
- `09-Backlog-Control-Surface.md` — compact Now/Next/Later/Icebox control surface for future repeated ignition runs

## Backlog outputs from this pass

- `#484` — Distinguish loaded/installed from operational state in Skills Library and skill readiness UX
- `#485` — Follow-up skill verification can drift into health/discovery prose instead of execution proof

## Initial recommendation

Before resuming background delivery loops, prioritize a **stability-and-honesty correction pass** over further surface expansion:

1. fix skill operational-state semantics and UI/status reporting
2. tighten continuity / quoted-follow-up handling and user-facing response discipline
3. only then continue broad new skill/platform expansion

Otherwise the system risks looking richer while feeling less trustworthy.
