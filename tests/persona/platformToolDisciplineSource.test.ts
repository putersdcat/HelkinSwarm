import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #666 — prevent silent removal of the platform tool
// discipline block from the two persona files. That removal (commit f3a6255
// during the #656 persona cleanup) is the exact regression that filed #666,
// causing helkin_health_check / helkin_current_datetime to be called 19x in
// a single turn. Without a test, the next refactor can silently repeat it.

const helkin = readFileSync(
  join(process.cwd(), 'src', 'persona', 'helkinPersona.md'),
  'utf-8',
);
const drone = readFileSync(
  join(process.cwd(), 'src', 'persona', 'dronePersona.md'),
  'utf-8',
);

const PLATFORM_TOOLS = [
  'helkin_health_check',
  'helkin_get_costs',
  'helkin_get_openrouter_spend',
  'helkin_whoami',
  'helkin_list_skills',
  'helkin_skill_catalog',
  'helkin_recent_requests',
] as const;

describe('Persona platform tool discipline lock (#666)', () => {
  describe('helkinPersona.md', () => {
    it('carries the Platform tool discipline block header', () => {
      expect(helkin).toMatch(/\*\*Platform tool discipline:\*\*/);
    });

    it.each(PLATFORM_TOOLS)('lists %s inside the discipline block', (tool) => {
      expect(helkin).toMatch(new RegExp(`\`${tool}\``));
    });

    it('carries the explicit-ask gate phrase', () => {
      expect(helkin).toMatch(/unless the user explicitly asks for platform status or diagnostic data/);
    });

    it('carries the anti-orientation rationale', () => {
      expect(helkin).toMatch(/not orientation tools/);
    });
  });

  describe('dronePersona.md', () => {
    it('carries the Platform tool discipline block header', () => {
      expect(drone).toMatch(/\*\*Platform tool discipline:\*\*/);
    });

    it.each(PLATFORM_TOOLS)('lists %s inside the discipline block', (tool) => {
      expect(drone).toMatch(new RegExp(`\`${tool}\``));
    });

    it('carries the explicit-ask gate phrase', () => {
      expect(drone).toMatch(/unless the user explicitly asks for platform status or diagnostic data/);
    });

    it('carries the anti-orientation rationale', () => {
      expect(drone).toMatch(/not orientation tools/);
    });
  });

  it('both personas carry the IDENTICAL discipline block (mirror invariant)', () => {
    const extract = (src: string): string => {
      const match = src.match(/\*\*Platform tool discipline:\*\*[\s\S]+?(?=\n\n|$)/);
      expect(match).toBeTruthy();
      return match![0].trim();
    };
    expect(extract(helkin)).toBe(extract(drone));
  });
});
