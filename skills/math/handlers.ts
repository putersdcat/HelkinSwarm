// Math specialist skill handlers — deterministic arithmetic evaluation and
// structured problem framing for reasoning-model dispatch.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md
// Issue: #434

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Arithmetic tokeniser
// ---------------------------------------------------------------------------

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '%' | '**' }
  | { type: 'lparen' }
  | { type: 'rparen' };

/**
 * Tokenise an arithmetic string into a token stream.
 * Returns null if any unexpected character is encountered.
 * Supports: integers, decimals, scientific notation, +, -, *, **, /, %, ^, (, )
 */
function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.trim();

  while (i < s.length) {
    const ch = s[i];

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Number (integer, decimal, scientific notation)
    if (/\d/.test(ch) || (ch === '.' && i + 1 < s.length && /\d/.test(s[i + 1]))) {
      let num = '';
      while (i < s.length && /[\d.]/.test(s[i])) num += s[i++];
      // Optional scientific notation (e.g. 1.5e10, 2E-3)
      if (i < s.length && /[eE]/.test(s[i])) {
        num += s[i++];
        if (i < s.length && /[+-]/.test(s[i])) num += s[i++];
        while (i < s.length && /\d/.test(s[i])) num += s[i++];
      }
      if ((num.match(/\./g) ?? []).length > 1) return null; // multiple decimal points
      const val = parseFloat(num);
      if (!Number.isFinite(val)) return null;
      tokens.push({ type: 'num', value: val });
      continue;
    }

    // Two-character operators first
    if (ch === '*' && s[i + 1] === '*') { tokens.push({ type: 'op', value: '**' }); i += 2; continue; }

    switch (ch) {
      case '+': tokens.push({ type: 'op', value: '+' }); i++; break;
      case '-': tokens.push({ type: 'op', value: '-' }); i++; break;
      case '*': tokens.push({ type: 'op', value: '*' }); i++; break;
      case '/': tokens.push({ type: 'op', value: '/' }); i++; break;
      case '%': tokens.push({ type: 'op', value: '%' }); i++; break;
      case '^': tokens.push({ type: 'op', value: '**' }); i++; break; // treat ^ as **
      case '(': tokens.push({ type: 'lparen' }); i++; break;
      case ')': tokens.push({ type: 'rparen' }); i++; break;
      default: return null; // unexpected character — not pure arithmetic
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Recursive descent parser
// Grammar (standard operator precedence, right-associative exponentiation):
//   expr   = term  (('+' | '-') term)*
//   term   = power (('*' | '/' | '%') power)*
//   power  = unary ('**' power)?          ← right-associative
//   unary  = ('+' | '-') unary | atom
//   atom   = NUMBER | '(' expr ')'
// ---------------------------------------------------------------------------

class ArithParser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private consume(): Token | undefined { return this.tokens[this.pos++]; }

  parseExpr(): number {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (!t || t.type !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      this.consume();
      const right = this.parseTerm();
      left = t.value === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parsePower();
    for (;;) {
      const t = this.peek();
      if (!t || t.type !== 'op') break;
      if (t.value !== '*' && t.value !== '/' && t.value !== '%') break;
      this.consume();
      const right = this.parsePower();
      if (t.value === '*') { left *= right; }
      else if (t.value === '/') {
        if (right === 0) throw new Error('division by zero');
        left /= right;
      } else { left %= right; }
    }
    return left;
  }

  private parsePower(): number {
    const base = this.parseUnary();
    const t = this.peek();
    if (t?.type === 'op' && t.value === '**') {
      this.consume();
      const exp = this.parsePower(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (t?.type === 'op' && t.value === '-') { this.consume(); return -this.parseUnary(); }
    if (t?.type === 'op' && t.value === '+') { this.consume(); return this.parseUnary(); }
    return this.parseAtom();
  }

  private parseAtom(): number {
    const t = this.peek();
    if (!t) throw new Error('unexpected end of expression');
    if (t.type === 'num') { this.consume(); return t.value; }
    if (t.type === 'lparen') {
      this.consume();
      const val = this.parseExpr();
      const close = this.peek();
      if (!close || close.type !== 'rparen') throw new Error('missing closing parenthesis');
      this.consume();
      return val;
    }
    throw new Error(`unexpected token type: ${t.type}`);
  }

  get done(): boolean { return this.pos >= this.tokens.length; }
}

/**
 * Attempt to evaluate the input string as a pure arithmetic expression.
 * Returns the numeric result, or null if parsing/evaluation fails.
 * No eval() or Function() — uses a proper recursive descent parser.
 */
export function evalArithmetic(input: string): number | null {
  const cleaned = input.trim().replace(/,(?=\d{3})/g, ''); // strip thousands separators
  const tokens = tokenize(cleaned);
  if (!tokens || tokens.length === 0) return null;
  const parser = new ArithParser(tokens);
  try {
    const result = parser.parseExpr();
    if (!parser.done) return null; // leftover tokens
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Problem classifier
// ---------------------------------------------------------------------------

export type ProblemType =
  | 'arithmetic'
  | 'algebra'
  | 'calculus'
  | 'linear_algebra'
  | 'statistics'
  | 'trigonometry'
  | 'geometry'
  | 'general_math';

/** Extract the innermost arithmetic sub-expression from natural-language input. */
function extractArithmeticFragment(problem: string): string | null {
  // Match sequences containing digits and arithmetic operators/parens
  // Greedy from first digit to last digit/closing-paren
  const match = problem.match(/[-+]?\s*\(?[\d][\d\s+\-*/^().%eE,]*[\d)]/);
  if (!match) return null;
  const candidate = match[0].trim();
  // Reject fragments that are too short to be meaningful
  return candidate.length >= 1 ? candidate : null;
}

/** Classify the math problem by type, and try deterministic evaluation. */
export function classifyProblem(problem: string): {
  type: ProblemType;
  canEvalDeterministic: boolean;
  deterministicResult: number | null;
  expression: string | null;
} {
  const p = problem.toLowerCase();

  // Try the whole problem as pure arithmetic first
  const wholeResult = evalArithmetic(problem);
  if (wholeResult !== null) {
    return {
      type: 'arithmetic',
      canEvalDeterministic: true,
      deterministicResult: wholeResult,
      expression: problem.trim(),
    };
  }

  // Keywords for complex problem types (checked before arithmetic fragment extraction).
  // Use prefix patterns without trailing \b so partial words match (e.g. "derivative" matches "deriv").
  if (/\b(calculus\b|deriv|integr|limit\b|differenti|antideriv|taylor|maclaurin)/.test(p)) {
    return { type: 'calculus', canEvalDeterministic: false, deterministicResult: null, expression: null };
  }
  if (/\b(matrix|matrices|determinant|eigenval|eigenvect|dot product|cross product|transpose)/.test(p)) {
    return { type: 'linear_algebra', canEvalDeterministic: false, deterministicResult: null, expression: null };
  }
  if (/\b(statistic|probabilit|distribut|\bmean\b|\bmedian\b|standard deviation|variance|\bregression\b)/.test(p)) {
    return { type: 'statistics', canEvalDeterministic: false, deterministicResult: null, expression: null };
  }
  if (/\b(sin\b|cos\b|tan\b|sec\b|csc\b|cot\b|arcsin|arccos|arctan|radian|\bdegree\b|\bangle\b|\btrig\b)/.test(p)) {
    return { type: 'trigonometry', canEvalDeterministic: false, deterministicResult: null, expression: null };
  }
  if (/\b(\barea\b|perimeter|circumference|\bvolume\b|surface area|\bradius\b|\bdiameter\b|hypotenuse|pythagorean)/.test(p)) {
    return { type: 'geometry', canEvalDeterministic: false, deterministicResult: null, expression: null };
  }
  if (/\b(solve for|\bequation\b|polynomial|\bfactor\b|quadratic|\bcubic\b|linear equation|\bvariable\b|\bunknown\b)/.test(p)) {
    return { type: 'algebra', canEvalDeterministic: false, deterministicResult: null, expression: null };
  }

  // Try to extract an arithmetic fragment from natural language ("what is 2+3?")
  const fragment = extractArithmeticFragment(problem);
  if (fragment) {
    const fragResult = evalArithmetic(fragment);
    if (fragResult !== null) {
      return {
        type: 'arithmetic',
        canEvalDeterministic: true,
        deterministicResult: fragResult,
        expression: fragment,
      };
    }
  }

  return { type: 'general_math', canEvalDeterministic: false, deterministicResult: null, expression: null };
}

// ---------------------------------------------------------------------------
// Number formatter
// ---------------------------------------------------------------------------

/** Format a number for display — integers shown without decimal point */
export function formatAnswer(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toString();
  // Use up to 10 significant digits, strip trailing zeros
  return parseFloat(n.toPrecision(10)).toString();
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

const MathSolveArgsSchema = z.object({
  problem: z.string().min(1).max(2000, 'problem too long'),
  model_hint: z.string().optional(),
});

export const math_solve: ToolHandler = async (args) => {
  const parsed = MathSolveArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: 'error',
      message: `Invalid arguments: ${parsed.error.message}`,
    };
  }

  const { problem, model_hint } = parsed.data;
  const classification = classifyProblem(problem);

  if (classification.canEvalDeterministic && classification.deterministicResult !== null) {
    return {
      status: 'success',
      method: 'deterministic',
      problem_type: classification.type,
      expression: classification.expression ?? problem,
      answer: classification.deterministicResult,
      answer_formatted: formatAnswer(classification.deterministicResult),
    };
  }

  // Cannot solve deterministically — return structured framing for reasoning model
  const recommendedModel = model_hint ?? 'grok-4-1-fast-reasoning';
  return {
    status: 'success',
    method: 'framed-for-reasoning',
    problem_type: classification.type,
    problem_framed: problem,
    recommended_reasoning_model: recommendedModel,
    note: `This ${classification.type} problem requires reasoning-model computation. Route to ${recommendedModel} for a full solution.`,
  };
};
