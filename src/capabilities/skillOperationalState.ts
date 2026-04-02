import type { CapabilityManifest } from './manifestSchema.js';

export type SkillOperationalState =
  | 'operational'
  | 'action-required'
  | 'operator-setup-required'
  | 'blocked';

export interface SkillOperationalAssessment {
  operationalState: SkillOperationalState;
  dependencies: string[];
  missingDependencies: string[];
  externalAccountsNeeded: string[];
  requiredPermissions: string[];
  onboardingMethod: string;
  steps: string[];
  message: string;
}

export function assessSkillOperationalState(
  manifest: CapabilityManifest,
  installedDomains: Iterable<string>,
): SkillOperationalAssessment {
  const installedDomainSet = installedDomains instanceof Set
    ? installedDomains
    : new Set(installedDomains);
  const requiredDeps = manifest.dependencies ?? [];
  const missingDeps = requiredDeps.filter((dep) => !installedDomainSet.has(dep));
  const externalAccounts = manifest.externalAccountsNeeded ?? [];
  const requiredPermissions = manifest.requiredPermissions ?? [];
  const onboardingMethod = manifest.onboardingMethod;
  const softOnboarding = manifest.softOnboarding;

  if (missingDeps.length > 0) {
    return {
      operationalState: 'blocked',
      dependencies: requiredDeps,
      missingDependencies: missingDeps,
      externalAccountsNeeded: externalAccounts,
      requiredPermissions,
      onboardingMethod,
      steps: [],
      message: `Skill '${manifest.domain}' requires these dependencies which are not installed: ${missingDeps.join(', ')}. Install them first.`,
    };
  }

  const hasChatRecoverableUserAction =
    onboardingMethod === 'post-install-link'
    || onboardingMethod === 'both'
    || Boolean(softOnboarding);
  const hasOperatorOrTenantPrerequisites =
    onboardingMethod === 'automatic-agentic'
    && (externalAccounts.length > 0 || requiredPermissions.length > 0);

  const operationalState: SkillOperationalState = hasOperatorOrTenantPrerequisites
    ? 'operator-setup-required'
    : hasChatRecoverableUserAction
      ? 'action-required'
      : 'operational';

  const steps: string[] = [];
  if (onboardingMethod === 'post-install-link' || onboardingMethod === 'both') {
    const linkName = manifest.linkConfig?.connectionName ?? manifest.domain;
    steps.push(`Complete OAuth authorisation via /link (connection: ${linkName})`);
  } else if (onboardingMethod === 'automatic-agentic' && operationalState === 'operator-setup-required') {
    steps.push('Automatic onboarding can continue once the prerequisites below are satisfied.');
  }

  if (externalAccounts.length > 0) {
    steps.push(`Create external account(s): ${externalAccounts.join(', ')}`);
  }
  if (requiredPermissions.length > 0) {
    steps.push(`Grant permissions: ${requiredPermissions.join(', ')}`);
  }
  if (softOnboarding) {
    steps.push('Complete first-run preference questions (soft onboarding).');
  }

  const message = operationalState === 'operational'
    ? `Skill '${manifest.domain}' is installed and ready to use.`
    : operationalState === 'action-required'
      ? `Skill '${manifest.domain}' is installed but still needs user action before it is fully operational.`
      : `Skill '${manifest.domain}' is installed but still needs operator or tenant setup before it is fully operational.`;

  return {
    operationalState,
    dependencies: requiredDeps,
    missingDependencies: missingDeps,
    externalAccountsNeeded: externalAccounts,
    requiredPermissions,
    onboardingMethod,
    steps,
    message,
  };
}