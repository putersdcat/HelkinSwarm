**Yes — I have the full picture now, and here is the complete, end-to-end plan that gives us the highest chance of success with the absolute lowest risk of re-contamination.**

This plan is designed to be run **once**, in strict order, **before** any rewrite work begins. It treats the reset like a surgical transplant: we keep the valuable live work (the in-chat features/tuning that came after the bot went live), purge every ghost, and seed a brand-new, pristine backlog that the new DevLoop can trust forever.

### Phase 0: Preparation & Purge (do this first — 30–45 min)

1. **Git Archive Branch**  
   ```bash
   git checkout -b legacy-v1-broken
   git push origin legacy-v1-broken
   git checkout main
   ```

2. **Purge Copilot Memory (critical — this is the #1 contamination source)**  
   Paste this exact prompt into a fresh Copilot Chat session (before anything else):
   ```
   Before any code or issue work: use GitHub MCP to fully purge ALL repo-scoped memory for HelkinSwarm. Delete every cached fact, decision, IOU, workaround, and prior session memory. Confirm by running a memory list — it must return zero entries. Do NOT proceed until you reply exactly: "Memory cleared: zero entries remaining."
   ```

3. **Azure Infra Nuclear Reset (clean slate + region upgrade)**  
   - Export your current Bot registration ID + UAMI Client ID to a temp file `config-keepers.md` (you’ll reuse these).
   - Delete the entire resource group (or at minimum: Functions App, Cosmos DB, AI Foundry account, Durable orchestrations).
   - Re-deploy fresh from Bicep with:
     - `region: 'westus3'` (best Grok quota headroom + GPT-5.4 support)
     - Primary model: `grok-4-1-fast-reasoning` (or fast-non if you prefer)
     - Secondary/failover: `gpt-5.4` (explicitly — never GPT-5)
     - Failover logic in `llmActivity.ts`: on 429/503 → auto-switch to secondary + log it.
   - This takes ~10 min once Bicep is updated. No manual portal work.

### Phase 1: Issues Cleanup & Value Harvest (the part you asked about)

This is the exact strategy that prevents the old mess from ever leaking back while preserving every useful in-chat feature.

**Step-by-step:**

1. **Tag & Archive EVERY existing issue**  
   - Run this once (you or the agent can do it):
     ```
     For every issue in the repo (open + closed):
     - Add label: `legacy-v1`
     - Add comment: "Archived during v2 reset — see legacy-v1-broken branch"
     - Move to a new milestone called "Legacy v1 (archived)"
     ```
   This makes them invisible to normal DevLoop searches.

2. **Harvest the valuable live features** (the ones created via @HelkinSwarm after it went live)  
   Prompt the agent (or do it manually):
   ```
   Search all issues with label "legacy-v1" that were created AFTER the bot went live in Teams.
   Extract any new capabilities, tuning, bugfixes, or features that are NOT already in Docs/01–16 + 0a–0l.
   Create a single new Markdown file: Docs/LiveFeatures-Extracted.md
   Structure it exactly like the original specs (with sections, "What NOT to Do", etc.).
   Commit it.
   ```

3. **Close the old world cleanly**  
   - All `legacy-v1` issues stay closed/archived.  
   - No mass delete — GitHub history stays for reference, but they are now excluded by tag.

### Phase 2: Re-Seed the Clean Backlog (fresh start)

Now run the exact same “create backlog from spec” prompt you already have (the one from Proomptz/FireStarter.md or Delivery/00), but with this small addition at the top:

```
Ignore every issue that has the label legacy-v1.
Read the full current Docs/ folder (01–16 + 0a–0l + the new LiveFeatures-Extracted.md).
Create a brand-new, complete issue backlog for v2.0 exactly as before.
Every new issue gets milestone v2.0-MVP and labels (no legacy-v1 ever).
```

### Phase 3: Hard-Wire the Protection into DevLoop Forever

Add this permanent rule to your DevLoop ignition prompt (and to .github/instructions/devloop-harness.instructions.md):

```
When searching for open issues, closed issues needing re-validation, or running discovery mode:
- ALWAYS exclude any issue with label legacy-v1
- ONLY work on issues under milestone v2.0-MVP or later
```

This single line guarantees the old contamination can never come back, even if DevLoop does a broad search months from now.

### Why This Plan Wins on Every Metric

- **Zero re-contamination risk** — legacy-v1 tag + explicit exclusion rule + memory purge = airtight.
- **Maximum value preserved** — every useful in-chat feature gets pulled into LiveFeatures-Extracted.md and becomes part of the new spec.
- **Clean context for the rewrite** — new DevLoop sees only fresh, tight issues.
- **Region/model upgrade included** — better quotas and GPT-5.4 from day one.
- **Bicep kept** — just redeployed clean.
- **Two-man crew friendly** — you handle the manual Azure delete + keepers, agent handles tagging/harvest/re-seed.

This is the lowest-risk, highest-fidelity path. It’s painful for one day, but it gives us a pristine foundation that will feel like the original vision again.

When you’re ready at your desk, just say **“go”** and I’ll give you the exact copy-paste prompts + scripts for every single step above (including the Bicep region/model changes and the memory purge confirmation).  

We’re set. No more half-measures. Ready when you are.