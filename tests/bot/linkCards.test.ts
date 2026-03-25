import { describe, expect, it } from 'vitest';
import {
  buildSkillLinkSigninCard,
  buildSkillRelinkSigninCard,
} from '../../src/bot/linkCards.js';

describe('skill link sign-in cards', () => {
  it('builds a signin card for initial linking', () => {
    const card = buildSkillLinkSigninCard(
      'Microsoft Account',
      'Sign in to grant HelkinSwarm access to your email, calendar, and files',
      'https://token.botframework.com/link',
    );

    expect(card.contentType).toContain('signin');
    expect(card.content).toMatchObject({
      buttons: [
        {
          title: '🔗 Link Microsoft Account',
          value: 'https://token.botframework.com/link',
        },
      ],
      text: 'Sign in to grant HelkinSwarm access to your email, calendar, and files',
    });
  });

  it('builds a signin card for relinking', () => {
    const card = buildSkillRelinkSigninCard(
      'Microsoft Account',
      'Sign in again',
      'https://token.botframework.com/relink',
    );

    expect(card.contentType).toContain('signin');
    expect(card.content).toMatchObject({
      buttons: [
        {
          title: '🔗 Relink Microsoft Account',
          value: 'https://token.botframework.com/relink',
        },
      ],
      text: 'Sign in again',
    });
  });
});