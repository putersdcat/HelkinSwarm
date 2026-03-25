/**
 * Copilot Resurrect – main extension entry point.
 *
 * Activate on onStartupFinished.
 * Registers all commands, wires up SessionWatcher + ResurrectionEngine,
 * and responds to configuration changes.
 */
import * as vscode from 'vscode';
import { Logger } from './logger';
import { getConfig, setEnabled, getAvailableModels, discoverAgentModes, EXT_ID, ApprovalsMode } from './config';
import { SessionWatcher } from './sessionWatcher';
import { ResurrectionEngine } from './resurrectionEngine';
import { ResurrectStatusBar } from './statusBar';
import { DetectedError } from './errorDetector';

let _watcher: SessionWatcher | undefined;
let _engine: ResurrectionEngine | undefined;
let _statusBar: ResurrectStatusBar | undefined;

const EXT_VERSION = '1.4.3';

// ── Activate ──────────────────────────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext): void {
  Logger.init();
  Logger.separator();
  Logger.info(`Copilot Resurrect v${EXT_VERSION} activating…`);

  _engine = new ResurrectionEngine(context);
  _statusBar = new ResurrectStatusBar();
  _watcher = new SessionWatcher(context, getConfig(), handleSilence, handleError);

  // Wire cooldown tick to status bar
  _engine.onCooldownTick = (remaining: number) => {
    _statusBar?.setCooldown(remaining);
  };

  // Push all disposables
  context.subscriptions.push(
    Logger.channel,
    _statusBar,
    _watcher
  );

  // ── Register commands ──────────────────────────────────────────────────────
  context.subscriptions.push(

    vscode.commands.registerCommand('copilot-resurrect.enable', async () => {
      await setEnabled(true);
      startWatcher();
      vscode.window.showInformationMessage('Copilot Resurrect: Watcher ENABLED.');
      Logger.info('Watcher enabled via command.');
    }),

    vscode.commands.registerCommand('copilot-resurrect.disable', async () => {
      await setEnabled(false);
      stopWatcher();
      vscode.window.showInformationMessage('Copilot Resurrect: Watcher DISABLED.');
      Logger.info('Watcher disabled via command.');
    }),

    vscode.commands.registerCommand('copilot-resurrect.toggle', async () => {
      const cfg = getConfig();
      if (cfg.enabled) {
        await vscode.commands.executeCommand('copilot-resurrect.disable');
      } else {
        await vscode.commands.executeCommand('copilot-resurrect.enable');
      }
    }),

    vscode.commands.registerCommand('copilot-resurrect.testResurrection', async () => {
      Logger.show();
      Logger.info('=== TEST RESURRECTION (dry run) ===');
      const cfg = getConfig();
      await _engine!.resurrect(cfg, /* dryRun */ true, 'manual');
    }),

    vscode.commands.registerCommand('copilot-resurrect.status', () => {
      const cfg = getConfig();
      const count = _engine?.todayCount ?? 0;
      const watching = _watcher?.active ?? false;
      const elapsed = _watcher?.secondsSinceActivity ?? 0;
      const cooling = _engine?.isCoolingDown ?? false;
      const nextCooldown = _engine?.calculateCooldown(cfg) ?? 0;

      const message = [
        `Copilot Resurrect Status:`,
        `  Enabled: ${cfg.enabled}`,
        `  Watcher active: ${watching}`,
        `  Content check: ${cfg.contentCheckEnabled ? 'ON' : 'OFF'}`,
        `  Silence timeout: ${cfg.silenceTimeoutSeconds}s`,
        `  Backoff cooldown (next): ${nextCooldown}s`,
        `  Backoff base: ${cfg.rateLimitCooldownBaseSeconds}s / max: ${cfg.rateLimitCooldownMaxSeconds}s`,
        `  Seconds since last activity: ${elapsed}s`,
        `  Restarts today: ${count} / ${cfg.maxRestartsPerDay}`,
        `  Model: ${cfg.preferredModel || '(default)'}`,
        `  Fallback model: ${cfg.fallbackModel || '(none)'}`,
        `  Participant: ${cfg.chatParticipant || '(none)'}`,
        `  Agent mode: ${cfg.agentMode || '(default)'}`,
        `  Approvals: ${cfg.approvalsMode}`,
        `  New session on resurrect: ${cfg.startNewSession}`,
        `  Prompt configured: ${!!cfg.ignitionPrompt}`,
        `  Cooling down: ${cooling}`,
      ].join('\n');

      Logger.show();
      Logger.info(message);
      vscode.window.showInformationMessage(
        `Resurrect: ${watching ? 'ACTIVE' : 'INACTIVE'} | ` +
        `Restarts today: ${count}/${cfg.maxRestartsPerDay} | ` +
        `Silence: ${elapsed}s/${cfg.silenceTimeoutSeconds}s` +
        (cooling ? ' | COOLING DOWN' : '')
      );
    }),

    vscode.commands.registerCommand('copilot-resurrect.resetDailyCounter', () => {
      _engine?.resetDailyCounter();
      updateStatusBar();
      vscode.window.showInformationMessage('Copilot Resurrect: Daily restart counter reset.');
    }),

    vscode.commands.registerCommand('copilot-resurrect.resetBackoff', () => {
      _engine?.resetBackoff();
      vscode.window.showInformationMessage('Copilot Resurrect: Exponential backoff counter reset.');
    }),

    vscode.commands.registerCommand('copilot-resurrect.showLog', () => {
      Logger.show();
    }),

    vscode.commands.registerCommand('copilot-resurrect.configurePrompt', async () => {
      const cfg = getConfig();
      const input = await vscode.window.showInputBox({
        prompt: 'Enter your Copilot Chat ignition prompt',
        placeHolder: 'e.g. Pull open backlog items, implement and commit them, then loop.',
        value: cfg.ignitionPrompt,
        ignoreFocusOut: true,
      });
      if (input !== undefined) {
        await vscode.workspace
          .getConfiguration(EXT_ID)
          .update('ignitionPrompt', input, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Copilot Resurrect: Ignition prompt saved.');
        Logger.info(`Ignition prompt updated (${input.length} chars).`);
      }
    }),

    // ── Model picker commands ─────────────────────────────────────────────
    vscode.commands.registerCommand('copilot-resurrect.selectModel', async () => {
      await pickModelAndSave('preferredModel', 'Select preferred model for Copilot Chat');
    }),

    vscode.commands.registerCommand('copilot-resurrect.selectFallbackModel', async () => {
      await pickModelAndSave('fallbackModel', 'Select fallback model (used after rate-limit)');
    }),

    // ── Participant picker ───────────────────────────────────────────────
    vscode.commands.registerCommand('copilot-resurrect.selectParticipant', async () => {
      const items: vscode.QuickPickItem[] = [
        { label: '(none)', description: 'No participant prefix — use default Copilot' },
        { label: '@copilot', description: 'Explicit Copilot participant' },
        { label: '@workspace', description: 'Workspace-aware participant' },
        { label: '@vscode', description: 'VS Code help participant' },
        { label: '@terminal', description: 'Terminal participant' },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select chat participant to prefix ignition prompt',
        title: 'Copilot Resurrect: Chat Participant',
      });
      if (picked) {
        const value = picked.label === '(none)' ? '' : picked.label.replace('@', '');
        await vscode.workspace
          .getConfiguration(EXT_ID)
          .update('chatParticipant', value, vscode.ConfigurationTarget.Global);
        Logger.info(`Chat participant set to: ${value || '(none)'}`);
        vscode.window.showInformationMessage(
          `Copilot Resurrect: Participant set to ${value || '(none)'}.`
        );
      }
    }),

    // ── Agent mode picker ─────────────────────────────────────────────
    vscode.commands.registerCommand('copilot-resurrect.selectAgentMode', async () => {
      const modes = await discoverAgentModes();
      const cfg = getConfig();
      const items: vscode.QuickPickItem[] = modes.map(m => ({
        label: m.name,
        description: m.source === 'builtin' ? '(built-in)' : '(workspace)',
        detail: m.description,
        picked: m.name === cfg.agentMode,
      }));
      // Add "none" option at top
      items.unshift({
        label: '(none)',
        description: 'No agent mode — use whatever mode the chat opens in',
      });
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select agent mode for resurrected sessions',
        title: 'Copilot Resurrect: Agent Mode',
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (picked) {
        const value = picked.label === '(none)' ? '' : picked.label;
        await vscode.workspace
          .getConfiguration(EXT_ID)
          .update('agentMode', value, vscode.ConfigurationTarget.Global);
        Logger.info(`Agent mode set to: ${value || '(none)'}`);
        vscode.window.showInformationMessage(
          `Copilot Resurrect: Agent mode set to "${value || '(none)'}".`
        );
      }
    }),

    // ── Approvals mode picker ────────────────────────────────────────────
    vscode.commands.registerCommand('copilot-resurrect.selectApprovalsMode', async () => {
      const items: vscode.QuickPickItem[] = [
        {
          label: 'Default Approvals',
          description: 'Standard safety checks (recommended)',
          detail: 'Copilot will ask for confirmation before running commands or making changes.',
        },
        {
          label: 'Bypass Approvals',
          description: 'Skip confirmation prompts',
          detail: 'New sessions may show an "Enable" confirmation popup.',
        },
        {
          label: 'Autopilot (Preview)',
          description: 'Full autonomous mode',
          detail: 'New sessions may show an "Enable" confirmation popup.',
        },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select approvals mode for resurrected sessions',
        title: 'Copilot Resurrect: Approvals Mode',
      });
      if (picked) {
        let mode: ApprovalsMode = 'default';
        if (picked.label.startsWith('Bypass')) {
          mode = 'bypass';
        } else if (picked.label.startsWith('Autopilot')) {
          mode = 'autopilot';
        }
        await vscode.workspace
          .getConfiguration(EXT_ID)
          .update('approvalsMode', mode, vscode.ConfigurationTarget.Global);
        Logger.info(`Approvals mode set to: ${mode}`);
        vscode.window.showInformationMessage(
          `Copilot Resurrect: Approvals mode set to "${picked.label}".`
        );
      }
    }),
  );

  // ── React to configuration changes ────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(EXT_ID)) {
        Logger.info('Configuration changed. Re-evaluating watcher state…');
        const cfg = getConfig();
        updateStatusBar();
        if (cfg.enabled && !_watcher?.active) {
          startWatcher();
        } else if (!cfg.enabled && _watcher?.active) {
          stopWatcher();
        } else if (cfg.enabled && _watcher?.active) {
          // Restart watcher with updated config (e.g. new timeout)
          startWatcher();
        }
      }
    })
  );

  // ── Auto-start if enabled ─────────────────────────────────────────────────
  const cfg = getConfig();
  if (cfg.enabled) {
    startWatcher();
  } else {
    _statusBar.setEnabled(false);
    Logger.info('Watcher is disabled. Enable it via the command palette or Settings.');
  }

  Logger.info(`Copilot Resurrect v${EXT_VERSION} activated.`);
}

