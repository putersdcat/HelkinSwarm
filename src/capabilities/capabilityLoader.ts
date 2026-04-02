// Capability loader — scans skills/*/manifest.json at startup and registers tools.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #49

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { CapabilityManifestSchema } from './manifestSchema.js';
import type { CapabilityManifest, MaintenanceTask } from './manifestSchema.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { clearSkillDiscoveryIndex, rebuildSkillDiscoveryIndex } from './skillDiscoveryIndex.js';
import { registerMcpHandlersForManifest } from '../mcp/mcpConnector.js';
import {
  assessSkillOperationalState,
  type SkillOperationalState,
} from './skillOperationalState.js';

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
  clearSkillDiscoveryIndex();

  for (const root of skillsRoots) {
    const skillDirs = await collectSkillDirectories(root);

    for (const skillDir of skillDirs) {
      const manifestPath = join(skillDir, 'manifest.json');
      const relativeSkillDir = relative(root, skillDir).split(sep).join('/');

      try {
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
            handlerModule: `skills/${relativeSkillDir}`,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
          });
          result.toolsRegistered++;
        }

        // Load handlers if handlers.js exists
        await loadHandlers(relativeSkillDir, manifest);
        await loadMcpHandlers(relativeSkillDir, manifest);

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

  rebuildSkillDiscoveryIndex(getAllManifests());

  return result;
}

async function collectSkillDirectories(root: string, currentDir: string = root): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(currentDir);
  } catch {
    return [];
  }

  const skillDirs: string[] = [];

  for (const entry of entries) {
    const entryPath = join(currentDir, entry);

    try {
      const entryStat = await stat(entryPath);
      if (!entryStat.isDirectory()) {
        continue;
      }

      const manifestPath = join(entryPath, 'manifest.json');
      try {
        const manifestStat = await stat(manifestPath);
        if (manifestStat.isFile()) {
          skillDirs.push(entryPath);
          continue;
        }
      } catch {
        // No manifest at this level — recurse deeper.
      }

      skillDirs.push(...await collectSkillDirectories(root, entryPath));
    } catch {
      // Ignore entries we cannot stat.
    }
  }

  return skillDirs;
}

/**
 * Dynamically load handler functions from a skill's handlers.js module.
 * Handlers compile to dist/skills/<domain>/handlers.js.
 */
