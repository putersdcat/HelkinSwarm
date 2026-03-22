// Bridge module — re-exports tentative action mutations for use in the bot layer.
// Avoids direct bot → orchestrator imports which can cause circular deps.
// Issue #74

export {
  approveTentativeAction,
  denyTentativeAction,
} from '../orchestrator/tentativeActions.js';
