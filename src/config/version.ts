// Canonical app version — single source of truth.
// Reads from package.json at import time so it works in Azure Functions
// where npm_package_version is not set.
// Issue: #153

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadVersion(): string {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    // Try multiple levels — works from both dist/src/config/ (runtime) and src/config/ (vitest)
    for (const depth of ['..', '../..', '../../..']) {
      const pkgPath = resolve(thisDir, depth, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        continue;
      }
    }
    return '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

export const APP_VERSION: string = loadVersion();
