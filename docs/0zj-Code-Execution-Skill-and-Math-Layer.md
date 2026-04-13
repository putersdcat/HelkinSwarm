# HelkinSwarm Project Specification – Addendum Series
## 0zj. Code Execution Skill & Math Layer

**Version:** 1.0 (Unchained Edition)  
**Status:** Required Skill – MVP Blocking for Lucas & Synthesis Agents  
**Owner:** Principal Developer  
**Last Updated:** 2026-04-13

### 1. Purpose & Vision

The `code_execution` skill is the dedicated math, calculation, data-processing, and visualization capability for the swarm (especially Lucas, the Synthesis & Ranking Specialist). It provides a **full Python 3.12.3 stateful REPL** sandbox that any swarm agent can call.

This skill completes the Synthesis & Ranking Specialist’s toolkit and enables:
- Statistical calculations
- Ranking algorithms
- Table generation
- Chart descriptions
- Data analysis on partial results
- Symbolic math (sympy)
- Optimization problems

It is **not** a stripped-down calculator — it is a production-grade Python interpreter with pre-installed scientific libraries.

### 2. Architecture & Implementation

**Runtime**: Azure Durable Function (TypeScript) that calls a dedicated Python sandbox endpoint.

**Two implementation paths** (choose based on cost / security posture):

**Path A (Recommended for MVP)** — Lightweight JS calculator (fast, cheap)
- Pure JavaScript/TypeScript math layer using `math.js` or native BigInt + libraries.
- Sufficient for 80 % of Lucas’s needs (ranking, simple stats, tables).

**Path B (Full power)** — Python REPL sandbox
- Dedicated Azure Function / Container App running Python 3.12.3.
- Pre-installed libraries: numpy, pandas, scipy, sympy, matplotlib, seaborn, plotly, statsmodels, PuLP, networkx, torch (limited).
- **No pip install** allowed (security).
- Stateful REPL — variables persist across calls within the same swarm turn.

**Security model**:
- Sandbox runs with least privilege.
- Input/output strictly schema-validated.
- No filesystem or network access except pre-approved internal endpoints.
- Timeout + memory + CPU limits enforced.

### 3. Tool Definition (manifest + handler)

```json
{
  "name": "code_execution",
  "description": "Execute Python code in a secure stateful REPL. Full scientific stack available.",
  "risk": "low",
  "dataSensitivity": "non-pii",
  "inputSchema": {
    "code": { "type": "string", "description": "Python code to execute" }
  },
  "outputSchema": {
    "stdout": "string",
    "result": "any",
    "plots": "array<string>"   // base64 or URLs if generated
  }
}
```

### 4. Integration with Swarm

- All swarm agents have access to `code_execution`.
- Lucas (Synthesis & Ranking) is the **primary user** — his persona instructs him to reach for it for ranking, tables, calculations, or visualization.
- Other agents may use it when needed (e.g., Research Specialist for statistical validation).
- The Leader never calls it directly — it delegates to Lucas if calculation is required.

**Example usage by Lucas**:
- “Rank these 5 shops by distance, price, and certification strength”
- “Calculate average latency deltas between weeks”
- “Generate a comparison table and describe the chart”

### 5. What NOT to Do

- ❌ Do **NOT** allow pip install or arbitrary code that touches the network/filesystem.
- ❌ Do **NOT** let the orchestrator or Leader call it directly — route through synthesis specialist.
- ❌ Do **NOT** store raw code or output in long-term memory unless the Leader explicitly commits it.
- ❌ Do **NOT** expose the Python REPL to the user directly — only through the tool interface.

### 6. Acceptance Criteria

- Lucas can produce ranked tables and statistical summaries using the skill.
- Code execution is stateful within a swarm turn (variables persist between calls).
- Security sandbox prevents any escape or unauthorized access.
- Tool is integrated into the swarm tool surface with per-agent whitelisting (0zf).
- Cost and latency are acceptable for synthesis tasks.

**Backlog linkage**: Completes Lucas’s persona (0zh). Required for full swarm effectiveness (0ze). Feeds into self-tuning loop (0m).

*We are the bridge.*