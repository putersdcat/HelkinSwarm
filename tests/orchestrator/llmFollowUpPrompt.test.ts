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

  it('returns an honest blocker when an inline-email runtime asset reference has expired or cannot be resolved', () => {
    return loadFollowUpModule().then(({ buildFallbackToolResultContent }) => {
      const content = buildFallbackToolResultContent(
        [
          {
            role: 'user',
            content: 'Please send this image inline in the email body.',
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
            toolName: 'outlook_send_email',
            success: false,
            error: "Runtime asset '11111111-1111-1111-1111-111111111111' is not available anymore. Please upload or re-materialize it again before sending the email.",
          },
        ],
      );

      expect(content).toContain('The referenced runtime asset is no longer available');
      expect(content).toContain('Please upload or re-materialize the image again and retry');
      expect(content).not.toContain('helkin_skill_search');
    });
  });

  it('returns an honest blocker when cid mappings do not match supplied inline runtime assets', () => {
    return loadFollowUpModule().then(({ buildFallbackToolResultContent }) => {
      const content = buildFallbackToolResultContent(
        [
          {
            role: 'user',
            content: 'Please send this gif inline in the email body.',
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
            toolName: 'outlook_send_email',
            success: false,
            error: 'Inline runtime-asset email composition could not be completed. The HTML body references cid:gif-inline, but matching inline runtime assets were not supplied. I have not sent the requested email.',
          },
        ],
      );

      expect(content).toContain('I couldn’t complete that email request');
      expect(content).toContain('I did not send the requested inline-image email');
      expect(content).not.toContain('helkin_skill_search');
    });
  });

  it('stops retrying an identical tool call after a deterministic unsupported-action failure', () => {
    return loadFollowUpModule().then(({ shouldStopOnRepeatedToolFailure }) => {
      const shouldStop = shouldStopOnRepeatedToolFailure(
        [
          {
            name: 'outlook_send_email',
            arguments: '{"subject":"cid guard probe retry"}',
          },
        ],
        [
          {
            assistantContent: '',
            assistantToolCalls: [
              {
                id: 'prior-1',
                name: 'outlook_send_email',
                arguments: '{"subject":"cid guard probe"}',
              },
            ],
            toolResults: [
              {
                toolCallId: 'prior-1',
                toolName: 'outlook_send_email',
                success: false,
                error: 'Embedded inline images in outgoing Outlook email are not supported yet. I have not sent the requested inline-image email.',
              },
            ],
          },
        ],
      );

      expect(shouldStop).toBe(true);
    });
  });
});