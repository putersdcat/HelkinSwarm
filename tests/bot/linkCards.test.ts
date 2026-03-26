import { describe, expect, it } from 'vitest';
import {
  buildSkillLinkSigninCard,
  buildSkillRelinkSigninCard,
} from '../../src/bot/linkCards.js';

describe('skill link sign-in cards', () => {
  it('builds an openUrl hero card for initial linking', () => {
    const card = buildSkillLinkSigninCard(
      'Microsoft Account',
      'Sign in to grant HelkinSwarm access to your email, calendar, and files',
      'https://token.botframework.com/link',
    );

    expect(card.contentType).toContain('hero');
    expect(card.content).toMatchObject({
      buttons: [
        {
          type: 'openUrl',
          title: '🔗 Link Microsoft Account',
          value: 'https://token.botframework.com/link',
        },
      ],
      text: 'Sign in to grant HelkinSwarm access to your email, calendar, and files\n\nIf sign-in shows a code instead of finishing automatically, use Reply with quote on this message and paste the code in your reply.',
    });
  });

  it('builds an openUrl hero card for relinking', () => {
    const card = buildSkillRelinkSigninCard(
      'Microsoft Account',
      'Sign in again',
      'https://token.botframework.com/relink',
    );

    expect(card.contentType).toContain('hero');
    expect(card.content).toMatchObject({
      buttons: [
        {
          type: 'openUrl',
          title: '🔗 Relink Microsoft Account',
          value: 'https://token.botframework.com/relink',
        },
      ],
      text: 'Sign in again\n\nIf sign-in shows a code instead of finishing automatically, use Reply with quote on this message and paste the code in your reply.',
    });
  });
});