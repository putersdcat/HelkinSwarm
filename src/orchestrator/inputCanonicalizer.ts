// Input canonicalization — normalizes user input before it reaches the LLM.
// Fix: #138
// Spec ref: docs/ADDENDA/ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md

export interface CanonicalizationResult {
  text: string;
  changes: string[];
}

// ---------------------------------------------------------------------------
// Rule 1 — Email addresses in angle brackets: "Bob Smith <bob@co.com>" → "bob@co.com"
// ---------------------------------------------------------------------------
const ANGLE_BRACKET_EMAIL = /<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/g;

function canonicalizeAngleBracketEmails(text: string, changes: string[]): string {
  return text.replace(ANGLE_BRACKET_EMAIL, (_match, email: string) => {
    changes.push(`Extracted email from angle brackets: ${email}`);
    return email;
  });
}

// ---------------------------------------------------------------------------
// Rule 2 — UPN whitespace: "eric.anderson @domain.com" → "eric.anderson@domain.com"
// ---------------------------------------------------------------------------
const UPN_WHITESPACE = /([a-zA-Z0-9._%+-]+)\s+@\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

function canonicalizeUpnWhitespace(text: string, changes: string[]): string {
  return text.replace(UPN_WHITESPACE, (_match, local: string, domain: string) => {
    changes.push(`Fixed UPN whitespace: ${local}@${domain}`);
    return `${local}@${domain}`;
  });
}

// ---------------------------------------------------------------------------
// Rule 3 — Whitespace normalization: collapse multiple spaces/newlines
// ---------------------------------------------------------------------------
function canonicalizeWhitespace(text: string, changes: string[]): string {
  const collapsed = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (collapsed !== text.trim()) {
    changes.push('Collapsed excessive whitespace');
  }
  return collapsed;
}

// ---------------------------------------------------------------------------
// Rule 4 — Jira key normalization: "fixes issue helm-123" → "fixes issue HELM-123"
// ---------------------------------------------------------------------------
const JIRA_KEY = /\b([a-zA-Z]{2,10})-(\d{1,6})\b/g;

function canonicalizeJiraKeys(text: string, changes: string[]): string {
  return text.replace(JIRA_KEY, (_match, project: string, number: string) => {
    const upper = project.toUpperCase();
    if (upper !== project) {
      changes.push(`Uppercased Jira key: ${upper}-${number}`);
    }
    return `${upper}-${number}`;
  });
}

// ---------------------------------------------------------------------------
// Rule 5 — Git ref case normalization: known refs to canonical lowercase
// ---------------------------------------------------------------------------
const CANONICAL_REFS = new Set(['main', 'master', 'develop', 'head', 'origin']);

function canonicalizeGitRefs(text: string, changes: string[]): string {
  // Match words that look like git refs (preceded by branch-like context)
  return text.replace(
    /\b(branch|ref|checkout|merge|rebase|pull|push)\s+([A-Z][A-Za-z]+)\b/g,
    (match, cmd: string, ref: string) => {
      const lower = ref.toLowerCase();
      if (CANONICAL_REFS.has(lower)) {
        changes.push(`Normalized git ref: ${ref} → ${lower}`);
        return `${cmd} ${lower}`;
      }
      return match;
    },
  );
}

// ---------------------------------------------------------------------------
// Rule 6 — DevLoop protocol sanitization (fix: #146)
// Strip DEVLOOP/SWARM/HUMAN prefixes, correlation tags, and "OVER" suffixes
// before the message reaches the LLM. Azure's content filter flags these
// pseudo-military markers as jailbreak attempts.
// Mirrors the regex in HelkinSwarmBot.ts used for Prompt Shields pre-check.
// ---------------------------------------------------------------------------
function sanitizeDevloopProtocol(text: string, changes: string[]): string {
  let result = text;
  const prefixMatch = result.match(/^(?:DEVLOOP|SWARM|HUMAN):\s*/i);
  if (prefixMatch) {
    result = result.slice(prefixMatch[0].length);
    changes.push(`Stripped protocol prefix: ${prefixMatch[0].trim()}`);
  }
  const tagsBefore = result;
  result = result.replace(/\[(?:probe|DL)-[^\]]*\]\s*/gi, '');
  if (result !== tagsBefore) {
    changes.push('Stripped DevLoop correlation tags');
  }
  const overMatch = result.match(/\s*OVER\s*$/i);
  if (overMatch) {
    result = result.slice(0, -overMatch[0].length);
    changes.push('Stripped protocol OVER suffix');
  }
  return result.trim();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Applies all canonicalization rules to user input. Returns normalized text + change log. */
export function canonicalizeInput(text: string): CanonicalizationResult {
  const changes: string[] = [];
  let result = text;

  result = sanitizeDevloopProtocol(result, changes);
  result = canonicalizeAngleBracketEmails(result, changes);
  result = canonicalizeUpnWhitespace(result, changes);
  result = canonicalizeJiraKeys(result, changes);
  result = canonicalizeGitRefs(result, changes);
  result = canonicalizeWhitespace(result, changes);

  return { text: result, changes };
}
