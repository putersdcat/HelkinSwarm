// Azure Functions v4 entry point — register all function triggers.
// Each function self-registers via app.http() / app.timer() in its own file.
// This barrel file simply ensures they are imported at startup.

import './health.js';
import './messages.js';

// Orchestrator + activity registrations
import '../orchestrator/overseer.js';
import '../orchestrator/sessionOrchestrator.js';
import '../orchestrator/buildPromptActivity.js';
import '../orchestrator/llmActivity.js';
import '../orchestrator/sendReplyActivity.js';
import '../orchestrator/summarizeActivity.js';
import '../orchestrator/durableHookActivity.js';
