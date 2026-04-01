# Klaude Chode vs HelkinSwarm

> Two platforms that share similar concepts — CLI tool vs Teams bot — but execute them so differently at the code level that the gap matters.

---

## What Each Platform Is

### Klaude Chode

A **terminal-native CLI** built with Bun and TypeScript. You run it locally, it calls an LLM API, tools execute synchronously in the same process, and sessions are persisted to flat files. It is a single binary that lives on your machine.

### HelkinSwarm

A **cloud-deployed Teams bot** built on Azure Durable Functions. Messages arrive via Bot Framework, an eternal orchestrator maintains session state across `ContinueAsNew` cycles, tools dispatch through a mandatory five-layer safety pipeline, and all state lives in Cosmos DB with vector search. There is no single binary — it is an infrastructure.

---

## High-Level Contrast

| | Klaude Chode | HelkinSwarm |
|--|--|--|
| **Deployment** | Local binary | Azure cloud (Functions + Cosmos) |
| **Session model** | Single in-process loop, file-persisted | Eternal overseer, Cosmos DB state |
| **Tool execution** | Synchronous, direct, same process | Activity functions, isolated side-effects |
| **Safety** | Pattern-match permission rules | 5-layer mandatory pipeline |
| **Memory** | `CLAUDE.md` files, keyword scan | DiskANN vector recall, per-skill vaults |
| **Context renewal** | Truncate history | `ContinueAsNew` + summary injection |
| **Tool discovery** | All ~40 tools always surfaced | Discovery-first narrowing → core + recommended |
| **Model tuning** | One schema for all models | Per-model tool profiles (0b) |
| **Sub-agents** | Spawn with shared context | Isolated session, minimal tools, no recursion |
| **Multimodal** | Text only | Hydra-Net (text + image + audio) |
| **Hooks** | None | Durable timers + event-driven wake |
| **UI** | React + Ink terminal | Teams chat + Adaptive Cards |

---

## Where the Gap Is Real

These are the areas where the two platforms share a concept name but the implementation difference is not cosmetic — it changes what the system is actually capable of.

---

### 1 — Session Continuity

**Klaude Chode** truncates history when tokens run out. The session restarts lean.

```typescript
// history.ts
append(message) {
  this.messages.push(message)
  if (this.tokens > MAX_TOKENS) {
    this.truncate(MAX_TOKENS * 0.8)  // Drops oldest entries
  }
}
```

**HelkinSwarm** never loses a running conversation. At 80% context budget it summarizes the current state and calls `ContinueAsNew`, carrying the summary forward so the orchestrator has full continuity across the restart.

```typescript
// overseer.ts
if (tokenBudget > 0.8 * MAX_TOKENS) {
  const summary = yield context.callActivity('summarizeActivity', { conversation, maxTokens: MAX_TOKENS * 0.4 })
  context.df.continueAsNew({ ...input, summary, recentHistory: input.conversation.slice(-10) })
}
```

The practical difference: a 2-hour debugging session in Klaude Chode eventually behaves like a fresh conversation. In HelkinSwarm it never loses the thread.

---

### 2 — Tool Safety and Verification

**Klaude Chode** checks permissions with pattern matching before execution:

```typescript
// Tool.ts
async checkPermissions(input, context) {
  return { allowed: await this.permissionClassifier.isAllowed({ toolName: this.name, input, context }) }
}
```

An ML classifier can add adaptive rules in auto mode, but the execution path is still direct — the LLM call and the tool call happen in the same loop without a mandatory isolation step.

**HelkinSwarm** treats every tool call as a structured event that must pass through five mandatory stages before result data can be returned to the LLM:

```typescript
// verificationPipeline.ts
async function runVerificationPipeline(toolResult, context) {
  validateAgainstOutputSchema(toolResult, tool.outputSchema)        // Step 1
  const minimized = stripNonSchemaFields(toolResult)              // Step 2
  if (toolResult.count <= 10) await verifyAllIds(toolResult.ids) // Step 3
  else await spotCheckSample(toolResult.ids, 5)
  await contentSafety.check(toolResult.output)                      // Step 4
  if (tool.risk === 'high') await waitForHumanConfirmation(...)  // Step 5
}
```

