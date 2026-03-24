import * as vscode from 'vscode';

export class Logger {
  private static _channel: vscode.OutputChannel | undefined;

  static init(): void {
    if (!Logger._channel) {
      Logger._channel = vscode.window.createOutputChannel('Copilot Resurrection Watcher');
    }
  }

  static get channel(): vscode.OutputChannel {
    if (!Logger._channel) {
      Logger.init();
    }
    return Logger._channel!;
  }

  static info(msg: string): void {
    const line = `[${timestamp()}] [INFO]  ${msg}`;
    Logger.channel.appendLine(line);
    console.log(line);
  }

  static warn(msg: string): void {
    const line = `[${timestamp()}] [WARN]  ${msg}`;
    Logger.channel.appendLine(line);
    console.warn(line);
  }

  static error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? ` | ${err.message}` : err ? ` | ${String(err)}` : '';
    const line = `[${timestamp()}] [ERROR] ${msg}${detail}`;
    Logger.channel.appendLine(line);
    console.error(line);
  }

  static debug(msg: string): void {
    const line = `[${timestamp()}] [DEBUG] ${msg}`;
    Logger.channel.appendLine(line);
    console.debug(line);
  }

  static separator(): void {
    Logger.channel.appendLine('─'.repeat(72));
  }

  static show(): void {
    Logger.channel.show(true);
  }

  static dispose(): void {
    Logger._channel?.dispose();
    Logger._channel = undefined;
  }
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
