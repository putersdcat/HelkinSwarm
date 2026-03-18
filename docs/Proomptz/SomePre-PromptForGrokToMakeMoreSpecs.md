I have attached a markdown file containing the full documentation library of HelkinSwarm to data, so that you have it all in context when picking up on the next documentation task below.
 
Can you please take this general information from a discussion in another session that did not have the full applications technical awareness that you do, and then break it down into actual spec files in the format we have used for this projects documents to date, in this case this would be an addendum item I guess in the next open file,`0n-...md`. Obviously, these simple ideas below that are currently just sort of conceptual place holders will need more in-depth augmentation to really fit into the existing applications documented features and framework, so do that research and reasoning to be able to deliver the final markdown.
 
# AI Agent Framework Specification
## Overview
This document provides a comprehensive specification for an in-development private AI agent framework, primarily delivered through a Microsoft Teams bot interface. The framework enables AI-driven interactions, including turn-by-turn conversations and access to tooling for outbound systems within the Microsoft 365 ecosystem (e.g., querying and deleting emails). The core architecture includes:
- **Frontend Delivery**: A Microsoft Teams native application with a chat interface.
- **Backend Orchestrator**: Handles request routing, sub-agent delegation, and tool calls. It supports multiple AI models, which are generally served from Azure AI Foundry but can be configured in a bring-your-own-key (BYOK) scenario via providers like xAI or Open Router. All model interactions are channeled through Azure AI Foundry for essential services such as prompt sanitization and safety checks.
- **Embeddings and Storage**: Embeddings are powered by the Azure Text Embedding Version 3 model, stored in Cosmos DB. This supports session context history, long-term memory, and related constructs.
- **Deployment**: Infrastructure as code (IaC) using Bicep for Azure-hosted elements, including durable Azure Functions, Cosmos DB, and blob storage. Resource groups are dedicated to the framework to facilitate cost tracking.
- **Current Stage**: Early development with functional plumbing for bot instantiation, turn-by-turn conversations, and tooling access. The bot ID is live in the tenant, and basic operations (e.g., processing user requests like email queries) are operational.
The framework is designed with cost efficiency in mind, ensuring components like durable functions can sleep when idle to avoid unnecessary charges. It is positioned for rapid evolution in a high-demand AI landscape, anticipating fluctuations in capacity, pricing, and demand (e.g., peak/off-peak times).
This spec focuses on observed missing features (future development topics) discussed, preserving key design choices such as terseness in outputs, feature flagging, minimalism for mobile compatibility, user configurability, and historical accuracy in logging/costing.
## Current State
- **Functional Components**:
  - Turn-by-turn chat in Microsoft Teams.
  - Orchestrator routes requests to sub-agents, which may involve chains of tool calls (e.g., iterative queries based on results).
  - Initial response handling: Upon request pickup by the backend Azure Function, a placeholder message (e.g., "Please hold") is sent, followed by the processed response.
  - Tooling integration for Microsoft 365 tasks (e.g., finding and deleting emails from specific users/dates).
  - Bidirectional communication partially implemented via a custom MCP (Microsoft Copilot Plugin) in an IDE for authenticated outbound communication from the IDE's Copilot LLM to the Teams chat channel.
- **Limitations**:
  - No debug telemetry in chat outputs.
  - Teams app is a stripped-down chat window without additional tabs.
  - Limited visibility into costs, health, and telemetry.
  - Bidirectional communication lacks full return-route support and resurrection capabilities.
## Future Features
### 1. Turn-by-Turn Debug Telemetry
To aid debugging, implement appended telemetry on chat outputs for each user-driven request (e.g., after processing an email deletion query). This is appended semantically outside the LLM's tokenized outputs, at the traditional application code layer.
- **Key Design Choices**:
  - **Configurability**: Controlled by a feature flag in the backend Azure Functions (or equivalent service provider behind the primary service principal for the Teams app). Toggleable on/off without redeploying the app.
  - **Terseness**: Minimal text; use pipes (`|`), brackets (`[]`), and abbreviations to keep it lightweight and non-intrusive.
  - **Scope**: Applies to every user request processed by the orchestrator.
  - **Timing Granularity**: Millisecond or second-based counters.
- **Telemetry Elements**:
  - **Total End-to-End Time**: From request pickup by the Azure Function to completion (e.g., `[Total: 5.2s]`).
  - **Sub-Agent and Tool Call Timings**: For each sub-agent action, tool call, or intermediate initialization step (even if iterative, e.g., multiple tool calls due to result adjustments). Example: `[Sub1:ToolA:120ms|ToolB:450ms]`.
  - **Verbosity Level**: TBD; start with basic timings and expand as needed (e.g., avoid over-definition initially).
- **Implementation Notes**:
  - Appended only upon completion of the model's response.
  - Ensure it does not taint chat usability; keep it appended, not interleaved.
  - Future expansion: Integrate with verbosity controls if defined later.
