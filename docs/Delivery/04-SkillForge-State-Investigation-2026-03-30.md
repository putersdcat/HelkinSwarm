# SkillForge State Investigation — 2026-03-30

## Executive answer

The current `Forge Create A Receipts Parser Skill V367a` item is **not** a real implemented receipts-parser skill.

It is a **SkillForge-generated prototype scaffold / placeholder custom skill** that was:

1. generated through the modern `/forge` prototype flow,
2. persisted as a bundle,
3. then **promoted into tracked repository files on `main`**,
4. and finally made loadable/discoverable after follow-up fixes.

It is **not** backed by a pull request in the main repository, and I do **not** see any branch history for it in the current repository state.

That absence is not accidental. Current verified evidence shows the `V367a` artifact was promoted through an **owner-side direct repo write / direct-to-main promotion path**, while the in-bot GitHub App write path remains permission-limited and currently falls back to a manual owner workflow.

So your intuition was basically right:

- it **is** functioning as a stand-in / scaffold / placeholder,
- it **was** used to validate adjacent SkillForge lifecycle slices,
- and it is currently better understood as a **test/prototype artifact proving workflow slices** than as a finished end-user skill.

## What the `V367a` skill actually is in the repo today

### Files that exist

Current custom skill folder:

- `skills/custom/forge-create-a-receipts-parser-skill-v367a/manifest.json`
- `skills/custom/forge-create-a-receipts-parser-skill-v367a/handlers.ts`

### What the manifest says

`skills/custom/forge-create-a-receipts-parser-skill-v367a/manifest.json` defines:

- `domain: "forge-create-a-receipts-parser-skill-v367a"`
- `displayName: "Forge Create A Receipts Parser Skill V367a"`
- `shortDescription: "SkillForge prototype for: create a receipts parser skill v367a"`
- one tool: `forge_create_a_receipts_parser_skill_v367a_run`

This is already a giant tell: the manifest literally describes itself as a **SkillForge prototype**.

### What the handler does

`skills/custom/forge-create-a-receipts-parser-skill-v367a/handlers.ts` exports:

- `forge_create_a_receipts_parser_skill_v367a_run`

Its implementation returns:

- `status: 'prototype'`
- `skillId: 'forge-create-a-receipts-parser-skill-v367a'`
- `message: 'SkillForge prototype placeholder for Forge Create A Receipts Parser Skill V367a.'`

That means this is **definitively a placeholder tool**, not a receipts parser implementation.

It does not parse receipts. It reports that it is a prototype placeholder.

## Why there is no PR or branch history

### What I verified

Git history for the custom skill files shows:

- `6de15ec` — `feat(#367): promote SkillForge bundle forge-create-a-receipts-parser-skill-v367a`
- `be2ca46` — `fix(#390): correct custom skill scaffold imports` (handler file repair)

Branch search for `*skillforge*` returned **no branches**.

Pull request search for `forge-create-a-receipts-parser-skill-v367a` returned **no PRs**.

### What that means

The current `V367a` artifact entered the repository through a **direct commit on `main`**, not via a PR.

That matches the modern issue history:

- issue `#367` explicitly says the downstream lifecycle was validated via **owner-side promotion into tracked repository files**
- commit cited there: `6de15ec018708729f3c06bb30d444dbece4865b4`
- issue `#389` confirms the in-bot self-promotion path still lacked GitHub App contents-write permission, so the validated route was an owner-side fallback rather than autonomous in-app PR creation

So the lack of PRs is not a mystery. It is the current architecture reality.

## Current architecture reality vs intended SkillForge vision

## Current reality

Based on current code and issue history, the live modern SkillForge path is:

1. user invokes `/forge <idea>`
2. bot routes the request into the overseer/session path
3. `skillForgePrototypeActivity` creates a **prototype bundle**
4. `skillForgeBundleStore` persists the bundle to Azure Blob Storage
5. the bot replies with a persisted bundle path and review metadata
6. an owner can promote the bundle into repository files
7. custom skill loading / hot reload then makes the promoted scaffold discoverable

### Key code evidence

`src/orchestrator/skillForgePrototypeActivity.ts`

- `buildSkillForgePrototype()` builds a scaffolded manifest/handler/test bundle
- the generated summary explicitly says:
	- `SkillForge prepared a PR-ready prototype bundle`
	- `Owner approval gate: run /forge promote <persisted-bundle-path>`

`src/orchestrator/skillForgeBundleStore.ts`

- persists prototype bundles under `bundles/<userId>/<skillId>/<correlationId>.json`

`src/orchestrator/skillForgePromotion.ts`

- current promotion target is:
	- `branch: 'main'`
	- commit message format: `feat(#367): promote SkillForge bundle ...`

This is important: current code does **not** open a GitHub PR here. It pushes reviewed files to `main` if permissions allow, or returns a manual fallback if they do not.