async function loadHandlers(
  relativeSkillDir: string,
  manifest: CapabilityManifest,
): Promise<void> {
  // Compiled handlers live under dist/skills/<relative skill folder>/handlers.js
  const distSkillDir = join(process.cwd(), 'dist', 'skills', relativeSkillDir);
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

async function loadMcpHandlers(
  relativeSkillDir: string,
  manifest: CapabilityManifest,
): Promise<void> {
  if (!manifest.mcpServer) {
    return;
  }

  await registerMcpHandlersForManifest({
    relativeSkillDir,
    manifest,
    registerHandler,
  });
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
  lifecycleRules: string;
  toolCount: number;
  toolNames: string[];
  installed: boolean;
  linkRequired: boolean;
  dependencies: string[];
  requiredPermissions: string[];
  externalAccountsNeeded: string[];
  maintenanceTaskCount: number;
  operationalState: SkillOperationalState;
  operationalSummary: string;
}

/** Returns rich skill metadata from loaded manifests for the Skills Library tab. */
export function getSkillCatalog(): SkillCatalogEntry[] {
  const catalog: SkillCatalogEntry[] = [];
  const installedDomains = new Set(manifestRegistry.keys());
  for (const manifest of manifestRegistry.values()) {
    const assessment = assessSkillOperationalState(manifest, installedDomains);
    catalog.push({
      domain: manifest.domain,
      displayName: manifest.displayName,
      shortDescription: manifest.shortDescription,
      iconUrl: manifest.iconUrl,
      onboardingMethod: manifest.onboardingMethod,
      lifecycleRules: manifest.lifecycleRules,
      toolCount: manifest.tools.length,
      toolNames: manifest.tools.map((t) => t.name),
      installed: true,
      linkRequired:
        manifest.onboardingMethod === 'post-install-link' ||
        manifest.onboardingMethod === 'both',
      dependencies: manifest.dependencies ?? [],
      requiredPermissions: manifest.requiredPermissions ?? [],
      externalAccountsNeeded: manifest.externalAccountsNeeded ?? [],
      maintenanceTaskCount: manifest.maintenanceTasks?.length ?? 0,
      operationalState: assessment.operationalState,
      operationalSummary: assessment.message,
    });
  }
  return catalog.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface SkillInstallInspection {
  status: 'operational' | 'action-required' | 'operator-setup-required' | 'blocked' | 'not-installed';
  skillId: string;
  displayName?: string;
  onboardingMethod?: string;
  dependencies?: string[];
  missingDependencies?: string[];
  externalAccountsNeeded?: string[];
  requiredPermissions?: string[];
  steps?: string[];
  message: string;
}

export interface SkillUninstallInspection {
  status: 'ready' | 'blocked' | 'action-required' | 'not-installed';
  skillId: string;
  lifecycleRules?: string;
  blockingDependents?: string[];
  externalAccountsToClose?: string[];
  nextStep?: string;
  message: string;
}

export function inspectSkillInstall(skillId: string): SkillInstallInspection {
  const manifest = getManifest(skillId);
  if (!manifest) {
    return {
      status: 'not-installed',
      skillId,
      message: `Skill '${skillId}' is not currently installed in this stamp.`,
    };
  }

  const assessment = assessSkillOperationalState(manifest, manifestRegistry.keys());

  if (assessment.operationalState === 'blocked') {
    return {
      status: 'blocked',
      skillId,
      displayName: manifest.displayName,
      onboardingMethod: assessment.onboardingMethod,
      dependencies: assessment.dependencies,
      missingDependencies: assessment.missingDependencies,
      externalAccountsNeeded: assessment.externalAccountsNeeded,
      requiredPermissions: assessment.requiredPermissions,
      message: assessment.message,
    };
  }

  return {
    status: assessment.operationalState,
    skillId,
    displayName: manifest.displayName,
    onboardingMethod: assessment.onboardingMethod,
    dependencies: assessment.dependencies,
    externalAccountsNeeded: assessment.externalAccountsNeeded,
    requiredPermissions: assessment.requiredPermissions,
    steps: assessment.steps.length > 0 ? assessment.steps : ['No setup required — skill is ready to use.'],
    message: assessment.message,
  };
}

export function inspectSkillUninstall(skillId: string): SkillUninstallInspection {
  const manifest = getManifest(skillId);
  if (!manifest) {
    return {
      status: 'not-installed',
      skillId,
      message: `Skill '${skillId}' is not installed or not recognised.`,
    };
  }

  const dependents = getDependentsOf(skillId);
  if (dependents.length > 0) {
    return {
      status: 'blocked',
      skillId,
      lifecycleRules: manifest.lifecycleRules,
      blockingDependents: dependents,
      message: `Cannot uninstall '${skillId}' — the following installed skills depend on it: ${dependents.join(', ')}. Uninstall those first.`,
    };
  }

  const lifecycleRules = manifest.lifecycleRules ?? 'keep-credentials';
  const externalAccounts = manifest.externalAccountsNeeded ?? [];
  if (lifecycleRules === 'close-external-account') {
    return {
      status: 'action-required',
      skillId,
      lifecycleRules,
      externalAccountsToClose: externalAccounts,
      message: `Skill '${skillId}' uses external account(s): ${externalAccounts.join(', ')}. Close those accounts manually before uninstalling, then remove stored memories.`,
    };
  }

  return {
    status: 'ready',
    skillId,
    lifecycleRules,
    nextStep: `helkin_forget_skill({ skillId: '${skillId}' })`,
    message: `Skill '${skillId}' has no blocking dependents and requires no external account closure. Removing stored memories is the remaining cleanup step.`,
  };
}
