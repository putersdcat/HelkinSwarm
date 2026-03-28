import { describe, expect, it } from 'vitest';
import { mapPrivilegeClassToScopedTokenScope } from '../../src/auth/tokenScopeMapping.js';

describe('mapPrivilegeClassToScopedTokenScope', () => {
  it('maps read-only tools to delegated read scope', () => {
    expect(mapPrivilegeClassToScopedTokenScope('read-only')).toBe('read');
  });

  it('maps create and read-write tools to delegated write scope', () => {
    expect(mapPrivilegeClassToScopedTokenScope('create')).toBe('write');
    expect(mapPrivilegeClassToScopedTokenScope('read-write')).toBe('write');
  });

  it('maps delete tools to delegated delete scope', () => {
    expect(mapPrivilegeClassToScopedTokenScope('delete')).toBe('delete');
  });

  it('returns null for unknown privilege classes', () => {
    expect(mapPrivilegeClassToScopedTokenScope('admin')).toBeNull();
    expect(mapPrivilegeClassToScopedTokenScope(undefined)).toBeNull();
  });
});