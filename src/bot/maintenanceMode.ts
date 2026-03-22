// Maintenance mode store — persists global emergency-stop / maintenance state in Cosmos DB.
// Fix: #149 — separates emergency-stop from deploy-cycle maintenance.
// Spec ref: 10-Teams-Interface.md, 04-Safety-Architecture.md

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getContainer } from '../memory/cosmosClient.js';
import { getEnvConfig } from '../config/envConfig.js';

const CONTAINER_NAME = 'runtimeConfig';
const DOC_ID = 'maintenance-mode';
const SCOPE = 'global';

// ---------------------------------------------------------------------------
// In-memory startup override (#145)
// During a fresh container start, Cosmos may still hold enabled=true from
// the previous container's graceful shutdown.  The startup clear is async
// and may not finish before the first message arrives.  We keep an in-memory
// flag that short-circuits the Cosmos read until the clear succeeds.
//
// (#149) When an active emergency-stop is detected during startup, we flip
// _startupClearPending=false WITHOUT clearing the doc so the Cosmos-backed
// enabled=true blocks messages correctly.
// ---------------------------------------------------------------------------
let _startupClearPending = true;

export interface MaintenanceModeDocument {
  id: string;
  scope: string;
  enabled: boolean;
  /** Distinguishes a deliberate e-stop from deploy-induced maintenance. */
  source: 'emergency-stop' | 'system';
  updatedAt: string;
  updatedBy: string;
  reason?: string;
}

async function loadOwnerUserId(): Promise<string> {
  const ownerFromEnv = getEnvConfig().ownerUserId;
  if (ownerFromEnv) {
    return ownerFromEnv;
  }

  const mapPath = join(process.cwd(), 'config', 'user-map.json');
  const raw = await readFile(mapPath, 'utf-8');
  const parsed = JSON.parse(raw) as {
    users?: Record<string, unknown>;
  };
  const ownerUserId = Object.keys(parsed.users ?? {})[0];
  if (!ownerUserId) {
    throw new Error('No owner userId found in config/user-map.json');
  }
  return ownerUserId;
}

export async function isOwnerUserId(userId: string): Promise<boolean> {
  // Runtime owner checks prefer the stamped environment variable in Azure and
  // only fall back to config/user-map.json for local development scenarios.
  return userId === (await loadOwnerUserId());
}

/**
 * Signal that the startup clear logic has completed (or was intentionally skipped
 * because an active e-stop was detected). After this call, getMaintenanceMode()
 * reads from Cosmos instead of returning the optimistic in-memory override.
 */
export function markStartupClearComplete(): void {
  _startupClearPending = false;
}

export async function getMaintenanceMode(): Promise<MaintenanceModeDocument> {
  // If we just started and haven't confirmed the clear, assume NOT in
  // maintenance so incoming messages aren't blocked (#145).
  if (_startupClearPending) {
    return {
      id: DOC_ID,
      scope: SCOPE,
      enabled: false,
      source: 'system',
      updatedAt: new Date().toISOString(),
      updatedBy: 'startup-override',
    };
  }

  return getMaintenanceModeFromCosmos();
}

/**
 * Raw Cosmos read — bypasses the in-memory startup override.
 * Used by clearMaintenanceWithRetry() to detect active e-stops on startup.
 */
export async function getMaintenanceModeFromCosmos(): Promise<MaintenanceModeDocument> {
  const container = getContainer(CONTAINER_NAME);
  try {
    const { resource } = await container
      .item(DOC_ID, SCOPE)
      .read<MaintenanceModeDocument>();

    if (resource) {
      // Backfill source for pre-#149 docs that lack the field
      return { ...resource, source: resource.source ?? 'system' };
    }
  } catch {
    // First run — create default doc below.
  }

  const initial: MaintenanceModeDocument = {
    id: DOC_ID,
    scope: SCOPE,
    enabled: false,
    source: 'system',
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };
  await container.items.upsert(initial);
  return initial;
}

export async function setMaintenanceMode(input: {
  enabled: boolean;
  updatedBy: string;
  source?: 'emergency-stop' | 'system';
  reason?: string;
}): Promise<MaintenanceModeDocument> {
  const container = getContainer(CONTAINER_NAME);
  const doc: MaintenanceModeDocument = {
    id: DOC_ID,
    scope: SCOPE,
    enabled: input.enabled,
    source: input.source ?? 'system',
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
    reason: input.reason,
  };
  await container.items.upsert(doc);

  // Once any successful write lands, the startup override is no longer needed.
  _startupClearPending = false;

  return doc;
}
