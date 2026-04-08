import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('post-reply memory ordering source guards', () => {
  it('moves memory storage out of sessionOrchestrator so visible replies can complete before best-effort memory writes', () => {
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');

    expect(sessionSource).not.toContain("yield context.df.callActivity('storeMemoryActivity'");
    expect(overseerSource).toContain("yield* runBestEffortPostReplyActivity(");
    expect(overseerSource).toContain("'postReplyBatchActivity'");
    expect(overseerSource).toContain('assistantReply: sessionResult.cleanResponse || sessionResult.response || \'(no response)\',');
    expect(overseerSource).toContain('[overseer] ${label} failed after reply');
  });
});