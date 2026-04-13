// Persona event store — records reload events and evaluation scores in Cosmos.
// Uses the 'sessions' container (72h TTL, /userId partition) for ephemeral persona history.
// Issue: #487 AC#4

import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';

const CONTAINER_NAME = 'sessions';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const PersonaReloadEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.literal('persona-reload'),
  action: z.enum(['approved', 'denied']),
  timestamp: z.string(),
});

const PersonaEvalEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.literal('persona-eval'),
  turnsEvaluated: z.number(),
  directivesExtracted: z.number(),
  overallHealth: z.string(),
  alignedSignals: z.number(),
  driftSignals: z.number(),
  driftDirectives: z.array(z.string()),
  timestamp: z.string(),
});

export type PersonaReloadEvent = z.infer<typeof PersonaReloadEventSchema>;
export type PersonaEvalEvent = z.infer<typeof PersonaEvalEventSchema>;
export type PersonaEvent = PersonaReloadEvent | PersonaEvalEvent;

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------
export async function recordPersonaReload(
  userId: string,
  action: 'approved' | 'denied',
): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  const doc: PersonaReloadEvent = {
    id: `persona-reload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    type: 'persona-reload',
    action,
    timestamp: new Date().toISOString(),
  };
  await container.items.create(doc);
}

export async function recordPersonaEval(
  userId: string,
  evalResult: {
    turnsEvaluated: number;
    directivesExtracted: number;
    overallHealth: string;
    alignedSignals: number;
    driftSignals: number;
    driftDirectives: string[];
  },
): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  const doc: PersonaEvalEvent = {
    id: `persona-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    type: 'persona-eval',
    turnsEvaluated: evalResult.turnsEvaluated,
    directivesExtracted: evalResult.directivesExtracted,
    overallHealth: evalResult.overallHealth,
    alignedSignals: evalResult.alignedSignals,
    driftSignals: evalResult.driftSignals,
    driftDirectives: evalResult.driftDirectives,
    timestamp: new Date().toISOString(),
  };
  await container.items.create(doc);
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------
export async function getRecentPersonaEvents(
  userId: string,
  limit = 20,
): Promise<PersonaEvent[]> {
  const container = getContainer(CONTAINER_NAME);
  const { resources } = await container.items
    .query<PersonaEvent>({
      query:
        'SELECT TOP @limit * FROM c WHERE c.userId = @userId AND (c.type = "persona-reload" OR c.type = "persona-eval") ORDER BY c.timestamp DESC',
      parameters: [
        { name: '@userId', value: userId },
        { name: '@limit', value: limit },
      ],
    })
    .fetchAll();
  return resources;
}
