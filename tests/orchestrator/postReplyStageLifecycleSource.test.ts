import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('post-reply stage lifecycle source guards', () => {
  it('keeps active-processing stage ownership in the overseer instead of clearing it inside sendReply', () => {
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');
    const sendReplySource = readFileSync('src/orchestrator/sendReplyActivity.ts', 'utf8');

    expect(sendReplySource).not.toContain('await clearOrchestratorStage(correlationId, input.userId);');
    expect(sendReplySource).not.toContain("import { clearOrchestratorStage, recordSubstage } from '../observability/orchestratorStageHealth.js';");
    expect(sendReplySource).toContain("import { recordSubstage } from '../observability/orchestratorStageHealth.js';");

    expect(overseerSource).toContain("yield context.df.callActivity('ingressWindowStageActivity', {");
    expect(overseerSource).toContain("action: 'clear',");
    expect(overseerSource).toContain('correlationId: sessionInput.correlationId,');
    expect(overseerSource).toContain('userId: state.userId,');
    expect(overseerSource).toContain('`⏰ Your message took too long to process');
    expect(overseerSource).toContain('`⚠️ Something went wrong processing your message.');
  });
});
