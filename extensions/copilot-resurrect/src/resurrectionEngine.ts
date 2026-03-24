import * as vscode from 'vscode';
import { Logger } from './logger';
import { ResurrectConfig, buildFullPrompt } from './config';
import { resetScanCache } from './errorDetector';

/** Key used to save daily restart records in globalState. */
const DAILY_STATE_KEY = 'copilot-resurrect.dailyRestarts';
/** Key for tracking consecutive rate-limit failures for exponential backoff. */
const CONSECUTIVE_RL_KEY = 'copilot-resurrect.consecutiveRateLimits';

interface DailyState {
  date: string; // YYYY-MM-DD
  count: number;
}

export type ResurrectionTrigger = 'silence' | 'rate_limit' | 'server_error' | 'content_filtered' | 'unknown_error' | 'manual';

/**
 * ResurrectionEngine handles:
 *  - Rate-limiting via the daily restart counter (persisted in globalState).
 *  - Exponential backoff cooldown when rate-limit errors are detected.
 *  - The actual resurrection sequence using VS Code chat commands (no clipboard).
 */
export class ResurrectionEngine {
  private _context: vscode.ExtensionContext;
  private _isResurrecting = false;
  private _cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  private _onCooldownTick: ((secondsRemaining: number) => void) | undefined;
  private _consecutiveRateLimits = 0;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._consecutiveRateLimits = context.globalState.get<number>(CONSECUTIVE_RL_KEY, 0);
  }

  get isResurrecting(): boolean {
    return this._isResurrecting;
  }

  get isCoolingDown(): boolean {
    return this._cooldownTimer !== undefined;
  }

  /** How many automatic resurrections have been triggered today. */
  get todayCount(): number {
    const state = this._getDailyState();
    return state.count;
  }

  /** Register a callback for cooldown tick updates (for status bar). */
  set onCooldownTick(cb: ((secondsRemaining: number) => void) | undefined) {
    this._onCooldownTick = cb;
  }

  /** Reset the daily counter (exposed as a command). */
  resetDailyCounter(): void {
    const fresh: DailyState = { date: todayString(), count: 0 };
    this._context.globalState.update(DAILY_STATE_KEY, fresh);
    Logger.info('Daily restart counter reset to 0.');
  }

  /** Reset the exponential backoff counter (e.g., after successful session). */
  resetBackoff(): void {
    this._consecutiveRateLimits = 0;
    this._context.globalState.update(CONSECUTIVE_RL_KEY, 0);
    Logger.info('Exponential backoff counter reset.');
  }

  /**
   * Calculate the current cooldown duration using exponential backoff.
   * Formula: min(base * 2^consecutive, max)
   */
  calculateCooldown(config: ResurrectConfig): number {
    const base = config.rateLimitCooldownBaseSeconds;
    const max = config.rateLimitCooldownMaxSeconds;
    const cooldown = Math.min(base * Math.pow(2, this._consecutiveRateLimits), max);
    return Math.round(cooldown);
  }

  /**
   * Attempt to resurrect the Copilot Chat session.
   * Returns true on success, false if blocked (rate-limit, no prompt, etc.)
   *
   * For error-based triggers (rate_limit, server_error, content_filtered):
   *   Uses `workbench.action.chat.retry` to hit the "Try Again" button
   *   in the existing session, preserving in-progress work context.
   *
   * For silence/manual triggers:
   *   Injects the ignition prompt into a new or existing session.
   *
   * @param config Current extension configuration.
   * @param dryRun If true, logs all steps but does NOT execute commands.
   * @param trigger What caused the resurrection (silence, rate_limit, etc.)
   */
  async resurrect(
    config: ResurrectConfig,
    dryRun = false,
    trigger: ResurrectionTrigger = 'manual',
  ): Promise<boolean> {
    if (this._isResurrecting) {
      Logger.warn('Resurrection already in progress. Skipping duplicate trigger.');
      return false;
    }

    if (this._cooldownTimer) {
      Logger.warn('Cooldown in progress. Skipping resurrection trigger.');
      return false;
    }

    // Error-based triggers use retry-in-place — no ignition prompt needed.
    // Silence/manual triggers require a prompt to restart the loop.
    const isErrorTrigger = trigger === 'rate_limit' || trigger === 'server_error' || trigger === 'content_filtered' || trigger === 'unknown_error';

    if (!isErrorTrigger) {
      const fullPrompt = buildFullPrompt(config);
      if (!fullPrompt) {
        Logger.warn('ignitionPrompt is empty. Cannot resurrect. Please configure copilot-resurrect.ignitionPrompt.');
        vscode.window.showWarningMessage(
          'Copilot Resurrect: ignitionPrompt is not set. Open Settings to configure it.',
          'Open Settings'
        ).then((sel: string | undefined) => {
          if (sel === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'copilot-resurrect.ignitionPrompt');
          }
        });
        return false;
      }
    }

    // ── Daily rate-limit check ─────────────────────────────────────────────
    const state = this._getDailyState();
    if (state.count >= config.maxRestartsPerDay) {
      Logger.warn(
        `Daily restart cap reached (${state.count}/${config.maxRestartsPerDay}). ` +
        `Halting resurrection. Run "Copilot Resurrect: Reset Daily Counter" to resume.`
      );
      vscode.window.showWarningMessage(
        `Copilot Resurrect has hit its daily cap of ${config.maxRestartsPerDay} restarts. ` +
        `Use the "Reset Daily Counter" command to resume.`,
        'Reset Counter'
      ).then((sel: string | undefined) => {
        if (sel === 'Reset Counter') {
          this.resetDailyCounter();
        }
      });
      return false;
    }

    // ── Exponential backoff cooldown for error triggers ────────────────────
    if (isErrorTrigger && !dryRun) {
      this._consecutiveRateLimits++;
      this._context.globalState.update(CONSECUTIVE_RL_KEY, this._consecutiveRateLimits);

      const cooldownSeconds = this.calculateCooldown(config);
      Logger.info(
        `Error trigger [${trigger}] (consecutive: ${this._consecutiveRateLimits}). ` +
        `Exponential backoff: waiting ${cooldownSeconds}s before retry…`
      );
      vscode.window.showInformationMessage(
        `Copilot Resurrect: ${trigger}. Backoff cooldown: ${cooldownSeconds}s ` +
        `(attempt ${this._consecutiveRateLimits})`
      );
      await this._cooldown(cooldownSeconds);
      Logger.info('Cooldown complete. Proceeding with resurrection.');
    }

    this._isResurrecting = true;
    Logger.separator();
    Logger.info(
      `Resurrection attempt #${state.count + 1} (today). ` +
      `Trigger: ${trigger}. Strategy: ${isErrorTrigger ? 'RETRY in-place' : 'NEW session'}. ` +
      `DryRun: ${dryRun}. ` +
      `Model: ${config.preferredModel || '(default)'}. ` +
      `Participant: ${config.chatParticipant || '(none)'}. ` +
      `AgentMode: ${config.agentMode || '(default)'}. ` +
      `Approvals: ${config.approvalsMode}. ` +
      `NewSession: ${config.startNewSession}`
    );

    try {
      // ═══════════════════════════════════════════════════════════════════════
      // PATH A: Error-based triggers → retry in the existing session
      // ═══════════════════════════════════════════════════════════════════════
      if (isErrorTrigger) {
        return await this._retryInPlace(config, dryRun, trigger, state);
      }

      // ═══════════════════════════════════════════════════════════════════════
      // PATH B: Silence / manual → inject ignition prompt
      // ═══════════════════════════════════════════════════════════════════════
      return await this._ignitionPromptResurrect(config, dryRun, trigger, state);
    } catch (err) {
      Logger.error('Resurrection failed', err);
      vscode.window.showErrorMessage(`Copilot Resurrect: Resurrection failed — ${err}`);
      return false;
    } finally {
      this._isResurrecting = false;
    }
  }

  /**
   * Retry the last request in the existing chat session ("Try Again" button).
   * Preserves in-progress work context — the model sees the full conversation
   * history and can resume where it left off.
   */
  private async _retryInPlace(
    config: ResurrectConfig,
    dryRun: boolean,
    trigger: ResurrectionTrigger,
    state: DailyState,
  ): Promise<boolean> {
    if (dryRun) {
      Logger.info(`[DRY RUN] Error trigger [${trigger}] — would focus chat panel`);
      await sleep(200);
      Logger.info('[DRY RUN] Would execute: workbench.action.chat.retry ("Try Again")');
      Logger.info('[DRY RUN] Retry simulation complete.');
      return true;
    }

    // Focus the existing chat panel
    Logger.info('Focusing existing Copilot Chat panel for retry…');
    await vscode.commands.executeCommand('workbench.action.chat.focus');
    await sleep(500);

    // Hit "Try Again" — resends the last request in the current session
    Logger.info(`Executing workbench.action.chat.retry (trigger: ${trigger})…`);
    try {
      await vscode.commands.executeCommand('workbench.action.chat.retry');
      await sleep(400);
    } catch (retryErr) {
      // If retry fails (e.g., no last response to retry), fall back to ignition prompt
      Logger.warn(`chat.retry failed: ${retryErr}. Falling back to ignition prompt resurrection.`);
      return await this._ignitionPromptResurrect(config, false, trigger, state);
    }

    // Reset error detection cache so the retried response gets a fresh baseline
    resetScanCache();

    this._incrementDailyState();
    Logger.info(
      `Retry complete [${trigger}]. Today's count: ${this.todayCount}/${config.maxRestartsPerDay}.`
    );

    vscode.window.showInformationMessage(
      `Copilot Resurrect: Retried in-place [${trigger}] (${this.todayCount}/${config.maxRestartsPerDay} today).`
    );

    return true;
  }

  /**
   * Classic resurrection: inject the ignition prompt into a new or existing session.
   * Used for silence-based detection and as a fallback when retry-in-place fails.
   */
  private async _ignitionPromptResurrect(
    config: ResurrectConfig,
    dryRun: boolean,
    trigger: ResurrectionTrigger,
    state: DailyState,
  ): Promise<boolean> {
    const fullPrompt = buildFullPrompt(config);
    if (!fullPrompt) {
      Logger.warn('ignitionPrompt is empty. Cannot resurrect via ignition prompt.');
      return false;
    }

    Logger.info(`Prompt: ${fullPrompt.substring(0, 120)}${fullPrompt.length > 120 ? '…' : ''}`);

    if (dryRun) {
      Logger.info('[DRY RUN] Would execute: workbench.action.chat.newChat (if startNewSession)');
      await sleep(200);
      if (config.agentMode) {
        Logger.info(`[DRY RUN] Would switch agent mode to: ${config.agentMode}`);
        await sleep(200);
      }
      Logger.info(`[DRY RUN] Would execute: workbench.action.chat.open with query (${fullPrompt.length} chars)`);
      await sleep(200);
      Logger.info('[DRY RUN] Would execute: workbench.action.chat.submit');
      Logger.info('[DRY RUN] Resurrection simulation complete.');
      return true;
    }

    // ── Step 1: Optionally start new chat session  ──────────────────────
    if (config.startNewSession) {
      Logger.info('Starting new chat session…');
      await vscode.commands.executeCommand('workbench.action.chat.newChat');
      await sleep(600);

      // Switch to configured agent mode
      if (config.agentMode) {
        Logger.info(`Switching to agent mode: ${config.agentMode}…`);
        try {
          await vscode.commands.executeCommand(
            'workbench.action.chat.switchChatMode',
            config.agentMode
          );
          await sleep(400);
        } catch (err) {
          Logger.warn(`Could not switch chat mode to "${config.agentMode}": ${err}`);
        }
      }

      // Approvals mode reminder for new sessions
      if (config.approvalsMode !== 'default') {
        const modeLabel = config.approvalsMode === 'bypass'
          ? 'Bypass Approvals'
          : 'Autopilot (Preview)';
        Logger.info(`Approvals mode preference: ${modeLabel}. User may need to confirm in the chat UI.`);
        vscode.window.showInformationMessage(
          `Copilot Resurrect: New session started. Set approvals to "${modeLabel}" in the chat dropdown if needed.`,
          'Dismiss'
        );
      }
    } else {
      // ── Focus existing chat  ──────────────────────────────────────────
      Logger.info('Focusing existing Copilot Chat panel…');
      await vscode.commands.executeCommand('workbench.action.chat.focus');
      await sleep(400);
    }

    // ── Step 2: Inject prompt via chat open command (no clipboard)  ──────
    Logger.info('Injecting prompt via workbench.action.chat.open…');
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: fullPrompt,
      isPartialQuery: true,
    });
    await sleep(400);

    // ── Step 3: Submit  ─────────────────────────────────────────────────
    Logger.info('Submitting prompt…');
    await vscode.commands.executeCommand('workbench.action.chat.submit');
    await sleep(300);

    // ── Reset error detection cache so new session gets a fresh baseline ─
    resetScanCache();

    // ── Reset backoff on successful non-error triggers  ───────────────
    if (!this._isErrorTrigger(trigger)) {
      this.resetBackoff();
    }

    // ── Increment counter  ───────────────────────────────────────────────
    this._incrementDailyState();
    Logger.info(`Resurrection complete. Today's count: ${this.todayCount}/${config.maxRestartsPerDay}.`);

    vscode.window.showInformationMessage(
      `Copilot Resurrect: Session restarted [${trigger}] (${this.todayCount}/${config.maxRestartsPerDay} today).`
    );

    return true;
  }

  private _isErrorTrigger(trigger: ResurrectionTrigger): boolean {
    return trigger === 'rate_limit' || trigger === 'server_error' || trigger === 'content_filtered' || trigger === 'unknown_error';
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Exposed for _retryInPlace / _ignitionPromptResurrect which receive state as a param. */
  private _getDailyState(): DailyState {
    const stored = this._context.globalState.get<DailyState>(DAILY_STATE_KEY);
    const today = todayString();
    if (!stored || stored.date !== today) {
      const fresh: DailyState = { date: today, count: 0 };
      this._context.globalState.update(DAILY_STATE_KEY, fresh);
      return fresh;
    }
    return stored;
  }

  private _incrementDailyState(): void {
    const state = this._getDailyState();
    const updated: DailyState = { date: state.date, count: state.count + 1 };
    this._context.globalState.update(DAILY_STATE_KEY, updated);
  }

  /** Wait for the specified cooldown period, ticking every second. */
  private _cooldown(seconds: number): Promise<void> {
    return new Promise(resolve => {
      let remaining = seconds;
      this._cooldownTimer = setInterval(() => {
        remaining--;
        this._onCooldownTick?.(remaining);
        if (remaining <= 0) {
          if (this._cooldownTimer) {
            clearInterval(this._cooldownTimer);
            this._cooldownTimer = undefined;
          }
          resolve();
        }
      }, 1000);
    });
  }
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
