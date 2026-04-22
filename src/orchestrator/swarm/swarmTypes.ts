// Swarm shared types and Zod schemas.
// Spec ref: docs/0ze, docs/0zf, docs/0zg, docs/0zi
// Epic: #631

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Per-turn User Info shard (#672) — re-injected in every agent system prompt
// per docs/0zh §3.4. Resolved once at activity start from user-map.json + roles.
// ---------------------------------------------------------------------------

export const SwarmUserInfoSchema = z.object({
  displayName: z.string().min(1),
  handle: z.string().min(1),
  tier: z.string().min(1),
  location: z.string().optional(),
});
export type SwarmUserInfoPayload = z.infer<typeof SwarmUserInfoSchema>;

// ---------------------------------------------------------------------------
// Canonical chatroom_send JSON envelope (#673)
// Reproduced from docs/0zh §3.2 (canonical package Doc 08). Every agent is
// instructed to send a JSON string in the `message` parameter with exactly
// these four fields. The orchestrator parses, validates, and uses them for
// confidence-weighted handling and structured telemetry.
// ---------------------------------------------------------------------------

export const CANONICAL_MESSAGE_TYPES = [
  'thinking',
  'tool_summary',
  'analysis',
  'response',
  'question',
  'contribution',
  'final_contribution',
] as const;

export const CanonicalChatroomPayloadSchema = z.object({
  messageType: z.enum(CANONICAL_MESSAGE_TYPES),
  content: z.string(),
  confidence: z.number().int().min(0).max(100),
  sender: z.string().min(1),
});

export type CanonicalChatroomPayload = z.infer<typeof CanonicalChatroomPayloadSchema>;

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
    /** Worker requests orchestrator to execute a requiresSubAgent tool in an isolated sub-session (#638) */
    'sub_session_request',
    /** Orchestrator returns the result of a sub-session execution to the requesting agent (#638) */
    'sub_session_result',
  ]).default('text'),
  timestamp: z.number(),
  correlationId: z.string(),
  replyTo: z.string().uuid().optional(),
  /** Canonical envelope parsed from the raw JSON message string (#673). Optional for
   *  backwards compatibility with older transport-only messages. When present, the
   *  transcript and telemetry surface messageType, confidence, and sender. */
  messageType: z.enum(CANONICAL_MESSAGE_TYPES).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
  sender: z.string().min(1).optional(),
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
  /** Optional model deployment name for agent specialization (#648). */
  modelOverride: z.string().optional().describe('Model deployment name to use instead of the swarm default (e.g. "minimax/minimax-m2.7" for Lucas data-synthesis tasks)'),
  /** Optional alternate persona file stem for agent specialization (#648). */
  personaFile: z.string().optional().describe('Alternate persona file stem (e.g. "agentFourPersonaAlternate")'),
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
  /** Optional model deployment name for this agent (#648). */
  modelOverride?: string;
  /** Optional alternate persona file stem for this agent (#648). */
  personaFile?: string;
  /** Inbound messages from teammate agents — injected as context at the start of execution.
   *  Populated by the orchestrator for second-pass activities only (#644 Slice 1). */
  inboundMessages?: ChatroomMessage[];
  /** Per-turn user info shard (#672). Resolved once by the orchestrator from user-map + roles. */
  userInfo?: SwarmUserInfoPayload;
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
  /** Set when the agent called swarm_wait — orchestrator guarantees a second pass. (#646) */
  _requestsSecondPass?: boolean;
  /** Which agent(s) the worker was waiting for. Used for context-aware second-pass task. (#646) */
  _waitingFor?: string[];
  /** Number of retry attempts made for this worker (#664). */
  retryAttempts?: number;
  /** True if the worker is fatally failed after retry (#664). */
  fatal?: boolean;
  /** Cost in USD for this worker's LLM calls (#664). */
  cost?: number;
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
  /** If true, Leader acts as active coordinator — reviews transcript and sends delegation messages
   *  via chatroom_send. Does NOT produce final synthesis. (#644 Slice 2 / #645) */
  delegationMode?: boolean;
  /** Per-turn user info shard (#672). Resolved once by the orchestrator from user-map + roles. */
  userInfo?: SwarmUserInfoPayload;
}

export interface SwarmLeaderResult {
  synthesis: string;
  success: boolean;
  tokensUsed: number;
  roundsUsed: number;
  agentsHeardFrom: string[];
  model: string;
  error?: string;
  /** Delegation messages produced by Leader in delegationMode.
   *  Returned to orchestrator for distribution to worker second-pass. (#644 Slice 2 / #645) */
  _pendingChatroomMessages?: ChatroomMessage[];
}

export interface SwarmOrchestratorInput {
  plan: SwarmPlan;
  correlationId: string;
  userId: string;
  conversationReference?: unknown;
  userMessage: string;
  /**
   * [#707] Wall-clock budget the parent (sessionOrchestrator) has allocated
   * to this swarm sub-orchestration before it preempts via its outer
   * `swarmTimer`. The sub-orchestrator self-aborts with a graceful partial
   * result a few seconds before this deadline so the parent never observes a
   * race-lost orphaned sub-orchestrator (the silent-drop pattern documented in
   * #706 / #707). Optional and backward-compatible: when omitted, the swarm
   * runs without an internal deadline (legacy behaviour).
   */
  parentBudgetMs?: number;
}

export interface SwarmAgentCost {
  agent: string;
  tokens: number;
  model: string;
  toolsUsed: string[];
  durationMs: number;
  /** Actual cost in USD from the provider, if available (#664). */
  cost?: number;
}