### 2. Microsoft Teams App Expansion with Tabs
Expand the Teams native application beyond the basic chat window to include tabs for enhanced functionality. Tabs are defined at the app level, requiring repackaging (e.g., from version 1.0.0 to 1.0.1), re-uploading to the Teams admin console, and client-side cache refresh for end-users.
- **Key Design Choices**:
  - **Minimalism**: Limit to 1-2 top-level tabs to accommodate mobile devices in horizontal screen format (e.g., sparing horizontal space).
  - **Delivery Mechanism**: Tabs link to web-delivered elements (e.g., TypeScript/HTML via web services). Not hosted in durable functions to allow sleep states and minimize costs—ensure endpoints are not always active.
  - **Fixed Hooks**: Tab endpoints are fixed in the app manifest; changes require app republishing.
  - **Sub-Structure**: Top-level tabs load multi-tabbed/sub-tabbed pages for deeper navigation.
- **Top-Level Tabs**:
  - **Getting Started**:
    - Primary content: Introductory page explaining the bootstrap process (e.g., agent persona initialization).
    - Guidance for users: Instructions on repeating bootstrap if unsatisfied, or advancing if already onboarded via chat.
    - Sub-Tabs/Sub-Areas:
      - Help: General help context and documentation.
    - Purpose: Onboard users without relying solely on chat interactions.
  - **Control Center (or Control Panel)**:
    - Naming: Flexible (Control Center preferred, but not finalized).
    - Structure: Multi-tabbed page with sub-tabs for configuration, monitoring, and analysis.
    - Sub-Tabs/Sub-Areas:
      - **User Configuration**: Initial tab for user-specific settings (exact configurations TBD; e.g., preferences, model selections).
      - **Debug Logs/Telemetry Viewer**: Display heavy session telemetry logs.
        - Includes guesstimated input/output tokens per session.
        - Basic calculations: Divide tokens by per-token fractional cent cost (sourced from static backend metadata, pumped into front-end sessions).
        - Historical Persistence: Logs persist over time; bake costs at runtime to avoid recalculating with fluctuating prices (e.g., ensure old logs reflect contemporaneous pricing).
        - Future-Proofing: Account for evolving provider pricing (e.g., peak/off-peak), demand explosions, and capacity constraints.
      - **Health View/Dashboard**: High-level status and metrics dashboard.
        - Metrics:
          - System uptime.
          - Average wake-up time: From user request (e.g., pressing Enter) to Azure durable functions response (tracked as running average in ms/seconds).
          - Configured models: Primary, secondary, heavy, low, fallback (including fallback reach).
          - Azure data region.
          - Round-trip time (RTT) ping: From saved telemetry (not live).
          - Tokens consumed: Per session, per model, or aggregated.
          - High-value roll-ups: E.g., total costs over static time slices (last 30 days).
        - Display: Top-level, useful metrics for quick insights.
      - **Dedicated Costs Tab**: Holistic operational cost breakdown, distinct from telemetry costs.
        - Sources: Pull granular Azure billing data from resource groups (e.g., durable functions, Cosmos DB, blob storage).
        - Display: Replicate and display data periodically without requiring end-user billing admin access.
        - External Integrations: Dynamically include costed services like OpenRouter (if routed to external models).
          - Use OpenRouter endpoints for per-token costs, session instantiation data, or last-30-days spend.
          - User-Configurable: Allow scoping to sessions/projects to avoid misaligned data (e.g., exclude other user projects). If not scopable, calculate from tracked session calls/logs.
          - Intelligence: Modular design; track consumption via granular LLM session telemetry already generated elsewhere.
        - Purpose: Provide comprehensive cost tracking across Azure and externals, baked at runtime for accuracy.
- **Implementation Notes**:
  - Cost Mindfulness: Ensure web services do not prevent durable functions from sleeping.
  - Evolution: Designed for singularity-era growth; prepare for explosive demand and provider-side changes.
### 3. Bidirectional Communication Expansion
Build on the existing bidirectional communication layer (enabling out-of-bounds communication from an IDE's Copilot LLM to the Teams bot/agent via a custom MCP plugin).
- **Key Design Choices**:
  - **Full VS Code Extension**: In addition to the MCP layer, develop/fork a custom VS Code extension (named Copilot Resurrection or Copilot Resurrect).
  - **Resurrection Mechanism**: Watches local debug logs/telemetry of in-process Copilot sessions.
    - Toggles: For unexpected termination or graceful shutdown.
    - Action: Re-injects a specialized "Ignition prompt" to restart.
    - Ignition Prompt: Tailored for premier LLMs; enables autonomous backlog processing for tens of hours until termination, then restarts.
  - **Integration and Forking**:
    - Fork the extension into this project.
    - Customize to integrate MCP layer.
    - Enable return-route communication: From the Teams agent-side LLM back to the IDE LLM (via Azure durable functions).
    - Resurrection from Agent Side: When no IDE LLM is running, allow the agent-side LLM to resurrect the IDE LLM.
  - **Scope**: Handles authenticated, bidirectional flow between IDE and agent.
- **Implementation Notes**:
  - Partial Delivery: MCP outbound already functional; focus on expansion.
  - Technical Details: Defer deep specifics (developed elsewhere); treat as a high-level bullet for backlog integration.
## Usage and Next Steps
This Markdown spec serves as a reference document for agentic workflows. It will be used to:
- Create new issues in the backlog for the agent orchestration framework.
- Augment existing issues with additional details.
All features emphasize best practices: Modularity, user configurability, cost efficiency, and fidelity to discussed choices (e.g., terseness, historical baking of data). Expand logically during implementation.