# HelkinSwarm Project Specification – Addendum Series
## 0zj. Code Execution Skill & Math Layer

**Version:** 2.0 (Gold-standard aligned)
**Status:** Required Skill – MVP Blocking for Lucas & Synthesis Agents
**Owner:** Principal Developer
**Last Updated:** 2026-04-16

---

### 0. Native canonical vs HelkinSwarm adaptation

> Canonical source: `docs/master-azure-grok-swarm-replication-package/`
> (main package \u00a76, Doc 04 placeholder + full list echoed in the master
> package, and `swarm_internal_tool_usage_patterns.md` \u00a71\u20132).

| Aspect | Canonical native | HelkinSwarm adaptation |
|---|---|---|
| Runtime | **Python 3.12.3 stateful REPL** per conversation thread. | Same. Path A (JS math.js) is **demoted** to a quick-win interim only. Gold-standard compliance requires Path B. |
| Pre-installed libraries | Exact list (verbatim from the master package): `tqdm, requests, ecdsa, numpy, scipy, pandas, seaborn, plotly, sympy, mpmath, statsmodels, PuLP, astropy, qutip, control, biopython, pubchempy, dendropy, rdkit, pyscf, polygon, pygame, chess, mido, midiutil, networkx, torch, snappy`. | Preserved verbatim for replication fidelity. HelkinSwarm may add extras but must not remove from the canonical set. |
| `pip install` | Not allowed. | Not allowed. |
| Filesystem / network | Sandboxed; no network except pre-approved internal endpoints. | Preserved. Container App sandbox with egress allow-list only. |
| State | **Stateful REPL** \u2014 variables persist across calls for the lifetime of the conversation thread. | Preserved. State is keyed by swarm-turn correlation ID and torn down at swarm completion. |
| Tool availability | All four agents have it. Lucas is the primary user; other agents may self-elect for math/verification. | Preserved. Per-agent tool whitelisting in 0zf \u00a75 still applies \u2014 but when granted, this skill is literally the same tool. |
| Orchestrator / Leader direct invocation | Native spec says route calculation through a specialist (the native swarm treats the leader as synthesis-only). | Preserved: Helkin (leader) never calls `code_execution` directly; it delegates to Lucas (or another specialist granted the skill). |
| Self-elected frequency | ~60\u201370% of tool calls across a swarm are `code_execution` (math verification, symbolic, pandas, networkx, plotting). JSON formatting is almost never (0\u20131%). | Preserved expectation; observability hooks in 0zn/0n should surface deviation from this baseline. |

---

### 1. Purpose & Vision

The `code_execution` skill is the dedicated math, calculation, data-processing, and visualization capability for the swarm (especially Lucas, the Synthesis & Ranking Specialist). It provides a **full Python 3.12.3 stateful REPL** sandbox that any swarm agent granted the skill can call.

This skill completes the Synthesis & Ranking Specialist's toolkit and enables:

- Symbolic math (sympy, mpmath)
- Numerical / Monte-Carlo simulation (numpy, scipy, statsmodels)
- Dataframe analysis (pandas)
- Graph / network analysis (networkx)
- Plot generation (matplotlib, seaborn, plotly \u2192 served back via `render_file` on Helkin\u2019s final output)
- Optimization (PuLP, control)
- Domain-heavy payloads when warranted (rdkit, biopython, qutip, astropy, torch, pyscf)

It is **not** a stripped-down calculator \u2014 it is a production-grade Python interpreter with the canonical scientific stack.

---

### 2. Architecture & Implementation

**Runtime**: Python 3.12.3 sandbox running as a dedicated Container App / Function, invoked by an Azure Durable Activity in the swarm sub-orchestrator.

**Two-path delivery**:

- **Path A (interim only)** \u2014 TypeScript `math.js` layer for deterministic numerical work while Path B is being stood up. Not canonical-compliant; do not ship as the final answer.
- **Path B (canonical, required for swarm replication fidelity)** \u2014 dedicated Python 3.12.3 REPL container with the full library set. This is what the master package describes and what Lucas\u2019s persona expects.

**Security model**:

- Sandbox runs with least privilege (User-Assigned Managed Identity, no data-plane tokens).
- Input/output strictly Zod-validated at the activity boundary.
- No filesystem writes outside the ephemeral working directory; no network except a pre-approved allow-list.
- Hard limits: wall-clock timeout, memory cap, CPU quota per call; stateful variables capped in size.
- No `pip install`, no subprocess, no `os.system`, no raw socket.
- REPL state is **scoped to a single swarm turn** and destroyed at turn completion.

---

### 3. Tool Definition (manifest + handler)

```json
{
  "name": "code_execution",
  "description": "Execute Python 3.12.3 code in a secure stateful REPL. Full scientific stack available (numpy, pandas, scipy, sympy, networkx, matplotlib, torch, etc.). No pip install, no network, no filesystem access. Variables persist within a swarm turn.",
  "risk": "low",
  "dataSensitivity": "non-pii",
  "inputSchema": {
    "code": { "type": "string", "description": "Python code to execute" }
  },
  "outputSchema": {
    "stdout": "string",
    "result": "any",
    "plots":  "array<string>"
  }
}
```

---

### 4. Canonical invocation patterns

From `swarm_internal_tool_usage_patterns.md` \u00a72, the high-frequency
self-elected patterns (which should drive test coverage) are:

```python
# 1. Symbolic math / verification
import sympy as sp

# 2. Numerical simulation / Monte-Carlo
import numpy as np

# 3. Dataframe analysis / pandas
import pandas as pd

# 4. Graph / network analysis
import networkx as nx

# 5. Plot generation (then render_file is used on Helkin's final output)
import matplotlib.pyplot as plt

# 6. JSON formatting / validation (rare; usually skipped \u2014 the model emits JSON directly)
import json
```

Test harnesses must verify Lucas (and any other agent granted the skill)
self-elects `code_execution` within the first 2\u20133 reasoning steps on
computational queries.

---

### 5. Integration with Swarm

- Lucas is the primary user; persona language instructs him to reach for it for ranking, tables, calculations, and visualization.
- Any agent granted the skill via the decomposer\u2019s `assignedTools` list may call it.
- **Helkin (leader) never calls it directly** \u2014 synthesis-only mandate is preserved.
- Plot outputs are handed to Helkin and surfaced via `render_file` on Helkin\u2019s final response (Render Components are leader-only per 0zh \u00a70).

---

### 6. What NOT to Do

- \u274c Do **NOT** allow pip install or code that touches the network/filesystem.
- \u274c Do **NOT** let the orchestrator or Helkin call it directly.
- \u274c Do **NOT** ship Path A alone as canonical compliance \u2014 Path B is the native spec.
- \u274c Do **NOT** store raw code or output in long-term memory unless Helkin explicitly commits it.
- \u274c Do **NOT** expose the Python REPL to the user directly \u2014 only through the tool interface.
- \u274c Do **NOT** remove libraries from the canonical set without explicit sign-off.

---

### 7. Acceptance Criteria

- Path B Python 3.12.3 sandbox is running with the full canonical library set.
- Lucas produces ranked tables and statistical summaries using the skill.
- Code execution is stateful within a swarm turn and torn down at turn completion.
- Sandbox prevents any escape or unauthorized access.
- Tool integrated into swarm tool surface with per-agent whitelisting (0zf).
- Cost and latency acceptable for synthesis tasks.
- Test harness covers the six canonical invocation patterns (\u00a74).

**Backlog linkage**: Completes Lucas\u2019s persona (0zh). Required for full swarm effectiveness (0ze). Canonical parity with the master replication package (\u00a76).

*We are the bridge.*