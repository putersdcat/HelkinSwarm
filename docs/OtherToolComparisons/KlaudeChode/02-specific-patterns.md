# Specific Pattern Comparison: Klaude Chode vs HelkinSwarm

> Deep dive into specific architectural patterns

---

## 1. Clarification Loop

### Klaude Chode — Implicit

Klaude Chode handles ambiguity through:
- User prompting when inputs are unclear
- Retry logic in QueryEngine
- No formal clarification protocol

### HelkinSwarm — Explicit State Machine

```typescript
// clarityLoop.ts — explicit clarification with timeout
const CLARIFICATION_TTL_MS = 10 * 60_000;

interface PendingClarification {
  id: string;
  reason: 'missing_calendar_time';
  questionText: string;
  expiresAt: Date;
  timeoutBehavior: 'expire_and_restart';
  resumeHint: string;
}

// Detection
function detectClarificationRequest(userMessage: string): ClarificationRequest | undefined {
  if (looksLikeCalendarCreateMissingTime(userMessage)) {
    return {
      pending: createPendingClarification(userMessage),
      responseMessage: 'I can do that, but I need one detail first: **what time?**'
    }
  }
}

// Resolution with timeout
function resolveClarificationAnswer(pending: PendingClarification, answer: string): ClarificationResolution {
  if (now > pending.expiresAt) {
    return { kind: 'expired', responseMessage: '⏰ That clarification request expired...' }
  }
  // ... handle cancel, retry, resume
}
```

**Key Difference:** HelkinSwarm has explicit state management with TTL and structured resolution paths.

---

## 2. Four-Eyes Verification Pipeline

### Klaude Chode — Simple Permission Check

```typescript
// Tool.ts — basic permission check
async checkPermissions(input, context) {
  const allowed = await this.permissionClassifier.isAllowed({
    toolName: this.name,
    input,
    context,
  })
  return { allowed }
}
```

### HelkinSwarm — 5-Step Mandatory Pipeline

```typescript
// verificationPipeline.ts — 5 mandatory steps
async function runVerificationPipeline(toolResult, context) {
  // Step 1: Schema validation
  validateAgainstOutputSchema(toolResult, tool.outputSchema)
  
  // Step 2: Data minimization
  const minimized = stripNonSchemaFields(toolResult)
  
  // Step 3: Spot-check (second eyes)
  if (result.count <= 10) {
    await verifyAllIds(toolResult.ids)
  } else {
    await spotCheckSample(toolResult.ids, 5)
  }
  
  // Step 4: Prompt shields
  await contentSafety.check(toolResult.output)  // Azure Content Safety
  
  // Step 5: Human confirmation (for high-risk)
  if (tool.risk === 'high') {
    await waitForHumanConfirmation(toolResult.summary)
  }
}
```

**Key Difference:** HelkinSwarm treats verification as mandatory architecture, not optional prompt engineering.

---

## 3. Executor Pattern

### Klaude Chode — Direct Execution

```typescript
// BashTool — direct execution
async execute(input, context) {
  const result = await Bun.spawn(['bash', '-c', input.command]).text()
  return { output: result }
}
```

### HelkinSwarm — Isolated Executor for High-Risk

```typescript
// executorActivity.ts — no LLM, pure code execution
interface ExecutorInput {
  toolName: string
  args: Record<string, unknown>
  signedPayload: { sessionId: string; hash: string }  // Cryptographic proof
}

async function executorActivity(input: ExecutorInput) {
  // Verify payload integrity
  const expectedHash = hashPayload(originalReadOutput)
  if (input.signedPayload.hash !== expectedHash) {
    throw new Error('Payload integrity check failed')
  }
  
  // Execute with zero LLM involvement
  switch (input.toolName) {
    case 'delete_messages':
      return await exchangeClient.deleteBatch(input.args.ids)
    case 'send_email':
      return await graphClient.send(input.args)
  }
}
```

**Key Difference:** HelkinSwarm's executor receives pre-verified, signed payloads. The LLM never directly triggers destructive actions.

---

## 4. Token Budget & Context Management

### Klaude Chode — Simple History

```typescript
// history.ts — basic truncation
class History {
  append(message) {
    this.messages.push(message)
    if (this.tokens > MAX_TOKENS) {
      this.truncate(MAX_TOKENS * 0.8)
    }
  }
}
```

### HelkinSwarm — Eternal Orchestrator with ContinueAsNew

