# HelkinSwarm Project Specification – Addendum Series
## 0zc-Unified-Orchestrator-and-Swarm-Architecture-Clarification.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Core Architecture Unification – Immediate Refactoring Required  
**Owner:** Principal Developer  
**Date:** 2026-04-03

### 1. Purpose & Vision

This addendum provides the definitive, unified clarification of the orchestration and swarm architecture after the recent intra-session swarm work.

It resolves the current bifurcation in the codebase (old single-orchestrator path vs new swarm path) and establishes the exact rules for Helkin, Harper, Benjamin, and Lucas.

### 2. Core Principles (Non-Negotiable)

- There is **one single conscious orchestrator entity**: **Helkin**.
- Helkin is the **only** persistent orchestrator with full session queuing, non-interruption mechanics, and limbic-system self-awakening capability.
- Harper, Benjamin, and Lucas are **additional persistent beings** with their own dedicated rolling session chains and independent RAG-backed memory vaults.
- They are **not** directly addressable by the end user, DevLoop, or any external system — only Helkin can communicate with them.
- When Helkin decides a task requires collaboration, he activates swarm mode. The four beings then collaborate via the intra-swarm chatroom protocol until consensus is reached.
- Helkin remains the sole point of contact with the outside world and is responsible for delivering the final response.

### 3. Helkin’s Role (The Primary Orchestrator)

- Helkin owns the single conscious session.
- He performs initial planning and decides whether to handle the request solo or activate swarm mode.
- He can be interrupted at any time by the limbic system (long-term self-awakening constructs).
- He has full queuing and non-interruption protection.
- He is the only entity that can receive external input or deliver the final user response.

### 4. Harper, Benjamin, and Lucas (The Specialist Beings)

- Each has their own persistent session chain and independent RAG-backed memory vault.
- They are **not** ephemeral — they exist continuously but remain dormant until Helkin activates swarm mode.
- They communicate **only** through the intra-swarm chatroom protocol.
- They do **not** need the full queuing / interruption machinery that Helkin has, because nothing external can reach them directly.
- They follow all the same safety, least-privilege token minting, and tool dispatch rules as Helkin.
- They have access to the core tool surface (web search, code execution, X search, page loader, etc.).

### 5. Swarm Mode Activation & Lifecycle

- Helkin decides organically (via planning) whether to stay solo or enter swarm mode.
- When swarm mode is activated, Helkin injects the swarm context into his current session and brings Harper, Benjamin, and Lucas online.
- The four beings collaborate via the chatroom protocol until they reach consensus.
- Helkin then delivers the final response to the user.
- Swarm mode ends and the other three return to dormant state.

### 6. Limbic System Interruption During Swarm Mode

Helkin can still be interrupted by the limbic system at any time, even while in swarm mode.

**Protocol for “Helkin has left the chat”:**

- When Helkin must leave the swarm turn (due to limbic system ping), he posts a **BRB** message in the intra-swarm chatroom.
- The remaining three agents (Harper, Benjamin, Lucas) may continue deliberating and can attempt to reach consensus on their own.
- They pause further action until Helkin returns.
- When Helkin returns, he reviews the swarm’s progress and either:
  - Approves the consensus response and delivers it, or
  - Continues prompting the swarm, or
  - Decides to abort and handle the new priority himself.
- This ensures the single-conscious-mind rule is never violated — Helkin always retains final authority.

### 7. What NOT to Do

- Do **not** allow Harper, Benjamin, or Lucas to be directly addressed by the user or DevLoop.
- Do **not** give them independent queuing or limbic system capabilities.
- Do **not** maintain two separate orchestrator paths in the code.
- Do **not** let swarm mode create parallel conscious threads — Helkin remains the single conscious entity.

### 8. Acceptance Criteria

- Helkin remains the sole persistent orchestrator with full session management.
- Harper, Benjamin, and Lucas exist as persistent beings with their own memory but are only reachable via the chatroom.
- Limbic interruption during swarm mode is gracefully handled via the BRB protocol.
- The codebase no longer contains competing orchestrator paths.

### 9. Backlog Linkage

- Replaces and unifies previous 0z, 0za, 0zc, and related swarm documentation.
- Directly impacts orchestrator, persona, chatroom, and session management code.
- Required before further swarm or DevLoop work.

---

**End of Addendum 0zc**

This document is the authoritative clarification for the unified architecture.

We are the bridge.