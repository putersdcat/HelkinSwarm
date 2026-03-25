import * as vscode from 'vscode';

export const EXT_ID = 'copilot-resurrect';

export type ApprovalsMode = 'default' | 'bypass' | 'autopilot';

export interface ResurrectConfig {
  enabled: boolean;
  ignitionPrompt: string;
  silenceTimeoutSeconds: number;
  maxRestartsPerDay: number;
  preferredModel: string;
  fallbackModel: string;
  chatParticipant: string;
  agentMode: string;
  approvalsMode: ApprovalsMode;
  rateLimitCooldownBaseSeconds: number;
  rateLimitCooldownMaxSeconds: number;
  startNewSession: boolean;
  contentCheckEnabled: boolean;
  watchPaths: string[];
  watchIgnorePatterns: string[];
}

export function getConfig(): ResurrectConfig {
  const cfg = vscode.workspace.getConfiguration(EXT_ID);
  return {
    enabled: cfg.get<boolean>('enabled', false),
    ignitionPrompt: cfg.get<string>('ignitionPrompt', ''),
    silenceTimeoutSeconds: cfg.get<number>('silenceTimeoutSeconds', 180),
    maxRestartsPerDay: cfg.get<number>('maxRestartsPerDay', 50),
    preferredModel: cfg.get<string>('preferredModel', ''),
    fallbackModel: cfg.get<string>('fallbackModel', ''),
    chatParticipant: cfg.get<string>('chatParticipant', ''),
    agentMode: cfg.get<string>('agentMode', ''),
    approvalsMode: cfg.get<ApprovalsMode>('approvalsMode', 'default'),
    rateLimitCooldownBaseSeconds: cfg.get<number>('rateLimitCooldownBaseSeconds', 30),
    rateLimitCooldownMaxSeconds: cfg.get<number>('rateLimitCooldownMaxSeconds', 600),
    startNewSession: cfg.get<boolean>('startNewSession', true),
    contentCheckEnabled: cfg.get<boolean>('contentCheckEnabled', true),
    watchPaths: cfg.get<string[]>('watchPaths', []),
    watchIgnorePatterns: cfg.get<string[]>('watchIgnorePatterns', ['**/.git/**', '.git/**']),
  };
}

export async function setEnabled(value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(EXT_ID)
    .update('enabled', value, vscode.ConfigurationTarget.Global);
}

/**
 * Build the full ignition prompt from config.
 * Prepends @participant prefix if configured.
 */
export function buildFullPrompt(cfg: ResurrectConfig): string {
  const prompt = cfg.ignitionPrompt.trim();
  if (!prompt) {
    return '';
  }
  const participant = cfg.chatParticipant.trim();
  if (participant) {
    const prefix = participant.startsWith('@') ? participant : `@${participant}`;
    return `${prefix} ${prompt}`;
  }
  return prompt;
}

/**
 * Enumerate available language models from the Copilot vendor.
 * Returns model descriptors sorted by family name.
 */
export async function getAvailableModels(): Promise<vscode.LanguageModelChat[]> {
  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return models.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export interface AgentModeInfo {
  name: string;
  description: string;
  source: 'workspace' | 'builtin';
}

/** Built-in Copilot Chat modes. */
const BUILTIN_MODES: AgentModeInfo[] = [
  { name: 'agent', description: 'Agent mode — full tool access (default)', source: 'builtin' },
  { name: 'edit', description: 'Edit mode — can edit files, no terminal', source: 'builtin' },
  { name: 'ask', description: 'Ask mode — read-only, no tools', source: 'builtin' },
];

/**
 * Discover available agent modes by scanning workspace `.github/agents/*.agent.md`
 * files and parsing their YAML frontmatter `description` field.
 * Returns built-in modes + discovered custom agents.
 */
export async function discoverAgentModes(): Promise<AgentModeInfo[]> {
  const results: AgentModeInfo[] = [...BUILTIN_MODES];

  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return results;
  }

  for (const folder of folders) {
    const agentsDir = vscode.Uri.joinPath(folder.uri, '.github', 'agents');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(agentsDir);
    } catch {
      continue; // No .github/agents/ in this folder
    }

    for (const [fileName, fileType] of entries) {
      if (fileType !== vscode.FileType.File || !fileName.endsWith('.agent.md')) {
        continue;
      }
      const modeName = fileName.replace('.agent.md', '');

      // Parse description from YAML frontmatter
      let description = '';
      try {
        const fileUri = vscode.Uri.joinPath(agentsDir, fileName);
        const raw = await vscode.workspace.fs.readFile(fileUri);
        const text = new TextDecoder('utf-8').decode(raw);
        const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          const descMatch = fmMatch[1].match(/description:\s*['"]?(.*?)['"]?\s*$/m);
          if (descMatch) {
            description = descMatch[1];
          }
        }
      } catch {
        // Skip files that can't be read
      }

      results.push({
        name: modeName,
        description: description || `Custom agent: ${modeName}`,
        source: 'workspace',
      });
    }
  }

  return results;
}
