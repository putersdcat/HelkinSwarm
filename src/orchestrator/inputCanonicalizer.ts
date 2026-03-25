// Input canonicalization — normalizes user input before it reaches the LLM.
// Fix: #138, Refactored: #270
// Spec ref: docs/ADDENDA/ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md

/** Structured change record for a single normalization application. */
export interface NormalizationChange {
  rule: string;
  description: string;
}

export interface CanonicalizationResult {
  originalText: string;
  text: string;
  changes: NormalizationChange[];
}

/** Input modality — determines which rules run. */
export type InputModality = 'text' | 'voice' | 'transcript';

/** A pluggable normalization rule. */
export interface NormalizationRule {
  name: string;
  /** Modalities this rule applies to. Undefined = all modalities. */
  modalities?: InputModality[];
  apply(text: string): { text: string; changes: NormalizationChange[] };
}

// ---------------------------------------------------------------------------
// Rule 1 — Email addresses in angle brackets: "Bob Smith <bob@co.com>" → "bob@co.com"
// ---------------------------------------------------------------------------
const ANGLE_BRACKET_EMAIL = /<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g;

const angleBracketEmailRule: NormalizationRule = {
  name: 'angle-bracket-email',
  apply(text) {
    const changes: NormalizationChange[] = [];
    const result = text.replace(ANGLE_BRACKET_EMAIL, (_match, email: string) => {
      changes.push({ rule: 'angle-bracket-email', description: `Extracted email from angle brackets: ${email}` });
      return email;
    });
    return { text: result, changes };
  },
};

// ---------------------------------------------------------------------------
// Rule 2 — UPN whitespace: "eric.anderson @domain.com" → "eric.anderson@domain.com"
// ---------------------------------------------------------------------------
const UPN_WHITESPACE = /([a-zA-Z0-9._%+-]+)\s+@\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

const upnWhitespaceRule: NormalizationRule = {
  name: 'upn-whitespace',
  apply(text) {
    const changes: NormalizationChange[] = [];
    const result = text.replace(UPN_WHITESPACE, (_match, local: string, domain: string) => {
      changes.push({ rule: 'upn-whitespace', description: `Fixed UPN whitespace: ${local}@${domain}` });
      return `${local}@${domain}`;
    });
    return { text: result, changes };
  },
};

// ---------------------------------------------------------------------------
// Rule 3 — Jira key normalization: "fixes issue helm-123" → "fixes issue HELM-123"
// ---------------------------------------------------------------------------
const JIRA_KEY = /\b([a-zA-Z]{2,10})-(\d{1,6})\b/g;

const jiraKeyRule: NormalizationRule = {
  name: 'jira-key',
  apply(text) {
    const changes: NormalizationChange[] = [];
    const result = text.replace(JIRA_KEY, (_match, project: string, number: string) => {
      const upper = project.toUpperCase();
      if (upper !== project) {
        changes.push({ rule: 'jira-key', description: `Uppercased Jira key: ${upper}-${number}` });
      }
      return `${upper}-${number}`;
    });
    return { text: result, changes };
  },
};

// ---------------------------------------------------------------------------
// Rule 4 — Git ref case normalization: known refs to canonical lowercase
// ---------------------------------------------------------------------------
const CANONICAL_REFS = new Set(['main', 'master', 'develop', 'head', 'origin']);

const gitRefRule: NormalizationRule = {
  name: 'git-ref',
  apply(text) {
    const changes: NormalizationChange[] = [];
    const result = text.replace(
      /\b(branch|ref|checkout|merge|rebase|pull|push)\s+([A-Z][A-Za-z]+)\b/g,
      (match, cmd: string, ref: string) => {
        const lower = ref.toLowerCase();
        if (CANONICAL_REFS.has(lower)) {
          changes.push({ rule: 'git-ref', description: `Normalized git ref: ${ref} → ${lower}` });
          return `${cmd} ${lower}`;
        }
        return match;
      },
    );
    return { text: result, changes };
  },
};

// ---------------------------------------------------------------------------
// Rule 5 — Whitespace normalization: collapse multiple spaces/newlines
// ---------------------------------------------------------------------------
const whitespaceRule: NormalizationRule = {
  name: 'whitespace',
  apply(text) {
    const changes: NormalizationChange[] = [];
    const collapsed = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (collapsed !== text.trim()) {
      changes.push({ rule: 'whitespace', description: 'Collapsed excessive whitespace' });
    }
    return { text: collapsed, changes };
  },
};

// ---------------------------------------------------------------------------
// Default rule set — ordered by priority
// ---------------------------------------------------------------------------

const DEFAULT_RULES: NormalizationRule[] = [
  angleBracketEmailRule,
  upnWhitespaceRule,
  jiraKeyRule,
  gitRefRule,
  whitespaceRule,
];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Applies normalization rules to user input. Returns normalized text,
 * original text, and a structured change log.
 *
 * @param text - Raw user input
 * @param modality - Input modality (default: 'text')
 * @param rules - Optional rule overrides (default: all built-in rules)
 */
export function canonicalizeInput(
  text: string,
  modality: InputModality = 'text',
  rules: NormalizationRule[] = DEFAULT_RULES,
): CanonicalizationResult {
  const allChanges: NormalizationChange[] = [];
  let result = text;

  for (const rule of rules) {
    // Skip rules that don't apply to this modality
    if (rule.modalities && !rule.modalities.includes(modality)) continue;

    const { text: newText, changes } = rule.apply(result);
    result = newText;
    allChanges.push(...changes);
  }

  return { originalText: text, text: result, changes: allChanges };
}
