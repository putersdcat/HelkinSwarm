import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CapabilityManifestSchema } from '../../src/capabilities/manifestSchema.js';

describe('azure mcp manifest', () => {
  it('declares a scoped read-only stdio MCP skill for Azure estate, cost, and health inspection', () => {
    const manifest = CapabilityManifestSchema.parse(
      JSON.parse(readFileSync('skills/azuremcp/manifest.json', 'utf8')) as unknown,
    );

    expect(manifest.domain).toBe('azuremcp');
    expect(manifest.mcpServer?.transport).toBe('stdio');
    if (manifest.mcpServer?.transport !== 'stdio') {
      throw new Error('Expected stdio transport');
    }

    expect(manifest.mcpServer.command).toBe('node');
    expect(manifest.mcpServer.args.slice(0, 4)).toEqual([
      '${workspaceRoot}/node_modules/@azure/mcp/index.js',
      'server',
      'start',
      '--read-only',
    ]);
    expect(manifest.mcpServer.args).toContain('subscription_list');
    expect(manifest.mcpServer.args).toContain('group_list');
    expect(manifest.mcpServer.args).toContain('pricing_get');
    expect(manifest.mcpServer.args).toContain('quota_usage_check');
    expect(manifest.mcpServer.args).toContain('monitor_activitylog_list');
    expect(manifest.mcpServer.args).toContain('resourcehealth_availability-status_get');
    expect(manifest.mcpServer.args).toContain('resourcehealth_health-events_list');

    expect(manifest.capabilityGroups.map((group) => group.id)).toEqual([
      'estate-inventory',
      'costs-quotas',
      'operational-health',
    ]);
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'azuremcp_subscription_list',
      'azuremcp_group_list',
      'azuremcp_group_resource_list',
      'azuremcp_functionapp_get',
      'azuremcp_storage_account_get',
      'azuremcp_pricing_get',
      'azuremcp_quota_usage_check',
      'azuremcp_monitor_activitylog_list',
      'azuremcp_resourcehealth_availability_status_get',
      'azuremcp_resourcehealth_health_events_list',
    ]);
    expect(manifest.tools.map((tool) => tool.remoteToolName)).toEqual([
      'subscription_list',
      'group_list',
      'group_resource_list',
      'functionapp_get',
      'storage_account_get',
      'pricing_get',
      'quota_usage_check',
      'monitor_activitylog_list',
      'resourcehealth_availability-status_get',
      'resourcehealth_health-events_list',
    ]);
    expect(manifest.tools.every((tool) => tool.risk === 'low' && tool.privilegeClass === 'read-only')).toBe(true);
    expect(manifest.tools.every((tool) => tool.requiresSubAgent)).toBe(true);
  });
});