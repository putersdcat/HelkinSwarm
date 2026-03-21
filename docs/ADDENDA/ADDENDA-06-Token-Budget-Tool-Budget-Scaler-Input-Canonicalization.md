# HelkinSwarm Project Specification — Addendum Series

## ADDENDA-06. Token Budget, Tool Budget Scaler, Input Canonicalization & Operator Domain Priors

**Version:** 1.0  
**Date:** March 2026  
**Status:** Implementation spec  
**References:** Doc `08` (Orchestrator Patterns), doc `0i` (Memory Manager), doc `0l` (Ethos)

---

## 1. Purpose

These are the "boring but critical" operational systems that keep the orchestrator stable over long sessions. This addendum specifies:

1. **Token budget** — correct context-window pressure tracking that triggers `ContinueAsNew` at the right time
2. **Tool budget scaler** — adaptive per-turn tool call limits based on conversation complexity
3. **Input canonicalization** — normalizing user input before it reaches the LLM (email whitespace, UPN fixes, etc.)
4. **Operator domain priors** — heuristic rules that pre-process common patterns before LLM reasoning

---

## 2. Token Budget — Correct Context Pressure Tracking

### 2.1 The Correct Metric

The token budget must measure **context window pressure**, not cumulative tokens. After `ContinueAsNew`, the history is cleared — so measuring cumulative tokens would trigger too late or too early.

```typescript
// filepath: src/orchestrator/tokenBudget.ts

export interface TokenBudgetState {
  userId: string;
  conversationId: string;
  _latestPromptTokens: number;    // ← CRITICAL: prompt tokens of the most recent call
  _accumulatedTokens: number;     // Total across session (for reporting)
  model: string;
  lastUpdatedAt: string;
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-5": 128000,
  "gpt-5-mini": 128000,
  "gpt-5-turbo": 128000,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "o3": 200000,
  "o4-mini": 200000,
  "o4-mini-high": 200000,
  "grok-4-1-fast-reasoning": 131072,
  "claude-opus-4": 200000,
  "claude-sonnet-4": 200000,
};

const SUMMARY_THRESHOLD = 0.75;  // Summarize at 75% of context
const CONTINUE_AS_NEW_THRESHOLD = 0.80;  // ContinueAsNew at 80%
```

### 2.2 Token Budget Class

```typescript
export class TokenBudget {
  private state: TokenBudgetState;

  constructor(userId: string, conversationId: string, model: string) {
    this.state = {
      userId,
      conversationId,
      _latestPromptTokens: 0,
      _accumulatedTokens: 0,
      model,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  record(promptTokens: number, completionTokens: number, totalTokens: number): void {
    this.state._latestPromptTokens = promptTokens;
    this.state._accumulatedTokens += totalTokens;
    this.state.lastUpdatedAt = new Date().toISOString();
  }

  getContextPressure(): number {
    const limit = MODEL_CONTEXT_LIMITS[this.state.model] ?? 128000;
    return this.state._latestPromptTokens / limit;
  }

  shouldSummarize(): boolean {
    return this.getContextPressure() >= SUMMARY_THRESHOLD;
  }

  shouldContinueAsNew(): boolean {
    return this.getContextPressure() >= CONTINUE_AS_NEW_THRESHOLD;
  }

  getState(): TokenBudgetState {
    return { ...this.state };
  }

  static fromState(state: TokenBudgetState): TokenBudget {
    const budget = new TokenBudget(state.userId, state.conversationId, state.model);
    budget.state = { ...state };
    return budget;
  }
}
```

### 2.3 Usage in Overseer

```typescript
// filepath: src/orchestrator/overseer.ts

const budget = TokenBudget.fromState(state.tokenBudget ?? {
  userId: input.userId,
  conversationId: input.conversationId,
  model: getPrimaryModel(),  // From model router
});

// After each LLM call:
budget.record(llmResult.promptTokens, llmResult.completionTokens, llmResult.totalTokens);
state.tokenBudget = budget.getState();

if (budget.shouldContinueAsNew()) {
  // Summarize + ContinueAsNew
  const summary = yield context.callActivity("summarizeSession", {
    conversationId: state.conversationId,
    correlationId: state.correlationId,
  });
  state.lastSummary = summary;
  return outcome({ ...state, lastSummary: summary }, "continue_as_new");
}
```

---

## 3. Tool Budget Scaler — Adaptive Per-Turn Limits

### 3.1 Purpose

The tool budget (max tool calls per turn) should adapt based on conversation complexity. Simple requests get a lower budget; complex multi-step tasks get a higher budget.

