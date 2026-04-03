import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('living session active redirection source guards', () => {
  it('keeps the Teams-message path on the safe queue fallback while the narrower direct-redirection blocker remains open', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const limbicSource = readFileSync('src/orchestrator/limbicIngressActivity.ts', 'utf8');

    expect(botSource).toContain('const activeSessionRoutable = false;');
    expect(botSource).toContain('activeSessionRoutable,');
    expect(limbicSource).toContain('activeSessionRoutable: z.boolean().default(false),');
    expect(limbicSource).toContain("if (input.hasActiveSession && input.activeSessionRoutable) {");
    expect(limbicSource).toContain('redirect this work into the existing Conscious Thread');
  });

  it('keeps queue fallback wording for unroutable active-session overlap', () => {
    const limbicSource = readFileSync('src/orchestrator/limbicIngressActivity.ts', 'utf8');

    expect(limbicSource).toContain('no routable living session was found');
  });
});