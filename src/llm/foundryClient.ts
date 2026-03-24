// Azure AI Foundry client — single provider-agnostic interface.
// Handles global frontier, EU DataZoneStandard, and BYOK OpenRouter paths.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0c-BYOK-External-LLM-Support.md

import { getModelRouting, getFallbackChain, type ModelRouting } from './modelRouter.js';
import { getBearerToken } from '../auth/identity.js';
import { getEnvConfig } from '../config/envConfig.js';
import { isModelDegraded, markModelDegraded, clearModelDegraded } from './modelCircuitBreaker.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Extract plain text from ChatMessage content (handles both string and ContentPart[] forms). */
export function textContent(content: string | ContentPart[] | undefined): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('');
}

export interface ChatCompletionChoice {
  message: ChatMessage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'function_call';
  index: number;
}

export interface ChatCompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  created: number;
}

export interface FoundryClientOptions {
  routing: ModelRouting;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
  correlationId?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Foundry client
// ---------------------------------------------------------------------------

export class FoundryClient {
  private routing: ModelRouting;
  private apiKey: string;
  private apiBase: string;

  constructor(routing?: ModelRouting) {
    this.routing = routing ?? getModelRouting();
    this.apiBase = this.routing.apiBase;

    // In production: token fetched via Managed Identity from Key Vault
    // For now, allow env-var override for local dev
    this.apiKey = process.env.AZURE_AI_FOUNDRY_API_KEY ?? 'placeholder-key';
  }

  /**
   * Send a chat completion request with automatic fallback on throttle/failure (#152).
   * Cascades through the fallback chain: primary → secondary → BYOK.
   * Degraded models are skipped for a cooldown period.
   */
  async chatCompletion(options: Omit<FoundryClientOptions, 'routing'>): Promise<ChatCompletionResponse> {
    const correlationId = options.correlationId ?? crypto.randomUUID();

    // Get the full fallback chain; the first entry is always the configured primary.
    const chain = getFallbackChain();

    // If the constructor was given an override deployment (e.g. /heavy → o4-mini),
    // prepend it so the override is tried first before falling through (#185).
    if (this.routing.deploymentName !== chain[0]?.deploymentName) {
      chain.unshift(this.routing);
    }

    // Filter out currently degraded models — but keep at least the last resort.
    const available = chain.filter((r) => !isModelDegraded(r.deploymentName));
    const candidates = available.length > 0 ? available : [chain[chain.length - 1]];

    let lastError: FoundryError | Error | undefined;

    for (let i = 0; i < candidates.length; i++) {
      const routing = candidates[i];
      try {
        const result = await this.callSingleModel(routing, options, correlationId);
        // Successful response — clear any degradation for this model.
        clearModelDegraded(routing.deploymentName);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRetryable = isRetryableError(err);

        if (isRetryable) {
          const reason = err instanceof FoundryError
            ? `HTTP ${err.statusCode}`
            : (err instanceof Error && err.name === 'TimeoutError') ? 'timeout' : 'error';
          markModelDegraded(routing.deploymentName, reason);

          trackEvent({
            name: 'LlmFallbackTriggered',
            correlationId,
            properties: {
              originalModel: routing.deploymentName,
              fallbackModel: candidates[i + 1]?.deploymentName ?? 'none',
              reason,
              chainPosition: i,
            },
          });
        }

        // If not retryable or this is the last candidate, throw
        if (!isRetryable || i === candidates.length - 1) {
          throw lastError;
        }
        // Otherwise continue to next candidate in chain
      }
    }

    // Should never reach here, but TypeScript requires it
    throw lastError ?? new Error('All models in fallback chain exhausted');
  }

  /**
   * Execute a single chat completion request against a specific model routing.
   */
  private async callSingleModel(
    routing: ModelRouting,
    options: Omit<FoundryClientOptions, 'routing'>,
    correlationId: string,
  ): Promise<ChatCompletionResponse> {
    const base = routing.apiBase.replace(/\/+$/, '');
    // GPT-5, GPT-4o, and o-series models require 2024-12-01-preview or later (#185, #219)
    const needsPreview = routing.isReasoning || needsNewTokenParam(routing.deploymentName);
    const apiVersion = needsPreview ? '2024-12-01-preview' : '2024-06-01';
    const url = `${base}/openai/deployments/${routing.deploymentName}/chat/completions?api-version=${apiVersion}`;

    // Reasoning models need longer timeouts (#128)
    const timeoutMs = routing.isReasoning ? 120_000 : 55_000;

    const body: Record<string, unknown> = {
      model: routing.deploymentName,
      messages: options.messages.map(mapOutgoingMessage),
      stream: false,
    };

    // GPT-5, GPT-4o, and o-series use max_completion_tokens; reasoning models also skip temperature (#185, #219)
    if (routing.isReasoning) {
      body.max_completion_tokens = options.maxTokens ?? 4096;
    } else if (needsNewTokenParam(routing.deploymentName)) {
      body.max_completion_tokens = options.maxTokens ?? 4096;
      body.temperature = options.temperature ?? 0.7;
    } else {
      body.max_tokens = options.maxTokens ?? 4096;
      body.temperature = options.temperature ?? 0.7;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice ?? 'auto';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
    };

    // Azure AI Foundry — use OBO token or MI token
    if (routing.laneName !== 'byok') {
      const oboToken = await this.getOboToken();
      headers['Authorization'] = `Bearer ${oboToken}`;
    } else {
      // OpenRouter — use API key directly
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['HTTP-Referer'] = 'https://helkinswarm.dev';
      headers['X-Title'] = 'HelkinSwarm';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new FoundryError(
        `Chat completion failed: ${response.status} ${response.statusText} — ${errorText}`,
        response.status,
        routing.deploymentName,
      );
    }

    const raw = await response.json() as RawApiResponse;
    return mapApiResponse(raw);
  }