## Intended long-term vision

Older spec / archival / epic material still describes a richer future SkillForge vision:

- ephemeral containerized generation
- GitHub App auth
- branch creation
- PR creation
- an isolated Stage 4.5 development execution lane between branch creation and review
- safety scan / review gates
- human approval and merge
- hot reload after merge

That intended vision is still represented by open foundation issues:

- `#75` — `[EPIC] SkillForge Ephemeral Skill Creator` — **OPEN**
- `#76` — `SkillForge container architecture & base image` — **OPEN**
- `#77` — `SkillForge GitHub App auth for PR creation` — **OPEN**
- `#78` — `SkillForge sandbox, security boundaries & prompt` — **OPEN**

So the old PR/branch-based SkillForge idea is **not gone**. It just is **not the current completed live path**.

## Critical clarification about the no-PR / no-branch rule

The strong trunk-only / no-PR / no-branch directives in the Copilot instructions are for **VS Code backlog agents delivering core HelkinSwarm work directly**.

They are **not** a prohibition on the in-product SkillForge feature creating branches and PRs as part of its intended workflow.

That distinction matters because a reader could otherwise falsely conclude that the PR-based SkillForge vision was abandoned for policy reasons. I do **not** see evidence of that. The repo instead shows a temporary owner-side promotion bridge while the fuller SkillForge lifecycle remains unfinished.

## Clarified future stage map

The current repo reality is easiest to understand with these stages separated explicitly:

- **Stage 3** — durable artifact persistence (already prototyped)
- **Stage 4** — repo handoff / branch + PR creation (still incomplete as the default live path)
- **Stage 4.5** — isolated development execution path for generated skill branches
- **Stage 5** — automated review stack before final human/chat-participant approval

New backlog coverage added for the missing later stages:

- `#401` — Stage 4.5 isolated development execution path for generated skill branches
- `#402` — Stage 5 automated validation and intelligent review before final human merge

## Chosen initial Stage 4.5 subset

After re-reading the current repo state, the most practical first-pass Stage 4.5 decision is:

- choose **GitHub-hosted coding-agent execution** as the initial isolated development lane for generated SkillForge branches
- keep **Azure-hosted execution** as a later extension path, not a prerequisite for the first usable Stage 4.5 slice

Why this is the right initial subset:

- the repo already frames SkillForge as a repo/branch/PR-centered workflow
- the current missing pieces around GitHub App auth and review gates already point toward GitHub-hosted iteration as the next natural bridge
- this avoids building a parallel Azure-hosted coding workspace before the simpler branch-centric path is proven

This does **not** mean the product is finished. It means the Stage 4.5 architecture choice is no longer ambiguous.

### Initial Stage 4.5 guardrails

The chosen initial subset should carry explicit limits:

- 1 active Stage 4.5 job per requester/stamp
- 3 coding-agent iteration rounds max
- 2 workflow/job retries max for the same generated branch
- branch-local work only; no direct `main` writes from Stage 4.5
- smallest viable validation set first
- hard timeout / fail-closed behavior instead of infinite iteration

That gives the Stage 4 -> 4.5 -> 5 handoff enough shape to be actionable while the broader SkillForge epic remains open.

## Current state of the SkillForge feature area

Below is the most useful way to think about the current state.

### Delivered / validated slices

#### 1. Hot-reload foundation exists

- `#79` — `Hot-reload capability loader on SkillForge merge` — **CLOSED / delivered**

Meaning:

- capability loader + `/reload skills` path are in place
- hot-reload foundation is real, even though the full PR-based SkillForge story is not finished

#### 2. `/forge` is enabled on the dev stamp

- `#355` — **CLOSED / delivered**

Meaning:

- deployed dev stamp now enables `SKILLFORGE_ENABLED=true`

#### 3. `/forge` no longer dead-ends silently

- `#356` — **CLOSED / delivered**
- `#271` — **CLOSED / delivered on user-facing terms**

Meaning:

- `/forge` now produces a visible reply with prototype scaffold information instead of disappearing

#### 4. `/forge` was moved back behind the true overseer/session flow

- `#357` — **CLOSED / delivered**

Meaning:

- the prototype path is no longer just a direct bot-side shortcut
- persisted bundle paths now surface from the orchestrated path

#### 5. Persisted bundle -> promoted repo files lifecycle was validated

- `#367` — **CLOSED / delivered with caveat**

Meaning:

- persisted bundle creation works
- owner-side promotion into tracked repo files was validated
- the promoted custom skill became discoverable after follow-up fixes

#### 6. Promotion-path follow-up fixes shipped

- `#389` — **CLOSED**, but only the **user-facing fallback** is fixed
- `#390` — **CLOSED / scaffold import path fixed**
- `#391` — **CLOSED / nested `skills/custom/**` loading fixed**

