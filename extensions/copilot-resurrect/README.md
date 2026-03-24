# Copilot Resurrect

> **Keep your autonomous GitHub Copilot Chat loops alive — overnight, unattended, indefinitely.**

[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](https://github.com/putersdcat/copilot-resurrect)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC.svg)](https://code.visualstudio.com/)

---

## The Problem

GitHub Copilot Chat is uniquely powerful for running autonomous coding agents using Frontier models. A well-crafted **ignition prompt** can instruct Copilot to:

- Pull open backlog items from GitHub Issues
- Implement, test, and commit them
- Update issue status
- Loop indefinitely

These workflows routinely run **5–18+ hours** unattended — when they stay alive. But Copilot Chat sessions terminate unpredictably due to:

- Server-side throttling or rate-limit errors
- Token-limit / context-window overflows on session rollover
- Transient network / data-centre failovers (TCP reset)
- Model-router errors that bypass the built-in retry mechanism
- Content-filtered responses that silently kill the session

When termination happens, the chat panel simply **stops**. No restart. No alert. Hours of autonomous work lost.

**Copilot Resurrect solves this.** It watches for silence and content-based error patterns, detects a dead session, and automatically re-injects your ignition prompt to start a fresh session — all while you sleep.

---

## Features

| Feature | Detail |
|---|---|
| 🔍 **Dual Detection** | Silence-based (`FileSystemWatcher` + polling heartbeat) and content-based error scanning of session files |
| 🔄 **Auto Resurrection** | Opens Copilot Chat, injects your ignition prompt via the VS Code chat API, and submits — no clipboard, no human required |
| ⏱️ **Configurable Timeout** | 60–600 second silence window before declaring a session dead (default: 180s) |
| 📈 **Exponential Backoff** | Rate-limit cooldowns double on each consecutive failure (base × 2^n, capped) instead of fixed delays |
| 🛡️ **Daily Rate Cap** | Configurable max restarts per calendar day (default: 50) to prevent infinite storms |
| 💾 **Persistent State** | Restart counter and backoff state persist across VS Code restarts via `globalState` |
| 🤖 **Agent Mode Picker** | Discovers custom agents from `.github/agents/*.agent.md` in your workspace + built-in modes (agent/edit/ask) |
| 🎯 **Model Picker** | Enumerates available Copilot models via `vscode.lm.selectChatModels()` for preferred + fallback selection |
| 💬 **Participant Prefix** | Optionally prefix the ignition prompt with `@workspace`, `@copilot`, `@vscode`, or `@terminal` |
| ✅ **Approvals Mode** | Choose Default / Bypass / Autopilot approvals for resurrected sessions |
| 🆕 **New Session Control** | Start fresh sessions on resurrection, or retry in the existing panel |
| 📊 **Output Log** | Full timestamped log in the **Copilot Resurrection Watcher** Output Channel |
| 🟢 **Status Bar Item** | Live status indicator with cooldown countdown |
| 🧪 **Dry Run Test** | Test the full resurrection sequence without actually submitting |

---

## Quick Start

### 1. Install

Install the `.vsix` directly:

```
code --install-extension copilot-resurrect-1.3.0.vsix
```

Or install from the Extensions Marketplace (when published).

### 2. Configure Your Ignition Prompt

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
Copilot Resurrect: Configure Ignition Prompt
```

Enter the prompt you want Copilot to receive every time a session is resurrected.

### 3. Select Agent Mode (optional)

```
Copilot Resurrect: Select Agent Mode
```

Pick from built-in modes (agent, edit, ask) or your custom workspace agents (e.g. BasicBitch, AzureAgent, DevLoop). The extension auto-discovers `.github/agents/*.agent.md` files.

### 4. Enable the Watcher

```
Copilot Resurrect: Enable Watcher
```

The status bar will show `$(debug-restart) Resurrect ON`. You're live.

### 5. Walk Away

Open your Copilot Chat panel, queue your ignition prompt manually, and let it run. Copilot Resurrect will keep it alive in the background.

---

## Configuration Reference

All settings are available under **Settings → Extensions → Copilot Resurrect** or in `settings.json`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Enable/disable the watcher |
| `ignitionPrompt` | `string` | `""` | The prompt injected on resurrection |
| `silenceTimeoutSeconds` | `number` | `180` | Seconds of silence before resurrection triggers (60–600) |
| `maxRestartsPerDay` | `number` | `50` | Maximum auto-restarts per calendar day (1–200) |
| `preferredModel` | `string` | `""` | Preferred Copilot model (select via command) |
| `fallbackModel` | `string` | `""` | Fallback model after rate-limit (select via command) |
| `chatParticipant` | `string` | `""` | Chat participant prefix (`copilot`, `workspace`, `vscode`, `terminal`) |
| `agentMode` | `string` | `""` | Agent mode for resurrected sessions (select via command) |
| `approvalsMode` | `string` | `"default"` | Approvals mode: `default`, `bypass`, `autopilot` |
| `rateLimitCooldownBaseSeconds` | `number` | `30` | Base cooldown for exponential backoff (5–300) |
| `rateLimitCooldownMaxSeconds` | `number` | `600` | Max cooldown cap for backoff (60–3600) |
| `startNewSession` | `boolean` | `true` | Start new chat session on resurrection |
| `contentCheckEnabled` | `boolean` | `true` | Enable content-based error detection in session files |
| `watchPaths` | `string[]` | `[]` | Override auto-discovered watch paths (advanced) |

All settings are prefixed with `copilot-resurrect.` in `settings.json`.

### Example `settings.json` entry

```jsonc
"copilot-resurrect.enabled": true,
"copilot-resurrect.ignitionPrompt": "Pull the next open GitHub Issue, implement it, test it, commit it, close the issue, then loop.",
"copilot-resurrect.silenceTimeoutSeconds": 240,
"copilot-resurrect.maxRestartsPerDay": 40,
"copilot-resurrect.agentMode": "BasicBitch",
"copilot-resurrect.approvalsMode": "bypass",
"copilot-resurrect.startNewSession": true
```

---

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---|---|
| **Enable Watcher** | Start monitoring for silence / errors |
| **Disable Watcher** | Stop monitoring |
| **Toggle Watcher** | Toggle enabled/disabled |
| **Show Status** | Print current state to log + info toast |
| **Test Resurrection (dry run)** | Walk through the sequence without submitting |
| **Configure Ignition Prompt** | Set/update the ignition prompt via input box |
| **Select Preferred Model** | Pick from available Copilot language models |
| **Select Fallback Model** | Pick a fallback model for rate-limit scenarios |
| **Select Chat Participant** | Choose a chat participant prefix |
| **Select Agent Mode** | Pick from built-in + workspace custom agents |
| **Select Approvals Mode** | Choose Default / Bypass / Autopilot |
| **Reset Daily Restart Counter** | Reset today's count to zero |
| **Reset Exponential Backoff** | Clear the consecutive rate-limit counter |
| **Show Output Log** | Open the Copilot Resurrection Watcher Output Channel |

---

## How It Works

### Detection

```
SessionWatcher
  │
  ├─ FileSystemWatcher → github.copilot-chat/chatSessions/*.json
  │     onDidChange / onDidCreate / onDidDelete → bump last-activity timestamp
  │
  ├─ Content-based error scanner (tail 4KB of session files)
  │     Detects: rate_limit, server_error, content_filtered patterns
  │     Triggers immediate resurrection with appropriate backoff
  │
  └─ 15-second polling heartbeat
        if (now - lastActivity) >= silenceTimeoutSeconds → trigger resurrection
```

Path discovery is automatic and prioritised in this order:
1. `workspaceStorage/<hash>/github.copilot-chat/chatSessions/`
2. `workspaceStorage/<hash>/github.copilot-chat/`
3. `globalStorage/github.copilot-chat/`
4. Hard-coded platform fallbacks (`%APPDATA%\Code\User\globalStorage\...`)

### Resurrection Sequence

```
1. Calculate cooldown (exponential backoff if rate-limited)
2. Wait for cooldown with status bar countdown
3. Open new chat session (if startNewSession enabled)
4. Switch to configured agent mode (e.g. BasicBitch)
5. Show approvals mode reminder (if non-default)
6. Inject ignition prompt via workbench.action.chat.open
7. Submit via workbench.action.chat.submit
8. Reset error detection cache
9. Increment daily counter (persisted via globalState)
10. Reset silence timer
```

### Exponential Backoff

Rate-limit errors trigger progressively longer cooldowns:

```
Attempt 1:  30s  (base)
Attempt 2:  60s  (30 × 2¹)
Attempt 3: 120s  (30 × 2²)
Attempt 4: 240s  (30 × 2³)
Attempt 5: 480s  (30 × 2⁴)
Attempt 6: 600s  (capped at max)
```

Non-rate-limit resurrections reset the backoff counter.

### Rate Limiting

- Restarts are capped at `maxRestartsPerDay` per calendar day.
- The counter auto-resets at midnight (UTC).
- When the cap is reached, a warning toast appears with a **Reset Counter** action.
- An in-flight resurrection blocks concurrent triggers.

---

## Agent Mode Discovery

The extension scans your workspace for `.github/agents/*.agent.md` files and parses their YAML frontmatter `description` field. Combined with built-in modes (`agent`, `edit`, `ask`), this gives you a curated QuickPick of all available modes.

Example workspace agents discovered:

```
├── .github/agents/
│   ├── BasicBitch.agent.md    → General-purpose task executor
│   ├── AzureAgent.agent.md    → Azure infrastructure executor
│   └── DevLoop.agent.md       → Self-improvement agent
```

The selected agent mode is activated via `workbench.action.chat.switchChatMode` after creating a new chat session.

---

## Status Bar

The bottom-right status bar shows live state:

| Display | Meaning |
|---|---|
| `$(debug-restart) Resurrect ON (3/50)` | Watcher active; 3 restarts used today out of 50 cap |
| `$(debug-pause) Resurrect OFF` | Watcher disabled |
| `$(loading~spin) Resurrecting…` | Resurrection sequence in progress |
| `$(watch) Cooldown 45s` | Exponential backoff countdown in progress |

Click the status bar item to toggle the watcher on/off.

---

## Troubleshooting

### The watcher starts but never resurrects

- Verify your `ignitionPrompt` is set (non-empty). Run **Configure Ignition Prompt**.
- Run **Show Status** and check `Seconds since last activity`. If it never reaches the timeout, the watcher is detecting activity — the session is still alive.
- If Copilot Chat writes session files to an unusual path, set `watchPaths` manually.

### The prompt is not appearing in the chat input

- The chat API injection requires no modal dialogs blocking VS Code.
- Try increasing `silenceTimeoutSeconds` slightly — if resurrection fires while Copilot is mid-response, the focus may not land correctly.

### Daily counter looks wrong

- Run **Reset Daily Restart Counter** to zero it out.
- The counter is per-machine, stored in `globalState`. It resets automatically at midnight UTC.

### Rate-limit back-off feels too aggressive

- Adjust `rateLimitCooldownBaseSeconds` (default: 30) and `rateLimitCooldownMaxSeconds` (default: 600).
- Run **Reset Exponential Backoff** to clear the consecutive counter immediately.

### Verbose debugging

Open **Show Output Log** and look for `[DEBUG]` lines. The log includes every file-system event, every heartbeat tick, content scan results, and every step of the resurrection sequence.

---

## Architecture

```
copilot-resurrect/
├── src/
│   ├── extension.ts          ← Activate/deactivate, command registration, pickers
│   ├── config.ts             ← Settings schema, getConfig(), buildFullPrompt(), agent discovery
│   ├── sessionWatcher.ts     ← FileSystemWatcher + polling heartbeat + content scan trigger
│   ├── resurrectionEngine.ts ← Resurrection sequence, exponential backoff, daily counter
│   ├── errorDetector.ts      ← Content-based error pattern matching (rate_limit, server_error, etc.)
│   ├── pathDiscovery.ts      ← Dynamic Copilot Chat storage path discovery
│   ├── logger.ts             ← Timestamped Output Channel wrapper
│   └── statusBar.ts          ← Status bar item lifecycle + cooldown display
├── out/                      ← Compiled JavaScript (generated)
├── ICON-200x200.png          ← Extension icon
├── package.json              ← Extension manifest, settings schema, command contributions
├── tsconfig.json             ← TypeScript config
├── CHANGELOG.md              ← Version history
└── LICENSE                   ← MIT License
```

---

## Building from Source

```powershell
cd copilot-resurrect
npm install
npm run compile               # tsc -p ./
npm run package               # produces copilot-resurrect-x.x.x.vsix
```

**Install locally:**

```powershell
code --install-extension copilot-resurrect-1.3.0.vsix --force
```

---

## Limitations

- Does **not** detect VS Code crashes that take down the entire IDE process.
- Single-workspace only (does not bridge remote SSH/WSL sessions).
- Agent mode switching uses `workbench.action.chat.switchChatMode` — if VS Code changes this internal command, mode selection may silently fail (resurrection still works, just in default mode).
- Model selection is informational — the actual model must be set in the Copilot Chat UI dropdown. The picker helps you track your preference.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Author

Eric Anderson — built with GitHub Copilot Chat (March 2026).

> *"The extension that keeps the lights on."*
