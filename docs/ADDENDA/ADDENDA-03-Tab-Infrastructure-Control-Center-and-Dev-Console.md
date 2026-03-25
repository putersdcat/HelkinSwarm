# HelkinSwarm Project Specification — Addendum Series

## ADDENDA-03. Tab Infrastructure — Control Center, Dev Console & Session Tracer

**Version:** 1.0  
**Date:** March 2026  
**Status:** Implementation spec  
**References:** Doc `10` (Teams Interface), doc `0g` (DevLoop), doc `0n` (Turn Telemetry), issue #107

---

## 1. Purpose

Doc `10` describes the tab user experience at a high level: "Get Started", "Control Center", and "Dev Console". Doc `0g` describes the DevLoop relay and mentions the Dev Console tab for deep inspection. This addendum specifies the exact implementation of all three tab experiences — the HTTP API backends on each stamp, the HTML/JS frontends, and the session tracer feature.

The architecture uses a **global SPA + per-stamp backends** pattern:
- Frontend: a single global SPA deployed to Azure Storage Static Websites
- Backends: Azure Functions on each stamp serving tab data via `/api/tab/*` endpoints
- The `{{TAB_HOST_URL}}` placeholder in the manifest is substituted at build time with the global SPA URL

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Global SPA (Azure Storage Static Website)                   │
│  tabs.microsoft.com/helkinswarm                            │
│                                                              │
│  / → index.html (tab shell with JS router)                   │
│  /control-center → Control Center panel                      │
│  /dev-console → Dev Console panel                           │
│  /get-started → Get Started panel                            │
└────────────────┬────────────────────────────────────────────┘
                 │ fetch('/api/tab/*')
                 │ (per-stamp API call)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Azure Functions on each stamp (src/functions/tab*.ts)       │
│                                                              │
│  GET /api/tab/dashboard → TabDashboard                      │
│  GET /api/tab/dev-console → TabDevConsole                    │
│  GET /api/tab/sessions → Running sessions list               │
│  GET /api/tab/traces?corr={id} → Trace tree + relay msgs    │
│  GET /api/tab/traces?limit=N&since=ISO&until=ISO → Recent   │
│  POST /api/tab/sessions/{id}/terminate → Kill session        │
│  GET /api/tab/health → Health status for this stamp         │
└─────────────────────────────────────────────────────────────┘
```

---

## 2a. Trace Endpoint API Contract (issue #269)

The `/api/tab/traces` endpoint serves two modes:

### Mode A: Recent traces list (no `corr` param or `corr` < 3 chars)

```
GET /api/tab/traces?limit=20&since=2026-03-01T00:00:00Z&until=2026-03-31T23:59:59Z
Authorization: Bearer <AAD token>  (owner-only)
```

**Response:**
```json
{
  "recent": [
    {
      "correlationId": "DL-20260325220200-A1B2",
      "turnStartedAt": "2026-03-25T22:02:00.000Z",
      "totalMs": 3421,
      "phaseCount": 12
    }
  ]
}
```

Query params: `limit` (default 30, max 100), `since` (ISO timestamp), `until` (ISO timestamp).

### Mode B: Trace tree for a specific correlation ID

```
GET /api/tab/traces?corr=DL-20260325220200-A1B2
```

**Response:**
```json
{
  "correlationTag": "DL-20260325220200-A1B2",
  "messages": [...],
  "count": 4,
  "traceTree": {
    "correlationId": "DL-20260325220200-A1B2",
    "userId": "aad-oid-of-user",
    "turnStartedAt": "2026-03-25T22:02:00.000Z",
    "totalMs": 3421,
    "phases": [
      {
        "id": "BotMessageReceived-1711400520000",
        "name": "BotMessageReceived",
        "type": "bot-receive",
        "startedAt": 0,
        "durationMs": 12,
        "status": "completed",
        "children": [],
        "detail": "BotMessageReceived",
        "error": null
      }
    ]
  }
}
```

### TracePhase type values (`TracePhaseType` enum)

| Type | Icon | Description |
|------|------|-------------|
| `bot-receive` | 📨 | Incoming message received by bot handler |
| `prompt-build` | 📝 | Prompt assembly (context, persona, tools) |
| `llm-call` | 🤖 | LLM API request/response |
| `tool-dispatch` | 🔧 | Tool call dispatched to skill |
| `subagent` | 🤖 | SubAgent tool execution |
| `executor` | ⚙️ | Executor binding verified / scoped token |
| `confirmation` | 🔒 | Human confirmation requested/received |
| `reply-send` | 💬 | Final reply delivered to Teams |
| `verification` | 🛡️ | Verification pipeline result |
| `memory` | 🧠 | Memory read/write (Cosmos, skill vault) |
| `orchestrator` | ⚙️ | Durable orchestrator lifecycle event |
| `llm` | 🤖 | _(legacy alias for `llm-call`)_ |
| `tool` | 🔧 | _(legacy alias for `tool-dispatch`)_ |
| `reply` | 💬 | _(legacy alias for `reply-send`)_ |

### TracePhase object shape

```typescript
interface TracePhase {
  id: string;              // "${EventName}-${Date.now()}"
  name: string;            // Telemetry event name, e.g. "LlmCallCompleted"
  type: TracePhaseType;    // See table above
  startedAt: number;       // Milliseconds offset from turnStartedAt
  durationMs: number;      // Phase duration
  status: 'running' | 'completed' | 'error' | 'skipped';
  children: TracePhase[];  // Child phases (recursive)
  detail?: string;         // Human-readable detail (model name, tool name, etc.)
  error?: string;          // Error message if status === 'error'
}
```

---

## 3. Tab API Backends

### 3.1 Dashboard Endpoint

```typescript
// filepath: src/functions/tabDashboard.ts

