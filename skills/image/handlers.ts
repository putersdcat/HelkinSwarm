// Image generation skill handler — text-to-image via OpenRouter.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #241
//
// API: https://openrouter.ai/api/v1/images/generations (OpenAI-compatible images endpoint)
// Auth: OPENROUTER_API_KEY env var (same key used for chat completions — see #501)
// Default model: openai/dall-e-3 (also supports: openai/dall-e-2, black-forest-labs/flux-1.1-pro)
// Output: b64_json decoded → persisted to runtime-asset blob via runtimeAssetStore

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { persistRuntimeAsset } from '../../src/integrations/runtimeAssetStore.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_IMAGE_MODEL = 'openai/dall-e-3';
const OPENROUTER_IMAGES_ENDPOINT = 'https://openrouter.ai/api/v1/images/generations';

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
  model: z.string().min(1).optional(),
  userId: z.string().min(1),
  correlationId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferContentTypeFromModel(model: string): string {
  // FLUX and Stability AI models may produce WebP; DALL-E produces PNG.
  if (model.includes('flux') || model.includes('stable')) {
    return 'image/webp';
  }
  return 'image/png';
}

function buildFileName(model: string, size: string, correlationId: string): string {
  const modelSlug = model.split('/').pop()?.replace(/[^a-z0-9-]/gi, '-') ?? 'generated';
  const corrShort = correlationId.slice(0, 8);
  return `${modelSlug}-${size}-${corrShort}.png`;
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
    model: args['model'] ?? undefined,
    userId: args['userId'],
    correlationId: args['correlationId'],
  });

  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'Image generation requires OPENROUTER_API_KEY. '
      + 'Configure it in the stamp Key Vault as OpenRouterApiKey.',
    );
  }

  const model = parsed.model ?? process.env['IMAGE_GENERATION_MODEL'] ?? DEFAULT_IMAGE_MODEL;
  const correlationId = parsed.correlationId ?? `img-${Date.now()}`;

  // Build request body — use only DALL-E-specific params (size/style/quality) when
  // the model is from OpenAI; other models may not support them.
  const isDalleModel = model.startsWith('openai/dall-e') || model.startsWith('openai/gpt-image');

  const requestBody: Record<string, unknown> = {
    model,
    prompt: parsed.prompt,
    n: 1,
    response_format: 'b64_json',
  };

  if (isDalleModel) {
    requestBody['size'] = parsed.size;
    requestBody['style'] = parsed.style;
    requestBody['quality'] = parsed.quality;
  }

  const response = await fetch(OPENROUTER_IMAGES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/putersdcat/HelkinSwarm',
      'X-Title': 'HelkinSwarm',
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
      + 'response_format: b64_json was requested — check OpenRouter model support.',
    );
  }

  // Decode base64 → Buffer → persist to runtime asset store
  const imageBytes = Buffer.from(imageData.b64_json, 'base64');
  const contentType = inferContentTypeFromModel(model);
  const fileName = buildFileName(model, parsed.size, correlationId);

  const assetReference = await persistRuntimeAsset({
    userId: parsed.userId,
    correlationId,
    contentType,
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
    model,
    size: parsed.size,
    fileName: assetReference.fileName ?? fileName,
    contentType,
    message: `Image generated and stored. Asset ID: ${assetReference.id}. Use this assetId to embed it in an email or reply to the user.`,
  };

  if (imageData.revised_prompt && imageData.revised_prompt !== parsed.prompt) {
    result['revisedPrompt'] = imageData.revised_prompt;
    result['message'] = `${result['message']} Model revised the prompt: "${imageData.revised_prompt}"`;
  }

  return result;
};
