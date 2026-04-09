import { describe, expect, it } from 'vitest';
import { buildRecentUserMessageRing } from '../../src/bot/conversationStore.js';

describe('buildRecentUserMessageRing', () => {
  it('appends the newest human message while keeping a bounded ring', () => {
    const ring = buildRecentUserMessageRing([
      'one',
      'two',
      'three',
    ], 'four');

    expect(ring).toEqual(['one', 'two', 'three', 'four']);
  });

  it('normalizes whitespace and trims to the last ten messages', () => {
    const ring = buildRecentUserMessageRing(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      '   11   ',
    );

    expect(ring).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  });
});