### 3.2 Scaling Heuristics

```typescript
// filepath: src/orchestrator/toolBudgetScaler.ts

const BASE_TOOL_BUDGET = 10;
const MAX_TOOL_BUDGET_CAP = 50;

interface ToolBudgetInput {
  userMessage: string;
  conversationHistory: ChatMessage[];
  capabilitiesInPlay: string[];  // Domains of tools likely to be used
}

export function computeToolBudget(input: ToolBudgetInput): number {
  let budget = BASE_TOOL_BUDGET;

  // Heuristic 1: Conversation length signals complexity
  const historyLength = input.conversationHistory.length;
  if (historyLength > 20) budget += 10;
  else if (historyLength > 10) budget += 5;

  // Heuristic 2: Number of domains in play
  const domainCount = new Set(input.capabilitiesInPlay.map(c => c.split("_")[0])).size;
  budget += domainCount * 3;

  // Heuristic 3: Keyword signals for complex operations
  const text = input.userMessage.toLowerCase();
  const complexKeywords = [
    /search.*and.*delete/i,
    /find.*and.*update/i,
    /list all.*\n.*then/i,
    /for each/i,
    /iterate/i,
    /batch/i,
    /bulk/i,
    /recursive/i,
    /tree/i,
  ];
  for (const kp of complexKeywords) {
    if (kp.test(input.userMessage)) {
      budget += 5;
    }
  }

  // Heuristic 4: Short-circuit for simple single actions
  const simplePatterns = [
    /^show (me )?my (inbox|calendar|issues)/i,
    /^what('s| is) (on|in) my/i,
    /^list/i,
    /^get/i,
  ];
  for (const sp of simplePatterns) {
    if (sp.test(input.userMessage)) {
      budget = Math.min(budget, 5);
    }
  }

  // Heuristic 5: Safety cap
  return Math.min(budget, MAX_TOOL_BUDGET_CAP);
}
```

---

## 4. Input Canonicalization

### 4.1 Purpose

User input varies wildly in formatting. Canonicalization normalizes it before it reaches the LLM, so the model sees consistent patterns regardless of how the user typed the request.

### 4.2 Canonicalization Rules

```typescript
// filepath: src/orchestrator/inputCanonicalizer.ts

interface CanonicalizationResult {
  canonicalText: string;
  changes: string[];  // Human-readable description of what was changed
}

export function canonicalizeInput(rawText: string): CanonicalizationResult {
  const changes: string[] = [];
  let text = rawText.trim();

  // Rule 1: Fix email whitespace in quoted addresses
  // "bob smith <bob@company.com>" → "bob@company.com"
  const emailQuotedPattern = /([A-Za-z\s]+)\s*<([^\s>]+)>/g;
  const emailMatches = text.match(emailQuotedPattern);
  if (emailMatches) {
    for (const match of emailMatches) {
      const [, name, email] = match.match(/([A-Za-z\s]+)\s*<([^\s>]+)>/)!;
      text = text.replace(match, email.trim());
      changes.push(`Canonicalized email: "${match}" → "${email.trim()}"`);
    }
  }

  // Rule 2: Fix UPN whitespace (trailing spaces in domain portion)
  // "eric.anderson @EAnderson.com" → "eric.anderson@EAnderson.com"
  const upnPattern = /([a-zA-Z0-9._%+-]+)\s+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  text = text.replace(upnPattern, "$1@$2");
  if (upnPattern.test(text)) {
    changes.push("Fixed whitespace in email/UPN");
  }

  // Rule 3: Normalize whitespace (collapse multiple spaces/newlines)
  const originalText = text;
  text = text.replace(/\s+/g, " ").trim();
  if (text !== originalText) {
    changes.push("Normalized whitespace");
  }

  // Rule 4: Jira key normalization (uppercase)
  // "fixes issue helm-123" (user typed helm) → "fixes issue HELM-123"
  const jiraKeyPattern = /\b([a-z]{2,10}-\d+)\b/g;
  const jiraMatches = text.match(jiraKeyPattern);
  if (jiraMatches) {
    for (const match of jiraMatches) {
      const normalized = match.toUpperCase();
      if (match !== normalized) {
        text = text.replace(match, normalized);
        changes.push(`Normalized Jira key: "${match}" → "${normalized}"`);
      }
    }
  }

  // Rule 5: Git ref case normalization (case-sensitive refs, user might type wrong case)
  // Only normalize known refs: main, master, develop, HEAD, etc.
  const gitRefPattern = /\b(heads?\/|refs?\/)?(main|master|develop|HEAD|mainline)\b/gi;
  const gitMatches = text.match(gitRefPattern);
  if (gitMatches) {
    for (const match of gitMatches) {
      const normalized = match.toLowerCase().replace(/^(heads?|refs?)\//, "");
      if (match.toLowerCase() !== normalized) {
        text = text.replace(new RegExp(escapeRegex(match), "gi"), normalized);
        changes.push(`Normalized git ref: "${match}" → "${normalized}"`);
      }
    }
  }

  return { canonicalText: text, changes };
}
```

