# HelkinSwarm Project Specification — Addendum Series

## ADDENDA-07. Hydra-Net Multimodal Embedding Router

**Version:** 1.0  
**Date:** March 2026  
**Status:** Implementation spec  
**References:** Doc `0k` (Multimodal Embedding Hydra-Net), doc `0i` (Skill-Specific Memory), doc `0b` (Model Profiles), issue #69

---

## 1. Purpose

Doc `0k` describes the vision for a multi-modal embedding layer that ingests text, images, PDFs, screenshots, and voice — routing each through the correct embedding model. This addendum specifies the exact implementation of the **Hydra-Net Embedding Router** (`src/memory/embeddingRouter.ts`), the `multimodalMemory` container schema, the `embedContent()` API, and the integration points with the rest of the system.

The current codebase has a **partially implemented** embedding router with correct interfaces and text-fallback stubs for Azure Vision, Azure AI Speech, and Azure Document Intelligence. These stubs return text-fallback embeddings until the Azure services are provisioned. The architecture is designed so that upgrading from text-fallback to full multimodal embeddings requires only adding the Azure SDK calls — no interface changes.

---

## 2. Architecture

```
Content Input (text | imageBase64 | audioBase64 | document)
  │
  ▼
detectModality(input) → 'text' | 'image' | 'audio' | 'document'
  │
  ├─► 'text'     → embedText()     → FoundryClient.getEmbedding()
  │                          └─► text-embedding-3-large
  │
  ├─► 'image'    → embedImage()    → extractTextFromImage() → getEmbedding()
  │                          └─► Azure Vision OCR (stub) → text-embedding-3-large
  │
  ├─► 'audio'    → embedAudio()    → transcribeAudio() → getEmbedding()
  │                          └─► Azure AI Speech STT (stub) → text-embedding-3-large
  │
  └─► 'document' → embedDocument() → extractTextFromDocument() → getEmbedding()
                               └─► Azure Document Intelligence (stub) → text-embedding-3-large

  │
  ▼
EmbeddingResult { vector, modality, model, extractedText, dimensions }
  │
  ├─► MemoryManager.store() — persisted to multimodalMemory container
  ├─► App Insights — HydraNetEmbedding event
  └─► HydraNetContext — injected into LLM system prompt
```

---

## 3. Content Modality Detection

```typescript
// filepath: src/memory/embeddingRouter.ts

export type ContentModality = 'text' | 'image' | 'audio' | 'document';

const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'image/bmp', 'image/tiff',
]);

const AUDIO_MIMES = new Set([
  'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/webm',
  'audio/flac', 'audio/m4a',
]);

const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
```

---

## 4. The embedContent() API

```typescript
// filepath: src/memory/embeddingRouter.ts

export interface EmbeddingInput {
  /** Text content to embed */
  text?: string;
  /** Base64-encoded image data */
  imageBase64?: string;
  /** Base64-encoded audio data */
  audioBase64?: string;
  /** MIME type (e.g. image/png, audio/wav, application/pdf) */
  mimeType?: string;
  /** Correlation ID for App Insights telemetry */
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

/**
 * Single entry point for all embedding operations.
 * Routes to the correct modality-specific embedder.
 */
export async function embedContent(input: EmbeddingInput): Promise<EmbeddingResult> {
  const modality = detectModality(input);
  // ... dispatches to text|image|audio|document embedder
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
```

---

## 5. Modality-Specific Embedders

### 5.1 Text Embedding

```typescript
// filepath: src/memory/embeddingRouter.ts
// Text → text-embedding-3-large via FoundryClient

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
```

### 5.2 Image Embedding (Azure Vision OCR)

```typescript
// filepath: src/memory/embeddingRouter.ts
// Image → Azure Vision OCR → extract text → text-embedding-3-large

async function embedImage(imageBase64: string, mimeType?: string): Promise<EmbeddingResult> {
  // Extract text from the image via Azure Vision OCR
  const extractedText = await extractTextFromImage(imageBase64, mimeType);
  // Fall back to text embedding of a placeholder if OCR returns nothing
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

async function extractTextFromImage(imageBase64: string, _mimeType?: string): Promise<string> {
  const endpoint = process.env.AZURE_VISION_ENDPOINT;
  const apiKey = process.env.AZURE_VISION_KEY;

  // Stub: returns empty string until Azure Vision is provisioned
  if (!endpoint || !apiKey) {
    return '';  // Will result in 'image with no extractable text' embedding
  }

  // When provisioned: call Azure Computer Vision OCR API
  // POST {endpoint}/vision/v3.2/read/analyze
  // Body: { url: `data:${mimeType};base64,${imageBase64}` }
  // Returns: operationLocation → poll → readResult[0].lines[].text
  throw new Error('Azure Vision integration not yet implemented');
}
```

