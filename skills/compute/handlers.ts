// Sandboxed code execution skill handler.
// - language:javascript (default) — isolated Node.js vm sandbox (#631 S2)
// - language:python                — Python 3.12 + scientific libs via REPL sidecar (#639)
//
// The Python sidecar URL is configured via PYTHON_REPL_URL env var (set by Bicep
// to the internal Container Apps FQDN). When the env var is absent the handler
// returns a friendly error; the JS fallback is always available.
// Issue: #631 / #639

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const CodeExecuteInputSchema = z.object({
  code: z.string().min(1).max(100_000),
  language: z.enum(['javascript', 'python']).optional().default('javascript'),
  session_id: z.string().max(200).optional(),
  timeout_ms: z.number().int().min(100).max(120_000).optional().default(5_000),
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
// Python REPL sidecar call (#639)
// ---------------------------------------------------------------------------

/** Response shape from the Python REPL sidecar (python-repl/main.py). */
interface PythonReplResponse {
  status: 'ok' | 'error' | 'timeout';
  output: string;
  result: string | null;
  plots: string[];
  execution_ms: number;
  session_id: string;
  truncated: boolean;
}

/**
 * Execute Python code via the Python REPL sidecar. Returns a handler result
 * object in the same shape as the JS handler so callers are unaffected.
 */
async function executePython(
  code: string,
  sessionId: string | undefined,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const replUrl = process.env['PYTHON_REPL_URL'];
  if (!replUrl) {
    return {
      status: 'error',
      error:
        'Python REPL is not configured on this stamp. ' +
        'Set PYTHON_REPL_URL or use language:javascript for sandboxed JS execution.',
      output: [],
      result: null,
      executionMs: 0,
      truncated: false,
    };
  }

  const timeoutS = Math.ceil(timeoutMs / 1000);

  let rawRes: Response;
  try {
    rawRes = await fetch(`${replUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        session_id: sessionId ?? null,
        timeout_s: Math.min(timeoutS, 120),
      }),
      signal: AbortSignal.timeout(timeoutMs + 5_000), // 5s grace beyond exec timeout
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      error: `Python REPL request failed: ${msg}`,
      output: [],
      result: null,
      executionMs: 0,
      truncated: false,
    };
  }

  if (!rawRes.ok) {
    return {
      status: 'error',
      error: `Python REPL returned HTTP ${rawRes.status}`,
      output: [],
      result: null,
      executionMs: 0,
      truncated: false,
    };
  }

  const data = (await rawRes.json()) as PythonReplResponse;

  // Normalize to the same shape as the JS handler for downstream consumers
  return {
    status: data.status,
    // Python returns output as a single string; convert to array of lines
    output: data.output ? data.output.split('\n') : [],
    result: data.result,
    executionMs: data.execution_ms,
    truncated: data.truncated,
    // Python-specific extras preserved for callers that want them
    sessionId: data.session_id,
    plots: data.plots,
    ...(data.status === 'error' ? { error: data.output || 'Python execution error' } : {}),
    ...(data.status === 'timeout' ? { error: `Python execution timed out after ${timeoutS}s` } : {}),
  };
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

  const { code, language, session_id, timeout_ms } = parsed.data;

  // Dispatch to Python REPL sidecar when language:python is requested (#639)
  if (language === 'python') {
    return executePython(code, session_id, timeout_ms);
  }

  // --- JavaScript sandbox path (default) ---
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