export async function tabDashboard(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponse> {
  // Returns: service state, session count, model health, cost snapshot
  const health = await getStampHealth();
  const sessions = await df.client.listInstances({ hours: 1, showHistory: false }));
  const cost = await getCostSnapshot();

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      status: health.status,
      uptime: process.uptime(),
      version: process.env.HELKINSWARM_VERSION ?? "unknown",
      activeSessions: sessions.filter(s => s.runtimeStatus === "Running").length,
      totalSessions: sessions.length,
      models: health.models,
      cost: cost.thirtyDayTotalEur,
      lastActivity: health.lastActivityAt,
      maintenanceMode: await getMaintenanceMode(),
      safetyMode: process.env.SAFETY_MODE ?? "confirmation-gated",
    },
  };
}
```

### 3.2 Dev Console Endpoint

```typescript
// filepath: src/functions/tabDevConsole.ts

export async function tabDevConsole(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponse> {
  // Returns: sessions, traces, model metrics, durable hooks summary
  const sessions = await getRunningSessions();
  const traces = await getRecentTraces(req.query["limit"] ?? "50");
  const durableHooks = await getActiveDurableHooks();
  const modelMetrics = await getModelMetrics();

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      sessions,
      traces,
      durableHooks,
      modelMetrics,
      devTelemetryEnabled: process.env.DEV_TELEMETRY_MODE !== "off",
    },
  };
}
```

### 3.3 Session Tracer Endpoint

The session tracer (`#209` in v0) provides an introspective trace tree for a given correlation ID:

```typescript
// filepath: src/functions/tabDevConsole.ts

export async function getSessionTrace(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponse> {
  const correlationId = req.query["corr"];
  if (!correlationId) {
    return { status: 400, body: "Missing corr query parameter" };
  }

  // Query App Insights for all events with this correlation ID
  const trace = await queryAppInsights(correlationId);

  if (!trace) {
    return { status: 404, body: "Trace not found" };
  }

  // Build tree structure
  const tree = buildTraceTree(trace.events);

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { correlationId, tree, totalEvents: trace.events.length },
  };
}

interface TraceNode {
  id: string;
  name: string;           // "LLMCall", "ToolExecuted", etc.
  durationMs?: number;
  startedAt: string;
  children: TraceNode[];
  metadata?: Record<string, unknown>;
}

function buildTraceTree(events: AppInsightsEvent[]): TraceNode {
  // Build hierarchical tree from flat event list
  // Parent-child inferred from timestamp ordering + phase nesting
  // ...
}
```

