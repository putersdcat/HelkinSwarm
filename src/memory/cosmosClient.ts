// Cosmos DB client — singleton, UAMI-authenticated.
// Spec ref: 07-Memory-Manager.md

import { CosmosClient } from '@azure/cosmos';
import { getCredential } from '../auth/identity.js';
import { getEnvConfig } from '../config/envConfig.js';

let _client: CosmosClient | undefined;

export function getCosmosClient(): CosmosClient {
  if (!_client) {
    const endpoint = getEnvConfig().cosmosEndpoint;
    if (!endpoint) {
      throw new Error('COSMOS_ENDPOINT environment variable is not set');
    }
    _client = new CosmosClient({ endpoint, aadCredentials: getCredential() });
  }
  return _client;
}

export function getDatabase() {
  return getCosmosClient().database(getEnvConfig().cosmosDatabase);
}

export function getContainer(containerName: string) {
  return getDatabase().container(containerName);
}
