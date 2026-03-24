/**
 * ErrorDetector — content-based detection of Copilot Chat error states.
 *
 * Unlike silence detection (which watches for inactivity), this module reads
 * the actual content of Copilot Chat session files to detect error messages
 * that indicate the session is dead even though the filesystem shows activity
 * (because the error text itself is written as chat content).
 *
 * Key error patterns:
 *  - Rate limiting: "rate_limited", "you have been rate-limited", "exhausted this model's rate limit"
 *  - Server errors: "Server Error", "malformed", "internal server error"
 *  - Content filtering: "response was filtered"
 *  - Model availability: "Please try a different model"
 */
import * as fs from 'fs';
import { Logger } from './logger';

export type ErrorType = 'rate_limit' | 'server_error' | 'content_filtered' | 'unknown_error';

export interface DetectedError {
  type: ErrorType;
  pattern: string;
  filePath: string;
  timestamp: Date;
}

/**
 * Patterns to search for in the tail of session files.
 * Each entry maps a regex pattern to an error type.
 * Patterns are case-insensitive and tested against the last chunk of file content.
 */
const ERROR_PATTERNS: Array<{ regex: RegExp; type: ErrorType; label: string }> = [
  // Rate limiting
  {
    regex: /you have been rate[- ]limited/i,
    type: 'rate_limit',
    label: 'rate-limited message',
  },
  {
    regex: /exhausted this model'?s rate limit/i,
    type: 'rate_limit',
    label: 'model rate limit exhausted',
  },
  {
    regex: /error[_ ]code:\s*rate[_ ]limited/i,
    type: 'rate_limit',
    label: 'rate_limited error code',
  },
  {
    regex: /Please try a different model/i,
    type: 'rate_limit',
    label: 'try different model suggestion',
  },
  // Server errors
  {
    regex: /Server Error:/i,
    type: 'server_error',
    label: 'server error prefix',
  },
  {
    regex: /internal server error/i,
    type: 'server_error',
    label: 'internal server error',
  },
  {
    regex: /malformed.{0,20}(request|response|prompt)/i,
    type: 'server_error',
    label: 'malformed request/response',
  },
  // Content filtering
  {
    regex: /the response was filtered/i,
    type: 'content_filtered',
    label: 'response filtered',
  },
  {
    regex: /content management policy/i,
    type: 'content_filtered',
    label: 'content policy violation',
  },
];

/** How many bytes from the end of the file to read for error scanning. */
const TAIL_BYTES = 4096;

/**
 * Tracks last-seen file sizes to avoid re-scanning unchanged content.
 * Key = absolute file path, value = last scanned file size.
 */
const _lastScannedSize = new Map<string, number>();

/**
 * Check a session file for error patterns.
 * Only reads the tail of the file (last TAIL_BYTES) for efficiency.
 * Returns the first matching error, or null if no error patterns found.
 *
 * Skips the scan if the file hasn't grown since the last check (the error
 * message would be in the new content appended to the file).
 */
export function checkFileForErrors(filePath: string): DetectedError | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) {
      return null;
    }

    // Skip if file hasn't changed size since last scan
    const prevSize = _lastScannedSize.get(filePath) ?? 0;
    if (stat.size <= prevSize) {
      return null;
    }
    _lastScannedSize.set(filePath, stat.size);

    // Read the tail of the file
    const readStart = Math.max(0, stat.size - TAIL_BYTES);
    const readLength = Math.min(stat.size, TAIL_BYTES);
    const buffer = Buffer.alloc(readLength);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, readLength, readStart);
    } finally {
      fs.closeSync(fd);
    }

    const content = buffer.toString('utf-8');

    // Test each pattern against the tail content
    for (const { regex, type, label } of ERROR_PATTERNS) {
      if (regex.test(content)) {
        Logger.warn(`Error detected in session file: ${label} (type: ${type})`);
        Logger.debug(`  File: ${filePath}`);
        return {
          type,
          pattern: label,
          filePath,
          timestamp: new Date(),
        };
      }
    }

    return null;
  } catch (err) {
    // File may be locked by Copilot Chat — log and skip silently
    Logger.debug(`Could not scan session file: ${filePath} (${err})`);
    return null;
  }
}

/**
 * Scan all .json files in a directory for error patterns.
 * Returns the first match found, or null.
 */
export function scanDirectoryForErrors(dirPath: string): DetectedError | null {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        const fullPath = `${dirPath}/${entry.name}`;
        const result = checkFileForErrors(fullPath);
        if (result) {
          return result;
        }
      }
    }
  } catch {
    // Directory may not exist yet — that's fine
  }
  return null;
}

/**
 * Reset the size tracking cache. Call this after a successful resurrection
 * so the next file write (the new session) gets a fresh baseline.
 */
export function resetScanCache(): void {
  _lastScannedSize.clear();
}
