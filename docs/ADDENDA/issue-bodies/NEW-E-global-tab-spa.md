## Global Tab SPA — Global Static Website + Per-Stamp Tab Backends

The tab infrastructure uses a **global SPA + per-stamp backends** pattern. A single global SPA is deployed to Azure Storage Static Websites and makes per-stamp API calls to each stamp's backend.

**Spec ref:** `docs/ADDENDA/ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md`

---

## Architecture

```
Global SPA (Azure Storage Static Website)
  /tabs.microsoft.com/helkinswarm
  ├── / → index.html (tab shell with JS router)
  ├── /control-center → Control Center panel
  ├── /dev-console → Dev Console panel
  └── /get-started → Get Started panel

Per-Stamp Backend (Azure Functions)
  GET /api/tab/dashboard → TabDashboard
  GET /api/tab/dev-console → TabDevConsole
  GET /api/tab/sessions → Running sessions list
  GET /api/tab/traces → Session tracer
  GET /api/tab/health → Health status for this stamp
```

---

## Implementation

### Frontend Files (New)

| File | Purpose |
|------|---------|
| `tabs/index.html` | Global SPA shell with Teams SDK |
| `tabs/app.ts` | Hash-based router + panel renderers |
| `tabs/styles.css` | Teams-compatible styles with dark theme support |

### Backend Files (New)

| File | Purpose |
|------|---------|
| `src/functions/tabDashboard.ts` | Control Center data endpoint |
| `src/functions/tabDevConsole.ts` | Dev Console data + trace endpoint |
| `src/functions/tabGetStarted.ts` | Get Started data endpoint |

### Existing Files (Modify)

| File | Change |
|------|--------|
| `appPackage/manifest.json` | Add `{{TAB_HOST_URL}}` placeholder |
| `infra/main.bicep` | Add Azure Storage Static Website for tabs |

---

## Teams Theme Detection

The SPA must detect and apply the Teams theme (light/dark/contrast):

```typescript
microsoftTeams.app.getContext().then((context) => {
  applyTheme(context.app.theme);
});
```

---

## Acceptance Criteria

- [ ] Global SPA loads in Teams client at the tab URL
- [ ] Hash-based routing works for all 3 panels (control-center, dev-console, get-started)
- [ ] All 3 panels make per-stamp API calls (not centralized)
- [ ] Teams theme (light/dark/contrast) is detected and applied
- [ ] Cold-start (container still initializing) shows graceful 503 with Retry-After
- [ ] Tab manifest placeholder `{{TAB_HOST_URL}}` is substituted at build time
- [ ] No PII exposed in any tab panel
