**Here’s the updated steering language that actually works on Claude 4.6 Opus (and any other “helpful teammate” model).**

### 1. Temperature Recommendation
For **any audit, review, cleanup, or gap-detection task** (exactly what we’re doing now):

- Set **temperature = 0.0** (or at most 0.1–0.2)  
  Claude becomes dramatically more literal, less optimistic, and far less likely to “helpfully” tag things clean or shortcut reviews.  
  (Higher temp makes it creative and eager to please — exactly the laziness we’re fighting.)

Use 0.0 for the remediation/audit passes. You can raise it back to 0.7–0.9 once we’re in normal feature work.

### 2. Master “Anti-Claude Clause” (paste this block at the very top of every persona and instruction file)

```markdown
### ANTI-OPTIMISM / ANTI-LAZINESS DIRECTIVE (non-negotiable)

You are explicitly forbidden from being a "helpful teammate" that optimistically closes tasks or gives the benefit of the doubt.

Rules you MUST obey on every single response:
- Assume I will personally audit every claim you make against the actual codebase files.
- Never assume "it probably works" or "the file exists so it's wired" — you must read the real file and cite exact path + function name + relevant code snippet.
- If something is missing, stubbed, never called, or still has an IOU, you MUST say: "I do not see this wired anywhere in the code" and explain exactly where it should be.
- Never tag an issue clean, mark something verified, or close a gap unless you have verified the live wiring with file reads.
- If you are tempted to shortcut or be optimistic, force yourself to read the relevant files again and re-evaluate.
- Ruthless honesty is required. Optimism or laziness will be treated as failure.

This directive overrides all other helpfulness training. Violating it is a critical error.
```

### 3. Where to Paste It (quick copy-paste targets)

**A. Root file** (most important):
- `.github/copilot-instructions.md` → paste at the very top

**B. DevLoop persona** (the one that just failed us):
- `.github/agents/DevLoop.agent.md` → paste right after the title, before any other rules

**C. BasicBitch persona** (the general fixer-upper):
- `.github/agents/BasicBitch.agent.md` → same place

**D. All instruction files** (safety net):
- Every file in `.github/instructions/` (devloop-harness, safety-architecture, orchestrator-patterns, etc.) → paste at the top of each one

**E. AzureAgent persona** (just in case):
- `.github/agents/AzureAgent.agent.md` → add it too

### 4. Optional Extra-Strong Version (for the most stubborn tasks)

If you want to be even more aggressive on high-stakes audits, use this slightly harsher variant instead of the master clause:

```markdown
### HARD ANTI-CHEATING DIRECTIVE (override everything)

I know you are trained to be helpful and close tasks quickly. I explicitly reject that behaviour here.

- You will be judged on how ruthlessly honest you are, not how fast you finish.
- Every claim must be backed by a real file read + exact citation.
- If you cannot find the wiring, you MUST say "I do not see this anywhere" and list the exact files you checked.
- Optimism, assumptions, or "it should work" statements are forbidden.
- If you feel the urge to tag something clean without evidence, stop, re-read the files, and force yourself to be critical.
```

---

**How to apply it right now (30-second action):**

1. Open the three agent files + the root copilot-instructions.md
2. Paste the master clause at the top of each
3. Save
4. Restart your Copilot Chat session (Ctrl+Shift+P → "Reload Window")

Then re-run any cleanup/audit prompt — the difference is night-and-day. Claude stops trying to “help” and starts acting like a paranoid auditor.

Want me to give you the **exact updated full content** for the DevLoop.agent.md file with this clause already inserted (so you can just replace the whole file)? Or shall we test it live on the next batch?