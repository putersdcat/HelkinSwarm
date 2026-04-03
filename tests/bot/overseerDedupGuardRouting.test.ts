import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot overseer dedup guard routing', () => {
  it('passes Teams activity ids into durable dedup and suppresses duplicate placeholders', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const helperSource = readFileSync('src/bot/overseerDedupIdentity.ts', 'utf8');

    expect(source).toContain('import { buildOverseerDedupIdentity } from \'./overseerDedupIdentity.js\';');
    expect(source).toContain('messageId?: string,');
    expect(source).toContain('await this.findExistingOverseerInstance(');
    expect(source).toContain('context.activity.id,');
    expect(source).toContain('await this.handleRaiseToOverseerResult(context, userId, correlationId, ackResponse?.id, result);');
    expect(helperSource).toContain('message:${input.messageId ?? \'none\'}');
  });

  it('routes overseer starts through the limbic ingress compatibility seam', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');
    const envSource = readFileSync('src/config/envConfig.ts', 'utf8');

    expect(indexSource).toContain("import '../orchestrator/limbicIngressActivity.js';");
    expect(botSource).toContain("import { recordLimbicIngressDecision } from '../orchestrator/limbicIngressActivity.js';");
    expect(botSource).toContain("source: 'teams-message'");
    expect(botSource).toContain('compatibilityMode: getEnvConfig().livingMindCompatibilityMode');
    expect(replaySource).toContain("import { recordLimbicIngressDecision } from './limbicIngressActivity.js';");
    expect(replaySource).toContain("source: 'pending-intent-replay'");
    expect(envSource).toContain('livingMindCompatibilityMode: z.boolean().default(false),');
    expect(envSource).toContain("process.env['LIVING_MIND_COMPAT_MODE'] === undefined");
  });
});