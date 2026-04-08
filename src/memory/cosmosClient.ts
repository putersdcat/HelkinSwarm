// Cosmos DB client — singleton, UAMI-authenticated.
// Spec ref: 07-Memory-Manager.md

import { CosmosClient } from '@azure/cosmos';
import { getBoundedCredential } from '../auth/identity.js';
import { getEnvConfig } from '../config/envConfig.js';

let _client: CosmosClient | undefined;

// Hard cap on every Cosmos SDK request to prevent indefinite hangs in oboSessionStore,
// msalCachePlugin, storeMemoryActivity, and any other Cosmos callers (#591 part 3).
// The SDK default is 60 000 ms; even a brief connectivity blip can block a Durable
// activity for a full minute, creating 4-minute+ tool-call hangs.
const COSMOS_REQUEST_TIMEOUT_MS = 10_000;

export function getCosmosClient(): CosmosClient {
  if (!_client) {
    const endpoint = getEnvConfig().cosmosEndpoint;
    if (!endpoint) {
      throw new Error('COSMOS_ENDPOINT environment variable is not set');
    }
    // Use getBoundedCredential to ensure token acquisition has a hard timeout (#327).
    // The raw credential's getToken() has no timeout, which can hang the entire
    // activity when the Managed Identity endpoint is slow.
    _client = new CosmosClient({
      endpoint,
      aadCredentials: getBoundedCredential(),
      connectionPolicy: { requestTimeout: COSMOS_REQUEST_TIMEOUT_MS },
    });
  }
  return _client;
}

export function getDatabase() {
  return getCosmosClient().database(getEnvConfig().cosmosDatabase);
}

export function getContainer(containerName: string) {
  return getDatabase().container(containerName);
}
