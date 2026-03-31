import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROMPT_PATH = '/opt/skillforge/skillforge-prompt.md';
const DEFAULT_AUDIT_LOG_PATH = '/tmp/skillforge-audit.jsonl';
const DEFAULT_PROMPT_SHIELD_POLICY = 'continuous';

const FORBIDDEN_ENV_NAME_PATTERNS = [
  /^BOT_OAUTH_CONNECTION_NAME$/,
  /^ENTRA_.*(TOKEN|SECRET)$/,
  /^GRAPH_.*TOKEN$/,
  /^MICROSOFT_GRAPH_.*$/,
  /^IDENTITY_ENDPOINT$/,
  /^IDENTITY_HEADER$/,
  /^IMDS_ENDPOINT$/,
  /^MSI_ENDPOINT$/,
  /^MSI_SECRET$/,
  /^AZURE_CLIENT_SECRET$/,
  /^ARM_CLIENT_SECRET$/,
];

function safeNowIso() {
  return new Date().toISOString();
}

export function createSkillForgeAuditRecord(event, details = {}) {
  return {
    component: 'skillforge-bootstrap',
    event,
    timestamp: safeNowIso(),
    details,
  };
}

export function emitSkillForgeAuditEvent(event, details = {}, options = {}) {
  const record = createSkillForgeAuditRecord(event, details);
  const line = JSON.stringify(record);
  const auditLogPath = options.auditLogPath
    ?? process.env['SKILLFORGE_AUDIT_LOG_PATH']
    ?? DEFAULT_AUDIT_LOG_PATH;
  const log = options.log ?? console.log;
  const append = options.appendFileSync ?? appendFileSync;

  log(`[skillforge-audit] ${line}`);

  if (auditLogPath) {
    append(auditLogPath, `${line}\n`, 'utf8');
  }

  return record;
}

export function getForbiddenSkillForgeEnvNames(env = process.env) {
  return Object.keys(env)
    .filter((name) => FORBIDDEN_ENV_NAME_PATTERNS.some((pattern) => pattern.test(name)))
    .sort();
}

export function assertSkillForgeEnvironmentSafe(env = process.env) {
  const forbiddenNames = getForbiddenSkillForgeEnvNames(env);
  if (forbiddenNames.length > 0) {
    throw new Error(
      'SkillForge bootstrap blocked forbidden Entra/Graph/control-plane env injection: '
      + forbiddenNames.join(', '),
    );
  }

  return {
    forbiddenNames,
    promptShieldPolicy: env['SKILLFORGE_PROMPT_SHIELD_POLICY'] ?? DEFAULT_PROMPT_SHIELD_POLICY,
  };
}

export function getSkillForgeIsolationSnapshot(options = {}) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const dockerSocketPath = options.dockerSocketPath ?? '/var/run/docker.sock';
  const socketExists = (options.existsSync ?? existsSync)(dockerSocketPath);

  return {
    runningAsNonRoot: uid === null ? true : uid !== 0,
    userId: uid,
    dockerSocketPresent: socketExists,
    dockerSocketPath,
  };
}

export function assertSkillForgeIsolation(snapshot = getSkillForgeIsolationSnapshot()) {
  if (!snapshot.runningAsNonRoot) {
    throw new Error('SkillForge bootstrap blocked root execution.');
  }
  if (snapshot.dockerSocketPresent) {
    throw new Error(`SkillForge bootstrap detected forbidden Docker socket mount at ${snapshot.dockerSocketPath}.`);
  }
  return snapshot;
}

export function loadSkillForgePrompt(promptPath = DEFAULT_PROMPT_PATH) {
  const prompt = readFileSync(promptPath, 'utf8').trim();
  if (!prompt) {
    throw new Error(`SkillForge system prompt is empty at ${promptPath}`);
  }
  return prompt;
}

export function startSkillForgeBootstrap() {
  const promptPath = process.env['SKILLFORGE_SYSTEM_PROMPT_PATH'] ?? DEFAULT_PROMPT_PATH;
  const promptShieldPolicy = process.env['SKILLFORGE_PROMPT_SHIELD_POLICY'] ?? DEFAULT_PROMPT_SHIELD_POLICY;
  const auditLogPath = process.env['SKILLFORGE_AUDIT_LOG_PATH'] ?? DEFAULT_AUDIT_LOG_PATH;

  emitSkillForgeAuditEvent('bootstrap-start', {
    promptPath,
    promptShieldPolicy,
    auditLogPath,
  }, { auditLogPath });

  const envValidation = assertSkillForgeEnvironmentSafe(process.env);
  emitSkillForgeAuditEvent('environment-validated', {
    forbiddenEnvCount: envValidation.forbiddenNames.length,
    promptShieldPolicy: envValidation.promptShieldPolicy,
  }, { auditLogPath });

  const isolationSnapshot = assertSkillForgeIsolation();
  emitSkillForgeAuditEvent('isolation-validated', {
    runningAsNonRoot: isolationSnapshot.runningAsNonRoot,
    dockerSocketPresent: isolationSnapshot.dockerSocketPresent,
  }, { auditLogPath });

  const prompt = loadSkillForgePrompt(promptPath);
  emitSkillForgeAuditEvent('prompt-loaded', {
    promptPath,
    promptLength: prompt.length,
  }, { auditLogPath });

  console.log(
    `SkillForge container ready (system prompt loaded from ${promptPath}; ${prompt.length} chars; `
    + `prompt shields=${promptShieldPolicy}; audit log=${auditLogPath})`,
  );

  const keepAliveTimer = setInterval(() => {
    // Keep the bootstrap process alive until the orchestrator or job runner replaces it.
  }, 60_000);

  const shutdown = () => {
    clearInterval(keepAliveTimer);
    process.exit(0);
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  emitSkillForgeAuditEvent('bootstrap-ready', {
    promptPath,
    promptLength: prompt.length,
    promptShieldPolicy,
    auditLogPath,
  }, { auditLogPath });

  return {
    promptPath,
    promptLength: prompt.length,
    promptShieldPolicy,
    auditLogPath,
  };
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  startSkillForgeBootstrap();
}