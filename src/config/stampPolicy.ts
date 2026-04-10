import { z } from 'zod';
import { hasAuthority, type HelkinAuthority } from '../auth/roles.js';

const PolicyAuthoritySchema = z.enum(['tool-use', 'policy-override', 'policy-override-high-risk']);

const ConfirmationBypassRuleSchema = z.object({
  toolName: z.string().min(1),
  requiredAuthority: PolicyAuthoritySchema.default('policy-override-high-risk'),
  enabled: z.boolean().default(true),
  reason: z.string().min(1),
});

const StampPolicySchema = z.object({
  confirmationBypass: z.array(ConfirmationBypassRuleSchema).default([]),
});

export type ConfirmationBypassRule = z.infer<typeof ConfirmationBypassRuleSchema>;
export type StampPolicy = z.infer<typeof StampPolicySchema>;

let cachedStampPolicy: StampPolicy | undefined;

function buildEnvBackedPolicy(): StampPolicy {
  const allowOutlookSendBypass = process.env['STAMP_POLICY_ALLOW_OUTLOOK_SEND_WITHOUT_CONFIRMATION']?.toLowerCase() === 'true';
  const allowVaultWriteBypass = process.env['STAMP_POLICY_ALLOW_VAULT_WRITE_WITHOUT_CONFIRMATION']?.toLowerCase() === 'true';
  const rules: ConfirmationBypassRule[] = [];

  if (allowOutlookSendBypass) {
    rules.push({
      toolName: 'outlook_send_email',
      requiredAuthority: 'policy-override-high-risk',
      enabled: true,
      reason: 'Primary developer stamp override for Outlook send confirmation.',
    });
  }

  if (allowVaultWriteBypass) {
    rules.push(
      {
        toolName: 'vault_store_secret',
        requiredAuthority: 'policy-override-high-risk',
        enabled: true,
        reason: 'Primary developer stamp override for vault write confirmation.',
      },
      {
        toolName: 'vault_delete_secret',
        requiredAuthority: 'policy-override-high-risk',
        enabled: true,
        reason: 'Primary developer stamp override for vault delete confirmation.',
      },
    );
  }

  return { confirmationBypass: rules };
}

function loadStampPolicy(): StampPolicy {
  const raw = process.env['STAMP_POLICY_JSON'];
  if (!raw || !raw.trim()) {
    return StampPolicySchema.parse(buildEnvBackedPolicy());
  }

  const parsed = JSON.parse(raw) as unknown;
  return StampPolicySchema.parse(parsed);
}

export function getStampPolicy(): StampPolicy {
  if (!cachedStampPolicy) {
    cachedStampPolicy = loadStampPolicy();
  }
  return cachedStampPolicy;
}

export function resetStampPolicyForTests(): void {
  cachedStampPolicy = undefined;
}

export async function getConfirmationBypassRule(
  userId: string,
  toolNames: string[],
): Promise<{ applies: boolean; authority?: HelkinAuthority; reason?: string }> {
  const policy = getStampPolicy();
  if (toolNames.length === 0) {
    return { applies: false };
  }

  const matchedRules: ConfirmationBypassRule[] = [];
  for (const toolName of toolNames) {
    const rule = policy.confirmationBypass.find((candidate) => candidate.enabled && candidate.toolName === toolName);
    if (!rule) {
      return { applies: false };
    }
    matchedRules.push(rule);
  }

  const requiredAuthority: HelkinAuthority = matchedRules.some((rule) => rule.requiredAuthority === 'policy-override-high-risk')
    ? 'policy-override-high-risk'
    : 'policy-override';

  const allowed = await hasAuthority(userId, requiredAuthority);
  if (!allowed) {
    return { applies: false, authority: requiredAuthority };
  }

  return {
    applies: true,
    authority: requiredAuthority,
    reason: matchedRules.map((rule) => rule.reason).join(' | '),
  };
}