import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/bot/maintenanceMode.js', () => ({
  isOwnerUserId: vi.fn(async (userId: string) => userId === 'owner-user'),
}));

describe('stampPolicy confirmation bypass', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete process.env['STAMP_POLICY_JSON'];
    delete process.env['STAMP_POLICY_ALLOW_OUTLOOK_SEND_WITHOUT_CONFIRMATION'];
    const { resetStampPolicyForTests } = await import('../../src/config/stampPolicy.js');
    resetStampPolicyForTests();
  });

  it('allows configured high-risk confirmation bypass for owner authority', async () => {
    process.env['STAMP_POLICY_ALLOW_OUTLOOK_SEND_WITHOUT_CONFIRMATION'] = 'true';
    const { resetStampPolicyForTests, getConfirmationBypassRule } = await import('../../src/config/stampPolicy.js');
    resetStampPolicyForTests();

    await expect(getConfirmationBypassRule('owner-user', ['outlook_send_email'])).resolves.toMatchObject({
      applies: true,
      authority: 'policy-override-high-risk',
    });
  });

  it('denies configured high-risk confirmation bypass to guests', async () => {
    process.env['STAMP_POLICY_ALLOW_OUTLOOK_SEND_WITHOUT_CONFIRMATION'] = 'true';
    const { resetStampPolicyForTests, getConfirmationBypassRule } = await import('../../src/config/stampPolicy.js');
    resetStampPolicyForTests();

    await expect(getConfirmationBypassRule('guest-user', ['outlook_send_email'])).resolves.toMatchObject({
      applies: false,
      authority: 'policy-override-high-risk',
    });
  });

  it('allows vault write bypass for owner when env flag is set', async () => {
    process.env['STAMP_POLICY_ALLOW_VAULT_WRITE_WITHOUT_CONFIRMATION'] = 'true';
    const { resetStampPolicyForTests, getConfirmationBypassRule } = await import('../../src/config/stampPolicy.js');
    resetStampPolicyForTests();

    await expect(getConfirmationBypassRule('owner-user', ['vault_store_secret'])).resolves.toMatchObject({
      applies: true,
      authority: 'policy-override-high-risk',
    });
  });

  it('allows vault delete bypass for owner when env flag is set', async () => {
    process.env['STAMP_POLICY_ALLOW_VAULT_WRITE_WITHOUT_CONFIRMATION'] = 'true';
    const { resetStampPolicyForTests, getConfirmationBypassRule } = await import('../../src/config/stampPolicy.js');
    resetStampPolicyForTests();

    await expect(getConfirmationBypassRule('owner-user', ['vault_delete_secret'])).resolves.toMatchObject({
      applies: true,
      authority: 'policy-override-high-risk',
    });
  });

  it('denies vault write bypass to guests even when env flag is set', async () => {
    process.env['STAMP_POLICY_ALLOW_VAULT_WRITE_WITHOUT_CONFIRMATION'] = 'true';
    const { resetStampPolicyForTests, getConfirmationBypassRule } = await import('../../src/config/stampPolicy.js');
    resetStampPolicyForTests();

    await expect(getConfirmationBypassRule('guest-user', ['vault_store_secret'])).resolves.toMatchObject({
      applies: false,
    });
  });
});