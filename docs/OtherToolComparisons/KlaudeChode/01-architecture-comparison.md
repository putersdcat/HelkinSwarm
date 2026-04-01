# Architecture Comparison: Klaude Chode vs HelkinSwarm

> Side-by-side architectural analysis of Klaude Chode CLI and HelkinSwarm

---

## Overview

| Aspect | Klaude Chode | HelkinSwarm |
|--------|-------------|--------------|
| **Type** | Terminal CLI | Teams Bot (Azure) |
| **Runtime** | Bun | Node.js + Durable Functions |
| **LLM Location** | Local (API calls out) | Remote (Azure AI Foundry) |
| **Session Model** | Single session, file-persisted | Eternal orchestrator, Cosmos DB |
| **UI** | React + Ink (terminal) | Bot Framework + Teams |

---

## Core Architecture

### Klaude Chode — CLI Pipeline

```
User Input → CLI Parser → Query Engine → LLM API → Tool Execution Loop → Terminal UI
                                    ↑
                          (Tool calls + results feed back)
```

**Key Characteristics:**
- Single binary, runs locally
- QueryEngine manages conversation state in memory
- Tools executed synchronously in same process
- File-based persistence for sessions
- Feature flags via Bun DCE for dead code elimination

### HelkinSwarm — Eternal Orchestrator

```
Teams → Bot Framework → Overseer (Eternal) → Session Orchestrator → LLM → Tool Dispatch → Safety Pipeline
                                                                                    ↓
                                                                        Memory Manager (Cosmos DB)
```

**Key Characteristics:**
- Durable Functions maintain persistent orchestration
- `ContinueAsNew()` at 80% context threshold
- Activity functions for all side-effects
- Cosmos DB for session state + vector memory
- EU/Global toggle via Bicep

---

## Orchestration Patterns

### Klaude Chode — QueryEngine Loop

```typescript
// Simplified QueryEngine pattern
class QueryEngine {
  async *submitMessage(prompt) {
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await this.callLLM(prompt)
      
      if (response.toolCalls) {
        const results = await this.executeTools(response.toolCalls)
        prompt = [...prompt, response, ...results]  // Feed back
      } else {
        yield response  // Final response
        break
      }
    }
  }
}
```

**Characteristics:**
- Turn-based loop within single message
- Stateful within session
- Tools execute in sequence (can be parallelized)
- No built-in planning phase

### HelkinSwarm — Session Orchestrator + Overseer

```typescript
// Overseer — eternal orchestrator
df.app.orchestration('overseer', function* (context) {
  while (true) {
    const input = context.df.getInput()
    
    // ContinueAsNew at 80% context
    if (tokenBudget > 0.8 * maxTokens) {
      const summary = yield context.callActivity('summarizeActivity', ...)
      context.df.continueAsNew({ ...input, summary, recentHistory })
    }
    
    // Process message
    const result = yield context.callSubOrchestration('sessionOrchestrator', input)
    
    // Wait for next message
    context.df.waitForExternalEvent('NewMessage')
  }
})

// Session — one complete turn
df.app.orchestration('sessionOrchestrator', function* (context) {
  // 1. Build prompt with skill memory
  const prompt = yield context.callActivity('buildPromptActivity', input)
  
  // 2. Call LLM
  const llmResult = yield context.callActivity('llmActivity', prompt)
  
  // 3. Dispatch tools through safety pipeline
  if (llmResult.toolCalls) {
    const toolResult = yield context.callActivity('toolDispatchActivity', llmResult.toolCalls)
  }
  
  // 4. Send reply
  yield context.callActivity('sendReplyActivity', result)
})
```

**Characteristics:**
- Two-tier: Overseer (eternal) + Session (per-turn)
- Planning phase for complex requests
- Sub-agent isolation for high-risk tools
- Four-eyes verification pipeline

---

## Tool Systems

### Klaude Chode — Tool Pattern

```typescript
// buildTool factory pattern
const FileReadTool = buildTool({
  name: 'FileRead',
  description: 'Read file contents',
  inputSchema: z.object({ path: z.string() }),
  
  async execute(input, context) {
    return { data: await readFile(input.path) }
  },
  
  async checkPermissions(input, context) {
    return { allowed: true }  // Permission checks
  },
  
  isReadOnly: () => true,
})
```

**Tool Categories:**
- File: FileRead, FileWrite, FileEdit, Glob, Grep
- Shell: Bash, PowerShell, REPL
- Agent: Agent, TeamCreate, TeamDelete
- Task: TaskCreate, TaskList, TaskOutput
- Web: WebFetch, WebSearch
- MCP: MCPTool, ListMcpResources

**Permission Model:**
- Pattern-based rules (e.g., `Bash(git *)`)
- Modes: default, plan, bypassPermissions, auto
- ML classifier for auto mode

