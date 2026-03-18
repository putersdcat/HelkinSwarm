// Azure Functions v4 entry point — register all function triggers.
// Each function self-registers via app.http() / app.timer() in its own file.
// This barrel file simply ensures they are imported at startup.

import './health.js';
