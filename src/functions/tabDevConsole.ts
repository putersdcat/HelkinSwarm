// Tab Dev Console backend — deep inspection of orchestration, hooks, relay, and sessions.
// Owner-only endpoint for the Dev Console tab panel.
// Spec ref: docs/ADDENDA/ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md
// Issue: #86

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import { isOwnerUserId, getMaintenanceMode } from '../bot/maintenanceMode.js';
import { getEnvConfig } from '../config/envConfig.js';
import { listAllHooks } from '../orchestrator/hookCatalog.js';
import { getContainer } from '../memory/cosmosClient.js';
import { MemoryManager } from '../memory/memoryManager.js';
import { validateTabTokenFromRequest } from '../auth/tabTokenValidator.js';
import { getLlmHealthSnapshot } from '../llm/llmHealthTracker.js';
import { getCachedPersona, peekPersonaFromDisk } from '../orchestrator/buildPromptActivity.js';
import { getRecentPersonaEvents } from '../persona/personaEventStore.js';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function toIsoString(value: Date | string | undefined): string | null {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.toISOString();
}

// ---------------------------------------------------------------------------
// GET /api/tab/dev-console — aggregated deep inspection data
// ---------------------------------------------------------------------------
app.http('tab-dev-console', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/dev-console',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    let userId: string;
    try {
      userId = (await validateTabTokenFromRequest(req)).oid;
    } catch (err) {
      return {
        status: 401,
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: err instanceof Error ? err.message : 'Authentication required.' },
      };
    }

    if (!(await isOwnerUserId(userId))) {
      return { status: 403, headers: TAB_CORS_HEADERS, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const client = df.getClient(context);
    const env = getEnvConfig();

    // --- Sessions -----------------------------------------------------------
    const statuses = await client.getStatusAll();
    const activeSet = new Set<OrchestrationRuntimeStatus>([
      OrchestrationRuntimeStatus.Running,
      OrchestrationRuntimeStatus.Pending,
      OrchestrationRuntimeStatus.ContinuedAsNew,
    ]);
    const sessions = statuses.map((s) => ({
      instanceId: s.instanceId,
      name: s.name,
      runtimeStatus: s.runtimeStatus,
      createdAt: toIsoString(s.createdTime),
      lastUpdated: toIsoString(s.lastUpdatedTime),
      isRunning: s.runtimeStatus != null && activeSet.has(s.runtimeStatus),
    }));
    sessions.sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });

    // --- Hooks -------------------------------------------------------------
    let hooks: unknown[] = [];
    try {
      hooks = await listAllHooks(userId);
    } catch {
      context.warn('Failed to fetch hooks for dev console');
    }

    // --- Relay health (recent ide-messages count) --------------------------
    const relayStats = { total: 0, pending: 0 };
    try {
      const container = getContainer('ide-messages');
      const { resources } = await container.items
        .query({
          query: 'SELECT VALUE COUNT(1) FROM c WHERE c.createdAt > @since',
          parameters: [{ name: '@since', value: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
        })
        .fetchAll();
      relayStats.total = resources[0] ?? 0;

      const { resources: pendingRes } = await container.items
        .query({
          query: 'SELECT VALUE COUNT(1) FROM c WHERE c.deliveredAt = null AND c.createdAt > @since',
          parameters: [{ name: '@since', value: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
        })
        .fetchAll();
      relayStats.pending = pendingRes[0] ?? 0;
    } catch {
      context.warn('Failed to fetch relay stats for dev console');
    }

    // --- Maintenance -------------------------------------------------------
    const maintenance = await getMaintenanceMode();

    // --- Memory vaults (owner's skill memory catalog) ----------------------
    let memoryVaults: Array<{ skill: string; entries: number; lastUpdated: string }> = [];
    try {
      const mm = new MemoryManager(userId);
      const catalog = await mm.getSkillCatalog();
      memoryVaults = catalog.map((v) => ({
        skill: v.skillId,
        entries: v.entryCount,
        lastUpdated: v.lastUpdated,
      }));
    } catch {
      context.warn('Failed to fetch memory catalog for dev console');
    }

    // --- Persona status (#487 AC4) -----------------------------------------
    const personaFilePath = join(process.cwd(), 'src', 'persona', 'helkinPersona.md');
    const cachedPersona = getCachedPersona();
    let personaFileExists = false;
    let personaFileModified: string | null = null;
    try {
      const fileStat = await stat(personaFilePath);
      personaFileExists = true;
      personaFileModified = fileStat.mtime.toISOString();
    } catch {
      // file missing or unreadable
    }
    let diskPreview: string | null = null;
    try {
      const diskText = await peekPersonaFromDisk();
      diskPreview = diskText.substring(0, 200);
    } catch {
      // peek failed
    }
    const personaStatus = {
      cached: cachedPersona !== null,
      source: cachedPersona ? 'loaded' : 'not-loaded',
      preview: cachedPersona?.substring(0, 200) ?? null,
      diskPreview,
      fileExists: personaFileExists,
      fileLastModified: personaFileModified,
    };

    // --- Persona version history + eval scores (#487 AC#4) -----------------
    let personaHistory: unknown[] = [];
    try {
      personaHistory = await getRecentPersonaEvents(userId, 20);
    } catch {
      context.warn('Failed to fetch persona history for dev console');
    }

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: {
        sessions: {
          list: sessions.slice(0, 30),
          active: sessions.filter((s) => s.isRunning).length,
          total: sessions.length,
        },
        hooks: {
          list: hooks,
          active: (hooks as Array<{ status: string }>).filter((h) => h.status === 'active').length,
          total: hooks.length,
        },
        relay: relayStats,
        memory: {
          vaults: memoryVaults,
          totalVaults: memoryVaults.length,
          totalEntries: memoryVaults.reduce((sum, v) => sum + v.entries, 0),
        },
        maintenance,
        persona: personaStatus,
        personaHistory,
        llmHealth: getLlmHealthSnapshot(),
        safetyMode: env.safetyMode,
        euResidencyMode: env.euResidencyMode,
        timestamp: new Date().toISOString(),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/tab/sessions/:instanceId/terminate — kill a running session
// ---------------------------------------------------------------------------
app.http('tab-session-terminate', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/sessions/{instanceId}/terminate',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    let userId: string;
    try {
      userId = (await validateTabTokenFromRequest(req)).oid;
    } catch (err) {
      return {
        status: 401,
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: err instanceof Error ? err.message : 'Authentication required.' },
      };
    }

    if (!(await isOwnerUserId(userId))) {
      return { status: 403, headers: TAB_CORS_HEADERS, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const instanceId = req.params.instanceId;
    if (!instanceId) {
      return { status: 400, headers: TAB_CORS_HEADERS, jsonBody: { error: 'instanceId required.' } };
    }

    const client = df.getClient(context);
    try {
      await client.terminate(instanceId, 'Terminated via Dev Console');
      return {
        status: 200,
        headers: TAB_CORS_HEADERS,
        jsonBody: { terminated: true, instanceId },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 500,
        headers: TAB_CORS_HEADERS,
        jsonBody: { terminated: false, error: msg },
      };
    }
  },
});

// ---------------------------------------------------------------------------
// GET /api/tab/traces?corr=<correlationTag> — search relay messages by tag
// ---------------------------------------------------------------------------
app.http('tab-traces', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/traces',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    let userId: string;
    try {
      userId = (await validateTabTokenFromRequest(req)).oid;
    } catch (err) {
      return {
        status: 401,
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: err instanceof Error ? err.message : 'Authentication required.' },
      };
    }

    if (!(await isOwnerUserId(userId))) {
      return { status: 403, headers: TAB_CORS_HEADERS, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const corr = req.query.get('corr');

    try {
      const { getMessagesByCorrelation } = await import('../devloop/relayStore.js');
      const { listRecentTraces, loadTraceTreeWithFallback } = await import('../observability/sessionTracer.js');

      // If no corr param, return recent traces list with optional time range (#269)
      if (!corr || corr.length < 3) {
        const since = req.query.get('since') ?? undefined;
        const until = req.query.get('until') ?? undefined;
        const limitParam = req.query.get('limit');
        const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 30, 100) : 30;

        const recent = listRecentTraces({ limit, sinceIso: since, untilIso: until });
        return {
          status: 200,
          headers: TAB_CORS_HEADERS,
          jsonBody: { recent },
        };
      }

      const messages = await getMessagesByCorrelation(corr);
      const { traceTree } = await loadTraceTreeWithFallback(corr);

      return {
        status: 200,
        headers: TAB_CORS_HEADERS,
        jsonBody: { correlationTag: corr, messages, count: messages.length, traceTree: traceTree ?? null },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 500,
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: msg },
      };
    }
  },
});
