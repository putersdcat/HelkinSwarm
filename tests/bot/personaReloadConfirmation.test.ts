// Tests for persona reload confirmation card (#487 AC3)
import { describe, it, expect } from 'vitest';
import { buildPersonaReloadCard } from '../../src/bot/confirmationCards.js';

describe('buildPersonaReloadCard', () => {
  const baseData = {
    userId: 'user-001',
    currentPreview: 'You are HelkinSwarm — a personal sovereign AI copilot...',
    newPreview: 'You are HelkinSwarm v2 — upgraded persona with new directives...',
  };

  it('returns an Adaptive Card attachment', () => {
    const attachment = buildPersonaReloadCard(baseData);
    expect(attachment.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(attachment.content).toBeDefined();
    expect(attachment.content.type).toBe('AdaptiveCard');
    expect(attachment.content.version).toBe('1.4');
  });

  it('includes current and new persona previews in card body', () => {
    const attachment = buildPersonaReloadCard(baseData);
    const body = attachment.content.body as Array<{ type: string; text: string }>;
    const texts = body.map((b) => b.text);
    expect(texts).toContain(baseData.currentPreview);
    expect(texts).toContain(baseData.newPreview);
  });

  it('shows fallback text when currentPreview is empty', () => {
    const attachment = buildPersonaReloadCard({ ...baseData, currentPreview: '' });
    const body = attachment.content.body as Array<{ type: string; text: string }>;
    const texts = body.map((b) => b.text);
    expect(texts).toContain('_(not loaded yet — first prompt will load)_');
  });

  it('shows fallback text when newPreview is empty', () => {
    const attachment = buildPersonaReloadCard({ ...baseData, newPreview: '' });
    const body = attachment.content.body as Array<{ type: string; text: string }>;
    const texts = body.map((b) => b.text);
    expect(texts).toContain('_(empty or unreadable)_');
  });

  it('has two actions with correct verbs and distinct action values', () => {
    const attachment = buildPersonaReloadCard(baseData);
    const actions = attachment.content.actions as Array<{
      type: string;
      verb: string;
      title: string;
      data: { action: string; userId: string };
    }>;
    expect(actions).toHaveLength(2);

    const approve = actions.find((a) => a.title.includes('Activate'));
    const deny = actions.find((a) => a.title.includes('Keep Current'));

    expect(approve).toBeDefined();
    expect(approve!.verb).toBe('confirm_persona_reload');
    expect(approve!.data.action).toBe('approved');
    expect(approve!.data.userId).toBe('user-001');

    expect(deny).toBeDefined();
    expect(deny!.verb).toBe('confirm_persona_reload');
    expect(deny!.data.action).toBe('denied');
    expect(deny!.data.userId).toBe('user-001');
  });
});
