# Status: PROPOSED — 2026-03-19

## Decision: Global Tab SPA Host + Per-Stamp Tab API Backends

**Problem being solved:**
Teams tabs in appPackage/manifest.json require fixed contentUrl values at app-upload time. The single global manifest must serve all users across all stamps. Tab data is 95% stamp-specific, but a single manifest can only point to one URL.

## Chosen Approach

1. **Global Tab SPA** — Single-page app hosted on Azure Storage static website (Blob Storage v2, $0.001/GB, scale-to-zero). Served at a fixed global URL. Hosted in rg-helkinswarm-tabs, owned by the router UAMI.

2. **Per-Stamp Tab API Backends** — Each stamp's Function App exposes tab API endpoints (/api/tab/getting-started, /api/tab/control-center, /api/tab/dev-console) that return JSON/HTML for their specific data.

3. **Client-Side Routing** — The SPA reads the user's identity (Entra aadObjectId) from the Teams tab context JWT. It calls the corresponding stamp API directly using the user's Entra token (OBO flow). The SPA knows which stamp to call via user-map.json bundled at build time.

4. **Build-Time Placeholder** — The teams-package.yml workflow substitutes {{TAB_HOST_URL}} in the manifest at package time.

## Why This Approach

- Azure Storage static website: $0.001/GB, scales to zero, zero management overhead
- SPA pattern: all tabs share one deployment, one URL in the manifest
- Per-stamp backends: tab APIs stay with the stamp's data (Cosmos, App Insights), no cross-stamp data movement
- Teams JWT (OBO): each tab call is authenticated as the actual user, stamp validates it
- No per-user hosting cost: one cheap global blob, stamp Function Apps already paid for

## Rejected Alternatives

- **Azure Static Web Apps (SWA) Free**: Scale-to-zero, built-in auth, BUT managed Functions dont support Managed Identity, Key Vault, or Durable Functions — cant call Cosmos or App Insights from stamp backends
- **SWA + bring-your-own Functions**: SWA for the SPA + linked Functions for backend — adds a second Functions app per stamp just for tabs; unnecessary complexity and cost
- **Per-user blob containers**: One Storage account per user, unique URL per user in manifest — requires manifest change per new user; breaks the one-manifest-is-global principle
- **Stamp-hosted SPA**: Putting the SPA on each stamp means the same code deployed N times and manifest points to N URLs — violates the one manifest constraint

## Resource Naming

- Resource group: rg-helkinswarm-tabs
- Storage account: helkinswarmtabsst (globally unique)
- Container: $web (static website hosting)
- Blob endpoint: https://helkinswarmtabsst.z6.web.core.windows.net

## Infrastructure (Bicep)

- Storage account (BlobStorage v2, HTTPS only, TLS 1.2, public access disabled)
- Static website hosting enabled (index.html, 404.html)
- Router UAMI gets Storage Blob Data Owner role (for future CI/CD deployment of the SPA)
- CDN profile + endpoint for global distribution

## CI/CD

- New workflow: deploy-tabs.yml (manual dispatch or push-to-main of tabs/**)
- Builds the SPA and uploads to the $web container
- Sets Cache-Control headers on all assets
- teams-package.yml substitutes {{TAB_HOST_URL}} into manifest staticTabs at build time

## Manifest Substitution (teams-package.yml)

```bash
TAB_HOST_URL="https://helkinswarmtabsst.z6.web.core.windows.net"
sed -i "s|{{TAB_HOST_URL}}|${TAB_HOST_URL}|g" appPackage/manifest.json
```

## Implementation Order

1. Phase 2.5: Deploy rg-helkinswarm-tabs + upload a placeholder index.html — verify manifest URL resolves
2. Phase 3: Build SPA skeleton (vanilla JS/HTML, no framework needed for MVP)
3. Phase 4: Wire tab API backends on stamps — real data in Control Center

## Spec Refs

- docs/0o-Microsoft-Teams-App-Expansion-with-Tabs.md
- docs/0q-Multi-Instance-Architecture.md
- docs/12-Deployment-CICD.md
- docs/10-Teams-Interface.md
