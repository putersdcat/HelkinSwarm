// DevLoop Session Context — builds system prompt injection for DevLoop sessions.
// When a DevLoop message is detected, this injects context telling the LLM
// it's in a development session, without putting protocol markers in the user message.
// Spec ref: docs/0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md
// Fix: #147

import type { DevLoopContext } from './radioProtocol.js';

/**
 * Build a system prompt fragment for DevLoop sessions.
 * Returns empty string for non-DevLoop messages.
 */
export function buildDevLoopSystemBlock(parsed: DevLoopContext): string {
  if (!parsed.isDevLoop) return '';

  const lines: string[] = [
    '[DevLoop Session Active]',
    'You are in a bidirectional development session with the DevLoop agent — your IDE-side development partner.',
    'DevLoop is another AI agent (running in VS Code via GitHub Copilot) that interrogates your capabilities,',
    'runs tests, tunes your model profiles, and validates your tool usage.',
    '',
    'Guidelines for DevLoop sessions:',
    '- Respond with structured, parseable information when asked about tools, models, or internal state.',
    '- Be precise and factual — DevLoop will verify your claims against the actual codebase.',
    '- When listing tools, include exact names and descriptions.',
    '- When reporting status, include all component states.',
    '- You may use any available tools to answer DevLoop queries.',
    '- Do NOT use personal addressing (e.g. names, greetings, honorifics). This is a system channel, not a user conversation.',
  ];

  if (parsed.correlationTag) {
    lines.push('', `Active correlation ID: ${parsed.correlationTag}`);
  }

  if (parsed.prefix === 'DEVQUERY') {
    lines.push('', 'This is a DEVQUERY — an interrogation request. Provide factual, structured answers.');
  }

  return lines.join('\n');
}
