# Changelog

## [1.4.0] - 2026-03-17

### Changed
- **Retry-in-place for error triggers**: Rate-limit, server error, content-filtered, and unknown-error triggers now invoke `workbench.action.chat.retry` (the "Try Again" button) in the **existing** session instead of starting a new session. This preserves the full conversation history and lets the model resume interrupted work.
- Error-based triggers no longer require an ignition prompt — they simply retry the last request.
- If the retry command fails (e.g., no prior response to retry), gracefully falls back to ignition-prompt resurrection.
- Silence and manual triggers continue to use the existing ignition-prompt injection workflow (new session or focus existing, based on `startNewSession` setting).
- Updated `startNewSession` setting description to reflect that error triggers always retry in-place.
- Resurrection engine refactored into two clear paths: `_retryInPlace()` for error triggers and `_ignitionPromptResurrect()` for silence/manual triggers.

## [1.3.0] - 2026-03-17

### Added
- **Agent Mode Picker**: Discovers custom agents from `.github/agents/*.agent.md` in the workspace (parses YAML frontmatter for description). Built-in modes (agent/edit/ask) always available.
- New command: `Select Agent Mode` — QuickPick of built-in + workspace agents.
- New setting: `agentMode` — persists the selected agent mode.
- Resurrection sequence now switches to configured agent mode via `workbench.action.chat.switchChatMode` after creating a new session.

## [1.2.0] - 2026-03-16

### Changed
- **Eliminated clipboard injection** — resurrection now uses `workbench.action.chat.open` with `{ query, isPartialQuery }` + `workbench.action.chat.submit`. No more clipboard save/restore. No more paste race conditions.
- **Exponential backoff** replaces fixed cooldown — rate-limit failures now double the wait time each time (base × 2^consecutive, capped at max). Resets on successful non-rate-limit resurrection.

### Added
- **Model Picker**: `Select Preferred Model` and `Select Fallback Model` commands enumerate available models via `vscode.lm.selectChatModels({ vendor: 'copilot' })`.
- **Chat Participant Picker**: `Select Chat Participant` command lets you prefix the ignition prompt with `@copilot`, `@workspace`, `@vscode`, or `@terminal`.
- **Approvals Mode Picker**: `Select Approvals Mode` command — choose Default / Bypass / Autopilot with a reminder shown for non-default modes.
- New settings: `preferredModel`, `fallbackModel`, `chatParticipant`, `approvalsMode`, `rateLimitCooldownBaseSeconds`, `rateLimitCooldownMaxSeconds`, `startNewSession`, `contentCheckEnabled`.
- New commands: `Reset Exponential Backoff`, model/participant/approvals pickers (7 new commands total).
- Extension icon.

### Removed
- `modelHint` setting replaced by `preferredModel` + `fallbackModel` pickers.
- Clipboard-based prompt injection (entirely eliminated).

## [1.0.0] - 2026-03-09

### Added
- Initial MVP release of **Copilot Resurrect**.
- `SessionWatcher`: Monitors Copilot Chat session files for silence using `vscode.FileSystemWatcher` + heartbeat polling.
- `ResurrectionEngine`: Clipboard-paste-based prompt injection + `workbench.action.chat.submit`.
- Daily restart counter persisted via `ExtensionContext.globalState` with automatic midnight reset.
- Status bar item showing watcher state and daily restart count.
- Full set of commands: Enable, Disable, Toggle, Test Resurrection (dry-run), Show Status, Reset Counter, Show Log, Configure Prompt.
- Settings schema: `enabled`, `ignitionPrompt`, `silenceTimeoutSeconds`, `maxRestartsPerDay`, `modelHint`, `watchPaths`.
- Dynamic path discovery for Copilot Chat session files (workspaceStorage + globalStorage + OS fallbacks).
- Dedicated Output Channel "Copilot Resurrection Watcher" for all telemetry.

[1.4.0]: https://github.com/putersdcat/copilot-resurrect/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/putersdcat/copilot-resurrect/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/putersdcat/copilot-resurrect/compare/v1.0.0...v1.2.0
[1.0.0]: https://github.com/putersdcat/copilot-resurrect/releases/tag/v1.0.0
