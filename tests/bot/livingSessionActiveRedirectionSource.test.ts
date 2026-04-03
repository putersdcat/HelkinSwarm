import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('living session active redirection source guards', () => {
  it('redirects Teams overlap into the active overseer instead of queueing when a routable living session exists', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const limbicSource = readFileSync('src/orchestrator/limbicIngressActivity.ts', 'utf8');

    expect(botSource).toContain('const activeSessionRoutable = hasActiveGuard && effectiveActiveInstanceId !== undefined;');
    expect(botSource).toContain('activeSessionRoutable,');
    expect(botSource).toContain("authority: 'living-session-active-redirection'");
    expect(botSource).toContain("await client.raiseEvent(effectiveActiveInstanceId, 'NewMessage', event);");
    expect(limbicSource).toContain('activeSessionRoutable: z.boolean().default(false),');
    expect(limbicSource).toContain("if (input.hasActiveSession && input.activeSessionRoutable) {");
    expect(limbicSource).toContain('redirect this work into the existing Conscious Thread');
  });

  it('keeps queue fallback wording for unroutable active-session overlap', () => {
    const limbicSource = readFileSync('src/orchestrator/limbicIngressActivity.ts', 'utf8');

    expect(limbicSource).toContain('no routable living session was found');
  });
});