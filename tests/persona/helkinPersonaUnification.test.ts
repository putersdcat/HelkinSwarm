import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #658 — Helkin persona unification. The acceptance
// criteria require a single canonical `helkinPersona.md` loaded by both the
// solo path (`buildPromptActivity.ts`) and the swarm leader path
// (`swarmPersonas.ts`), with no active-code reference to the deprecated
// `dronePersona.md` or `agentOnePersona.md` files. These textual assertions
// guard the wiring so a refactor cannot silently fork persona loading again.

const cwd = process.cwd();

const helkinPersonaPath = join(cwd, 'src', 'persona', 'helkinPersona.md');
const buildPromptSrc = readFileSync(
  join(cwd, 'src', 'orchestrator', 'buildPromptActivity.ts'),
  'utf-8',
);
const swarmPersonasSrc = readFileSync(
  join(cwd, 'src', 'orchestrator', 'swarm', 'swarmPersonas.ts'),
  'utf-8',
);
const tabDevConsoleSrc = readFileSync(
  join(cwd, 'src', 'functions', 'tabDevConsole.ts'),
  'utf-8',
);

describe('Helkin persona unification (#658)', () => {
  it('canonical helkinPersona.md exists on disk', () => {
    expect(existsSync(helkinPersonaPath)).toBe(true);
  });

  it('helkinPersona references all three swarm colleagues by name', () => {
    const persona = readFileSync(helkinPersonaPath, 'utf-8');
    expect(persona).toMatch(/\bBenjamin\b/);
    expect(persona).toMatch(/\bHarper\b/);
    expect(persona).toMatch(/\bLucas\b/);
  });

  it('helkinPersona documents activate_swarm as the activation surface', () => {
    const persona = readFileSync(helkinPersonaPath, 'utf-8');
    expect(persona).toMatch(/activate_swarm/);
  });

  it('buildPromptActivity loads helkinPersona.md (solo path AC#2)', () => {
    expect(buildPromptSrc).toContain("'helkinPersona.md'");
    // Negative: never load the deprecated drone file
    expect(buildPromptSrc).not.toContain('dronePersona.md');
  });

  it('swarmPersonas Helkin key resolves helkinPersona.md (leader path AC#3)', () => {
    expect(swarmPersonasSrc).toContain("'../../persona/helkinPersona.md'");
    // Negative: never load the deprecated swarm-leader fork
    expect(swarmPersonasSrc).not.toContain('agentOnePersona.md');
  });

  it('tabDevConsole reads the same canonical file (single source of truth)', () => {
    expect(tabDevConsoleSrc).toContain("'helkinPersona.md'");
    expect(tabDevConsoleSrc).not.toContain('dronePersona.md');
    expect(tabDevConsoleSrc).not.toContain('agentOnePersona.md');
  });
});
