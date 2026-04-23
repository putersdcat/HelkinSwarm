import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #710 Gap 2 + Gap 4 — graceful degradation + honest status.
// These constants are the rescue plan's central invariants; if anyone reverts
// the best-effort fan-in branch or weakens the all-fatal guard, this lock
// fails immediately and points the regression authour back at issue #710.

const orchSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmOrchestrator.ts'),
  'utf-8',
);

const persistSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'persistSwarmResultActivity.ts'),
  'utf-8',
);

describe('Swarm graceful degradation lock (#710 Gap 2)', () => {
  it('orchestrator carries the [#710 Gap 2] best-effort fan-in rationale', () => {
    expect(orchSrc).toMatch(/\[#710 Gap 2\][\s\S]{0,400}?BEST-EFFORT FAN-IN/);
  });

  it('a fatal worker pushes its result onto workerResults BEFORE any abort decision', () => {
    // The dangerous regression would be reordering this line under the
    // `if (result.fatal)` block — if push happens only on success the
    // Failure Summary card has nothing to render and the leader gets a
    // misleading transcript.
    expect(orchSrc).toMatch(/workerResults\.push\(result\);[\s\S]{0,200}?if \(result\.fatal\)/);
  });

  it('fatal worker emits a System notice into the chatroom for the leader to see', () => {
    expect(orchSrc).toMatch(/agent-fatal:\$\{result\.agentName\}/);
    expect(orchSrc).toMatch(/could not contribute to this swarm/);
    expect(orchSrc).toMatch(/Synthesize with the remaining agents/);
  });

  it('all-workers-failed guard runs AFTER the fan-in loop, not inside it', () => {
    // Pin the structural shape: the guard reads the post-loop workerResults
    // and only declares the swarm dead when no worker succeeded.
    expect(orchSrc).toMatch(/const anyWorkerOk\s*=\s*workerResults\.some\(r => r\.success\)/);
    expect(orchSrc).toMatch(/if \(!anyWorkerOk\)/);
  });

  it('all-fatal early-return surfaces failedAgents + per-agent error strings', () => {
    expect(orchSrc).toMatch(/failedAgents:\s*failedAgentNames/);
    expect(orchSrc).toMatch(/swarm-all-fatal/);
    expect(orchSrc).toMatch(/All Specialists Could Not Be Summoned/);
  });

  it('happy-path return shape carries failedAgents derived from worker results', () => {
    expect(orchSrc).toMatch(
      /failedAgents:\s*workerResults\.filter\(r => !r\.success\)\.map\(r => r\.agentName\)/,
    );
  });
});

describe('Swarm honest status criterion lock (#710 Gap 4)', () => {
  it('persistence carries the [#710 Gap 4] three-outcome rationale', () => {
    expect(persistSrc).toMatch(/\[#710 Gap 4\][\s\S]{0,300}?Honest status criterion/);
  });

  it('status union includes partial alongside ok / fail / running', () => {
    expect(persistSrc).toMatch(/status:\s*'running'\s*\|\s*'ok'\s*\|\s*'partial'\s*\|\s*'fail'/);
  });

  it('failedCount prefers result.failedAgents, falls back to deriving from agentResults', () => {
    expect(persistSrc).toMatch(
      /failedCount\s*=\s*\(result\.failedAgents\s*\?\?\s*result\.agentResults\.filter\(r => !r\.success\)\.map\(r => r\.agentName\)\)\.length/,
    );
  });

  it('computedStatus = partial only when leader succeeded AND at least one worker failed', () => {
    // Pin the exact branch order — flipping these two `if` branches would
    // mark all-failed runs as 'partial' instead of 'fail'.
    expect(persistSrc).toMatch(
      /if \(!result\.success\)\s*\{[\s\S]{0,80}?computedStatus\s*=\s*'fail';[\s\S]{0,200}?else if \(failedCount > 0\)\s*\{[\s\S]{0,80}?computedStatus\s*=\s*'partial';[\s\S]{0,200}?else\s*\{[\s\S]{0,80}?computedStatus\s*=\s*'ok';/,
    );
  });

  it('caller-supplied statusOverride still wins (e.g. running on first persist)', () => {
    expect(persistSrc).toMatch(/const status = input\.statusOverride \?\? computedStatus;/);
  });

  it('failedAgents is only persisted when at least one agent actually failed', () => {
    // The undefined-when-empty pattern keeps the Cosmos doc clean for
    // healthy swarms and lets the tab renderer key off presence.
    expect(persistSrc).toMatch(
      /failedAgents:\s*result\.failedAgents && result\.failedAgents\.length > 0 \? result\.failedAgents\s*:\s*undefined/,
    );
  });
});
