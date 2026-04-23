import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #673 — canonical chatroom_send wire contract
// activity-side wiring. The 19 unit tests in chatroomEnvelope.test.ts gate
// the helpers themselves (parse, validate, strip-self-echo, redirect). This
// file pins the call sites in swarmLeaderActivity.ts and swarmWorkerActivity.ts
// so a refactor cannot silently drop the canonical envelope path or stop
// emitting SwarmChatroomSend telemetry.

const leaderSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmLeaderActivity.ts'),
  'utf-8',
);

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

const telemetrySrc = readFileSync(
  join(process.cwd(), 'src', 'observability', 'telemetry.ts'),
  'utf-8',
);

describe('Canonical chatroom_send activity wiring (#673)', () => {
  it('telemetry name union includes SwarmChatroomSend', () => {
    expect(telemetrySrc).toMatch(/'SwarmChatroomSend'/);
  });

  it('leader activity imports both envelope helpers', () => {
    expect(leaderSrc).toMatch(
      /import\s*\{\s*parseChatroomSendMessage\s*,\s*stripSelfEchoRecipients\s*\}\s*from\s*['"]\.\/chatroomEnvelope\.js['"]/,
    );
  });

  it('worker activity imports both envelope helpers', () => {
    expect(workerSrc).toMatch(
      /import\s*\{\s*parseChatroomSendMessage\s*,\s*stripSelfEchoRecipients\s*\}\s*from\s*['"]\.\/chatroomEnvelope\.js['"]/,
    );
  });

  it('leader interception calls parseChatroomSendMessage(rawMessage, leaderName) before stripSelfEchoRecipients', () => {
    expect(leaderSrc).toMatch(
      /parseChatroomSendMessage\(\s*rawMessage\s*,\s*input\.leaderName\s*\)[\s\S]{0,400}?stripSelfEchoRecipients\(\s*input\.leaderName\s*,\s*rawTo\s*\)/,
    );
  });

  it('worker interception calls parseChatroomSendMessage(rawMessage, agentName) before stripSelfEchoRecipients', () => {
    expect(workerSrc).toMatch(
      /parseChatroomSendMessage\(\s*rawMessage\s*,\s*input\.agentName\s*\)[\s\S]{0,400}?stripSelfEchoRecipients\(\s*input\.agentName\s*,\s*rawTo\s*\)/,
    );
  });

  it('leader emits SwarmChatroomSend telemetry after envelope parse', () => {
    expect(leaderSrc).toMatch(
      /parseChatroomSendMessage\([\s\S]{0,1500}?name:\s*['"]SwarmChatroomSend['"]/,
    );
  });

  it('worker emits SwarmChatroomSend telemetry after envelope parse', () => {
    expect(workerSrc).toMatch(
      /parseChatroomSendMessage\([\s\S]{0,1500}?name:\s*['"]SwarmChatroomSend['"]/,
    );
  });
});
