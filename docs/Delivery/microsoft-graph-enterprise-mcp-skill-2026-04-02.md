# Microsoft Graph Enterprise MCP skill — first integration slice

Issue: `#465`

## What shipped in this slice

HelkinSwarm now carries a built-in `skills/graphenterprise/manifest.json` skill for the Microsoft MCP Server for Enterprise at `https://mcp.svc.cloud.microsoft/enterprise`.

This slice deliberately scopes the integration to the **read-only Graph / Entra reporting plane** that Microsoft documents today:

- `microsoft_graph_suggest_queries`
- `microsoft_graph_get`
- `microsoft_graph_list_properties`

It does **not** pretend the server is already a write-capable Microsoft 365 admin plane.

## Design boundary

The Microsoft MCP Server for Enterprise is treated as:

- **preview**
- **delegated-only**
- **read-only** for HelkinSwarm's initial slice
- a tenant insight / reporting surface for Entra and Microsoft Graph questions

It is **not** the write plane for:

- user creation
- Exchange mailbox provisioning
- mail routing
- accepted domains / connectors / transport rules
- other Microsoft 365 configuration mutation work

Those remain separate lanes under:

- `#243` for native Entra / Graph write work
- `#472`–`#476` for the broader Microsoft 365 operational admin slice

## Provisioning and consent model

### Tenant bootstrap

Microsoft's current get-started flow documents a one-time tenant provisioning step for the Microsoft-owned Enterprise MCP service principal and a client application.

For HelkinSwarm, the important truth is:

1. the Microsoft-owned Enterprise MCP server must be provisioned in the tenant
2. HelkinSwarm's delegated auth client must be granted selected **MCP.* delegated scopes** against that resource
3. tenant admins must treat this as a real admin integration and review scopes explicitly

The documented tenant bootstrap permissions Microsoft calls out for provisioning are:

- `Application.ReadWrite.All`
- `Directory.Read.All`
- `DelegatedPermissionGrant.ReadWrite.All`

The documented least-privileged admin role for that provisioning step is:

- `Application Administrator`, or
- `Cloud Application Administrator`

### Runtime auth path

At runtime, the intended HelkinSwarm auth path is:

1. Teams user is authenticated
2. HelkinSwarm acquires delegated user context via Teams SSO / OBO bootstrap
3. HelkinSwarm requests delegated access tokens for the Enterprise MCP resource scopes
4. the streamable HTTP MCP call sends `Authorization: Bearer <delegated token>`
5. the Microsoft-owned Enterprise MCP service enforces user privileges plus granted MCP scopes

This slice adds runtime support for per-call bearer header injection on HTTP MCP skills so the Enterprise MCP skill can carry delegated auth instead of relying on static headers.

## Initial scope pack

The first shipped scope pack is intentionally read-only and aligned to the issue's reporting goals:

- `MCP.User.Read.All`
- `MCP.GroupMember.Read.All`
- `MCP.Organization.Read.All`
- `MCP.Application.Read.All`
- `MCP.Device.Read.All`
- `MCP.LicenseAssignment.Read.All`
- `MCP.Reports.Read.All`

In the manifest these are represented as resource-scoped delegated permissions under the Enterprise MCP app id:

- `api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/...`

This is intentionally **not** a blanket request for every available `MCP.*` scope.

## Auditability and observability

Microsoft documents that Enterprise MCP traffic can be monitored through Microsoft Graph activity logs.

Recommended audit posture for HelkinSwarm:

- enable Microsoft Graph activity logs for the tenant
- filter `RequestUri` for `/enterprise`
- filter `AppId` for the Enterprise MCP server app id `e8c77dc2-69b3-43f4-bc51-3213c9d915b4`
- correlate those records with HelkinSwarm correlation IDs and normal bot telemetry

This keeps the integration aligned with the repo's auditability and delegated-access posture.

## Relationship to `#243`

`#243` remains the native Graph / Entra execution lane for direct directory write workflows.

`#465` is now the **read-only administrative reporting complement** to that work:

- `#465` = conversational, delegated, read-only Graph / Entra reporting via Enterprise MCP
- `#243` = native HelkinSwarm Graph / Entra lookup-and-write execution lane

That distinction is deliberate and should be preserved.

## Honest remaining gap

This slice gives HelkinSwarm:

- a built-in skill manifest
- explicit capability metadata
- documented provisioning / consent / audit design
- runtime HTTP MCP bearer-header support for delegated auth

What it does **not** prove by itself is that the target tenant has already granted the required Enterprise MCP scopes to HelkinSwarm's delegated auth client. That remains an environment/bootstrap concern, not a reason to blur the design boundary in code.