For tools flagged `requiresExecutor`, the LLM is entirely out of the execution path — it receives a pre-verified signed payload:

```typescript
// executorActivity.ts
async function executorActivity(input: ExecutorInput) {
  const expectedHash = hashPayload(originalReadOutput)
  if (input.signedPayload.hash !== expectedHash) throw new Error('Integrity check failed')
  // Zero LLM involvement. Pure code execution.
  switch (input.toolName) {
    case 'delete_messages': return await exchangeClient.deleteBatch(input.args.ids)
  }
}
```

The practical difference: in Klaude Chode a misclassified `rm -rf` pattern can reach the shell. In HelkinSwarm a high-risk tool goes through a non-bypassable verification step and is rejected if the safety mode blocks it.

---

### 3 — Memory and Context Injection

**Klaude Chode** loads `CLAUDE.md` files at startup and concatenates them:

```typescript
// context.ts
async function loadMemoryPrompt(cwd: string): Promise<string> {
  const memoryFiles = await glob('**/CLAUDE.md', { cwd })
  const memories = await Promise.all(memoryFiles.map(f => readFile(f)))
  return memories.join('\n\n')
}
```

There is no semantic search, no scoring, no relevance ranking. Every loaded memory appears in every prompt regardless of whether it is relevant.

**HelkinSwarm** injects only the semantically relevant chunks at prompt time with a score threshold:

```typescript
// memoryManager.ts
async function recall(query: string, options: { skillId?: string; topK?: number; minScore?: number }): Promise<MemoryChunk[]> {
  const embedding = await embeddingRouter.getEmbedding(query)
  const results = await cosmos.query(multimodalMemory, {
    vectors: [embedding], k: options.topK ?? 5,
    filters: options.skillId ? { skillId: options.skillId } : undefined
  })
  return results.filter(r => r.score >= (options.minScore ?? 0.7)).map(r => r.chunk)
}
```

Skill-specific vaults exist independently (`skillMemory-outlook`, `skillMemory-github`), and only the relevant subset is injected per turn:

```typescript
// buildPromptActivity.ts
const relevantMemories = await mm.recall(input.query, { skillId: input.activeSkillId, topK: 5, minScore: 0.78 })
```

The practical difference: Klaude Chode's memory is auditable and git-tracked but requires manual curation. HelkinSwarm's memory learns automatically but is opaque and requires infrastructure.

---

### 4 — Tool Presentation and Discovery

**Klaude Chode** sends all ~40 tools in every prompt. There is no narrowing based on context:

```typescript
// tools.ts
function getAllTools() {
  return [new FileReadTool(), new FileWriteTool(), new BashTool(), /* ...all 40 */]
}
```

**HelkinSwarm** starts with a narrow core surface and only expands when the request is classified:

```typescript
// capabilityLoader.ts
function getToolsForPrompt(userMessage: string, skillContext?: string) {
  if (detectDiscoveryRequest(userMessage)) return getCoreTools()  // ~10 tools

  const discoveryResults = searchSkillIndex(userMessage)
  if (discoveryResults.length > 0) {
    return {
      tools: [...getRecommendedTools(discoveryResults), ...getCoreTools()],
      modelOverride: getModelAffinity(discoveryResults)
    }
  }
  return getAllSafetyFilteredTools()
}
```

Additionally, the schema presented to the model is tuned per-model:

```typescript
// modelProfiles.ts
const modelProfiles = {
  'grok-4-1-fast-reasoning': { toolFormat: 'openai', maxTools: 30, preferDescriptions: 'concise' },
  'gpt-5': { toolFormat: 'anthropic', maxTools: 50, preferDescriptions: 'detailed' }
}
```

The practical difference: Klaude Chode's model sees everything and must reason about what is relevant. HelkinSwarm's model sees only what is relevant to the current turn and gets schemas shaped for that model's strengths.

---

### 5 — Sub-Agent Isolation

**Klaude Chode** spawns a sub-agent by passing full context:

```typescript
// AgentTool
async execute(input, context) {
  const subAgent = new CopilotAgent({
    systemPrompt: `You are helping with: ${input.task}`,
    tools: getToolsForAgent(input.allowedTools),  // Shares full context
    maxTurns: input.maxTurns ?? 5
  })
  const result = await subAgent.run(input.prompt)
}
```