// ── Deactivate ────────────────────────────────────────────────────────────────
export function deactivate(): void {
  stopWatcher();
  Logger.info('Copilot Resurrect extension deactivated.');
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function startWatcher(): void {
  const cfg = getConfig();
  _watcher?.start(cfg);
  updateStatusBar();
}

function stopWatcher(): void {
  _watcher?.stop();
  updateStatusBar();
}

function updateStatusBar(): void {
  const cfg = getConfig();
  const count = _engine?.todayCount ?? 0;
  _statusBar?.setEnabled(cfg.enabled, count, cfg.maxRestartsPerDay);
}

/** Triggered by SessionWatcher when silence threshold is exceeded. */
async function handleSilence(): Promise<void> {
  const cfg = getConfig();

  Logger.warn('Silence detected — initiating resurrection sequence.');
  _statusBar?.setResurrecting();

  const success = await _engine!.resurrect(cfg, false, 'silence');

  if (success) {
    _watcher?.bumpActivity();
  }

  updateStatusBar();
}

/** Triggered by SessionWatcher when an error pattern is detected in session files. */
async function handleError(error: DetectedError): Promise<void> {
  const cfg = getConfig();

  Logger.warn(`Error pattern detected: ${error.pattern} (type: ${error.type})`);
  Logger.warn(`  File: ${error.filePath}`);

  if (_engine?.isResurrecting || _engine?.isCoolingDown) {
    Logger.debug('Resurrection or cooldown already in progress — ignoring error trigger.');
    return;
  }

  _statusBar?.setResurrecting();

  const success = await _engine!.resurrect(cfg, false, error.type);

  if (success) {
    _watcher?.bumpActivity();
  }

  updateStatusBar();
}

/** Show a QuickPick of available Copilot models and save the selection. */
async function pickModelAndSave(setting: string, title: string): Promise<void> {
  const models = await getAvailableModels();
  if (models.length === 0) {
    vscode.window.showWarningMessage(
      'No Copilot language models found. Ensure GitHub Copilot is installed and authenticated.'
    );
    return;
  }

  const items: vscode.QuickPickItem[] = [
    { label: '(none)', description: 'Use the default model selected in Copilot Chat' },
    ...models.map(m => ({
      label: m.name || m.id,
      description: `Family: ${m.family} | Max tokens: ${m.maxInputTokens}`,
      detail: `ID: ${m.id}`,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: title,
    title: `Copilot Resurrect: ${title}`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (picked) {
    const value = picked.label === '(none)' ? '' : picked.label;
    await vscode.workspace
      .getConfiguration(EXT_ID)
      .update(setting, value, vscode.ConfigurationTarget.Global);
    Logger.info(`${setting} set to: ${value || '(none)'}`);
    vscode.window.showInformationMessage(
      `Copilot Resurrect: ${setting} set to "${value || '(none)'}".`
    );
  }
}
