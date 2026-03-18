---
applyTo: "src/memory/**"
---

# Memory & Cosmos DB Rules
**Spec ref:** `docs/07-Memory-Manager.md`, `docs/0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md`, `docs/0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md`

## Critical Rule
All memory access goes through `src/memory/memoryManager.ts`. No code touches Cosmos containers directly. Memory is **skill-specific by default** — always scope storage and recall to the relevant skill unless intentionally global.

## Containers & TTL

| Container | Purpose | TTL | Partition Key |
|---|---|---|---|
| `userProfiles` | Permanent preferences & onboarding answers | None | `userId` |
| `sessions` | Active conversation state + token cache | 72 hours | `userId` |
| `multimodalMemory` | Unified vector memory (text + image + speech) | 365 days | `userId` |
| `skillMemory-{skillId}` | Per-skill vaults — accounts, perks, block lists, external automations | 365 days | `userId` |

## MemoryManager API (`src/memory/memoryManager.ts`)

```typescript
const mm = new MemoryManager(userId);

// Store (skill-scoped by default)
await mm.store({
  content: "User prefers concise replies",
  skillId: "outlook",           // omit for global memory
  tags: ["preference", "style"],
  metadata: { source: "onboarding" }
});

// Just-in-time recall (skill-scoped)
const relevant = await mm.recall("how should I respond to my boss?", {
  skillId: "outlook",
  topK: 5,
  minScore: 0.78,
  modalities: ["text", "image"] // Hydra-Net multimodal support
});

// Skill-specific vault access (0i)
const vault = await mm.getSkillVault("movieBooking");
await mm.upsertSkillMemory("movieBooking", { savedPaymentMethod: "••••1234" });
```

## DiskANN Vector Index
- All memory containers use Cosmos DB's built-in DiskANN index (3072 dimensions)
- Embedding model: `text-embedding-3-large` (global) or `text-embedding-3-large-eu` (EU mode)
- Distance metric: cosine similarity
- Index configured via Bicep — never manually

## EU Residency Toggle
- `euResidencyMode = true`: All containers use EU DataZoneStandard endpoints — no data leaves EU
- `euResidencyMode = false` (default): Global Cosmos account + global embedding model

## Integration Points (Must Respect)
- **Overseer**: Loads session context + relevant skill memory at the start of every turn via `stateManager.ts`
- **Prompt Builder**: Injects just-in-time skill memory chunks + Hydra-Net results into the prompt
- **Identity**: Skill memory vaults require OBO delegated tokens for personal-data skills (11)

## Always
- ✅ Use `memoryManager.ts` as the only access path to Cosmos
- ✅ Scope all storage to the correct `skillId` when writing skill-specific memory
- ✅ Set appropriate `minScore` thresholds on recall — don't inject irrelevant chunks
- ✅ Respect the 72-hour session TTL — treat sessions as ephemeral state only
- ✅ Declare `longTermMemorySchema` in capability manifests for every skill that writes memory (0i)

## Never
- ❌ Write to Cosmos containers directly — always through `memoryManager.ts`
- ❌ Store secrets, tokens, or credentials in any Cosmos container
- ❌ Inject skill memory without checking relevance score (no blind injection)
- ❌ Bypass the `skillId` scoping for personal user data — always skill-scoped

*We are the bridge.*
