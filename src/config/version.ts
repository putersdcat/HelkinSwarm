// Canonical app version — single source of truth.
// Reads from package.json at import time so it works in Azure Functions
// where npm_package_version is not set.
// Issue: #153

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadVersion(): string {
  try {
    // Navigate from dist/src/config/version.js → project root/package.json
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(thisDir, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

export const APP_VERSION: string = loadVersion();
