# HelkinSwarm v2 — Identity & Registration Registry

> **Single source of truth** for all Entra ID, Azure, and Teams identity artefacts.
> Updated: 2026-03-18

## Entra App Registrations

### HelkinSwarm-v2-CICD (GitHub Actions OIDC)
| Property | Value |
|----------|-------|
| Display Name | `HelkinSwarm-v2-CICD` |
| Application (client) ID | `97e5a7b7-9cd7-4019-9bc3-f9498f18ca6e` |
| Object ID | `f8743177-e49c-4e50-a776-6f01699d0c8c` |
| Service Principal ID | `069545f9-b1d7-4e11-bcf3-64827261c1fa` |
| Federated Credentials | `main` branch + `pull_request` |
| RBAC | Contributor + User Access Administrator (subscription scope) |
| Purpose | OIDC authentication for GitHub Actions deploy-stamp.yml |

## User-Assigned Managed Identity (per stamp)

### Stamp `a7f2`
| Property | Value |
|----------|-------|
| Resource Name | `helkinswarm-id-a7f2` |
| Client ID | `e2883966-f38e-40e8-a1c0-d1145bdb23c5` |
| Resource Group | `rg-helkinswarm-a7f2` |
| Purpose | Runtime identity for Function App, Bot Service msaAppId, KV access, Cosmos access, AI Services access |

## Bot Service

### Stamp `a7f2`
| Property | Value |
|----------|-------|
| Bot Name | `helkinswarm-bot-a7f2` |
| Bot ID (msaAppId) | `e2883966-f38e-40e8-a1c0-d1145bdb23c5` (= UAMI Client ID) |
| Auth Type | UserAssignedMSI |
| Messaging Endpoint | `https://helkinswarm-func-a7f2.purplepebble-508e1162.eastus2.azurecontainerapps.io/api/messages` |
| Teams Channel | Enabled |

## Teams App Manifest
| Property | Value |
|----------|-------|
| Manifest ID | `e2883966-f38e-40e8-a1c0-d1145bdb23c5` (= UAMI Client ID / Bot ID) |
| Version | `2.0.0` |
| Note | When global router is deployed (Phase 2), endpoint will be updated to the router's permanent URL |

## Azure Subscription & Tenant
| Property | Value |
|----------|-------|
| Tenant ID | `51b1f02a-e19b-4089-a5f6-3ebb72835521` |
| Subscription ID | `65b1d40b-8962-46cd-b2d7-fa5d09b787a1` |
| User Principal (Owner) | `eric@putersdcat.com` |
| User Object ID | `40f5c975-3aa2-47d8-b32d-a9d7a392f6dc` |

## GitHub Repository Variables
| Variable | Value |
|----------|-------|
| AZURE_CLIENT_ID | `97e5a7b7-9cd7-4019-9bc3-f9498f18ca6e` |
| AZURE_TENANT_ID | `51b1f02a-e19b-4089-a5f6-3ebb72835521` |
| AZURE_SUBSCRIPTION_ID | `65b1d40b-8962-46cd-b2d7-fa5d09b787a1` |
| USER_PRINCIPAL_ID | `40f5c975-3aa2-47d8-b32d-a9d7a392f6dc` |
| ALERT_EMAIL | (configured in GitHub) |

---

## Alpha Artefacts — DO NOT USE (Mothballed)

See `.github/copilot-instructions.md` for the full quarantine rules.

| Artefact | Value | Status |
|----------|-------|--------|
| Entra App — CICD | `HelkinSwarm-Alpha-CICD` · `50524eb9-79c8-40fb-aec6-0c28d36a2135` | **MOTHBALLED** |
| Entra App — Graph | `HelkinSwarm Graph Client` · `65c0820d-5ebd-4f04-ae19-d2deda19af70` | **MOTHBALLED** |
| Bot ID (Alpha) | `b3cd420b-23f5-43d6-9824-df74a742a9df` | **MOTHBALLED** |
| Resource Group | `helkinswarm-prod-eus2` | **MOTHBALLED** |