### 3.4 Get Started Endpoint

```typescript
// filepath: src/functions/tabGetStarted.ts

export async function tabGetStarted(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponse> {
  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      ownerName: await getOwnerName(),
      quickCommands: [
        { cmd: "/emergency-stop", label: "Emergency Stop", danger: true },
        { cmd: "/reload", label: "Reload Capabilities", danger: false },
        { cmd: "/status", label: "System Status", danger: false },
      ],
      capabilitiesCount: await getLoadedCapabilitiesCount(),
      activeSkills: await getActiveSkills(),
    },
  };
}
```

---

## 4. Global SPA Frontend

### 4.1 Shell & Router

The global SPA is a minimal single-page app with hash-based routing:

```html
<!-- filepath: tabs/index.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>HelkinSwarm</title>
  <script src="https://teamsjscdn.azureedge.net/packages/teams-js/2.24.0/MicrosoftTeams.min.js"></script>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 0; background: #f3f2f1; }
    .panel { display: none; padding: 20px; max-width: 800px; margin: 0 auto; }
    .panel.active { display: block; }
    .card { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { color: #323130; font-size: 20px; }
    h2 { color: #605e5c; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
    .badge-ok { background: #dff6dd; color: #0b6a0b; }
    .badge-warn { background: #fff4ce; color: #8a6914; }
    .badge-error { background: #fde7e9; color: #a80000; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #edebe9; }
    th { color: #605e5c; font-size: 12px; text-transform: uppercase; }
    pre { background: #f3f2f1; padding: 12px; border-radius: 4px; overflow-x: auto;
          font-size: 12px; font-family: Consolas, monospace; }
  </style>
</head>
<body>
  <div id="nav" style="background:#6264a7;padding:12px 20px;">
    <span style="color:white;font-size:16px;font-weight:600;">HelkinSwarm</span>
    <span style="float:right;">
      <button onclick="router.navigate('control-center')" style="background:transparent;border:1px solid rgba(255,255,255,0.5);color:white;padding:4px 12px;border-radius:4px;cursor:pointer;">Control Center</button>
      <button onclick="router.navigate('dev-console')" style="background:transparent;border:1px solid rgba(255,255,255,0.5);color:white;padding:4px 12px;border-radius:4px;cursor:pointer;">Dev Console</button>
    </span>
  </div>

  <div id="panel-get-started" class="panel"></div>
  <div id="panel-control-center" class="panel"></div>
  <div id="panel-dev-console" class="panel"></div>

  <script src="app.js"></script>
</body>
</html>
```

### 4.2 JavaScript Router

