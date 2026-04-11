// Image generation skill handler — text-to-image via OpenRouter.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #241
//
// Backend: OpenRouter chat completions with modalities:["image","text"]
// Endpoint: https://openrouter.ai/api/v1/chat/completions
// Auth: OPENROUTER_API_KEY bearer token
// Model: openai/gpt-5-image-mini by default, override via IMAGE_MODEL env var
// Output: base64 data URL extracted → decoded → persisted to runtime-asset blob via runtimeAssetStore

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { persistRuntimeAsset } from '../../src/integrations/runtimeAssetStore.js';
import { getEnvConfig } from '../../src/config/envConfig.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENROUTER_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_IMAGE_MODEL = 'openai/gpt-5-image-mini';

// ---------------------------------------------------------------------------
// Zod schemas for API response validation at boundary
// ---------------------------------------------------------------------------

const ImageMessageSchema = z.object({
  role: z.string(),
  content: z.string().nullable().optional(),
  images: z.array(
    z.object({
      image_url: z.object({
        url: z.string().min(1),
      }),
    }),
  ).optional(),
}).passthrough();

const ImageChoiceSchema = z.object({
  message: ImageMessageSchema,
}).passthrough();

const OpenRouterImageResponseSchema = z.object({
  id: z.string().optional(),
  choices: z.array(ImageChoiceSchema).min(1),
  model: z.string().optional(),
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

export function extractBase64FromDataUrl(dataUrl: string): { bytes: Uint8Array<ArrayBuffer>; mimeType: string } {
  const semicolonIdx = dataUrl.indexOf(';');
  const colonIdx = dataUrl.indexOf(':');
  const mimeType = dataUrl.slice(colonIdx + 1, semicolonIdx);
  const base64Data = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const buf = Buffer.from(base64Data, 'base64');
  // Copy to a clean ArrayBuffer to satisfy strict Uint8Array<ArrayBuffer> typing
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { bytes: new Uint8Array(ab), mimeType };
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
  if (!config.openrouterApiKey) {
    throw new Error(
      'Image generation requires OPENROUTER_API_KEY to be configured. '
      + 'Add the key to Key Vault and ensure the Function App reads it.',
    );
  }

  const model = process.env['IMAGE_MODEL'] ?? DEFAULT_IMAGE_MODEL;
  const correlationId = parsed.correlationId ?? `img-${Date.now()}`;

  const requestBody = {
    model,
    messages: [
      {
        role: 'user' as const,
        content: parsed.prompt,
      },
    ],
    modalities: ['image', 'text'],
  };

  const response = await fetch(OPENROUTER_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'X-OpenRouter-Title': 'HelkinSwarm',
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
  const parsedResponse = OpenRouterImageResponseSchema.parse(rawJson);
  const choice = parsedResponse.choices[0];

  if (!choice) {
    throw new Error('Image generation API returned no choices.');
  }

  const images = choice.message.images;
  if (!images || images.length === 0) {
    throw new Error(
      'Image generation API returned no images in the response. '
      + `Model used: ${model}. Text content: ${choice.message.content ?? '(none)'}`,
    );
  }

  const imageUrl = images[0]?.image_url.url;
  if (!imageUrl) {
    throw new Error('Image generation API returned an image with no URL.');
  }

  // Extract base64 bytes from the data URL
  const { bytes: imageBytes, mimeType } = extractBase64FromDataUrl(imageUrl);
  const ext = mimeType.split('/')[1] ?? 'png';
  const modelSlug = model.replace(/[^a-z0-9-]/gi, '-');
  const corrShort = correlationId.slice(0, 8);
  const fileName = `${modelSlug}-${corrShort}.${ext}`;

  const assetReference = await persistRuntimeAsset({
    userId: parsed.userId,
    correlationId,
    contentType: mimeType,
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

  return {
    assetId: assetReference.id,
    model: parsedResponse.model ?? model,
    fileName: assetReference.fileName ?? fileName,
    contentType: mimeType,
    message: `Image generated and stored. Asset ID: ${assetReference.id}. Use this assetId to embed it in an email or reply to the user.`,
  };
};
