/**
 * Abstract LLM provider interface (#501).
 *
 * Concrete implementations:
 * - FoundryClient — Azure AI Foundry via Managed Identity OBO token
 * - Planned: OpenRouterProvider — OpenRouter API via API key (currently
 *   integrated directly into FoundryClient's callOpenRouter path; see #501)
 *
 * All callers use FoundryClient as the single facade. Provider selection is
 * driven by `ModelRouting.usesObo` which is set by `getModelRouting()` based
 * on the `LLM_PROVIDER` env var.
 */
export interface ModelProvider {
  /**
   * Send a chat completion request, with automatic fallback on throttle/failure.
   */
  chatCompletion(options: ModelProviderChatOptions): Promise<ModelProviderChatResponse>;

  /**
   * Get an embedding vector for the given text.
   */
  getEmbedding(text: string): Promise<number[]>;
}

export interface ModelProviderChatOptions {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    name?: string;
    toolCallId?: string;
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  }>;
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
  correlationId?: string;
  requestedTaskComplexity?: 'simple' | 'compound' | 'complex';
}

export interface ModelProviderChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    };
    finishReason: string;
    index: number;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  created: number;
}
