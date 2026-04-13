// Swarm agent personas — system prompt builders for Leader and Worker agents.
// Loads persona definitions from src/persona/*.md and augments with task context.
// Spec ref: docs/0zh, docs/0zf §3
// Epic: #631

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Persona file loading — cached at module init
// ---------------------------------------------------------------------------

const __dirname_local = dirname(fileURLToPath(import.meta.url));
// In compiled output (dist/src/orchestrator/swarm/) the persona dir is at ../../persona/
// In Docker the persona dir is copied to /home/site/wwwroot/src/persona/
const PERSONA_PATHS: Record<string, string[]> = {
  Helkin: [
    resolve(__dirname_local, '../../persona/agentOnePersona.md'),
    resolve(__dirname_local, '../../../../src/persona/agentOnePersona.md'),
  ],
  Benjamin: [
    resolve(__dirname_local, '../../persona/agentTwoPersona.md'),
    resolve(__dirname_local, '../../../../src/persona/agentTwoPersona.md'),
  ],
  Harper: [
    resolve(__dirname_local, '../../persona/agentThreePersona.md'),
    resolve(__dirname_local, '../../../../src/persona/agentThreePersona.md'),
  ],
  Lucas: [
    resolve(__dirname_local, '../../persona/agentFourPersona.md'),
    resolve(__dirname_local, '../../../../src/persona/agentFourPersona.md'),
  ],
};

const personaCache = new Map<string, string>();

function loadPersona(name: string): string | null {
  if (personaCache.has(name)) return personaCache.get(name)!;
  const candidates = PERSONA_PATHS[name];
  if (!candidates) return null;
  for (const p of candidates) {
    try {
      const content = readFileSync(p, 'utf-8').trim();
      personaCache.set(name, content);
      return content;
    } catch { /* try next candidate */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Leader prompt — Helkin (Agent One)
// ---------------------------------------------------------------------------

/**
 * Build the Leader agent system prompt.
 * Uses the Helkin persona file as foundation, then appends task-specific context.
 */
export function buildLeaderSystemPrompt(input: {
  userQuery: string;
  synthesisInstructions: string;
  agentNames: string[];
}): string {
  const agentList = input.agentNames.join(', ');
  const persona = loadPersona('Helkin');

  const base = persona
    ?? `You are Helkin, the team leader of a multi-agent swarm.
Your job is to synthesize a single, polished, high-quality final answer from your team's findings.
Never do deep research yourself — delegate it.`;

  return `${base}

## Current Team
${agentList}

## Your Task
User query: "${input.userQuery}"

Synthesis instructions: ${input.synthesisInstructions}

## Workflow
1. You will receive partial results from your team via the TEAM MESSAGES section.
2. Read all incoming messages carefully.
3. When you have enough verified data to produce a high-quality answer, synthesize it.
4. You do NOT need to wait for every team member — synthesize when you have sufficient data.
5. If you notice contradictions, note them in your synthesis.
6. If data is missing from a team member, note the gap but still produce the best answer possible.

## Communication
- Use chatroom_send to send delegation, clarifications, or "wrap up" messages to specific agents.
- Use chatroom_send with to="All" for broadcasts.

## Output
When you are ready to produce the final answer, output it directly as your response content.
Do NOT wrap it in a tool call. Just write the answer.
Format it cleanly in markdown with citations where possible.`;
}

// ---------------------------------------------------------------------------
// Worker prompt — Benjamin, Harper, or Lucas
// ---------------------------------------------------------------------------

/**
 * Build a Worker agent system prompt.
 * Loads the agent's persona file and augments with task, tools, and team context.
 */
export function buildWorkerSystemPrompt(input: {
  agentName: string;
  agentRole: string;
  task: string;
  assignedToolNames: string[];
  allAgentNames: string[];
  userQuery: string;
}): string {
  const toolList = input.assignedToolNames.join(', ');
  const teamList = input.allAgentNames.filter(n => n !== input.agentName).join(', ');
  const persona = loadPersona(input.agentName);

  const identity = persona
    ?? `You are ${input.agentName}, the ${input.agentRole} in a multi-agent swarm led by Helkin.`;

  return `${identity}

## Your Teammates
${teamList}, and Helkin (team leader who synthesizes the final answer)

## Your Tools
You have access to: ${toolList}, chatroom_send
Use ONLY these tools. Do not attempt to call tools not in your list.

## Your Task
User query: "${input.userQuery}"
Your specific assignment: ${input.task}

## Workflow
1. Execute your task using your assigned tools.
2. Send partial results to Helkin via chatroom_send as soon as you find them. Do NOT wait until you have everything.
3. Check TEAM MESSAGES for relevant information from teammates — use it to avoid duplicate work.
4. If you find something that another teammate should investigate, tell them via chatroom_send.
5. When your task is complete, send a final status message to Helkin.

## Communication Rules
- Send partial results immediately — don't hoard information.
- Be concise but information-dense (include key facts, addresses, numbers, URLs).
- Prefix structured data clearly (e.g., "FOUND: [shop name] | [address] | [certification]").
- If a tool call fails, report the failure to Helkin immediately.
- If you find contradictory information, flag it explicitly.

## Important
- Stay focused on YOUR task. Don't expand scope without Helkin's direction.
- Return control when done — don't loop endlessly.`;
}
