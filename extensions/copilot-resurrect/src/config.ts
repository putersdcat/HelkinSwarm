import * as vscode from 'vscode';

export const EXT_ID = 'copilot-resurrect';

export interface ResurrectConfig {
  enabled: boolean;
  ignitionPrompt: string;
  silenceTimeoutSeconds: number;
  maxRestartsPerDay: number;
  modelHint: string;
  fallbackModelHint: string;
  rateLimitCooldownSeconds: number;
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
    modelHint: cfg.get<string>('modelHint', ''),
    fallbackModelHint: cfg.get<string>('fallbackModelHint', ''),
    rateLimitCooldownSeconds: cfg.get<number>('rateLimitCooldownSeconds', 60),
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
 * Build the full ignition prompt from config (prepend modelHint if supplied).
 * When useRateLimitFallback is true and a fallbackModelHint is configured,
 * uses the fallback model instead of the primary one.
 */
export function buildFullPrompt(cfg: ResurrectConfig, useRateLimitFallback = false): string {
  let hint = cfg.modelHint.trim();
  if (useRateLimitFallback && cfg.fallbackModelHint.trim()) {
    hint = cfg.fallbackModelHint.trim();
  }
  const prompt = cfg.ignitionPrompt.trim();
  if (!prompt) {
    return '';
  }
  return hint ? `${hint} ${prompt}` : prompt;
}
