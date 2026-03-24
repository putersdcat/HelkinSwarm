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
  approvalsMode: ApprovalsMode;
  rateLimitCooldownBaseSeconds: number;
  rateLimitCooldownMaxSeconds: number;
  startNewSession: boolean;
  contentCheckEnabled: boolean;
  watchPaths: string[];
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
    approvalsMode: cfg.get<ApprovalsMode>('approvalsMode', 'default'),
    rateLimitCooldownBaseSeconds: cfg.get<number>('rateLimitCooldownBaseSeconds', 30),
    rateLimitCooldownMaxSeconds: cfg.get<number>('rateLimitCooldownMaxSeconds', 600),
    startNewSession: cfg.get<boolean>('startNewSession', true),
    contentCheckEnabled: cfg.get<boolean>('contentCheckEnabled', true),
    watchPaths: cfg.get<string[]>('watchPaths', []),
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
