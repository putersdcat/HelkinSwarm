import type { ScopedTokenScope } from './scopedTokenMinter.js';

/**
 * Map manifest privilege class to the scoped token scope requested by executors/handlers.
 * Read-only tools still need delegated read tokens for Graph-backed skills.
 */
export function mapPrivilegeClassToScopedTokenScope(
  privilegeClass: string | undefined,
): ScopedTokenScope | null {
  switch (privilegeClass) {
    case 'read-only':
      return 'read';
    case 'read-write':
    case 'create':
      return 'write';
    case 'delete':
      return 'delete';
    default:
      return null;
  }
}