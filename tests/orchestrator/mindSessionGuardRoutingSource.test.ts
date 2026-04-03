import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('mind session guard routing source guards', () => {
  it('registers the guard entity and wires acquire/release bookkeeping into current runtime paths', () => {
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const replaySource = readFileSync('src/orchestrator/pendingIntentReplay.ts', 'utf8');
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');

    expect(indexSource).toContain("import '../orchestrator/mindSessionGuard.js';");
    expect(botSource).toContain("readMindSessionGuardState,");
    expect(botSource).toContain("signalMindSessionAcquire,");
    expect(botSource).toContain("authority: 'living-session-active-redirection'");
    expect(botSource).toContain('await signalMindSessionAcquire(client, userId, {');
    expect(replaySource).toContain("authority: 'living-session-active-redirection'");
    expect(replaySource).toContain('await signalMindSessionAcquire(client, intent.userId, {');
    expect(indexSource).toContain("import '../orchestrator/ingressWindowStageActivity.js';");
    expect(overseerSource).toContain('MIND_SESSION_GUARD_ENTITY_NAME');
    expect(overseerSource).toContain("context.df.signalEntity(");
    expect(overseerSource).toContain("'release'");
    expect(overseerSource).toContain("context.df.waitForExternalEvent('NewMessage')");
    expect(overseerSource).toContain("action: 'open'");
    expect(overseerSource).toContain("action: 'drain'");
    expect(overseerSource.indexOf("'release'", overseerSource.indexOf('saveChronoContinuityActivity'))).toBeGreaterThan(-1);
  });
});