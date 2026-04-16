# HelkinSwarm Project Specification – Addendum Series
## 0zk. Swarm Integration with Existing Least-Privilege Sub-Session Security Model

**Version:** 2.0 (Gold-standard aligned)
**Status:** Critical Integration Spec – MVP Blocking
**Owner:** Principal Developer
**Last Updated:** 2026-04-16

### 0. Native canonical vs HelkinSwarm adaptation

> Canonical source: `docs/master-azure-grok-swarm-replication-package/`
> Doc 11 \u00a71 (per-agent context & history management), main package
> \u00a71\u20132 (roles + chatroom rules), Doc 06 (policies).

The native xAI swarm has **no enterprise identity boundary** \u2014 all
agents run as peers inside a single tenant. It achieves isolation
purely via independent context windows and the chatroom channel.

HelkinSwarm is a production system talking to real enterprise data
(Outlook, Exchange, GitHub, Azure). We add a strict **least-privilege
sub-session boundary** on top of the native isolation model. This is an
**additive HelkinSwarm invariant**, not a deviation \u2014 native behavior
is preserved, we just refuse to hand agents elevated tokens.

| Aspect | Canonical native | HelkinSwarm adaptation |
|---|---|---|
| Per-agent context isolation | Fully independent chat-completions thread per agent. | Preserved. Each agent is a dedicated sub-orchestrator. |
| No shared global memory | Enforced by design. | Preserved. Only the chatroom entity carries cross-agent state. |
| Token handling | N/A at the native level. | Orchestrator never holds elevated tokens; agents never hold tokens at all. Sub-sessions are minted per tool call. |
| Safety pipeline | Native 4-agent model trusts its own policies (Doc 06). | Four-Eyes / Prompt Shields / confirmation cards (0e) run on every sub-session tool call, including those requested by swarm agents. |

### 1. Purpose

This document defines exactly how the intra-session swarm (0ze\u20130zi)
layers on top of HelkinSwarm\u2019s least-privilege sub-session architecture
without breaking any security invariants.

### 2. Core Rule (Non-Negotiable)

**No swarm agent ever receives an elevated token directly.**

- Swarm agents are Instrumental Sub-Sessions (0zc \u00a72).
- When a swarm agent needs to touch real enterprise data (Outlook,
  Exchange, GitHub, Azure, etc.), it **requests** a sub-session from
  the orchestrator (Helkin / Leader).
- The orchestrator mints the exact least-privilege token and spawns the
  secure sub-session exactly as it does today.

### 3. Integration Flow

```mermaid
graph TD
    U[User Message] --> O[Orchestrator / Helkin]
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
   If a swarm agent\u2019s tool call requires elevated permissions, the
   tool dispatch layer rejects it and returns a structured error:
   `"requires_sub_session"`.

2. **Agent Requests Sub-Session via chatroom (HelkinSwarm extension)**
   The agent sends a structured chatroom message to the Leader
   (Helkin). Because the canonical `chatroom_send` payload already
   carries `messageType` (0zg \u00a75.5), HelkinSwarm adds a
   `sub_session_request` messageType with a `data` payload:

   ```json
   {
     "messageType": "sub_session_request",
     "content":     "Need to read emails from specific sender",
     "confidence":  95,
     "sender":      "Benjamin",
     "data": {
       "domain": "outlook",
       "tool":   "outlook_list_emails",
       "scope":  ["Mail.Read"]
     }
   }
   ```

   This is a **HelkinSwarm refinement** of the canonical JSON
   convention. Native swarms have no analog because they do not have
   the enterprise identity boundary.

3. **Orchestrator Spins Up Sub-Session**
   Helkin (orchestrator) performs the existing sub-session creation:
   - Determines minimal token scope
   - Mints short-lived scoped token via `scopedTokenMinter.ts`
   - Spawns ephemeral sub-session with only the required tools
   - Passes the sub-session result back to the requesting swarm agent
     via chatroom (as a `tool_summary` messageType).

4. **Sub-Session Output**
   Result is injected into the requesting agent\u2019s T1 context via the
   chatroom drain path (0zg \u00a75), exactly like any other tool result.

### 5. Security Guarantees Preserved

- Orchestrator never holds elevated tokens.
- Sub-sessions remain ephemeral and least-privilege.
- No swarm agent ever sees a token.
- All tool calls (including those from swarm agents) go through the
  full safety pipeline (0e).
- Prompt Shields run on every sub-session input.
- Chatroom transcripts are scrubbed of token material before being
  committed to T3 or telemetry.

### 6. What NOT to Do

- \u274c Do **NOT** give swarm agents direct tool access to elevated permissions.
- \u274c Do **NOT** let swarm agents mint their own tokens.
- \u274c Do **NOT** share tokens or sub-session state between swarm agents.
- \u274c Do **NOT** bypass the orchestrator for sub-session creation.
- \u274c Do **NOT** drop the `sub_session_request` guard on the grounds
  that "native swarms don\u2019t have it" \u2014 native swarms don\u2019t touch
  enterprise data.

### 7. Acceptance Criteria

- A swarm agent can request and receive a sub-session result via chatroom.
- The orchestrator enforces least-privilege token minting.
- Safety pipeline (0e) runs on every sub-session tool call.
- Simple queries continue to bypass swarm entirely.
- `sub_session_request` messageType is recognized by Helkin\u2019s
  synthesis/routing prompt.

**Backlog linkage**: Critical bridge between 0ze (swarm), canonical
replication package, and existing security model (0d, 0e, 0zc).

*We are the bridge.*