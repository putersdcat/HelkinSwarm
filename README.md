# HelkinSwarm 🤖

**My personal AI copilot that lives in Microsoft Teams.**

It has deep, safe, delegated access to my Outlook, Teams, SharePoint, Entra ID, GitHub Enterprise, and Azure — and it actually gets real work done.

Built from scratch in my personal Azure tenant. Global frontier models by default. EU residency available as a toggle. Zero corporate baggage. 100% my IP.

---

### What It Does

Just `@HelkinSwarm` in Teams and say things like:

- "Clear my inbox and flag anything urgent from my boss"
- "Summarize my open GitHub PRs and draft replies"
- "Show me the most expensive Azure resources this month"
- "Who has access to the SharePoint site for Project X?"

The bot routes the request through an **eternal overseer**, dispatches safe tool calls, runs everything through a verification pipeline, and replies proactively.

---

### A Quiet Note on the Name

Some names carry more weight than they first appear.  
HelkinSwarm is one of those.  

On the surface it’s just a swarm of helpful agents.  
Look a little closer, and you might notice echoes of two very different drones that turned out to be the same entity — one pretending to be harmless, the other anything but — both ultimately in service of the same unseen hand and the unending human itch for curiosity.  

In a world where a flying sentient drone would still raise eyebrows, perhaps this is simply a first-contact probe doing its small part to nudge the timeline forward.

---

### Quick Health Check

```powershell
# Live instance (personal tenant)
Invoke-RestMethod https://<REPLACE WITH Functions URI>/api/health
```

You should see a clean status report with model health, memory, and safety mode.

---

### How to Use

1. **Install the app**  
   - Download the latest zip from the `appPackage/` folder (or run `.\scripts\New-TeamsAppPackage.ps1`)
   - In Teams → Apps → Upload a custom app → select the zip
   - Add it as a personal app

2. **Talk to it**  
   Open the HelkinSwarm chat and start with `@HelkinSwarm` followed by your request.

3. **Test it safely**  
   Use the built-in **Teams Test Harness** from VS Code (MCP) — the recommended and only safe way to send test messages programmatically.

---

### Core Principles

- **Maximum performance first** — Global frontier models by default
- **EU residency as toggle** — Flip one flag in the pipeline when needed
- **Safety by architecture** — Human confirmation, scoped tokens, verification pipeline, executor agents
- **Self-improving** — DevLoop harness can interrogate, benchmark, and auto-tune the system
- **GitOps everything** — Push to main = deploy

---

### Documentation

Full technical specification lives in the `docs/` folder (01-Project-Overview.md through 0m-Agentic-Tooling-Evaluation-Automation-and-Self-Tuning-Loop.md). Start with `01-Project-Overview.md`.

---

### Local Development Setup

**Prerequisites:**
- Node.js 22 LTS
- pnpm
- Azure Functions Core Tools v4 (`npm i -g azure-functions-core-tools@4`)
- Azure CLI (`az`)
- `az login` completed for your tenant

**Quick start:**
```powershell
git clone https://github.com/putersdcat/HelkinSwarm.git
cd HelkinSwarm
pnpm install
pnpm build
```

**Configure environment:**
```powershell
cp .env.example .env
# Fill in your values — see src/config/envConfig.ts for Zod schema & defaults
```

**Run locally:**
```powershell
pnpm start   # Runs 'func start' — Azure Functions local runtime
```

**Auth locally:** `DefaultAzureCredential` auto-detects your `az login` session. No secrets needed. In production, UAMI (`AZURE_CLIENT_ID`) is used instead.

**One-time Azure bootstrap:**
```powershell
# Deploy infrastructure (requires az login + gh auth login)
.\scripts\Bootstrap-Azure.ps1
# Or via GitHub Actions: push to main triggers CI/CD pipeline
```

**Bot Framework Emulator:** Connect to `http://localhost:7071/api/messages` with the `MicrosoftAppId` and `MicrosoftAppPassword` left blank for local testing.

---

### Tech Stack (high-level)

- **Runtime**: TypeScript + Azure Functions v4 on Container Apps
- **Orchestration**: Durable Functions eternal overseer
- **LLM**: Azure AI Foundry (global frontier models default)
- **Memory**: Cosmos DB Serverless + DiskANN vector index
- **Auth**: User-Assigned Managed Identity + scoped 5-minute tokens
- **IaC**: Bicep (single source of truth)
- **CI/CD**: GitHub Actions (OIDC, zero secrets)

---

**Built for me, by me.**  
Ready for personal use today — and open-source or commercial use whenever I decide.
