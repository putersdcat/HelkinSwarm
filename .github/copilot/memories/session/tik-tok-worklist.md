# TIK-TOK Worklist — 2026-03-21

## STATUS: TOK Complete, Discovery Mode Active

## System Status
- **Runtime**: healthy, v0.1.0
- **Model**: grok-4-1-fast-reasoning (global lane, EU off)
- **Tools**: 12 (5 helkin + 7 github)
- **Safety**: confirmation-gated
- **Memory**: pending (not fully wired)

## KEY FINDING: Single-model testing only
The model router uses a single deployment per env config. There is no per-request model switching.
The deployed primary model is `grok-4-1-fast-reasoning` (default). Cannot test across multiple models
without redeploying with different `LLM_PRIMARY_MODEL` env var. This is an architecture gap to document.

## Bicep model mismatch discovered:
- Bicep: `llmPrimary = 'grok-4-1-fast-non-reasoning'` (line 94)
- Code: `GLOBAL_LANE.primary = 'grok-4-1-fast-reasoning'` (line 22)
- The deployed `LLM_PRIMARY_MODEL` env var may differ from hardcoded defaults.

## TIK Priority (Open Issues)
| # | Issue | Title | Status |
|---|-------|-------|--------|
| 1 | #53 | Safety Epic - spot-check verifiers are stubs | TODO |
| 2 | #122 | Audit - Bicep/infra/Router pass remaining | TODO |
| 3 | #47 | Sub-agent isolation | TODO - check if implemented |
| 4 | #58 | Executor agents | TODO |
| 5 | #86 | Dev Console tab | TODO |
| 6 | #121 | GitHub Issues Skill | BLOCKED on GITHUB_TOKEN |
| 7 | #28 | Scoped Token Minter | TODO |

## TOK Priority (Closed without devloop-validated)
| # | Issue | Title | Status |
|---|-------|-------|--------|
| 1 | #120 | User Onboarding | TODO |
| 2 | #89 | Persona templates | TODO |
| 3 | #51 | Tool dispatch | TODO |
| 4 | #45 | Model router | TODO |
| 5 | #42 | State manager | TODO |
| 6 | #40 | Session orchestrator | TODO |
| 7 | #39 | Eternal overseer | TODO |
| 8 | #57 | Prompt Shields | TODO |
| 9 | #54-56 | Safety pipeline steps | TODO |
| 10 | #84,#85 | Telemetry + correlation IDs | TODO |
| 11 | #49 | Capability loader | TODO |
| 12 | #46 | Foundry client | TODO |
| 13 | #43 | Prompt builder | TODO |
| 14 | #82 | Central config | TODO |
| 15 | #81 | Core/skills separation | TODO |
| 16 | #50 | Tool registry | TODO |
| 17 | #41 | Token budget | TODO |
| 18 | #25 | Maintenance mode | TODO |
| 19 | #24 | Slash commands | TODO |
| 20 | #23 | Adaptive cards | TODO |
| 21 | #22 | Proactive reply | TODO |
| 22 | Others (infra/arch) | Various | TODO |

## Completed Cycles
(none yet)
