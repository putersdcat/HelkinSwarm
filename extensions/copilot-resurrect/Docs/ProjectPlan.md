**VS Code Extension Development Spec**  
**Project Name:** Copilot Session Resurrection Watcher (working title)  
**Version:** 1.0 (MVP)  
**Author:** Eric Anderson (via Grok collaboration)  
**Date:** March 2026  

> **Note:** This is the original MVP spec from v1.0.0. The extension has since evolved significantly (see CHANGELOG.md). Kept for historical reference.

### 1. Problem Statement (Macro-Level)

GitHub Copilot Chat in VS Code is currently the most powerful way to run long-running, autonomous coding agents (especially with Frontier models via GitHub Enterprise). Developers can queue an "ignition prompt" that tells the model to:

- Pull open backlog items from GitHub Issues  
- Implement, test, and commit them  
- Update issue status  
- Loop indefinitely  

This workflow routinely runs 5–18+ hours straight when everything is healthy.  

However, **Copilot Chat sessions terminate unpredictably** for reasons completely outside the user's control:

- Server-side throttling or malformed-prompt aborts  
- Token-limit / context-window overflows (especially on session rollover)  
- Transient network / data-center failovers (TCP reset)  
- Model-router errors that do not trigger the built-in retry/queue mechanism  

When any of these happen the queued next prompt is **never executed**. The chat panel simply stops. There is no official "watchdog" or auto-respawn capability.

### 2. Desired Outcomes / Success Criteria

After installing and enabling the extension, a developer should be able to:

1. Walk away from the keyboard (or go to sleep) with one ignition prompt queued.  
2. Return 8–18 hours later to find either:  
   - Every backlog item processed and issues updated, **or**  
   - The session has been cleanly resurrected multiple times and is still running the same ignition prompt.  
3. Zero manual intervention required once the watcher is active.  
4. The extension must survive VS Code restarts, workspace reloads, and future Copilot Chat UI changes with minimal or zero code changes.

### 3. Scope & Key Requirements (MVP)

#### In Scope
- Detect when a Copilot Chat session has terminated (dead silence).  
- Automatically start a **brand-new** Copilot Chat session using a user-configured ignition prompt and model.  
- Provide simple, persistent configuration stored in VS Code settings.  
- Graceful degradation: if resurrection fails, log clearly and stop (do not spam).  
- Work with any Frontier model selectable via Copilot Chat (no hard-coded models).

#### Out of Scope (for MVP)
- Reading or parsing the actual prompt/response content.  
- Smart decision-making based on backlog state or issue triage.  
- Handling VS Code or Copilot crashes that take down the entire IDE.  
- Multi-workspace or remote (SSH/WSL) support.  

### 4. High-Level Architecture

1. **Configuration Layer** — `settings.json` with typed schema  
2. **Detection Layer** — `FileSystemWatcher` + heartbeat polling  
3. **Resurrection Layer** — VS Code Chat API injection + submit  
4. **Safety Layer** — Daily rate cap, exponential backoff, Output Channel logging
