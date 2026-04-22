import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * [#697] Reply ownership gate must remain wired in source.
 *
 * The architectural fix: when the calling orchestrator passes
 * `expectedInstanceId` and a `correlationId`, sendReply looks up the live
 * stage owner via `getOrchestratorStageForCorrelation` and aborts with a
 * `ReplyOwnershipMismatch` telemetry event if a fresh instance has taken
 * over the correlation. Bypassing this check (or removing the import) would
 * silently re-open the cross-reboot replay surface that #670/#697 closed.
 */
describe('reply ownership gate (#697) source guards', () => {
  const source = readFileSync('src/orchestrator/sendReplyActivity.ts', 'utf8');

  it('imports the per-correlation stage lookup helper', () => {
    expect(source).toContain('getOrchestratorStageForCorrelation');
  });

  it('declares expectedInstanceId on SendReplyInput with a #697 reference', () => {
    expect(source).toMatch(/expectedInstanceId\?:\s*string/);
    expect(source).toContain('#697');
  });

  it('checks the live stage owner before sending and aborts on mismatch', () => {
    expect(source).toContain('input.expectedInstanceId && input.correlationId');
    expect(source).toContain('liveStage.instanceId !== input.expectedInstanceId');
    expect(source).toContain("name: 'ReplyOwnershipMismatch'");
    expect(source).toContain("error: 'reply-ownership-mismatch'");
  });

  it('falls through to send if the lookup itself errors (best-effort gate)', () => {
    expect(source).toMatch(/proceeding with send/);
  });
});

describe('reply ownership gate (#697) wiring', () => {
  it('overseer threads its own context.df.instanceId into SessionInput.overseerInstanceId', () => {
    const overseer = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    expect(overseer).toContain('overseerInstanceId: context.df.instanceId');
  });

  it('sessionOrchestrator uses input.overseerInstanceId (not its own sub-orchestrator id) on every sendReplyActivity call site', () => {
    const session = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    // The sub-orchestrator's own context.df.instanceId would never match the
    // stage entry's recorded instanceId, so we MUST pass the overseer's id.
    expect(session).not.toMatch(/expectedInstanceId:\s*context\.df\.instanceId/);
    // At least one site must thread the overseer id through.
    expect(session).toContain('expectedInstanceId: input.overseerInstanceId');
  });

  it('overseer threads its own context.df.instanceId on its own sendReplyActivity error/timeout calls', () => {
    const overseer = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    // Overseer IS the recorded stage owner — its own context.df.instanceId
    // is exactly the value the gate compares against.
    expect(overseer).toContain('expectedInstanceId: context.df.instanceId');
  });

  it('declares ReplyOwnershipMismatch in the TelemetryEventName union', () => {
    const telemetry = readFileSync('src/observability/telemetry.ts', 'utf8');
    expect(telemetry).toContain("'ReplyOwnershipMismatch'");
  });
});
