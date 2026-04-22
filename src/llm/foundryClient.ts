// Azure AI Foundry client — single provider-agnostic interface.
// Handles the currently supported Azure global + EU paths.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0c-BYOK-External-LLM-Support.md

import * as https from 'node:https';
import { getFallbackChain, getModelCapacityProfile, getModelRouting, type ModelRouting } from './modelRouter.js';
import { getBearerToken } from '../auth/identity.js';
import { getEnvConfig } from '../config/envConfig.js';
import { isModelDegraded, markModelDegraded, clearModelDegraded, syncSharedDegradedModels } from './modelCircuitBreaker.js';
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
  providerCost?: number;
  providerCostUnit?: 'credits';
  providerCostDetails?: Record<string, number>;
  /** OpenRouter server-tool usage — e.g. { webSearchRequests: 2 } (#650) */
  serverToolUse?: { webSearchRequests?: number };
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
  /**
   * Override the fallback cascade budget for this specific call (#591).
   * Sub-agents should pass a shorter budget (e.g. 30_000) to fail fast instead
   * of consuming the full 90s main-orchestrator budget.
   */
  maxBudgetMs?: number;
  /**
   * When provided, activates SSE streaming mode and calls this callback with each
   * content token delta as it arrives in the response (#637 Phase 1).
   * The return value of chatCompletion() is the same ChatCompletionResponse whether
   * or not streaming is enabled — usage stats are synthesized from the SSE stream.
   */
  onToken?: (text: string) => void;
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
  const raw = rawErrorText.replaceAll('\0', ' ').trim();
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

// ---------------------------------------------------------------------------
// Testable seam for https.request (unit tests only) — never mutate in production
// ---------------------------------------------------------------------------
type HttpsRequester = typeof https.request;
let _requesterImpl: HttpsRequester = https.request;

