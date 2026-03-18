# HelkinSwarm Project Specification

## 0a. Modularity & Configuration Strategy

### Core Philosophy

HelkinSwarm is built from the ground up to be **modular and future-proof**.  
Everything that could ever be swapped, extended, or replaced by an end-user (private or commercial) must be treated as a plugin from day one.

We deliberately separate:

- **Core** — the non-negotiable, always-present foundation that makes the system run.  
- **Skills Library** — everything that can be added, removed, or replaced without touching the core.

This separation is not just for cleanliness — it is the architectural guarantee that HelkinSwarm can grow into multi-library, multi-repo, multi-hypervisor, and multi-LLM deployments without painful refactoring later.

### 1. Core vs Skills Library Separation

**Core** (must stay in the main codebase):
- Eternal Overseer & Session Sub-Orchestrator
- Memory Manager (Cosmos + DiskANN)
- Safety Pipeline (shields, scoped tokens, verification, human confirmation)
- Bot Framework Adapter & Teams interface
- Authentication & Identity layer (UAMI + token minter)
- Central Tool Registry & Capability Loader
- Configuration & Environment Layer
- Observability & Correlation

**Skills Library** (modular, swappable):
- All domain-specific tools (Outlook, Teams, SharePoint, GitHub, Azure, etc.)
- Future user-contributed or private skills
- SkillForge-generated skills

**Folder Structure (MVP and beyond)**

```
HelkinSwarm/
├── src/core/                  # Core layer — never touch for new skills
├── skills/                    # Top-level Skills Library (default target)
│   ├── outlook/
│   ├── teams/
│   ├── github/
│   ├── azure/
│   └── custom/                # User/private skills go here
├── model-profiles/
├── infra/
└── Docs/
```

Skills are discovered automatically at startup via the Capability Loader.  
Each skill folder contains its own `manifest.json` + implementation files.

### 2. Configuration Strategy

All configurable values must be **lifted out** of code and centralized.  
No buried strings, no hard-coded paths, no magic constants.

**Layered Configuration (in order of precedence)**

1. **Environment Variables** (Azure Functions + Container Apps) — primary for MVP  
2. **Central Config File** (`config.json` or `helkinswarm.config.json`) — for complex structures  
3. **Runtime Database** (Cosmos `userProfiles` + `config` container) — for per-user overrides

**All configurable items must be defined in one of these places**:

- LLM endpoints & routing (global vs EU)
- Skills library paths/URIs (local folder or remote repo)
- Default target for SkillForge output
- Safety mode defaults
- Model selection rules
- Memory TTLs
- Hypervisor/deployment targets (future)

### 3. Skills Library Modularity Rules

- The loader must support **multiple libraries** simultaneously (private + public)
- Each library is referenced by a configurable **URI/path** (local folder, git URL, or future registry)
- SkillForge always publishes to the **default library** (configurable, defaults to `./skills/`)
- Manifests are versioned and schema-validated
- Discovery is hot-reloadable (no restart needed for new skills after SkillForge merge)

### 4. Future-Proofing Rules (must be followed from day one)

- Never hard-code:
  - LLM endpoints
  - Skills library paths
  - Tool handler imports
  - Hypervisor-specific strings
- Every injection point must go through the central config layer
- Assume someone will eventually:
  - Swap Azure for a private Docker host
  - Add OpenRouter / xAI / Anthropic as native providers
  - Run multiple private skills libraries
  - Fork the core and keep their own skills repo

### What NOT to Do

- ❌ Never bury a path, endpoint, or model name directly in code
- ❌ Never assume the skills library will always live in `./skills/`
- ❌ Never make SkillForge output location a constant
- ❌ Never write new tools without a matching manifest in the skills folder

This section is the **contract** we make with future versions of ourselves and any other users.  
Everything we build from this point forward must respect it.
