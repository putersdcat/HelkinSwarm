// Source-level verification: swarm worker emits per-round 'status' chatroom
// messages so the Swarm Activity tab shows live tool work, not just the final
// chatroom_send wrap-up.
// Issue: #695

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

describe("swarmWorkerActivity — per-round 'status' chatroom emission (#695)", () => {
  it('declares a round-local roundToolNames array', () => {
    expect(workerSrc).toContain('const roundToolNames: string[] = []');
  });

  it('appends each executed tool name to roundToolNames', () => {
    expect(workerSrc).toContain('roundToolNames.push(tc.function.name)');
  });

  it('emits a status chatroom message at the end of each round when there is observable activity', () => {
    expect(workerSrc).toContain("contentType: 'status'");
    expect(workerSrc).toContain('Round ${round + 1}:');
  });

  it('skips emission when the round had no tools and no assistant text', () => {
    expect(workerSrc).toContain('roundHasObservableActivity');
    expect(workerSrc).toContain('roundToolNames.length > 0 || roundAssistantText.length > 0');
  });

  it('routes the round status message to All so the chatroom shows it', () => {
    // Crude proximity check — the status block targets 'All'
    const statusBlock = workerSrc.split("contentType: 'status'")[1] ?? '';
    expect(workerSrc).toMatch(/to: 'All'[\s\S]{0,400}contentType: 'status'/);
    // Sanity: the block continues with timestamp + correlationId
    expect(statusBlock).toContain('correlationId: input.swarmCorrelationId');
  });
});
