import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

type ToolEntry = {
  name: string;
  requiresConfirmation?: boolean;
};

describe('outlook manifest safety flags', () => {
  it('requires confirmation for high-risk Outlook mutation tools', () => {
    const manifest = JSON.parse(readFileSync('skills/outlook/manifest.json', 'utf8')) as {
      tools: ToolEntry[];
    };

    const send = manifest.tools.find((tool) => tool.name === 'outlook_send_email');
    const createEvent = manifest.tools.find((tool) => tool.name === 'outlook_create_calendar_event');

    expect(send?.requiresConfirmation).toBe(true);
    expect(createEvent?.requiresConfirmation).toBe(true);
  });
});