Meaning:

- scaffolded custom skill imports were repaired
- nested custom skill discovery/load logic was repaired
- in-bot promotion now fails gracefully instead of dumping a raw 403 blob

### Still open / not fully delivered

#### 1. The core epic remains open

- `#75` — `[EPIC] SkillForge Ephemeral Skill Creator` — **OPEN**

Its acceptance criteria still describe a larger final state than what is currently live:

- ephemeral Docker container on demand
- GitHub App auth for PR creation
- full sandbox
- full safety pipeline
- hot-reload on merge

So the overall SkillForge epic is **not finished**.

#### 2. Containerized SkillForge execution remains open

- `#76` — **OPEN**

This is the base-image / isolated container part of the original vision. I do not see this as fully delivered in the current modern path.

This issue should now be read as adjacent to, but not identical with, the explicit Stage 4.5 execution-lane issue `#401`.

#### 3. True GitHub App PR-creation flow remains open

- `#77` — **OPEN**

This is the clearest explanation for your PR-history question.

If `#77` were really delivered end to end in the current live path, I would expect to see PR/branch artifacts for the modern `V367a` exercise. I do not.

Instead, current live evidence shows:

- direct owner-side promotion to `main` was the validated route
- in-bot GitHub write is still permission-limited and only gracefully falls back

So **PR creation is still an intended capability, not the currently validated default path**.

Issue `#77` should be interpreted with the clarified policy scope above: PR/branch creation remains valid product behavior for SkillForge even though VS Code backlog agents stay trunk-only.

#### 4. Full sandbox / security boundary story remains open

- `#78` — **OPEN**

The modern prototype/persist/promote path exists, but the older SkillForge sandbox vision is still not shown as complete by current open issue state.

Issue `#402` now carries the distinct Stage 5 review/approval stack so that sandbox/security scope and review-gate scope are not conflated.

## Important nuance about `#389`

`#389` is **closed**, but that does **not** mean the bot now has working GitHub contents-write permission.

What the closure actually means:

- the raw ugly 403 behavior was replaced by a structured, guided fallback
- `/forge promote` now tells the owner what to do next instead of exploding badly

What it does **not** prove:

- that the deployed bot GitHub App now has the required contents-write permission
- that in-bot self-promotion is fully unblocked
- that automatic PR-based SkillForge delivery is active

So from a user-facing/runtime standpoint `#389` is fixed.
From a broader SkillForge-autonomy standpoint, the underlying GitHub permission gap still matters.

## Best current interpretation of `Forge Create A Receipts Parser Skill V367a`

The cleanest characterization is:

> `Forge Create A Receipts Parser Skill V367a` is a **prototype scaffold artifact** that was intentionally used to validate the newer SkillForge lifecycle slices: persisted bundle creation, owner-side promotion into repo files, nested custom-skill loading, and discovery/hot-reload behavior.

It is **not** evidence that SkillForge currently generates fully implemented production skills.

It is also **not** evidence that the PR/branch-based SkillForge vision is live.

It is evidence that HelkinSwarm now has a **real but still partial SkillForge pipeline**:

- yes: prototype scaffold generation
- yes: persisted bundle storage
- yes: owner-approved promotion path
- yes: custom skill loading after promotion
- no: actual receipts-parser implementation
- no: validated autonomous PR/branch workflow as the current main path
- no: full ephemeral-container / sandbox / GitHub-App-PR story completed end to end

## Delivered / open / blocked matrix

| Area | Current status | Notes |
|---|---|---|
| `/forge` visible reply | Delivered | `#356`, `#271` closed |
| SkillForge enabled on dev stamp | Delivered | `#355` closed |
| Overseeing/session-orchestrated prototype path | Delivered | `#357` closed |
| Persisted bundle creation | Delivered | `#357`, `#367` |
| Owner-side promotion into repo files | Delivered / validated | `#367` cites commit `6de15ec...` |
| Promoted scaffold buildability | Delivered | `#390` fixed nested import path |
| Nested `skills/custom/**` loading | Delivered | `#391` fixed loader recursion/pathing |
| Graceful fallback when bot lacks GitHub write permission | Delivered | `#389` closed on runtime UX terms |
| Actual receipts parser functionality | **Not delivered** | current handler is placeholder |
| In-bot autonomous repo write | Partially blocked / not truly delivered | still permission-limited; fallback exists |
| GitHub App PR creation as live default path | **Not delivered** | `#77` still open |
| Ephemeral SkillForge container architecture | **Open** | `#76` |
| Full SkillForge sandbox/security boundary implementation | **Open** | `#78` |
| Overall SkillForge epic | **Open** | `#75` |

## SkillForge issue ledger

