import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// #680 — SwarmChatroom Durable Entity must be destroyed on every swarm exit
// path, or every turn leaks a zombie Running entity in the Sessions tab.

const entitySource = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmChatroomEntity.ts'),
  'utf-8',
);

const orchestratorSource = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmOrchestrator.ts'),
  'utf-8',
);

describe('SwarmChatroom entity teardown (#680)', () => {
  it('entity handles a "destroy" operation that calls destructOnExit', () => {
    expect(entitySource).toMatch(/case 'destroy'/);
    expect(entitySource).toMatch(/ctx\.df\.destructOnExit\(\)/);
  });

  it('orchestrator signals destroy in a finally block so every exit path cleans up', () => {
    expect(orchestratorSource).toMatch(/finally\s*\{[\s\S]*signalEntity\(chatroomEntityId,\s*'destroy'\)/);
  });

  it('orchestrator wraps body in try so finally runs on fatal + normal + thrown returns', () => {
    // After init signal, a try { must open the wrapped body
    expect(orchestratorSource).toMatch(/signalEntity\(chatroomEntityId,\s*'init'[\s\S]*?\n\s*try\s*\{/);
  });
});
