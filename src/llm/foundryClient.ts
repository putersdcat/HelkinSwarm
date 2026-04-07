// Azure AI Foundry client — single provider-agnostic interface.
// Handles the currently supported Azure global + EU paths.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0c-BYOK-External-LLM-Support.md

import { getFallbackChain, getModelCapacityProfile, getModelRouting, type ModelRouting } from './modelRouter.js';
import { getBearerToken } from '../auth/identity.js';
import { getEnvConfig } from '../config/envConfig.js';
import { isModelDegraded, markModelDegraded, clearModelDegraded } from './modelCircuitBreaker.js';
import { consumeForcedRetryableFailure } from './modelFailoverProof.js';
import { reportLlmSuccess, reportLlmFailure, registerModels, isAllModelsDown, isModelTrackedDown } from './llmHealthTracker.js';
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
  failoverSteps?: LlmFailoverStep[];
}

export interface LlmFailoverStep {
  fromModel: string;
  toModel: string;
  reason: string;
  statusCode?: number;
}

export interface FoundryClientOptions {
  routing: ModelRouting;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
  correlationId?: string;
  requestedTaskComplexity?: 'simple' | 'compound' | 'complex';
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const HTML_ERROR_SIGNAL_REGEX = /<!doctype html|<html\b|<head\b|<body\b|<script\b|<style\b|window\.dataLayer|gtag\(|:root\s*\{|<title\b/i;

/**
 * Sanitize remote/provider error text before it reaches logs or user-visible messages.
 * Collapses HTML/JS/CSS page bodies into a short human-readable summary (#286).
 */
export function sanitizeRemoteErrorText(rawErrorText: string, maxLength = 500): string {
  const raw = rawErrorText.replace(/\u0000/g, ' ').trim();
  if (!raw) {
    return 'unknown';
  }

  const looksLikeHtml = HTML_ERROR_SIGNAL_REGEX.test(raw);
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) {
    return 'unknown';
  }

  if (looksLikeHtml) {
    const prefix = stripped
      .split(/window\.dataLayer|gtag\(|:root\s*\{/i)[0]
      ?.replace(/\|/g, ' ')
      .trim();
    if (prefix) {
      return `${prefix} (remote provider returned an HTML error page; body omitted)`.slice(0, maxLength);
    }
    return 'remote provider returned an HTML error page (body omitted)';
  }

  return stripped.slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Foundry client
// ---------------------------------------------------------------------------

/**
 * Total milliseconds allowed for the entire fallback cascade per request (#313).
 * Prevents N×55s = 220s silent cascade.  Individual per-model timeouts are
 * reduced dynamically to stay within this budget.
 */
const FALLBACK_BUDGET_MS = 90_000;

/** Minimum per-model timeout — never go below this even when budget is tight. */
const MIN_PER_MODEL_TIMEOUT_MS = 8_000;

/** Embedding requests must be bounded too; prompt-building memory recall depends on them. */
const EMBEDDING_TIMEOUT_MS = 10_000;

/**
 * Parse a `retry-after` header value (seconds) or `retry-after-ms` (milliseconds)
 * from an HTTP Response.  Returns milliseconds, or undefined if not present / invalid.
 * Per Microsoft docs, Azure AI Foundry returns both headers on 429 responses.
 */
export function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfterMs = headers.get('retry-after-ms');
  if (retryAfterMs) {
    const ms = Number(retryAfterMs);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  }
  return undefined;
}

/**
 * Hard timeout wrapper for fetch.
 * We cannot trust runtime-specific `AbortSignal.timeout()` behavior in Azure Functions,
 * so we both abort the request AND locally reject the await path when the timer fires.
 * This guarantees the caller sees a `TimeoutError` and can continue the fallback chain.
 */
export async function fetchWithHardTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const timeoutError = new Error(`Fetch timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      const timeoutError = new Error(`Fetch timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class FoundryClient {
  private routing: ModelRouting;
  private apiBase: string;

  constructor(routing?: ModelRouting) {
    this.routing = routing ?? getModelRouting();
    this.apiBase = this.routing.apiBase;
  }

  /**
   * Send a chat completion request with automatic fallback on throttle/failure (#152, #313).
   *
   * Design follows Microsoft's documented Azure AI Foundry patterns:
   * - 429 responses are INSTANT — parse Retry-After, mark degraded, immediately try next model.
   * - Timeouts are expensive — reduce per-model timeout as budget shrinks.
   * - Total cascade is capped at FALLBACK_BUDGET_MS (90s) to prevent silent 4×55s = 220s.
   * - Models are re-checked for degradation before each attempt (not just at chain start).
   */
  async chatCompletion(options: Omit<FoundryClientOptions, 'routing'>): Promise<ChatCompletionResponse> {
    const correlationId = options.correlationId ?? crypto.randomUUID();

    // Get the full fallback chain for the requested deployment.
    const chain = getFallbackChain(this.routing.deploymentName, {
      requestedTaskComplexity: options.requestedTaskComplexity,
    });

    // Register models with the health tracker so it knows the full set (#325).
    registerModels(chain.map(r => r.deploymentName));

    // Circuit-open fast-fail: if ALL models in the chain are down, don't waste
    // 90 seconds cascading through guaranteed failures (#325).
    if (isAllModelsDown()) {
      throw new FoundryAllModelsDownError(chain.map(r => r.deploymentName));
    }

    let lastError: FoundryError | Error | undefined;
    const failoverSteps: LlmFailoverStep[] = [];
    const attemptedModels: string[] = [];
    const budgetStart = Date.now();

    for (let i = 0; i < chain.length; i++) {
      const routing = chain[i];

      // Re-check degraded status before EACH attempt — catches models degraded
      // by concurrent requests during the cascade (#313-B).
      if (isModelDegraded(routing.deploymentName) || isModelTrackedDown(routing.deploymentName)) {
        // Skip silently; don't count as an "attempt" or waste budget.
        continue;
      }

      // Budget accounting: how much time remains for the rest of the cascade?
      const elapsed = Date.now() - budgetStart;
      const remaining = FALLBACK_BUDGET_MS - elapsed;
      if (remaining <= MIN_PER_MODEL_TIMEOUT_MS) {
        // Budget exhausted — break out and throw.
        break;
      }

      // Dynamic per-model timeout: base timeout clamped to remaining budget (#313-A).
      const baseTimeout = routing.isReasoning ? 120_000 : 55_000;
      const perModelTimeout = Math.max(MIN_PER_MODEL_TIMEOUT_MS, Math.min(baseTimeout, remaining));

      attemptedModels.push(routing.deploymentName);
      try {
        const forcedFailure = consumeForcedRetryableFailure(routing.deploymentName);
        if (forcedFailure) {
          trackEvent({
            name: 'PolicyOverrideApplied',
            correlationId,
            properties: {
              authority: 'devloop-model-failover-proof',
              deploymentName: routing.deploymentName,
              statusCode: forcedFailure.statusCode,
              reason: forcedFailure.reason,
              remainingAttempts: forcedFailure.remainingAttempts,
            },
          });

          throw new FoundryError(
            `Synthetic proof failure injected: ${forcedFailure.reason}`,
            forcedFailure.statusCode,
            routing.deploymentName,
          );
        }

        const result = await this.callSingleModel(routing, options, correlationId, perModelTimeout);
        // Successful response — clear any degradation for this model.
        clearModelDegraded(routing.deploymentName);
        reportLlmSuccess(routing.deploymentName);
        if (failoverSteps.length > 0) {
          result.model = routing.deploymentName;
          result.failoverSteps = [...failoverSteps];
          // Emit chain-level summary telemetry (#313-D)
          trackEvent({
            name: 'LlmFallbackChainCompleted',
            correlationId,
            properties: {
              originalModel: attemptedModels[0],
              finalModel: routing.deploymentName,
              totalAttempts: attemptedModels.length,
              totalElapsedMs: Date.now() - budgetStart,
              failoverSteps: failoverSteps.map(s => `${s.fromModel}→${s.toModel}(${s.reason})`).join(', '),
            },
          });
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRetryable = isRetryableError(err);
        reportLlmFailure(routing.deploymentName);

        if (isRetryable) {
          const reason = err instanceof FoundryError
            ? `HTTP ${err.statusCode}`
            : (err instanceof Error && err.name === 'TimeoutError') ? 'timeout' : 'error';

          // For 429: use Retry-After header from the response if available (#313).
          // This aligns with Microsoft's documented Azure AI Foundry behavior —
          // the response includes retry-after / retry-after-ms headers.
          const retryAfterCooldown = (err instanceof FoundryError && err.retryAfterMs)
            ? err.retryAfterMs
            : undefined;
          markModelDegraded(routing.deploymentName, reason, retryAfterCooldown);

          // Find the next non-degraded candidate for the failover step log.
          const nextCandidate = chain.slice(i + 1).find((r) =>
            !isModelDegraded(r.deploymentName) && !isModelTrackedDown(r.deploymentName),
          );
          if (nextCandidate) {
            failoverSteps.push({
              fromModel: routing.deploymentName,
              toModel: nextCandidate.deploymentName,
              reason,
              statusCode: err instanceof FoundryError ? err.statusCode : undefined,
            });
          }

          trackEvent({
            name: 'LlmFallbackTriggered',
            correlationId,
            properties: {
              originalModel: routing.deploymentName,
              fallbackModel: nextCandidate?.deploymentName ?? 'none',
              reason,
              chainPosition: i,
              elapsedMs: Date.now() - budgetStart,
              ...(retryAfterCooldown !== undefined && { retryAfterMs: retryAfterCooldown }),
            },
          });
        }

        // If not retryable, throw immediately — no point cascading on 400/401/etc.
        if (!isRetryable) {
          throw lastError;
        }
        // Otherwise continue to next candidate in chain
      }
    }

    // All candidates exhausted or budget spent.
    throw new FoundryFallbackExhaustedError(
      attemptedModels,
      failoverSteps,
      lastError ?? new Error('All models in fallback chain exhausted or budget spent'),
    );
  }

  /**
   * Execute a single chat completion request against a specific model routing.
   * The timeout is provided by the caller (dynamic budget-aware timeout from #313).
   */
  private async callSingleModel(
    routing: ModelRouting,
    options: Omit<FoundryClientOptions, 'routing'>,
    correlationId: string,
    timeoutMs: number,
  ): Promise<ChatCompletionResponse> {
    if (routing.usesObo === false) {
      throw new FoundryError(
        'OpenRouter / BYOK external LLM routing is currently disabled in this deployment',
        501,
        routing.deploymentName,
      );
    }

    const base = routing.apiBase.replace(/\/+$/, '');
    // GPT-5, GPT-4o, and o-series models require 2024-12-01-preview or later (#185, #219)
    const needsPreview = routing.isReasoning || needsNewTokenParam(routing.deploymentName);
    const apiVersion = needsPreview ? '2024-12-01-preview' : '2024-06-01';
    const url = `${base}/openai/deployments/${routing.deploymentName}/chat/completions?api-version=${apiVersion}`;

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

    const oboToken = await this.getOboToken();
    headers['Authorization'] = `Bearer ${oboToken}`;

    // Guard both the connection AND the body read with a single AbortController.
    // fetchWithHardTimeout clears its timer once fetch() returns a Response, leaving
    // response.json() unguarded.  A model that sends headers immediately but takes
    // minutes to flush the JSON body would hang indefinitely without this wrapper.
    const controller = new AbortController();
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        controller.abort();
        const err = new Error(`LLM call timed out after ${timeoutMs}ms (fetch + body read)`);
        err.name = 'TimeoutError';
        reject(err);
      }, timeoutMs);
    });

    let raw: RawApiResponse;
    try {
      raw = await Promise.race([
        (async () => {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const rawErrorText = await response.text().catch(() => 'unknown');
            const errorText = sanitizeRemoteErrorText(rawErrorText);
            const retryAfterMs = response.status === 429
              ? parseRetryAfterMs(response.headers)
              : undefined;
            throw new FoundryError(
              `Chat completion failed: ${response.status} ${response.statusText} — ${errorText}`,
              response.status,
              routing.deploymentName,
              retryAfterMs,
            );
          }

          return await response.json() as RawApiResponse;
        })(),
        timeoutPromise,
      ]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        const te = new Error(`LLM call timed out after ${timeoutMs}ms`);
        te.name = 'TimeoutError';
        throw te;
      }
      throw err;
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    }

    return mapApiResponse(raw);
  }

  /**
   * Get an embeddings vector for the given text.
   */
  async getEmbedding(text: string): Promise<number[]> {
    const embeddingModel = this.routing.lane.embedding;
    const url = `${this.apiBase}/openai/deployments/${embeddingModel}/embeddings?api-version=2024-06-01`;

    const oboToken = await this.getOboToken();

    const response = await fetchWithHardTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${oboToken}`,
      },
      body: JSON.stringify({
        input: text,
        model: embeddingModel,
      }),
    }, EMBEDDING_TIMEOUT_MS);

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
    /** Parsed Retry-After value in ms from 429 response headers (Azure AI Foundry, #313). */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'FoundryError';
  }
}

export class FoundryFallbackExhaustedError extends Error {
  constructor(
    public readonly attemptedModels: string[],
    public readonly failoverSteps: LlmFailoverStep[],
    public readonly lastError: Error,
  ) {
    super(`All models in fallback chain exhausted after attempts: ${attemptedModels.join(' -> ')}`);
    this.name = 'FoundryFallbackExhaustedError';
  }
}

/**
 * Thrown when the circuit-open fast-fail detects ALL models are down before attempting any calls.
 * This avoids wasting 90s cascading through guaranteed failures (#325).
 */
export class FoundryAllModelsDownError extends Error {
  constructor(public readonly knownModels: string[]) {
    super(`All ${knownModels.length} models are currently unreachable — circuit open. No request attempted.`);
    this.name = 'FoundryAllModelsDownError';
  }
}

export function buildSuccessfulFailoverNotices(failoverSteps: readonly LlmFailoverStep[] | undefined): string[] {
  if (!failoverSteps || failoverSteps.length === 0) {
    return [];
  }

  const first = failoverSteps[0];
  const final = failoverSteps[failoverSteps.length - 1];
  const quotaIssue = failoverSteps.some((step) => step.statusCode === 429);
  const firstCapacity = getModelCapacityProfile(first.fromModel);
  const finalCapacity = getModelCapacityProfile(final.toModel);
  const lowCapacityDowngrade = firstCapacity.capacityLevel !== 'low' && finalCapacity.capacityLevel === 'low';
  const notices: string[] = [];

  if (quotaIssue) {
    notices.push(
      `⚠️ Operational note: ${first.fromModel} hit a 429 quota/rate limit; auto-failed over to ${final.toModel} and continued your request.`,
    );
  } else {
    notices.push(
      `⚠️ Operational note: ${first.fromModel} was temporarily unavailable (${first.reason}); auto-failed over to ${final.toModel} and continued your request.`,
    );
  }

  if (lowCapacityDowngrade) {
    notices.push(
      `⚠️ Cognitive state note: this reply completed on ${final.toModel}, which is a low-capacity impaired lane for heavy reasoning. Treat it as degraded continuity and retry /heavy later if you need full-capacity reasoning.`,
    );
  }

  return notices;
}

export function buildLlmFailureNotice(err: unknown): string {
  if (err instanceof FoundryAllModelsDownError) {
    return '⚠️ All AI models are currently unreachable. Your message cannot be processed right now. The system will auto-recover when models come back online.';
  }

  if (err instanceof FoundryFallbackExhaustedError) {
    const quotaIssue = err.failoverSteps.some((step) => step.statusCode === 429)
      || (err.lastError instanceof FoundryError && err.lastError.statusCode === 429);
    const firstModel = err.attemptedModels[0] ?? 'the active model';

    if (quotaIssue) {
      return `⚠️ Operational note: ${firstModel} hit a 429 quota/rate limit and automatic fallback recovery is temporarily exhausted. Please retry in a minute while capacity recovers.`;
    }

    return '⚠️ Operational note: the active model service is temporarily unavailable and automatic fallback recovery could not complete. Please retry in a minute.';
  }

  if (err instanceof FoundryError) {
    if (err.statusCode === 429) {
      return `⚠️ Operational note: ${err.deploymentName} hit a 429 quota/rate limit and no alternate model was available for automatic recovery. Please retry in a minute.`;
    }

    if (isRetryableError(err)) {
      return `⚠️ Operational note: ${err.deploymentName} is temporarily unavailable (${err.statusCode}). Automatic recovery could not complete just now; please retry in a minute.`;
    }

    return '⚠️ Operational note: the model provider returned an unexpected error. Please retry in a minute.';
  }

  if (err instanceof Error && err.name === 'TimeoutError') {
    return '⚠️ Operational note: the model request timed out and automatic recovery could not complete just now. Please retry in a minute.';
  }

  return '⚠️ Operational note: the model request failed and automatic recovery could not complete just now. Please retry in a minute.';
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
