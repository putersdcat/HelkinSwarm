# HelkinSwarm Project Specification

## 7. Memory Manager (Refined)

### Purpose

The Memory Manager is the **persistent memory and state system** that turns HelkinSwarm from a stateless chatbot into a true digital body with long-term recall across days or weeks.

It eliminates context collapse for the eternal overseer while keeping the orchestrator lean. All memory is stored in Cosmos DB Serverless with DiskANN vector indexing, and every piece of data is treated as **skill-specific** by default (see **0i**).

### Architecture

```mermaid
graph TD
    A[Overseer / Session] --> B[MemoryManager API]
    B --> C[Cosmos DB Serverless]
    C --> D[userProfiles container (permanent)]
    C --> E[sessions container (72h TTL)]
    C --> F[multimodalMemory container<br/>DiskANN vector index]
    C --> G[skillMemory-{skillId} vaults (0i)]
    B --> H[Hydra-Net Router (0k)<br/>text + image + speech]
    style C fill:#1e3a8a,stroke:#60a5fa
```

### Containers & TTL Strategy

| Container                  | Purpose                                      | TTL          | Partition Key | Notes |
|----------------------------|----------------------------------------------|--------------|---------------|-------|
| `userProfiles`             | Permanent preferences & onboarding answers   | None         | `userId`      | Survives forever |
| `sessions`                 | Active conversation state & token cache      | 72 hours     | `userId`      | Auto-cleans |
| `multimodalMemory`         | Unified vector memory (text + image + speech) | 365 days     | `userId`      | Hydra-Net powered (0k) |
| `skillMemory-{skillId}`    | Per-skill vaults (accounts, perks, block lists, external automations) | 365 days | `userId` | Just-in-time injection (0i) |

### DiskANN Vector Index

All memory containers use Cosmos DB’s built-in **DiskANN** index (3072 dimensions):
- Embedding model: `text-embedding-3-large` (global default) + Hydra-Net router for multimodal content (0k)
- Distance metric: cosine similarity
- Index created automatically via Bicep

### MemoryManager API (`src/memory/memoryManager.ts`)

All code interacts through this clean facade:

```typescript
const mm = new MemoryManager(userId);

// Store a memory (skill-scoped by default)
await mm.store({
  content: "User prefers concise replies and hates small talk",
  skillId: "outlook",                    // optional — falls back to global
  tags: ["preference", "style"],
  metadata: { source: "onboarding" }
});

// Just-in-time recall (skill-scoped)
const relevant = await mm.recall("how should I reply to my boss", {
  skillId: "outlook",
  topK: 5,
  minScore: 0.78,
  modalities: ["text", "image"]          // Hydra-Net support
});

// Skill-specific vault access (0i)
const fandangoVault = await mm.getSkillVault("movieBooking");
await mm.upsertSkillMemory("movieBooking", { savedPaymentMethod: "••••1234", perks: ["freePopcorn"] });
```

### EU Residency Toggle Impact

When `euResidencyMode = true` (Bicep flag):
- All containers and embeddings use EU DataZoneStandard endpoints
- No data ever leaves the EU boundary

When `false` (default): Global frontier embedding model + global Cosmos account for maximum speed and capability.

### Integration Points

- **Overseer**: Loads session context + relevant skill memory at the start of every turn
- **Prompt Builder**: Injects just-in-time skill memory + Hydra-Net chunks
- **Safety Pipeline (0e)**: Runs data minimizer before storing anything sensitive
- **Durable Hooks (0h)**: Long-running workflows write state directly to skill vaults
- **SkillForge (0f)**: Can store learned capabilities as vector memories
- **Virtual Employees (0j)**: Each employee gets its own isolated skill vaults

### What NOT to Do

- ❌ Never write directly to Cosmos containers — always use `MemoryManager`
- ❌ Never store raw PII in vector memory without going through the data minimizer
- ❌ Never inject full skill vaults into every prompt — always just-in-time and top-k
- ❌ Never disable TTL on the `sessions` container
