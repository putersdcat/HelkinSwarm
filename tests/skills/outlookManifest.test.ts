import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

type InputSchema = {
  properties?: Record<string, unknown>;
};

type ToolEntry = {
  name: string;
  requiresConfirmation?: boolean;
  aliases?: string[];
  discoveryTerms?: string[];
  useWhen?: string[];
  typicalInputs?: string[];
  inputSchema?: InputSchema;
};

describe('outlook manifest safety flags', () => {
  it('keeps the current confirmation flags for Outlook write actions', () => {
    const manifest = JSON.parse(readFileSync('skills/outlook/manifest.json', 'utf8')) as {
      tools: ToolEntry[];
    };

    const send = manifest.tools.find((tool) => tool.name === 'outlook_send_email');
    const replyLatest = manifest.tools.find((tool) => tool.name === 'outlook_reply_to_latest_email');
    const createEvent = manifest.tools.find((tool) => tool.name === 'outlook_create_calendar_event');

    expect(send?.requiresConfirmation).toBe(true);
    expect(send?.description).toContain('does not support embedded inline images or file attachments yet');
    expect(replyLatest?.requiresConfirmation).toBe(false);
    expect(createEvent?.requiresConfirmation).toBe(true);
  });

  it('surfaces calendar creation as a discovery-first entry tool with reminder support', () => {
    const manifest = JSON.parse(readFileSync('skills/outlook/manifest.json', 'utf8')) as {
      tools: ToolEntry[];
      recommendedEntryTools: string[];
    };

    const createEvent = manifest.tools.find((tool) => tool.name === 'outlook_create_calendar_event');

    expect(manifest.recommendedEntryTools).toContain('outlook_create_calendar_event');
    expect(createEvent?.aliases?.length).toBeGreaterThan(0);
    expect(createEvent?.discoveryTerms).toContain('calendar reminder');
    expect(createEvent?.useWhen?.length).toBeGreaterThan(0);
    expect(createEvent?.typicalInputs?.length).toBeGreaterThan(0);
    expect(createEvent?.inputSchema?.properties).toHaveProperty('reminderMinutesBeforeStart');
  });

  it('advertises attachment metadata and download tools for Outlook messages', () => {
    const manifest = JSON.parse(readFileSync('skills/outlook/manifest.json', 'utf8')) as {
      tools: ToolEntry[];
      recommendedEntryTools: string[];
      discoveryHints?: string[];
    };

    const listAttachments = manifest.tools.find((tool) => tool.name === 'outlook_list_attachments');
    const downloadAttachment = manifest.tools.find((tool) => tool.name === 'outlook_download_attachment');
    const readEmail = manifest.tools.find((tool) => tool.name === 'outlook_read_email');

    expect(readEmail?.description).toContain('attachment metadata');
    expect(listAttachments?.inputSchema?.properties).toHaveProperty('messageId');
    expect(downloadAttachment?.inputSchema?.properties).toHaveProperty('attachmentId');
    expect(manifest.recommendedEntryTools).toContain('outlook_list_attachments');
    expect(manifest.discoveryHints).toContain('attachment');
  });
});