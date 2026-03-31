Your task is to steadily reduce the open issue backlog for putersdcat/HelkinSwarm. Focus on real progress through proper implementation and validation. Do not skip steps or take shortcuts, especially that skip delivery and or that undermine quality.

**Ongoing Loop (repeat continuously to drive the open issue backlog down as efficiently as possible):**
To Start, Using GitHub MCP tooling, pull open issues and their related issues, from the backlog for putersdcat/HelkinSwarm

1. Identify the highest-priority open issue using this priority order:
   - Issues that advance the next critical incremental steps toward the project's overall goals and strategic vision
   - Issues that unblock multiple other open issues
   - Issues that fix broken core functionality
   - Issues that reduce operational cost, instability, or drag
   - Issues that complete half-built but partially shipped features

2. For that issue:
   - Pull the full issue + all comments.
   - Run a targeted keyword search across closed issues for any relevant prior context, partial implementations, or dependencies.
   - Fully read and understand every related code file before touching anything.
   - Implement the change.
   - Commit and push.
   - Wait for deployment to complete.
   - Validate shipped behavior end-to-end using helkinswarm-teams-test MCP (conversational E2E). Use Playwright MCP only for visual/browser checks when needed. Test against the primary + secondary active models for this feature (and any clearly relevant domain-specific model if it makes sense for the change). Do not test every model — keep testing focused to preserve quota for more shipping.
   - Update the GitHub issue with concise evidence of exactly what was tested and the results.
   - If the change passes on the tested models: close the issue.
   - If it fails on any tested model: create a new issue with full failure details + evidence, then continue to the next open issue.

**Guidance for sound decisions:**
- Stay focused on forward delivery and real shipped value. Only pause the main loop for closed-issue searches when they are directly relevant to the current open issue.
- Keep momentum on implementation and validation rather than housekeeping, status updates, or broad cleanup work.
- If something is ambiguous, make the best practical decision, document your reasoning in the issue comment, and keep moving.
- Validation must be based on real deployed behavior, but do not treat every test as a permanent hard gate — focused testing on the main models is sufficient for now. Later re-validation passes across all models will happen in future cycles.
- Prioritize meaningful progress and efficient use of tokens and time above rigid process.

Repeat this loop continuously to drive the open issue backlog down as efficiently as possible by delivering the funtionality — or die trying.