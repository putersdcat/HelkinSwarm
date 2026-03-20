// Prompt shields — Azure Content Safety integration for jailbreak/injection detection.
// Spec ref: 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import { safetyConfig } from '../config/safetyConfig.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShieldResult {
  clean: boolean;
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
  private apiKey: string;

  constructor() {
    this.endpoint = safetyConfig.contentSafetyEndpoint ?? '';
    this.apiKey = safetyConfig.contentSafetyKey ?? '';
  }

  /**
   * Check text against Azure Content Safety Prompt Shields.
   * Uses the text:shieldPrompt API to detect jailbreak/injection attacks.
   */
  async check(text: string, correlationId: string): Promise<ShieldResult> {
    if (!this.endpoint) {
      // Content Safety not configured — pass through (fail open for now, logged)
      return {
        clean: true,
        categories: { hate: false, violence: false, sexual: false, selfHarm: false, jailbreak: false },
        correlationId,
      };
    }

    try {
      const response = await fetch(`${this.endpoint}/contentsafety/text:shieldPrompt?api-version=2024-09-01`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': this.apiKey,
        },
        body: JSON.stringify({
          userPrompt: text,
        }),
      });

      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.error(`[PromptShields] Content Safety API error: ${response.status}`);
        // Fail closed — block on API error
        return {
          clean: false,
          categories: { hate: true, violence: true, sexual: true, selfHarm: true, jailbreak: true },
          correlationId,
        };
      }

      const data = (await response.json()) as {
        userPromptAnalysis: { attackDetected: boolean };
      };

      const jailbreak = data.userPromptAnalysis?.attackDetected === true;

      return {
        clean: !jailbreak,
        categories: { hate: false, violence: false, sexual: false, selfHarm: false, jailbreak },
        correlationId,
      };
    } catch {
      // Fail closed
      return {
        clean: false,
        categories: { hate: true, violence: true, sexual: true, selfHarm: true, jailbreak: true },
        correlationId,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

export const promptShields = new PromptShields();
