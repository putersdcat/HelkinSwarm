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
}).catch((err: unknown) => {
  console.error('[CapabilityLoader] Failed to load capabilities:', err);
});
