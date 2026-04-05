# Issue Thread Deep Dive — Second Pass

## Purpose

This pass goes beyond issue titles and bodies into the actual closure/update comments on the most relevant threads.

The goal is to distinguish between:
- issues that were closed optimistically,
- issues that were closed honestly but narrowly,
- issues whose fixes exposed a separate downstream problem family.

## 1. Skills Library / readiness UX thread cluster

### `#376` — Skills Library management gap

Second-pass reading changes the interpretation here in an important way.

#### What the thread proves
The issue was not closed on fantasy grounds. The closure comments explicitly point to:
- `tabs/app.js`
- `src/functions/tabSkills.ts`
- owner-only readiness / uninstall-impact / reload actions
- live-hosted bundle evidence

So the narrow claim of `#376` appears honestly satisfied:
- the Skills Library is no longer browse-only
- there is a real inspect/manage/reload surface

#### What it does **not** prove
It does **not** prove the current management/readiness semantics are sufficient.

The second-pass code audit shows a different gap:
- the management surface exists,
- but the operational-state model behind it is still too weak/truthy-light.

So `#376` being closed is not necessarily drift.
The deeper gap is the new one now tracked in `#484`.

### `#371` — rollout standards for config-gated skills

This thread is also honestly narrow.

#### What it delivered
- docs updates in `docs/05-Capabilities-Framework.md`
- explicit `operator/backend-config-required` classification
- preflight readiness expectations
- graceful fallback requirements
- `skills/web/` documented as the anti-pattern

#### Why it matters for the SitRep
The problem is not that the standard is missing.
The problem is that current runtime/UI behavior has not fully absorbed that standard.

This is a strong signal of **policy-to-runtime drift** rather than documentation absence.

## 2. Graph Enterprise thread cluster

### `#465` — Microsoft Graph Enterprise MCP integration

This thread is especially important because it shows how the current confusion arose.

#### What the closeout actually claimed
The closure comment is more careful than the in-app wording the user later encountered.

It explicitly says the issue closed because the repo-side integration slice was proven:
- built-in skill exists
- delegated HTTP MCP bearer-header path exists
- Enterprise MCP scope pack exists in code
- provisioning / audit design is documented
- live bot can discover and inspect the skill on both active lanes

It also explicitly says it did **not** claim a live tenant query against the Microsoft-owned Enterprise MCP service.

#### SitRep interpretation
This means the backlog closeout was relatively honest.
The confusing part is the **product/runtime presentation layer** that later described the skill as available and functional in a stronger sense than the delivery issue actually proved.

That again points back to operational-state semantics, not necessarily fake underlying integration work.

## 3. Clarification / quoted reply / continuity cluster

### `#408` — first usable clarification loop

The comment thread shows a disciplined progression:
- first partial validation
- blocker follow-ups opened
- later clean validation
- explicit separation of the quoted-reply seam into `#431`

This is an example of a thread that appears to have been handled with reasonable honesty.

### `#431` — quoted clarification replies could strand the ack

This thread is crucial because it narrows the current suspicion.

#### What it proves
The original failure mode was fixed by `7025784`.
The closure comment includes live evidence that:
- quoted clarification replies no longer strand the ack
- quoted `cancel` reaches a terminal visible reply
- quoted usable answers resume into downstream handling

#### What it also reveals
Even after the quoted-reply seam was fixed, the resumed usable-answer path could still end in a **separate downstream routing/tool exposure problem**.

That means:
- the old quoted-reply bug should not be over-generalized into today’s entire continuity concern
- but the user’s current confusion still fits a broader downstream behavior gap family

## 4. Discovery / follow-up routing cluster

### `#400` — carry discovery metadata into stronger follow-up routing

The thread matters because it shows that some discovery-to-action routing paths are genuinely fixed now.

By the final closeout comment, both `/heavy` and `/light` calendar-create probes were again reaching confirmation successfully.

#### SitRep interpretation
This argues against a blanket “discovery routing is broken everywhere” claim.
The reality is more selective:
- some high-value, well-exercised action flows appear to be healthy
- other non-core read/search flows still drift into discovery output

### `#479` — Outlook read/search validation drift

This thread is one of the strongest current live-gap signals.

It documents that even after deterministic follow-up routing work shipped:
- a natural Outlook mailbox search prompt still returned discovery metadata
- actual read/search execution remained unproven on the deployed bot

#### Why this matters to the current SitRep
This issue looks much closer in shape to the user’s current `graphenterprise` verification complaint than the older quoted-clarification bug does.

The common pattern is:
- skill/tool is discoverable and described
- user asks for concrete proof or action
- runtime falls back into discovery/metadata prose instead of clean execution

## 5. Thread-level conclusion

The second-pass issue archaeology supports a more nuanced conclusion than the first pass:

### Not supported
- “everything recent was closed lazily”
- “quoted replies are still fundamentally unwired”
- “Graph Enterprise is fake under the hood”

### Better-supported
- several narrow issue closures were actually honest within their stated boundaries
- the real present-day drift is often in the **translation from narrow technical delivery into product-facing truthfulness**
- the biggest recurring weakness is the handoff from:
  - discovery / description / inspection
  - into real execution / proof / operational usability

That handoff seam now looks like one of the highest-value targets for the next corrective wave.