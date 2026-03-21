// Memory Manager — unified access layer for Cosmos vector memory.
// All memory operations (store, recall, skill-scoped) go through here.
// Spec ref: 07-Memory-Manager.md, 0i-Skill-Specific-Long-Term-Memory.md
// Issue: #134

import { z } from 'zod';
import { getContainer } from './cosmosClient.js';
import { FoundryClient } from '../llm/foundryClient.js';
import { getModelRouting } from '../llm/modelRouter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const MEMORY_CONTAINER = 'multimodalMemory';
const CATALOG_CONTAINER = 'longRunningCatalog';

export const MemoryEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  content: z.string(),
  skillId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
  vector: z.array(z.number()).optional(),
  createdAt: z.string(),
  ttl: z.number().optional(),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export interface StoreOptions {
  content: string;
  skillId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface RecallOptions {
  skillId?: string;
  topK?: number;
  minScore?: number;
  modalities?: string[]; // Extension point for multimodal filtering (0k)
}

export interface RecallResult {
  content: string;
  score: number;
  skillId?: string;
  tags: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

export class MemoryManager {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Store a memory entry with its embedding vector.
   * Generates the embedding via text-embedding-3-large and persists to Cosmos.
   */
  async store(options: StoreOptions): Promise<string> {
    const container = getContainer(MEMORY_CONTAINER);
    const id = crypto.randomUUID();

    // Generate embedding vector
    let vector: number[] | undefined;
    try {
      const client = new FoundryClient(getModelRouting());
      vector = await client.getEmbedding(options.content);
    } catch (err) {
      console.warn(`[MemoryManager] Embedding generation failed, storing without vector: ${err}`);
    }

    const entry: MemoryEntry = {
      id,
      userId: this.userId,
      content: options.content,
      skillId: options.skillId,
      tags: options.tags ?? [],
      metadata: options.metadata ?? {},
      vector,
      createdAt: new Date().toISOString(),
      ttl: 31536000, // 365 days
    };

    await container.items.upsert(entry);
    return id;
  }

  /**
   * Recall relevant memories via Cosmos vector search (DiskANN).
   * Uses VectorDistance() for cosine similarity ranking.
   */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult[]> {
    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.7;

    // Generate query embedding
    let queryVector: number[];
    try {
      const client = new FoundryClient(getModelRouting());
      queryVector = await client.getEmbedding(query);
    } catch (err) {
      console.warn(`[MemoryManager] Query embedding failed, cannot recall: ${err}`);
      return [];
    }

    const container = getContainer(MEMORY_CONTAINER);

    // Cosmos DB vector search query using VectorDistance()
    // The WHERE clause filters by userId (partition key) and optionally skillId.
    const skillFilter = options?.skillId
      ? `AND c.skillId = @skillId`
      : '';

    const querySpec = {
      query: `SELECT TOP @topK c.content, c.skillId, c.tags, c.createdAt, VectorDistance(c.vector, @queryVector) AS score FROM c WHERE c.userId = @userId ${skillFilter} ORDER BY VectorDistance(c.vector, @queryVector)`,
      parameters: [
        { name: '@topK', value: topK },
        { name: '@queryVector', value: queryVector },
        { name: '@userId', value: this.userId },
        ...(options?.skillId ? [{ name: '@skillId', value: options.skillId }] : []),
      ],
    };

    try {
      const { resources } = await container.items.query<{
        content: string;
        score: number;
        skillId?: string;
        tags: string[];
        createdAt: string;
      }>(querySpec).fetchAll();

      // VectorDistance with cosine returns 0 = identical, higher = more distant.
      // Convert to similarity: 1 - distance. Filter by minScore.
      return resources
        .map((r) => ({ ...r, score: 1 - r.score }))
        .filter((r) => r.score >= minScore);
    } catch (err) {
      console.warn(`[MemoryManager] Vector search failed: ${err}`);
      return [];
    }
  }

  /**
   * Store a conversation turn for long-term recall.
   * Called after each successful LLM interaction.
   */
  async storeConversationTurn(userMessage: string, assistantReply: string): Promise<void> {
    const combined = `User: ${userMessage}\nAssistant: ${assistantReply}`;
    // Only store if the content is meaningful (not just ack messages, errors, etc.)
    if (combined.length < 20) return;

    await this.store({
      content: combined,
      tags: ['conversation'],
      metadata: { type: 'conversation_turn' },
    });
  }

  /**
   * Get all memories for a specific skill vault.
   * Returns skill-scoped memory entries ordered by creation date.
   */
  async getSkillVault(skillId: string): Promise<RecallResult[]> {
    const container = getContainer(MEMORY_CONTAINER);
    const querySpec = {
      query: 'SELECT c.content, c.skillId, c.tags, c.createdAt FROM c WHERE c.userId = @userId AND c.skillId = @skillId ORDER BY c.createdAt DESC',
      parameters: [
        { name: '@userId', value: this.userId },
        { name: '@skillId', value: skillId },
      ],
    };

    try {
      const { resources } = await container.items.query<{
        content: string;
        skillId?: string;
        tags: string[];
        createdAt: string;
      }>(querySpec).fetchAll();

      return resources.map((r) => ({ ...r, score: 1.0 }));
    } catch (err) {
      console.warn(`[MemoryManager] getSkillVault failed: ${err}`);
      return [];
    }
  }

  /**
   * Upsert a skill-specific memory entry (keyed by skillId + content hash).
   * Useful for skill config, learned preferences, etc.
   */
  async upsertSkillMemory(skillId: string, data: { key: string; value: string }): Promise<void> {
    const container = getContainer(MEMORY_CONTAINER);
    const id = `skill-${skillId}-${data.key}`;

    // Generate embedding for the value
    let vector: number[] | undefined;
    try {
      const client = new FoundryClient(getModelRouting());
      vector = await client.getEmbedding(data.value);
    } catch {
      // Non-fatal — store without vector
    }

    await container.items.upsert({
      id,
      userId: this.userId,
      content: data.value,
      skillId,
      tags: ['skill-memory', data.key],
      metadata: { type: 'skill_memory', key: data.key },
      vector,
      createdAt: new Date().toISOString(),
      ttl: 31536000,
    });

    // Update central catalog
    await this.updateCatalogEntry(skillId).catch(() => { /* non-fatal */ });
  }

  /**
   * Delete all memories for a specific skill vault.
   * Supports "forget everything about X skill" command (#65).
   */
  async forgetSkillMemory(skillId: string): Promise<number> {
    const container = getContainer(MEMORY_CONTAINER);
    const querySpec = {
      query: 'SELECT c.id FROM c WHERE c.userId = @userId AND c.skillId = @skillId',
      parameters: [
        { name: '@userId', value: this.userId },
        { name: '@skillId', value: skillId },
      ],
    };

    try {
      const { resources } = await container.items.query<{ id: string }>(querySpec).fetchAll();
      let deleted = 0;
      for (const doc of resources) {
        await container.item(doc.id, this.userId).delete();
        deleted++;
      }

      // Remove catalog entry
      await this.removeCatalogEntry(skillId).catch(() => { /* non-fatal */ });

      return deleted;
    } catch (err) {
      console.warn(`[MemoryManager] forgetSkillMemory failed: ${err}`);
      return 0;
    }
  }

  /**
   * Recall memories scoped to specific skill domains.
   * JIT injection: only relevant skill memory is injected per turn (#66).
   */
  async recallForSkills(query: string, skillIds: string[], options?: RecallOptions): Promise<Map<string, RecallResult[]>> {
    const result = new Map<string, RecallResult[]>();

    for (const skillId of skillIds) {
      const memories = await this.recall(query, {
        ...options,
        skillId,
        topK: options?.topK ?? 2,
        minScore: options?.minScore ?? 0.65,
      });
      if (memories.length > 0) {
        result.set(skillId, memories);
      }
    }

    return result;
  }

  /**
   * Store a tool execution result as skill memory.
   * Called after successful tool dispatch to build up the skill vault (#66).
   */
  async storeToolResult(skillId: string, toolName: string, result: string): Promise<void> {
    // Only store meaningful results (not errors, empty, or very short)
    if (!result || result.length < 30) return;

    // Truncate very long results to keep memory manageable
    const truncated = result.length > 500 ? result.slice(0, 497) + '...' : result;

    await this.store({
      content: `Tool ${toolName} result: ${truncated}`,
      skillId,
      tags: ['tool-result', toolName],
      metadata: { type: 'tool_result', toolName },
    });
  }

  /**
   * Get summary of all skill vaults for the catalog (#67).
   */
  async getSkillCatalog(): Promise<Array<{ skillId: string; entryCount: number; lastUpdated: string }>> {
    const container = getContainer(CATALOG_CONTAINER);
    const querySpec = {
      query: 'SELECT * FROM c WHERE c.userId = @userId AND c.type = "skill-vault-summary"',
      parameters: [{ name: '@userId', value: this.userId }],
    };

    try {
      const { resources } = await container.items.query<{
        skillId: string;
        entryCount: number;
        lastUpdated: string;
      }>(querySpec).fetchAll();
      return resources;
    } catch {
      return [];
    }
  }

  /**
   * Update the central catalog entry for a skill vault (#67).
   */
  private async updateCatalogEntry(skillId: string): Promise<void> {
    const memoryContainer = getContainer(MEMORY_CONTAINER);
    const catalogContainer = getContainer(CATALOG_CONTAINER);

    // Count entries for this skill
    const countSpec = {
      query: 'SELECT VALUE COUNT(1) FROM c WHERE c.userId = @userId AND c.skillId = @skillId',
      parameters: [
        { name: '@userId', value: this.userId },
        { name: '@skillId', value: skillId },
      ],
    };

    const { resources } = await memoryContainer.items.query<number>(countSpec).fetchAll();
    const entryCount = resources[0] ?? 0;

    await catalogContainer.items.upsert({
      id: `vault-${this.userId}-${skillId}`,
      userId: this.userId,
      skillId,
      type: 'skill-vault-summary',
      entryCount,
      lastUpdated: new Date().toISOString(),
    });
  }

  /**
   * Remove the central catalog entry for a forgotten skill (#67).
   */
  private async removeCatalogEntry(skillId: string): Promise<void> {
    const container = getContainer(CATALOG_CONTAINER);
    try {
      await container.item(`vault-${this.userId}-${skillId}`, this.userId).delete();
    } catch {
      // Document may not exist
    }
  }
}
