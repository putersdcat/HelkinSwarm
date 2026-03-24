import * as vscode from 'vscode';

/**
 * Manages the status bar item for Copilot Resurrect.
 * Shows icon + state in the bottom status bar.
 */
export class ResurrectStatusBar implements vscode.Disposable {
  private _item: vscode.StatusBarItem;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this._item.command = 'copilot-resurrect.toggle';
    this._item.tooltip = 'Click to toggle Copilot Resurrect watcher';
  }

  setEnabled(enabled: boolean, restartCount?: number, maxRestarts?: number): void {
    const countStr =
      restartCount !== undefined && maxRestarts !== undefined
        ? ` (${restartCount}/${maxRestarts})`
        : '';

    if (enabled) {
      this._item.text = `$(debug-restart) Resurrect ON${countStr}`;
      this._item.backgroundColor = undefined;
      this._item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
    } else {
      this._item.text = `$(debug-pause) Resurrect OFF`;
      this._item.backgroundColor = undefined;
      this._item.color = undefined;
    }
    this._item.show();
  }

  setResurrecting(): void {
    this._item.text = `$(loading~spin) Resurrecting…`;
    this._item.show();
  }

  setCooldown(secondsRemaining: number): void {
    this._item.text = `$(watch) Rate-limited — cooldown ${secondsRemaining}s`;
    this._item.show();
  }

  show(): void {
    this._item.show();
  }

  hide(): void {
    this._item.hide();
  }

  dispose(): void {
    this._item.dispose();
  }
}
