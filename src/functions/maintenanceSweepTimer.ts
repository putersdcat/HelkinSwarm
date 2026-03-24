// Maintenance Sweep Timer — periodically checks and executes skill maintenance tasks.
// Scans all installed skill manifests for declared maintenanceTasks, checks schedules,
// and executes due tasks via appropriate handlers.
// Spec ref: skills-system-enhancement-2026-03-24v2.md §5
// Issue: #199

import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import { getAllMaintenanceTasks } from '../capabilities/capabilityLoader.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Last-run tracking — in-memory for now, Cosmos-backed when multi-instance
// ---------------------------------------------------------------------------

const lastRunMap = new Map<string, number>();

function taskKey(domain: string, taskName: string): string {
  return `${domain}:${taskName}`;
}

/**
 * Parse a cron-like schedule string and determine if the task is due.
 * Compares against last run time — if more than one interval has passed, it's due.
 * For weekly schedules (day-of-week based), checks once per week.
 * For now, treats any scheduled task as due if >24h since last run.
 */
function isTaskDue(
  domain: string,
  taskName: string,
  _schedule: string | undefined,
): boolean {
  const key = taskKey(domain, taskName);
  const lastRun = lastRunMap.get(key);
  if (!lastRun) return true; // Never run before

  // Default: run once per 24 hours for scheduled tasks
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return Date.now() - lastRun >= ONE_DAY_MS;
}

function markRun(domain: string, taskName: string): void {
  lastRunMap.set(taskKey(domain, taskName), Date.now());
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

      if (!isTaskDue(domain, task.name, task.schedule)) {
        skipped++;
        continue;
      }

      try {
        context.log(
          `[MaintenanceSweep] Executing: ${domain}/${task.name} — ${task.description}`,
        );

        // Execute the maintenance task via skill handler convention:
        // The skill's handlers.js should export a function named `maintenance_<taskName>`
        // For now, log execution — real dispatch requires handler wiring per skill
        await executeMaintenanceTask(domain, task.name, context);

        markRun(domain, task.name);
        executed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${domain}/${task.name}: ${msg}`);
        context.error(
          `[MaintenanceSweep] Failed: ${domain}/${task.name} — ${msg}`,
        );
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
): Promise<void> {
  // Convention: skill handlers can export maintenance_<task-name-kebab-to-snake>
  // e.g., verify-bing-api-key → maintenance_verify_bing_api_key
  const handlerName = `maintenance_${taskName.replace(/-/g, '_')}`;

  try {
    const distPath = `${process.cwd()}/dist/skills/${domain}/handlers.js`;
    const handlerModule = (await import(distPath)) as Record<string, unknown>;
    const handler = handlerModule[handlerName];

    if (typeof handler === 'function') {
      await (handler as () => Promise<void>)();
      return;
    }
  } catch {
    // No handlers module or handler not found — fall through to log
  }

  // No handler found — log the intent for future implementation
  context.log(
    `[MaintenanceSweep] No handler "${handlerName}" in skills/${domain}/handlers — task logged only`,
  );
}
