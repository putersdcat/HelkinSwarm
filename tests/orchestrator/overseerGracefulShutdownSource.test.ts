import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #687 action item 3 — graceful sibling termination.
// When the bot is forced to startNew a new overseer for a user whose existing
// overseer was alive but non-routable (mid-turn), the existing overseer would
// previously park in the 60s dedup-hold ingress window after its turn finished,
// keeping two Running orchestrations for the same user for up to a minute.
// The fix raises a `GracefulShutdown` external event on the sibling so its
// ingress wait loop exits cleanly instead of burning the dedup-hold. These
// textual assertions guard the wiring so a refactor cannot silently revert it.

const overseerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'overseer.ts'),
  'utf-8',
);

const botSrc = readFileSync(
  join(process.cwd(), 'src', 'bot', 'HelkinSwarmBot.ts'),
  'utf-8',
);

const telemetrySrc = readFileSync(
  join(process.cwd(), 'src', 'observability', 'telemetry.ts'),
  'utf-8',
);

describe('Overseer GracefulShutdown wiring (#687 action item 3)', () => {
  it('telemetry name union includes OverseerGracefulShutdown', () => {
    expect(telemetrySrc).toMatch(/'OverseerGracefulShutdown'/);
  });

  it('overseer registers a GracefulShutdown external event listener', () => {
    expect(overseerSrc).toMatch(
      /waitForExternalEvent\(\s*['"]GracefulShutdown['"]\s*\)/,
    );
  });

  it('overseer races GracefulShutdown alongside the other ingress wait events', () => {
    // The Task.any list must include gracefulShutdownEvent so dedup-hold can be
    // pre-empted; without it the listener would never resolve.
    expect(overseerSrc).toMatch(
      /Task\.any\(\[[\s\S]*?gracefulShutdownEvent[\s\S]*?\]\)/,
    );
  });

  it('overseer GracefulShutdown branch cancels both ingress timers before exit', () => {
    // The branch must cancel ingressTimer AND bufferedPollTimer or the durable
    // runtime will keep the orchestration Running until those timers fire.
    expect(overseerSrc).toMatch(
      /winner === gracefulShutdownEvent[\s\S]{0,1000}?ingressTimer\.cancel\(\)[\s\S]{0,200}?bufferedPollTimer\.cancel\(\)/,
    );
  });

  it('overseer GracefulShutdown branch clears the ingress window stage and emits telemetry', () => {
    // Stage clear is required so cosmos doesn't show a stale awaiting-ingress
    // marker; telemetry is required so the rate is observable in App Insights.
    expect(overseerSrc).toMatch(
      /winner === gracefulShutdownEvent[\s\S]{0,1500}?action:\s*['"]clear['"][\s\S]{0,1500}?name:\s*['"]OverseerGracefulShutdown['"]/,
    );
  });

  it('bot raises GracefulShutdown on the sibling instance after forced startNew', () => {
    // raiseEvent must target effectiveActiveInstanceId (the sibling) with the
    // 'GracefulShutdown' event name and reason 'sibling-startNew'.
    expect(botSrc).toMatch(
      /client\.raiseEvent\(\s*effectiveActiveInstanceId,\s*['"]GracefulShutdown['"]/,
    );
    expect(botSrc).toMatch(/reason:\s*['"]sibling-startNew['"]/);
  });

  it('bot wraps GracefulShutdown raise in try/catch so failures are non-fatal', () => {
    // The new overseer is already serving the user — a stale sibling that has
    // already terminated must not break message handling.
    expect(botSrc).toMatch(
      /raiseEvent\(\s*effectiveActiveInstanceId,\s*['"]GracefulShutdown['"][\s\S]{0,500}?catch\s*\(/,
    );
  });
});
