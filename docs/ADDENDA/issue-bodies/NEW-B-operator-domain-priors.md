## Operator Domain Priors

Operator domain priors encode the implicit context of the owner (Eric Anderson) into the system prompt as heuristic rules. These pre-process common patterns specific to this deployment before LLM reasoning.

**Spec ref:** `docs/ADDENDA/ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md`

---

## Purpose

Every user has idiosyncratic patterns — email formats, project naming conventions, preferred tools. Operator priors capture these as explicit heuristic rules that fire before the LLM sees the input, ensuring consistent behavior without requiring the user to repeat themselves.

---

## Default Operator Prior Rules

| Rule ID | Description | Confidence | Policy |
|---------|-------------|------------|--------|
| `email-whitespace-fix` | Email addresses in angle brackets have whitespace issues | high | Apply input canonicalization before any processing |
| `upn-trailing-space` | UPN with trailing space before @ is a common typo | high | Canonicalize UPN format before Graph API calls |
| `jira-key-uppercase` | Jira project keys are always uppercase in Atlassian | high | Always uppercase Jira keys in issue references |
| `git-refs-case-sensitive` | Git refs (main, master, HEAD) are case-sensitive | medium | Normalize git ref casing to canonical lowercase form |

---

## File Format

**New file:** `src/persona/operatorDomainPriors.ts`

```typescript
export interface OperatorPrior {
  version: string;  // "1.0.0"
  rules: OperatorPriorRule[];
}

interface OperatorPriorRule {
  id: string;
  description: string;
  pattern: string;  // Regex or description
  confidence: "high" | "medium" | "low";
  policy: string;   // What to do when this matches
}

export const OPERATOR_DOMAIN_PRIORS: OperatorPrior = { ... };
```

---

## Integration

Rules are injected into the system prompt by `buildPromptActivity.ts` before the LLM call. High-confidence rules auto-apply. Medium-confidence rules are logged and surfaced for user confirmation.

---

## Acceptance Criteria

- [ ] Operator priors file is versioned (`version: "1.0.0"`)
- [ ] All 4 default rules are implemented
- [ ] High-confidence rules auto-apply without prompting
- [ ] Medium-confidence rules log match and surface to user
- [ ] No PII stored in operator prior rules
- [ ] Integration point in `buildPromptActivity.ts` verified
- [ ] Rules are extendable without code changes (future: stored in Cosmos)
