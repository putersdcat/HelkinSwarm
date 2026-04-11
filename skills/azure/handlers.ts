// skills/azure/handlers.ts — Azure AI Foundry read-only oversight tools
// Issue: #467
//
// Gives HelkinSwarm self-awareness of its own AI infrastructure by querying
// the Azure Cognitive Services management API for deployment status, deprecation
// schedules, and quota availability.
//
// Auth: UAMI (ManagedIdentityCredential) with Reader role on the resource group.
//       Scope: https://management.azure.com/.default
// No OBO required — HelkinSwarm's own infra is queried using system identity.

import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import { z } from 'zod';
import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_API_VERSION = '2024-10-01';

// ---------------------------------------------------------------------------
// Credential singleton
// ---------------------------------------------------------------------------

let _cred: TokenCredential | undefined;

function getCredential(): TokenCredential {
  if (!_cred) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    _cred = clientId
      ? new ManagedIdentityCredential({ clientId })
      : new DefaultAzureCredential();
  }
  return _cred;
}

async function getBearerToken(): Promise<string> {
  const tokenResponse = await getCredential().getToken(ARM_SCOPE);
  if (!tokenResponse?.token) {
    throw new Error('Failed to acquire Azure management token.');
  }
  return tokenResponse.token;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the Cognitive Services / AI Foundry account name from the
 * AZURE_AI_FOUNDRY_ENDPOINT environment variable.
 *
 * Pattern: https://{account}.services.ai.azure.com/...
 *        or https://{account}.openai.azure.com/...
 */
function getFoundryAccountName(): string | null {
  const endpoint = process.env['AZURE_AI_FOUNDRY_ENDPOINT'];
  if (!endpoint) return null;
  const match = /https:\/\/([^.]+)\.(?:services\.ai|openai)\.azure\.com/.exec(endpoint);
  return match?.[1] ?? null;
}

/**
 * Returns a location derived from the Foundry endpoint or falls back to a
 * well-known default. Azure AI Foundry uses "eastus2" by default for standard
 * HelkinSwarm stamps; override via AZURE_FOUNDRY_LOCATION env var.
 */
function getFoundryLocation(): string {
  return process.env['AZURE_FOUNDRY_LOCATION'] ?? 'eastus2';
}

interface ArmConfig {
  subscriptionId: string;
  resourceGroup: string;
  accountName: string;
}

function getArmConfig(): ArmConfig | null {
  const subscriptionId = process.env['AZURE_SUBSCRIPTION_ID'];
  const resourceGroup = process.env['AZURE_RESOURCE_GROUP'];
  const accountName = getFoundryAccountName();
  if (!subscriptionId || !resourceGroup || !accountName) return null;
  return { subscriptionId, resourceGroup, accountName };
}

// ---------------------------------------------------------------------------
// ARM API helpers
// ---------------------------------------------------------------------------

async function armGet(path: string): Promise<unknown> {
  const token = await getBearerToken();
  const url = `https://management.azure.com${path}?api-version=${ARM_API_VERSION}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ARM API error ${response.status} at ${path}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Zod schemas for ARM responses
// ---------------------------------------------------------------------------

const DeploymentSkuSchema = z.object({
  name: z.string(),
  capacity: z.number().optional(),
});

const DeploymentPropertiesSchema = z.object({
  model: z.object({
    name: z.string(),
    version: z.string().optional(),
    publisher: z.string().optional(),
    format: z.string().optional(),
    callRateLimit: z.unknown().optional(),
    deprecation: z.object({
      fineTune: z.string().optional(),
      inference: z.string().optional(),
    }).optional(),
  }).optional(),
  versionUpgradeOption: z.string().optional(),
  currentCapacity: z.number().optional(),
  provisioningState: z.string().optional(),
  rateLimits: z.array(z.unknown()).optional(),
});

const CognitiveDeploymentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  sku: DeploymentSkuSchema.optional(),
  properties: DeploymentPropertiesSchema.optional(),
});

const DeploymentListResponseSchema = z.object({
  value: z.array(CognitiveDeploymentSchema),
  nextLink: z.string().optional(),
});

const QuotaUsageSchema = z.object({
  currentValue: z.number().optional(),
  limit: z.number().optional(),
  name: z.object({
    value: z.string().optional(),
    localizedValue: z.string().optional(),
  }).optional(),
  unit: z.string().optional(),
});

const QuotaListResponseSchema = z.object({
  value: z.array(QuotaUsageSchema).optional(),
});

// ---------------------------------------------------------------------------
// CommonArgsSchema — userId + correlationId injected by toolDispatchActivity
// ---------------------------------------------------------------------------

const CommonArgsSchema = z.object({
  userId: z.string().optional(),
  correlationId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Tool: foundry_list_deployments
// ---------------------------------------------------------------------------

export const foundry_list_deployments: ToolHandler = async (args) => {
  CommonArgsSchema.parse(args);

  const cfg = getArmConfig();
  if (!cfg) {
    return {
      status: 'config-missing',
      message: 'Azure subscription, resource group, or Foundry endpoint is not configured on this stamp. Cannot retrieve deployment list.',
    };
  }

  const path = `/subscriptions/${cfg.subscriptionId}/resourceGroups/${cfg.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${cfg.accountName}/deployments`;

  const raw = await armGet(path);
  const parsed = DeploymentListResponseSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Unexpected API response shape from Azure management API.',
      parseError: parsed.error.flatten(),
    };
  }

  const deployments = parsed.data.value.map((d) => ({
    name: d.name,
    modelName: d.properties?.model?.name ?? null,
    modelVersion: d.properties?.model?.version ?? null,
    skuName: d.sku?.name ?? null,
    capacity: d.sku?.capacity ?? d.properties?.currentCapacity ?? null,
    provisioningState: d.properties?.provisioningState ?? null,
    deprecation: d.properties?.model?.deprecation ?? null,
    versionUpgradeOption: d.properties?.versionUpgradeOption ?? null,
  }));

  return {
    status: 'success',
    accountName: cfg.accountName,
    resourceGroup: cfg.resourceGroup,
    deploymentCount: deployments.length,
    deployments,
  };
};

// ---------------------------------------------------------------------------
// Tool: foundry_check_deprecation
// ---------------------------------------------------------------------------

export const foundry_check_deprecation: ToolHandler = async (args) => {
  CommonArgsSchema.parse(args);

  const cfg = getArmConfig();
  if (!cfg) {
    return {
      status: 'config-missing',
      message: 'Azure subscription, resource group, or Foundry endpoint not configured.',
    };
  }

  const path = `/subscriptions/${cfg.subscriptionId}/resourceGroups/${cfg.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${cfg.accountName}/deployments`;

  const raw = await armGet(path);
  const parsed = DeploymentListResponseSchema.safeParse(raw);

  if (!parsed.success) {
    return { status: 'error', message: 'Unexpected API response shape.', parseError: parsed.error.flatten() };
  }

  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  const findings = parsed.data.value.flatMap((d) => {
    const results: Array<{
      deploymentName: string;
      modelName: string | undefined;
      issue: string;
      date: string;
      urgency: 'immediate' | 'soon' | 'upcoming';
    }> = [];

    const dep = d.properties?.model?.deprecation;
    if (!dep) return results;

    const modelName = d.properties?.model?.name;

    if (dep.inference) {
      const retireMs = Date.parse(dep.inference);
      if (!isNaN(retireMs)) {
        const daysLeft = Math.ceil((retireMs - now) / (24 * 60 * 60 * 1000));
        if (retireMs <= now) {
          results.push({ deploymentName: d.name, modelName, issue: 'inference-deprecated', date: dep.inference, urgency: 'immediate' });
        } else if (retireMs - now <= ninetyDaysMs) {
          results.push({ deploymentName: d.name, modelName, issue: 'inference-retiring-soon', date: dep.inference, urgency: daysLeft <= 30 ? 'soon' : 'upcoming' });
        }
      }
    }

    if (dep.fineTune) {
      const retireMs = Date.parse(dep.fineTune);
      if (!isNaN(retireMs) && retireMs - now <= ninetyDaysMs) {
        results.push({ deploymentName: d.name, modelName, issue: 'fine-tune-retiring', date: dep.fineTune, urgency: retireMs <= now ? 'immediate' : 'upcoming' });
      }
    }

    return results;
  });

  return {
    status: 'success',
    accountName: cfg.accountName,
    checkedDeployments: parsed.data.value.length,
    issueCount: findings.length,
    findings,
    summary: findings.length === 0
      ? 'All model deployments are using current, non-deprecated models.'
      : `${findings.length} deployment(s) have deprecation or retirement concerns.`,
  };
};

// ---------------------------------------------------------------------------
// Tool: foundry_get_quota
// ---------------------------------------------------------------------------

export const foundry_get_quota: ToolHandler = async (args) => {
  CommonArgsSchema.parse(args);

  const cfg = getArmConfig();
  if (!cfg) {
    return {
      status: 'config-missing',
      message: 'Azure subscription or Foundry endpoint not configured.',
    };
  }

  const location = getFoundryLocation();
  const ARM_API_QUOTA_VERSION = '2024-06-01-preview';
  const token = await getBearerToken();
  const url = `https://management.azure.com/subscriptions/${cfg.subscriptionId}/providers/Microsoft.CognitiveServices/locations/${location}/usages?api-version=${ARM_API_QUOTA_VERSION}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return {
      status: 'error',
      message: `Azure quota API returned ${response.status}: ${body.slice(0, 300)}`,
    };
  }

  const raw = await response.json();
  const parsed = QuotaListResponseSchema.safeParse(raw);

  if (!parsed.success) {
    return { status: 'error', message: 'Unexpected quota API response shape.', parseError: parsed.error.flatten() };
  }

  const quotas = (parsed.data.value ?? [])
    .filter((q) => q.name?.value)
    .map((q) => ({
      name: q.name?.value ?? '',
      label: q.name?.localizedValue ?? q.name?.value ?? '',
      unit: q.unit ?? 'count',
      used: q.currentValue ?? 0,
      limit: q.limit ?? 0,
      percentUsed: q.limit ? Math.round(((q.currentValue ?? 0) / q.limit) * 100) : null,
    }))
    .sort((a, b) => (b.percentUsed ?? 0) - (a.percentUsed ?? 0));

  return {
    status: 'success',
    location,
    quotaCount: quotas.length,
    quotas,
  };
};
