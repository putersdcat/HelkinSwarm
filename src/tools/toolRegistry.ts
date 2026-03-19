// Tool registry — central registry of all tools with risk levels and schemas.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 04-Safety-Architecture.md

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const DataSensitivity = z.enum(['non-pii', 'pii', 'mixed']);
export type DataSensitivity = z.infer<typeof DataSensitivity>;

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  risk: RiskLevel,
  dataSensitivity: DataSensitivity,
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  handlerModule: z.string().optional(),
  requiresExecutor: z.boolean().default(false),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// ---------------------------------------------------------------------------
// Capability manifest schema (for skills)
// ---------------------------------------------------------------------------

export const CapabilityManifestSchema = z.object({
  schemaVersion: z.string(),
  skillId: z.string(),
  tools: z.array(ToolDefinitionSchema),
});

export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private skillsRoot: string;

  constructor(skillsRoot = 'skills') {
    this.skillsRoot = skillsRoot;
  }

  /**
   * Register a tool definition.
   */
  register(def: ToolDefinition): void {
    const parsed = ToolDefinitionSchema.parse(def);
    this.tools.set(parsed.name, parsed);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all tools filtered by maximum risk level.
   * Used for read-only safety mode.
   */
  getUpToRisk(maxRisk: RiskLevel): ToolDefinition[] {
    const riskOrder: RiskLevel[] = ['low', 'medium', 'high'];
    const maxIndex = riskOrder.indexOf(maxRisk);
    return this.getAll().filter((t) => riskOrder.indexOf(t.risk) <= maxIndex);
  }

  /**
   * Get tools filtered by data sensitivity.
   */
  getBySensitivity(sensitivity: DataSensitivity): ToolDefinition[] {
    return this.getAll().filter((t) => t.dataSensitivity === sensitivity);
  }

  /**
   * Get all tool names.
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Convert to OpenAI-compatible function schemas.
   */
  toFunctionSchemas(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return this.getAll().map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      },
    }));
  }

  /**
   * Load tools from a capability manifest (scanned from skills/ directory).
   */
  loadFromManifest(manifest: CapabilityManifest): void {
    for (const tool of manifest.tools) {
      this.register({
        ...tool,
        handlerModule: `${this.skillsRoot}/${manifest.skillId}`,
      });
    }
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.tools.clear();
  }
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

export const toolRegistry = new ToolRegistry();

// ---------------------------------------------------------------------------
// Core built-in tools (always registered)
// ---------------------------------------------------------------------------

toolRegistry.register({
  name: 'helkin_health_check',
  description: 'Returns HelkinSwarm system health, active session count, and version.',
  risk: 'low',
  dataSensitivity: 'non-pii',
  requiresExecutor: false,
});

toolRegistry.register({
  name: 'helkin_list_skills',
  description: 'Lists all active skills and their last-used timestamps.',
  risk: 'low',
  dataSensitivity: 'non-pii',
  requiresExecutor: false,
});

toolRegistry.register({
  name: 'helkin_get_costs',
  description: 'Returns current month Azure spend breakdown by resource.',
  risk: 'low',
  dataSensitivity: 'non-pii',
  requiresExecutor: false,
});
