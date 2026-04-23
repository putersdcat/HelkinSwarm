import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #687 action item 2 — deliverable second-chance routing.
// The strict `activeSessionRoutable` resolver only fires when a sibling is at
// exactly `awaiting-ingress`. AI 2 adds a second-chance route through the
// looser `resolveDeliverableOverseerInstanceId` for the delivery decision, so
// non-routable-but-deliverable siblings receive `NewMessage` instead of
// triggering a fresh `startNew` (the bug #687 was filed against).

const botSrc = readFileSync(
  join(process.cwd(), 'src', 'bot', 'HelkinSwarmBot.ts'),
  'utf-8',
);

describe('Bot deliverable second-chance routing lock (#687 AI 2)', () => {
  it('imports the deliverable resolver alongside the strict summary resolver', () => {
    expect(botSrc).toMatch(
      /import \{ resolveActiveOverseerSummary, resolveDeliverableOverseerInstanceId \} from '\.\.\/orchestrator\/activeOverseerInstance\.js';/,
    );
  });

  it('carries the [#687 action item 2] rationale comment in source', () => {
    expect(botSrc).toMatch(/\[#687 action item 2\][\s\S]{0,200}?Deliverable second-chance route/);
  });

  it('calls resolveDeliverableOverseerInstanceId AFTER the strict activeSessionRoutable branch', () => {
    const strictIdx = botSrc.indexOf('if (activeSessionRoutable && effectiveActiveInstanceId)');
    const deliverableIdx = botSrc.indexOf('await resolveDeliverableOverseerInstanceId(client, userId)');
    expect(strictIdx).toBeGreaterThan(0);
    expect(deliverableIdx).toBeGreaterThan(strictIdx);
  });

  it('the deliverable second-chance happens BEFORE startNew, not after', () => {
    const deliverableIdx = botSrc.indexOf('await resolveDeliverableOverseerInstanceId(client, userId)');
    const startNewIdx = botSrc.indexOf("await client.startNew('overseer'");
    expect(deliverableIdx).toBeGreaterThan(0);
    expect(startNewIdx).toBeGreaterThan(deliverableIdx);
  });

  it('skips self-routing — does not raise NewMessage to the bot\'s own pending instanceId', () => {
    expect(botSrc).toMatch(
      /deliverableInstanceId\s*&&\s*deliverableInstanceId !== identity\.instanceId/,
    );
  });

  it('emits PolicyOverrideApplied with the deliverable-redirection authority', () => {
    expect(botSrc).toMatch(/authority:\s*'living-session-deliverable-redirection'/);
  });

  it('raises NewMessage to the deliverable instance and returns started outcome', () => {
    expect(botSrc).toMatch(
      /await client\.raiseEvent\(deliverableInstanceId, 'NewMessage', event\);[\s\S]{0,80}?return \{ outcome: 'started' \};/,
    );
  });
});
