// Tool Budget Scaler — adaptive per-turn tool call limits.
// Fix: #139
// Spec ref: docs/ADDENDA/ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md

const BASE_BUDGET = 10;
const MIN_BUDGET = 5;
const MAX_BUDGET = 50;

/** Per-tool-name maximum calls across the full turn (initial + all follow-up rounds). */
export const PER_TOOL_TURN_CAPS: Record<string, number> = {
  helkin_current_datetime: 1,
  helkin_skill_search: 4,
  helkin_whoami: 1,
  helkin_recent_requests: 1,
  helkin_health_check: 1,
  helkin_get_costs: 1,
  helkin_get_openrouter_spend: 1,
  helkin_list_skills: 1,
  helkin_skill_catalog: 1,
  deep_research: 1,
  travel_geocode: 1,
  web_search: 6,     // 6 searches: enough to find locator URLs, then cap triggers pivot to web_fetch_page
  web_fetch_page: 8,
  web_interact: 4,
};
/** Default cap for any tool not explicitly listed. */
export const DEFAULT_PER_TOOL_TURN_CAP = 8;

/**
 * Per-tool messages shown when the cap is exceeded.
 * Tools that have a natural "next step" tool (e.g. web_search → web_fetch_page)
 * should redirect here instead of saying "synthesize an answer."
 */
export const PER_TOOL_CAP_EXCEEDED_MESSAGES: Record<string, string> = {
  web_search:
    'web_search has reached its per-turn call limit. ' +
    'Review the search results already returned and identify any dealer-locator, store-finder, ' +
    'service-directory, or product-listing URLs. ' +
    'Call web_fetch_page on the most relevant URL immediately. ' +
    'If web_fetch_page returns empty/incomplete content (JavaScript SPA), escalate to web_interact. ' +
    'Do NOT deliver a final answer until you have fetched at least one relevant URL.',
};

const COMPLEX_KEYWORDS = /\b(search\s+and\s+delete|for\s+each|batch|recursive)\b/i;
const SIMPLE_PATTERNS = /^(show\s+my\s+inbox|list\b|get\b)/i;

export interface ToolBudgetInput {
  userMessage: string;
  historyLength: number;
  /** Number of distinct skill domains in the current tool set. */
  domainCount: number;
}

export interface ToolBudgetResult {
  budget: number;
  adjustments: string[];
}

/** Computes the adaptive tool-call budget for the current turn. */
export function computeToolBudget(input: ToolBudgetInput): ToolBudgetResult {
  let budget = BASE_BUDGET;
  const adjustments: string[] = [];

  // Simple pattern detector — cap immediately
  if (SIMPLE_PATTERNS.test(input.userMessage)) {
    adjustments.push(`Simple pattern detected, capped at ${MIN_BUDGET}`);
    return { budget: MIN_BUDGET, adjustments };
  }

  // History length scaling
  if (input.historyLength > 20) {
    budget += 10;
    adjustments.push('History >20 turns: +10');
  } else if (input.historyLength > 10) {
    budget += 5;
    adjustments.push('History >10 turns: +5');
  }

  // Domain count
  if (input.domainCount > 0) {
    const domainBonus = input.domainCount * 3;
    budget += domainBonus;
    adjustments.push(`${input.domainCount} domains: +${domainBonus}`);
  }

  // Complex keyword detection
  if (COMPLEX_KEYWORDS.test(input.userMessage)) {
    budget += 5;
    adjustments.push('Complex keywords detected: +5');
  }

  // Clamp to [MIN_BUDGET, MAX_BUDGET]
  budget = Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, budget));

  return { budget, adjustments };
}
