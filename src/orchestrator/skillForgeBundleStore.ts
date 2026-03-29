import { BlobServiceClient } from '@azure/storage-blob';

const CONTAINER_NAME = 'helkinswarm-skillforge';

export interface SkillForgePersistInput {
  userId: string;
  skillId: string;
  correlationId: string;
  payload: unknown;
}

let blobServiceClient: BlobServiceClient | undefined;
let containerInitPromise: Promise<void> | undefined;

function getBlobServiceClient(): BlobServiceClient | undefined {
  if (blobServiceClient) {
    return blobServiceClient;
  }

  const connectionString = process.env['AzureWebJobsStorage'] ?? process.env['AZUREWEBJOBSSTORAGE'];
  if (!connectionString) {
    return undefined;
  }

  blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient;
}

async function ensureContainer(): Promise<boolean> {
  const serviceClient = getBlobServiceClient();
  if (!serviceClient) {
    return false;
  }

  if (!containerInitPromise) {
    containerInitPromise = serviceClient
      .getContainerClient(CONTAINER_NAME)
      .createIfNotExists()
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn('[skillForgeBundleStore] Failed to initialize bundle container:', error);
        containerInitPromise = undefined;
      });
  }

  await containerInitPromise;
  return true;
}

export async function persistSkillForgeBundle(input: SkillForgePersistInput): Promise<string | null> {
  const containerReady = await ensureContainer();
  if (!containerReady) {
    return null;
  }

  const path = `bundles/${input.userId}/${input.skillId}/${input.correlationId}.json`;

  try {
    const blobClient = getBlobServiceClient()!
      .getContainerClient(CONTAINER_NAME)
      .getBlockBlobClient(path);

    const content = JSON.stringify(input.payload, null, 2);
    await blobClient.upload(content, Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });

    return path;
  } catch (error: unknown) {
    console.warn('[skillForgeBundleStore] Failed to persist bundle:', error);
    return null;
  }
}