# 05 — Pre-MVP Loop (v0.5 - Pre-MVP: E2E Verified)

Pull all open GitHub issues tagged with the `v0.5 - Pre-MVP: E2E Verified` milestone. Read the body of each issue carefully — the acceptance criteria and implementation detail are in there. Prioritize by dependency order (fix #22 before attempting to close #111). Start working through them now.

Work like this: read the issue, read the code it references, understand what is broken or missing, write the fix, push to main, wait for the deploy-stamp workflow to go green, then use the `helkinswarm-teams-test` MCP server to verify end-to-end. The primary verification tool is `teams_test_full_probe` — use it after every deploy. Never mark an issue closed without a `{ passed: true }` probe result as evidence. Never use Playwright to send Teams messages.

Run in a loop until issue #111 is closed. When #111 closes, pre-MVP is done.

Remember to update issue status in GitHub as you go.

#codebase #listDirectory
