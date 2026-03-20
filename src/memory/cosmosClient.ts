// Cosmos DB client — singleton, UAMI-authenticated.
// Spec ref: 07-Memory-Manager.md

import { CosmosClient } from '@azure/cosmos';
import { ManagedIdentityCredential } from '@azure/identity';

const COSMOS_ENDPOINT = process.env['COSMOS_ENDPOINT'] ?? '';
const COSMOS_DATABASE = process.env['COSMOS_DATABASE'] ?? 'helkinswarm';
const AZURE_CLIENT_ID = process.env['AZURE_CLIENT_ID'];

let _client: CosmosClient | undefined;

export function getCosmosClient(): CosmosClient {
  if (!_client) {
    if (!COSMOS_ENDPOINT) {
      throw new Error('COSMOS_ENDPOINT environment variable is not set');
    }
    const credential = AZURE_CLIENT_ID
      ? new ManagedIdentityCredential({ clientId: AZURE_CLIENT_ID })
      : new ManagedIdentityCredential();
    _client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: credential });
  }
  return _client;
}

export function getDatabase() {
  return getCosmosClient().database(COSMOS_DATABASE);
}

export function getContainer(containerName: string) {
  return getDatabase().container(containerName);
}
