Your sole task is to clear the open issue backlog for putersdcat/HelkinSwarm using GitHub MCP tooling. Do not deviate, summarize, or skip steps.

**Mandatory Loop (repeat until open issues = 0):**

1. Identify the single highest-priority open issue using this exact order:
   - Unblocks multiple other open issues
   - Fixes broken core user-facing functionality
   - Reduces operational cost, instability, or drag
   - Completes half-built but partially shipped features

2. For that issue:
   - Pull the full issue + all comments.
   - Run a targeted keyword search across closed issues for any relevant prior context, partial implementations, or dependencies.
   - Fully read and understand every related code file before touching anything.
   - Implement the change.
   - Commit and push.
   - Wait for deployment to complete.
   - Validate shipped behavior end-to-end using helkinswarm-teams-test MCP (conversational E2E). Use Playwright MCP only for visual/browser checks when needed. Test against the primary + secondary active models for this feature; do not test every model unless model-specific failure is suspected.
   - Update the GitHub issue with concise evidence of exactly what was tested and the results.
   - If it passes on all tested models: close the issue and apply the "devloop-validated" label.
   - If it fails on any model: create a new issue with full failure details + evidence, then continue.

**Strict Rules (non-negotiable):**
- Never perform broad sweeps, re-certification, or audits of closed issues unless they directly block the current open issue or show clear regression.
- Never interrupt forward delivery for housekeeping, status theater, or low-value cleanup.
- Never ask for clarification. Make the best decision possible, document reasoning in the issue comment, and proceed immediately.
- Validation must always use real deployed behavior. No exceptions.
- Prioritize shipped progress and token efficiency above all else.

Run this loop continuously against the open issue backlog until it is crushed — or dye trying.