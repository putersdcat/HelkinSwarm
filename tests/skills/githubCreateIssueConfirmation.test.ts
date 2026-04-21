// Regression lock for #665 / #703 — github_create_issue MUST require user
// confirmation through the safety pipeline. Without this guard the LLM has
// historically auto-filed junk issues from probe / ping / diagnostic phrasing
// (live evidence: #703 was auto-created at 2026-04-21T17:20:31Z from a
// "PROBE-700-RESCAN: ping after 188fd3c6 cleared" message that contained zero
// issue-filing intent).
//
// If a future change wants to relax this gate it must explicitly delete this
// test and post a justification on #665 / #703.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ManifestTool {
  name: string;
  requiresConfirmation: boolean;
  risk?: string;
}

interface SkillManifest {
  tools: ManifestTool[];
}

describe('github_create_issue safety gating (#665, #703)', () => {
  const manifestPath = resolve(__dirname, '../../skills/github/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillManifest;
  const tool = manifest.tools.find((t) => t.name === 'github_create_issue');

  it('exists in the github skill manifest', () => {
    expect(tool).toBeDefined();
  });

  it('requires safety-pipeline confirmation before invocation', () => {
    expect(tool?.requiresConfirmation).toBe(true);
  });
});
