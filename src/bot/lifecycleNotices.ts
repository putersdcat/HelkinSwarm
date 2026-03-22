// Lifecycle Notices — startup/shutdown proactive messages to the owner.
// Fix: #142
// Spec ref: docs/ADDENDA/ADDENDA-05-Auth-Identity-Layer-OBO-Token-Minting-and-Emergency-Stop.md

/* eslint-disable no-console */

import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ActivityTypes,
} from 'botbuilder';
import type { ConversationReference } from 'botbuilder';
import { getEnvConfig } from '../config/envConfig.js';
import { getConversationReference } from './conversationStore.js';

// ---------------------------------------------------------------------------
// Cold-start guard: block message processing for 3s after container start
// ---------------------------------------------------------------------------

const COLD_START_WINDOW_MS = 3_000;
const containerStartTime = Date.now();

/** Returns true while the container is in its cold-start window. */
export function isColdStarting(): boolean {
  return Date.now() - containerStartTime < COLD_START_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Proactive messaging adapter (separate from sendReplyActivity's instance)
// ---------------------------------------------------------------------------

let adapterInstance: CloudAdapter | undefined;

function getAdapter(): CloudAdapter {
  if (!adapterInstance) {
    const env = getEnvConfig();
    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: env.microsoftAppId,
      MicrosoftAppType: 'UserAssignedMSI',
      MicrosoftAppTenantId: env.microsoftAppTenantId,
    });
    adapterInstance = new CloudAdapter(auth);
  }
  return adapterInstance;
}

async function sendProactiveMessage(message: string): Promise<void> {
  const env = getEnvConfig();
  const ownerUserId = env.ownerUserId;
  if (!ownerUserId) {
    console.warn('[lifecycle] No OWNER_USER_ID configured — cannot send lifecycle notice');
    return;
  }

  const conversationReference = await getConversationReference(ownerUserId);
  if (!conversationReference) {
    console.warn('[lifecycle] No ConversationReference for owner — cannot send lifecycle notice');
    return;
  }

  const adapter = getAdapter();
  const appId = env.microsoftAppId;

  await adapter.continueConversationAsync(
    appId,
    conversationReference as ConversationReference,
    async (turnContext) => {
      await turnContext.sendActivity({
        type: ActivityTypes.Message,
        text: message,
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Startup notice — called once after container ready
// ---------------------------------------------------------------------------

let startupSent = false;

/** Send a startup notice to the owner. Call this from the Functions entry point. */
export async function sendStartupNotice(): Promise<void> {
  if (startupSent) return;
  startupSent = true;

  const version = process.env.HELKINSWARM_VERSION ?? 'dev';
  const startTime = new Date().toISOString();
  const message = `🟢 **HelkinSwarm Online**\n\nVersion: ${version}\nStarted: ${startTime}\nReady to assist.`;

  try {
    await sendProactiveMessage(message);
    console.log('[lifecycle] Startup notice sent to owner');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lifecycle] Failed to send startup notice: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Shutdown notice — registered on SIGTERM/SIGINT
// ---------------------------------------------------------------------------

let shutdownSent = false;

/** Send the shutdown notice to the owner. Idempotent — only sends once. */
export async function sendShutdownNotice(): Promise<void> {
  if (shutdownSent) return;
  shutdownSent = true;

  const message = '🔴 HelkinSwarm shutting down — a new version is deploying. In-flight work will complete.';

  try {
    await sendProactiveMessage(message);
    console.log('[lifecycle] Shutdown notice sent to owner');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lifecycle] Failed to send shutdown notice: ${msg}`);
  }
}
