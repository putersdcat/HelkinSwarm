// Operator Domain Priors — heuristic pre-processing rules for the operator (Eric Anderson).
// These encode implicit context about the owner's environment and habits into the system prompt.
// Fix: #144
// Spec ref: docs/ADDENDA/ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md

export type PriorConfidence = 'high' | 'medium';

export interface OperatorPrior {
  id: string;
  description: string;
  confidence: PriorConfidence;
  /** System prompt fragment injected for high-confidence rules. */
  promptFragment: string;
}

// ---------------------------------------------------------------------------
// Default operator priors — version 1
// ---------------------------------------------------------------------------

const OPERATOR_PRIORS: readonly OperatorPrior[] = [
  {
    id: 'email-whitespace-fix',
    description: 'Email addresses in angle brackets may have whitespace issues; input canonicalization handles this.',
    confidence: 'high',
    promptFragment: 'When users provide email addresses in angle brackets, extract the raw email address.',
  },
  {
    id: 'upn-trailing-space',
    description: 'UPN with whitespace around @ is a common typo.',
    confidence: 'high',
    promptFragment: 'User Principal Names with spaces around @ are typos — treat "user @domain.com" as "user@domain.com".',
  },
  {
    id: 'jira-key-uppercase',
    description: 'Jira project keys are always uppercase (e.g., HELM-123).',
    confidence: 'high',
    promptFragment: 'Always uppercase Jira project keys in your responses (e.g., HELM-123, not helm-123).',
  },
  {
    id: 'git-refs-case-sensitive',
    description: 'Git refs like branch names are case-sensitive; common refs should be lowercase.',
    confidence: 'medium',
    promptFragment: 'Git refs like "main", "master", "develop" should be lowercase. If the user writes "Main", confirm they mean "main".',
  },
] as const;

/** Returns all priors. */
export function getAllPriors(): readonly OperatorPrior[] {
  return OPERATOR_PRIORS;
}

/** Returns only high-confidence priors (auto-apply). */
export function getHighConfidencePriors(): OperatorPrior[] {
  return OPERATOR_PRIORS.filter((p) => p.confidence === 'high');
}

/** Returns medium-confidence priors (log and surface). */
export function getMediumConfidencePriors(): OperatorPrior[] {
  return OPERATOR_PRIORS.filter((p) => p.confidence === 'medium');
}

/**
 * Build the system prompt fragment for operator domain priors.
 * High-confidence rules are injected directly.
 * Medium-confidence rules are listed as "verify with user" hints.
 */
export function buildPriorsPromptFragment(): string {
  const highParts = getHighConfidencePriors().map((p) => `- ${p.promptFragment}`);
  const medParts = getMediumConfidencePriors().map(
    (p) => `- [Verify] ${p.promptFragment}`,
  );

  const sections: string[] = [];
  if (highParts.length > 0) {
    sections.push(`Operator rules (auto-apply):\n${highParts.join('\n')}`);
  }
  if (medParts.length > 0) {
    sections.push(`Operator hints (verify before applying):\n${medParts.join('\n')}`);
  }

  return sections.join('\n\n');
}
