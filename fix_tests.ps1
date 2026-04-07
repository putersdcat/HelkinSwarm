(Get-Content tests/orchestrator/llmFollowUpEvidence.test.ts) -replace 'gpt-5.4-mini', 'o4-mini' | Set-Content tests/orchestrator/llmFollowUpEvidence.test.ts
(Get-Content tests/orchestrator/postReplyStageLifecycleSource.test.ts) -replace 'gpt-5.4-mini', 'o4-mini' | Set-Content tests/orchestrator/postReplyStageLifecycleSource.test.ts
(Get-Content tests/orchestrator/sendConfirmationCardActivity.test.ts) -replace 'gpt-5.4-mini', 'o4-mini' | Set-Content tests/orchestrator/sendConfirmationCardActivity.test.ts
(Get-Content tests/orchestrator/turnTelemetry.test.ts) -replace 'gpt-5.4-mini', 'o4-mini' | Set-Content tests/orchestrator/turnTelemetry.test.ts
