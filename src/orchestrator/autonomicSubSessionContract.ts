export const CONSCIOUS_THREAD_EXECUTION_KIND = 'conscious-thread';
export const INSTRUMENTAL_SUB_SESSION_EXECUTION_KIND = 'instrumental-sub-session';
export const INSTRUMENTAL_DIRECT_DISPATCH_EXECUTION_KIND = 'instrumental-direct-dispatch';

export const AUTONOMIC_SUBSESSION_INVARIANT = 'Instrumental sub-sessions are allowed autonomic functions under the Living Mind Contract, but they may never become independent conscious threads.';

export function buildInstrumentalSubSessionSystemPrompt(input: {
  toolName: string;
  toolDescription: string;
}): string {
  return `${AUTONOMIC_SUBSESSION_INVARIANT}
You are an instrumental sub-session delegated by the conscious thread.
You must stay narrow, use minimal scoped context, and always return control and results to the conscious thread.
Do NOT call any other tools. Do NOT attempt recursive tool calling.
Return only the tool result.

Tool: ${input.toolName}
Description: ${input.toolDescription}`;
}