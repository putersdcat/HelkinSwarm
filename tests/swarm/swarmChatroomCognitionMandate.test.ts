// [#710 Gap 3] Source-pin: the swarm worker prompt MUST contain the
// per-round chatroom mandate. If a future refactor strips the language
// out of the persona, the swarm regresses to "3 messages from 11 rounds"
// silent behavior. This test guards the wording and the contentType.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmPersonas.ts'),
  'utf8',
);

describe('swarmPersonas — per-round chatroom mandate (#710 Gap 3)', () => {
  it('contains the chatroom-as-cognition heading', () => {
    expect(src).toContain('## Per-Round Chatroom Mandate (#710 Gap 3)');
  });

  it('mandates EVERY tool round must call chatroom_send', () => {
    expect(src).toMatch(/EVERY round in which you call a tool, you MUST also call chatroom_send/);
  });

  it("introduces the 'interim_finding' contentType for mid-round summaries", () => {
    expect(src).toMatch(/interim_finding/);
  });

  it('explicitly forbids batching findings to the final round', () => {
    expect(src).toMatch(/Do NOT batch findings to the final round/);
  });
});

describe('swarmTypes — interim_finding accepted by ChatroomMessageSchema (#710 Gap 3)', () => {
  it("declares 'interim_finding' in the contentType enum", async () => {
    const { ChatroomMessageSchema } = await import('../../src/orchestrator/swarm/swarmTypes.js');
    const result = ChatroomMessageSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      from: 'Benjamin',
      to: 'Helkin',
      content: 'web_fetch_page returned the menu — chocolate ganache uses 70% cocoa.',
      contentType: 'interim_finding',
      timestamp: Date.now(),
      correlationId: 'corr-1',
    });
    expect(result.success).toBe(true);
  });
});

describe('swarmWorkerActivity — low-chatter detection wired (#710 Gap 3)', () => {
  it('source contains the low-chatter heuristic and System notice', () => {
    const wsrc = readFileSync(
      join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
      'utf8',
    );
    // Heuristic: at least 3 tool calls AND chatter < ceil(rounds/2).
    expect(wsrc).toContain('toolCallsMade >= 3');
    expect(wsrc).toContain('Math.ceil(toolRoundCount / 2)');
    // Telemetry event
    expect(wsrc).toContain("name: 'SwarmWorkerLowChatter'");
    // System notice to Helkin so the leader can weight a thin contributor
    expect(wsrc).toMatch(/from:\s*'System'[\s\S]{0,80}to:\s*'Helkin'/);
    expect(wsrc).toMatch(/contribution may be incomplete/);
  });

  it("declares 'interim_finding' in the worker chatroom_send tool schema", () => {
    const wsrc = readFileSync(
      join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
      'utf8',
    );
    expect(wsrc).toMatch(/'partial_result',\s*'cross_verification',\s*'question',\s*'status',\s*'interim_finding'/);
  });
});
