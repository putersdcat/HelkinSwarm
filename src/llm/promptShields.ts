// Prompt shields — Azure Content Safety integration for jailbreak/injection detection.
// Spec ref: 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import { safetyConfig } from '../config/safetyConfig.js';
import { getBearerToken } from '../auth/identity.js';
import { getEnvConfig } from '../config/envConfig.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShieldResult {
  clean: boolean;
  mode?: 'azure-content-safety' | 'provider-bypassed' | 'not-configured' | 'fail-open-error';
  categories: {
    hate: boolean;
    violence: boolean;
    sexual: boolean;
    selfHarm: boolean;
    jailbreak: boolean;
  };
  confidenceScores?: Record<string, number>;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Prompt shields
// ---------------------------------------------------------------------------

export class PromptShields {
  private endpoint: string;

  constructor() {
    this.endpoint = safetyConfig.contentSafetyEndpoint ?? '';
  }

  private makeCleanResult(
    correlationId: string,
    mode: ShieldResult['mode'],
    properties?: Record<string, string | number | boolean>,
  ): ShieldResult {
    const provider = getEnvConfig().llmProvider;
    trackEvent({
      name: 'PromptShieldResult',
      correlationId,
      properties: {
        provider,
        mode: mode ?? 'unknown',
        clean: true,
        blocked: false,
        ...(properties ?? {}),
      },
    });

    return {
      clean: true,
      mode,
      categories: { hate: false, violence: false, sexual: false, selfHarm: false, jailbreak: false },
      correlationId,
    };
  }

  /**
   * Check text against Azure Content Safety Prompt Shields.
   * Uses the text:shieldPrompt API to detect jailbreak/injection attacks.
   * Auth via managed identity (same AI Services resource as LLM).
   */
  async check(text: string, correlationId: string): Promise<ShieldResult> {
    const provider = getEnvConfig().llmProvider;

    if (provider === 'openrouter') {
      // Accepted temporary tradeoff (#501 / 0zb): direct OpenRouter mode bypasses
      // Azure Prompt Shields for quota relief and provider simplicity.
      return this.makeCleanResult(correlationId, 'provider-bypassed', {
        reason: 'openrouter-direct-without-azure-prompt-shields',
      });
    }

    if (!this.endpoint) {
      // Content Safety not configured — pass through (fail open for now, logged)
      return this.makeCleanResult(correlationId, 'not-configured', {
        reason: 'content-safety-endpoint-not-configured',
      });
    }

    try {
      const token = await getBearerToken('https://cognitiveservices.azure.com/.default');

      const response = await fetch(`${this.endpoint}/contentsafety/text:shieldPrompt?api-version=2024-09-01`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          userPrompt: text,
        }),
      });

      if (!response.ok) {
        // Fail open on API errors — personal single-user bot, transient Content Safety
        // outages should not block all messages (#302). Log for investigation.
        console.error(
          `[PromptShields] Content Safety API error: status=${response.status} correlationId=${correlationId}`,
        );
        return this.makeCleanResult(correlationId, 'fail-open-error', {
          reason: `content-safety-http-${response.status}`,
          statusCode: response.status,
        });
      }

      const data = (await response.json()) as {
        userPromptAnalysis: { attackDetected: boolean };
      };

      const jailbreak = data.userPromptAnalysis?.attackDetected === true;

      trackEvent({
        name: 'PromptShieldResult',
        correlationId,
        properties: {
          provider,
          mode: 'azure-content-safety',
          clean: !jailbreak,
          blocked: jailbreak,
          jailbreak,
        },
      });

      return {
        clean: !jailbreak,
        mode: 'azure-content-safety',
        categories: { hate: false, violence: false, sexual: false, selfHarm: false, jailbreak },
        correlationId,
      };
    } catch (err) {
      // Fail open on errors — personal single-user bot (#302)
      console.error(`[PromptShields] Exception during check: correlationId=${correlationId}`, err);
      return this.makeCleanResult(correlationId, 'fail-open-error', {
        reason: err instanceof Error ? err.name : 'content-safety-exception',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

export const promptShields = new PromptShields();