**Env vars required when Azure Vision is provisioned:**
```
AZURE_VISION_ENDPOINT=https://{resource}.cognitiveservices.azure.com/
AZURE_VISION_KEY={api-key}
```

### 5.3 Audio Embedding (Azure AI Speech STT)

```typescript
// filepath: src/memory/embeddingRouter.ts
// Audio → Azure AI Speech STT → transcription text → text-embedding-3-large

async function embedAudio(audioBase64: string): Promise<EmbeddingResult> {
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

async function transcribeAudio(audioBase64: string): Promise<string> {
  const speechKey = process.env.AZURE_SPEECH_KEY;
  const speechRegion = process.env.AZURE_SPEECH_REGION;

  // Stub: returns empty string until Azure AI Speech is provisioned
  if (!speechKey || !speechRegion) {
    return '';
  }

  // When provisioned: call Azure AI Speech REST API
  // POST https://{region}.api.cognitive.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
  // Headers: Ocp-Apim-Subscription-Key: {speechKey}
  // Body: binary audio
  // Returns: JSON { DisplayText: "..." }
  throw new Error('Azure AI Speech integration not yet implemented');
}
```

**Env vars required when Azure AI Speech is provisioned:**
```
AZURE_SPEECH_KEY={api-key}
AZURE_SPEECH_REGION={region e.g. eastus2}
```

### 5.4 Document Embedding (Azure Document Intelligence)

```typescript
// filepath: src/memory/embeddingRouter.ts
// Document (PDF/Word/Excel) → Document Intelligence → text → text-embedding-3-large

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

async function extractTextFromDocument(content: string, _mimeType?: string): Promise<string> {
  const endpoint = process.env.AZURE_DOC_INT_ENDPOINT;
  const apiKey = process.env.AZURE_DOC_INT_KEY;

  // Stub: returns empty string until Document Intelligence is provisioned
  if (!endpoint || !apiKey) {
    return '';
  }

  // When provisioned: call Azure Document Intelligence Read API
  // POST {endpoint}/formrecognizer/v3.2/read/analyze
  // Body: binary document
  // Returns: operationLocation → poll → readResult[0].lines[].content
  throw new Error('Azure Document Intelligence integration not yet implemented');
}
```

**Env vars required when Document Intelligence is provisioned:**
```
AZURE_DOC_INT_ENDPOINT=https://{resource}.cognitiveservices.azure.com/
AZURE_DOC_INT_KEY={api-key}
```

---

## 6. multimodalMemory Container

The `multimodalMemory` container stores all memory entries with their vectors. It is partitioned by `userId` to enable efficient per-user queries. Each entry can hold a single vector plus modality metadata.

```typescript
// filepath: src/memory/memoryManager.ts

const MEMORY_CONTAINER = 'multimodalMemory';

export const MemoryEntrySchema = z.object({
  id: z.string(),                    // UUID v4
  userId: z.string(),               // Partition key
  content: z.string(),               // Text content (extracted text for non-text modalities)
  skillId: z.string().optional(),    // Optional skill scoping
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
  vector: z.array(z.number()).optional(),  // The embedding vector
  modality: z.enum(['text', 'image', 'audio', 'document']).default('text'),
  createdAt: z.string(),             // ISO 8601
  ttl: z.number().optional(),        // 365 days default
});
```

**Cosmos DB Vector Search:**
```typescript
// VectorDistance() for cosine similarity — 0 = identical, higher = more distant
const querySpec = {
  query: `SELECT TOP @topK c.content, c.skillId, c.tags, c.createdAt,
                  VectorDistance(c.vector, @queryVector) AS score
           FROM c WHERE c.userId = @userId ${skillFilter}
           ORDER BY VectorDistance(c.vector, @queryVector)`,
};
```

**DiskANN Index:** The container uses Azure Cosmos DB's built-in vector indexing with DiskANN for approximate nearest-neighbor search at scale. The index is configured with `vectorDIMENSION` matching the embedding model output (1536 dimensions for `text-embedding-3-large`).

---

## 7. Just-in-Time Injection into Prompts

The `promptBuilder.ts` receives `HydraNetContext` and injects a summary into the LLM system prompt:

```typescript
// filepath: src/llm/promptBuilder.ts

export interface HydraNetContext {
  activeEmbeddingLatencyMs: number;
  totalVectors: number;
  vectorsPerSkill: Record<string, number>;
}

// In buildPromptInput — hydraNetContext is optional
const systemContent = `...`;
if (input.hydraNetContext) {
  const skillCounts = Object.entries(hn.vectorsPerSkill)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
  systemContent += `\n\n## Hydra-Net Context
