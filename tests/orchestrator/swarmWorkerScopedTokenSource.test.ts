// Source-level verification: swarm workers mint scoped tokens and block requiresExecutor tools.
// Issue: #662 (spec ref: docs/0zc §6 — all four agents must use same least-privilege token minting)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

const decomposerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmDecomposerActivity.ts'),
  'utf-8',
);

describe('swarmWorkerActivity — scoped token parity (#662)', () => {
  it('imports scopedTokenMinter', () => {
    expect(workerSrc).toContain("from '../../auth/scopedTokenMinter.js'");
  });

  it('imports mapPrivilegeClassToScopedTokenScope', () => {
    expect(workerSrc).toContain("from '../../auth/tokenScopeMapping.js'");
  });

  it('calls mapPrivilegeClassToScopedTokenScope with tool privilegeClass', () => {
    expect(workerSrc).toContain('mapPrivilegeClassToScopedTokenScope(toolDef.privilegeClass)');
  });

  it('calls scopedTokenMinter.mint when scope is non-null', () => {
    expect(workerSrc).toContain('scopedTokenMinter.mint(');
  });

  it('injects _scopedToken into args', () => {
    expect(workerSrc).toContain("args['_scopedToken'] = scopedToken.token");
  });

  it('injects _scopedTokenScope into args', () => {
    expect(workerSrc).toContain("args['_scopedTokenScope'] = scopedToken.scope");
  });

  it('injects _scopedTokenMethod into args', () => {
    expect(workerSrc).toContain("args['_scopedTokenMethod'] = scopedToken.method");
  });

  it('blocks requiresExecutor tools before dispatching', () => {
    expect(workerSrc).toContain('toolDef?.requiresExecutor');
    expect(workerSrc).toContain('requires_executor');
  });

  it('requiresExecutor block occurs before handler is called', () => {
    const executorIdx = workerSrc.indexOf('requiresExecutor');
    const handlerIdx = workerSrc.indexOf('const handler = getHandler(');
    expect(executorIdx).toBeGreaterThan(-1);
    expect(handlerIdx).toBeGreaterThan(-1);
    expect(executorIdx).toBeLessThan(handlerIdx);
  });
});

describe('swarmDecomposerActivity — read-only tool restriction in system prompt (#662)', () => {
  it('system prompt instructs decomposer to assign only read-only tools to workers', () => {
    expect(decomposerSrc).toContain('WORKER TOOL RESTRICTIONS');
    expect(decomposerSrc).toContain('read-only');
  });

  it('system prompt explicitly prohibits write/create/delete tools for workers', () => {
    expect(decomposerSrc).toContain('requiresExecutor tools');
  });
});