**HelkinSwarm** creates a genuinely isolated session with no conversation history and no recursive tool calls:

```typescript
// subAgentActivity.ts
async function subAgentActivity(input: SubAgentInput): Promise<SubAgentResult> {
  const session = await createIsolatedSession({
    model: input.modelOverride ?? 'secondary',
    systemPrompt: buildMinimalSystemPrompt(input.task),
    tools: getMinimalToolSubset(input.task)  // Only what this task needs
  })
  const result = await session.complete(input.task, { allowRecursion: false })
  const verified = await runVerificationPipeline(result)
  return { result: verified.minimized }
}
```

The practical difference: Klaude Chode sub-agents can recursively call tools and compound context. HelkinSwarm sub-agents are fire-and-forget with a strict capability boundary.

---

### 6 — Clarification Handling

**Klaude Chode** resolves ambiguity through user prompting — retry logic in the loop if the LLM hits a dead end:

```typescript
// QueryEngine — implicit
if (response.requiresClarification) {
  // LLM generates a clarifying question, user answers, loop continues
}
```

**HelkinSwarm** tracks clarifications as explicit state machine events with TTL and structured resolution paths:

```typescript
// clarityLoop.ts
interface PendingClarification {
  id: string
  reason: 'missing_calendar_time'
  questionText: string
  expiresAt: Date
  timeoutBehavior: 'expire_and_restart'
  resumeHint: string
}

function resolveClarificationAnswer(pending: PendingClarification, answer: string): ClarificationResolution {
  if (now > pending.expiresAt) {
    return { kind: 'expired', responseMessage: '⏰ That clarification request expired...' }
  }
}
```

The practical difference: Klaude Chode relies on the LLM to detect and surface ambiguity. HelkinSwarm has a separate state layer that survives context resets and can timeout or queue follow-up.

---

### 7 — Multimodal Capability

**Klaude Chode** is text-only. Attachments, images, and audio are not in scope.

**HelkinSwarm** routes embeddings through Hydra-Net, a modality-aware router:

```typescript
// embeddingRouter.ts
const embeddingRouters = {
  text:   (content: string)  => textEmbeddingModel.embed(content),
  image:   (imageData: Buffer) => visionEmbeddingModel.embed(imageData),
  audio:   (audioData: Buffer) => speechEmbeddingModel.embed(audioData)
}

async function getEmbedding(content: unknown): Promise<Embedding> {
  if (typeof content === 'string') return embeddingRouters.text(content)
  else if (isImage(content))      return embeddingRouters.image(content)
  else if (isAudio(content))      return embeddingRouters.audio(content)
}
```

Memory storage tracks modality alongside content:

```typescript
await mm.store({ content: multimodalContent, modality: detectModality(multimodalContent), skillId: 'document_analysis' })
```

The practical difference: Klaude Chode handles text in, text out. HelkinSwarm can ingest an image or audio clip and reason over it in context within the same turn.

---

## Pattern Comparison at a Glance

| Pattern | Klaude Chode | HelkinSwarm |
|---------|-------------|--------------|
| Clarification | LLM-driven retry | Explicit state machine + TTL |
| Verification | Permission classifier | 5-step mandatory pipeline |
| Executor | Direct shell call | Signed payload, no LLM |
| Context renewal | History truncation | ContinueAsNew + summary |
| Tool discovery | Flat list, always all | Discovery-first narrowing |
| Model tuning | Single schema | Per-model profiles |
| Memory | File concatenation | Vector search + scoring |
| Sub-agents | Full shared context | Isolated, minimal, no recursion |
| Multimodal | None | Hydra-Net |
| Hooks | None | Durable timers + wake events |

---

## The Honest Bottom Line

These are not two takes on the same problem. They are different problems:

- **Klaude Chode** is a local, synchronous, auditable coding assistant with a flat tool surface and full user control. Its complexity is bounded by the developer's machine.
- **HelkinSwarm** is a cloud-hosted, asynchronous, infrastructure-grade agent runtime with persistent memory, mandatory safety gates, and multi-modal capability. Its complexity is bounded by the Azure subscription.

The concepts overlap (tool dispatch, session management, memory, safety checks) but the execution model is fundamentally different. When they look similar on a whiteboard, the code reveals the gap.
