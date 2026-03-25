import { describe, expect, it } from 'vitest';
import {
  buildAcceptedAudiences,
  extractBearerToken,
  isAcceptedIssuer,
} from '../../src/auth/tabTokenValidator.js';

describe('tabTokenValidator helpers', () => {
  it('extracts bearer tokens from authorization headers', () => {
    expect(extractBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(extractBearerToken('bearer xyz')).toBe('xyz');
    expect(extractBearerToken('Basic nope')).toBeUndefined();
    expect(extractBearerToken(null)).toBeUndefined();
  });

  it('builds accepted Teams tab audiences from the delegated auth client id', () => {
    expect(buildAcceptedAudiences('client-id-123')).toEqual([
      'client-id-123',
      'api://client-id-123',
      'api://helkinswarmtabsst.z20.web.core.windows.net/client-id-123',
    ]);
  });

  it('accepts the expected Microsoft issuers for the configured tenant', () => {
    const tenantId = '11111111-2222-3333-4444-555555555555';
    expect(isAcceptedIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`, tenantId)).toBe(true);
    expect(isAcceptedIssuer(`https://sts.windows.net/${tenantId}/`, tenantId)).toBe(true);
    expect(isAcceptedIssuer('https://login.microsoftonline.com/common/v2.0', tenantId)).toBe(false);
  });
});