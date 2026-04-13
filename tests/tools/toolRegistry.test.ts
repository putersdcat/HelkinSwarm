// Tool registry — unit tests for declarative gating (#247, #315, #316)
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/safetyConfig.js', () => ({
  safetyConfig: { safetyMode: 'confirmation-gated' },
  isReadOnly: () => false,
  isConfirmationGated: () => true,
}));

import { ToolRegistry, ToolDefinitionSchema } from '../../src/tools/toolRegistry.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ToolDefinitionSchema.requiresConfirmation', () => {
  it('defaults to false when not provided', () => {
    const parsed = ToolDefinitionSchema.parse({
      name: 'test_tool',
      description: 'A test tool',
      risk: 'low',
      dataSensitivity: 'non-pii',
    });
    expect(parsed.requiresConfirmation).toBe(false);
  });

  it('preserves true when explicitly set', () => {
    const parsed = ToolDefinitionSchema.parse({
      name: 'test_tool',
      description: 'A test tool',
      risk: 'low',
      dataSensitivity: 'non-pii',
      requiresConfirmation: true,
    });
    expect(parsed.requiresConfirmation).toBe(true);
  });

  it('allows low-risk tool to declare requiresConfirmation=true', () => {
    const parsed = ToolDefinitionSchema.parse({
      name: 'helkin_test_confirmation',
      description: 'Test confirmation flow',
      risk: 'low',
      dataSensitivity: 'non-pii',
      requiresConfirmation: true,
    });
    expect(parsed.risk).toBe('low');
    expect(parsed.requiresConfirmation).toBe(true);
  });
});

describe('ToolDefinitionSchema.privilegeClass (#316)', () => {
  it('defaults to read-only when not provided', () => {
    const parsed = ToolDefinitionSchema.parse({
      name: 'test_tool',
      description: 'A test tool',
      risk: 'low',
      dataSensitivity: 'non-pii',
    });
    expect(parsed.privilegeClass).toBe('read-only');
  });

  it('accepts all valid privilege classes', () => {
    for (const pc of ['read-only', 'read-write', 'create', 'delete'] as const) {
      const parsed = ToolDefinitionSchema.parse({
        name: `test_${pc}`,
        description: 'test',
        risk: 'low',
        dataSensitivity: 'non-pii',
        privilegeClass: pc,
      });
      expect(parsed.privilegeClass).toBe(pc);
    }
  });

  it('rejects invalid privilege class', () => {
    expect(() =>
      ToolDefinitionSchema.parse({
        name: 'test_tool',
        description: 'test',
        risk: 'low',
        dataSensitivity: 'non-pii',
        privilegeClass: 'admin',
      }),
    ).toThrow();
  });
});

describe('ToolRegistry', () => {
  it('round-trips requiresConfirmation through register/get', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'outlook_send_email',
      description: 'Send email',
      risk: 'high',
      dataSensitivity: 'pii',
      requiresExecutor: false,
      requiresSubAgent: false,
      requiresConfirmation: true,
    });
    const def = registry.get('outlook_send_email');
    expect(def?.requiresConfirmation).toBe(true);
  });

  it('get returns requiresConfirmation=false for tools without the flag', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'some_list_tool',
      description: 'List things',
      risk: 'low',
      dataSensitivity: 'non-pii',
      requiresExecutor: false,
      requiresSubAgent: false,
      requiresConfirmation: false,
    });
    const def = registry.get('some_list_tool');
    expect(def?.requiresConfirmation).toBe(false);
  });

  it('applies model profiles to the emitted function schemas when enabled (#610)', () => {
    vi.stubEnv('MODEL_PROFILES_ENABLED', 'true');

    const registry = new ToolRegistry();
    registry.register({
      name: 'outlook_list_emails',
      description: 'List the latest emails from Outlook. Includes sender, subject, and received time.',
      risk: 'low',
      dataSensitivity: 'pii',
      requiresSubAgent: true,
    });
    registry.register({
      name: 'helkin_skill_search',
      description: 'Search the installed skills and return matching tools. Use this for discovery-first routing.',
      risk: 'low',
      dataSensitivity: 'non-pii',
    });
    registry.register({
      name: 'helkin_health_check',
      description: 'Returns HelkinSwarm system health.',
      risk: 'low',
      dataSensitivity: 'non-pii',
    });

    const profiled = registry.toFunctionSchemasForModel('x-ai/grok-4.1-fast');

    expect(profiled.profileModel).toBe('x-ai/grok-4.1-fast');
    // excludeTools is now empty — profile loads but no transformations apply
    expect(profiled.wasTransformed).toBe(false);
    // compact: false — full descriptions preserved
    expect(profiled.tools.find(t => t.function.name === 'outlook_list_emails')?.function.description)
      .toContain('Includes sender, subject, and received time.');
    expect(profiled.tools.find(t => t.function.name === 'helkin_skill_search')?.function.description)
      .toContain('Search the installed skills');
    // All tools are now present (no exclusions)
    expect(profiled.tools.find(t => t.function.name === 'helkin_health_check')).toBeDefined();
  });

  it('can disable model profile application via env guard (#610)', () => {
    vi.stubEnv('MODEL_PROFILES_ENABLED', 'false');

    const registry = new ToolRegistry();
    registry.register({
      name: 'outlook_list_emails',
      description: 'List the latest emails from Outlook. Includes sender, subject, and received time.',
      risk: 'low',
      dataSensitivity: 'pii',
      requiresSubAgent: true,
    });

    const profiled = registry.toFunctionSchemasForModel('x-ai/grok-4.1-fast');

    expect(profiled.profileModel).toBeNull();
    expect(profiled.wasTransformed).toBe(false);
    expect(profiled.tools[0]?.function.description).toContain('Includes sender, subject, and received time.');
  });
});
