// Swarm shared types and Zod schemas.
// Spec ref: docs/0ze, docs/0zf, docs/0zg, docs/0zi
// Epic: #631

import { z } from 'zod';

// ---------------------------------------------------------------------------
// ChatroomMessage — the sole inter-agent communication primitive
// ---------------------------------------------------------------------------

export const ChatroomMessageSchema = z.object({
  id: z.string().uuid(),
  from: z.string().min(1),
  to: z.union([
    z.string().min(1),
    z.array(z.string().min(1)),
  ]),
  content: z.string(),
  contentType: z.enum([
    'text',
    'partial_result',
    'cross_verification',
    'question',
    'delegation',
    'vote',
    'error',
    'status',
  ]).default('text'),
  timestamp: z.number(),
  correlationId: z.string(),
  replyTo: z.string().uuid().optional(),
});

export type ChatroomMessage = z.infer<typeof ChatroomMessageSchema>;

// ---------------------------------------------------------------------------
// SwarmChatroomEntity state
// ---------------------------------------------------------------------------

export interface SwarmChatroomState {
  swarmCorrelationId: string;
  registeredAgents: string[];
  queues: Record<string, ChatroomMessage[]>;
  transcript: ChatroomMessage[];
  messagesCount: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// SwarmAgent — one agent in a SwarmPlan
// ---------------------------------------------------------------------------

export const SwarmAgentSchema = z.object({
  name: z.string().min(1).describe('Agent identifier (e.g. "Alpha", "Beta")'),
  role: z.string().min(1).describe('Role description (e.g. "Research Specialist")'),
  task: z.string().min(1).describe('Specific task to accomplish'),
  assignedTools: z.array(z.string()).describe('Tool names this agent may use'),
  persona: z.string().min(1).describe('Full system prompt for this agent'),
});

export type SwarmAgent = z.infer<typeof SwarmAgentSchema>;

// ---------------------------------------------------------------------------
// SwarmPlan — the decomposer output
// ---------------------------------------------------------------------------

export const SwarmPlanSchema = z.object({
  swarmId: z.string().uuid(),
  userQuery: z.string(),
  leader: z.object({
    name: z.string().default('Leader'),
    synthesisInstructions: z.string().describe('Instructions for the Leader to synthesize final answer'),
  }),
  agents: z.array(SwarmAgentSchema).min(1).max(6),
  timeoutMs: z.number().int().min(5_000).max(120_000).default(60_000),
  maxRoundsPerAgent: z.number().int().min(1).max(8).default(4),
});

export type SwarmPlan = z.infer<typeof SwarmPlanSchema>;

// ---------------------------------------------------------------------------
// Activity I/O types
// ---------------------------------------------------------------------------

export interface SwarmDecomposerInput {
  userMessage: string;
  correlationId: string;
  userId: string;
  availableToolNames: string[];
}

export interface SwarmDecomposerResult {
  plan: SwarmPlan | null;
  tokensUsed: number;
  decomposerModel: string;
  /** If null, the decomposer decided swarm is not warranted. */
  fallbackReason?: string;
}

export interface SwarmWorkerInput {
  agentName: string;
  agentRole: string;
  agentPersona: string;
  task: string;
  assignedTools: string[];
  swarmId: string;
  swarmCorrelationId: string;
  chatroomEntityId: string;
  userId: string;
  correlationId: string;
  maxRounds: number;
  userQuery: string;
}

export interface SwarmWorkerResult {
  agentName: string;
  success: boolean;
  roundsUsed: number;
  tokensUsed: number;
  toolCallsMade: number;
  chatroomMessagesSent: number;
  error?: string;
  model: string;
}

export interface SwarmLeaderInput {
  leaderName: string;
  synthesisInstructions: string;
  swarmId: string;
  swarmCorrelationId: string;
  chatroomEntityId: string;
  userId: string;
  correlationId: string;
  userQuery: string;
  agentNames: string[];
  timeoutMs: number;
}

export interface SwarmLeaderResult {
  synthesis: string;
  success: boolean;
  tokensUsed: number;
  roundsUsed: number;
  agentsHeardFrom: string[];
  model: string;
  error?: string;
}

export interface SwarmOrchestratorInput {
  plan: SwarmPlan;
  correlationId: string;
  userId: string;
  conversationReference?: unknown;
  userMessage: string;
}

export interface SwarmAgentCost {
  agent: string;
  tokens: number;
  model: string;
}

export interface SwarmCost {
  decomposerTokens: number;
  workerTokens: number;
  leaderTokens: number;
  totalTokens: number;
  agentBreakdown: SwarmAgentCost[];
}

export interface SwarmOrchestratorResult {
  response: string;
  success: boolean;
  totalTokensUsed: number;
  agentResults: SwarmWorkerResult[];
  leaderResult: SwarmLeaderResult;
  chatroomTranscript: ChatroomMessage[];
  swarmId: string;
  swarmCost?: SwarmCost;
}

// ---------------------------------------------------------------------------
// Swarm-eligible classification
// ---------------------------------------------------------------------------

/**
 * Signals that a request may benefit from parallel multi-agent execution.
 * This is used by the planner to decide whether to invoke the swarm decomposer.
 */
export function isSwarmEligible(message: string): boolean {
  const lower = message.toLowerCase();

  // Multi-faceted research signals — verbs that imply gathering/exploring
  const researchSignals = [
    'find', 'search', 'compare', 'research', 'investigate',
    'look up', 'look into', 'analyze', 'review', 'evaluate',
    'assess', 'examine', 'explore', 'survey',
  ];
  const verificationSignals = [
    'verify', 'confirm', 'check', 'cross-check', 'validate',
  ];
  // Connectors implying multiple domains or aspects
  const multiDomainSignals = [
    'and also', 'additionally', 'as well as', 'along with',
    'plus', 'on top of', 'together with', 'for each',
    'respectively', 'in addition',
  ];
  // Compound/comparative analysis patterns
  const compoundSignals = [
    'compare', 'pros and cons', 'best option', 'ranking',
    'alternatives', 'recommendations', 'side by side',
    'tradeoffs', 'tradeoff', 'trade-offs', 'trade-off',
    'decision matrix', 'approaches', 'versus', ' vs ',
    'strengths and weaknesses', 'advantages and disadvantages',
  ];

  let score = 0;

  // Research verbs (count distinct matches — 2+ distinct verbs = stronger signal)
  const researchMatches = researchSignals.filter(s => lower.includes(s)).length;
  if (researchMatches >= 3) score += 2;
  else if (researchMatches >= 1) score += 1;
  // Verification intent
  if (verificationSignals.some(s => lower.includes(s))) score += 1;
  // Multi-domain connectors
  if (multiDomainSignals.some(s => lower.includes(s))) score += 2;
  // Compound analysis
  if (compoundSignals.some(s => lower.includes(s))) score += 2;
  // Multiple question marks suggest multi-faceted
  const questionMarks = (lower.match(/\?/g) ?? []).length;
  if (questionMarks >= 2) score += 1;
  // Long messages are more likely to benefit from parallelism
  if (lower.length > 200) score += 1;

  // Threshold: 3+ signals = swarm-eligible
  return score >= 3;
}
