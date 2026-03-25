import * as vscode from 'vscode';
import { Logger } from './logger';
import { ResurrectConfig } from './config';
import { discoverWatchDirs } from './pathDiscovery';
import { checkFileForErrors, DetectedError } from './errorDetector';

export type SilenceCallback = () => void;
export type ErrorCallback = (error: DetectedError) => void;

/**
 * Returns true if the given file-system path matches any of the provided glob patterns.
 * Supports `**` (any path depth), `*` (within a single segment), and `?` (single char).
 * Path separators are normalised to `/` before matching.
 */
function matchesAnyIgnorePattern(fsPath: string, patterns: string[]): boolean {
  if (!patterns.length) { return false; }
  const normalised = fsPath.replace(/\\/g, '/');
  return patterns.some(pattern => {
    const re = pattern
      .replace(/\\/g, '/')
      .replace(/[.+^${}()|[\]]/g, '\\$&')  // escape regex special chars (not * or ?)
      .replace(/\*\*\//g, '(?:.*/)?')       // **/ = zero or more path components
      .replace(/\*\*/g, '.*')               // ** = anything
      .replace(/\*/g, '[^/]*')              // * = within single segment
      .replace(/\?/g, '[^/]');              // ? = single char
    return new RegExp(re, 'i').test(normalised);
  });
}

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

    // ── Workspace + terminal activity detection (sub-agent awareness) ────
    // Sub-agents interact via multiple channels that the Copilot Chat storage
    // watchers can't see:
    //   - File edits (create_file, replace_string_in_file) → workspace FS events
    //   - Terminal commands (run_in_terminal) → terminal open/change events
    //   - File reads are invisible but always paired with edits/terminals
    //
    // We cast a wide net: workspace FileSystemWatcher on all workspace folders,
    // VS Code editor document events, terminal events, and file lifecycle events.

    const bumpWithThrottledLog = (source: string, detail?: string) => {
      // Skip paths that match the configured ignore patterns
      if (detail && matchesAnyIgnorePattern(detail, this._config.watchIgnorePatterns)) {
        return;
      }
      this._bumpActivity();
      const now = Date.now();
      if (now - this._lastWorkspaceLogAt > 30_000) {
        Logger.debug(`Activity signal (${source})${detail ? ': ' + detail : ''}`);
        this._lastWorkspaceLogAt = now;
      }
    };

    // 1. Workspace-root FileSystemWatcher — catches ALL file creates/edits/deletes
    //    in the workspace, even for files NOT open in editor tabs.
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        const wsWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, '**/*'),
        );
        wsWatcher.onDidChange(uri => bumpWithThrottledLog('ws-file-change', uri.fsPath));
        wsWatcher.onDidCreate(uri => bumpWithThrottledLog('ws-file-create', uri.fsPath));
        wsWatcher.onDidDelete(uri => bumpWithThrottledLog('ws-file-delete', uri.fsPath));
        this._workspaceListeners.push(wsWatcher);
      } catch (err) {
        Logger.warn(`Could not create workspace root watcher for ${folder.uri.fsPath}: ${err}`);
      }
    }

    // 2. Editor document events — fires when open documents change in tabs
    this._workspaceListeners.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.scheme === 'file') {
          bumpWithThrottledLog('doc-change', e.document.uri.fsPath);
        }
      }),
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.uri.scheme === 'file') {
          bumpWithThrottledLog('doc-save', doc.uri.fsPath);
        }
      }),
    );

    // 3. File lifecycle events — fires when extensions create/delete files
    this._workspaceListeners.push(
      vscode.workspace.onDidCreateFiles(e => {
        for (const f of e.files) { bumpWithThrottledLog('files-created', f.fsPath); }
      }),
      vscode.workspace.onDidDeleteFiles(e => {
        for (const f of e.files) { bumpWithThrottledLog('files-deleted', f.fsPath); }
      }),
      vscode.workspace.onDidRenameFiles(e => {
        for (const f of e.files) { bumpWithThrottledLog('files-renamed', f.newUri.fsPath); }
      }),
    );

    // 4. Terminal events — sub-agents spawn terminals via run_in_terminal
    this._workspaceListeners.push(
      vscode.window.onDidOpenTerminal(() => bumpWithThrottledLog('terminal-open')),
      vscode.window.onDidChangeActiveTerminal(() => bumpWithThrottledLog('terminal-active')),
    );

    // 5. Terminal shell execution events (VS Code 1.93+) — most precise signal
    //    that a sub-agent just ran a terminal command.
    if ('onDidStartTerminalShellExecution' in vscode.window) {
      this._workspaceListeners.push(
        (vscode.window as any).onDidStartTerminalShellExecution(() =>
          bumpWithThrottledLog('shell-exec-start')
        ),
        (vscode.window as any).onDidEndTerminalShellExecution(() =>
          bumpWithThrottledLog('shell-exec-end')
        ),
      );
    }

    Logger.info('Activity listeners active (workspace FS, editor, terminal, file lifecycle).');

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
