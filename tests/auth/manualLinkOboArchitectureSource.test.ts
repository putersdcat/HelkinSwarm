import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('manual link vs OBO architecture', () => {
  it('documents that manual magic-code link is legacy-token seeding, not OBO bootstrap', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const authDoc = readFileSync('docs/11-Authentication-Identity.md', 'utf8');
    const tabBootstrapSource = readFileSync('src/functions/tabBootstrapObo.ts', 'utf8');

    expect(botSource).toContain('magic-code-linked-token');
    expect(botSource).toContain('it is not the same thing as the');
    expect(botSource).toContain('Teams SSO assertion used by the real OBO bootstrap flows');
    expect(tabBootstrapSource).toContain("source: 'teams-tab-sso'");
    expect(authDoc).toContain('Manual `/link` / `/relink` magic-code completion');
    expect(authDoc).toContain('does not currently create an OBO session');
    expect(authDoc).toContain('tokenExchange');
    expect(authDoc).toContain('/api/tab/bootstrap-obo');
  });
});