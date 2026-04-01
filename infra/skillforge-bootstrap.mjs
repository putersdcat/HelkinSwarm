import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROMPT_PATH = '/opt/skillforge/skillforge-prompt.md';
const DEFAULT_AUDIT_LOG_PATH = '/tmp/skillforge-audit.jsonl';
const DEFAULT_PROMPT_SHIELD_POLICY = 'continuous';
const DEFAULT_TIMEOUT_MINUTES = 15;
const DEFAULT_CPU_KILL_THRESHOLD = 80;
const DEFAULT_MEMORY_LIMIT_MB = 2048;
const DEFAULT_GUARDRAIL_SAMPLE_INTERVAL_MS = 15_000;
const DEFAULT_CPU_WINDOW_MINUTES = 5;
const TOOLING_PACKAGE_JSON_PATH = '/opt/skillforge/tooling/package.json';

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

function parsePositiveNumber(name, rawValue, fallback, minimum = 1) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${name} must be a number >= ${minimum}. Received: ${rawValue}`);
  }

  return parsed;
}

function resolveAppInsightsModule() {
  const requireFactories = [
    () => createRequire(import.meta.url),
    () => createRequire(TOOLING_PACKAGE_JSON_PATH),
  ];

  for (const create of requireFactories) {
    try {
      const candidateRequire = create();
      return candidateRequire('applicationinsights');
    } catch {
      // Try the next resolution path.
    }
  }

  return null;
}

export function createSkillForgeGuardrailConfig(env = process.env) {
  const timeoutMinutes = parsePositiveNumber(
    'SKILLFORGE_TIMEOUT_MINUTES',
    env['SKILLFORGE_TIMEOUT_MINUTES'],
    DEFAULT_TIMEOUT_MINUTES,
  );
  const cpuKillThreshold = parsePositiveNumber(
    'SKILLFORGE_CPU_KILL_THRESHOLD',
    env['SKILLFORGE_CPU_KILL_THRESHOLD'],
    DEFAULT_CPU_KILL_THRESHOLD,
  );
  const memoryLimitMb = parsePositiveNumber(
    'SKILLFORGE_MEMORY_LIMIT_MB',
    env['SKILLFORGE_MEMORY_LIMIT_MB'],
    DEFAULT_MEMORY_LIMIT_MB,
  );
  const sampleIntervalMs = parsePositiveNumber(
    'SKILLFORGE_GUARDRAIL_SAMPLE_INTERVAL_MS',
    env['SKILLFORGE_GUARDRAIL_SAMPLE_INTERVAL_MS'],
    DEFAULT_GUARDRAIL_SAMPLE_INTERVAL_MS,
  );
  const cpuWindowMinutes = parsePositiveNumber(
    'SKILLFORGE_CPU_WINDOW_MINUTES',
    env['SKILLFORGE_CPU_WINDOW_MINUTES'],
    DEFAULT_CPU_WINDOW_MINUTES,
  );

  return {
    timeoutMinutes,
    timeoutMs: timeoutMinutes * 60_000,
    cpuKillThreshold,
    memoryLimitMb,
    sampleIntervalMs,
    cpuWindowMinutes,
    cpuConsecutiveSamples: Math.max(1, Math.ceil((cpuWindowMinutes * 60_000) / sampleIntervalMs)),
  };
}

export function calculateCpuPercent(previousCpuUsage, currentCpuUsage, elapsedMs) {
  if (elapsedMs <= 0) return 0;

  const userDelta = currentCpuUsage.user - previousCpuUsage.user;
  const systemDelta = currentCpuUsage.system - previousCpuUsage.system;
  const totalCpuMicros = userDelta + systemDelta;

  return Number(((totalCpuMicros / (elapsedMs * 1000)) * 100).toFixed(2));
}

export function evaluateSkillForgeGuardrailSample({ config, state, sample }) {
  const nextConsecutiveCpuBreaches = sample.cpuPercent > config.cpuKillThreshold
    ? state.consecutiveCpuBreaches + 1
    : 0;

  const nextState = {
    ...state,
    consecutiveCpuBreaches: nextConsecutiveCpuBreaches,
  };

  if (sample.memoryRssMb > config.memoryLimitMb) {
    return {
      breach: {
        reason: 'memory',
        details: {
          memoryRssMb: sample.memoryRssMb,
          memoryLimitMb: config.memoryLimitMb,
        },
      },
      nextState,
    };
  }

  if (nextConsecutiveCpuBreaches >= config.cpuConsecutiveSamples) {
    return {
      breach: {
        reason: 'cpu',
        details: {
          cpuPercent: sample.cpuPercent,
          cpuKillThreshold: config.cpuKillThreshold,
          consecutiveCpuBreaches: nextConsecutiveCpuBreaches,
          requiredConsecutiveCpuBreaches: config.cpuConsecutiveSamples,
        },
      },
      nextState,
    };
  }

  return {
    breach: null,
    nextState,
  };
}

export function createSkillForgeAppInsightsClient(options = {}) {
  const connectionString = options.connectionString ?? process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];
  if (!connectionString) {
    return null;
  }

  try {
    const module = options.appInsightsModule ?? resolveAppInsightsModule();
    if (!module) {
      console.warn('[skillforge-bootstrap] Application Insights SDK not available for bootstrap telemetry.');
      return null;
    }

    const existingClient = options.client ?? module.defaultClient;
    if (!existingClient?.config?.connectionString) {
      module
        .setup(connectionString)
        .setAutoCollectConsole(false)
        .setAutoCollectDependencies(false)
        .setAutoCollectExceptions(false)
        .setAutoCollectPerformance(false)
        .setAutoCollectRequests(false)
        .setAutoDependencyCorrelation(false)
        .setUseDiskRetryCaching(false)
        .start();
    }

    const client = options.client ?? module.defaultClient;
    if (!client) {
      return null;
    }

    if (client.context?.keys?.cloudRole) {
      client.context.tags[client.context.keys.cloudRole] = 'skillforge-bootstrap';
    }

    return client;
  } catch (error) {
    console.warn('[skillforge-bootstrap] Failed to initialize Application Insights client:', error);
    return null;
  }
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

  const appInsightsClient = options.appInsightsClient ?? null;
  if (appInsightsClient?.trackEvent) {
    appInsightsClient.trackEvent({
      name: 'SkillForgeAudit',
      properties: {
        component: record.component,
        event: record.event,
        timestamp: record.timestamp,
        details: JSON.stringify(record.details),
      },
    });
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

export function startSkillForgeGuardrails(options = {}) {
  const config = options.config ?? createSkillForgeGuardrailConfig(options.env ?? process.env);
  const auditLogPath = options.auditLogPath
    ?? process.env['SKILLFORGE_AUDIT_LOG_PATH']
    ?? DEFAULT_AUDIT_LOG_PATH;
  const appInsightsClient = options.appInsightsClient ?? null;
  const now = options.now ?? (() => Date.now());
  const getCpuUsage = options.getCpuUsage ?? (() => process.cpuUsage());
  const getMemoryUsage = options.getMemoryUsage ?? (() => process.memoryUsage());
  const intervalFactory = options.setIntervalFn ?? setInterval;
  const timeoutFactory = options.setTimeoutFn ?? setTimeout;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const onFatal = options.onFatal ?? ((code = 1) => process.exit(code));

  let state = {
    consecutiveCpuBreaches: 0,
    lastSampleTimeMs: now(),
    lastCpuUsage: getCpuUsage(),
  };

  emitSkillForgeAuditEvent('guardrails-configured', {
    timeoutMinutes: config.timeoutMinutes,
    cpuKillThreshold: config.cpuKillThreshold,
    memoryLimitMb: config.memoryLimitMb,
    sampleIntervalMs: config.sampleIntervalMs,
    cpuWindowMinutes: config.cpuWindowMinutes,
    cpuConsecutiveSamples: config.cpuConsecutiveSamples,
  }, { auditLogPath, appInsightsClient });

  const stopWithEvent = (eventName, details, exitCode = 1) => {
    emitSkillForgeAuditEvent(eventName, details, { auditLogPath, appInsightsClient });
    if (typeof appInsightsClient?.flush === 'function') {
      try {
        appInsightsClient.flush({ isAppCrashing: exitCode !== 0 });
      } catch {
        // Non-fatal during shutdown.
      }
    }
    stop();
    onFatal(exitCode);
  };

  const intervalId = intervalFactory(() => {
    const currentTimeMs = now();
    const currentCpuUsage = getCpuUsage();
    const elapsedMs = currentTimeMs - state.lastSampleTimeMs;
    const cpuPercent = calculateCpuPercent(state.lastCpuUsage, currentCpuUsage, elapsedMs);
    const memoryRssMb = Number((getMemoryUsage().rss / (1024 * 1024)).toFixed(2));

    const evaluation = evaluateSkillForgeGuardrailSample({
      config,
      state,
      sample: {
        cpuPercent,
        memoryRssMb,
      },
    });

    state = {
      ...evaluation.nextState,
      lastSampleTimeMs: currentTimeMs,
      lastCpuUsage: currentCpuUsage,
    };

    if (evaluation.breach?.reason === 'memory') {
      stopWithEvent('guardrail-memory-breach', evaluation.breach.details, 1);
      return;
    }

    if (evaluation.breach?.reason === 'cpu') {
      stopWithEvent('guardrail-cpu-breach', evaluation.breach.details, 1);
    }
  }, config.sampleIntervalMs);

  const timeoutId = timeoutFactory(() => {
    stopWithEvent('guardrail-timeout-breach', {
      timeoutMinutes: config.timeoutMinutes,
      timeoutMs: config.timeoutMs,
    }, 1);
  }, config.timeoutMs);

  const stop = () => {
    clearIntervalFn(intervalId);
    clearTimeoutFn(timeoutId);
  };

  return {
    config,
    stop,
  };
}

export function startSkillForgeBootstrap() {
  const promptPath = process.env['SKILLFORGE_SYSTEM_PROMPT_PATH'] ?? DEFAULT_PROMPT_PATH;
  const promptShieldPolicy = process.env['SKILLFORGE_PROMPT_SHIELD_POLICY'] ?? DEFAULT_PROMPT_SHIELD_POLICY;
  const auditLogPath = process.env['SKILLFORGE_AUDIT_LOG_PATH'] ?? DEFAULT_AUDIT_LOG_PATH;
  const appInsightsClient = createSkillForgeAppInsightsClient();

  emitSkillForgeAuditEvent('bootstrap-start', {
    promptPath,
    promptShieldPolicy,
    auditLogPath,
    appInsightsEnabled: Boolean(appInsightsClient),
  }, { auditLogPath, appInsightsClient });

  const envValidation = assertSkillForgeEnvironmentSafe(process.env);
  emitSkillForgeAuditEvent('environment-validated', {
    forbiddenEnvCount: envValidation.forbiddenNames.length,
    promptShieldPolicy: envValidation.promptShieldPolicy,
  }, { auditLogPath, appInsightsClient });

  const isolationSnapshot = assertSkillForgeIsolation();
  emitSkillForgeAuditEvent('isolation-validated', {
    runningAsNonRoot: isolationSnapshot.runningAsNonRoot,
    dockerSocketPresent: isolationSnapshot.dockerSocketPresent,
  }, { auditLogPath, appInsightsClient });

  const prompt = loadSkillForgePrompt(promptPath);
  emitSkillForgeAuditEvent('prompt-loaded', {
    promptPath,
    promptLength: prompt.length,
  }, { auditLogPath, appInsightsClient });

  const guardrails = startSkillForgeGuardrails({
    auditLogPath,
    appInsightsClient,
  });

  console.log(
    `SkillForge container ready (system prompt loaded from ${promptPath}; ${prompt.length} chars; `
    + `prompt shields=${promptShieldPolicy}; audit log=${auditLogPath}; `
    + `timeout=${guardrails.config.timeoutMinutes}m; cpu>${guardrails.config.cpuKillThreshold}%; `
    + `memory=${guardrails.config.memoryLimitMb}MB)`,
  );

  const keepAliveTimer = setInterval(() => {
    // Keep the bootstrap process alive until the orchestrator or job runner replaces it.
  }, 60_000);

  const shutdown = (signal = 'shutdown') => {
    emitSkillForgeAuditEvent('bootstrap-shutdown', {
      signal,
    }, { auditLogPath, appInsightsClient });
    clearInterval(keepAliveTimer);
    guardrails.stop();
    if (typeof appInsightsClient?.flush === 'function') {
      try {
        appInsightsClient.flush({ isAppCrashing: false });
      } catch {
        // Ignore flush failures during shutdown.
      }
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  emitSkillForgeAuditEvent('bootstrap-ready', {
    promptPath,
    promptLength: prompt.length,
    promptShieldPolicy,
    auditLogPath,
    appInsightsEnabled: Boolean(appInsightsClient),
    timeoutMinutes: guardrails.config.timeoutMinutes,
    cpuKillThreshold: guardrails.config.cpuKillThreshold,
    memoryLimitMb: guardrails.config.memoryLimitMb,
  }, { auditLogPath, appInsightsClient });

  return {
    promptPath,
    promptLength: prompt.length,
    promptShieldPolicy,
    auditLogPath,
    guardrails: guardrails.config,
    appInsightsEnabled: Boolean(appInsightsClient),
  };
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  startSkillForgeBootstrap();
}