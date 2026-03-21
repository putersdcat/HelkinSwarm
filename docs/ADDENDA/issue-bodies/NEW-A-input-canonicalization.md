## Input Canonicalization

User input varies wildly in formatting. Canonicalization normalizes it before it reaches the LLM so the model sees consistent patterns regardless of how the user typed the request.

**Spec ref:** `docs/ADDENDA/ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md`

---

## Canonicalization Rules

### Rule 1 — Email Addresses in Angle Brackets
- Input: `"Bob Smith <bob@company.com>"` → Output: `"bob@company.com"`
- Common in Teams replies and email forwarding. The angle-bracket form has inconsistent whitespace.

### Rule 2 — UPN Whitespace
- Input: `"eric.anderson @EAnderson.com"` → Output: `"eric.anderson@EAnderson.com"`
- Trailing space before @ is a common typo in Teams chat.

### Rule 3 — Whitespace Normalization
- Collapses multiple spaces/newlines into single space. Applied after all other rules.

### Rule 4 — Jira Key Normalization
- Input: `"fixes issue helm-123"` → Output: `"fixes issue HELM-123"`
- Jira project keys are always uppercase. Users type mixed-case; normalize to uppercase.

### Rule 5 — Git Ref Case Normalization
- Known refs (main, master, develop, HEAD) are normalized to canonical lowercase form.

---

## Implementation

**New file:** `src/orchestrator/inputCanonicalizer.ts`

```typescript
export interface CanonicalizationResult {
  canonicalText: string;
  changes: string[];  // Human-readable description of what was changed
}

export function canonicalizeInput(rawText: string): CanonicalizationResult
```

---

## Acceptance Criteria

- [ ] Email addresses in angle brackets are extracted correctly
- [ ] UPN whitespace (trailing space before @) is fixed
- [ ] Multiple spaces/newlines are collapsed to single space
- [ ] Jira project keys are always uppercased
- [ ] Git refs are normalized to canonical lowercase
- [ ] All changes are logged in `changes[]` array for audit
- [ ] Canonicalization is deterministic (same input → same output)
- [ ] Unit tests cover all 5 rules with edge cases