### HelkinSwarm — Capability Manifest Pattern

```json
{
  "domain": "outlook",
  "tools": [{
    "name": "outlook_list_emails",
    "risk": "low",
    "dataSensitivity": "pii",
    "requiresExecutor": false,
    "requiresSubAgent": false,
    "longTermMemorySchema": ["blockList"]
  }]
}
```

**Tool Categories (via skills/ manifests):**
- Core: built-in always-present
- Outlook: email, calendar
- Teams: messaging, presence
- GitHub: issues, PRs
- Azure: resources

**Safety Integration:**
- `requiresExecutor` — routes to pure code executor
- `requiresSubAgent` — isolated LLM session
- `requiresConfirmation` — forces Adaptive Card
- Risk levels: low/medium/high

---

## Memory Systems

### Klaude Chode — File-Based Memory

```
Memory Hierarchy:
├── CLAUDE.md (project root) — project facts
├── ~/.claude/CLAUDE.md — user preferences
├── Extracted memories — auto-stored from conversations
└── Team memory — shared team knowledge
```

**Implementation:**
- File-based (`CLAUDE.md` files)
- Scanned at startup and on demand
- Simple text matching for relevance
- Memory is static (not learned)

**Strengths:**
- Simple, auditable
- User has full control
- Git-tracked

**Weaknesses:**
- No semantic search
- No automatic learning
- Manual curation required

### HelkinSwarm — Cosmos DB + Vector Memory

```
Memory Hierarchy:
├── userProfiles (permanent) — preferences, onboarding
├── sessions (72h TTL) — active conversation state
├── multimodalMemory (365d TTL) — DiskANN vector index
└── skillMemory-{skillId} (365d TTL) — per-skill vaults
```

**Implementation:**
- Cosmos DB Serverless with DiskANN
- 3072-dimensional embeddings
- Skill-specific vaults with just-in-time injection
- Hydra-Net for multimodal (text + image + speech)

**Strengths:**
- Semantic search
- Automatic learning
- Skill-specific memory
- Multimodal support

**Weaknesses:**
- More complex
- Less transparent
- Requires infrastructure

---

## Safety & Permissions

### Klaude Chode — Pattern-Based Rules

```typescript
// Permission rules in settings
{
  "alwaysAllow": [
    "Bash(git *)",
    "FileRead(*)"
  ],
  "alwaysAsk": [
    "Bash(*)",
    "FileEdit(*)"
  ]
}
```

**Safety Layers:**
1. Pattern matching on tool name + input
2. Permission mode (default/plan/bypass/auto)
3. User prompts for ask rules
4. Auto mode: ML classifier

**Missing:**
- No automatic executor isolation
- No four-eyes verification
- No scoped tokens

### HelkinSwarm — Architecture-Enforced Safety

```typescript
// Safety modes (Bicep-configured)
param safetyMode = 'confirmation-gated'  // read-only | confirmation-gated | full-destructive

// Tool dispatch with safety gates
if (!toolRegistry.isAllowedBySafetyMode(toolName)) {
  return { error: 'Tool blocked by safety mode' }
}

// Executor for high-risk
if (tool.requiresExecutor) {
  // Pure code executor, no LLM
  return executor.execute(toolName, args)
}
```

**Safety Layers:**
1. Prompt-time filtering (`getSafetyFiltered()`)
2. Verification pipeline (0e)
3. Dispatch-time blocking (`isAllowedBySafetyMode()`)
4. Scoped token refusal
5. Executor isolation
6. Human confirmation via Adaptive Card

---

## Context & Prompts

### Klaude Chode

```typescript
// Context gathering
async function buildContext(cwd) {
  const [systemContext, userContext] = await Promise.all([
    getSystemContext({ cwd }),    // OS, git, env
    getUserContext({ cwd }),      // Settings, history
  ])
  
  const memory = await loadMemoryPrompt(cwd)
  const gitContext = await buildGitContext(cwd)
  
  return { systemContext, userContext, memory, gitContext }
}
```

### HelkinSwarm

```typescript
// Build prompt activity
async function buildPromptActivity(input) {
  // 1. Load skill-specific memory (just-in-time)
  const skillMemory = await mm.recall(query, { skillId, topK: 5 })
  
  // 2. Add Hydra-Net embeddings if multimodal
  const embeddings = await embeddingRouter.getEmbeddings(content)
  
  // 3. Apply model-specific tool presentation (0b)
  const toolSchemas = toolRegistry.getSafetyFiltered(modelProfile)
  
  // 4. Build prompt with all context
  return buildPrompt({ skillMemory, embeddings, toolSchemas, ... })
}
```

---

## Ideas for Klaude Chode from HelkinSwarm

### 1. Planning Phase for Complex Requests

**HelkinSwarm does:**
- Classifies request complexity (simple/compound/complex)
- For complex: generates structured execution plan first
- Dispatches only next dependency-ready step each round