```typescript
// overseer.ts — token budget tracking
df.app.orchestration('overseer', function* (context) {
  while (true) {
    const input = context.df.getInput()
    const tokenBudget = yield context.callActivity('tokenBudgetActivity', input)
    
    // 80% threshold — summarize and restart
    if (tokenBudget > 0.8 * MAX_TOKENS) {
      const summary = yield context.callActivity('summarizeActivity', {
        conversation: input.conversation,
        maxTokens: MAX_TOKENS * 0.4
      })
      
      // Carry through: summary + last 10 turns
      context.df.continueAsNew({
        ...input,
        summary,
        recentHistory: input.conversation.slice(-10),
        // recentHistory injected by buildPromptActivity
      })
    }
    
    // Process normally...
    const result = yield context.callSubOrchestration('sessionOrchestrator', input)
  }
})
```

**Key Difference:** HelkinSwarm's `continueAsNew` pattern allows infinite-horizon conversations without context collapse.

---

## 5. Skill Discovery Model

### Klaude Chode — All Tools Always Available

```typescript
// tools.ts — flat list, all available
function getAllTools() {
  return [
    new FileReadTool(),
    new FileWriteTool(),
    new BashTool(),
    // ... all ~40 tools
  ]
}
```

### HelkinSwarm — Discovery-First with Narrowing

```typescript
// capabilityLoader.ts — discovery-first model
function getToolsForPrompt(userMessage: string, skillContext?: string) {
  const isDiscoveryRequest = detectDiscoveryRequest(userMessage)
  
  if (isDiscoveryRequest) {
    // Initial: small core surface
    return getCoreTools()  // ~10 tools
  }
  
  // Normal: safety-filtered + discovery-narrowed
  const discoveryResults = searchSkillIndex(userMessage)
  
  if (discoveryResults.length > 0) {
    // Follow-up: narrowed subset + core tools
    return {
      tools: [...getRecommendedTools(discoveryResults), ...getCoreTools()],
      modelOverride: getModelAffinity(discoveryResults)
    }
  }
  
  return getAllSafetyFilteredTools()
}
```

**Key Difference:** HelkinSwarm presents a smaller initial surface and expands based on discovery, reducing prompt overwhelm.

---

## 6. Tool Presentation Per Model

### Klaude Chode — One Tool Schema

```typescript
// tools.ts — single schema for all models
const schema = z.object({
  name: 'bash',
  description: 'Execute shell command',
  parameters: { ... }  // Same for all models
})
```

### HelkinSwarm — Model-Specific Profiles

```typescript
// modelProfiles.ts — per-model tool presentation
const modelProfiles = {
  'grok-4-1-fast-reasoning': {
    toolFormat: 'openai',
    maxTools: 30,
    preferDescriptions: 'concise'
  },
  'gpt-5': {
    toolFormat: 'anthropic',
    maxTools: 50,
    preferDescriptions: 'detailed'
  }
}

function getToolSchemaForModel(tool: Tool, model: string): ToolSchema {
  const profile = modelProfiles[model]
  return {
    name: tool.name,
    description: profile.preferDescriptions === 'concise' 
      ? tool.shortDescription 
      : tool.fullDescription,
    parameters: adjustForFormat(tool.parameters, profile.toolFormat)
  }
}
```

**Key Difference:** HelkinSwarm tailors tool presentation to model strenghts (0b).

---

## 7. Memory Injection

### Klaude Chode — Static File Scanning

```typescript
// context.ts — scan for CLAUDE.md files
async function loadMemoryPrompt(cwd: string): Promise<string> {
  const memoryFiles = await glob('**/CLAUDE.md', { cwd })
  const memories = await Promise.all(
    memoryFiles.map(f => readFile(f))
  )
  return memories.join('\n\n')
}
```

### HelkinSwarm — Just-In-Time Vector Recall

```typescript
// memoryManager.ts — vector search with skill scoping
async function recall(
  query: string,
  options: { skillId?: string; topK?: number; minScore?: number }
): Promise<MemoryChunk[]> {
  const embedding = await embeddingRouter.getEmbedding(query)
  
  const results = await cosmos.query(multimodalMemory, {
    vectors: [embedding],
    k: options.topK ?? 5,
    filters: options.skillId ? { skillId: options.skillId } : undefined
  })
  
  return results
    .filter(r => r.score >= (options.minScore ?? 0.7))
    .map(r => r.chunk)
}

async function buildPromptActivity(input: BuildPromptInput) {
  // Just-in-time injection
  const relevantMemories = await mm.recall(input.query, {
    skillId: input.activeSkillId,
    topK: 5,
    minScore: 0.78
  })
  
  return buildPrompt({ ...input, memories: relevantMemories })
}
```

