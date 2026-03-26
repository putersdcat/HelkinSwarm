import { describe, expect, it } from 'vitest';
import { analyzeDeployStampBicepResult } from '../../scripts/Evaluate-DeployStampBicepResult.mjs';

describe('deploy-stamp bicep result gate', () => {
  it('allows pure RoleAssignmentExists conflicts', () => {
    const output = '{"code":"RoleAssignmentExists","message":"already exists"}';

    expect(analyzeDeployStampBicepResult({ output, oauthUpdate: false })).toMatchObject({
      roleAssignmentExistsCount: 1,
      botValidationDetected: false,
      totalCodes: 1,
      benignCodes: 1,
      realErrors: 0,
      shouldContinue: true,
    });
  });

  it('allows DeploymentFailed when it only wraps RoleAssignmentExists', () => {
    const output = [
      '{"code":"DeploymentFailed"}',
      '{"code":"RoleAssignmentExists","message":"already exists"}',
    ].join('\n');

    expect(analyzeDeployStampBicepResult({ output, oauthUpdate: false })).toMatchObject({
      roleAssignmentExistsCount: 1,
      deploymentFailedCount: 1,
      totalCodes: 2,
      benignCodes: 2,
      realErrors: 0,
      shouldContinue: true,
    });
  });

  it('allows wrapped bot validation failures only when oauth update is off', () => {
    const output = [
      '{"code":"InvalidTemplateDeployment"}',
      '{"code":"715-123420"}',
      '{"code":"BadRequest"}',
      'The Azure Bot Service registration does not have permission to verify the endpoint and says you do not have permission.',
    ].join('\n');

    expect(analyzeDeployStampBicepResult({ output, oauthUpdate: false })).toMatchObject({
      botValidationDetected: true,
      totalCodes: 3,
      benignCodes: 3,
      realErrors: 0,
      shouldContinue: true,
    });
  });

  it('fails generic wrapper errors when bot validation signal is absent', () => {
    const output = '{"code":"InvalidTemplateDeployment"}\n{"code":"715-123420"}';

    expect(analyzeDeployStampBicepResult({ output, oauthUpdate: false })).toMatchObject({
      botValidationDetected: false,
      totalCodes: 2,
      benignCodes: 0,
      realErrors: 2,
      shouldContinue: false,
    });
  });

  it('fails bot validation wrappers when oauth update is explicitly enabled', () => {
    const output = [
      '{"code":"DeploymentFailed"}',
      '{"code":"BadRequest"}',
      'The Azure Bot Service registration does not have permission to verify the endpoint and says you do not have permission.',
    ].join('\n');

    expect(analyzeDeployStampBicepResult({ output, oauthUpdate: true })).toMatchObject({
      botValidationDetected: true,
      totalCodes: 2,
      benignCodes: 0,
      realErrors: 2,
      shouldContinue: false,
    });
  });

  it('fails mixed outputs when any unrelated error remains', () => {
    const output = [
      '{"code":"RoleAssignmentExists"}',
      '{"code":"BadRequest"}',
      '{"code":"AuthorizationFailed"}',
      'The Azure Bot Service registration does not have permission to verify the endpoint and says you do not have permission.',
    ].join('\n');

    expect(analyzeDeployStampBicepResult({ output, oauthUpdate: false })).toMatchObject({
      totalCodes: 3,
      benignCodes: 2,
      realErrors: 1,
      shouldContinue: false,
    });
  });
});