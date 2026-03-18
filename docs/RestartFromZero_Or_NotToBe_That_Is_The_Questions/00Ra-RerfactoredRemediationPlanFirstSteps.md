**Here is the single, combined master prompt** you can paste directly into one Copilot Chat session.  

It performs **both** steps in one go:  
- One-time setup (labels + instructions file update)  
- Full remediation (cleanup, tagging, reopening gaps)  

Copy-paste this exactly:

```markdown
You are now in FULL CLEANUP + SETUP MODE for HelkinSwarm v2.0.

**Phase 1 — One-time Setup (do this first):**
1. Ensure these two GitHub labels exist (create them if they do not):
   - `re-validated-clean`
   - `needs-reopen-gap`

2. Update (or create if missing) the file `.github/instructions/devloop-harness.instructions.md` and add this exact rule at the top:

```
When searching issues or running discovery/validation:
- ALWAYS exclude any issue that has label legacy-v1 OR re-validated-clean
- ONLY work on issues under milestone v2.0-MVP or that have needs-reopen-gap
```

**Phase 2 — Issue Remediation (immediately after setup):**

Task: Re-process EVERY issue in the repository (open + closed) that does NOT already have the label "re-validated-clean".

Rules (strict):
- For each issue, read ONLY: the issue body + first 5 comments. Ignore long noisy chains.
- Cross-reference the relevant sections in Docs/ (01–16 + 0a–0l + any LiveFeatures-Extracted.md).
- Pay special attention to these known critical gaps from codebase analysis:
  - subAgentActivity never being called
  - executorActivity never being called
  - human confirmation cards never being sent
  - stateManager being in-memory only
  - durable hooks having no creation path
  - missing OBO token threading
- Decision logic:
  - If the body matches the spec intent and there are no obvious IOUs, stubs, TODOs, placeholders, or missing wiring → 
    Add label: re-validated-clean
    Append ONE clean comment: "Re-validated 2026-03-17: matches spec. Comment chain compacted. Ready for DevLoop."
  - If any mismatch, buried IOU, stub, or missing critical layer (especially the gaps above) → 
    Add label: needs-reopen-gap
    Reopen the issue
    Delete ALL comments except the original body
    Append: "Reopened: noisy chain removed. Gap detected (IOU/stub/missing wiring). Re-assess in DevLoop."
- Process in batches of 20 issues.
- After each batch of 20, reply with a summary table:
  Issue # | Original Status | New Status | Label Added | Notes
- Never mark anything "done" yourself. Only tag and reopen where needed. DevLoop will handle final validation.

Start now. Perform Phase 1 setup first, then begin remediation. Use GitHub MCP for bulk operations wherever possible. Confirm when complete.
```

Paste it once. Let it run. When it finishes (and gives you the summary table), reply here with the table (or just say “done”) and we’ll immediately move to the next DevLoop pass that fixes the actual gaps.

This is the most session-efficient way possible. Ready?