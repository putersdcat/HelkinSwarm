// translate skill handlers — AI-native language translation.
// Issue: #240
//
// Uses the configured LLM provider (OpenRouter or Azure AI Foundry) to perform
// translation. Does NOT require obo or reasoning mode — uses temperature 0.1
// for deterministic, high-quality translation output.
//
// Provider-aware:
//   openrouter → https://openrouter.ai/api/v1/chat/completions  (OPENROUTER_API_KEY)
//   azure      → ${AZURE_AI_FOUNDRY_ENDPOINT}/openai/deployments/${LLM_PRIMARY_MODEL}/...
//                (UAMI bearer token for https://cognitiveservices.azure.com/.default)

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Credential singleton — for Azure provider path only
// ---------------------------------------------------------------------------

let _cred: TokenCredential | undefined;

function getCredential(): TokenCredential {
  if (!_cred) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    _cred = clientId
      ? new ManagedIdentityCredential({ clientId })
      : new DefaultAzureCredential();
  }
  return _cred;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const TranslateTextArgsSchema = z.object({
  text: z.string().min(1).max(20_000),
  targetLanguage: z.string().min(1).max(100),
  sourceLanguage: z.string().optional(),
  preserveFormatting: z.boolean().optional().default(true),
  userId: z.string().min(1),            // injected by toolDispatchActivity
  correlationId: z.string().optional(), // injected by toolDispatchActivity
});

// ---------------------------------------------------------------------------
// LLM call helper — provider-aware, no reasoning mode
// ---------------------------------------------------------------------------

interface ChatMessage { role: string; content: string; }
interface TranslationResponse { choices: Array<{ message: { content: string } }> }

/** Calls the configured LLM with a low-temperature translation prompt. */
async function callTranslationLlm(messages: ChatMessage[]): Promise<string> {
  const provider = (process.env['LLM_PROVIDER'] ?? 'azure') as 'azure' | 'openrouter';

  let url: string;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let model: string;

  if (provider === 'openrouter') {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('Translation service unavailable — OPENROUTER_API_KEY not configured.');
    }
    // OpenRouter model for translation: fast, no reasoning overhead
    model = 'x-ai/grok-4.1-fast';
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    // Azure AI Foundry
    const endpoint = process.env['AZURE_AI_FOUNDRY_ENDPOINT'];
    const deploymentName = process.env['LLM_PRIMARY_MODEL'];
    if (!endpoint || !deploymentName) {
      throw new Error('Translation service unavailable — AZURE_AI_FOUNDRY_ENDPOINT or LLM_PRIMARY_MODEL not configured.');
    }
    const tokenResponse = await getCredential().getToken('https://cognitiveservices.azure.com/.default');
    if (!tokenResponse) {
      throw new Error('Failed to acquire Azure AI Foundry token for translation.');
    }
    model = deploymentName;
    url = `${endpoint}/openai/deployments/${encodeURIComponent(deploymentName)}/chat/completions?api-version=2024-12-01-preview`;
    headers['Authorization'] = `Bearer ${tokenResponse.token}`;
  }

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: 8_000,
    temperature: 0.1,   // low temperature for consistent, deterministic translation
    stream: false,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Translation LLM error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await response.json() as TranslationResponse;
  const content = data.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Translation LLM returned an empty response.');
  }
  return content;
}

// ---------------------------------------------------------------------------
// Tool: translate_text
// ---------------------------------------------------------------------------

export const translate_text: ToolHandler = async (args) => {
  const { text, targetLanguage, sourceLanguage, preserveFormatting } = TranslateTextArgsSchema.parse(args);

  const fromClause = sourceLanguage ? `from ${sourceLanguage} ` : '';
  const formatInstruction = preserveFormatting
    ? ' Preserve all Markdown formatting, bullet points, numbered lists, headings, code blocks, and document structure exactly.'
    : '';

  const systemPrompt = `You are a professional translator. Translate the following text ${fromClause}into ${targetLanguage}.${formatInstruction} Return ONLY the translated text — no preamble, explanation, or surrounding quotation marks.`;

  const translated = await callTranslationLlm([
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: text },
  ]);

  const label = sourceLanguage
    ? `Translation (${sourceLanguage} → ${targetLanguage})`
    : `Translation (→ ${targetLanguage})`;

  return `${label}:\n\n${translated}`;
};
