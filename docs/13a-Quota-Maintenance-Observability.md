# Quota Maintenance Observability

This document defines the telemetry emitted by HelkinSwarm quota-maintenance workflows and the KQL queries used to inspect and alert on that data.

## Event names

Quota maintenance emits classic Application Insights custom events into each stamp's Application Insights component. Query these with `customEvents`, either through the Application Insights component directly or via `scripts/Invoke-AzOperationalInsightsQuery.ps1 -QueryScope AppInsights`.

### `QuotaMaintenanceBaseline`

Emitted once per alias per quota-maintenance run.

Properties:
- `source` — workflow source such as `quota-optimize` or `deploy-stamp-postdeploy`
- `workflowRunId`
- `workflowName`
- `refName`
- `alias`
- `aiServicesName`
- `autoApplyRequested`
- `autoApplyDispatched`
- `sweepAllStamps`

Measurements:
- `deploymentCount`
- `floorPinnedCount`
- `totalRequestedCapacity`
- `lowCapacityThreshold`
- `recommendedFloorCapacity`
- `aliasCount`
- `autoApplyRequested`
- `autoApplyDispatched`

### `QuotaMaintenanceFloorPinned`

Emitted when one or more deployments on an alias are at or below the configured floor threshold.

### `QuotaMaintenanceAutoApplyDispatched`

Emitted when the quota-maintenance workflow dispatches a follow-up `deploy-stamp.yml` run with generated overrides.

## Verified query patterns

All queries below target the verified component-level schema and use `customEvents`.

### Recent quota-maintenance runs

```kusto
customEvents
| where name == 'QuotaMaintenanceBaseline'
| project timestamp,
          Alias = tostring(customDimensions['alias']),
          Source = tostring(customDimensions['source']),
          Workflow = tostring(customDimensions['workflowName']),
          FloorPinnedCount = todouble(customMeasurements['floorPinnedCount']),
          TotalRequestedCapacity = todouble(customMeasurements['totalRequestedCapacity'])
| order by timestamp desc
```

### Aliases with floor-pinned deployments

```kusto
customEvents
| where name == 'QuotaMaintenanceBaseline'
| extend Alias = tostring(customDimensions['alias'])
| extend FloorPinnedCount = todouble(customMeasurements['floorPinnedCount'])
| where FloorPinnedCount > 0
| project timestamp, Alias, FloorPinnedCount,
          SuggestedFloor = todouble(customMeasurements['recommendedFloorCapacity'])
| order by timestamp desc
```

### Aliases where auto-apply dispatched

```kusto
customEvents
| where name == 'QuotaMaintenanceAutoApplyDispatched'
| project timestamp,
          Alias = tostring(customDimensions['alias']),
          WorkflowRunId = tostring(customDimensions['workflowRunId']),
          Source = tostring(customDimensions['source'])
| order by timestamp desc
```

### Trend of total requested capacity over time

```kusto
customEvents
| where name == 'QuotaMaintenanceBaseline'
| extend Alias = tostring(customDimensions['alias'])
| extend TotalRequestedCapacity = todouble(customMeasurements['totalRequestedCapacity'])
| summarize LatestCapacity = arg_max(timestamp, TotalRequestedCapacity) by Alias, bin(timestamp, 1d)
| order by timestamp desc
```

## Alert hooks

### Implemented alert: floor-pinned quota detected

`infra/main.bicep` defines a scheduled query rule that fires when a `QuotaMaintenanceBaseline` event reports `floorPinnedCount > 0` for the stamp.

Recommended KQL shape:

```kusto
customEvents
| where name == 'QuotaMaintenanceBaseline'
| extend FloorPinnedCount = todouble(customMeasurements['floorPinnedCount'])
| where FloorPinnedCount > 0
```

### Additional alert ideas

- repeated `QuotaMaintenanceAutoApplyDispatched` events within 24 hours
- upward drift in `totalRequestedCapacity` above a chosen guardrail
- repeated floor-pinned detections without subsequent remediation
