import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

async function loadFollowUpModule() {
  process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
  process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';
  return import('../../src/orchestrator/llmFollowUpActivity.js');
}

describe('llmFollowUpActivity execution prompt', () => {
  it('adds an explicit continue-until-complete instruction when retry tools are enabled', () => {
    const source = readFileSync('src/orchestrator/llmFollowUpActivity.ts', 'utf8');

    expect(source).toContain('Do not stop at intermediate retrieval results');
    expect(source).toContain("If the request is not yet fulfilled and more tools are available, call the next required tool.");
    expect(source).toContain('Never return raw tool dumps or discovery blobs to the user as the final answer.');
    expect(source).toContain('input.enableRetry && input.tools?.length');
  });

  it('preserves follow-up tool calls even when the model also returns text', () => {
    const source = readFileSync('src/orchestrator/llmFollowUpActivity.ts', 'utf8');

    expect(source).toContain('const effectiveRetryToolCalls = synthesizedToolCall');
    expect(source).toContain('if (effectiveRetryToolCalls.length > 0 && retryTools)');
    expect(source).not.toContain('if (!llmContent && retryToolCalls.length > 0 && retryTools)');
  });

  it('returns an honest blocker instead of a raw discovery dump for inline-image email requests', () => {
    return loadFollowUpModule().then(({ buildFallbackToolResultContent }) => {
      const content = buildFallbackToolResultContent(
      [
        {
          role: 'user',
          content: 'Please send an email with this gif inline in the message body.',
        },
      ],
      [
        {
          toolCallId: '1',
          toolName: 'helkin_skill_search',
          success: true,
          result: { tools: ['outlook_send_email'] },
        },
        {
          toolCallId: '2',
          toolName: 'outlook_list_attachments',
          success: true,
          result: { attachments: [] },
        },
      ],
      );

      expect(content).toContain('does not yet have a reliable path to send an Outlook email with a Teams-provided image or GIF embedded inline');
      expect(content).toContain('I did not send the requested inline-image email');
    });
  });
});