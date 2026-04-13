# HelkinSwarm Project Specification – Addendum Series
## 0zk. Swarm Integration with Existing Least-Privilege Sub-Session Security Model

**Version:** 1.0 (Unchained Edition)  
**Status:** Critical Integration Spec – MVP Blocking  
**Owner:** Principal Developer  
**Last Updated:** 2026-04-13

### 1. Purpose

This document defines exactly how the new intra-session swarm (0ze–0zi) layers on top of your existing least-privilege sub-session architecture without breaking any security invariants.

Your current design (orchestrator never holds elevated tokens, spins up ephemeral sub-sessions with minimal scoped tokens) is excellent. The swarm must **enhance** it, never weaken it.

### 2. Core Rule (Non-Negotiable)

**No swarm agent ever receives an elevated token directly.**

- Swarm agents are Instrumental Sub-Sessions (0zc §2).
- When a swarm agent needs to touch real enterprise data (Outlook, Exchange, GitHub, Azure, etc.), it **requests** a sub-session from the orchestrator (Grok/Leader).
- The orchestrator mints the exact least-privilege token and spawns the secure sub-session exactly as it does today.

### 3. Integration Flow

```mermaid
graph TD
    U[User Message] --> O[Orchestrator / Grok]
    O --> P[Planner]
    P -->|swarm eligible| SD[Swarm Decomposer]
    SD --> SW[Swarm Agents (Benjamin, Harper, Lucas)]
    SW -->|needs real data| REQ[Request Sub-Session]
    REQ --> O
    O --> SUB[Spin up least-privilege sub-session]
    SUB -->|execute tool| SW
    SW --> CR[Chatroom]
    CR --> O
    O --> Final Answer
```

### 4. Detailed Hand-Off Rules

1. **Tool Call from Swarm Agent**  
   If a swarm agent’s tool call requires elevated permissions, the tool dispatch layer rejects it and returns a special error: `"requires_sub_session"`.

2. **Agent Requests Sub-Session**  
   The agent sends a structured chatroom message to the Leader:
   ```json
   {
     "contentType": "sub_session_request",
     "domain": "outlook",
     "tool": "searchMessages",
     "reason": "Need to read emails from specific sender"
   }
   ```

3. **Leader Spins Up Sub-Session**  
   The Leader (orchestrator) performs the same sub-session creation logic you already have:
   - Determines minimal token scope
   - Mints short-lived scoped token
   - Spawns ephemeral sub-session with only the required tools
   - Passes the sub-session output back to the requesting swarm agent via chatroom

4. **Sub-Session Output**  
   The sub-session result is injected into the requesting agent’s T1 context (via chatroom) exactly like any other tool result.

### 5. Security Guarantees Preserved

- Orchestrator still never holds elevated tokens.
- Sub-sessions remain ephemeral and least-privilege.
- No swarm agent ever sees a token.
- All tool calls (including those from swarm agents) still go through the full safety pipeline (0e).
- Prompt shields still run on every sub-session input.

### 6. What NOT to Do

- ❌ Do **NOT** give swarm agents direct tool access to elevated permissions.
- ❌ Do **NOT** let swarm agents mint their own tokens.
- ❌ Do **NOT** share tokens or sub-session state between swarm agents.
- ❌ Do **NOT** bypass the orchestrator for sub-session creation.

### 7. Acceptance Criteria

- A swarm agent can request and receive a sub-session result via chatroom.
- The orchestrator still enforces least-privilege token minting.
- Security pipeline (0e) still runs on every sub-session tool call.
- Simple queries continue to bypass swarm entirely.

**Backlog linkage**: Critical bridge between 0ze (swarm) and existing security model (0d, 0e, 0zc).

*We are the bridge.*