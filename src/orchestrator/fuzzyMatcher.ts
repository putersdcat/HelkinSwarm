// Fuzzy Resolution — semantic + sender + subject matching for inbound hook events.
// When a durable hook fires (e.g. an email reply arrives), this module determines
// whether the content matches the expected reply pattern and extracts relevant data.
// Spec ref: 0h-Long-Running-Workflows.md §2 (Fuzzy Resolution), Issue #74

import type { ExpectedReplyPattern } from './hookCatalog.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FuzzyMatchInput {
  /** The expected patterns from the hook */
  expected: ExpectedReplyPattern;
  /** The actual inbound event data */
  actual: {
    sender?: string;
    subject?: string;
    body?: string;
    /** Any additional fields from the notification payload */
    metadata?: Record<string, unknown>;
  };
}

export interface FuzzyMatchResult {
  matched: boolean;
  confidence: number; // 0.0 to 1.0
  matchedOn: string[]; // Which criteria matched
  details: string;
}

// ---------------------------------------------------------------------------
// Match functions
// ---------------------------------------------------------------------------

/**
 * Check if actual sender matches expected sender pattern.
 * Case-insensitive substring match.
 */
function matchSender(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  return actual.toLowerCase().includes(expected.toLowerCase());
}

/**
 * Check if actual subject contains expected subject substring.
 * Case-insensitive.
 */
function matchSubject(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  return actual.toLowerCase().includes(expected.toLowerCase());
}

/**
 * Check if actual body matches expected regex pattern.
 * Returns false on invalid regex rather than throwing.
 */
function matchRegex(pattern: string, text: string | undefined): boolean {
  if (!text) return false;
  try {
    const re = new RegExp(pattern, 'i');
    return re.test(text);
  } catch {
    return false;
  }
}

/**
 * Semantic similarity check — lightweight keyword overlap for MVP.
 * Full embedding-based matching will be added via Hydra-Net (#68).
 * Returns a 0-1 score based on word overlap between expected and actual.
 */
function semanticScore(expected: string, actual: string | undefined): number {
  if (!actual) return 0;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2); // Drop very short words

  const expectedWords = new Set(normalize(expected));
  const actualWords = normalize(actual);

  if (expectedWords.size === 0) return 0;

  let hits = 0;
  for (const word of actualWords) {
    if (expectedWords.has(word)) hits++;
  }

  return Math.min(hits / expectedWords.size, 1.0);
}

// ---------------------------------------------------------------------------
// Main fuzzy matcher
// ---------------------------------------------------------------------------

/**
 * Evaluate whether an inbound event matches the expected reply pattern.
 * Uses a weighted scoring system across all available criteria.
 */
export function fuzzyMatch(input: FuzzyMatchInput): FuzzyMatchResult {
  const { expected, actual } = input;
  const matchedOn: string[] = [];
  let totalWeight = 0;
  let totalScore = 0;

  // Sender match (weight: 0.3)
  if (expected.sender) {
    totalWeight += 0.3;
    if (matchSender(expected.sender, actual.sender)) {
      totalScore += 0.3;
      matchedOn.push('sender');
    }
  }

  // Subject match (weight: 0.25)
  if (expected.subjectContains) {
    totalWeight += 0.25;
    if (matchSubject(expected.subjectContains, actual.subject)) {
      totalScore += 0.25;
      matchedOn.push('subject');
    }
  }

  // Regex match on body (weight: 0.25)
  if (expected.regex) {
    totalWeight += 0.25;
    if (matchRegex(expected.regex, actual.body)) {
      totalScore += 0.25;
      matchedOn.push('regex');
    }
  }

  // Semantic match on body (weight: 0.2)
  if (expected.semantic) {
    totalWeight += 0.2;
    const score = semanticScore(expected.semantic, actual.body);
    totalScore += 0.2 * score;
    if (score >= 0.3) {
      matchedOn.push('semantic');
    }
  }

  // Normalize to 0-1 range
  const confidence = totalWeight > 0 ? totalScore / totalWeight : 0;
  const matched = confidence >= 0.5; // 50% threshold for positive match

  const details = matched
    ? `Matched with ${Math.round(confidence * 100)}% confidence on: ${matchedOn.join(', ')}`
    : `No match (${Math.round(confidence * 100)}% confidence). Checked: ${Object.keys(expected).filter((k) => expected[k as keyof ExpectedReplyPattern]).join(', ')}`;

  return { matched, confidence, matchedOn, details };
}
