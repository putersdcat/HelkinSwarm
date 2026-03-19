// Router entry point — separate from stamp's index.ts.
// This is used when building the router Azure Function App (Dockerfile.router).
// Only loads the routing function and health check — NO stamp/orchestrator code.
// Spec ref: 0q-Multi-Instance-Architecture.md

import './routerFunction.js';
import '../functions/health.js';

import './routerFunction.js';
