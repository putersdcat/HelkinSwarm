import fs from 'node:fs';
import process from 'node:process';

const BOT_VALIDATION_CODES = new Set([
  'DeploymentFailed',
  'BadRequest',
  'InvalidTemplateDeployment',
  '715-123420',
]);

export function analyzeDeployStampBicepResult(params) {
  const output = params.output;
  const oauthUpdate = params.oauthUpdate;

  const codeMatches = Array.from(output.matchAll(/"code"\s*:\s*"([^"]+)"/gu), (match) => match[1]);
  const roleAssignmentExistsCount = codeMatches.filter((code) => code === 'RoleAssignmentExists').length;
  const botValidationDetected = output.includes('do not have permission');
  const deploymentFailedCount = codeMatches.filter((code) => code === 'DeploymentFailed').length;

  let benignCodes = roleAssignmentExistsCount;
  if (roleAssignmentExistsCount > 0) {
    benignCodes += deploymentFailedCount;
  }
  if (!oauthUpdate && botValidationDetected) {
    benignCodes += codeMatches.filter((code) => BOT_VALIDATION_CODES.has(code)).length;
  }

  const totalCodes = codeMatches.length;
  const realErrors = Math.max(totalCodes - benignCodes, 0);

  return {
    botValidationDetected,
    roleAssignmentExistsCount,
    deploymentFailedCount,
    totalCodes,
    benignCodes,
    realErrors,
    shouldContinue: realErrors === 0,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputFile = args['input-file'];
  if (!inputFile) {
    throw new Error('Missing required argument --input-file');
  }

  const oauthUpdate = args['oauth-update'] === 'true';
  const output = fs.readFileSync(inputFile, 'utf8');
  const result = analyzeDeployStampBicepResult({ output, oauthUpdate });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/gu, '/')}`) {
  main();
}