**Could benefit Klaude Chode:**
- Add `/plan` mode that generates step-by-step plan
- For multi-step tasks, break into explicit steps
- Track progress through plan

### 2. Executor Agents for High-Risk Tools

**HelkinSwarm does:**
- `requiresExecutor: true` tools go to pure code executor
- LLM never executes destructive actions directly
- Executor has no reasoning capability

**Could benefit Klaude Chode:**
- `requiresExecutor` flag on dangerous Bash commands
- Separate execution path that doesn't involve LLM
- Especially for `rm`, `git push --force`, etc.

### 3. Skill-Specific Memory Vaults

**HelkinSwarm does:**
- Per-skill memory vaults (e.g., `skillMemory-outlook`)
- Just-in-time injection of relevant memories
- Vector search within skill context

**Could benefit Klaude Chode:**
- `CLAUDE.md` files per skill/domain
- Auto-learn preferences per project type
- Semantic memory search (currently only keyword)

### 4. Four-Eyes Verification Pipeline

**HelkinSwarm does:**
- Mandatory 5-step verification for every tool call
- Schema validation, data minimization, spot-check, Prompt Shields, confirmation
- Non-bypassable

**Could benefit Klaude Chode:**
- Verification step before destructive actions
- Data minimization (don't send full file paths to LLM)
- Structured confirmation for high-risk ops

### 5. Scoped Tokens for Permissions

**HelkinSwarm does:**
- `scopedTokenMinter` issues 5-minute tokens
- Exact minimum privileges per tool
- Read-only safety mode refuses all write tokens

**Could benefit Klaude Chode:**
- Time-limited tool permissions
- Scoped to specific paths/directories
- Auto-expire after timeout

### 6. EU/Global Model Toggle

**HelkinSwarm does:**
- `euResidencyMode` flag in Bicep
- Automatic model routing based on flag
- No code changes needed for EU mode

**Could benefit Klaude Chode:**
- Config option for model selection
- API key per region/endpoint
- Compliance-focused mode

---

## Ideas for HelkinSwarm from Klaude Chode

### 1. Rich CLI Experience

**Klaude Chode does:**
- Full terminal UI with React + Ink
- 140+ UI components
- Interactive diffs, file editing, progress bars

**Could benefit HelkinSwarm:**
- CLI companion tool for power users
- Local development workflow
- Debugging/inspection tools

### 2. Inline Tool Feedback

**Klaude Chode does:**
- Real-time tool execution display
- Streaming output
- Progress reporting during long operations

**Could benefit HelkinSwarm:**
- Typing indicators during tool execution
- Progressive disclosure of results
- Better UX for long-running operations

### 3. Conversation Compaction (HISTORY_SNIP)

**Klaude Chode does:**
- Automatic conversation compression
- Maintains context while reducing tokens
- Summary generation for compressed sections

**Could benefit HelkinSwarm:**
- Reduce Cosmos DB storage
- Faster prompt building
- Lower LLM costs

### 4. Sub-Agent Simplicity

**Klaude Chode does:**
- `AgentTool` spawns sub-agents simply
- Minimal context for sub-agents
- Clear tool allowlists per agent

**Could benefit HelkinSwarm:**
- Simpler sub-agent lifecycle
- Less overhead per sub-agent
- Easier debugging

---

## Summary Comparison Table

| Feature | Klaude Chode | HelkinSwarm |
|---------|-------------|-------------|
| **Deployment** | Local binary | Azure cloud |
| **Session Model** | File-based | Eternal orchestrator |
| **Context Management** | In-memory + files | Cosmos DB + vectors |
| **Tool Safety** | Pattern rules | 5-layer pipeline |
| **Memory** | Manual CLAUDE.md | Automatic vector search |
| **Planning** | None | Plan-first for complex |
| **High-Risk Tools** | User prompts | Executor isolation |
| **UI** | Terminal | Teams + Adaptive Cards |
| **Multi-Agent** | Coordinator mode | Sub-agents + Virtual Employees |
| **Self-Improvement** | None | SkillForge (build skills) |

---

## Conclusion

Both systems represent mature, well-architected solutions to AI-assisted coding/automation, but with fundamentally different trade-offs:

- **Klaude Chode** prioritizes simplicity, transparency, and local control
- **HelkinSwarm** prioritizes safety, scalability, and enterprise compliance

The most promising ideas to bring from HelkinSwarm to Klaude Chode:
1. Executor isolation for high-risk tools
2. Planning phase for complex tasks
3. Skill-specific memory vaults
4. Four-eyes verification for destructive actions

The most promising ideas to bring from Klaude Chode to HelkinSwarm:
1. Rich CLI companion tool
2. Streaming inline feedback
3. Conversation compaction
4. Simpler sub-agent model