---

## 5. Operator Domain Priors

### 5.1 Purpose

Operator domain priors encode the implicit context of the operator (the owner, Eric Anderson) into the system prompt. These are heuristics about common patterns specific to this deployment.

### 5.2 Priors File Format

```typescript
// filepath: src/persona/operatorDomainPriors.ts

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
```

### 5.3 Default Operator Priors

```typescript
export const OPERATOR_DOMAIN_PRIORS: OperatorPrior = {
  version: "1.0.0",
  rules: [
    {
      id: "email-whitespace-fix",
      description: "Email addresses in angle brackets often have whitespace issues",
      pattern: "/<.*@.*>/",
      confidence: "high",
      policy: "Apply input canonicalization before any processing",
    },
    {
      id: "upn-trailing-space",
      description: "UPN with trailing space before @ is a common typo",
      pattern: "/\\s+@/",
      confidence: "high",
      policy: "Canonicalize UPN format before Graph API calls",
    },
    {
      id: "jira-key-uppercase",
      description: "Jira project keys are always uppercase in Atlassian",
      pattern: "/[a-z]{2,10}-\\d+/",
      confidence: "high",
      policy: "Always uppercase Jira keys in issue references",
    },
    {
      id: "git-refs-case-sensitive",
      description: "Git refs (main, master, HEAD) are case-sensitive",
      pattern: "/(heads?|refs?)\\/main/i",
      confidence: "medium",
      policy: "Normalize git ref casing to canonical lowercase form",
    },
    {
      id: "medium-confidence-policy",
      description: "Medium confidence rules should be logged but not auto-corrected",
      pattern: "/medium/",
      confidence: "medium",
      policy: "Log match and surface to user for confirmation",
    },
  ],
};
```

### 5.4 Usage in BuildPromptActivity

```typescript
// filepath: src/orchestrator/buildPromptActivity.ts

export async function buildPromptActivity(input: BuildPromptInput): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];

  // 1. Canonicalize input
  const canonical = canonicalizeInput(input.message);
  if (canonical.changes.length > 0) {
    messages.push({
      role: "system",
      content: `Input canonicalization applied: ${canonical.changes.join("; ")}`,
    });
  }

  // 2. Add operator priors
  messages.push({
    role: "system",
    content: `Operator Domain Priors (${OPERATOR_DOMAIN_PRIORS.version}):\n` +
      OPERATOR_DOMAIN_PRIORS.rules.map(r =>
        `[${r.confidence.toUpperCase()}] ${r.id}: ${r.policy}`
      ).join("\n"),
  });

  // ... rest of prompt building
}
```

---

## 6. Key Files

| File | Action | Notes |
|------|--------|-------|
| `src/orchestrator/tokenBudget.ts` | **Create** | TokenBudget class with correct `_latestPromptTokens` metric |
| `src/orchestrator/toolBudgetScaler.ts` | **Create** | 5-heuristic tool budget computation |
| `src/orchestrator/inputCanonicalizer.ts` | **Create** | 5 canonicalization rules |
| `src/persona/operatorDomainPriors.ts` | **Create** | Operator priors file |
| `src/orchestrator/buildPromptActivity.ts` | **Modify** | Add canonicalization + priors to prompt |
| `src/orchestrator/overseer.ts` | **Modify** | Wire token budget into ContinueAsNew decision |

---

## 7. Acceptance Criteria

1. Token budget uses `_latestPromptTokens` (not cumulative) for threshold decisions
2. `ContinueAsNew` triggers at exactly 80% context pressure regardless of total session tokens
3. Tool budget scales between 5 and 50 based on the 5 heuristics
4. Canonicalization fixes email-in-angle-brackets, UPN whitespace, Jira key casing, git ref casing, and collapses whitespace
5. Canonicalization changes are logged and surfaced in the system prompt
6. Operator priors are versioned and included in the system prompt
7. No PII is stored in the operator priors rules
8. All canonicalization is deterministic (same input → same output)
