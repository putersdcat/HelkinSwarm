// Maintenance mode store — persists global emergency-stop state in Cosmos DB.
// Spec ref: 10-Teams-Interface.md, 04-Safety-Architecture.md

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getContainer } from '../memory/cosmosClient.js';

const CONTAINER_NAME = 'runtimeConfig';
const DOC_ID = 'maintenance-mode';
const SCOPE = 'global';

interface MaintenanceModeDocument {
  id: string;
  scope: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
  reason?: string;
}

async function loadOwnerUserId(): Promise<string> {
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
  return userId === (await loadOwnerUserId());
}

export async function getMaintenanceMode(): Promise<MaintenanceModeDocument> {
  const container = getContainer(CONTAINER_NAME);
  try {
    const { resource } = await container
      .item(DOC_ID, SCOPE)
      .read<MaintenanceModeDocument>();

    if (resource) {
      return resource;
    }
  } catch {
    // First run — create default doc below.
  }

  const initial: MaintenanceModeDocument = {
    id: DOC_ID,
    scope: SCOPE,
    enabled: false,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };
  await container.items.upsert(initial);
  return initial;
}

export async function setMaintenanceMode(input: {
  enabled: boolean;
  updatedBy: string;
  reason?: string;
}): Promise<MaintenanceModeDocument> {
  const container = getContainer(CONTAINER_NAME);
  const doc: MaintenanceModeDocument = {
    id: DOC_ID,
    scope: SCOPE,
    enabled: input.enabled,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
    reason: input.reason,
  };
  await container.items.upsert(doc);
  return doc;
}
