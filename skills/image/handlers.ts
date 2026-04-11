// Image generation skill handler — text-to-image via Azure AI Services DALL-E 3.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #241
//
// Backend: Azure AI Services DALL-E 3 deployment in the stamp's AI project (#241)
// Endpoint: {AZURE_AI_FOUNDRY_ENDPOINT}/openai/deployments/{deployment}/images/generations?api-version=2024-10-21
// Auth: Managed Identity bearer token (scope: https://cognitiveservices.azure.com/.default)
// Deployment: 'dall-e-3' by default, override via AZURE_DALL_E_DEPLOYMENT env var
// Output: b64_json decoded → persisted to runtime-asset blob via runtimeAssetStore

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { persistRuntimeAsset } from '../../src/integrations/runtimeAssetStore.js';
import { getBearerToken } from '../../src/auth/identity.js';
import { getEnvConfig } from '../../src/config/envConfig.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AZURE_API_VERSION = '2024-10-21';
const DEFAULT_DALL_E_DEPLOYMENT = 'dall-e-3';
// Cognitive Services token scope for managed identity on Azure AI Services
const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';

// ---------------------------------------------------------------------------
// Zod schemas for API response validation at boundary
// ---------------------------------------------------------------------------

const ImageDataSchema = z.object({
  b64_json: z.string().min(1).optional(),
  url: z.string().url().optional(),
  revised_prompt: z.string().optional(),
}).passthrough();

const ImagesResponseSchema = z.object({
  created: z.number().optional(),
  data: z.array(ImageDataSchema),
}).passthrough();

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const ImageGenerateArgsSchema = z.object({
  prompt: z.string().min(1).max(4000),
  size: z.enum(['1024x1024', '1792x1024', '1024x1792']).optional().default('1024x1024'),
  style: z.enum(['vivid', 'natural']).optional().default('vivid'),
  quality: z.enum(['standard', 'hd']).optional().default('standard'),
  userId: z.string().min(1),
  correlationId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFileName(deployment: string, size: string, correlationId: string): string {
  const deploySlug = deployment.replace(/[^a-z0-9-]/gi, '-');
  const corrShort = correlationId.slice(0, 8);
  return `${deploySlug}-${size}-${corrShort}.png`;
}

// ---------------------------------------------------------------------------
// Export: image_generate tool handler
// ---------------------------------------------------------------------------

export const image_generate: ToolHandler = async (args) => {
  const parsed = ImageGenerateArgsSchema.parse({
    prompt: args['prompt'],
    size: args['size'] ?? '1024x1024',
    style: args['style'] ?? 'vivid',
    quality: args['quality'] ?? 'standard',
    userId: args['userId'],
    correlationId: args['correlationId'],
  });

  const config = getEnvConfig();
  if (!config.azureAiFoundryEndpoint) {
    throw new Error(
      'Image generation requires AZURE_AI_FOUNDRY_ENDPOINT to be configured. '
      + 'Ensure the stamp Azure AI Services resource is provisioned.',
    );
  }

  const deployment = process.env['AZURE_DALL_E_DEPLOYMENT'] ?? DEFAULT_DALL_E_DEPLOYMENT;
  const correlationId = parsed.correlationId ?? `img-${Date.now()}`;

  // Build Azure AI Services DALL-E endpoint
  const base = config.azureAiFoundryEndpoint.replace(/\/+$/, '');
  const url = `${base}/openai/deployments/${encodeURIComponent(deployment)}/images/generations?api-version=${AZURE_API_VERSION}`;

  // Obtain managed identity bearer token for Cognitive Services
  const token = await getBearerToken(COGNITIVE_SERVICES_SCOPE);

  const requestBody: Record<string, unknown> = {
    prompt: parsed.prompt,
    n: 1,
    size: parsed.size,
    quality: parsed.quality,
    style: parsed.style,
    response_format: 'b64_json',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `Image generation failed: ${response.status} ${response.statusText} — ${errorText}`,
    );
  }

  const rawJson = await response.json() as unknown;
  const parsed_response = ImagesResponseSchema.parse(rawJson);
  const imageData = parsed_response.data[0];

  if (!imageData) {
    throw new Error('Image generation API returned an empty data array.');
  }

  if (!imageData.b64_json) {
    throw new Error(
      'Image generation API did not return b64_json. '
      + 'response_format: b64_json was requested — check DALL-E deployment configuration.',
    );
  }

  // Decode base64 → Buffer → persist to runtime asset store
  const imageBytes = Buffer.from(imageData.b64_json, 'base64');
  const fileName = buildFileName(deployment, parsed.size, correlationId);

  const assetReference = await persistRuntimeAsset({
    userId: parsed.userId,
    correlationId,
    contentType: 'image/png',
    fileName,
    bytes: imageBytes,
    source: {
      channel: 'tool',
      toolName: 'image_generate',
    },
    kind: 'image',
    summary: `Generated: "${parsed.prompt.slice(0, 120)}${parsed.prompt.length > 120 ? '...' : ''}"`,
  });

  if (!assetReference) {
    throw new Error('Failed to persist generated image to runtime asset store.');
  }

  const result: Record<string, unknown> = {
    assetId: assetReference.id,
    model: `azure:${deployment}`,
    size: parsed.size,
    fileName: assetReference.fileName ?? fileName,
    contentType: 'image/png',
    message: `Image generated and stored. Asset ID: ${assetReference.id}. Use this assetId to embed it in an email or reply to the user.`,
  };

  if (imageData.revised_prompt && imageData.revised_prompt !== parsed.prompt) {
    result['revisedPrompt'] = imageData.revised_prompt;
    result['message'] = `${result['message']} Model revised the prompt: "${imageData.revised_prompt}"`;
  }

  return result;
};
