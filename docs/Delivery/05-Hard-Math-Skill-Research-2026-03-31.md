# Hard Math Skill Research — 2026-03-31

Issue: `#412`

## Executive recommendation

For the first dedicated HelkinSwarm hard-math specialist, use **`Phi-4-mini-reasoning`** as the initial model choice.

This is the best first-pass fit because it is explicitly positioned by Microsoft as a **lightweight math reasoning model optimized for multi-step problem solving**, while also providing a much larger context window than `Phi-4-reasoning`.

However, it should **not** be treated as a free-floating replacement for HelkinSwarm's normal reasoning lane.

It should be shipped as a **narrow specialist skill / sub-agent path** with deterministic validation around it.

## Repo-grounded context

Current HelkinSwarm model routing is defined in `src/llm/modelRouter.ts`.

Today:
- global primary = `grok-4-1-fast-non-reasoning`
- global secondary = `gpt-5.4-mini`
- reasoning fallback/slot = `o4-mini`

The capabilities framework (`docs/05-Capabilities-Framework.md`) and tool-dispatch layer (`docs/06-Tool-Dispatch-LLM-Layer.md`) already support:
- dedicated skill domains
- narrowed tool exposure
- sub-agent isolation
- model-lane steering

That means a hard-math skill fits the current architecture better as a **specialized routed skill** than as a global router swap.

## Microsoft-grounded model comparison

### `Phi-4-mini-reasoning`

Microsoft Learn / Foundry catalog currently describes it as:
- a **chat-completion with reasoning content** model
- **128,000 input / 128,000 output** token window
- **tool calling: no**
- language focus: **English**
- Microsoft/Aspire description: **"Lightweight math reasoning model optimized for multi-step problem solving"**

Why it is the best first choice:
- the issue is specifically about a **cheap specialist "quant"-style math worker**
- the issue is explicitly about **English-language math reasoning**
- the larger context window is useful for long structured problems, worked solutions, and benchmark prompts
- the model is math-specialized enough to justify using it as a separate worker instead of overloading the main lane

### `Phi-4-reasoning`

Microsoft Learn / Foundry catalog currently describes it as:
- **32,768 input / 32,768 output**
- **tool calling: no**
- English reasoning model

Why it is not the first recommendation:
- it has a much smaller context window
- the issue emphasizes a low-cost but trustworthy specialist; `Phi-4-mini-reasoning` is the cleaner first-pass lightweight fit

### Non-Phi alternatives in the current repo/runtime

HelkinSwarm already has access to broader reasoning models such as `o4-mini` and other main-lane models.

Those are useful for general reasoning, but they do **not** eliminate the value of a dedicated math specialist because:
- the skill can carry stricter validation rules
- the skill can own explicit math-only routing boundaries
- the skill can be benchmarked separately from general-purpose chat quality

## Important architectural constraint

`Phi-4-mini-reasoning` does **not** support tool calling in the current Foundry catalog surface.

That means the right pattern is **not**:
- "show Phi a normal wide HelkinSwarm tool menu and let it agent around"

The right pattern is:
- orchestrator routes a clearly math-heavy request into a dedicated math skill/sub-agent
- that skill uses `Phi-4-mini-reasoning` for the reasoning step
- deterministic checking/verification runs outside the model
- the result returns as a validated skill response

## Scope boundary for the hard-math skill

### What this skill should own first

The first version should target problems where "real math" can be judged more objectively than generic reasoning:
- arithmetic and multi-step numeric reasoning
- algebraic solving / manipulation
- unit conversion and dimensional consistency checks
- probability / combinatorics / discrete math style questions
- structured word problems that reduce to explicit equations

### What it should not own initially

The first version should **not** claim broad ownership of:
- open-ended theorem proving
- finance/trading advice framed as "math"
- broad spreadsheet/report analysis
- generic strategy questions that merely contain numbers
- symbolic workflows that require a real CAS before validation exists

## Trust strategy

This skill should not be trusted just because the model is math-oriented.

Required trust posture:
- math skill returns both **answer** and **structured reasoning summary**
- deterministic checker validates the final numeric/symbolic claim where practical
- benchmarks/golden tests distinguish "sounds plausible" from "computes correctly"
- routing should fall back to the main reasoning lane when the request is not clearly math-heavy

## Recommended product shape

### Placement

Implement as a separate skill domain under `skills/`.

Suggested first domain:
- `skills/math/`

Suggested first tool:
- `math_solve`

### Invocation pattern

Best fit in current HelkinSwarm architecture:
- orchestrator detects a clearly math-heavy request
- route to isolated math sub-agent / dedicated skill handler
- use a model override for `Phi-4-mini-reasoning`
- post-process through deterministic validation before reply

This keeps the main chat/orchestrator lane clean and makes the specialist measurable.

## Implementation split

The research issue should split into these concrete follow-on implementation issues:

1. **Hard-math skill contract and routing**
   - define `skills/math/manifest.json`
   - add a clear math-only routing heuristic / invocation contract
   - make the skill callable without polluting the global default tool surface

2. **Hard-math validation harness and benchmark corpus**
   - create a benchmark set of exact-answer math prompts
   - define deterministic checking expectations
   - add regression tests that measure correctness instead of style

3. **First Phi-backed hard-math skill implementation**
   - add the first `math_solve` path using `Phi-4-mini-reasoning`
   - enforce narrow scope boundaries and graceful fallback
   - validate cost/latency against current reasoning-lane alternatives

## Final answer to the issue question

### Recommended model choice

Use **`Phi-4-mini-reasoning`** first.

### Why

- explicitly math-oriented in Microsoft's current documentation
- lightweight enough to justify specialist use
- large context window for worked solutions and benchmarks
- English-only focus matches the issue's current framing

### Delivery recommendation

Ship it as a **specialist math skill with deterministic verification**, not as a general replacement for HelkinSwarm's existing reasoning lane.

## Source grounding

Microsoft Learn / Foundry references reviewed for this recommendation:
- `https://learn.microsoft.com/azure/machine-learning/concept-models-featured?view=azureml-api-2#microsoft`
- `https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-from-partners#microsoft`
- `https://learn.microsoft.com/azure/foundry-classic/foundry-models/how-to/use-chat-reasoning`
