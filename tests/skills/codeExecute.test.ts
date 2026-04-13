// Tests for code_execute tool handler — sandboxed JavaScript execution.
// Issue: #631 (Phase S2 — tool surface expansion), #639 (Python REPL routing)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { code_execute } from '../../skills/compute/handlers.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['PYTHON_REPL_URL'];
});

describe('code_execute', () => {
  it('rejects empty code', async () => {
    const result = (await code_execute({ code: '' })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid input');
  });

  it('executes simple arithmetic', async () => {
    const result = (await code_execute({ code: '2 + 2' })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.result).toBe('4');
  });

  it('captures console.log output', async () => {
    const result = (await code_execute({
      code: 'console.log("hello"); console.log("world");',
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.output).toEqual(['hello', 'world']);
  });

  it('captures console.warn and console.error', async () => {
    const result = (await code_execute({
      code: 'console.warn("caution"); console.error("oops");',
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.output).toEqual(['[warn] caution', '[error] oops']);
  });

  it('returns last expression as result', async () => {
    const result = (await code_execute({
      code: 'const arr = [3,1,2]; arr.sort((a,b) => a-b); arr',
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.result).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('handles JSON processing', async () => {
    const result = (await code_execute({
      code: `
        const data = [
          { name: "Alice", score: 90 },
          { name: "Bob", score: 85 },
          { name: "Charlie", score: 95 }
        ];
        const top = data.sort((a,b) => b.score - a.score)[0];
        console.log("Top scorer: " + top.name);
        top;
      `,
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.output).toEqual(['Top scorer: Charlie']);
    const parsed = JSON.parse(result.result as string);
    expect(parsed.name).toBe('Charlie');
    expect(parsed.score).toBe(95);
  });

  it('enforces timeout', async () => {
    const result = (await code_execute({
      code: 'while(true) {}',
      timeout_ms: 200,
    })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
  });

  it('prevents access to require', async () => {
    const result = (await code_execute({
      code: 'require("fs")',
    })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('prevents access to process', async () => {
    const result = (await code_execute({
      code: 'process.env',
    })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('truncates excessive output', async () => {
    const result = (await code_execute({
      code: 'for (let i = 0; i < 1000; i++) console.log("x".repeat(100));',
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.truncated).toBe(true);
  });

  it('limits output lines', async () => {
    const result = (await code_execute({
      code: 'for (let i = 0; i < 500; i++) console.log(i);',
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    const output = result.output as string[];
    // MAX_OUTPUT_LINES is 200
    expect(output.length).toBeLessThanOrEqual(201); // 200 lines max + possible split artifacts
  });

  it('validates timeout_ms bounds', async () => {
    // Max timeout is now 120,000ms (increased for Python REPL support #639)
    const result = (await code_execute({
      code: '1+1',
      timeout_ms: 200_001, // above 120_000ms max
    })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid input');
  });

  it('handles runtime errors gracefully', async () => {
    const result = (await code_execute({
      code: 'throw new Error("intentional")',
    })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(result.error).toContain('intentional');
  });

  it('supports Date operations', async () => {
    const result = (await code_execute({
      code: 'new Date(0).toISOString()',
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.result).toBe('1970-01-01T00:00:00.000Z');
  });

  it('supports Map and Set', async () => {
    const result = (await code_execute({
      code: `
        const m = new Map([["a", 1], ["b", 2]]);
        const s = new Set([1, 2, 3, 2, 1]);
        console.log("Map size: " + m.size);
        console.log("Set size: " + s.size);
        m.size + s.size;
      `,
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.output).toEqual(['Map size: 2', 'Set size: 3']);
    expect(result.result).toBe('5');
  });

  it('reports executionMs', async () => {
    const result = (await code_execute({
      code: 'let s = 0; for (let i = 0; i < 1000000; i++) s += i; s',
    })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(typeof result.executionMs).toBe('number');
    expect(result.executionMs as number).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Python language dispatch (#639)
// ---------------------------------------------------------------------------

describe('code_execute with language:python', () => {
  const pythonSuccessPayload = {
    status: 'ok',
    output: 'hello from python',
    result: '42',
    plots: [],
    execution_ms: 5,
    session_id: 'test-session-id',
    truncated: false,
  };

  it('returns error when PYTHON_REPL_URL is not configured', async () => {
    delete process.env['PYTHON_REPL_URL'];
    const result = (await code_execute({ code: 'print("hi")', language: 'python' })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(String(result.error)).toContain('not configured');
  });

  it('calls Python sidecar and normalizes the response when URL is set', async () => {
    process.env['PYTHON_REPL_URL'] = 'http://python-repl-internal';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => pythonSuccessPayload,
    } as Response);

    const result = (await code_execute({ code: 'print("hi")', language: 'python' })) as Record<string, unknown>;

    // Normalized shape
    expect(result.status).toBe('ok');
    // output is split into array of lines
    expect(Array.isArray(result.output)).toBe(true);
    expect((result.output as string[]).join('')).toContain('hello from python');
    expect(result.result).toBe('42');
    expect(result.executionMs).toBe(5);
    expect(result.sessionId).toBe('test-session-id');
    expect(result.plots).toEqual([]);

    // Called the correct URL and method
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('http://python-repl-internal/execute');
    expect(init.method).toBe('POST');

    fetchSpy.mockRestore();
    delete process.env['PYTHON_REPL_URL'];
  });

  it('propagates session_id to the Python sidecar', async () => {
    process.env['PYTHON_REPL_URL'] = 'http://python-repl-internal';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...pythonSuccessPayload, session_id: 'my-session' }),
    } as Response);

    await code_execute({ code: '1+1', language: 'python', session_id: 'my-session' });

    const [, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body['session_id']).toBe('my-session');

    fetchSpy.mockRestore();
    delete process.env['PYTHON_REPL_URL'];
  });

  it('returns error when Python sidecar returns non-ok HTTP status', async () => {
    process.env['PYTHON_REPL_URL'] = 'http://python-repl-internal';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const result = (await code_execute({ code: 'print("hi")', language: 'python' })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(String(result.error)).toContain('HTTP 503');

    fetchSpy.mockRestore();
    delete process.env['PYTHON_REPL_URL'];
  });

  it('returns error when fetch throws (network error)', async () => {
    process.env['PYTHON_REPL_URL'] = 'http://python-repl-internal';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = (await code_execute({ code: 'print("hi")', language: 'python' })) as Record<string, unknown>;
    expect(result.status).toBe('error');
    expect(String(result.error)).toContain('ECONNREFUSED');

    fetchSpy.mockRestore();
    delete process.env['PYTHON_REPL_URL'];
  });

  it('defaults to javascript when no language is specified (backward compat)', async () => {
    // No PYTHON_REPL_URL, no language → should use JS sandbox, not hit fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = (await code_execute({ code: '2 + 3' })) as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result.result).toBe('5');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
