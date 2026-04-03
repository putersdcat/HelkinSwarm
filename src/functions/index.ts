// Azure Functions v4 entry point — register all function triggers.
// Each function self-registers via app.http() / app.timer() in its own file.
// This barrel file simply ensures they are imported at startup.

// *** Must be first import — initialises Azure Monitor / App Insights SDK ***
import { useAzureMonitor } from '@azure/monitor-opentelemetry';
const dirtyDevMode = process.env['DIRTY_DEV_MODE']?.toLowerCase() === 'true';
const appInsightsConnectionString = process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];

if (!dirtyDevMode && appInsightsConnectionString) {
  useAzureMonitor();
} else {
  console.warn('[observability] Azure Monitor exporter disabled for this runtime instance');
}

import './health.js';
import './messages.js';
import './emergencyStop.js';
import './hookReceiver.js';
import './devLoopRelay.js';
import './graphNotificationHandler.js';
import './subscriptionRenewalTimer.js';
import './maintenanceSweepTimer.js';
import './staleSessionCleanupTimer.js';
import './staleAckRecoveryTimer.js';
import './pendingIntentReplayTimer.js';
import './selfAwakenTimer.js';
import './tabGetStarted.js';
import './tabDashboard.js';
import './tabCosts.js';
import './tabSessions.js';
import './tabDevConsole.js';
import './tabSkills.js';
import './tabBootstrapObo.js';

// Orchestrator + activity registrations (Phase 2)
import '../orchestrator/overseer.js';
import '../orchestrator/sessionOrchestrator.js';
import '../orchestrator/buildPromptActivity.js';
import '../orchestrator/llmActivity.js';
import '../orchestrator/llmFollowUpActivity.js';
import '../orchestrator/sendReplyActivity.js';
import '../orchestrator/spinnerHeartbeatActivity.js';
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
import '../orchestrator/hookResolutionActivity.js';
import '../orchestrator/startupRecoveryActivity.js';
import '../orchestrator/terminateOrchestrationActivity.js';
import '../orchestrator/planActivity.js';
import '../orchestrator/chronoBackplane.js';
import '../orchestrator/limbicIngressActivity.js';
import '../orchestrator/mindSessionGuard.js';
import '../orchestrator/steeringInjectionActivity.js';
import '../orchestrator/skillForgePrototypeActivity.js';

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
// Startup: clear maintenance mode (#145)
// On startup, clear any stale maintenance flag in Cosmos (e.g. from a manual
// /emergency-stop). The in-memory _startupClearPending flag in maintenanceMode.ts
// prevents blocking messages while this async operation runs.
// ---------------------------------------------------------------------------
import { setMaintenanceMode, getMaintenanceModeFromCosmos, markStartupClearComplete } from '../bot/maintenanceMode.js';
import { sendStartupNotice, sendShutdownNotice } from '../bot/lifecycleNotices.js';
import { runStartupRecovery } from '../bot/startupRecovery.js';

async function clearMaintenanceWithRetry(attempts = 3, delayMs = 2000): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      // Read the actual Cosmos doc (bypasses in-memory override) to check
      // whether an active emergency-stop is in place.
      const current = await getMaintenanceModeFromCosmos();
      if (current.enabled && current.source === 'emergency-stop') {
        // A deliberate e-stop survives deploys — do NOT clear it.
        // Flip the in-memory flag so getMaintenanceMode() starts reading
        // from Cosmos (which correctly says enabled=true).
        markStartupClearComplete();
        console.warn(
          '[startup] Active emergency stop found — NOT clearing. Use /emergency-resume to restore service.',
        );
        return;
      }

      await setMaintenanceMode({
        enabled: false,
        updatedBy: 'system-startup',
        source: 'system',
        reason: 'Container started — clearing shutdown maintenance flag',
      });
      console.log('[startup] Maintenance mode cleared in Cosmos');
      return;
    } catch (err: unknown) {
      console.warn(`[startup] Maintenance clear attempt ${i + 1}/${attempts} failed:`, err);
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  console.error('[startup] All maintenance clear attempts failed — Cosmos may still show enabled=true');
}

clearMaintenanceWithRetry().catch(() => {
  // Already logged inside the function
});

// Send startup lifecycle notice to owner (#142, #149)
// Delay must exceed SHUTDOWN_GRACE_MS so the startup notice arrives AFTER the
// old container's shutdown notice during rolling updates.
setTimeout(() => {
  sendStartupNotice().catch((err: unknown) => {
    console.warn('[startup] Failed to send startup notice:', err);
  });
}, 20_000);

// Startup recovery: clean up dangling acks + replay pending intents (#191, #116)
// Delayed 25s to run after startup notice and after adapter/Cosmos are ready.
setTimeout(() => {
  runStartupRecovery().catch((err: unknown) => {
    console.warn('[startup] Startup recovery failed:', err);
  });
}, 25_000);

// ---------------------------------------------------------------------------
// Graceful shutdown handler (#136, #145)
// On SIGTERM/SIGINT: log and allow grace period for in-flight work.
//
// IMPORTANT: We do NOT set maintenance mode on shutdown anymore.
// Container Apps uses rolling updates — the old container keeps serving
// traffic until the new container passes health checks. Setting maintenance
// mode on SIGTERM blocks messages on the only container serving traffic,
// causing the "offline for maintenance" bug after every deploy (#145).
//
// In-flight orchestrations complete naturally during the grace period.
// The new container starts fresh with _startupClearPending=true.
// ---------------------------------------------------------------------------

const SHUTDOWN_GRACE_MS = 10_000;

function handleShutdown(signal: string): void {
  console.log(`[shutdown] Received ${signal} — grace=${SHUTDOWN_GRACE_MS}ms for in-flight work`);

  // Send shutdown lifecycle notice to owner (#142)
  sendShutdownNotice().catch((err: unknown) => {
    console.warn('[shutdown] Failed to send shutdown notice:', err);
  });

  // Give in-flight orchestrations time to complete, then exit
  setTimeout(() => {
    console.log('[shutdown] Grace period elapsed — exiting');
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
