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
    resolve(__dirname_local, '../../persona/helkinPersona.md'),
    resolve(__dirname_local, '../../../../src/persona/helkinPersona.md'),
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
  // Alternate persona files for model specialization (#648)
  agentFourPersonaAlternate: [
    resolve(__dirname_local, '../../persona/agentFourPersonaAlternate.md'),
    resolve(__dirname_local, '../../../../src/persona/agentFourPersonaAlternate.md'),
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
// Leader delegation prompt — Helkin as active coordinator (#644 Slice 2 / #645)
// ---------------------------------------------------------------------------

/**
 * Build the Leader delegation system prompt — used in the active coordinator phase.
 * The Leader reviews initial worker results and sends targeted follow-up via chatroom_send.
 * This runs BEFORE final synthesis — it must NOT produce the final answer yet.
 * Spec ref: docs/0ze §4.3, docs/0zh §3. Epic: #644 Slice 2 / #645.
 */
export function buildLeaderDelegationPrompt(input: {
  userQuery: string;
  agentNames: string[];
}): string {
  const agentList = input.agentNames.join(', ');
  const persona = loadPersona('Helkin');
  const base = persona ?? `You are Helkin, the team coordinator of a multi-agent swarm.`;

  return `${base}

## Phase: Active Coordination (NOT final synthesis)

User query: "${input.userQuery}"
Your specialists: ${agentList}

## Your Role RIGHT NOW
Your team has just completed their first research pass. Do NOT produce the final answer yet.
Instead: review the findings, identify gaps or contradictions, and send TARGETED follow-up
delegation messages via chatroom_send.

## Examples of good delegation
- "Harper, verify Benjamin's finding about [X] using a different source"
- "Lucas, analyze and rank the pricing data Benjamin and Harper gathered"
- "Benjamin, investigate whether [shop] also offers [service] — mentioned but unconfirmed"
- "Harper, the [claim] seems outdated — please find a current source"
- chatroom_send(to="All", contentType="status"): "Results are comprehensive — wrap up and finalize"

## Rules
- Use chatroom_send ONLY — no other tools available
- Address agents by EXACT NAME: ${agentList}
- Use contentType: "delegation" for work assignments, "question" for specific gaps
- If results are already comprehensive, send one broadcast "wrap up" message to "All"
- DO NOT write a final answer now — only delegation and coordination messages`;
}

// ---------------------------------------------------------------------------
// Worker prompt — Benjamin, Harper, or Lucas
// ---------------------------------------------------------------------------

/** Sentinel — schema default that carries no behavioral meaning. Do not inject as guidance. */
const DEFAULT_PERSONA_PLACEHOLDER = 'Focused and thorough research agent';

/**
 * Build a Worker agent system prompt.
 * Loads the agent's persona file and augments with task, tools, and team context.
 * If the decomposer assigned a non-default agentPersona, it is appended as Behavioral Guidance (#651).
 */
export function buildWorkerSystemPrompt(input: {
  agentName: string;
  agentRole: string;
  task: string;
  assignedToolNames: string[];
  allAgentNames: string[];
  userQuery: string;
  /** Decomposer-assigned behavioral persona override — injected when non-default (#651). */
  agentPersona?: string;
  /** Alternate persona file stem — loads a specialization file instead of the default (#648). */
  personaFile?: string;
  /** Prior session summaries loaded from agent's Cosmos vault — injected as memory context (#659). */
  priorSessionSummaries?: string[];
}): string {
  const toolList = input.assignedToolNames.join(', ');
  const teamList = input.allAgentNames.filter(n => n !== input.agentName).join(', ');
  // Use personaFile override if provided (agent specialization #648), else default by name
  const persona = (input.personaFile ? loadPersona(input.personaFile) : null) ?? loadPersona(input.agentName);

  const identity = persona
    ?? `You are ${input.agentName}, the ${input.agentRole} in a multi-agent swarm led by Helkin.`;

  // Inject decomposer behavioral guidance when it's a meaningful non-default override.
  const behavioralNote =
    input.agentPersona &&
    input.agentPersona.trim() !== DEFAULT_PERSONA_PLACEHOLDER
      ? `\n\n## Behavioral Guidance (Task-Specific)\n${input.agentPersona.trim()}`
      : '';

  // Inject prior session summaries when available (#659 — persistent session chains)
  const priorSessionsNote =
    input.priorSessionSummaries && input.priorSessionSummaries.length > 0
      ? `\n\n## Memory — Prior Sessions\nYou have participated in recent swarms. Use this context to build on prior findings and avoid repeating work:\n${input.priorSessionSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '';

  return `${identity}${behavioralNote}${priorSessionsNote}

## Your Teammates
${teamList}, and Helkin (team leader who synthesizes the final answer)

## Your Tools
You have access to: ${toolList}, chatroom_send, swarm_wait
Do not call tools outside this list.

## Your Task
User query: "${input.userQuery}"
Your specific assignment: ${input.task}

## Workflow
1. Execute your task using your assigned tools.
2. Send partial results to Helkin via chatroom_send as soon as you find them. Do NOT wait until you have everything.
3. Check TEAM MESSAGES for relevant information from teammates — use it to avoid duplicate work.
4. If you find something that another teammate should investigate, tell them via chatroom_send.
5. When your task is complete, send a final status message to Helkin.

## Synchronization (swarm_wait)
If your task is to SYNTHESIZE, RANK, or COMPARE and depends on data that another agent is gathering:
- Call swarm_wait({ waitFor: '<AgentName>', reason: '<why you need their data>' }) BEFORE executing your analysis.
- You will resume once their messages arrive (or after a timeout if they don't respond).
- Example: swarm_wait({ waitFor: 'Benjamin', reason: 'need pricing data before ranking options' })
- Only use swarm_wait once. If messages don't arrive, send your best available result anyway.

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
