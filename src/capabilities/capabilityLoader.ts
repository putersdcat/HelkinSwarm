// Capability loader — scans skills/*/manifest.json at startup and registers tools.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #49

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CapabilityManifestSchema } from './manifestSchema.js';
import type { CapabilityManifest, MaintenanceTask } from './manifestSchema.js';
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

/**
 * Get all loaded manifests (for lifecycle management and maintenance sweeps).
 */
export function getAllManifests(): CapabilityManifest[] {
  return [...manifestRegistry.values()];
}

/**
 * Return the list of skill domains that declare the given skillId as a dependency.
 * Used by helkin_uninstall_skill to enforce uninstall protection (#200).
 */
export function getDependentsOf(skillId: string): string[] {
  return [...manifestRegistry.values()]
    .filter((m) => m.dependencies?.includes(skillId))
    .map((m) => m.domain);
}

/**
 * Get the dependency list for a skill (ids of skills it requires).
 */
export function getDependenciesOf(skillId: string): string[] {
  return manifestRegistry.get(skillId)?.dependencies ?? [];
}

/**
 * Collect all maintenanceTasks across installed skills, tagged with domain.
 */
export function getAllMaintenanceTasks(): Array<{
  domain: string;
  task: MaintenanceTask;
}> {
  const tasks: Array<{ domain: string; task: MaintenanceTask }> = [];
  for (const manifest of manifestRegistry.values()) {
    if (manifest.maintenanceTasks) {
      for (const task of manifest.maintenanceTasks) {
        tasks.push({ domain: manifest.domain, task });
      }
    }
  }
  return tasks;
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
            requiresConfirmation: tool.requiresConfirmation,
            privilegeClass: tool.privilegeClass,
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

// ---------------------------------------------------------------------------
// Skill catalog — rich metadata for Skills Library tab (#197)
// ---------------------------------------------------------------------------

export interface SkillCatalogEntry {
  domain: string;
  displayName: string;
  shortDescription: string;
  iconUrl: string;
  onboardingMethod: string;
  toolCount: number;
  toolNames: string[];
  installed: boolean;
  linkRequired: boolean;
}

/** Returns rich skill metadata from loaded manifests for the Skills Library tab. */
export function getSkillCatalog(): SkillCatalogEntry[] {
  const catalog: SkillCatalogEntry[] = [];
  for (const manifest of manifestRegistry.values()) {
    catalog.push({
      domain: manifest.domain,
      displayName: manifest.displayName,
      shortDescription: manifest.shortDescription,
      iconUrl: manifest.iconUrl,
      onboardingMethod: manifest.onboardingMethod,
      toolCount: manifest.tools.length,
      toolNames: manifest.tools.map((t) => t.name),
      installed: true,
      linkRequired:
        manifest.onboardingMethod === 'post-install-link' ||
        manifest.onboardingMethod === 'both',
    });
  }
  return catalog.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
