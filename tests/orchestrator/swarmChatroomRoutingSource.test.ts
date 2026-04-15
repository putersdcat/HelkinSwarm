// Source-level verification: chatroom routing to target agent's persistent session chain.
// Issue: #661

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

const personasSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmPersonas.ts'),
  'utf-8',
);

describe('swarmWorkerActivity — chatroom_send routes to recipient Cosmos vault (#661)', () => {
  it('routes chatroom_send to recipient agent session partition', () => {
    expect(workerSrc).toContain('storeAgentSessionSummary(');
    expect(workerSrc).toContain('Chatroom from ${input.agentName}');
  });

  it('excludes Helkin, Leader, and All from routing', () => {
    expect(workerSrc).toContain("EXCLUDED_TARGETS = new Set(['helkin', 'leader', 'all'])");
  });

  it('routing is non-fatal (has .catch)', () => {
    expect(workerSrc).toContain('[Chatroom from ${input.agentName}');
    const storeIdx = workerSrc.indexOf('[Chatroom from ${input.agentName}');
    const catchIdx = workerSrc.indexOf('.catch(', storeIdx);
    expect(storeIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(storeIdx);
  });

  it('routing happens before tool response is sent back to LLM', () => {
    const routingIdx = workerSrc.indexOf("EXCLUDED_TARGETS = new Set(");
    const toolResponseIdx = workerSrc.indexOf("content: `Message sent to ${typeof to");
    expect(routingIdx).toBeGreaterThan(-1);
    expect(toolResponseIdx).toBeGreaterThan(-1);
    expect(routingIdx).toBeLessThan(toolResponseIdx);
  });
});

describe('swarmPersonas — worker prompt accurately describes chatroom delivery timing (#661)', () => {
  it('includes delivery timing note about queued messages', () => {
    expect(personasSrc).toContain('queued and delivered to the recipient at their next activation');
  });

  it('clarifies that parallel workers do not receive messages in real time', () => {
    expect(personasSrc).toContain('not see your messages in real time');
  });
});
