/**
 * Dynamically discovers the paths used by GitHub Copilot Chat for session storage.
 *
 * Strategy:
 *  1. Use context.storageUri to anchor into the workspaceStorage directory.
 *  2. Enumerate all peer extension folders looking for "github.copilot-chat".
 *  3. Look for a "chatSessions" sub-folder inside that.
 *  4. Fall back to watching all *.json under the copilot-chat workspace storage root.
 *  5. Also watch a broader User/globalStorage/github.copilot-chat path.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as p from 'path';
import * as os from 'os';
import { Logger } from './logger';

export function discoverWatchDirs(context: vscode.ExtensionContext): string[] {
  const dirs: string[] = [];

  // ── 1. workspaceStorage  ─────────────────────────────────────────────────
  try {
    const myStoragePath = context.storageUri?.fsPath;
    if (myStoragePath) {
      const wsHashDir = p.dirname(myStoragePath);

      Logger.debug(`workspaceStorage hash dir: ${wsHashDir}`);

      const copilotChatWsPath = p.join(wsHashDir, 'github.copilot-chat');
      if (fs.existsSync(copilotChatWsPath)) {
        const chatSessionsPath = p.join(copilotChatWsPath, 'chatSessions');
        if (fs.existsSync(chatSessionsPath)) {
          dirs.push(chatSessionsPath);
          Logger.info(`Watch target (chatSessions): ${chatSessionsPath}`);
        } else {
          dirs.push(copilotChatWsPath);
          Logger.info(`Watch target (copilot-chat ws storage): ${copilotChatWsPath}`);
        }
      } else {
        dirs.push(wsHashDir);
        Logger.info(`Watch target (ws hash broad sweep): ${wsHashDir}`);
      }
    }
  } catch (err) {
    Logger.warn(`workspaceStorage discovery failed: ${err}`);
  }

  // ── 2. globalStorage path  ───────────────────────────────────────────────
  try {
    const globalStoragePath = context.globalStorageUri?.fsPath;
    if (globalStoragePath) {
      const globalStorageRoot = p.dirname(globalStoragePath);
      const copilotGlobalPath = p.join(globalStorageRoot, 'github.copilot-chat');
      if (fs.existsSync(copilotGlobalPath)) {
        dirs.push(copilotGlobalPath);
        Logger.info(`Watch target (global storage): ${copilotGlobalPath}`);
      }
    }
  } catch (err) {
    Logger.warn(`globalStorage discovery failed: ${err}`);
  }

  // ── 3. Hard-coded fallback paths (Windows + macOS + Linux)  ─────────────
  const fallbackCandidates = buildFallbackPaths();
  for (const candidate of fallbackCandidates) {
    if (fs.existsSync(candidate) && !dirs.includes(candidate)) {
      dirs.push(candidate);
      Logger.info(`Watch target (fallback): ${candidate}`);
    }
  }

  if (dirs.length === 0) {
    Logger.warn('No Copilot Chat storage paths found. Silence detection will rely on timer only.');
    Logger.warn('You can override via copilot-resurrect.watchPaths if needed.');
  }

  return dirs;
}

function buildFallbackPaths(): string[] {
  const candidates: string[] = [];
  const platform = process.platform;

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? p.join(os.homedir(), 'AppData', 'Roaming');
    candidates.push(p.join(appData, 'Code', 'User', 'globalStorage', 'github.copilot-chat'));
    candidates.push(p.join(appData, 'Code - Insiders', 'User', 'globalStorage', 'github.copilot-chat'));
  } else if (platform === 'darwin') {
    const home = os.homedir();
    candidates.push(p.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'github.copilot-chat'));
    candidates.push(p.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage', 'github.copilot-chat'));
  } else {
    const home = os.homedir();
    candidates.push(p.join(home, '.config', 'Code', 'User', 'globalStorage', 'github.copilot-chat'));
    candidates.push(p.join(home, '.config', 'Code - Insiders', 'User', 'globalStorage', 'github.copilot-chat'));
  }

  return candidates;
}
