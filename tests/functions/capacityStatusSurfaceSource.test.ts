import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('capacity status surfaces (#530)', () => {
  it('exposes conscious-lane impairment details in bot status and tab dashboard', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const dashboardSource = readFileSync('src/functions/tabDashboard.ts', 'utf8');

    expect(botSource).toContain('getConsciousLaneAssessment');
    expect(botSource).toContain('conscious-lane: ${consciousLane.deploymentName}');
    expect(botSource).toContain('consciousLane.capacityProfile.impairmentProtocol');

    expect(dashboardSource).toContain('getConsciousLaneAssessment(routing)');
    expect(dashboardSource).toContain('consciousCapacityLevel');
    expect(dashboardSource).toContain('consciousImpairmentProtocol');
    expect(dashboardSource).toContain('consciousLaneImpaired');
    expect(dashboardSource).toContain('consciousLaneSummary');
  });
});