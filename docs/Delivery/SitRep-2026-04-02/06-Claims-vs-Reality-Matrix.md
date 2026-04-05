# Claims vs Reality Matrix — Third Pass

## Purpose

This matrix condenses the SitRep into decision-grade comparisons between:
- intended/documented claim
- issue-level delivery claim
- current code/runtime evidence
- confidence level
- practical next move

## Matrix

| Topic | Intended / documented claim | Issue-thread claim | Current code / runtime evidence | SitRep judgement | Next move |
|---|---|---|---|---|---|
| Skills Library management surface | Skills tab should be a genuine management surface, not browse-only | `#376` closure claims inspect/manage/reload surface is shipped | `tabs/app.js` + `src/functions/tabSkills.ts` do show manage/readiness/uninstall-impact/reload paths | **Mostly true** in the narrow sense | Keep `#376` closed; focus on the deeper semantics gap instead |
| Skill readiness truthfulness | Config-gated / operator-gated skills must not be exposed as normally ready without preflight/fallback honesty | `#371` delivered rollout standard in docs only | `inspectSkillInstall()` still returns `ready` while listing activation steps; catalog/UI still collapse loaded vs operational | **Drift is real** | `#484` should be prioritized |
| `graphenterprise` integration existence | Graph Enterprise MCP should exist as a built-in delegated reporting slice | `#465` closed as repo-side integration slice, not as universal live tenant query proof | manifest + connector + scoped-token tests are real; tenant/bootstrap truth is still environment-dependent | **Underlying integration is real; product presentation overstates readiness** | Do not reopen `#465`; fix readiness semantics via `#484` and future preflight checks |
| `web` skill rollout honesty | Web search should not appear normal-user-ready if API-key setup is still missing | `#371` docs explicitly call `web` the anti-pattern example | `skills/web/handlers.ts` still throws on missing `BRAVE_SEARCH_API_KEY`; manifest still says `automatic-agentic` | **Drift is real and systemic** | Use `web` as the canonical regression test for `#484` |
| Clarification loop baseline | Bot should ask, resume, and cancel clarification loops cleanly | `#408` final comments show clean live validation for the base slice | code and issue history support that the base clarification loop is genuinely shipped | **Mostly healthy** | Do not treat the whole clarification loop as suspect |
| Quoted clarification replies | Quoted clarification answers should not strand placeholders | `#431` closed with live evidence that the ack-stranding bug was fixed | code now includes stronger dedup handling and issue closeout includes successful quoted cancel / resume traces | **Fixed narrowly** | Do not over-attribute current confusion to the old `#431` bug |
| Discovery metadata follow-up routing | Discovery metadata should help get from identification into execution | `#400` final comments show the calendar-create action path revalidated on both lanes | current code uses `effectiveTaskMessage` in later routing stages; some action paths appear healthy | **Healthy in some important paths, not universally** | Avoid blanket claims; focus on the still-open non-core drift family |
| Non-core read/search follow-up execution | Once a tool is discovered, follow-up prompts should be able to execute it cleanly | `#479` remains open because live Outlook read/search still drifted into discovery metadata | open issue plus `discoveryToolInjection.ts` output strings support this as a real current gap | **Open real gap** | Keep `#479` open and relate it to `#485` |
| User-facing response discipline | End users should see clean outcomes, not internal orchestration-flavored narration | several older bugs addressed leaks and placeholder issues | code still explicitly emits strings like `I stayed in discovery-only mode` and `No non-discovery tools were executed.` | **Current behavior still intentionally exposes internal orchestration framing** | Tackle under `#485` or a later UX-discipline follow-up if needed |
| Overall architecture direction | Project should remain modular, discovery-first, safe-by-architecture, and self-improving | many recent issue closures suggest broad delivery momentum | second-pass evidence suggests architecture is broadly on-course, but product-edge semantics lag | **Not off-course overall; suffering from maturity debt at the product edge** | Prioritize a stability-and-honesty correction wave before major new surface expansion |

## Executive synthesis

### What appears fundamentally sound
- MCP connector and Graph Enterprise integration seams
- base clarification loop feature
- Skills Library management infrastructure
- discovery metadata follow-up routing for at least some high-value action flows

### What appears fundamentally under-modelled
- skill operational readiness state
- follow-up execution-proof handling after status/discovery answers
- user-facing narration discipline when discovery does not transition into execution

### What appears most misleading if left alone
- `ready` meaning something weaker than users naturally read it as
- assistant replies that sound like internal orchestration state instead of product behavior
- backlog closures that were narrow/true technically being mistaken for broader end-user completion

## Recommended practical reading order for the owner

1. `00-INDEX.md`
2. `01-Findings-and-Evidence.md`
3. `04-Issue-Thread-Deep-Dive.md`
4. `05-Codepath-Deep-Dive.md`
5. this matrix
6. `02-Timeline-and-Execution-Options.md`

That order moves from evidence to nuance to decision framing.