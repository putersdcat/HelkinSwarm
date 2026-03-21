// Azure Functions v4 entry point — register all function triggers.
// Each function self-registers via app.http() / app.timer() in its own file.
// This barrel file simply ensures they are imported at startup.

// *** Must be first import — initialises Azure Monitor / App Insights SDK ***
import { useAzureMonitor } from '@azure/monitor-opentelemetry';
useAzureMonitor();

import './health.js';
import './messages.js';
import './emergencyStop.js';

// Orchestrator + activity registrations (Phase 2)
import '../orchestrator/overseer.js';
import '../orchestrator/sessionOrchestrator.js';
import '../orchestrator/buildPromptActivity.js';
import '../orchestrator/llmActivity.js';
import '../orchestrator/llmFollowUpActivity.js';
import '../orchestrator/sendReplyActivity.js';
import '../orchestrator/summarizeActivity.js';
import '../orchestrator/durableHookActivity.js';

// Phase 3 activities — tool dispatch, safety pipeline, executor, sub-agents
import '../orchestrator/toolDispatchActivity.js';
import '../orchestrator/subAgentActivity.js';
import '../orchestrator/executorActivity.js';
import '../orchestrator/verificationPipelineActivity.js';
import '../orchestrator/sendConfirmationCardActivity.js';
import '../orchestrator/saveStateActivity.js';
import '../orchestrator/loadStateActivity.js';
import '../orchestrator/storeMemoryActivity.js';

// Capability loader — scan skills/ directory and register tool handlers
import { loadCapabilities } from '../capabilities/capabilityLoader.js';

loadCapabilities().then((result) => {
  console.log(
    `[CapabilityLoader] Loaded ${result.skillsLoaded} skills, ${result.toolsRegistered} tools` +
      (result.errors.length > 0
        ? `, ${result.errors.length} errors: ${result.errors.map((e) => e.path).join(', ')}`
        : ''),
  );

  // Hot-reload capabilities every 5 minutes (#79)
  setInterval(() => {
    loadCapabilities().catch((err: unknown) => {
      console.warn('[CapabilityLoader] Periodic reload failed:', err);
    });
  }, 5 * 60 * 1000);
}).catch((err: unknown) => {
  console.error('[CapabilityLoader] Failed to load capabilities:', err);
});

// ---------------------------------------------------------------------------
// Startup: clear maintenance mode from any previous graceful shutdown (#136)
// The shutdown handler sets maintenance=true in Cosmos; we must clear it
// when the new container starts to resume normal operation.
// ---------------------------------------------------------------------------
import { setMaintenanceMode } from '../bot/maintenanceMode.js';
import { sendStartupNotice, sendShutdownNotice } from '../bot/lifecycleNotices.js';

setMaintenanceMode({
  enabled: false,
  updatedBy: 'system-startup',
  reason: 'Container started — clearing shutdown maintenance flag',
}).catch((err: unknown) => {
  console.error('[startup] Failed to clear maintenance mode:', err);
});

// Send startup lifecycle notice to owner (#142)
setTimeout(() => {
  sendStartupNotice().catch((err: unknown) => {
    console.warn('[startup] Failed to send startup notice:', err);
  });
}, 5_000);

// ---------------------------------------------------------------------------
// Graceful shutdown handler (#136)
// On SIGTERM/SIGINT: enable maintenance mode so new messages get a polite
// "deploying" response, then allow a grace period for in-flight work.
// ---------------------------------------------------------------------------

const SHUTDOWN_GRACE_MS = 10_000;

function handleShutdown(signal: string): void {
  console.log(`[shutdown] Received ${signal} — entering maintenance mode, grace=${SHUTDOWN_GRACE_MS}ms`);

  // Send shutdown lifecycle notice to owner (#142)
  sendShutdownNotice().catch((err: unknown) => {
    console.warn('[shutdown] Failed to send shutdown notice:', err);
  });

  setMaintenanceMode({
    enabled: true,
    updatedBy: 'system-shutdown',
    reason: `Graceful shutdown on ${signal}`,
  }).catch((err: unknown) => {
    console.error('[shutdown] Failed to set maintenance mode:', err);
  });

  // Give in-flight orchestrations time to complete, then exit
  setTimeout(() => {
    console.log('[shutdown] Grace period elapsed — exiting');
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
