// Tests for math specialist skill — deterministic evaluation + problem classification
// Issue: #434

import { describe, it, expect, vi, afterEach } from 'vitest';
import { evalArithmetic, classifyProblem, formatAnswer } from '../../skills/math/handlers.js';

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// evalArithmetic
// ---------------------------------------------------------------------------

describe('evalArithmetic', () => {
  it('evaluates simple addition', () => {
    expect(evalArithmetic('2 + 3')).toBe(5);
  });

  it('evaluates subtraction', () => {
    expect(evalArithmetic('10 - 4')).toBe(6);
  });

  it('respects operator precedence (* before +)', () => {
    expect(evalArithmetic('2 + 3 * 4')).toBe(14);
  });

  it('respects parentheses', () => {
    expect(evalArithmetic('(2 + 3) * 4')).toBe(20);
  });

  it('handles exponentiation (**)', () => {
    expect(evalArithmetic('2 ** 10')).toBe(1024);
  });

  it('handles ^ as exponentiation', () => {
    expect(evalArithmetic('2^10')).toBe(1024);
  });

  it('handles division', () => {
    expect(evalArithmetic('15 / 4')).toBe(3.75);
  });

  it('handles modulo', () => {
    expect(evalArithmetic('17 % 5')).toBe(2);
  });

  it('handles unary minus', () => {
    expect(evalArithmetic('-7 + 15')).toBe(8);
  });

  it('handles nested parentheses', () => {
    expect(evalArithmetic('((3 + 2) * (10 - 4)) / 2')).toBe(15);
  });

  it('handles decimals', () => {
    expect(evalArithmetic('3.14 * 2')).toBeCloseTo(6.28);
  });

  it('strips thousands separators', () => {
    expect(evalArithmetic('1,000 + 500')).toBe(1500);
  });

  it('handles right-associative exponentiation', () => {
    // 2^(3^2) = 2^9 = 512 (right-associative)
    expect(evalArithmetic('2**3**2')).toBe(512);
  });

  it('returns null for non-arithmetic input', () => {
    expect(evalArithmetic('solve x + 3 = 5')).toBeNull();
  });

  it('returns null for division by zero', () => {
    expect(evalArithmetic('5 / 0')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(evalArithmetic('')).toBeNull();
  });

  it('returns null for malformed expression with unmatched parens', () => {
    expect(evalArithmetic('(2 + 3')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyProblem
// ---------------------------------------------------------------------------

describe('classifyProblem', () => {
  it('classifies pure arithmetic and solves it', () => {
    const result = classifyProblem('2^10 + 5');
    expect(result.type).toBe('arithmetic');
    expect(result.canEvalDeterministic).toBe(true);
    expect(result.deterministicResult).toBe(1029);
  });

  it('extracts arithmetic fragment from natural language', () => {
    const result = classifyProblem('what is 3 * 4 + 2?');
    expect(result.type).toBe('arithmetic');
    expect(result.canEvalDeterministic).toBe(true);
    expect(result.deterministicResult).toBe(14);
  });

  it('classifies calculus problems', () => {
    const result = classifyProblem('find the derivative of x^2 + 3x');
    expect(result.type).toBe('calculus');
    expect(result.canEvalDeterministic).toBe(false);
  });

  it('classifies algebra problems', () => {
    const result = classifyProblem('solve for x: 2x + 3 = 11');
    expect(result.type).toBe('algebra');
    expect(result.canEvalDeterministic).toBe(false);
  });

  it('classifies statistics problems', () => {
    const result = classifyProblem('calculate the mean of 5, 10, 15, 20');
    expect(result.type).toBe('statistics');
    expect(result.canEvalDeterministic).toBe(false);
  });

  it('classifies trigonometry problems', () => {
    const result = classifyProblem('what is sin(30 degrees)?');
    expect(result.type).toBe('trigonometry');
    expect(result.canEvalDeterministic).toBe(false);
  });

  it('classifies geometry problems', () => {
    const result = classifyProblem('find the area of a circle with radius 5');
    expect(result.type).toBe('geometry');
    expect(result.canEvalDeterministic).toBe(false);
  });

  it('classifies linear algebra problems', () => {
    const result = classifyProblem('compute the determinant of a 3x3 matrix');
    expect(result.type).toBe('linear_algebra');
    expect(result.canEvalDeterministic).toBe(false);
  });

  it('falls back to general_math for unclear problems', () => {
    const result = classifyProblem('explain the Riemann hypothesis');
    expect(result.type).toBe('general_math');
    expect(result.canEvalDeterministic).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatAnswer
// ---------------------------------------------------------------------------

describe('formatAnswer', () => {
  it('formats integer without decimal point', () => {
    expect(formatAnswer(1024)).toBe('1024');
  });

  it('formats decimal result', () => {
    expect(formatAnswer(3.75)).toBe('3.75');
  });

  it('strips trailing zeros from decimal', () => {
    expect(formatAnswer(3.50)).toBe('3.5');
  });
});

// ---------------------------------------------------------------------------
// math_solve tool handler (integration)
// ---------------------------------------------------------------------------

describe('math_solve handler', () => {
  it('returns deterministic answer for arithmetic', async () => {
    const { math_solve } = await import('../../skills/math/handlers.js');
    const result = (await math_solve({ problem: '2 ** 10 + 5' })) as Record<string, unknown>;
    expect(result['status']).toBe('success');
    expect(result['method']).toBe('deterministic');
    expect(result['answer']).toBe(1029);
    expect(result['answer_formatted']).toBe('1029');
    expect(result['problem_type']).toBe('arithmetic');
  });

  it('returns framed-for-reasoning for calculus', async () => {
    const { math_solve } = await import('../../skills/math/handlers.js');
    const result = (await math_solve({ problem: 'differentiate x^3 + 2x' })) as Record<string, unknown>;
    expect(result['status']).toBe('success');
    expect(result['method']).toBe('framed-for-reasoning');
    expect(result['problem_type']).toBe('calculus');
    expect(result['recommended_reasoning_model']).toBe('grok-4-1-fast-reasoning');
  });

  it('respects model_hint for framed-for-reasoning', async () => {
    const { math_solve } = await import('../../skills/math/handlers.js');
    const result = (await math_solve({ problem: 'integrate x^2 dx', model_hint: 'o4-mini' })) as Record<string, unknown>;
    expect(result['recommended_reasoning_model']).toBe('o4-mini');
  });

  it('returns error for invalid args', async () => {
    const { math_solve } = await import('../../skills/math/handlers.js');
    const result = (await math_solve({ problem: '' })) as Record<string, unknown>;
    expect(result['status']).toBe('error');
  });
});
