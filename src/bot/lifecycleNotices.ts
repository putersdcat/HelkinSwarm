// Lifecycle Notices — startup/shutdown proactive messages to the owner.
// Fix: #142, #149 (Cosmos-based dedup to prevent spam during rolling deploys)
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
import { getContainer } from '../memory/cosmosClient.js';

// ---------------------------------------------------------------------------
// Cold-start guard: block message processing for 3s after container start
// ---------------------------------------------------------------------------

const COLD_START_WINDOW_MS = 3_000;
const containerStartTime = Date.now();

/** Returns true while the container is in its cold-start window. */
export function isColdStarting(): boolean {
  return Date.now() - containerStartTime < COLD_START_WINDOW_MS;
}

/** Returns the current process uptime in milliseconds since the container started. */
export function getContainerAgeMs(nowMs = Date.now()): number {
  return Math.max(0, nowMs - containerStartTime);
}

// ---------------------------------------------------------------------------
// Cosmos-based deduplication (#149)
// During rolling deploys, multiple containers may try to send the same notice.
// We store a timestamp per notice type in Cosmos and skip if a notice of the
// same type was sent within the dedup window.
// ---------------------------------------------------------------------------

const DEDUP_WINDOW_MS = 10 * 60_000; // 10 minutes — suppress repeated chatter during a single rolling deploy
const LIFECYCLE_DOC_ID = 'lifecycle-notices';
const LIFECYCLE_SCOPE = 'global';

interface LifecycleNoticeDoc {
  id: string;
  scope: string;
  lastStartupAt?: string;
  lastShutdownAt?: string;
}

async function shouldSendNotice(type: 'startup' | 'shutdown'): Promise<boolean> {
  const container = getContainer('runtimeConfig');
  const field = type === 'startup' ? 'lastStartupAt' : 'lastShutdownAt';
  let existingDoc: LifecycleNoticeDoc | undefined;

  try {
    const { resource } = await container
      .item(LIFECYCLE_DOC_ID, LIFECYCLE_SCOPE)
      .read<LifecycleNoticeDoc>();

    if (resource) {
      existingDoc = resource;
      const lastSent = resource[field];
      if (lastSent) {
        const elapsed = Date.now() - new Date(lastSent).getTime();
        if (elapsed < DEDUP_WINDOW_MS) {
          console.log(`[lifecycle] ${type} notice suppressed — another sent ${elapsed}ms ago`);
          return false;
        }
      }
    }
  } catch {
    // Doc doesn't exist yet — allow the notice.
  }

  // Record that we're sending now (upsert to handle first-run)
  try {
    const now = new Date().toISOString();
    const doc: LifecycleNoticeDoc = {
      ...existingDoc,
      id: LIFECYCLE_DOC_ID,
      scope: LIFECYCLE_SCOPE,
      [field]: now,
    };
    await container.items.upsert(doc);
  } catch (err: unknown) {
    // Best-effort — don't block the notice if Cosmos fails
    console.warn(`[lifecycle] Failed to write dedup doc: ${err}`);
  }

  return true;
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

export function buildStartupNoticeMessage(startTime: string): string {
  return [
    '🟢 **HelkinSwarm Runtime Online**',
    '',
    `Started: ${startTime}`,
    'Inbound Teams delivery is still being verified on this fresh runtime.',
    'If your next message gets no reply within about a minute, resend it.',
  ].join('\n');
}

/** Send a startup notice to the owner. Call this from the Functions entry point. */
export async function sendStartupNotice(): Promise<void> {
  if (startupSent) return;
  startupSent = true;
  // Cosmos-based dedup: skip if another container already sent this recently.
  if (!(await shouldSendNotice('startup'))) return;
  const startTime = new Date().toISOString();
  const message = buildStartupNoticeMessage(startTime);

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

  // Cosmos-based dedup: skip if another container already sent this recently.
  if (!(await shouldSendNotice('shutdown'))) return;

  const message = '🔴 HelkinSwarm shutting down — a new version is deploying. In-flight work will complete.';

  try {
    await sendProactiveMessage(message);
    console.log('[lifecycle] Shutdown notice sent to owner');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[lifecycle] Failed to send shutdown notice: ${msg}`);
  }
}