**Key Difference:** HelkinSwarm uses semantic search with scoring thresholds, Klaude Chode uses simple file concatenation.

---

## 8. Sub-Agent Model

### Klaude Chode — Simple Spawn

```typescript
// AgentTool — spawn with context
async execute(input, context) {
  const subAgent = new CopilotAgent({
    systemPrompt: `You are helping with: ${input.task}`,
    tools: getToolsForAgent(input.allowedTools),
    maxTurns: input.maxTurns ?? 5
  })
  
  const result = await subAgent.run(input.prompt)
  return { result }
}
```

### HelkinSwarm — Isolated Session with Minimal Context

```typescript
// subAgentActivity.ts — isolated execution
async function subAgentActivity(input: SubAgentInput): Promise<SubAgentResult> {
  // Fresh LLM session, no conversation history
  const session = await createIsolatedSession({
    model: input.modelOverride ?? 'secondary',  // Fast model
    systemPrompt: buildMinimalSystemPrompt(input.task),
    tools: getMinimalToolSubset(input.task)  // Only what's needed
  })
  
  // No recursive tool calls allowed
  const result = await session.complete(input.task, {
    allowRecursion: false
  })
  
  // Still runs through safety pipeline
  const verified = await runVerificationPipeline(result)
  
  return { result: verified.minimized }
}
```

**Key Difference:** HelkinSwarm sub-agents are truly isolated with minimal context and no recursion.

---

## 9. Multi-Modal Memory

### Klaude Chode — Text Only

- No native image/audio handling
- Memory is plain text files

### HelkinSwarm — Hydra-Net Router

```typescript
// embeddingRouter.ts — multimodal embeddings
const embeddingRouters = {
  text: (content: string) => textEmbeddingModel.embed(content),
  image: (imageData: Buffer) => visionEmbeddingModel.embed(imageData),
  audio: (audioData: Buffer) => speechEmbeddingModel.embed(audioData)
}

async function getEmbedding(content: unknown): Promise<Embedding> {
  if (typeof content === 'string') {
    return embeddingRouters.text(content)
  } else if (isImage(content)) {
    return embeddingRouters.image(content)
  } else if (isAudio(content)) {
    return embeddingRouters.audio(content)
  }
}

// Memory storage with modality tracking
await mm.store({
  content: multimodalContent,
  modality: detectModality(multimodalContent),
  skillId: 'document_analysis'
})
```

**Key Difference:** HelkinSwarm handles text + image + audio uniformly via Hydra-Net.

---

## 10. Hook System for Long-Running Workflows

### Klaude Chode — No Persistent Hooks

- Tasks can run in background but no persistent wake-up
- No durable continuation after context reset

### HelkinSwarm — Durable Hooks

```typescript
// durableHookActivity.ts — persistent callbacks
interface DurableHook {
  id: string
  trigger: {
    type: 'schedule' | 'event' | 'webhook'
    config: Record<string, unknown>
  }
  action: {
    type: 'resume_conversation'
    conversationId: string
    resumeMessage: string
  }
  createdAt: Date
  expiresAt?: Date
}

async function registerHook(hook: DurableHook) {
  // Persisted in Cosmos, survives ContinueAsNew
  await cosmos.create(hooksContainer, hook)
  
  // Register with Azure (timer trigger, event grid, etc.)
  await azure.registerTrigger(hook.trigger)
}

async function handleHookWake(hookId: string) {
  // Called when trigger fires
  const hook = await cosmos.read(hooksContainer, hookId)
  
  // Wake the overseer
  context.df.startNewEvent('HookWake', { hookId, action: hook.action })
}
```

**Key Difference:** HelkinSwarm hooks persist across `ContinueAsNew` and can wake the orchestrator based on external events.

---

## Summary Table

| Pattern | Klaude Chode | HelkinSwarm |
|---------|-------------|-------------|
| Clarification | User prompts | Explicit state machine with TTL |
| Verification | Simple permission check | 5-step mandatory pipeline |
| Executor | Direct execution | Signed payload, no LLM |
| Token Budget | Truncate history | ContinueAsNew with summary |
| Skill Discovery | All tools always | Discovery-first narrowing |
| Model Tuning | Single schema | Per-model profiles |
| Memory | Static file scan | Vector search with scoring |
| Sub-Agent | Spawn with context | Isolated, minimal, no recursion |
| Multimodal | Text only | Hydra-Net (text+image+audio) |
| Hooks | None | Durable persistent hooks |
