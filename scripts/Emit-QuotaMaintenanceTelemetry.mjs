/* eslint-disable no-console */

import fs from 'node:fs';
import process from 'node:process';
import appInsights from 'applicationinsights';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = value;
  }
  return args;
}

function requireArg(args, name) {
  const value = args[name];
  if (!value) {
    throw new Error(`Missing required argument --${name}`);
  }
  return value;
}

function normalizeSummary(raw, aliasFilter) {
  const aliases = Array.isArray(raw.aliases) ? raw.aliases : [];
  if (!aliasFilter) {
    return aliases;
  }

  return aliases.filter((aliasSummary) => aliasSummary.alias === aliasFilter);
}

function toMeasurements(summary, workflowSummary) {
  return {
    deploymentCount: Number(summary.deploymentCount ?? 0),
    floorPinnedCount: Number(summary.floorPinnedCount ?? 0),
    totalRequestedCapacity: Number(summary.totalRequestedCapacity ?? 0),
    lowCapacityThreshold: Number(summary.lowCapacityThreshold ?? workflowSummary.lowCapacityThreshold ?? 0),
    recommendedFloorCapacity: Number(summary.recommendedFloorCapacity ?? workflowSummary.recommendedFloorCapacity ?? 0),
    aliasCount: Number(workflowSummary.aliasCount ?? 1),
    autoApplyRequested: summary.autoApplyRequested ? 1 : 0,
    autoApplyDispatched: summary.autoApplyDispatched ? 1 : 0,
  };
}

function toProperties(summary, workflowSummary, source) {
  return {
    source,
    workflowRunId: String(workflowSummary.workflowRunId ?? ''),
    workflowName: String(workflowSummary.workflowName ?? ''),
    refName: String(workflowSummary.refName ?? ''),
    alias: String(summary.alias ?? ''),
    aiServicesName: String(summary.aiServicesName ?? ''),
    autoApplyRequested: String(Boolean(summary.autoApplyRequested)),
    autoApplyDispatched: String(Boolean(summary.autoApplyDispatched)),
    sweepAllStamps: String(Boolean(workflowSummary.sweepAllStamps)),
  };
}

async function flush(client) {
  await new Promise((resolve) => {
    client.flush({
      callback: () => resolve(),
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = requireArg(args, 'connection-string');
  const summaryPath = requireArg(args, 'summary-path');
  const source = args.source ?? 'quota-maintenance';
  const aliasFilter = args.alias;
  const cloudRole = args['cloud-role'] ?? 'quota-maintenance';

  const rawSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const aliasSummaries = normalizeSummary(rawSummary, aliasFilter);
  if (aliasSummaries.length === 0) {
    console.error(`No alias summaries found in ${summaryPath}${aliasFilter ? ` for alias ${aliasFilter}` : ''}.`);
    process.exitCode = 1;
    return;
  }

  appInsights
    .setup(connectionString)
    .setAutoCollectConsole(false)
    .setAutoCollectDependencies(false)
    .setAutoCollectExceptions(false)
    .setAutoCollectPerformance(false)
    .setAutoCollectRequests(false)
    .setAutoDependencyCorrelation(false)
    .setUseDiskRetryCaching(false)
    .start();

  const client = new appInsights.TelemetryClient(connectionString);
  client.commonProperties = {
    helkinswarmSource: source,
  };
  client.addTelemetryProcessor((envelope) => {
    envelope.tags['ai.cloud.role'] = cloudRole;
    envelope.tags['ai.cloud.roleInstance'] = source;
    return true;
  });

  for (const summary of aliasSummaries) {
    const properties = toProperties(summary, rawSummary, source);
    const measurements = toMeasurements(summary, rawSummary);

    client.trackEvent({
      name: 'QuotaMaintenanceBaseline',
      properties,
      measurements,
    });

    if (measurements.floorPinnedCount > 0) {
      client.trackEvent({
        name: 'QuotaMaintenanceFloorPinned',
        properties,
        measurements,
      });
    }

    if (measurements.autoApplyDispatched > 0) {
      client.trackEvent({
        name: 'QuotaMaintenanceAutoApplyDispatched',
        properties,
        measurements,
      });
    }
  }

  await flush(client);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});