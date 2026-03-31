import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBootstrapModule() {
  return import('../../infra/skillforge-bootstrap.mjs');
}

describe('SkillForge bootstrap security hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SKILLFORGE_PROMPT_SHIELD_POLICY'];
    delete process.env['IDENTITY_ENDPOINT'];
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
});