```typescript
// filepath: tabs/app.ts

const TAB_API_BASE = "{{TAB_HOST_URL}}/api/tab";  // Set at build time

const router = {
  routes: {} as Record<string, string>,

  init() {
    window.addEventListener("hashchange", () => this.render());
    const hash = window.location.hash.replace("#", "") || "get-started";
    window.location.hash = hash;
  },

  navigate(panel: string) {
    window.location.hash = panel;
  },

  render() {
    const panel = (window.location.hash.replace("#", "") || "get-started") as string;
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.getElementById(`panel-${panel}`)?.classList.add("active");
    if (panel === "get-started") this.renderGetStarted();
    if (panel === "control-center") this.renderControlCenter();
    if (panel === "dev-console") this.renderDevConsole();
  },

  async api(endpoint: string) {
    const resp = await fetch(`${TAB_API_BASE}/${endpoint}`, {
      headers: { "x-ms-token-aad-id-token": await getAadToken() },
    });
    if (!resp.ok) throw new Error(`Tab API error: ${resp.status}`);
    return resp.json();
  },

  async renderGetStarted() {
    const data = await this.api("get-started");
    const el = document.getElementById("panel-get-started")!;
    el.innerHTML = `<h1>Get Started</h1>
      <div class="card"><h2>Owner</h2><p>${data.ownerName}</p></div>
      <div class="card"><h2>Quick Commands</h2>
        ${data.quickCommands.map((c: any) =>
          `<button onclick="sendCommand('${c.cmd}')" ${c.danger ? 'style="border-color:#a80000;color:#a80000"' : ''}>${c.label}</button>`
        ).join(" ")}
      </div>
      <div class="card"><h2>Active Skills: ${data.activeSkills}</h2></div>`;
  },

  async renderControlCenter() {
    const data = await this.api("dashboard");
    const el = document.getElementById("panel-control-center")!;
    el.innerHTML = `<h1>Control Center</h1>
      <div class="card"><h2>Service Status</h2>
        <span class="badge badge-${data.status === 'healthy' ? 'ok' : 'warn'}">${data.status}</span>
        <p>Uptime: ${fmtDuration(data.uptime)} | Version: ${data.version}</p>
        <p>Sessions: ${data.activeSessions} active / ${data.totalSessions} total</p>
      </div>
      <div class="card"><h2>Safety</h2>
        <p>Mode: <strong>${data.safetyMode}</strong></p>
        <p>Maintenance: <strong>${data.maintenanceMode ? 'ON' : 'OFF'}</strong></p>
      </div>
      <div class="card"><h2>30-Day Cost</h2>
        <p>€${data.cost.toFixed(2)}</p>
      </div>
      <div class="card"><h2>Model Health</h2>
        <table><tr><th>Model</th><th>Status</th><th>Latency</th></tr>
        ${data.models.map((m: any) => `<tr><td>${m.name}</td><td><span class="badge badge-${m.status}">${m.status}</span></td><td>${m.latencyMs}ms</td></tr>`).join("")}
        </table>
      </div>`;
  },

  async renderDevConsole() {
    const data = await this.api("dev-console");
    const el = document.getElementById("panel-dev-console")!;
    el.innerHTML = `<h1>Dev Console</h1>
      <div class="card">
        <h2>Dev Telemetry: ${data.devTelemetryEnabled ? 'ON' : 'OFF'}</h2>
        <p>Enable via DEV_TELEMETRY_MODE environment variable</p>
      </div>
      <div class="card"><h2>Running Sessions (${data.sessions.length})</h2>
        <table><tr><th>Instance ID</th><th>Started</th><th>Status</th></tr>
        ${data.sessions.map((s: any) => `<tr><td>${s.instanceId}</td><td>${new Date(s.createdAt).toLocaleString()}</td><td>${s.runtimeStatus}</td></tr>`).join("")}
        </table>
      </div>
      <div class="card"><h2>Active Durable Hooks: ${data.durableHooks.length}</h2></div>`;
  },
};

function fmtDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function sendCommand(cmd: string) {
  // Send command via Teams chat input
  microsoftTeams.chat.submitMessage(cmd);
}

window.addEventListener("DOMContentLoaded", () => {
  microsoftTeams.app.initialize().then(() => router.init());
});
```

---

## 5. Session Tracer — Deep Inspection

### 5.1 Purpose

The session tracer displays the complete causal chain of a single turn: all LLM calls, tool dispatches, verification steps, memory operations, and their timings — visualized as a collapsible tree.

This is the feature described as #209 in v0 ("Session Tracer in Dev Console").

### 5.2 Trace Tree Data Structure

```typescript
interface TraceTree {
  correlationId: string;
  totalMs: number;
  startedAt: string;
  completedAt: string;
  phases: TracePhase[];
}

interface TracePhase {
  id: string;
  name: string;
  type: "llm" | "tool" | "verification" | "memory" | "reply" | "orchestrator";
  startedAt: number;    // ms offset from turn start
  durationMs: number;
  status: "running" | "completed" | "error";
  children: TracePhase[];
  detail?: string;      // e.g., tool name, model used, verification step name
  error?: string;
}
```

### 5.3 Tracer UI Extension

