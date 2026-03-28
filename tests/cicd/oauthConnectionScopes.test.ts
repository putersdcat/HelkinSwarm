import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('OAuth connection scopes', () => {
  it('includes Mail.Send in the stamp OAuth connection scopes', () => {
    const bicep = readFileSync('infra/main.bicep', 'utf8');
    expect(bicep).toContain('User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite offline_access');
  });

  it('includes Mail.Send in the router OAuth connection scopes', () => {
    const bicep = readFileSync('infra/main-router.bicep', 'utf8');
    expect(bicep).toContain('User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite offline_access');
  });
});