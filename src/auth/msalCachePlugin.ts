// MSAL Cosmos-backed token cache plugin — persists OBO tokens across container restarts.
// Spec ref: 11-Authentication-Identity.md, Issue #30
// Implements ICachePlugin for @azure/msal-node ConfidentialClientApplication.

import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { getContainer } from '../memory/cosmosClient.js';

const CONTAINER_NAME = 'msalTokenCache'; // dedicated container with 24h TTL
const CACHE_DOC_PREFIX = 'msal-cache-';

/**
 * Cosmos DB-backed MSAL token cache plugin.
 * Stores encrypted MSAL cache blobs per userId in the userProfiles container.
 * Partition key is userId — same as the user profile documents.
 */
export function createCosmosCachePlugin(userId: string): ICachePlugin {
  const container = getContainer(CONTAINER_NAME);
  const docId = `${CACHE_DOC_PREFIX}${userId}`;

  return {
    async beforeCacheAccess(context: TokenCacheContext): Promise<void> {
      try {
        const { resource } = await container.item(docId, userId).read<{ cacheBlob: string }>();
        if (resource?.cacheBlob) {
          context.tokenCache.deserialize(resource.cacheBlob);
        }
      } catch (err: unknown) {
        // 404 = no cache yet — normal for first-time users
        if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
          return;
        }
        console.error('[msalCachePlugin] Failed to read cache from Cosmos:', err);
      }
    },

    async afterCacheAccess(context: TokenCacheContext): Promise<void> {
      if (!context.cacheHasChanged) return;

      try {
        const cacheBlob = context.tokenCache.serialize();
        await container.items.upsert({
          id: docId,
          userId,
          cacheBlob,
          type: 'msal-cache',
          updatedAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        console.error('[msalCachePlugin] Failed to write cache to Cosmos:', err);
      }
    },
  };
}