```typescript
// In tabDevConsole.ts renderDevConsole(), add tracer panel:

async renderTracer() {
  const corrId = prompt("Enter Correlation ID (cc-xxxxxxxx):");
  if (!corrId) return;

  const trace = await this.api(`dev-console/traces?corr=${corrId}`);
  if (!trace || trace.totalEvents === 0) {
    alert("Trace not found");
    return;
  }

  const el = document.getElementById("panel-dev-console")!;
  el.innerHTML = `<h1>Trace: ${corrId}</h1>
    <div class="card">
      <p>Total: ${trace.totalMs}ms | Events: ${trace.totalEvents}</p>
      <div id="trace-tree" style="font-family:Consolas,monospace;font-size:12px;"></div>
    </div>`;

  document.getElementById("trace-tree")!.innerHTML = renderTraceNode(trace.tree, 0);
}

function renderTraceNode(node: TracePhase, depth: number): string {
  const indent = "&nbsp;&nbsp;&nbsp;&nbsp;".repeat(depth);
  const color = node.status === "error" ? "#a80000" : node.type === "llm" ? "#6264a7" : "#323130";
  const icon = node.status === "error" ? "❌" : node.type === "llm" ? "🤖" : node.type === "tool" ? "🔧" : "📋";
  const expand = node.children.length > 0 ? "▶" : "•";

  return `<div style="padding:4px 0;">
    <span style="color:${color}">${indent}${expand} ${icon} ${node.name}</span>
    <span style="color:#605e5c">${node.durationMs}ms</span>
    ${node.detail ? `<span style="color:#0078d4"> | ${node.detail}</span>` : ""}
    ${node.error ? `<span style="color:#a80000"> | ERROR: ${node.error}</span>` : ""}
    ${node.children.map((c: TracePhase) => renderTraceNode(c, depth + 1)).join("")}
  </div>`;
}
```

---

## 6. Teams Theme Detection

The tab should detect and apply the Teams theme:

```typescript
// In app.ts init():
microsoftTeams.app.initialize().then(() => {
  microsoftTeams.app.getContext().then((context) => {
    applyTheme(context.app.theme);
  });
  microsoftTeams.registerOnThemeChangeHandler((theme) => {
    applyTheme(theme);
  });
});

function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.style.background = "#1f1f1f";
    root.style.color = "#ffffff";
  } else if (theme === "contrast") {
    root.style.background = "#000000";
    root.style.color = "#ffffff";
  } else {
    root.style.background = "#f3f2f1";
    root.style.color = "#323130";
  }
}
```

---

## 7. Cold-Start Boot Shell

The Control Center shows a loading state during cold starts:

```typescript
// In tabDashboard.ts
export async function tabDashboard(req, context) {
  // Check if still cold-starting (3s delay in lifecycleNotices.ts)
  if (process.uptime() < 5) {
    return {
      status: 503,  // Service Unavailable during cold start
      headers: { "Content-Type": "application/json" },
      body: {
        status: "cold-start",
        message: "HelkinSwarm is starting up, please wait a moment...",
        retryAfter: 5,
      },
    };
  }
  // ... normal response
}
```

---

## 8. Key Files

| File | Action | Notes |
|------|--------|-------|
| `src/functions/tabDashboard.ts` | **Modify** | Add cold-start 503, session count, cost snapshot |
| `src/functions/tabDevConsole.ts` | **Create** | Session tracer + traces endpoint |
| `src/functions/tabGetStarted.ts` | **Modify** | Quick commands, capabilities count |
| `tabs/index.html` | **Create** | Global SPA shell |
| `tabs/app.ts` | **Create** | Router + panel renderers + Teams SDK init |
| `tabs/styles.css` | **Create** | Teams-compatible styles |

---

## 9. Acceptance Criteria

1. Tab backends return valid JSON for all 4 endpoints
2. Global SPA loads in Teams client and renders all 3 panels
3. Session tracer displays complete causal tree for any valid correlation ID
4. Cold-start returns 503 with `retryAfter` header
5. Teams theme (light/dark/contrast) is detected and applied to the SPA
6. No PII is exposed in any tab panel
7. All API calls use the per-stamp backend, not a centralized backend
