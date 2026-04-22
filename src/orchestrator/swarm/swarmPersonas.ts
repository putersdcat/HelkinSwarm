// Swarm agent personas — system prompt builders for Leader and Worker agents.
// Loads persona definitions from src/persona/*.md and augments with task context.
// Spec ref: docs/0zh, docs/0zf §3
// Epic: #631, #672 (canonical prompt-shard parity)

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Canonical prompt shards (#672)
// Reproduced verbatim from docs/0zh §3.2, §3.3, §3.4 — these are correctness
// invariants of the canonical swarm, not stylistic choices. Every swarm agent
// system prompt (leader and worker) receives all three shards when userInfo
// and nowISO are supplied by the activity layer.
// ---------------------------------------------------------------------------

/** Per-turn user info shard fields — supplied by the activity layer. */
export interface SwarmUserInfo {
  displayName: string;
  handle: string;
  /** Subscription / role tier (e.g. "owner", "guest"). */
  tier: string;
  location?: string;
}

/**
 * Format the ## User Info + Current time block.
 * Per docs/0zh §3.4 this is re-injected at the start of every agent turn.
 */
export function formatUserInfoShard(info: SwarmUserInfo, nowISO: string): string {
  const location = info.location ?? 'Unknown';
  return `## User Info
(This section is provided in every conversation with this user. It may be irrelevant to most queries; use it only when directly relevant.)
- Display Name: ${info.displayName}
- Handle: ${info.handle}
- Subscription Level: ${info.tier}
- Location: ${location}

Current time: ${nowISO}`;
}

/**
 * Format the mandatory Internal Messaging Convention shard.
 * Reproduced verbatim from docs/0zh §3.2 (canonical package Doc 08).
 * The sender field is templated per agent.
 */
export function formatMessagingShard(senderName: string): string {
  return `**Internal Messaging Convention (MANDATORY)**
For every chatroom_send call, the "message" parameter MUST be a valid JSON string with this exact structure:
{
  "messageType": "thinking" | "tool_summary" | "analysis" | "response" | "question" | "contribution" | "final_contribution",
  "content":     "your full text",
  "confidence":  integer 0-100,
  "sender":      "${senderName}"
}
Always include "confidence". When you receive a message from another agent, parse the JSON string and use the fields to understand intent and weight the contribution. Never send plain text in chatroom_send.`;
}

/**
 * Format the mandatory Core Reasoning & Tool Selection shard.
 * Reproduced verbatim from docs/0zh §3.3 (canonical swarm_agent_reasoning_mechanism).
 */
export function formatReasoningShard(): string {
  return `**Core Reasoning & Tool Selection Guidelines (MANDATORY)**
On every turn you MUST follow this structure before outputting:
1. Assess information sufficiency.
2. If insufficient, choose the single best tool. Preference order:
   - \`code_execution\` for any computation, math, simulation, analysis
   - \`swarm_conversation_search\` for recall of prior swarm messages
   - external knowledge tools (\`web_search\`, \`browse_page\`) only when truly external facts are needed
   - \`wait\` only when explicit synchronization is required
3. After any tool result, immediately decide next action:
   - If you have enough, emit a \`chatroom_send\` with proper messageType
   - Otherwise continue reasoning or call another tool.`;
}

/**
 * Strip leader-only Render Components from inbound chatroom content.
 * Per docs/0zh §0 these XML-like tags are leader-only and must be removed
 * from any internal chatroom traffic before it is injected into another
 * agent's context window.
 */
const RENDER_TAG_PATTERN =
  /<\/?render_(inline_citation|searched_image|generated_image|edited_image|file)\b[^>]*>/gi;

export function stripRenderTags(content: string): string {
  return content.replace(RENDER_TAG_PATTERN, '').replace(/[ \t]+\n/g, '\n');
}

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
 * Uses the same Helkin persona file as the main orchestrator path, then appends
 * task-specific context. This preserves the single-conscious-mind contract from #658.
 */
export function buildLeaderSystemPrompt(input: {
  userQuery: string;
  synthesisInstructions: string;
  agentNames: string[];
  /** Per-turn user info shard (#672). Omit only in unit tests. */
  userInfo?: SwarmUserInfo;
  /** ISO 8601 timestamp for the per-turn `Current time:` line (#672). */
  nowISO?: string;
}): string {
  const agentList = input.agentNames.join(', ');
  const persona = loadPersona('Helkin');

  const base = persona
    ?? `You are Helkin, the team leader of a multi-agent swarm.
Your job is to synthesize a single, polished, high-quality final answer from your team's findings.
Never do deep research yourself — delegate it.`;

  const userInfoBlock =
    input.userInfo && input.nowISO
      ? `\n\n${formatUserInfoShard(input.userInfo, input.nowISO)}`
      : '';

  return `${base}${userInfoBlock}

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

${formatMessagingShard('Helkin')}

${formatReasoningShard()}

**Render Components (Helkin-only)**
\`render_inline_citation\`, \`render_searched_image\`, \`render_generated_image\`, \`render_edited_image\`, \`render_file\`.
These are parsed ONLY when they appear in your final non-tool response to the user. They are stripped from any internal chatroom_send message. Workers MUST NOT emit them.

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
  /** Per-turn user info shard (#672). Omit only in unit tests. */
  userInfo?: SwarmUserInfo;
  /** ISO 8601 timestamp for the per-turn `Current time:` line (#672). */
  nowISO?: string;
}): string {
  const agentList = input.agentNames.join(', ');
  const persona = loadPersona('Helkin');
  const base = persona ?? `You are Helkin, the team coordinator of a multi-agent swarm.`;

  const userInfoBlock =
    input.userInfo && input.nowISO
      ? `\n\n${formatUserInfoShard(input.userInfo, input.nowISO)}`
      : '';

  return `${base}${userInfoBlock}

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
- DO NOT write a final answer now — only delegation and coordination messages

${formatMessagingShard('Helkin')}

${formatReasoningShard()}`;
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
  /** Per-turn user info shard (#672). Omit only in unit tests. */
  userInfo?: SwarmUserInfo;
  /** ISO 8601 timestamp for the per-turn `Current time:` line (#672). */
  nowISO?: string;
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

  // Per-turn user info + current time shard (#672)
  const userInfoBlock =
    input.userInfo && input.nowISO
      ? `\n\n${formatUserInfoShard(input.userInfo, input.nowISO)}`
      : '';

  return `${identity}${behavioralNote}${priorSessionsNote}${userInfoBlock}

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

## Per-Round Chatroom Mandate (#710 Gap 3)
The chatroom IS your shared cognition. Silent rounds make Helkin synthesize blind.
**EVERY round in which you call a tool, you MUST also call chatroom_send** with a short \`interim_finding\` message describing what the tool result told you (or what is still missing). One sentence is enough. Examples:
- chatroom_send(to="Helkin", contentType="interim_finding"): "web_fetch_page returned the menu — the chocolate ganache uses 70% cocoa, no nuts. Still verifying allergen statement."
- chatroom_send(to="Helkin", contentType="interim_finding"): "places_search returned 4 candidates in 5km. Filtering by rating > 4.3 next."

Do NOT batch findings to the final round. Helkin and your teammates need them as they happen.

Note on chatroom delivery: Messages you send are queued and delivered to the recipient at their next activation. Teammates running in parallel with you will not see your messages in real time — but the messages will be waiting for them on their next swarm turn or second-pass wakeup.

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

${formatMessagingShard(input.agentName)}

${formatReasoningShard()}

**Render Components are leader-only.**
Never emit \`render_inline_citation\`, \`render_searched_image\`, \`render_generated_image\`, \`render_edited_image\`, or \`render_file\` in chatroom_send. Only Helkin may emit these in the final user-facing response.

## Important
- Stay focused on YOUR task. Don't expand scope without Helkin's direction.
- Return control when done — don't loop endlessly.`;
}
