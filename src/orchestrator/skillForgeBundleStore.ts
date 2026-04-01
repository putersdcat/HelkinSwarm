import { BlobServiceClient } from '@azure/storage-blob';
import { z } from 'zod';
import { getCredential } from '../auth/identity.js';
import { CapabilityManifestSchema } from '../capabilities/manifestSchema.js';
import { McpActivationGateSchema, McpLifecycleSnapshotSchema } from '../mcp/mcpOnboardingGates.js';

const CONTAINER_NAME = 'helkinswarm-skillforge';

export interface SkillForgePersistInput {
  userId: string;
  skillId: string;
  correlationId: string;
  payload: unknown;
}

let blobServiceClient: BlobServiceClient | undefined;
let containerInitPromise: Promise<void> | undefined;

const SkillForgeBundleFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  purpose: z.string().min(1),
});
export type SkillForgeBundleFile = z.infer<typeof SkillForgeBundleFileSchema>;

export const PersistedSkillForgeBundleSchema = z.object({
  skillId: z.string().min(1),
  displayName: z.string().min(1),
  branchName: z.string().min(1),
  reviewTitle: z.string().min(1),
  reviewBody: z.string().min(1),
  files: z.array(SkillForgeBundleFileSchema).min(1),
});

export type PersistedSkillForgeBundle = z.infer<typeof PersistedSkillForgeBundleSchema>;

export const PersistedMcpForgeBundleSchema = z.object({
  bundleKind: z.literal('mcpforge'),
  candidateName: z.string().min(1),
  draftSkillId: z.string().min(1),
  displayName: z.string().min(1),
  branchName: z.string().min(1).optional(),
  status: z.enum(['drafted', 'rejected', 'approved-local']),
  reviewTitle: z.string().min(1),
  reviewBody: z.string().min(1),
  evaluationSummary: z.string().min(1),
  uncertainties: z.array(z.string().min(1)),
  recommendedNextSteps: z.array(z.string().min(1)),
  candidateSnapshot: z.object({
    name: z.string().min(1),
    title: z.string().nullable(),
    description: z.string().min(1),
    latestVersion: z.string().min(1),
    status: z.enum(['active', 'deprecated', 'deleted']),
    statusMessage: z.string().nullable(),
    repositoryUrl: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    transportTypes: z.array(z.enum(['stdio', 'streamable-http', 'sse'])),
  }),
  activationGate: McpActivationGateSchema,
  lifecycle: McpLifecycleSnapshotSchema,
  smokeTest: z.object({
    passed: z.boolean(),
    toolCount: z.number().int().nonnegative(),
    toolNames: z.array(z.string().min(1)),
  }).optional(),
  localActivation: z.object({
    manifestPath: z.string().min(1),
    activatedAt: z.string().datetime(),
  }).optional(),
  files: z.array(SkillForgeBundleFileSchema).min(1),
});
export type PersistedMcpForgeBundle = z.infer<typeof PersistedMcpForgeBundleSchema>;

function getBlobServiceClient(): BlobServiceClient | undefined {
  if (blobServiceClient) {
    return blobServiceClient;
  }

  const connectionString = process.env['AzureWebJobsStorage'] ?? process.env['AZUREWEBJOBSSTORAGE'];
  if (connectionString) {
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    return blobServiceClient;
  }

  const accountName = process.env['AzureWebJobsStorage__accountName'];
  if (!accountName) {
    return undefined;
  }

  blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    getCredential(),
  );
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

export async function loadSkillForgeBundle(path: string): Promise<PersistedSkillForgeBundle> {
  const serviceClient = getBlobServiceClient();
  if (!serviceClient) {
    throw new Error('SkillForge bundle storage is not configured.');
  }

  if (!path.startsWith('bundles/')) {
    throw new Error(`Invalid SkillForge bundle path: ${path}`);
  }

  const blobClient = serviceClient
    .getContainerClient(CONTAINER_NAME)
    .getBlobClient(path);

  const download = await blobClient.download();
  const content = await streamToString(download.readableStreamBody);
  return PersistedSkillForgeBundleSchema.parse(JSON.parse(content) as unknown);
}

export async function loadMcpForgeBundle(path: string): Promise<PersistedMcpForgeBundle> {
  const serviceClient = getBlobServiceClient();
  if (!serviceClient) {
    throw new Error('SkillForge bundle storage is not configured.');
  }

  if (!path.startsWith('bundles/')) {
    throw new Error(`Invalid McpForge bundle path: ${path}`);
  }

  const blobClient = serviceClient
    .getContainerClient(CONTAINER_NAME)
    .getBlobClient(path);

  const download = await blobClient.download();
  const content = await streamToString(download.readableStreamBody);
  return PersistedMcpForgeBundleSchema.parse(JSON.parse(content) as unknown);
}

export function validatePromotableSkillForgeBundle(bundle: PersistedSkillForgeBundle): PersistedSkillForgeBundle {
  const manifestFile = bundle.files.find((file) => file.path.endsWith('/manifest.json'));
  if (!manifestFile) {
    throw new Error('SkillForge bundle does not include a manifest.json file.');
  }

  const manifest = CapabilityManifestSchema.parse(JSON.parse(manifestFile.content) as unknown);
  if (manifest.domain !== bundle.skillId) {
    throw new Error(`Bundle skillId '${bundle.skillId}' does not match manifest domain '${manifest.domain}'.`);
  }

  const skillDirPrefix = `skills/custom/${bundle.skillId}/`;
  const allowedTestPath = `tests/skills/${bundle.skillId}.test.ts`;
  for (const file of bundle.files) {
    const allowed = file.path.startsWith(skillDirPrefix) || file.path === allowedTestPath;
    if (!allowed) {
      throw new Error(`Bundle file path '${file.path}' is outside the SkillForge promotion allow-list.`);
    }
  }

  const nonConfirmingTools = manifest.tools.filter((tool) => tool.requiresConfirmation !== true);
  if (nonConfirmingTools.length > 0) {
    throw new Error(
      `SkillForge promotion requires all generated tools to stay confirmation-gated until review. Offending tools: ${nonConfirmingTools.map((tool) => tool.name).join(', ')}`,
    );
  }

  return bundle;
}

async function streamToString(stream: NodeJS.ReadableStream | null | undefined): Promise<string> {
  if (!stream) {
    throw new Error('SkillForge bundle download returned an empty stream.');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}