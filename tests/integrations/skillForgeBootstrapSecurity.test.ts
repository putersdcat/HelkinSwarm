import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBootstrapModule() {
  return import('../../infra/skillforge-bootstrap.mjs');
}

describe('SkillForge bootstrap security hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SKILLFORGE_PROMPT_SHIELD_POLICY'];
    delete process.env['IDENTITY_ENDPOINT'];
    delete process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];
  });

  it('blocks forbidden Entra/Graph/control-plane env injection', async () => {
    const { assertSkillForgeEnvironmentSafe } = await loadBootstrapModule();

    expect(() => assertSkillForgeEnvironmentSafe({
      IDENTITY_ENDPOINT: 'http://169.254.169.254/metadata/identity/oauth2/token',
      SKILLFORGE_SYSTEM_PROMPT_PATH: '/opt/skillforge/skillforge-prompt.md',
    })).toThrow(/forbidden Entra\/Graph\/control-plane env injection/i);
  });

  it('captures non-root and docker-socket isolation state', async () => {
    const { getSkillForgeIsolationSnapshot } = await loadBootstrapModule();

    const snapshot = getSkillForgeIsolationSnapshot({
      existsSync: () => false,
      dockerSocketPath: '/var/run/docker.sock',
    });

    expect(snapshot.runningAsNonRoot).toBe(true);
    expect(snapshot.dockerSocketPresent).toBe(false);
  });

  it('emits structured bootstrap audit records with the continuous prompt-shield policy', async () => {
    const { emitSkillForgeAuditEvent } = await loadBootstrapModule();
    const log = vi.fn();
    const appendFileSync = vi.fn();

    process.env['SKILLFORGE_PROMPT_SHIELD_POLICY'] = 'continuous';

    const record = emitSkillForgeAuditEvent('bootstrap-ready', {
      promptShieldPolicy: process.env['SKILLFORGE_PROMPT_SHIELD_POLICY'],
    }, {
      auditLogPath: '/tmp/test-skillforge-audit.jsonl',
      log,
      appendFileSync,
    });

    expect(record.component).toBe('skillforge-bootstrap');
    expect(record.event).toBe('bootstrap-ready');
    expect(record.details).toMatchObject({ promptShieldPolicy: 'continuous' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[skillforge-audit]'));
    expect(appendFileSync).toHaveBeenCalledWith(
      '/tmp/test-skillforge-audit.jsonl',
      expect.stringContaining('"promptShieldPolicy":"continuous"'),
      'utf8',
    );
  });

  it('creates default guardrail config from SkillForge env values', async () => {
    const { createSkillForgeGuardrailConfig } = await loadBootstrapModule();

    const config = createSkillForgeGuardrailConfig({
      SKILLFORGE_TIMEOUT_MINUTES: '15',
      SKILLFORGE_CPU_KILL_THRESHOLD: '80',
      SKILLFORGE_MEMORY_LIMIT_MB: '2048',
    });

    expect(config).toMatchObject({
      timeoutMinutes: 15,
      timeoutMs: 900000,
      cpuKillThreshold: 80,
      memoryLimitMb: 2048,
      sampleIntervalMs: 15000,
      cpuWindowMinutes: 5,
      cpuConsecutiveSamples: 20,
    });
  });

  it('detects memory and sustained CPU guardrail breaches', async () => {
    const { createSkillForgeGuardrailConfig, evaluateSkillForgeGuardrailSample } = await loadBootstrapModule();

    const config = createSkillForgeGuardrailConfig({
      SKILLFORGE_TIMEOUT_MINUTES: '15',
      SKILLFORGE_CPU_KILL_THRESHOLD: '80',
      SKILLFORGE_MEMORY_LIMIT_MB: '2048',
      SKILLFORGE_GUARDRAIL_SAMPLE_INTERVAL_MS: '15000',
      SKILLFORGE_CPU_WINDOW_MINUTES: '5',
    });

    const memoryResult = evaluateSkillForgeGuardrailSample({
      config,
      state: { consecutiveCpuBreaches: 0 },
      sample: { cpuPercent: 12, memoryRssMb: 4096 },
    });
    expect(memoryResult.breach).toMatchObject({
      reason: 'memory',
      details: { memoryRssMb: 4096, memoryLimitMb: 2048 },
    });

    const cpuResult = evaluateSkillForgeGuardrailSample({
      config,
      state: { consecutiveCpuBreaches: 19 },
      sample: { cpuPercent: 95, memoryRssMb: 512 },
    });
    expect(cpuResult.breach).toMatchObject({
      reason: 'cpu',
      details: {
        cpuPercent: 95,
        cpuKillThreshold: 80,
        consecutiveCpuBreaches: 20,
        requiredConsecutiveCpuBreaches: 20,
      },
    });
  });

  it('forwards audit records to Application Insights when a client is available', async () => {
    const { emitSkillForgeAuditEvent } = await loadBootstrapModule();
    const trackEvent = vi.fn();

    const record = emitSkillForgeAuditEvent('guardrails-configured', {
      timeoutMinutes: 15,
    }, {
      auditLogPath: '',
      appInsightsClient: { trackEvent },
      log: vi.fn(),
      appendFileSync: vi.fn(),
    });

    expect(record.event).toBe('guardrails-configured');
    expect(trackEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'SkillForgeAudit',
      properties: expect.objectContaining({
        event: 'guardrails-configured',
      }),
    }));
  });
});