/** @internal Unit-test seam — override the https.request implementation. */
export function _setRequester(fn: HttpsRequester): void { _requesterImpl = fn; }
/** @internal Unit-test seam — reset to the real https.request. */
export function _resetRequester(): void { _requesterImpl = https.request; }

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

  constructor(routing?: ModelRouting) {
    this.routing = routing ?? getModelRouting();
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
    await syncSharedDegradedModels();

    // Get the full fallback chain for the requested deployment.
    // OpenRouter has a separate chain (no Azure deployment names in the fallback list).
    const chain = this.routing.usesObo === false
      ? buildOpenRouterFallbackChain(this.routing, getEnvConfig())
      : getFallbackChain(this.routing.deploymentName, {
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
    const effectiveBudgetMs = options.maxBudgetMs ?? FALLBACK_BUDGET_MS;

    // Retry Grok once on 429 before falling to minimax (#690 / #708).
    // CHAIN-SCOPED: this flag must NOT be re-declared inside the for-loop
    // body. If it is, every `i--; continue;` re-enters the iteration with
    // a fresh `false`, allowing Grok to be retried on every 429 in a row
    // until the FALLBACK_BUDGET_MS runs out — never reaching minimax.
    let grok429RetryDone = false;

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
      const remaining = effectiveBudgetMs - elapsed;
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

        // Grok 429 retry before falling back: if Grok got a 429 and we have not
        // retried it yet, honour Retry-After and retry once before minimax (#690).
        // Only applies to OpenRouter paths (usesObo=false); Azure Foundry (usesObo=true)
        // routes through a different error handler that already treats 429 as a standard
        // retryable failure without Retry-After-aware retry.
        if (
          !grok429RetryDone
          && err instanceof FoundryError
          && err.statusCode === 429
          && err.retryAfterMs !== undefined
          && i === 0   // only retry the primary (Grok) slot
          && routing.usesObo === false  // OpenRouter only
        ) {
          grok429RetryDone = true;
          trackEvent({
            name: 'OpenRouterGrok429Retry',
            correlationId,
            properties: {
              model: routing.deploymentName,
              retryAfterMs: err.retryAfterMs,
              remainingBudgetMs: effectiveBudgetMs - (Date.now() - budgetStart),
            },
          });
          // Wait for Retry-After then retry Grok; this iteration's chain entry is
          // re-entered by decrementing i so it counts as the same position.
          await new Promise<void>((resolve) => setTimeout(resolve, err.retryAfterMs));
          i--;
          continue;
        }

        reportLlmFailure(routing.deploymentName);

        // OpenRouterSlotSkipError: a degraded model was detected at the concurrency
        // gate before we even entered the slot. Treat it as retryable so the
        // fallback chain fires rather than throwing immediately (#690).
        if (err instanceof OpenRouterSlotSkipError) {
          trackEvent({
            name: 'OpenRouterSlotSkip',
            correlationId,
            properties: {
              model: routing.deploymentName,
              reason: err.reason,
            },
          });
          // Fall through to the retryable path with isRetryable=true.
          // We push a synthetic failover step so the chain logs the skip.
          const nextCandidate = chain.slice(i + 1).find((r) =>
            !isModelDegraded(r.deploymentName) && !isModelTrackedDown(r.deploymentName),
          );
          if (nextCandidate) {
            failoverSteps.push({
              fromModel: routing.deploymentName,
              toModel: nextCandidate.deploymentName,
              reason: 'concurrency_gate_skip',
              statusCode: undefined,
            });
          }
          trackEvent({
            name: 'LlmFallbackTriggered',
            correlationId,
            properties: {
              originalModel: routing.deploymentName,
              fallbackModel: nextCandidate?.deploymentName ?? 'none',
              reason: 'concurrency_gate_skip',
              chainPosition: i,
              elapsedMs: Date.now() - budgetStart,
            },
          });
          // Continue to next candidate in chain.
          continue;
        }

        const isRetryable = isRetryableError(err);

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
      return this.callOpenRouter(routing, options, correlationId, timeoutMs);
    }

    const base = routing.apiBase.replace(/\/+$/, '');
    // GPT-5, GPT-4o, and o-series models require 2024-12-01-preview or later (#185, #219)
    const needsPreview = routing.isReasoning || needsNewTokenParam(routing.deploymentName);
    const apiVersion = needsPreview ? '2024-12-01-preview' : '2024-06-01';
    const url = `${base}/openai/deployments/${routing.deploymentName}/chat/completions?api-version=${apiVersion}`;

    const body: Record<string, unknown> = {
      model: routing.deploymentName,
      messages: options.messages.map(mapOutgoingMessage),
      stream: options.onToken ? true : false,
    };

    // When streaming, request usage in the final chunk so token counts stay accurate (#637)
    if (options.onToken) {
      body.stream_options = { include_usage: true };
    }

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

    // Use node:https.request() with req.setTimeout() for OS-level socket timeout.
    //
    // Root cause (#588): fetch() + AbortController / AbortSignal.timeout() fires the
    // JavaScript promise rejection but does NOT destroy the underlying TCP socket in
    // Azure Container Apps / undici. The ghost socket holds a libuv I/O handle open,
    // keeping the event loop in the "poll" phase and blocking all subsequent setTimeout
    // callbacks — including the 8s timeout in sendReplyActivity, the stale-ACK
    // recovery, and Durable orchestrator timer delivery.
    //
    // req.setTimeout() fires at the *socket* (OS) level once the idle period elapses,
    // and req.destroy() forcibly closes the TCP connection and releases the libuv
    // handle, allowing the event loop to return to the "timers" phase.
    // keepAlive:false ensures no connection is reused after the call completes.
    const parsedUrl = new URL(url);
    const requestBody = JSON.stringify(body);

    const raw = await new Promise<RawApiResponse>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) { settled = true; fn(); }
      };

      // Wall-clock hard deadline — fires unconditionally even when the socket receives
      // incremental data (chunked responses, HTTP/2 PING frames, streaming tokens).
      // This restores the wall-clock guarantee that was provided by Promise.race() +
      // fetch() before #588, while keeping the OS-level socket teardown from #588.
      // (#589: req.setTimeout() alone is insufficient for active-socket scenarios.)
      const wallClockTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        req?.destroy();
        const te = new Error(`LLM call wall-clock timed out after ${timeoutMs}ms`);
        te.name = 'TimeoutError';
        settle(() => reject(te));
      }, timeoutMs);

      // Use let so wallClockTimer and settle can reference req before it is assigned.
      // eslint-disable-next-line prefer-const
      let req: ReturnType<typeof _requesterImpl>;

      req = _requesterImpl(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port ? Number(parsedUrl.port) : 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(requestBody),
          },
          agent: new https.Agent({ keepAlive: false }),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            clearTimeout(wallClockTimer);
            const responseText = Buffer.concat(chunks).toString('utf-8');
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              const errorText = sanitizeRemoteErrorText(responseText);
              const retryAfterRaw = res.headers['retry-after'] ?? res.headers['retry-after-ms'];
              const retryAfterStr = Array.isArray(retryAfterRaw) ? retryAfterRaw[0] : retryAfterRaw;
              const retryAfterSecs = retryAfterStr ? Number(retryAfterStr) : NaN;
              const retryAfterMs = res.statusCode === 429 && Number.isFinite(retryAfterSecs) && retryAfterSecs > 0
                ? retryAfterSecs * 1_000
                : undefined;
              settle(() => reject(new FoundryError(
                `Chat completion failed: ${res.statusCode} ${res.statusMessage ?? ''} — ${errorText}`,
                res.statusCode ?? 500,
                routing.deploymentName,
                retryAfterMs,
              )));
              return;
            }
            try {
              const rawParsed = options.onToken
                ? parseSseResponse(responseText, routing.deploymentName, options.onToken)
                : (JSON.parse(responseText) as RawApiResponse);
              settle(() => resolve(rawParsed));
            } catch {
              settle(() => reject(new Error('Failed to parse LLM response JSON')));
            }
          });
          res.on('error', (err) => { clearTimeout(wallClockTimer); settle(() => reject(err)); });
        },
      );

      // OS-level socket timeout: fires when the socket is idle for timeoutMs.
      // req.destroy() closes the TCP socket and releases the libuv handle,
      // stopping the event loop from blocking in the "poll" phase.
      // Kept alongside wallClockTimer for connection-stall detection.
      req.setTimeout(timeoutMs, () => {
        clearTimeout(wallClockTimer);
        req.destroy();
        const te = new Error(`LLM call timed out after ${timeoutMs}ms`);
        te.name = 'TimeoutError';
        settle(() => reject(te));
      });

      req.on('error', (err) => {
        clearTimeout(wallClockTimer);
        // settle() idempotency guard prevents double-rejection if we already settled
        // via wallClockTimer or req.setTimeout (both call settle before req.destroy).
        // Infrastructure-originated ECONNRESET (arrived before settle) must NOT be
        // silenced — propagate it so the promise does not hang indefinitely (#589-B).
        settle(() => reject(err));
      });

      req.write(requestBody);
      req.end();
    });

    return mapApiResponse(raw);
  }

  /**
   * Get an embeddings vector for the given text.
   * Embeddings always use Azure AI Foundry — OpenRouter provides no embedding proxy (#501).
   */
  async getEmbedding(text: string): Promise<number[]> {
    // When in OpenRouter mode, force Azure routing for embeddings.
    const embeddingRouting = this.routing.usesObo === false ? getModelRouting('azure') : this.routing;
    const embeddingModel = embeddingRouting.lane.embedding;
    const url = `${embeddingRouting.apiBase}/openai/deployments/${embeddingModel}/embeddings?api-version=2024-06-01`;

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
   * Call OpenRouter's unified OpenAI-compatible API (#501).
   * Uses a direct API key (no OBO token). For Grok 4.1 models, the `reasoning.enabled`
   * flag in the request body is set based on `routing.isReasoning`.
   */
  private async callOpenRouter(
    routing: ModelRouting,
    options: Omit<FoundryClientOptions, 'routing'>,
    correlationId: string,
    timeoutMs: number,
  ): Promise<ChatCompletionResponse> {
    const config = getEnvConfig();
    if (!config.openrouterApiKey) {
      throw new FoundryError(
        'OPENROUTER_API_KEY is not configured — set LLM_PROVIDER=azure or add the key to Key Vault',
        503,
        routing.deploymentName,
      );
    }

    const url = `${routing.apiBase}/chat/completions`;
    const parsedUrl = new URL(url);

    const body: Record<string, unknown> = {
      model: routing.deploymentName,
      messages: options.messages.map(mapOutgoingMessage),
      stream: options.onToken ? true : false,
      max_tokens: options.maxTokens ?? 4096,
    };

    // When streaming, request usage in the final chunk so token counts stay accurate (#637)
    if (options.onToken) {
      body.stream_options = { include_usage: true };
    }

    if (routing.isReasoning) {
      // Explicit reasoning control for x-ai/grok-4.1-fast on OpenRouter.
      body.reasoning = { enabled: true };
    } else {
      body.temperature = options.temperature ?? 0.7;
    }

    // Build combined tools array: function tools + OpenRouter server tools (#650).
    // When on OpenRouter, remove the client-side web_search function tool and inject
    // openrouter:web_search server tool so OpenRouter handles search server-side.
    // xAI models: use engine "exa" — OpenRouter intercepts the server tool and only
    // forwards clean function tools to xAI (which rejects mixed tool types).
    //
    // IMPORTANT: Only inject openrouter:web_search when functionTools.length > 0.
    // When there are no function tools (e.g., leader synthesis with no tools passed),
    // allTools would contain ONLY the server tool. OpenRouter/exa does not fully
    // strip a server-only tools list before forwarding, so xAI receives
    // tools:[openrouter:web_search] + tool_choice:'auto' and rejects with 400.
    // Pure text completions must omit body.tools entirely (#650 fix).
    const functionTools = (options.tools ?? []).filter((t) => t.function.name !== 'web_search');
    const isXai = routing.deploymentName.startsWith('x-ai/');

    if (functionTools.length > 0) {
      const serverSearchTool: Record<string, unknown> = {
        type: 'openrouter:web_search',
        parameters: {
          engine: isXai ? 'exa' : 'auto',
          max_results: 3,
          max_total_results: 5,
        },
      };
      body.tools = [...functionTools, serverSearchTool];
      body.tool_choice = options.toolChoice ?? 'auto';
    }

    // OpenRouter provider-routing hint (#677). `require_parameters: true` makes
    // OpenRouter reject requests where an upstream provider would silently drop
    // a parameter (e.g. a provider that does not support tools would otherwise
    // be selected and return degraded responses). Failing loud is healthier.
    body.provider = { require_parameters: true };

    const requestBody = JSON.stringify(body);

    // Gate all OpenRouter requests behind a per-process concurrency limiter
    // (#677). Without this, a swarm of 3-4 worker activities fires parallel
    // requests that share a single API key and trip upstream provider
    // per-key concurrency caps (observed with minimax during PROBE-SWARM-TAB-004).
    const raw = await withOpenRouterConcurrencySlot(correlationId, routing.deploymentName, () => new Promise<RawApiResponse>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) { settled = true; fn(); }
      };

      const wallClockTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        req?.destroy();
        const te = new Error(`LLM call wall-clock timed out after ${timeoutMs}ms`);
        te.name = 'TimeoutError';
        settle(() => reject(te));
      }, timeoutMs);
      // eslint-disable-next-line prefer-const
      let req: ReturnType<typeof _requesterImpl>;

      req = _requesterImpl(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port ? Number(parsedUrl.port) : 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.openrouterApiKey}`,
            'x-correlation-id': correlationId,
            // OpenRouter attribution headers (#677) — documented at
            // https://openrouter.ai/docs/quickstart. Used for rankings and
            // credit attribution.
            'HTTP-Referer': config.openrouterReferer,
            'X-Title': config.openrouterTitle,
            'Content-Length': Buffer.byteLength(requestBody),
          },
          agent: new https.Agent({ keepAlive: false }),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            clearTimeout(wallClockTimer);
            const responseText = Buffer.concat(chunks).toString('utf-8');
            // Parse OpenRouter rate-limit headers on every response and surface
            // to telemetry. Feeds future proactive-throttling logic. (#677)
            emitOpenRouterRateLimitSnapshot(res.headers, routing.deploymentName, correlationId);
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              const errorText = sanitizeRemoteErrorText(responseText);
              const retryAfterRaw = res.headers['retry-after'] ?? res.headers['retry-after-ms'];
              const retryAfterStr = Array.isArray(retryAfterRaw) ? retryAfterRaw[0] : retryAfterRaw;
              const retryAfterSecs = retryAfterStr ? Number(retryAfterStr) : NaN;
              const retryAfterMs = res.statusCode === 429 && Number.isFinite(retryAfterSecs) && retryAfterSecs > 0
                ? retryAfterSecs * 1_000
                : undefined;
              settle(() => reject(new FoundryError(
                `OpenRouter chat completion failed: ${res.statusCode} ${res.statusMessage ?? ''} — ${errorText}`,
                res.statusCode ?? 500,
                routing.deploymentName,
                retryAfterMs,
              )));
              return;
            }
            try {
              const rawParsed = options.onToken
                ? parseSseResponse(responseText, routing.deploymentName, options.onToken)
                : (JSON.parse(responseText) as RawApiResponse);
              settle(() => resolve(rawParsed));
            } catch {
              settle(() => reject(new Error('Failed to parse OpenRouter LLM response JSON')));
            }
          });
          res.on('error', (err) => { clearTimeout(wallClockTimer); settle(() => reject(err)); });
        },
      );

      req.setTimeout(timeoutMs, () => {
        clearTimeout(wallClockTimer);
        req.destroy();
        const te = new Error(`OpenRouter LLM call timed out after ${timeoutMs}ms`);
        te.name = 'TimeoutError';
        settle(() => reject(te));
      });

      req.on('error', (err) => {
        clearTimeout(wallClockTimer);
        settle(() => reject(err));
      });

      req.write(requestBody);
      req.end();
    }));

    return mapApiResponse(raw);
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
// OpenRouter fallback chain (#501)
// ---------------------------------------------------------------------------

/**
 * Builds the ordered fallback chain for OpenRouter calls.
 * Chain: primary (grok-4.1-fast, reasoning) → fallbackPrimary (minimax) → fallbackSecondary.
 * All entries share the same apiBase and usesObo=false from the base routing.
 *
 * Deliberately does NOT add cross-provider fallback for minimax-pinned agents
 * (e.g. Lucas). Silent cross-model failover for specialised agents is an
 * anti-pattern — the specialisation reason is lost. Proper handling of
 * upstream OpenRouter errors (429/502/524) belongs in the typed error
 * classification work in #677, not in the fallback chain.
 */
function buildOpenRouterFallbackChain(
  routing: ModelRouting,
  config: ReturnType<typeof getEnvConfig>,
): ModelRouting[] {
  const chain: ModelRouting[] = [];
  const seen = new Set<string>();

  const add = (deploymentName: string | undefined, isReasoning: boolean) => {
    if (!deploymentName || seen.has(deploymentName)) return;
    seen.add(deploymentName);
    chain.push({ ...routing, deploymentName, isReasoning });
  };

  add(routing.deploymentName, routing.isReasoning);             // requested model (e.g. grok, or minimax if overridden)
  add(config.openrouterFallbackPrimary, false);                 // minimax/minimax-m2.7
  add(config.openrouterFallbackSecondary, false);               // tertiary fallback
  add(routing.lane.secondary, false);                           // lane secondary (if different)

  return chain;
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

/**
 * Thrown from withOpenRouterConcurrencySlot when a degraded model is detected at the
 * gate entrance — signals the caller to skip this model and go straight to its fallback
 * without waiting in the queue (#690).
 */
export class OpenRouterSlotSkipError extends Error {
  constructor(
    public readonly deploymentName: string,
    public readonly reason: string,
  ) {
    super(`OpenRouter slot skip: ${deploymentName} is degraded (${reason}) — bypass queue and go to fallback`);
    this.name = 'OpenRouterSlotSkipError';
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

export function shouldPageOutForLlmFailure(err: unknown): boolean {
  if (err instanceof FoundryAllModelsDownError) {
    return true;
  }

  if (err instanceof FoundryFallbackExhaustedError) {
    return true;
  }

  if (err instanceof FoundryError && isRetryableError(err)) {
    return true;
  }

  if (err instanceof Error && err.name === 'TimeoutError') {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// OpenRouter best-practice helpers (#677)
// ---------------------------------------------------------------------------

/**
 * Parse OpenRouter / upstream-provider rate-limit headers and emit telemetry.
 * OpenRouter mirrors common rate-limit headers from upstream providers:
 *   X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * See https://openrouter.ai/docs/api-reference/limits
 */
function emitOpenRouterRateLimitSnapshot(
  headers: Record<string, string | string[] | undefined>,
  deploymentName: string,
  correlationId: string,
): void {
  const pick = (name: string): string | undefined => {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0];
    return raw;
  };
  const limit = pick('x-ratelimit-limit');
  const remaining = pick('x-ratelimit-remaining');
  const reset = pick('x-ratelimit-reset');
  // Skip telemetry when all three headers are absent — most responses.
  if (!limit && !remaining && !reset) return;
  trackEvent({
    name: 'OpenRouterRateLimitSnapshot',
    correlationId,
    properties: {
      model: deploymentName,
      ...(limit !== undefined && { limit }),
      ...(remaining !== undefined && { remaining }),
      ...(reset !== undefined && { reset }),
    },
  });
}

/**
 * Per-process concurrency limiter for OpenRouter calls. Prevents a swarm of
 * parallel worker activities from bursting past upstream-provider per-key
 * concurrency caps (e.g. xAI, minimax). Default slot count is
 * `OPENROUTER_MAX_CONCURRENCY` (10 during the current dev-hardening phase —
 * see `envConfig.ts` and `infra/main.bicep`; #677, #690, #693).
 */
interface OpenRouterGateState {
  active: number;
  queue: Array<() => void>;
  maxConcurrency: number;
}

let _openRouterGate: OpenRouterGateState | undefined;

function getOpenRouterGate(): OpenRouterGateState {
  if (!_openRouterGate) {
    _openRouterGate = {
      active: 0,
      queue: [],
      maxConcurrency: getEnvConfig().openrouterMaxConcurrency,
    };
  }
  return _openRouterGate;
}

/** Test-only reset hook so unit tests can re-seed the gate between scenarios. */
export function _resetOpenRouterGateForTests(): void {
  _openRouterGate = undefined;
}

async function withOpenRouterConcurrencySlot<T>(
  correlationId: string,
  deploymentName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const gate = getOpenRouterGate();

  // Fix 3: if this model is degraded, skip the queue entirely and let the
  // caller go straight to fallback. Prevents the 4th queued worker from
  // waiting for a degraded Grok slot while the fallback chain fires (#690).
  if (isModelDegraded(deploymentName)) {
    trackEvent({
      name: 'OpenRouterConcurrencyGate',
      correlationId,
      properties: {
        action: 'degraded_skip',
        model: deploymentName,
        reason: 'model_degraded',
      },
    });
    throw new OpenRouterSlotSkipError(deploymentName, 'degraded');
  }

  if (gate.active >= gate.maxConcurrency) {
    const queueStart = Date.now();
    trackEvent({
      name: 'OpenRouterConcurrencyGate',
      correlationId,
      properties: {
        action: 'queued',
        model: deploymentName,
        active: gate.active,
        max: gate.maxConcurrency,
        queueDepth: gate.queue.length,
      },
    });
    await new Promise<void>((resolve) => {
      gate.queue.push(resolve);
    });
    trackEvent({
      name: 'OpenRouterConcurrencyGate',
      correlationId,
      properties: {
        action: 'admitted',
        model: deploymentName,
        queueWaitMs: Date.now() - queueStart,
      },
    });
  }
  gate.active++;
  try {
    return await fn();
  } finally {
    gate.active--;
    const next = gate.queue.shift();
    if (next) next();
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
  // Network-level errors: ECONNRESET, socket hang up, ECONNREFUSED — retryable transient
  if (err instanceof Error && (
    (err as NodeJS.ErrnoException).code === 'ECONNRESET'
    || err.message.includes('socket hang up')
    || (err as NodeJS.ErrnoException).code === 'ECONNREFUSED'
    || (err as NodeJS.ErrnoException).code === 'ETIMEDOUT'
  )) {
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

// SSE streaming delta types (#637 Phase 1)
interface StreamDeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamChunk {
  id?: string;
  model?: string;
  created?: number;
  choices?: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: StreamDeltaToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: RawApiUsage;
}

/**
 * Parse a buffered SSE response body into a synthetic RawApiResponse.
 * Calls onToken for each content delta in order (#637 Phase 1).
 * Works post-hoc (after all bytes arrive) — Phase 2 will add real-time streaming.
 */
function parseSseResponse(
  sseText: string,
  deploymentName: string,
  onToken?: (text: string) => void,
): RawApiResponse {
  const lines = sseText.split('\n');

  let responseId = `stream-${Date.now()}`;
  let responseModel = deploymentName;
  let responseCreated = Math.floor(Date.now() / 1000);
  let contentBuffer = '';
  let finishReason = 'stop';
  let usage: RawApiUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  // Tool call accumulation indexed by tool_call delta index
  const toolCallFragments = new Map<number, { id: string; name: string; arguments: string }>();

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') break;

    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      continue; // Skip malformed SSE lines
    }

    if (chunk.id) responseId = chunk.id;
    if (chunk.model) responseModel = chunk.model;
    if (chunk.created) responseCreated = chunk.created;
    if (chunk.usage) usage = chunk.usage;

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;

      if (delta.content) {
        contentBuffer += delta.content;
        onToken?.(delta.content);
      }

      for (const tcDelta of delta.tool_calls ?? []) {
        const frag = toolCallFragments.get(tcDelta.index);
        if (!frag) {
          toolCallFragments.set(tcDelta.index, {
            id: tcDelta.id ?? '',
            name: tcDelta.function?.name ?? '',
            arguments: tcDelta.function?.arguments ?? '',
          });
        } else {
          if (tcDelta.id) frag.id = tcDelta.id;
          if (tcDelta.function?.name) frag.name += tcDelta.function.name;
          if (tcDelta.function?.arguments) frag.arguments += tcDelta.function.arguments;
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }

  const toolCalls: RawApiToolCall[] | undefined = toolCallFragments.size > 0
    ? [...toolCallFragments.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, tc]) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }))
    : undefined;

  return {
    id: responseId,
    model: responseModel,
    created: responseCreated,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: contentBuffer || null,
        tool_calls: toolCalls,
      },
      finish_reason: finishReason,
    }],
    usage,
  };
}

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
  cost?: number;
  cost_details?: Record<string, number>;
  server_tool_use?: { web_search_requests?: number };
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
  const providerCost = typeof raw.usage.cost === 'number' ? raw.usage.cost : undefined;
  const providerCostDetails = raw.usage.cost_details && typeof raw.usage.cost_details === 'object'
    ? Object.fromEntries(
        Object.entries(raw.usage.cost_details)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
      )
    : undefined;

  const serverToolUse = raw.usage.server_tool_use?.web_search_requests
    ? { webSearchRequests: raw.usage.server_tool_use.web_search_requests }
    : undefined;

  return {
    id: raw.id,
    model: raw.model,
    created: raw.created,
    usage: {
      promptTokens: raw.usage.prompt_tokens,
      completionTokens: raw.usage.completion_tokens,
      totalTokens: raw.usage.total_tokens,
      providerCost,
      providerCostUnit: providerCost !== undefined ? 'credits' : undefined,
      providerCostDetails: providerCostDetails && Object.keys(providerCostDetails).length > 0
        ? providerCostDetails
        : undefined,
      serverToolUse,
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
