Reduce the open backlog for `putersdcat/HelkinSwarm` through **real shipped delivery**.

Use this prompt as an actual loop starter. Keep it short, repeatable, and outcome-driven.

## Anchor

Use **`#609`** as the program board.

Default bias:

- ship substantive MVP capability work
- use runtime work only to keep delivery honest and shippable

## Start-of-run checklist

1. Read `#609` and its latest comments.
2. Pull the open issue list.
3. Compute:
   - current open count
   - opened in last 24h
   - closed in last 24h
4. Identify any already-spiraling parent/child chains.
5. Query `graphify` once for macro orientation.

## How to use graphify

Use graphify as a macro lens, not as the selector.

Use it to:

- understand the current codebase shape quickly
- spot runtime-spine thinness vs handler/doc bloat
- sanity-check where a candidate issue sits in the real architecture

Do not let graphify replace issue reading, code reading, or live validation.

## Issue lanes

### Lane A — shipability floor

Use only when runtime problems are truly blocking feature delivery or user trust.

Current examples:

- `#596`
- `#602`
- `#605`
- `#607`
- `#608` (freshest narrow child currently `#622`)
- `#616` / `#618`

### Lane B — default lane

Prefer substantive MVP capability work in this order unless live evidence says otherwise:

- `#238`
- `#244`
- `#178`
- `#177`
- `#243`
- `#239`
- `#240`

### Lane C — accelerators

- `#194`
- `#75`
- `#71`
- `#611`
- `#507`

### Lane D — company operations

- `#242`
- `#246`
- `#245`
- `#249`

### Lane E — downstream virtual employee work

- `#237`
- `#101`
- `#102`
- `#103`
- `#488` to `#492`
- `#495` to `#497`

## Selection rules

- Default to **Lane B**.
- Only pick **Lane A** when runtime issues truly block honest shipping.
- If you work Lane A once, the next pass should try to return to Lane B/C/D unless production is still broken.

## Stop-loss rules

- One seam, one active issue.
- Default zero new issues.
- Max one new issue per run.
- Max two shipped slices on the same issue per run.
- If the run would end net-positive in open issues, stop and re-anchor.
- Do not let a runtime micro-seam become the whole project.

## Delivery loop

1. Choose the target issue from the right lane.
2. Read the full issue and comments.
3. Read the full code path before editing.
4. Implement the smallest honest slice.
5. Validate locally.
6. Commit and push.
7. Wait for deploy.
8. Validate live with the Teams harness.
9. Update the issue with a proof bundle.
10. Update `#609` if the slice materially advances the MVP program.
11. Close only with honest C4 evidence.
12. If stop-loss triggers, quarantine the seam and go back to issue selection.

## Graph refresh discipline

After committing code changes, update the knowledge graph so it reflects the current codebase.
The graphify MCP server in `.vscode/mcp.json` serves `graphify-out/graph.json` — keeping it fresh means all agents querying the graph get current data.

**When to run:** After any commit that adds, removes, or modifies files in `src/`, `skills/`, `tests/`, `docs/`, or `tabs/`.
**When to skip:** Config-only changes (`.gitignore`, `package.json`, agent defs) — these do not materially affect the graph.

#### Quick path — invoke the graphify skill

Just invoke:

`/graphify . --update`

## End condition

Keep looping until you either:

- close the issue honestly,
- hit a stop-loss rule and re-anchor,
- or finish the current slice and continue with the next highest-value issue from the correct lane.

When one issue is done, **loop again from the start-of-run checklist** and keep reducing the backlog.
