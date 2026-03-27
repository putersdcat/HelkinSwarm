// Tool registry — central registry of all tools with risk levels and schemas.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 04-Safety-Architecture.md

import { z } from 'zod';
import { isReadOnly } from '../config/safetyConfig.js';

// ---------------------------------------------------------------------------
// Types — re-export from manifestSchema for backward compatibility
// ---------------------------------------------------------------------------

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const DataSensitivity = z.enum(['non-pii', 'pii', 'mixed']);
export type DataSensitivity = z.infer<typeof DataSensitivity>;

export const PrivilegeClass = z.enum(['read-only', 'read-write', 'create', 'delete']);
export type PrivilegeClass = z.infer<typeof PrivilegeClass>;

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  risk: RiskLevel,
  dataSensitivity: DataSensitivity,
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  handlerModule: z.string().optional(),
  requiresExecutor: z.boolean().default(false),
  /** Route through subAgentActivity for fresh isolated LLM session (#47) */
  requiresSubAgent: z.boolean().default(false),
  /** Tool declares explicit human confirmation requirement regardless of risk level (#247) */
  requiresConfirmation: z.boolean().default(false),
  /** Privilege class for scoped token minting scope decisions (#316) */
  privilegeClass: PrivilegeClass.default('read-only'),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolDefinitionInput = z.input<typeof ToolDefinitionSchema>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool definition. Accepts partial input — Zod defaults fill gaps.
   */
  register(def: ToolDefinitionInput): void {
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
   * Get tools filtered by the current safety mode.
   * read-only → low risk only; confirmation-gated / full-destructive → all tools.
   * Spec ref: 06 — "Safety Filter removes any tool that violates the current safety mode"
   */
  getSafetyFiltered(): ToolDefinition[] {
    if (isReadOnly()) {
      return this.getUpToRisk('low');
    }
    return this.getAll();
  }

  /**
   * Convert to OpenAI-compatible function schemas.
   */
  toFunctionSchemas(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return this.getSafetyFiltered().map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      },
    }));
  }

  /**
   * Check if a specific tool is allowed under the current safety mode.
   */
  isAllowedBySafetyMode(toolName: string): boolean {
    if (!isReadOnly()) return true;
    const tool = this.get(toolName);
    return !!tool && tool.risk === 'low';
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.tools.clear();
  }

  /** Number of registered tools. */
  get size(): number {
    return this.tools.size;
  }
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

export const toolRegistry = new ToolRegistry();