Embedding latency: ${hn.activeEmbeddingLatencyMs}ms | Total vectors: ${hn.totalVectors} | Per-skill: ${skillCounts}`;
}
```

This allows the LLM to reason about its own resource consumption without exposing raw timing data.

---

## 8. EU Residency Toggle

The EU toggle in `envConfig.ts` (`EU_RESIDENCY_MODE`) switches the **LLM lane** but does **not** currently switch embedding models. This is intentional — `text-embedding-3-large` is the only production-grade embedding available in both global and EU deployments. When a EU-native embedding model becomes available, it should be added to `EU_LANE` in `modelRouter.ts`:

```typescript
// filepath: src/llm/modelRouter.ts

const EU_LANE: ModelLane = {
  primary: 'grok-4-1-fast-reasoning',
  secondary: 'grok-4-1-fast-non-reasoning',
  // text-embedding-3-large is GlobalStandard — no DZ embedding exists yet
  embedding: 'text-embedding-3-large',
  reasoning: 'grok-4-1-fast-reasoning',
  // vision: 'gpt-5.4-mini', // EU-native vision model when available
};
```

Image, audio, and document embeddings (when fully provisioned) will also use Azure services that support EU regional endpoints. All Azure Cognitive Services can be deployed to EU regions.

---

## 9. Content Safety Integration

All image, audio, and document content is run through Azure Content Safety **before** embedding:

```typescript
// filepath: src/memory/embeddingRouter.ts
// Called at the top of embedImage(), embedAudio(), embedDocument()

async function safetyCheck(contentBase64: string, modality: ContentModality): Promise<boolean> {
  const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const apiKey = process.env.AZURE_CONTENT_SAFETY_KEY;
  if (!endpoint || !apiKey) return true; // Skip if not provisioned

  // POST {endpoint}/contentsafety/text:detect?api-version=2024-09-01
  // For image: base64 in request body with contentType: ImageBase64
  // Returns: { categoriesAnalysis: [{ category, severity }] }
  // Block if any severity >= 2
  throw new Error('Content Safety integration not yet implemented');
}
```

---

## 10. MemoryManager Integration

```typescript
// filepath: src/memory/memoryManager.ts

export interface StoreOptions {
  content: string;
  skillId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** Optional pre-computed embedding vector (from embedContent) */
  vector?: number[];
}

/**
 * Store a memory entry with its embedding vector.
 * Uses embedContent() internally when no vector is provided.
 */
async function store(options: StoreOptions): Promise<string> {
  let vector = options.vector;
  if (!vector) {
    const result = await embedContent({ text: options.content });
    vector = result.vector;
  }
  // Persist to multimodalMemory container
  await container.items.upsert({ id, userId, vector, modality: detectModality(options), ... });
}
```

---

## 11. App Insights Events

| Event Name | When | Key Properties |
|------------|------|----------------|
| `HydraNetEmbedding` | Every embedContent() call | `modality`, `model`, `dimensions`, `latencyMs`, `hasExtractedText`, `correlationId` |
| `ContentSafetyBlocked` | Content rejected by safety check | `modality`, `correlationId` |
| `EmbeddingFailed` | embedContent throws | `modality`, `error`, `correlationId` |
| `MemoryStored` | Entry written to multimodalMemory | `modality`, `skillId`, `vectorDimensions` |

---

## 12. Acceptance Criteria

- [ ] `embedContent({ text })` returns a vector via `text-embedding-3-large` — verified
- [ ] `embedContent({ imageBase64, mimeType })` detects `modality: 'image'` — stub returns text-fallback
- [ ] `embedContent({ audioBase64 })` detects `modality: 'audio'` — stub returns text-fallback
- [ ] `embedContent({ text, mimeType: 'application/pdf' })` detects `modality: 'document'` — stub returns text-fallback
- [ ] `HydraNetEmbedding` App Insights event fires on every call
- [ ] `detectModality()` correctly classifies all MIME types from `embeddingRouter.ts`
- [ ] MemoryManager stores entries with vector + modality to `multimodalMemory` container
- [ ] Vector search via `VectorDistance()` returns ranked results in `MemoryManager.recall()`
- [ ] `HydraNetContext` is injected into LLM system prompt via `promptBuilder.ts`
- [ ] EU toggle does not break embedding (same model used globally + EU)
- [ ] Azure Vision OCR upgrade path: replace stub with SDK call, no interface change
- [ ] Azure AI Speech STT upgrade path: replace stub with SDK call, no interface change
- [ ] Azure Document Intelligence upgrade path: replace stub with SDK call, no interface change
- [ ] Content Safety blocks unsafe image/audio before embedding
- [ ] E2E: paste screenshot of calendar invite → stored with 'image' modality + extracted text
- [ ] E2E: voice note → stored with 'audio' modality + transcription
