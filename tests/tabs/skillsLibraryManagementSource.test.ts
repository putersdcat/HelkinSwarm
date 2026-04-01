import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Skills Library management UI wiring', () => {
  it('adds a manage tab with inspection actions and reload control', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('{ key: "manage", label: "Manage" }');
    expect(source).toContain('{ key: "registry", label: "MCP Registry" }');
    expect(source).toContain('Check Activation');
    expect(source).toContain('Check Uninstall Impact');
    expect(source).toContain('skills/reload');
    expect(source).toContain('install-readiness');
    expect(source).toContain('uninstall-impact');
    expect(source).toContain('skills/mcp-registry/search');
    expect(source).toContain('skills/mcp-registry/draft');
    expect(source).toContain('skills/mcp-registry/approve');
    expect(source).toContain('Send to McpForge');
    expect(source).toContain('Approve + Hot Reload');
  });
});