export interface SwarmCost {
  decomposerTokens: number;
  workerTokens: number;
  leaderTokens: number;
  totalTokens: number;
  agentBreakdown: SwarmAgentCost[];
  /** Total cost in USD across all agents (#664). */
  totalCost?: number;
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
/**
 * Phrases that represent an explicit user directive to engage the swarm.
 * Exported so the orchestrator can treat explicit intent as a deterministic
 * forced-activation signal rather than merely a heuristic hint. (#675)
 */
export const EXPLICIT_SWARM_SIGNALS: readonly string[] = [
  'use the swarm', 'use swarm', 'swarm mode', 'ask the swarm',
  'send to swarm', 'with the swarm', 'try the swarm', 'activate swarm',
  'swarm this', 'use your team', 'use the team', 'ask your team',
] as const;

/**
 * Returns true when the user message contains an explicit request to engage
 * the swarm. When this is true, the orchestrator deterministically activates
 * the swarm instead of relying on Helkin's LLM tool-call discretion. (#675)
 */
export function hasExplicitSwarmOverride(message: string): boolean {
  const lower = message.toLowerCase();
  return EXPLICIT_SWARM_SIGNALS.some((s) => lower.includes(s));
}

/**
 * Compute a numeric swarm-eligibility score for a message.
 * Higher score = more likely to benefit from parallel multi-agent execution.
 * Returned separately from the boolean so the planner/decomposer can reason
 * about confidence levels, not just a binary gate (#640).
 *
 * Scale is 0-10. Explicit user override returns the maximum (10). Consumers
 * MUST treat this as a /10 score, not /100 — the SwarmComplexityGate defaults
 * (sequentialCeiling=3, swarmFloor=7) operate on the same scale. (#675)
 */
export function computeSwarmEligibilityScore(message: string): number {
  const lower = message.toLowerCase();

  // Explicit override — user directly requests swarm execution
  if (hasExplicitSwarmOverride(message)) return 10; // Explicit override = max score

  // Multi-faceted research signals — verbs that imply gathering/exploring
  const researchSignals = [
    'find', 'search', 'compare', 'research', 'investigate',
    'look up', 'look into', 'analyze', 'review', 'evaluate',
    'assess', 'examine', 'explore', 'survey',
  ];
  const verificationSignals = [
    'verify', 'confirm', 'check', 'cross-check', 'validate',
  ];
  // Non-comparative but still strongly multi-step work patterns.
  const executionSignals = [
    'calculate', 'compute', 'create', 'draft', 'write', 'merge',
    'combine', 'generate', 'synthesize', 'summarize', 'show the full',
  ];
  const sequentialWorkflowSignals = [
    ' then ', ' finally ', ' first ', ' second ', ' third ', ' next ',
    ' after that ', 'step-by-step', 'full step-by-step',
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

  // Geographic business-search composite signal (#653).
  // Queries like "find service centers in Munich" benefit strongly from parallel
  // web agents — require BOTH a location preposition AND a business-entity term.
  const geoPrepositions = [' in ', ' near ', ' around ', ' within ', 'nearby'];
  const businessEntityTerms = [
    'centers', 'branches', 'offices', 'outlets', 'dealers', 'distributors',
    'workshops', 'showrooms', 'service center', 'service point',
    'authorized', 'certified',
  ];

  let score = 0;

  // Geographic + business-entity composite: both signals must co-occur
  const hasGeoPreposition = geoPrepositions.some(p => lower.includes(p));
  const hasBusinessEntity = businessEntityTerms.some(t => lower.includes(t));
  if (hasGeoPreposition && hasBusinessEntity) score += 2;

  // Research verbs (count distinct matches — 2+ distinct verbs = stronger signal)
  const researchMatches = researchSignals.filter(s => lower.includes(s)).length;
  if (researchMatches >= 3) score += 2;
  else if (researchMatches >= 1) score += 1;
  // Verification intent
  if (verificationSignals.some(s => lower.includes(s))) score += 1;
  // Non-comparative execution verbs: research + calculation + synthesis should
  // also surface as strong swarm candidates, not just compare/rank phrasing (#691).
  const executionMatches = executionSignals.filter(s => lower.includes(s)).length;
  if (executionMatches >= 3) score += 2;
  else if (executionMatches >= 1) score += 1;
  const sequentialMatches = sequentialWorkflowSignals.filter(s => lower.includes(s)).length;
  if (sequentialMatches >= 2) score += 2;
  else if (sequentialMatches >= 1) score += 1;
  // Multi-domain connectors
  if (multiDomainSignals.some(s => lower.includes(s))) score += 2;
  // Compound analysis
  if (compoundSignals.some(s => lower.includes(s))) score += 2;
  // Multiple question marks suggest multi-faceted
  const questionMarks = (lower.match(/\?/g) ?? []).length;
  if (questionMarks >= 2) score += 1;
  // Long messages are more likely to benefit from parallelism
  if (lower.length > 200) score += 1;

  // [#691] Three-or-more-item enumerations ("X, Y, and Z" / "X, Y, or Z")
  // are a strong organic signal of multi-deliverable / multi-target work.
  // Each detected list contributes +2, capped at +4 (two distinct lists).
  // This is what pushes prompts like "Compare PostgreSQL, MySQL, and SQLite —
  // cover concurrent write performance, replication options, and JSON/document
  // support" from score 4 (maybe-swarm) into the always-swarm zone where
  // sessionOrchestrator deterministically injects activate_swarm.
  // Pattern requires at least two commas before the trailing "and"/"or"
  // (i.e. 3+ items) to avoid matching simple two-item conjunctions.
  const enumerationMatches = (lower.match(/[a-z0-9][^,;.!?\n]*?,[^,;.!?\n]*?,[^,;.!?\n]*?\s+(?:and|or)\s+[a-z0-9]/gi) ?? []).length;
  score += Math.min(enumerationMatches, 2) * 2;

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
