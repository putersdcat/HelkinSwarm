import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type CapabilityManifest, CapabilityManifestSchema, type ToolManifestEntry } from '../capabilities/manifestSchema.js';
import { loadCapabilities } from '../capabilities/capabilityLoader.js';
import { smokeTestMcpServerForManifest, type McpSmokeTestResult } from './mcpConnector.js';
import { loadMcpForgeBundle, persistSkillForgeBundle } from '../orchestrator/skillForgeBundleStore.js';

export interface ApproveMcpForgeBundleResult {
  status: 'approved-local';
  bundlePath: string;
  skillId: string;
  manifestPath: string;
  smokeTest: {
    passed: boolean;
    toolCount: number;
    toolNames: string[];
  };
  reloadSummary: {
    skillsLoaded: number;
    toolsRegistered: number;
    errors: Array<{ path: string; error: string }>;
  };
  sourcePromotion: {
    branchName: string | null;
    eligible: boolean;
    note: string;
  };
}

export async function approveMcpForgeBundleLocally(bundlePath: string): Promise<ApproveMcpForgeBundleResult> {
  const bundle = await loadMcpForgeBundle(bundlePath);
  if (bundle.status === 'rejected') {
    throw new Error(`Cannot approve rejected McpForge bundle '${bundlePath}'.`);
  }

  const draftManifestFile = bundle.files.find((file) => file.path.endsWith('/manifest.draft.json'));
  if (!draftManifestFile) {
    throw new Error(`McpForge bundle '${bundlePath}' does not include a draft manifest.`);
  }

  const draftManifest = CapabilityManifestSchema.parse(JSON.parse(draftManifestFile.content) as unknown);
  const smokeTest = await smokeTestMcpServerForManifest(draftManifest);
  if (!smokeTest.passed || smokeTest.toolCount === 0) {
    throw new Error(`MCP smoke test did not expose any callable tools for '${bundle.draftSkillId}'.`);
  }

  const activatedManifest = buildActivatedManifest(draftManifest, smokeTest);
  const manifestPath = join(process.cwd(), 'skills', 'custom', activatedManifest.domain, 'manifest.json');
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(activatedManifest, null, 2)}\n`, 'utf8');

  const reloadSummary = await loadCapabilities();

  await persistSkillForgeBundle({
    userId: extractUserIdFromBundlePath(bundlePath),
    skillId: bundle.draftSkillId,
    correlationId: `${Date.now()}-approved-local`,
    payload: {
      ...bundle,
      status: 'approved-local',
      smokeTest: {
        passed: smokeTest.passed,
        toolCount: smokeTest.toolCount,
        toolNames: smokeTest.tools.map((tool) => tool.name),
      },
      localActivation: {
        manifestPath: relativeManifestPath(manifestPath),
        activatedAt: new Date().toISOString(),
      },
      files: bundle.files.map((file) => {
        if (file.path.endsWith('/manifest.draft.json')) {
          return {
            ...file,
            path: relativeManifestPath(manifestPath),
            content: JSON.stringify(activatedManifest, null, 2),
            purpose: 'activated local manifest after AI smoke-test approval',
          };
        }
        return file;
      }),
    },
  });

  return {
    status: 'approved-local',
    bundlePath,
    skillId: activatedManifest.domain,
    manifestPath: relativeManifestPath(manifestPath),
    smokeTest: {
      passed: smokeTest.passed,
      toolCount: smokeTest.toolCount,
      toolNames: smokeTest.tools.map((tool) => tool.name),
    },
    reloadSummary,
    sourcePromotion: {
      branchName: bundle.branchName ?? null,
      eligible: true,
      note: 'This stamp-local MCP skill can later be graduated back to source via the SkillForge GitHub App lane once it proves stable in real use.',
    },
  };
}

function buildActivatedManifest(draftManifest: CapabilityManifest, smokeTest: McpSmokeTestResult): CapabilityManifest {
  const toolNames = new Set<string>();
  const tools: ToolManifestEntry[] = smokeTest.tools.map((remoteTool) => {
    const toolName = toSnakeCase(remoteTool.name);
    const uniqueToolName = uniquifyToolName(toolName, toolNames);
    const risk = classifyRisk(remoteTool);
    const privilegeClass = classifyPrivilege(remoteTool);
    const requiresConfirmation = privilegeClass !== 'read-only' || risk !== 'low';

    return {
      name: uniqueToolName,
      remoteToolName: remoteTool.name,
      description: remoteTool.description ?? `MCP tool bridged from ${draftManifest.displayName}: ${remoteTool.name}`,
      risk,
      dataSensitivity: classifyDataSensitivity(remoteTool),
      allowedModelLane: 'any',
      requiresConfirmation,
      requiresExecutor: false,
      requiresSubAgent: false,
      privilegeClass,
      externalAutomationCapabilities: [],
      longTermMemorySchema: [],
      aliases: [remoteTool.name],
      discoveryTerms: [remoteTool.name, draftManifest.displayName],
      useWhen: [`Use when you need the remote MCP tool '${remoteTool.name}'.`],
      avoidWhen: requiresConfirmation ? ['Avoid when you cannot safely confirm an external action.'] : [],
      typicalInputs: ['Tool-specific MCP arguments'],
      returnsSummaryShape: 'remote MCP tool result',
      inputSchema: {
        type: 'object',
        additionalProperties: true,
        description: `Pass-through arguments for remote MCP tool '${remoteTool.name}'.`,
      },
    };
  });

  return CapabilityManifestSchema.parse({
    ...draftManifest,
    version: '0.1.0-local',
    tools,
    recommendedEntryTools: tools.slice(0, Math.min(3, tools.length)).map((tool) => tool.name),
  });
}

function classifyRisk(tool: { name: string; description?: string }): ToolManifestEntry['risk'] {
  const haystack = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
  if (/(delete|remove|destroy|purge|drop|wipe|revoke|terminate)/.test(haystack)) return 'high';
  if (/(create|update|write|send|post|publish|install|enable|disable|provision|assign|grant)/.test(haystack)) return 'medium';
  return 'low';
}

function classifyPrivilege(tool: { name: string; description?: string }): ToolManifestEntry['privilegeClass'] {
  const haystack = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
  if (/(delete|remove|destroy|purge|drop|wipe|revoke|terminate)/.test(haystack)) return 'delete';
  if (/(create|provision|install|publish|send|post)/.test(haystack)) return 'create';
  if (/(update|write|edit|assign|grant|enable|disable)/.test(haystack)) return 'read-write';
  return 'read-only';
}

function classifyDataSensitivity(tool: { name: string; description?: string }): ToolManifestEntry['dataSensitivity'] {
  const haystack = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
  if (/(mail|email|identity|tenant|directory|user|customer|message|account|license)/.test(haystack)) return 'mixed';
  return 'non-pii';
}

function toSnakeCase(value: string): string {
  const snake = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return snake.length > 0 ? snake : 'mcp_tool';
}

function uniquifyToolName(baseName: string, seen: Set<string>): string {
  let candidate = baseName;
  let suffix = 2;
  while (seen.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}

function relativeManifestPath(absolutePath: string): string {
  return absolutePath.replace(`${process.cwd()}\\`, '').replaceAll('\\', '/');
}

function extractUserIdFromBundlePath(bundlePath: string): string {
  const parts = bundlePath.split('/');
  return parts.length >= 4 ? parts[1] ?? 'unknown-user' : 'unknown-user';
}
