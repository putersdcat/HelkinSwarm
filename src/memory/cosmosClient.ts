// Cosmos DB client — singleton, UAMI-authenticated.
// Spec ref: 07-Memory-Manager.md

import { CosmosClient } from '@azure/cosmos';
import { getBoundedCredential } from '../auth/identity.js';
import { getEnvConfig } from '../config/envConfig.js';

let _client: CosmosClient | undefined;

export function getCosmosClient(): CosmosClient {
  if (!_client) {
    const endpoint = getEnvConfig().cosmosEndpoint;
    if (!endpoint) {
      throw new Error('COSMOS_ENDPOINT environment variable is not set');
    }
    // Use getBoundedCredential to ensure token acquisition has a hard timeout (#327).
    // The raw credential's getToken() has no timeout, which can hang the entire
    // activity when the Managed Identity endpoint is slow.
    _client = new CosmosClient({ endpoint, aadCredentials: getBoundedCredential() });
  }
  return _client;
}

export function getDatabase() {
  return getCosmosClient().database(getEnvConfig().cosmosDatabase);
}

export function getContainer(containerName: string) {
  return getDatabase().container(containerName);
}
