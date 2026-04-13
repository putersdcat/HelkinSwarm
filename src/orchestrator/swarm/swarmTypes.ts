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
  name: z.string().min(1).describe('Agent identifier — must be Benjamin, Harper, or Lucas'),
  role: z.string().min(1).describe('Role description (e.g. "Research Specialist")'),
  task: z.string().min(1).describe('Specific task to accomplish'),
  assignedTools: z.array(z.string()).describe('Tool names this agent may use'),
  persona: z.string().default('Focused and thorough research agent'),
  /** Optional per-agent token budget allocated by decomposer (#647). */
  tokenBudget: z.number().int().positive().optional().describe('Max total tokens this agent may consume'),
});

export type SwarmAgent = z.infer<typeof SwarmAgentSchema>;

// ---------------------------------------------------------------------------
// SwarmPlan — the decomposer output
// ---------------------------------------------------------------------------

export const SwarmPlanSchema = z.object({
  swarmId: z.string().uuid(),
  userQuery: z.string(),
  leader: z.object({
    name: z.string().default('Helkin'),
    synthesisInstructions: z.string().describe('Instructions for Helkin to synthesize final answer'),
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
  /** Planner-assigned complexity classification (#640). */
  complexityClass?: 'simple' | 'compound' | 'complex';
  /** Numeric swarm eligibility score from vocabulary analysis (#640). */
  swarmEligibilityScore?: number;
  /** Conversation summary from overseer state — gives decomposer prior-turn context (#640). */
  conversationSummary?: string;
  /** Skill domains with at least one executable tool — helps decomposer assign domain experts (#640). */
  activeSkillDomains?: string[];
  /** Remaining session token budget — helps decomposer size agent assignments (#647). */
  tokenBudgetRemaining?: number;
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
  allAgentNames?: string[];
  swarmId: string;
  swarmCorrelationId: string;
  chatroomEntityId: string;
  userId: string;
  correlationId: string;
  maxRounds: number;
  userQuery: string;
  /** Optional per-agent token budget. Worker stops when exceeded (#647). */
  tokenBudget?: number;
}

export interface SwarmWorkerResult {
  agentName: string;
  success: boolean;
  roundsUsed: number;
  tokensUsed: number;
  toolCallsMade: number;
  chatroomMessagesSent: number;
  toolsUsed: string[];
  durationMs: number;
  error?: string;
  model: string;
  /** Token budget that was assigned (if any) (#647). */
  tokenBudget?: number;
  /** True if the worker stopped because it exceeded its token budget (#647). */
  tokenBudgetExceeded?: boolean;
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
  toolsUsed: string[];
  durationMs: number;
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
 * Compute a numeric swarm-eligibility score for a message.
 * Higher score = more likely to benefit from parallel multi-agent execution.
 * Returned separately from the boolean so the planner/decomposer can reason
 * about confidence levels, not just a binary gate (#640).
 */
export function computeSwarmEligibilityScore(message: string): number {
  const lower = message.toLowerCase();

  // Explicit override — user directly requests swarm execution
  const explicitSwarmSignals = [
    'use the swarm', 'use swarm', 'swarm mode', 'ask the swarm',
    'send to swarm', 'with the swarm', 'try the swarm', 'activate swarm',
    'swarm this', 'use your team', 'use the team', 'ask your team',
  ];
  if (explicitSwarmSignals.some(s => lower.includes(s))) return 10; // Explicit override = max score

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

  return score;
}

/**
 * Swarm complexity gate zones — drives routing decisions (#640 AC 3).
 * - `always-sequential`: score too low, never route to swarm
 * - `maybe-swarm`: in the zone where heuristic + decomposer co-decide
 * - `always-swarm`: score high enough that swarm should always be tried
 */
export type SwarmComplexityZone = 'always-sequential' | 'maybe-swarm' | 'always-swarm';

/** Thresholds for the complexity gate. Configurable via env vars. */
export interface SwarmComplexityGate {
  /** Score below this → always-sequential (default: 3) */
  sequentialCeiling: number;
  /** Score at or above this → always-swarm (default: 7) */
  swarmFloor: number;
}

/**
 * Read complexity gate thresholds from env vars, with sensible defaults.
 * Called from activities (env-safe context).
 */
export function getSwarmComplexityGate(): SwarmComplexityGate {
  const seqCeiling = parseInt(process.env['SWARM_ELIGIBILITY_THRESHOLD'] ?? '3', 10);
  const swarmFloor = parseInt(process.env['SWARM_ALWAYS_THRESHOLD'] ?? '7', 10);
  return {
    sequentialCeiling: Number.isFinite(seqCeiling) ? seqCeiling : 3,
    swarmFloor: Number.isFinite(swarmFloor) ? swarmFloor : 7,
  };
}

/**
 * Classify a swarm eligibility score into a complexity zone.
 */
export function classifySwarmZone(score: number, gate?: SwarmComplexityGate): SwarmComplexityZone {
  const { sequentialCeiling, swarmFloor } = gate ?? getSwarmComplexityGate();
  if (score < sequentialCeiling) return 'always-sequential';
  if (score >= swarmFloor) return 'always-swarm';
  return 'maybe-swarm';
}

/**
 * Signals that a request may benefit from parallel multi-agent execution.
 * This is used by the planner to decide whether to invoke the swarm decomposer.
 */
export function isSwarmEligible(message: string): boolean {
  const gate = getSwarmComplexityGate();
  return computeSwarmEligibilityScore(message) >= gate.sequentialCeiling;
}
