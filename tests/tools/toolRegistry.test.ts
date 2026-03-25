// Tool registry — unit tests for requiresConfirmation declarative gating (#247)
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/safetyConfig.js', () => ({
  safetyConfig: { safetyMode: 'confirmation-gated' },
  isReadOnly: () => false,
  isConfirmationGated: () => true,
}));

import { ToolRegistry, ToolDefinitionSchema } from '../../src/tools/toolRegistry.js';

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
});
