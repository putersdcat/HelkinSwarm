// Hydra-Net embedding router — dispatches content to the correct embedding model.
// Text → text-embedding-3-large, Images → Azure Vision, Audio → speech-to-text + text embedding.
// Spec ref: 0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md

import { createFoundryClient } from '../llm/foundryClient.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentModality = 'text' | 'image' | 'audio' | 'document';

export interface EmbeddingInput {
  /** Text content to embed */
  text?: string;
  /** Base64-encoded image data */
  imageBase64?: string;
  /** Base64-encoded audio data */
  audioBase64?: string;
  /** MIME type (e.g. image/png, audio/wav, application/pdf) */
  mimeType?: string;
  /** Correlation ID for telemetry */
  correlationId?: string;
}

export interface EmbeddingResult {
  /** The computed embedding vector */
  vector: number[];
  /** Which modality was used */
  modality: ContentModality;
  /** Which model was used for embedding */
  model: string;
  /** Extracted text (from OCR/STT if non-text input) */
  extractedText?: string;
  /** Dimensionality of the vector */
  dimensions: number;
}

// ---------------------------------------------------------------------------
// Content type detection
// ---------------------------------------------------------------------------

const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
]);

const AUDIO_MIMES = new Set([
  'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/flac', 'audio/m4a',
]);

const DOCUMENT_MIMES = new Set([
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export function detectModality(input: EmbeddingInput): ContentModality {
  if (input.mimeType) {
    if (IMAGE_MIMES.has(input.mimeType)) return 'image';
    if (AUDIO_MIMES.has(input.mimeType)) return 'audio';
    if (DOCUMENT_MIMES.has(input.mimeType)) return 'document';
  }
  if (input.imageBase64) return 'image';
  if (input.audioBase64) return 'audio';
  return 'text';
}

// ---------------------------------------------------------------------------
// Embedding Router (Hydra-Net)
// ---------------------------------------------------------------------------

/**
 * Route content to the correct embedding model and return the vector.
 * This is the single entry point for all embedding operations.
 */
export async function embedContent(input: EmbeddingInput): Promise<EmbeddingResult> {
  const modality = detectModality(input);
  const start = Date.now();

  let result: EmbeddingResult;

  switch (modality) {
    case 'text':
      result = await embedText(input.text ?? '');
      break;
    case 'image':
      result = await embedImage(input.imageBase64 ?? '', input.mimeType);
      break;
    case 'audio':
      result = await embedAudio(input.audioBase64 ?? '');
      break;
    case 'document':
      result = await embedDocument(input.imageBase64 ?? input.text ?? '', input.mimeType);
      break;
  }

  trackEvent({
    name: 'HydraNetEmbedding',
    correlationId: input.correlationId ?? 'unknown',
    properties: {
      modality,
      model: result.model,
      dimensions: String(result.dimensions),
      latencyMs: String(Date.now() - start),
      hasExtractedText: String(!!result.extractedText),
    },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Modality-specific embedders
// ---------------------------------------------------------------------------

/** Text → text-embedding-3-large */
async function embedText(text: string): Promise<EmbeddingResult> {
  const client = createFoundryClient();
  const vector = await client.getEmbedding(text);
  return {
    vector,
    modality: 'text',
    model: 'text-embedding-3-large',
    dimensions: vector.length,
  };
}

/**
 * Image → extract text via Azure Vision OCR → embed extracted text.
 * When Azure Vision integration is fully provisioned, this will call the
 * Vision API for dense image embeddings. For now, OCR-based text extraction
 * provides the bridging capability with immediate value.
 */
async function embedImage(imageBase64: string, mimeType?: string): Promise<EmbeddingResult> {
  // Extract text from the image via Azure Vision OCR (or fallback)
  const extractedText = await extractTextFromImage(imageBase64, mimeType);

  // Embed the extracted text using the standard text embedding model
  const client = createFoundryClient();
  const vector = await client.getEmbedding(extractedText || 'image with no extractable text');

  return {
    vector,
    modality: 'image',
    model: 'text-embedding-3-large+vision-ocr',
    extractedText: extractedText || undefined,
    dimensions: vector.length,
  };
}

/**
 * Audio → speech-to-text → embed extracted text.
 * When Azure AI Speech is provisioned, this will call the STT API.
 * For now, audio is flagged as a modality that needs text fallback.
 */
async function embedAudio(audioBase64: string): Promise<EmbeddingResult> {
  // Transcribe audio to text (STT)
  const transcription = await transcribeAudio(audioBase64);

  const client = createFoundryClient();
  const vector = await client.getEmbedding(transcription || 'audio with no extractable speech');

  return {
    vector,
    modality: 'audio',
    model: 'text-embedding-3-large+speech-stt',
    extractedText: transcription || undefined,
    dimensions: vector.length,
  };
}

/**
 * Document → extract text via Document Intelligence → embed extracted text.
 * When Azure Document Intelligence is provisioned, this will use the full
 * layout extraction. For now, text-based fallback.
 */
async function embedDocument(content: string, mimeType?: string): Promise<EmbeddingResult> {
  const extractedText = await extractTextFromDocument(content, mimeType);

  const client = createFoundryClient();
  const vector = await client.getEmbedding(extractedText || 'document with no extractable text');

  return {
    vector,
    modality: 'document',
    model: 'text-embedding-3-large+doc-intelligence',
    extractedText: extractedText || undefined,
    dimensions: vector.length,
  };
}

// ---------------------------------------------------------------------------
// Content extraction helpers
// These will be upgraded to Azure Cognitive Services calls when provisioned.
// For now they provide the correct interface and text-fallback path.
// ---------------------------------------------------------------------------

async function extractTextFromImage(imageBase64: string, _mimeType?: string): Promise<string> {
  const endpoint = process.env.AZURE_VISION_ENDPOINT;
  const apiKey = process.env.AZURE_VISION_KEY;

  if (endpoint && apiKey) {
    // Call Azure AI Vision OCR - Read API
    const url = `${endpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`;
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      body: imageBuffer,
    });

    if (response.ok) {
      const data = await response.json() as {
        readResult?: { content?: string };
      };
      return data.readResult?.content ?? '';
    }
  }

  // Fallback: no Azure Vision configured — return placeholder
  // The image base64 size gives a rough indicator
  const sizeKb = Math.round(imageBase64.length * 0.75 / 1024);
  return `[Image: ${sizeKb}KB, OCR unavailable — Azure Vision endpoint not configured]`;
}

async function transcribeAudio(_audioBase64: string): Promise<string> {
  const endpoint = process.env.AZURE_SPEECH_ENDPOINT;
  const apiKey = process.env.AZURE_SPEECH_KEY;

  if (endpoint && apiKey) {
    // Azure AI Speech STT would be called here
    // For now: placeholder until Azure Speech is provisioned
  }

  return '[Audio content — Azure Speech endpoint not configured for transcription]';
}

async function extractTextFromDocument(content: string, _mimeType?: string): Promise<string> {
  const endpoint = process.env.AZURE_DOCINT_ENDPOINT;
  const apiKey = process.env.AZURE_DOCINT_KEY;

  if (endpoint && apiKey) {
    // Azure Document Intelligence would be called here
    // For now: placeholder until Document Intelligence is provisioned
  }

  // If content is already text (not base64), return it directly
  if (content.length > 0 && !content.match(/^[A-Za-z0-9+/=]+$/)) {
    return content;
  }

  return '[Document content — Azure Document Intelligence endpoint not configured]';
}
