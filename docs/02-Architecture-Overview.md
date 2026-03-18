# HelkinSwarm Project Specification

## 2. Architecture Overview & Component Diagram (Refined)

### High-Level Architecture

```mermaid
graph TD
    A[Teams Client<br/>@HelkinSwarm] --> B[Bot Framework<br/>/api/messages]
    B --> C[Overseer<br/>Eternal Orchestrator<br/>Durable Functions]
    C --> D[Session Sub-Orchestrator<br/>Per-turn execution]
    D --> E[Prompt Builder + Safety Gates (0e)]
    E --> F[LLM Layer<br/>Global Frontier Models (default)<br/>Grok / GPT / etc.<br/>EU toggle via Bicep]
    F --> G[Tool Dispatch + Skill Registry (0a)]
    G --> H[Safety & Verification Pipeline (0e)]
    H --> I[Memory Manager<br/>Cosmos DB + DiskANN<br/>Skill-Specific Vaults (0i)]
    I --> J[Hydra-Net Router<br/>Multimodal Embeddings (0k)]
    J --> K[Send Reply Activity<br/>Proactive Teams message + Durable Hooks (0h)]
    C -.->|ContinueAsNew at 80% context| C
    style C fill:#1e3a8a,stroke:#60a5fa
```

### Core Components (Updated)

| Component                          | Technology                              | Responsibility | Key Addendum Reference |
|------------------------------------|-----------------------------------------|----------------|------------------------|
| **Teams Interface**                | Bot Framework SDK v4                    | Receive messages, proactive replies, Adaptive Cards | 10-Teams-Interface.md |
| **Overseer**                       | Durable Functions Eternal Orchestrator  | Long-horizon brain, session lifecycle, token budget | 08-Orchestrator-Patterns.md |
| **Session Sub-Orchestrator**       | Durable sub-orchestration               | One complete turn: prompt → LLM → tools → verification | 08 |
| **LLM Layer**                      | Azure AI Foundry + Global models        | Default: frontier models (Grok, GPT, etc.). EU DataZone toggle via config | 06 + 0c |
| **Tool Dispatch**                  | Tool Registry + MCP Bridge              | Routes to Graph, GitHub, Azure, and modular skills | 05 + 0a |
| **Safety & Verification Pipeline** | Multiple activities                     | Prompt shields, scoped tokens, executor agents, four-eyes verification | **0e** |
| **Memory Manager + Hydra-Net**     | Cosmos DB Serverless + DiskANN          | Skill-specific vaults + multimodal embeddings with just-in-time injection | **0i + 0k** |
| **Durable Hooks**                  | Durable entities + webhooks             | Long-running workflows & native delegation | **0h** |
| **Virtual Employees**              | Future nested orchestrators             | Autonomous children (post-MVP) | **0j** |
| **Observability**                  | App Insights + Correlation IDs          | Full tracing, health, cost tracking | 13-Observability-Monitoring.md |

### Key Design Decisions (Unchained Edition)

1. **Global Performance Default**  
   HelkinSwarm uses the best available global frontier models by default for maximum capability and speed. EU DataZoneStandard residency is an optional toggle (`euResidencyMode` in Bicep/pipeline) — never the starting point.

2. **Eternal Overseer Pattern**  
   One persistent Durable orchestration per user. Uses `ContinueAsNew()` at 80% context window to enable long-horizon tasks without collapse (0h durable hooks built on top).

3. **Safety by Architecture (0e)**  
   Human confirmation for destructive actions via Adaptive Cards, scoped short-lived tokens, executor agents for high-risk operations, and mandatory four-eyes verification pipeline.

4. **Modular Digital Body**  
   - Master = brain (Overseer)  
   - Skills = reflexes  
   - Skill-specific memory vaults + Hydra-Net = nervous system  
   - Durable Hooks = persistence across time  
   - Virtual Employees (0j) = future autonomous organs  
   - DevLoop Relay (0g) = self-reflection

5. **Declarative Capabilities (0a)**  
   All tools defined in JSON manifests under the modular `skills/` library. Includes risk level, data sensitivity, external automation capabilities, and long-term memory schema.

6. **Self-Improvement Ready (0g + 0b)**  
   Built-in bidirectional DevLoop channel and model-specific tool presentation tuning.

### One-Turn Data Flow (Updated)

1. User message arrives in Teams  
2. Bot Framework forwards to Overseer  
3. Prompt Shields + Safety Gates  
4. Session context + relevant skill memory loaded (just-in-time from 0i)  
5. Hydra-Net adds multimodal embeddings if needed (0k)  
6. Prompt built with current model routing rules (global frontier default)  
7. LLM call  
8. Tool dispatch through safety pipeline (0e)  
9. Results verified, minimized, and durable hooks registered if long-running (0h)  
10. Reply sent proactively  
11. Memory updated  
12. Token budget checked → summarize + `ContinueAsNew` if needed
