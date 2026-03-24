import * as vscode from 'vscode';
import { Logger } from './logger';
import { ResurrectConfig } from './config';
import { discoverWatchDirs } from './pathDiscovery';
import { checkFileForErrors, DetectedError } from './errorDetector';

export type SilenceCallback = () => void;
export type ErrorCallback = (error: DetectedError) => void;

/**
 * SessionWatcher monitors Copilot Chat session files for activity.
 * Dual detection modes:
 *  1. Silence detection — no filesystem changes for N seconds → presumed dead
 *  2. Content-based error detection — reads session files for error patterns
 *     (rate-limit, server errors) even when the filesystem shows activity
 */
export class SessionWatcher implements vscode.Disposable {
  private _fsWatchers: vscode.FileSystemWatcher[] = [];
  private _workspaceListeners: vscode.Disposable[] = [];
  private _lastActivityAt: Date = new Date();
  private _lastWorkspaceLogAt = 0;
  private _pollInterval: ReturnType<typeof setInterval> | undefined;
  private _onSilenceDetected: SilenceCallback;
  private _onErrorDetected: ErrorCallback;
  private _config: ResurrectConfig;
  private _context: vscode.ExtensionContext;
  private _active = false;

  constructor(
    context: vscode.ExtensionContext,
    config: ResurrectConfig,
    onSilenceDetected: SilenceCallback,
    onErrorDetected: ErrorCallback,
  ) {
    this._context = context;
    this._config = config;
    this._onSilenceDetected = onSilenceDetected;
    this._onErrorDetected = onErrorDetected;
  }

  get active(): boolean {
    return this._active;
  }

  get lastActivityAt(): Date {
    return this._lastActivityAt;
  }

  get secondsSinceActivity(): number {
    return Math.floor((Date.now() - this._lastActivityAt.getTime()) / 1000);
  }

  start(config?: ResurrectConfig): void {
    if (config) {
      this._config = config;
    }
    this.stop();   // clean up any previous watchers
    this._active = true;
    this._lastActivityAt = new Date();

    Logger.separator();
    Logger.info('SessionWatcher starting…');

    // ── File-system watches ───────────────────────────────────────────────
    const overridePaths = this._config.watchPaths;
    const watchDirs: string[] =
      overridePaths.length > 0 ? overridePaths : discoverWatchDirs(this._context);

    let watchersCreated = 0;
    for (const dir of watchDirs) {
      try {
        const glob = new vscode.RelativePattern(
          vscode.Uri.file(dir),
          '**/*.json'
        );
        const watcher = vscode.workspace.createFileSystemWatcher(
          glob,
          false,
          false,
          false
        );

        const touchActivity = (uri: vscode.Uri) => {
          Logger.debug(`File activity: ${uri.fsPath}`);
          this._bumpActivity();

          // Content-based error detection on file change
          if (this._config.contentCheckEnabled) {
            const error = checkFileForErrors(uri.fsPath);
            if (error) {
              this._onErrorDetected(error);
            }
          }
        };

        watcher.onDidChange(touchActivity);
        watcher.onDidCreate(touchActivity);
        watcher.onDidDelete((uri: vscode.Uri) => {
          Logger.debug(`File deleted: ${uri.fsPath}`);
          this._bumpActivity();
        });

        this._fsWatchers.push(watcher);
        watchersCreated++;
      } catch (err) {
        Logger.warn(`Could not create watcher for ${dir}: ${err}`);
      }
    }

    if (watchersCreated === 0) {
      Logger.warn('No file-system watchers created. Using timer-only silence detection.');
    } else {
      Logger.info(`${watchersCreated} file-system watcher(s) active.`);
    }

    // ── Workspace activity detection (catches sub-agent file edits) ───────
    // When Copilot delegates to a sub-agent, the agent edits workspace files,
    // runs terminal commands, etc. These trigger document change events that
    // should reset the silence timer to prevent false resurrection triggers.
    const bumpFromWorkspace = (uri: vscode.Uri, source: string) => {
      if (uri.scheme !== 'file') { return; }
      this._bumpActivity();
      // Throttle logging — at most once per 30s to avoid spam during rapid edits
      const now = Date.now();
      if (now - this._lastWorkspaceLogAt > 30_000) {
        Logger.debug(`Workspace activity (${source}): ${uri.fsPath}`);
        this._lastWorkspaceLogAt = now;
      }
    };

    this._workspaceListeners.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        bumpFromWorkspace(e.document.uri, 'doc-change');
      }),
      vscode.workspace.onDidSaveTextDocument(doc => {
        bumpFromWorkspace(doc.uri, 'doc-save');
      }),
    );
    Logger.info('Workspace activity listeners active (sub-agent detection).');

    // ── Polling heartbeat – checks silence threshold every 15s ────────────
    this._pollInterval = setInterval(() => {
      const elapsed = this.secondsSinceActivity;
      const timeout = this._config.silenceTimeoutSeconds;

      Logger.debug(`Heartbeat: ${elapsed}s since last activity (timeout: ${timeout}s)`);

      if (elapsed >= timeout) {
        Logger.warn(`Silence threshold reached (${elapsed}s >= ${timeout}s). Triggering resurrection…`);
        this._bumpActivity(); // reset to avoid re-trigger during resurrection
        this._onSilenceDetected();
      }
    }, 15_000);

    Logger.info(
      `SessionWatcher active. Silence timeout: ${this._config.silenceTimeoutSeconds}s. ` +
      `Content check: ${this._config.contentCheckEnabled ? 'ON' : 'OFF'}. ` +
      `Max restarts/day: ${this._config.maxRestartsPerDay}.`
    );
  }

  stop(): void {
    for (const w of this._fsWatchers) {
      w.dispose();
    }
    this._fsWatchers = [];

    for (const l of this._workspaceListeners) {
      l.dispose();
    }
    this._workspaceListeners = [];

    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = undefined;
    }

    this._active = false;
    Logger.info('SessionWatcher stopped.');
  }

  /** Call this to manually register activity (e.g., after a resurrection). */
  bumpActivity(): void {
    this._bumpActivity();
  }

  private _bumpActivity(): void {
    this._lastActivityAt = new Date();
  }

  dispose(): void {
    this.stop();
  }
}
