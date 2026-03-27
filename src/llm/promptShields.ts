// Prompt shields — Azure Content Safety integration for jailbreak/injection detection.
// Spec ref: 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import { safetyConfig } from '../config/safetyConfig.js';
import { getBearerToken } from '../auth/identity.js';

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

  constructor() {
    this.endpoint = safetyConfig.contentSafetyEndpoint ?? '';
  }

  /**
   * Check text against Azure Content Safety Prompt Shields.
   * Uses the text:shieldPrompt API to detect jailbreak/injection attacks.
   * Auth via managed identity (same AI Services resource as LLM).
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
        return {
          clean: true,
          categories: { hate: false, violence: false, sexual: false, selfHarm: false, jailbreak: false },
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
    } catch (err) {
      // Fail open on errors — personal single-user bot (#302)
      console.error(`[PromptShields] Exception during check: correlationId=${correlationId}`, err);
      return {
        clean: true,
        categories: { hate: false, violence: false, sexual: false, selfHarm: false, jailbreak: false },
        correlationId,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

export const promptShields = new PromptShields();