| Issue | Title | State | Practical reading |
|---|---|---|---|
| `#75` | `[EPIC] SkillForge Ephemeral Skill Creator` | Open | Canonical epic still open; final end-state not finished |
| `#76` | `SkillForge container architecture & base image` | Open | Containerized execution vision still open |
| `#77` | `SkillForge GitHub App auth for PR creation` | Open | True PR/branch flow still open |
| `#78` | `SkillForge sandbox, security boundaries & prompt` | Open | Full sandbox/security boundary story still open |
| `#79` | `Hot-reload capability loader on SkillForge merge` | Closed | Hot-reload foundation delivered |
| `#271` | `feat: implement end-to-end SkillForge orchestration and PR handoff` | Closed | Closed on user-facing prototype result; deeper lifecycle split out |
| `#355` | `Enable SkillForge on the dev stamp for live /forge validation` | Closed | Config enablement delivered |
| `#356` | `Enabled /forge can still produce no visible live reply` | Closed | Visible `/forge` reply bug fixed |
| `#357` | `SkillForge: move prototype path back behind true orchestrator + PR handoff flow` | Closed | Orchestrated prototype + persisted bundle path delivered |
| `#367` | `SkillForge: verify promotion + hot-reload lifecycle after persisted bundle creation` | Closed | Owner-side promotion + loader lifecycle validated |
| `#389` | `SkillForge promotion hits 403 on GitHub contents preflight lookup` | Closed | Raw failure replaced with guided fallback; permission limitation still matters strategically |
| `#390` | `Promoted SkillForge custom skill scaffold breaks Deploy Stamp build` | Closed | Custom scaffold import path fixed |
| `#391` | `Promoted custom skills are not loaded from skills/custom nested folders` | Closed | Nested custom skill loading fixed |

### Related-but-broader skills platform issues

These are adjacent skills-system work rather than the narrow SkillForge flow itself:

| Issue | Title | State | Relevance |
|---|---|---|---|
| `#197` | `Skills Library Tab – 3rd Teams App Tab` | Closed | UI surface where forged skills can appear |
| `#199` | `Skill Lifecycle Management & Maintenance Tasks Framework` | Closed | Skill lifecycle framework, broader than SkillForge |
| `#200` | `Skills Onboarding, Dependency Resolution & Uninstall Protection` | Closed | Skills platform governance; not the core forge pipeline |

## Practical answer to your original question

If you are asking:

> “Should I think of `Forge Create A Receipts Parser Skill V367a` as a real productized skill?”

The answer is:

**No.**

You should think of it as:

- a promoted prototype scaffold,
- intentionally used to exercise the newer SkillForge lifecycle,
- and currently serving as a proof artifact for the custom-skill loading/promotion path.

If you are asking:

> “Was it used as a stand-in while adjacent SkillForge workflow slices were delivered?”

The answer is:

**Yes, very much so.**

That interpretation is consistent with:

- the placeholder handler behavior,
- the issue chain `#355` → `#356` → `#357` → `#367` → `#389/#390/#391`,
- the lack of PR/branch history,
- and the direct-to-`main` promotion commit history.

## Suggested next-step interpretation for backlog work

If future work is resumed on SkillForge, the cleanest remaining top-level gaps are:

1. finish the **real GitHub App PR/branch creation path** (`#77`)
2. finish the **containerized/sandboxed SkillForge execution model** (`#76`, `#78`)
3. decide whether direct-to-`main` owner promotion is a temporary bridge or a permanent supported mode
4. stop using placeholder prototype skills as proof artifacts once stronger end-to-end fixtures exist
5. if desired, either remove or clearly label prototype-only promoted custom skills so they are not mistaken for finished capabilities

## Evidence used for this investigation

### Code / repo state

- `skills/custom/forge-create-a-receipts-parser-skill-v367a/manifest.json`
- `skills/custom/forge-create-a-receipts-parser-skill-v367a/handlers.ts`
- `src/orchestrator/skillForgePrototypeActivity.ts`
- `src/orchestrator/skillForgeBundleStore.ts`
- `src/orchestrator/skillForgePromotion.ts`
- git history for the promoted `V367a` files

### GitHub issues

- `#75` — open SkillForge epic
- `#76` — open container/base image issue
- `#77` — open GitHub App PR auth issue
- `#78` — open sandbox/security issue
- `#79` — closed hot-reload foundation issue
- `#271` — closed user-facing `/forge` prototype result issue
- `#355` — closed enablement on stamp
- `#356` — closed visible reply fix
- `#357` — closed reroute behind overseer + persisted bundle path
- `#367` — closed downstream promotion/hot-reload lifecycle validation
- `#389` — closed graceful fallback for GitHub permission failure
- `#390` — closed scaffold import path fix
- `#391` — closed nested custom-skill loading fix

### Branch / PR checks

- branch search for `*skillforge*` — no current repo branches found
- PR search for `forge-create-a-receipts-parser-skill-v367a` — no PRs found
