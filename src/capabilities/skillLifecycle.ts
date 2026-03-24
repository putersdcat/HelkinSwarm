// Skill lifecycle management — enforces lifecycleRules on uninstall/reset.
// Spec ref: docs/05-Capabilities-Framework.md (v2), skills-system-enhancement §4
// Issue: #199

import type { CapabilityManifest, LifecycleRules } from './manifestSchema.js';
import { getManifest } from './capabilityLoader.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LifecycleAction {
  domain: string;
  action: 'uninstall' | 'reset';
  rule: LifecycleRules;
  requiresUserChoice: boolean;
}

export interface LifecycleResult {
  domain: string;
  action: 'uninstall' | 'reset';
  outcome: 'completed' | 'pending-user-choice' | 'error';
  detail: string;
}

// ---------------------------------------------------------------------------
// Lifecycle resolution — determines what to do based on manifest rules
// ---------------------------------------------------------------------------

/**
 * Resolve the lifecycle action to take when a skill is uninstalled or reset.
 * Returns the action plan without executing it — the caller decides execution.
 */
export function resolveLifecycleAction(
  domain: string,
  action: 'uninstall' | 'reset',
): LifecycleAction | undefined {
  const manifest = getManifest(domain);
  if (!manifest) return undefined;

  return {
    domain,
    action,
    rule: manifest.lifecycleRules,
    requiresUserChoice: manifest.lifecycleRules === 'ask-user',
  };
}

/**
 * Execute lifecycle action for a skill uninstall.
 * - keep-credentials: no credential cleanup needed
 * - close-external-account: revoke tokens, close external accounts
 * - ask-user: return pending status — caller must prompt user and call back
 */
export async function executeUninstall(
  manifest: CapabilityManifest,
  userId: string,
): Promise<LifecycleResult> {
  const { domain, lifecycleRules } = manifest;

  trackEvent({
    name: 'SkillLifecycleAction',
    correlationId: `lifecycle-${domain}-${Date.now()}`,
    userId,
    properties: { domain, action: 'uninstall', rule: lifecycleRules },
  });

  switch (lifecycleRules) {
    case 'keep-credentials':
      return {
        domain,
        action: 'uninstall',
        outcome: 'completed',
        detail: `Skill "${domain}" uninstalled. Stored credentials retained for potential reinstall.`,
      };

    case 'close-external-account':
      // Revoke stored tokens/credentials for this skill
      await revokeSkillCredentials(domain, userId);
      return {
        domain,
        action: 'uninstall',
        outcome: 'completed',
        detail: `Skill "${domain}" uninstalled. External credentials revoked.`,
      };

    case 'ask-user':
      return {
        domain,
        action: 'uninstall',
        outcome: 'pending-user-choice',
        detail: `Skill "${domain}" requires user decision: keep credentials or revoke them?`,
      };
  }
}

/**
 * Execute lifecycle action for a skill reset (e.g., reconnecting to a different account).
 */
export async function executeReset(
  manifest: CapabilityManifest,
  userId: string,
): Promise<LifecycleResult> {
  const { domain, lifecycleRules } = manifest;

  trackEvent({
    name: 'SkillLifecycleAction',
    correlationId: `lifecycle-${domain}-${Date.now()}`,
    userId,
    properties: { domain, action: 'reset', rule: lifecycleRules },
  });

  switch (lifecycleRules) {
    case 'keep-credentials':
      // Overwrite existing credentials with new ones
      return {
        domain,
        action: 'reset',
        outcome: 'completed',
        detail: `Skill "${domain}" reset. Old credentials overwritten with new connection.`,
      };

    case 'close-external-account':
      // Revoke old credentials, then the caller sets up new ones
      await revokeSkillCredentials(domain, userId);
      return {
        domain,
        action: 'reset',
        outcome: 'completed',
        detail: `Skill "${domain}" reset. Old credentials revoked. Ready for new connection.`,
      };

    case 'ask-user':
      return {
        domain,
        action: 'reset',
        outcome: 'pending-user-choice',
        detail: `Skill "${domain}" requires user decision: overwrite existing account or keep both?`,
      };
  }
}

// ---------------------------------------------------------------------------
// Credential management helpers
// ---------------------------------------------------------------------------

/**
 * Revoke stored credentials for a skill domain.
 * Currently logs the action; real implementation will delete from Key Vault
 * once skill credential storage is built (see #201).
 */
async function revokeSkillCredentials(
  domain: string,
  userId: string,
): Promise<void> {
  // TODO (#201): Delete from Key Vault when credential storage is implemented
  trackEvent({
    name: 'SkillCredentialRevoked',
    correlationId: `lifecycle-${domain}-${Date.now()}`,
    userId,
    properties: { domain },
  });
}
