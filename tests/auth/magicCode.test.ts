import { describe, expect, it } from 'vitest';
import { extractBotFrameworkAuthCode } from '../../src/auth/magicCode.js';

describe('extractBotFrameworkAuthCode', () => {
  it('extracts 32-character hexadecimal Bot Framework validation codes', () => {
    expect(extractBotFrameworkAuthCode('a5dbabb15893422ab4d8dbc1e39b5600')).toBe('a5dbabb15893422ab4d8dbc1e39b5600');
    expect(extractBotFrameworkAuthCode('A5DBABB15893422AB4D8DBC1E39B5600')).toBe('A5DBABB15893422AB4D8DBC1E39B5600');
  });

  it('extracts 6-digit Bot Framework fallback codes', () => {
    expect(extractBotFrameworkAuthCode('181746')).toBe('181746');
    expect(extractBotFrameworkAuthCode('Here is the code: 181746')).toBe('181746');
  });

  it('rejects non-auth-code values', () => {
    expect(extractBotFrameworkAuthCode('/link outlook')).toBeUndefined();
    expect(extractBotFrameworkAuthCode('Issue 181746')).toBe('181746');
    expect(extractBotFrameworkAuthCode('not-a-code')).toBeUndefined();
  });
});