  /**
   * Get an embeddings vector for the given text.
   */
  async getEmbedding(text: string): Promise<number[]> {
    const embeddingModel = this.routing.lane.embedding;
    const url = `${this.apiBase}/openai/deployments/${embeddingModel}/embeddings?api-version=2024-06-01`;

    const oboToken = await this.getOboToken();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${oboToken}`,
      },
      body: JSON.stringify({
        input: text,
        model: embeddingModel,
      }),
    });

    if (!response.ok) {
      throw new FoundryError(
        `Embedding failed: ${response.status} ${response.statusText}`,
        response.status,
        embeddingModel,
      );
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0]?.embedding ?? [];
  }

  /**
   * Acquire a Managed Identity access token for Azure Cognitive Services.
   * Uses the Container Apps / Azure Functions IMDS endpoint (IDENTITY_ENDPOINT +
   * IDENTITY_HEADER) with a per-process cache keyed on expiry.
   * Falls back to AZURE_FOUNDRY_OBO_TOKEN env var for local dev.
   */
  private async getOboToken(): Promise<string> {
    // Local dev override
    const devToken = getEnvConfig().azureFoundryOboToken;
    if (devToken) return devToken;

    return getBearerToken('https://cognitiveservices.azure.com/.default');
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class FoundryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly deploymentName: string,
  ) {
    super(message);
    this.name = 'FoundryError';
  }
}

// ---------------------------------------------------------------------------
// Model capability detection (#219)
// ---------------------------------------------------------------------------

/** Models that require `max_completion_tokens` instead of `max_tokens` (GPT-5, GPT-4o, o-series). */
export function needsNewTokenParam(deploymentName: string): boolean {
  const d = deploymentName.toLowerCase();
  return d.startsWith('gpt-5') || d.startsWith('gpt-4o') || d.startsWith('o');
}

// ---------------------------------------------------------------------------
// Retryable error detection (#152, #218)
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([404, 429, 500, 502, 503, 504]);

/** Determine if an error is retryable (throttle, timeout, server error). */
function isRetryableError(err: unknown): boolean {
  if (err instanceof FoundryError) {
    return RETRYABLE_STATUS_CODES.has(err.statusCode);
  }
  // AbortSignal.timeout() throws a DOMException with name "TimeoutError"
  if (err instanceof Error && err.name === 'TimeoutError') {
    return true;
  }
  // Network failures (fetch rejects on DNS/connection issues)
  if (err instanceof TypeError && err.message.includes('fetch')) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Raw API response types (snake_case — matches OpenAI wire format)
// ---------------------------------------------------------------------------

interface RawApiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface RawApiMessage {
  role: string;
  content: string | null;
  tool_calls?: RawApiToolCall[] | null;
  tool_call_id?: string;
}

interface RawApiChoice {
  message: RawApiMessage;
  finish_reason: string;
  index: number;
}

interface RawApiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface RawApiResponse {
  id: string;
  model: string;
  choices: RawApiChoice[];
  usage: RawApiUsage;
  created: number;
}

/**
 * Map outgoing camelCase ChatMessage to snake_case for the API.
 */
function mapOutgoingMessage(msg: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };
  if (msg.toolCallId) {
    out['tool_call_id'] = msg.toolCallId;
  }
  if (msg.name) {
    out['name'] = msg.name;
  }
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    out['tool_calls'] = msg.toolCalls.map((tc) => ({
      id: tc.id,
      type: tc.type,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
  }
  return out;
}

/**
 * Map the raw snake_case API response to our camelCase TypeScript types.
 */
function mapApiResponse(raw: RawApiResponse): ChatCompletionResponse {
  return {
    id: raw.id,
    model: raw.model,
    created: raw.created,
    usage: {
      promptTokens: raw.usage.prompt_tokens,
      completionTokens: raw.usage.completion_tokens,
      totalTokens: raw.usage.total_tokens,
    },
    choices: raw.choices.map((c) => ({
      index: c.index,
      finishReason: c.finish_reason as ChatCompletionChoice['finishReason'],
      message: {
        role: c.message.role as ChatMessage['role'],
        content: c.message.content ?? '',
        toolCallId: c.message.tool_call_id,
        toolCalls: c.message.tool_calls?.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

export function createFoundryClient(): FoundryClient {
  return new FoundryClient(getModelRouting());
}
