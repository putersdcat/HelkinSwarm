// Maintenance Sweep Timer — periodically checks and executes skill maintenance tasks.
// Scans all installed skill manifests for declared maintenanceTasks, checks schedules,
// and executes due tasks via appropriate handlers.
// Spec ref: skills-system-enhancement-2026-03-24v2.md §5
// Issue: #199, #272

import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import { getAllMaintenanceTasks } from '../capabilities/capabilityLoader.js';
import { trackEvent } from '../observability/telemetry.js';
import { getContainer } from '../memory/cosmosClient.js';

// ---------------------------------------------------------------------------
// Cosmos-backed last-run state (#272) — survives restarts and scale-out
// ---------------------------------------------------------------------------

const CONTAINER_NAME = 'maintenanceState';

interface MaintenanceRunDoc {
  id: string;        // domain:taskName
  domain: string;
  taskName: string;
  lastRunAt: string;  // ISO 8601
  lastResult: 'success' | 'failure' | 'no-handler';
  lastError?: string;
}

function taskKey(domain: string, taskName: string): string {
  return `${domain}:${taskName}`;
}

async function getLastRun(domain: string, taskName: string): Promise<MaintenanceRunDoc | null> {
  try {
    const container = getContainer(CONTAINER_NAME);
    const { resource } = await container.item(taskKey(domain, taskName), taskKey(domain, taskName)).read<MaintenanceRunDoc>();
    return resource ?? null;
  } catch (err) {
    const statusCode = (err as { code?: number })?.code;
    if (statusCode === 404) return null;
    throw err;
  }
}

async function saveLastRun(doc: MaintenanceRunDoc): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  await container.items.upsert(doc);
}

/**
 * Parse schedule and determine if the task is due based on last-run state.
 * Supports: "daily", "weekly", "every Xh", "every Xm", or cron-style interval.
 */
function isTaskDue(
  schedule: string | undefined,
  lastRunAt: string | null,
): boolean {
  if (!lastRunAt) return true; // Never run before

  const lastRunMs = new Date(lastRunAt).getTime();
  const elapsedMs = Date.now() - lastRunMs;

  if (!schedule) {
    // No schedule specified — default to 24h
    return elapsedMs >= 24 * 60 * 60 * 1000;
  }

  const lower = schedule.toLowerCase().trim();

  if (lower === 'daily') {
    return elapsedMs >= 24 * 60 * 60 * 1000;
  }
  if (lower === 'weekly') {
    return elapsedMs >= 7 * 24 * 60 * 60 * 1000;
  }

  // "every Xh" or "every Xm" pattern
  const everyMatch = /^every\s+(\d+)\s*(h|m)$/i.exec(lower);
  if (everyMatch) {
    const value = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2].toLowerCase();
    const intervalMs = unit === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
    return elapsedMs >= intervalMs;
  }

  // Default fallback: 24h
  return elapsedMs >= 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Timer trigger — runs every 6 hours
// ---------------------------------------------------------------------------

app.timer('maintenanceSweepTimer', {
  schedule: '0 0 */6 * * *', // Every 6 hours
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('[MaintenanceSweep] Starting skill maintenance sweep');

    const allTasks = getAllMaintenanceTasks();
    if (allTasks.length === 0) {
      context.log('[MaintenanceSweep] No maintenance tasks declared across skills');
      return;
    }

    let executed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const { domain, task } of allTasks) {
      // Only process scheduled tasks in the timer sweep
      // Event-driven tasks are triggered by their respective events
      if (task.type !== 'scheduled') {
        skipped++;
        continue;
      }

      // Check Cosmos-backed last-run state (#272)
      const lastRun = await getLastRun(domain, task.name);
      if (!isTaskDue(task.schedule, lastRun?.lastRunAt ?? null)) {
        skipped++;
        continue;
      }

      try {
        context.log(
          `[MaintenanceSweep] Executing: ${domain}/${task.name} — ${task.description}`,
        );

        const result = await executeMaintenanceTask(domain, task.name, context);

        // Persist run state to Cosmos (#272) — survives restarts and scale-out
        await saveLastRun({
          id: taskKey(domain, task.name),
          domain,
          taskName: task.name,
          lastRunAt: new Date().toISOString(),
          lastResult: result,
        });

        if (result === 'no-handler') {
          skipped++;
        } else {
          executed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${domain}/${task.name}: ${msg}`);
        context.error(
          `[MaintenanceSweep] Failed: ${domain}/${task.name} — ${msg}`,
        );

        // Persist failure state too
        try {
          await saveLastRun({
            id: taskKey(domain, task.name),
            domain,
            taskName: task.name,
            lastRunAt: new Date().toISOString(),
            lastResult: 'failure',
            lastError: msg,
          });
        } catch {
          // Best-effort — don't fail the sweep if state save fails
        }
      }
    }

    context.log(
      `[MaintenanceSweep] Complete: ${executed} executed, ${skipped} skipped, ${errors.length} errors`,
    );

    trackEvent({
      name: 'MaintenanceSweepCompleted',
      correlationId: `maintenance-sweep-${Date.now()}`,
      properties: {
        totalTasks: allTasks.length,
        executed,
        skipped,
        errorCount: errors.length,
      },
    });
  },
});

// ---------------------------------------------------------------------------
// Task execution — delegates to skill handler or built-in maintenance logic
// ---------------------------------------------------------------------------

async function executeMaintenanceTask(
  domain: string,
  taskName: string,
  context: InvocationContext,
): Promise<'success' | 'no-handler'> {
  // Convention: skill handlers can export maintenance_<task-name-kebab-to-snake>
  // e.g., verify-bing-api-key → maintenance_verify_bing_api_key
  const handlerName = `maintenance_${taskName.replace(/-/g, '_')}`;

  try {
    const distPath = `${process.cwd()}/dist/skills/${domain}/handlers.js`;
    const handlerModule = (await import(distPath)) as Record<string, unknown>;
    const handler = handlerModule[handlerName];

    if (typeof handler === 'function') {
      await (handler as () => Promise<void>)();
      return 'success';
    }
  } catch {
    // No handlers module or handler not found — fall through
  }

  // No handler found — typed outcome (#272)
  context.log(
    `[MaintenanceSweep] No handler "${handlerName}" in skills/${domain}/handlers — task logged only`,
  );
  return 'no-handler';
}
