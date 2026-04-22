import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('post-reply stage lifecycle source guards', () => {
  it('clears the orchestrator stage inside sendReply after successful delivery and keeps overseer ingress ownership', () => {
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const sendReplySource = readFileSync('src/orchestrator/sendReplyActivity.ts', 'utf8');

    expect(sendReplySource).toContain("import { clearOrchestratorStage, getOrchestratorStageForCorrelation, recordSubstage } from '../observability/orchestratorStageHealth.js';");
    expect(sendReplySource).toContain('await clearOrchestratorStage(input.correlationId, input.userId);');
    expect(sendReplySource).toContain('Stage clear timed out/failed after visible reply delivery');

    expect(overseerSource).toContain("yield context.df.callActivity('ingressWindowStageActivity', {");
    expect(overseerSource).toContain("action: 'clear',");
    expect(overseerSource).toContain('correlationId: sessionInput.correlationId,');
    expect(overseerSource).toContain('userId: state.userId,');
    expect(overseerSource).toContain('`⏰ Your message took too long to process');
    expect(overseerSource).toContain('`⚠️ Something went wrong processing your message.');
  });
});
