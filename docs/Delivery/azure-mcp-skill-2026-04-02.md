# Azure MCP first-slice delivery notes (2026-04-02)

## Scope shipped for `#464`

This first slice integrates the official Azure MCP Server as a **read-only** MCP-backed HelkinSwarm skill with an explicit tool allowlist rather than a broad namespace dump.

The goal is to make the Azure control plane discoverable and useful for virtual operators without exposing destructive operations or sensitive secret-return paths in the first release.

## Why the first slice is explicit-tool based

Official Azure MCP guidance shows the server can be started with:

- `--read-only`
- `--namespace`
- `--tool`

The server also exposes a very large surface area across 40+ service areas. Using explicit `--tool` selectors keeps the initial HelkinSwarm integration aligned with the already-shipped granular MCP-loading work from `#463`.

## Included tool families

### Estate inventory

- `subscription_list`
- `group_list`
- `group_resource_list`
- `functionapp_get`
- `storage_account_get`

### Costs and quotas

- `pricing_get`
- `quota_usage_check`

### Operational health

- `monitor_activitylog_list`
- `resourcehealth_availability-status_get`
- `resourcehealth_health-events_list`

## Deliberate exclusions in this first slice

Not included yet:

- Key Vault secret/key/certificate tools
- App Configuration value inspection
- write/create/update/delete Azure tools
- deployment/template mutation commands
- local-only monitor instrumentation workflow tools

Reason: even with upstream elicitation support, those paths introduce either destructive side effects, secret-return risk, or a much broader operational surface than this issue asked for.

## Auth / hosting model

This skill uses the official `@azure/mcp` package over MCP `stdio` transport.

At runtime, Azure MCP uses Azure Identity credential resolution and Azure RBAC. In practice that means HelkinSwarm inherits whichever approved Azure credential context is available to the stamp/runtime environment.

This first slice therefore assumes:

- Azure CLI login for local development, or
- managed identity / equivalent Azure Identity context in hosted environments.

## Safety posture

- HelkinSwarm-side tool metadata classifies the exposed Azure slice as `read-only` and `low` risk.
- Upstream Azure MCP still provides tool annotations and sensitive-data confirmation behavior, but the first slice intentionally avoids the most secret-bearing namespaces rather than relying on elicitation alone.

## Follow-on expansion candidates

Once this slice is validated, the next Azure MCP expansions should be considered separately and deliberately:

1. monitoring/log queries beyond activity logs
2. App Configuration inspection
3. Key Vault inspection with an explicit secret-handling policy
4. write-plane provisioning namespaces with stronger confirmation boundaries
5. remote/self-hosted Azure MCP topology for stamped production environments