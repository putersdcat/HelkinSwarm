// Sandboxed code execution skill handler — isolated JavaScript VM
// with no filesystem, network, or system access.
// Issue: #631 (S2 tool surface expansion)

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const CodeExecuteInputSchema = z.object({
  code: z.string().min(1).max(50_000),
  timeout_ms: z.number().int().min(100).max(10_000).optional().default(5_000),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_CHARS = 8_000;
const MAX_OUTPUT_LINES = 200;

// ---------------------------------------------------------------------------
// Sandbox factory
// ---------------------------------------------------------------------------

function createSandboxContext(outputLines: string[]): vm.Context {
  const consoleMock = {
    log: (...args: unknown[]) => {
      if (outputLines.length >= MAX_OUTPUT_LINES) return;
      outputLines.push(args.map(String).join(' '));
    },
    warn: (...args: unknown[]) => {
      if (outputLines.length >= MAX_OUTPUT_LINES) return;
      outputLines.push('[warn] ' + args.map(String).join(' '));
    },
    error: (...args: unknown[]) => {
      if (outputLines.length >= MAX_OUTPUT_LINES) return;
      outputLines.push('[error] ' + args.map(String).join(' '));
    },
  };

  // Expose only safe globals — no require, process, fs, Buffer, etc.
  return vm.createContext({
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    console: consoleMock,
    // Explicit denials — prevent sandbox escapes
    require: undefined,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    Buffer: undefined,
    __dirname: undefined,
    __filename: undefined,
    module: undefined,
    exports: undefined,
    import: undefined,
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const code_execute: ToolHandler = async (args) => {
  const parsed = CodeExecuteInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      status: 'error',
      error: `Invalid input: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
      output: [],
      result: null,
      executionMs: 0,
      truncated: false,
    };
  }

  const { code, timeout_ms } = parsed.data;
  const outputLines: string[] = [];
  const ctx = createSandboxContext(outputLines);
  const start = Date.now();

  try {
    const script = new vm.Script(code, { filename: 'sandbox.js' });
    const rawResult = script.runInContext(ctx, { timeout: timeout_ms });
    const elapsed = Date.now() - start;

    // Stringify the result safely
    let resultStr: string | null = null;
    if (rawResult !== undefined) {
      try {
        resultStr =
          typeof rawResult === 'object'
            ? JSON.stringify(rawResult, null, 2)
            : String(rawResult);
      } catch {
        resultStr = String(rawResult);
      }
    }

    // Enforce output size limit
    let outputText = outputLines.join('\n');
    let truncated = false;
    if (outputText.length > MAX_OUTPUT_CHARS) {
      outputText = outputText.slice(0, MAX_OUTPUT_CHARS);
      truncated = true;
    }
    if (resultStr && resultStr.length > MAX_OUTPUT_CHARS) {
      resultStr = resultStr.slice(0, MAX_OUTPUT_CHARS);
      truncated = true;
    }

    return {
      status: 'ok',
      output: outputText.split('\n'),
      result: resultStr,
      executionMs: elapsed,
      truncated,
    };
  } catch (err: unknown) {
    const elapsed = Date.now() - start;
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    // Distinguish timeout from other errors
    const isTimeout =
      errorMessage.includes('Script execution timed out') ||
      errorMessage.includes('timed out');

    return {
      status: 'error',
      error: isTimeout
        ? `Execution timed out after ${timeout_ms}ms`
        : errorMessage,
      output: outputLines,
      result: null,
      executionMs: elapsed,
      truncated: false,
    };
  }
};
