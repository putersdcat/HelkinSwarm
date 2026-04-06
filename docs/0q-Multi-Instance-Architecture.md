# HelkinSwarm Multi-Instance Architecture (One-to-One User-Aligned Deployments)
**Status:** Core requirement from RC2 onward

### Core Principle
Every user gets a **dedicated, isolated Azure footprint**. No shared resources except global service principals and the single Teams app. (however during development, its just understood the only existing instance will also be linked up to the development machinery of the main developer, so it will be used for development and testing, but it is still a one-to-one deployment, just with one user for now).

## Phase 0.75 Decisions (Locked)

The Architecture Research Gate is complete and approved in GitHub:
- `#17` **[ARCH DECISION] Global Router Architecture** (closed/approved)
- `#18` **[ARCH DECISION] Multi-Instance Stamping Parameterization Design** (closed/approved)

### Router Decision
- **Chosen approach:** Azure Functions HTTP trigger on **Consumption** plan (`helkinswarm-router`)
- **Why:** lowest cost at personal scale, simplest operations, native HTTP trigger model, direct access to Bot Framework activity JSON body
- **Rejected:**
	- API Management Consumption (no Entra integration on Consumption tier + unnecessary policy complexity)
	- Front Door (base monthly cost floor + cannot route by request-body identity)
	- Container Apps Job (not HTTP-triggered by design)

### Routing Identity Decision
- **Primary routing key:** `activity.from.aadObjectId`
- **Do not use as primary key:** `activity.from.id` (channel-scoped and not stable across systems)
- `upn` is informational and may change; `aadObjectId` is immutable

### user-map Decision
- Router lookup source is `config/user-map.json`
- Canonical key is Entra object ID

```json
{
	"version": 1,
	"users": {
		"<aadObjectId-guid>": {
			"alias": "a7f2",
			"upn": "eric@putersdcat.com",
			"endpoint": "https://helkinswarm-func-a7f2.<domain>/api/messages",
			"enabled": true
		}
	}
}
```

### Stamp Naming Decision
- `userAlias` is **required** and must be exactly 4 chars: `^[a-z0-9]{4}$`
- Resource naming pattern: `helkinswarm-{resourceType}-{alias}`
- Resource group naming pattern: `rg-helkinswarm-{alias}`

Examples for default alias `a7f2`:
- `rg-helkinswarm-a7f2`
- `helkinswarm-func-a7f2`
- `helkinswarm-cosmos-a7f2`
- `helkinswarm-kv-a7f2`

### Deployment Path Decision
- `deploy-stamp.yml` is the **only** stamp deployment path
- Required workflow input: `USER_ALIAS`
- Required invariant: all stamp resources are derived from alias parameterization in Bicep

### Naming & Obfuscation Rules
- Resource Group: `rg-HelkinSwarm-[4-digit-alphanum]` (e.g. `rg-HelkinSwarm-a7f2`)
- All resources: suffix `-a7f2` (cosmos-HelkinSwarm-a7f2, func-HelkinSwarm-a7f2, etc.)
- User map stored in `config/user-map.json` (source-controlled; contains Entra Object IDs as routing identifiers, not secrets)

### Pipeline Integration
- New parameter in all workflows: `USER_ALIAS`
- Bicep dynamically builds names from alias
- Default for initial deployment: your UPN (eric@putersdcat.com) = alias `a7f2`

### Global Shared Components
- Entra App Registration + Service Principal: `HelkinSwarm-Core` (OAuth, GitHub integration)
- Teams app manifest: single global app (see Tab Hosting below)
- Central router function (`helkinswarm-router`): Azure Functions Consumption HTTP trigger that routes incoming Teams activity by `activity.from.aadObjectId` → user-specific endpoint

### Tab Hosting — Global SPA + Per-Stamp Backends

> **Architecture Decision #107.** Tabs use a stateless global SPA that routes to stamp-resident API backends client-side. This keeps the Teams manifest global (single URL) while all user data stays on the correct stamp.

**Components:**
- **Global Tab SPA**: Azure Storage static website (`helkinswarmtabsst`), served from `rg-helkinswarm-tabs`. Scale-to-zero, ~$0.001/GB. One URL in the manifest: `{{TAB_HOST_URL}}` substituted at build time.
- **Per-Stamp Tab Backends**: Each stamp's Function App exposes `/api/tab/getting-started`, `/api/tab/control-center`, `/api/tab/dev-console`. Return JSON/HTML with stamp-specific data.
- **Client-Side Routing**: SPA reads `aadObjectId` from Teams tab JWT context, looks up stamp alias from bundled `user-map.json`, calls stamp API with OBO token.

**Cost guard (furious development phase):**
- the global router now carries the same source-controlled early-dev cost guard philosophy as the stamp (`#580`)
- the global tab host remains storage-only and carries its own RG budget/assertion layer (`#580`)

**Resource group:** `rg-helkinswarm-tabs` (separate from stamps and router)

### Deployment Flow
1. Commit to main
2. Pipeline reads `USER_ALIAS`
3. Stamps new RG + resources (or updates existing)
4. Legacy alpha RG remains untouched (mothballed)

### Future Expansion
- Add new user → add entry to user-map.json → run pipeline with new alias
- No code changes required

This construct is enforced from the first clean deployment onward.