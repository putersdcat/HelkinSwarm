// Cosmos DB client — singleton, UAMI-authenticated.
// Spec ref: 07-Memory-Manager.md

import { CosmosClient } from '@azure/cosmos';
import { getCredential } from '../auth/identity.js';

const COSMOS_ENDPOINT = process.env['COSMOS_ENDPOINT'] ?? '';
const COSMOS_DATABASE = process.env['COSMOS_DATABASE'] ?? 'helkinswarm';

let _client: CosmosClient | undefined;

export function getCosmosClient(): CosmosClient {
  if (!_client) {
    if (!COSMOS_ENDPOINT) {
      throw new Error('COSMOS_ENDPOINT environment variable is not set');
    }
    _client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: getCredential() });
  }
  return _client;
}

export function getDatabase() {
  return getCosmosClient().database(COSMOS_DATABASE);
}

export function getContainer(containerName: string) {
  return getDatabase().container(containerName);
}
