import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('SkillForge prompt source wiring', () => {
  it('loads the fixed system prompt from skillforge-prompt.md and wires the base image to it', () => {
    const promptPath = resolve('src/skillforge/skillforge-prompt.md');
    const dockerfile = readFileSync('infra/Dockerfile.skillforge', 'utf8');
    const promptMarkdown = readFileSync(promptPath, 'utf8');
    const bootstrapSource = readFileSync('infra/skillforge-bootstrap.mjs', 'utf8');

    expect(promptMarkdown).toContain('You are SkillForge, a secure skill prototype agent.');
    expect(promptMarkdown).toContain('Only prototype TypeScript skills');
    expect(promptMarkdown).toContain('cannot do — need human');

    expect(bootstrapSource).toContain("const DEFAULT_PROMPT_PATH = '/opt/skillforge/skillforge-prompt.md';");
    expect(bootstrapSource).toContain('export function loadSkillForgePrompt');
    expect(bootstrapSource).toContain("readFileSync(promptPath, 'utf8').trim()");
    expect(bootstrapSource).toContain('startSkillForgeBootstrap()');
    expect(bootstrapSource).toContain('const keepAliveTimer = setInterval');
    expect(bootstrapSource).toContain("process.once('SIGTERM', shutdown);");

    expect(dockerfile).toContain('COPY src/skillforge/skillforge-prompt.md /opt/skillforge/skillforge-prompt.md');
    expect(dockerfile).toContain('COPY infra/skillforge-bootstrap.mjs /opt/skillforge/bootstrap.mjs');
    expect(dockerfile).toContain('ENV SKILLFORGE_SYSTEM_PROMPT_PATH=/opt/skillforge/skillforge-prompt.md');
    expect(dockerfile).toContain('CMD ["node", "/opt/skillforge/bootstrap.mjs"]');
  });
});