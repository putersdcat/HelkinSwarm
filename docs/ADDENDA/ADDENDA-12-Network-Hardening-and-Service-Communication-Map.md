# ADDENDA-12 — Network Hardening & Service Communication Map

> Repo-grounded implementation note for issue `#212`.

## Purpose

Document the current stamped communication graph, the public-surface reality of the live architecture, and the phased path from **identity hardening** to actual **network hardening**.

This addendum exists because the current codebase already completed a meaningful Phase 1 auth pass, but the repo did **not** yet contain the network-plane resources needed for the private-endpoint / deny-by-default target state.

## Current stamped communication map

### Core runtime outbound dependencies

| Source | Destination | Purpose | Current auth model | Current network model |
|---|---|---|---|---|
| Function App | Storage Account | Azure Functions host state, Durable coordination, blobs/queues/tables | UAMI + RBAC, shared key disabled | Public endpoint allowed |
| Function App | Cosmos DB | sessions, memory, hooks, relay containers | UAMI + Cosmos RBAC, local auth disabled | Public endpoint allowed |
| Function App | Key Vault | runtime secret resolution via Key Vault references | UAMI + RBAC | Public endpoint allowed |
| Function App | Azure AI Services / Foundry | LLM and content-safety calls | UAMI + Cognitive Services User, local auth disabled | Public endpoint allowed |
| Function App | ACR | image pull at deploy/runtime | UAMI + AcrPull | Public endpoint allowed |
| Function App | Application Insights / Log Analytics | telemetry/export | connection string / platform integration | Azure-managed public path |

### Required inbound/public flows

| Source | Destination | Why it remains public today |
|---|---|---|
| Bot Framework Service | `/api/messages` on Function App | Required Teams ingress path |
| Health checks / deploy workflow | `/api/health` on Function App | Current deploy-stamp health validation assumes public reachability |
| GitHub-hosted deployment runner | Key Vault / ACR / ARM | OIDC-based deployment and image push still assume public control-plane reachability |

### Important reality

The current stamp is **identity-hardened**, but not **network-hardened**.

That means leaked keys are much less useful than before, but the backing services are still publicly reachable on their platform endpoints.

## What Phase 1 already delivered in repo code

Repo-grounded in `infra/main.bicep`:

- Storage: `allowSharedKeyAccess: false`
- Cosmos DB: `disableLocalAuth: true`
- AI Services: `disableLocalAuth: true`
- ACR: `adminUserEnabled: false`
- Function App runtime paths use managed identity for storage, Cosmos, Foundry, and ACR pull

This is necessary groundwork, but it is **not** equivalent to firewall hardening.

## What is still missing for the actual firewall goal

The repo does **not** currently define:

- VNet / subnet topology for a stamp
- delegated subnet for the Container Apps Environment
- dedicated private-endpoint subnet
- private endpoints for Storage / Cosmos / Key Vault / AI Services
- private DNS zones + virtual network links + zone groups
- NSGs / UDRs / NAT strategy
- ingress restriction model for the Function App / ACA environment
- ACR SKU upgrade path for tighter network control

Without those resources, deny-by-default network ACLs would break runtime reachability.

## Phased implementation model

### Phase 1 — Identity hardening ✅

Already in repo.

### Phase 1.5 — Documentation + temporary debug intent plumbing ✅

This pass adds:

- this communication-map addendum
- CI/CD guidance for temporary developer debug CIDRs
- Bicep/workflow parameter plumbing for `developerAllowedIpCidrs`

Current behavior is intentionally conservative: the pipeline can carry the intended debug CIDR list, but the network plane is **not** yet deny-by-default.

### Phase 2 — VNet / private-endpoint foundation (future issue)

Required minimums:

1. Create stamp VNet and subnets
2. Migrate Container Apps Environment to delegated subnet topology
3. Add private endpoints for:
   - Storage
   - Cosmos DB
   - Key Vault
   - Azure AI Services
4. Add private DNS zones and links
5. Change service network ACLs from allow to deny-by-default once private reachability is verified

### Phase 3 — Public-surface minimization

After Phase 2 proves stable:

- tighten remaining public access rules
- decide exact temporary developer allowlist path
- revisit whether ACR SKU needs upgrade for stricter network posture
- document Bot Framework ingress constraints separately from internal-service restrictions

## Temporary developer IP allowlisting

Current groundwork parameter:

- Workflow input: `DEVELOPER_ALLOWED_IP_CIDRS`
- Bicep parameter: `developerAllowedIpCidrs`

Expected shape:

```json
["203.0.113.10/32"]
```

### Important constraint

This parameter is currently **intent plumbing**, not final enforcement.

It should be treated as:

- a deployment-time declaration of the temporary debug CIDRs that will matter in the future network-hardened topology
- not proof that the services are already deny-by-default

## Acceptance status for `#212`

| Acceptance item | Status after this pass |
|---|---|
| Service-to-service communication map documented | ✅ |
| Private endpoints or network restrictions on Cosmos / KV / Storage | ❌ |
| Bicep enforces network rules | ❌ full network plane, ✅ parameter groundwork |
| Developer IP allowlist parameterized and optional | ✅ groundwork |
| No unnecessary public internet exposure on internal services | ❌ not yet |
| Bot still works after restrictions applied | ❌ full restrictions not yet deployed |

## Conclusion

The honest state of the repo after this addendum is:

- **Phase 1 auth hardening is real**
- **network hardening design is now explicitly mapped**
- **developer debug CIDR input is parameterized**
- **full firewall/private-endpoint delivery still requires a dedicated VNet migration issue**