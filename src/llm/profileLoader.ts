// Model profile loader — reads & validates Git-tracked profile JSON for each model.
// Profiles live in `model-profiles/<model-id>/profile.json`.
// Spec ref: 0b-Model-Specific-Tool-Presentation.md — Profile Applicator
// Issue #95

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ModelProfileSchema, type ModelProfile } from './modelProfileSchema.js';

// ---------------------------------------------------------------------------
// Cache — profiles don't change at runtime (Git-tracked, deployed with code)
// ---------------------------------------------------------------------------

const profileCache = new Map<string, ModelProfile | null>();

/** Root of the profiles directory — relative to repo root.
 * Model IDs may contain provider prefixes (for example `x-ai/grok-4.1-fast`),
 * so join(PROFILES_DIR, modelId, 'profile.json') intentionally resolves nested directories.
 */
const PROFILES_DIR = resolve(join(import.meta.dirname ?? __dirname, '..', '..', 'model-profiles'));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and validate the model profile for a given deployment name.
 * Returns null if no profile exists for that model (graceful degradation).
 */
export function loadModelProfile(modelId: string): ModelProfile | null {
  if (profileCache.has(modelId)) {
    return profileCache.get(modelId) ?? null;
  }

  const profilePath = join(PROFILES_DIR, modelId, 'profile.json');

  if (!existsSync(profilePath)) {
    profileCache.set(modelId, null);
    return null;
  }

  const raw = readFileSync(profilePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const result = ModelProfileSchema.safeParse(parsed);

  if (!result.success) {
    console.error(`[profileLoader] Invalid profile for ${modelId}:`, result.error.format());
    profileCache.set(modelId, null);
    return null;
  }

  profileCache.set(modelId, result.data);
  return result.data;
}

/**
 * List all available model profile IDs (directory names under model-profiles/).
 */
export function listAvailableProfiles(): string[] {
  if (!existsSync(PROFILES_DIR)) {
    return [];
  }
  return readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => existsSync(join(PROFILES_DIR, d.name, 'profile.json')))
    .map(d => d.name);
}

/** Clear the cache (for testing / hot-reload) */
export function clearProfileCache(): void {
  profileCache.clear();
}
