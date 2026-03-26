import { describe, expect, it } from 'vitest';
import { isLikelyBotFrameworkMagicCode } from '../../src/auth/magicCode.js';

describe('isLikelyBotFrameworkMagicCode', () => {
  it('accepts 32-character hexadecimal Bot Framework validation codes', () => {
    expect(isLikelyBotFrameworkMagicCode('a5dbabb15893422ab4d8dbc1e39b5600')).toBe(true);
    expect(isLikelyBotFrameworkMagicCode('A5DBABB15893422AB4D8DBC1E39B5600')).toBe(true);
  });

  it('rejects non-magic-code values', () => {
    expect(isLikelyBotFrameworkMagicCode('575066')).toBe(false);
    expect(isLikelyBotFrameworkMagicCode('/link outlook')).toBe(false);
    expect(isLikelyBotFrameworkMagicCode('not-a-code')).toBe(false);
  });
});