// Azure AI Foundry client — single provider-agnostic interface.
// Handles global frontier, EU DataZoneStandard, and BYOK OpenRouter paths.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0c-BYOK-External-LLM-Support.md

import { getModelRouting, type ModelRouting } from './modelRouter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
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
   * Send a chat completion request to the Foundry endpoint.
   * Handles both Azure AI Foundry (OBO) and OpenRouter (BYOK) paths.
   */
  async chatCompletion(options: Omit<FoundryClientOptions, 'routing'>): Promise<ChatCompletionResponse> {
    const url = `${this.apiBase}/openai/deployments/${this.routing.deploymentName}/chat/completions?api-version=2024-06-01`;

    const body: Record<string, unknown> = {
      model: this.routing.deploymentName,
      messages: options.messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      stream: false,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice ?? 'auto';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-correlation-id': options.correlationId ?? crypto.randomUUID(),
    };

    // Azure AI Foundry — use OBO token or MI token
    if (this.routing.laneName !== 'byok') {
      const oboToken = await this.getOboToken();
      headers['Authorization'] = `Bearer ${oboToken}`;
    } else {
      // OpenRouter — use API key directly
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      // OpenRouter uses a different URL pattern
      headers['HTTP-Referer'] = 'https://helkinswarm.dev';
      headers['X-Title'] = 'HelkinSwarm';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new FoundryError(
        `Chat completion failed: ${response.status} ${response.statusText} — ${errorText}`,
        response.status,
        this.routing.deploymentName,
      );
    }

    return response.json() as Promise<ChatCompletionResponse>;
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
   * Obtain an OBO (on-behalf-of) token using Managed Identity.
   * In production, this fetches a scoped token from the Entra ID token endpoint.
   */
  private async getOboToken(): Promise<string> {
    // TODO (Phase 3+): Wire real MI-based OBO token fetch
    // For now, return placeholder — will be replaced with real MI token flow
    return process.env.AZURE_FOUNDRY_OBO_TOKEN ?? 'placeholder-obo-token';
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
// Convenience factory
// ---------------------------------------------------------------------------

export function createFoundryClient(): FoundryClient {
  return new FoundryClient(getModelRouting());
}
