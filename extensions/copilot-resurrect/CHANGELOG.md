# Changelog

## [1.4.4] - 2026-03-25

### Fixed
- **`.git\FETCH_HEAD` still leaked through v1.4.3**: Ignore matching is now evaluated against both the absolute file path and the workspace-relative path, instead of only the absolute path. This makes `.git/**`-style patterns reliable for watcher events originating inside the current workspace.
- **More robust git-noise filtering**: `.git/` internals are now short-circuited whenever the configured ignore patterns target `.git`, and the default ignore list now includes both `"**/.git/**"` and `".git/**"`.
- **Verification logging**: Ignored watcher events are now logged as `Ignored activity signal (...)` so you can confirm that `.git/FETCH_HEAD` is being skipped instead of bumping the heartbeat.

## [1.4.3] - 2026-03-25

### Added
- **`watchIgnorePatterns` setting**: New array setting (default `["**/.git/**"]`) for glob patterns that are excluded from workspace activity detection. Useful for silencing noise from git internals (e.g. `.git\FETCH_HEAD` being polled by `git fetch`), `node_modules`, build output dirs, or any other non-Copilot file changes. Supports `**` (any depth), `*` (within segment), and `?` (single char). The workspace FileSystemWatcher remains fully automatic — this setting only filters which signals are counted as activity.

### Fixed
- **`.git\FETCH_HEAD` false activity detection**: The workspace-root `FileSystemWatcher` (`**/*`) was resetting the silence timer every time git performed a background fetch, preventing resurrection. The default `watchIgnorePatterns` now excludes all `.git/` internals out of the box.

## [1.4.2] - 2026-03-24

### Fixed
- **Sub-agent activity detection overhaul**: The v1.4.1 listeners (`onDidChangeTextDocument`, `onDidSaveTextDocument`) only fired for files already open in editor tabs — useless when sub-agents write to disk without opening editors. Now uses five detection channels:
  1. **Workspace-root FileSystemWatcher** (`**/*`) — catches ALL file creates/edits/deletes in the workspace, even for files not open in tabs. This is the primary sub-agent signal.
  2. **Editor document events** — fires when open documents change in tabs (retained from v1.4.1).
  3. **File lifecycle events** (`onDidCreateFiles`, `onDidDeleteFiles`, `onDidRenameFiles`) — fires when extensions create/delete/rename files via the workspace API.
  4. **Terminal events** (`onDidOpenTerminal`, `onDidChangeActiveTerminal`) — fires when sub-agents spawn or switch terminals via `run_in_terminal`.
  5. **Terminal shell execution events** (VS Code 1.93+) — `onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution` for precise command-level detection.
- **`workbench.action.chat.retry` does not exist in VS Code 1.112.0**: The "Try Again" button in Copilot Chat is handled internally via webview `postMessage` and is not exposed as a registered VS Code command. Error-based triggers (rate_limit, server_error, etc.) now fall through to ignition-prompt resurrection — identical to silence triggers — rather than trying and failing the non-existent `chat.retry` command. The ignition prompt re-starts the conversation cleanly, which is functionally equivalent to what "Try Again" would do.

## [1.4.1] - 2026-03-24

### Fixed
- **`workbench.action.chat.focus` command not found**: Replaced with `workbench.action.chat.open` (which is known to work) for focusing the chat panel in both retry-in-place and ignition-prompt paths.
- **Sub-agent activity not detected by heartbeat**: Initial attempt at workspace-level activity listeners. Superseded by v1.4.2.

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
