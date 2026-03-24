import * as vscode from 'vscode';
import { Logger } from './logger';
import { ResurrectConfig, buildFullPrompt } from './config';
import { resetScanCache } from './errorDetector';

/** Key used to save daily restart records in globalState. */
const DAILY_STATE_KEY = 'copilot-resurrect.dailyRestarts';

interface DailyState {
  date: string; // YYYY-MM-DD
  count: number;
}

export type ResurrectionTrigger = 'silence' | 'rate_limit' | 'server_error' | 'content_filtered' | 'unknown_error' | 'manual';

/**
 * ResurrectionEngine handles:
 *  - Rate-limiting via the daily restart counter (persisted in globalState).
 *  - Cooldown delays when rate-limit errors are detected.
 *  - The actual resurrection sequence: focus -> inject prompt -> submit.
 */
export class ResurrectionEngine {
  private _context: vscode.ExtensionContext;
  private _isResurrecting = false;
  private _cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  private _onCooldownTick: ((secondsRemaining: number) => void) | undefined;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
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

  /**
   * Attempt to resurrect the Copilot Chat session.
   * Returns true on success, false if blocked (rate-limit, no prompt, etc.)
   *
   * @param config Current extension configuration.
   * @param dryRun If true, logs all steps but does NOT execute clipboard/submit commands.
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

    const useRateLimitFallback = trigger === 'rate_limit';
    const fullPrompt = buildFullPrompt(config, useRateLimitFallback);
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

    // ── Cooldown for rate-limit triggers ───────────────────────────────────
    if (trigger === 'rate_limit' && config.rateLimitCooldownSeconds > 0 && !dryRun) {
      Logger.info(
        `Rate-limit detected. Waiting ${config.rateLimitCooldownSeconds}s cooldown ` +
        `before resurrection…`
      );
      vscode.window.showInformationMessage(
        `Copilot Resurrect: Rate-limited. Cooling down for ${config.rateLimitCooldownSeconds}s before retry.`
      );
      await this._cooldown(config.rateLimitCooldownSeconds);
      Logger.info('Cooldown complete. Proceeding with resurrection.');
    }

    this._isResurrecting = true;
    Logger.separator();
    Logger.info(
      `Resurrection attempt #${state.count + 1} (today). ` +
      `Trigger: ${trigger}. DryRun: ${dryRun}. ` +
      `FallbackModel: ${useRateLimitFallback && config.fallbackModelHint ? config.fallbackModelHint : 'N/A'}`
    );
    Logger.info(`Prompt: ${fullPrompt.substring(0, 120)}${fullPrompt.length > 120 ? '…' : ''}`);

    try {
      if (dryRun) {
        Logger.info('[DRY RUN] Would execute: workbench.action.chat.focus');
        await sleep(300);
        Logger.info('[DRY RUN] Would write prompt to clipboard');
        await sleep(300);
        Logger.info('[DRY RUN] Would execute: editor.action.clipboardPasteAction');
        await sleep(300);
        Logger.info('[DRY RUN] Would execute: workbench.action.chat.submit');
        Logger.info('[DRY RUN] Resurrection simulation complete.');
        return true;
      }

      // ── Step 1: Save clipboard  ──────────────────────────────────────────
      const previousClipboard = await vscode.env.clipboard.readText();
      Logger.debug('Clipboard saved.');

      // ── Step 2: Focus Copilot Chat  ──────────────────────────────────────
      Logger.info('Focusing Copilot Chat panel…');
      await vscode.commands.executeCommand('workbench.action.chat.focus');
      await sleep(500);

      // ── Step 3: Write prompt to clipboard  ──────────────────────────────
      await vscode.env.clipboard.writeText(fullPrompt);
      Logger.debug('Prompt written to clipboard.');
      await sleep(200);

      // ── Step 4: Paste into the chat input  ──────────────────────────────
      Logger.info('Pasting prompt into chat input…');
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
      await sleep(400);

      // ── Step 5: Submit  ─────────────────────────────────────────────────
      Logger.info('Submitting prompt…');
      await vscode.commands.executeCommand('workbench.action.chat.submit');
      await sleep(300);

      // ── Step 6: Restore clipboard  ──────────────────────────────────────
      await vscode.env.clipboard.writeText(previousClipboard);
      Logger.debug('Clipboard restored.');

      // ── Reset error detection cache so new session gets a fresh baseline ─
      resetScanCache();

      // ── Increment counter  ───────────────────────────────────────────────
      this._incrementDailyState();
      Logger.info(`Resurrection complete. Today's count: ${this.todayCount}/${config.maxRestartsPerDay}.`);

      vscode.window.showInformationMessage(
        `Copilot Resurrect: Session restarted [${trigger}] (${this.todayCount}/${config.maxRestartsPerDay} today).`
      );

      return true;
    } catch (err) {
      Logger.error('Resurrection failed', err);
      vscode.window.showErrorMessage(`Copilot Resurrect: Resurrection failed — ${err}`);
      return false;
    } finally {
      this._isResurrecting = false;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

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
