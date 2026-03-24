// Capability loader — scans skills/*/manifest.json at startup and registers tools.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #49

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CapabilityManifestSchema } from './manifestSchema.js';
import type { CapabilityManifest } from './manifestSchema.js';
import { toolRegistry } from '../tools/toolRegistry.js';

// ---------------------------------------------------------------------------
// Tool handler type — async function that executes a tool
// ---------------------------------------------------------------------------

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Handler registry — maps tool names to their async handler functions
// ---------------------------------------------------------------------------

const handlerRegistry = new Map<string, ToolHandler>();

// ---------------------------------------------------------------------------
// Manifest registry — stores loaded manifests by domain for runtime lookups
// ---------------------------------------------------------------------------

const manifestRegistry = new Map<string, CapabilityManifest>();

export function getManifest(domain: string): CapabilityManifest | undefined {
  return manifestRegistry.get(domain);
}

export function getLinkableSkills(): CapabilityManifest[] {
  return [...manifestRegistry.values()].filter((m) => m.linkConfig);
}

export function registerHandler(toolName: string, handler: ToolHandler): void {
  handlerRegistry.set(toolName, handler);
}

export function getHandler(toolName: string): ToolHandler | undefined {
  return handlerRegistry.get(toolName);
}

// ---------------------------------------------------------------------------
// Skill discovery and loading
// ---------------------------------------------------------------------------

export interface LoadResult {
  skillsLoaded: number;
  toolsRegistered: number;
  errors: Array<{ path: string; error: string }>;
}

/**
 * Scan skills directories for manifest.json files, validate, and register tools.
 * Called once at startup.
 */
export async function loadCapabilities(
  skillsRoots: string[] = [join(process.cwd(), 'skills')],
): Promise<LoadResult> {
  const result: LoadResult = { skillsLoaded: 0, toolsRegistered: 0, errors: [] };
  manifestRegistry.clear();

  for (const root of skillsRoots) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      // Skills root may not exist yet
      continue;
    }

    for (const entry of entries) {
      const skillDir = join(root, entry);
      const manifestPath = join(skillDir, 'manifest.json');

      try {
        const dirStat = await stat(skillDir);
        if (!dirStat.isDirectory()) continue;

        const raw = await readFile(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        const manifest: CapabilityManifest = CapabilityManifestSchema.parse(parsed);

        // Store manifest for runtime lookups (e.g., linkConfig for /link commands)
        manifestRegistry.set(manifest.domain, manifest);

        // Register tools from manifest
        for (const tool of manifest.tools) {
          toolRegistry.register({
            name: tool.name,
            description: tool.description,
            risk: tool.risk,
            dataSensitivity: tool.dataSensitivity,
            requiresExecutor: tool.requiresExecutor,
            requiresSubAgent: tool.requiresSubAgent,
            handlerModule: `skills/${manifest.domain}`,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
          });
          result.toolsRegistered++;
        }

        // Load handlers if handlers.js exists
        await loadHandlers(skillDir, manifest);

        result.skillsLoaded++;
      } catch (err) {
        // Skip directories without manifest.json (not an error — could be .gitkeep only)
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('ENOENT')) {
          result.errors.push({ path: manifestPath, error: msg });
        }
      }
    }
  }

  return result;
}

/**
 * Dynamically load handler functions from a skill's handlers.js module.
 * Handlers compile to dist/skills/<domain>/handlers.js.
 */
async function loadHandlers(
  _skillDir: string,
  manifest: CapabilityManifest,
): Promise<void> {
  // Compiled handlers live under dist/skills/<domain>/handlers.js
  const distSkillDir = join(process.cwd(), 'dist', 'skills', manifest.domain);
  const handlersPath = join(distSkillDir, 'handlers.js');

  try {
    await stat(handlersPath);
  } catch {
    // No handlers file — tools will be declaration-only (no execution)
    return;
  }

  // Dynamic import of the handlers module
  const handlerModule = (await import(handlersPath)) as Record<string, unknown>;

  for (const tool of manifest.tools) {
    const handler = handlerModule[tool.name];
    if (typeof handler === 'function') {
      registerHandler(tool.name, handler as ToolHandler);
    }
  }
}

// ---------------------------------------------------------------------------
// Tab backend helpers (ADDENDA-03 — #141)
// These are called by the tab API backends to populate quick-stat cards.
// ---------------------------------------------------------------------------

/** Total number of tools registered across all loaded skills. */
export function getLoadedCapabilitiesCount(): number {
  return toolRegistry.size;
}

/**
 * List of active skill domains (e.g. ["helkin", "github", "outlook"])
 * derived from tool name prefixes.
 */
export function getActiveSkills(): string[] {
  const domains = new Set<string>();
  for (const name of toolRegistry.getToolNames()) {
    const domain = name.split('_')[0];
    if (domain) domains.add(domain);
  }
  return Array.from(domains).sort();
}
