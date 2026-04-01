import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('SkillForge base image tooling source wiring', () => {
  it('keeps the promised dev toolchain in the final image and exposes it on PATH', () => {
    const dockerfile = readFileSync('infra/Dockerfile.skillforge', 'utf8');

    expect(dockerfile).toContain('ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1');
    expect(dockerfile).toContain('WORKDIR /opt/skillforge/tooling');
    expect(dockerfile).toContain('COPY package.json pnpm-lock.yaml ./');
    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile).toContain('pnpm add -D typescript eslint prettier @playwright/test playwright');
    expect(dockerfile).toContain('pnpm store prune');
    expect(dockerfile).toContain('ENV PATH=/opt/skillforge/tooling/node_modules/.bin:${PATH}');
    expect(dockerfile).toContain('USER forge');
  });
});