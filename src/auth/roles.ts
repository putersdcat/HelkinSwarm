// Application-Level RBAC — HelkinSwarm role model.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md §5.4
// Issue: #248
//
// MVP: Two roles — owner (primary user, all permissions) and guest (read-only).
// Future: Entra ID group / JWT-claim backed role assignment for multi-user stamps.

import { isOwnerUserId } from '../bot/maintenanceMode.js';

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

export type HelkinRole = 'owner' | 'guest';

/**
 * Privileged operations and their required minimum role.
 * Used by tools that need role checks before executing.
 */
export const ROLE_REQUIREMENTS: Record<string, HelkinRole> = {
  // System management
  'helkin_forget_skill': 'owner',
  'helkin_uninstall_skill': 'owner',
  'helkin_save_preferences': 'owner',

  // GitHub write operations
  'github_create_issue': 'owner',
  'github_update_issue': 'owner',
  'github_close_issue': 'owner',
  'github_create_pr': 'owner',

  // Control plane / infrastructure
  'helkin_get_costs': 'owner',

  // Confirmation-gated tools — already guarded by requiresConfirmation=true,
  // but role-check provides an additional defence layer.
  'helkin_test_confirmation': 'owner',
};

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the HelkinRole for a given userId.
 * - Owner: primary user (OWNER_USER_ID env var or first entry in user-map.json)
 * - Guest: everyone else
 */
export async function getUserRole(userId: string): Promise<HelkinRole> {
  const isOwner = await isOwnerUserId(userId);
  return isOwner ? 'owner' : 'guest';
}

/**
 * Check whether a userId has the required role to invoke a named tool.
 * Returns true if allowed, false if blocked.
 */
export async function canInvokeTool(userId: string, toolName: string): Promise<boolean> {
  const required = ROLE_REQUIREMENTS[toolName];
  if (!required) {
    // No role restriction — all roles allowed
    return true;
  }
  if (required === 'owner') {
    return isOwnerUserId(userId);
  }
  // Future: expand for sub-roles when multi-user stamps are added
  return true;
}

/**
 * Return a human-readable role summary for display in helkin_whoami / diagnostics.
 */
export async function getRoleSummary(userId: string): Promise<{
  role: HelkinRole;
  privilegedTools: string[];
  description: string;
}> {
  const role = await getUserRole(userId);
  const privilegedTools = Object.entries(ROLE_REQUIREMENTS)
    .filter(([, required]) => required === 'owner')
    .map(([toolName]) => toolName);

  const descriptions: Record<HelkinRole, string> = {
    owner: 'Full access — all tools, write operations, and system management.',
    guest: 'Read-only access — informational tools only. Write operations are blocked.',
  };

  return {
    role,
    privilegedTools: role === 'owner' ? privilegedTools : [],
    description: descriptions[role],
  };
}
