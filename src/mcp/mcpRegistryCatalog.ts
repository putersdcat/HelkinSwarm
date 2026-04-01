import { z } from 'zod';
import { getManifest } from '../capabilities/capabilityLoader.js';
import { assessMcpCandidateForOnboarding, draftSkillIdForCandidate, type McpActivationGate } from './mcpOnboardingGates.js';

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

const TransportTypeSchema = z.enum(['stdio', 'streamable-http', 'sse']);

const PackageSummarySchema = z.object({
  registryType: z.string().min(1),
  identifier: z.string().min(1),
  version: z.string().min(1).optional(),
  transportType: TransportTypeSchema,
  runtimeHint: z.string().min(1).optional(),
  registryBaseUrl: z.string().url().optional(),
});

const RemoteSummarySchema = z.object({
  transportType: z.enum(['streamable-http', 'sse']),
  url: z.string().min(1),
});

export const McpRegistryCandidateSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1).nullable(),
  description: z.string().min(1),
  latestVersion: z.string().min(1),
  status: z.enum(['active', 'deprecated', 'deleted']).default('active'),
  statusMessage: z.string().min(1).nullable(),
  repositoryUrl: z.string().url().nullable(),
  websiteUrl: z.string().url().nullable(),
  publishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
  packageSummaries: z.array(PackageSummarySchema),
  remoteSummaries: z.array(RemoteSummarySchema),
  transportTypes: z.array(TransportTypeSchema),
  searchableText: z.string().min(1),
});

export type McpRegistryCandidate = z.infer<typeof McpRegistryCandidateSchema>;

export type McpRegistrySearchResult = {
  generatedAt: string | null;
  query: string;
  usedStaleCache: boolean;
  searchPerformedAt: string;
  syncStatus: McpRegistryCatalogStatus;
  excluded: {
    deleted: number;
    malformed: number;
  };
  candidates: Array<McpRegistryCandidate & {
    score: number;
    matchReasons: string[];
    currentState: 'discovered' | 'review-required' | 'blocked' | 'enabled';
    activationGate: McpActivationGate;
  }>;
};

export type McpRegistryCatalogStatus = {
  status: 'cold' | 'ready' | 'stale' | 'error';
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  lastSyncMode: 'full' | 'incremental' | null;
  totalCached: number;
  searchable: number;
  active: number;
  deprecated: number;
  deleted: number;
  malformedDropped: number;
  staleAfterMs: number;
  lastError: string | null;
};

type MutableCatalogState = {
  entries: Map<string, McpRegistryCandidate>;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  lastSyncMode: 'full' | 'incremental' | null;
  malformedDropped: number;
  lastError: string | null;
  syncPromise: Promise<McpRegistryCatalogStatus> | null;
};

const catalogState: MutableCatalogState = {
  entries: new Map<string, McpRegistryCandidate>(),
  lastSuccessfulSyncAt: null,
  lastAttemptAt: null,
  lastSyncMode: null,
  malformedDropped: 0,
  lastError: null,
  syncPromise: null,
};

const RawServerListResponseSchema = z.object({
  servers: z.array(z.unknown()),
  metadata: z.object({
    nextCursor: z.string().optional().nullable(),
    count: z.number().int().nonnegative().optional(),
  }).optional(),
});

export async function ensureFreshMcpRegistryCatalog(options: { forceFull?: boolean } = {}): Promise<McpRegistryCatalogStatus> {
  const now = Date.now();
  const lastSyncedMs = catalogState.lastSuccessfulSyncAt ? Date.parse(catalogState.lastSuccessfulSyncAt) : 0;
  const shouldSync = options.forceFull
    || catalogState.entries.size === 0
    || !catalogState.lastSuccessfulSyncAt
    || (now - lastSyncedMs) >= DEFAULT_SYNC_INTERVAL_MS;

  if (!shouldSync) {
    return getMcpRegistryCatalogStatus();
  }

  if (catalogState.syncPromise) {
    return catalogState.syncPromise;
  }

  const syncPromise = syncCatalog({ forceFull: options.forceFull ?? false })
    .finally(() => {
      catalogState.syncPromise = null;
    });
  catalogState.syncPromise = syncPromise;
  return syncPromise;
}

export async function searchMcpRegistryCatalog(
  query: string,
  options: {
    limit?: number;
    includeDeleted?: boolean;
    includeDeprecated?: boolean;
    forceRefresh?: boolean;
  } = {},
): Promise<McpRegistrySearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error('query is required for MCP Registry search.');
  }

  let usedStaleCache = false;
  try {
    await ensureFreshMcpRegistryCatalog({ forceFull: options.forceRefresh ?? false });
  } catch {
    if (catalogState.entries.size === 0) {
      throw new Error(getMcpRegistryCatalogStatus().lastError ?? 'MCP Registry catalog sync failed with no cached data available.');
    }
    usedStaleCache = true;
  }

  const normalizedTokens = tokenize(trimmedQuery);
  const limit = options.limit ?? 8;
  const includeDeleted = options.includeDeleted ?? false;
  const includeDeprecated = options.includeDeprecated ?? true;

  const candidates = Array.from(catalogState.entries.values())
    .filter((candidate) => includeDeleted || candidate.status !== 'deleted')
    .filter((candidate) => includeDeprecated || candidate.status !== 'deprecated')
    .map((candidate) => buildCandidateHit(candidate, normalizedTokens))
    .filter((candidate): candidate is McpRegistryCandidate & { score: number; matchReasons: string[] } => candidate !== null)
    .map((candidate) => {
      const skillId = draftSkillIdForCandidate(candidate.name);
      const installedSkillId = getManifest(skillId) ? skillId : null;
      const assessment = assessMcpCandidateForOnboarding(candidate, { installedSkillId });
      return {
        ...candidate,
        currentState: assessment.currentState,
        activationGate: assessment.activationGate,
      };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);

  return {
    generatedAt: catalogState.lastSuccessfulSyncAt,
    query: trimmedQuery,
    usedStaleCache,
    searchPerformedAt: new Date().toISOString(),
    syncStatus: getMcpRegistryCatalogStatus(),
    excluded: {
      deleted: Array.from(catalogState.entries.values()).filter((candidate) => candidate.status === 'deleted').length,
      malformed: catalogState.malformedDropped,
    },
    candidates,
  };
}

export function getMcpRegistryCatalogStatus(): McpRegistryCatalogStatus {
  const now = Date.now();
  const lastSyncMs = catalogState.lastSuccessfulSyncAt ? Date.parse(catalogState.lastSuccessfulSyncAt) : 0;
  const isStale = !!lastSyncMs && (now - lastSyncMs) >= DEFAULT_SYNC_INTERVAL_MS;
  const entries = Array.from(catalogState.entries.values());

  let status: McpRegistryCatalogStatus['status'];
  if (catalogState.lastError && entries.length === 0) {
    status = 'error';
  } else if (!catalogState.lastSuccessfulSyncAt) {
    status = 'cold';
  } else if (isStale) {
    status = 'stale';
  } else {
    status = 'ready';
  }

  return {
    status,
    lastSuccessfulSyncAt: catalogState.lastSuccessfulSyncAt,
    lastAttemptAt: catalogState.lastAttemptAt,
    lastSyncMode: catalogState.lastSyncMode,
    totalCached: entries.length,
    searchable: entries.filter((entry) => entry.status !== 'deleted').length,
    active: entries.filter((entry) => entry.status === 'active').length,
    deprecated: entries.filter((entry) => entry.status === 'deprecated').length,
    deleted: entries.filter((entry) => entry.status === 'deleted').length,
    malformedDropped: catalogState.malformedDropped,
    staleAfterMs: DEFAULT_SYNC_INTERVAL_MS,
    lastError: catalogState.lastError,
  };
}

export function getMcpRegistryCandidate(name: string): McpRegistryCandidate | undefined {
  return catalogState.entries.get(name);
}

export function resetMcpRegistryCatalogForTests(): void {
  catalogState.entries.clear();
  catalogState.lastSuccessfulSyncAt = null;
  catalogState.lastAttemptAt = null;
  catalogState.lastSyncMode = null;
  catalogState.malformedDropped = 0;
  catalogState.lastError = null;
  catalogState.syncPromise = null;
}

async function syncCatalog(options: { forceFull: boolean }): Promise<McpRegistryCatalogStatus> {
  const mode: 'full' | 'incremental' = options.forceFull || !catalogState.lastSuccessfulSyncAt ? 'full' : 'incremental';
  catalogState.lastAttemptAt = new Date().toISOString();

  try {
    const fetchedServers = await fetchRegistryServers(mode === 'incremental' ? catalogState.lastSuccessfulSyncAt : null);
    if (mode === 'full') {
      catalogState.entries.clear();
      catalogState.malformedDropped = 0;
    }

    for (const server of fetchedServers.parsed) {
      catalogState.entries.set(server.name, server);
    }

    catalogState.malformedDropped += fetchedServers.malformedDropped;
    catalogState.lastSuccessfulSyncAt = new Date().toISOString();
    catalogState.lastSyncMode = mode;
    catalogState.lastError = null;
    return getMcpRegistryCatalogStatus();
  } catch (error) {
    catalogState.lastSyncMode = mode;
    catalogState.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

async function fetchRegistryServers(updatedSince: string | null): Promise<{
  parsed: McpRegistryCandidate[];
  malformedDropped: number;
}> {
  const parsed: McpRegistryCandidate[] = [];
  let malformedDropped = 0;
  let cursor: string | null = null;

  do {
    const url = new URL('/v0.1/servers', REGISTRY_BASE_URL);
    url.searchParams.set('version', 'latest');
    url.searchParams.set('limit', String(DEFAULT_PAGE_LIMIT));
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }
    if (updatedSince) {
      url.searchParams.set('updated_since', updatedSince);
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`MCP Registry sync failed: ${response.status} ${response.statusText}`);
    }

    const json = RawServerListResponseSchema.parse(await response.json());

    for (const rawServer of json.servers) {
      const parsedServer = parseServerCandidate(rawServer);
      if (parsedServer) {
        parsed.push(parsedServer);
      } else {
        malformedDropped++;
      }
    }

    cursor = json.metadata?.nextCursor ?? null;
  } while (cursor);

  return { parsed, malformedDropped };
}

function parseServerCandidate(rawServer: unknown): McpRegistryCandidate | null {
  const candidate = extractServerCandidate(rawServer);
  if (!candidate) {
    return null;
  }

  const parsed = McpRegistryCandidateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function extractServerCandidate(rawServer: unknown): Omit<McpRegistryCandidate, 'searchableText'> & { searchableText: string } | null {
  if (!rawServer || typeof rawServer !== 'object') {
    return null;
  }

  const envelope = rawServer as Record<string, unknown>;
  const server = envelope['server'];
  const meta = envelope['_meta'];
  if (!server || typeof server !== 'object') {
    return null;
  }

  const serverRecord = server as Record<string, unknown>;
  const officialMeta = isRecord(meta)
    ? meta['io.modelcontextprotocol.registry/official']
    : undefined;
  const officialMetaRecord = isRecord(officialMeta) ? officialMeta : undefined;

  const name = readString(serverRecord['name']);
  const description = readString(serverRecord['description']);
  const latestVersion = readString(serverRecord['version']);
  if (!name || !description || !latestVersion) {
    return null;
  }

  const packageSummaries = extractPackageSummaries(serverRecord['packages']);
  const remoteSummaries = extractRemoteSummaries(serverRecord['remotes']);
  const transportTypes = Array.from(new Set([
    ...packageSummaries.map((pkg) => pkg.transportType),
    ...remoteSummaries.map((remote) => remote.transportType),
  ]));

  if (packageSummaries.length === 0 && remoteSummaries.length === 0) {
    return null;
  }

  const title = readNullableString(serverRecord['title']);
  const repositoryUrl = isRecord(serverRecord['repository'])
    ? readNullableUrl(serverRecord['repository']['url'])
    : null;
  const websiteUrl = readNullableUrl(serverRecord['websiteUrl']);
  const status = readStatus(officialMetaRecord?.['status']);
  const statusMessage = officialMetaRecord ? readNullableString(officialMetaRecord['statusMessage']) : null;
  const publishedAt = officialMetaRecord ? readNullableDateTime(officialMetaRecord['publishedAt']) : null;
  const updatedAt = officialMetaRecord ? readNullableDateTime(officialMetaRecord['updatedAt']) : null;

  const searchableText = [
    name,
    title,
    description,
    websiteUrl,
    repositoryUrl,
    ...packageSummaries.map((pkg) => pkg.identifier),
    ...packageSummaries.map((pkg) => pkg.registryType),
    ...transportTypes,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ').toLowerCase();

  return {
    name,
    title,
    description,
    latestVersion,
    status,
    statusMessage,
    repositoryUrl,
    websiteUrl,
    publishedAt,
    updatedAt,
    packageSummaries,
    remoteSummaries,
    transportTypes,
    searchableText,
  };
}

function extractPackageSummaries(rawPackages: unknown): Array<z.infer<typeof PackageSummarySchema>> {
  if (!Array.isArray(rawPackages)) {
    return [];
  }

  return rawPackages
    .map((rawPackage) => {
      if (!isRecord(rawPackage)) {
        return null;
      }

      const transport = rawPackage['transport'];
      const transportType = isRecord(transport) ? readTransportType(transport['type']) : null;
      const registryType = readString(rawPackage['registryType']);
      const identifier = readString(rawPackage['identifier']);
      const version = readNullableString(rawPackage['version']);
      const runtimeHint = readNullableString(rawPackage['runtimeHint']);
      const registryBaseUrl = readNullableUrl(rawPackage['registryBaseUrl']);

      if (!transportType || !registryType || !identifier) {
        return null;
      }

      const parsed = PackageSummarySchema.safeParse({
        registryType,
        identifier,
        ...(version ? { version } : {}),
        transportType,
        ...(runtimeHint ? { runtimeHint } : {}),
        ...(registryBaseUrl ? { registryBaseUrl } : {}),
      });
      return parsed.success ? parsed.data : null;
    })
    .filter((value): value is z.infer<typeof PackageSummarySchema> => value !== null);
}

function extractRemoteSummaries(rawRemotes: unknown): Array<z.infer<typeof RemoteSummarySchema>> {
  if (!Array.isArray(rawRemotes)) {
    return [];
  }

  return rawRemotes
    .map((rawRemote) => {
      if (!isRecord(rawRemote)) {
        return null;
      }

      const transportType = readRemoteTransportType(rawRemote['type']);
      const url = readString(rawRemote['url']);
      if (!transportType || !url) {
        return null;
      }

      const parsed = RemoteSummarySchema.safeParse({ transportType, url });
      return parsed.success ? parsed.data : null;
    })
    .filter((value): value is z.infer<typeof RemoteSummarySchema> => value !== null);
}

function buildCandidateHit(
  candidate: McpRegistryCandidate,
  tokens: string[],
): (McpRegistryCandidate & { score: number; matchReasons: string[] }) | null {
  if (tokens.length === 0) {
    return null;
  }

  const weightedFields: Array<{ label: string; values: string[]; weight: number }> = [
    { label: 'name', values: [candidate.name.toLowerCase()], weight: 6 },
    { label: 'title', values: candidate.title ? [candidate.title.toLowerCase()] : [], weight: 5 },
    { label: 'description', values: [candidate.description.toLowerCase()], weight: 4 },
    { label: 'package-id', values: candidate.packageSummaries.map((pkg) => pkg.identifier.toLowerCase()), weight: 4 },
    { label: 'registry-type', values: candidate.packageSummaries.map((pkg) => pkg.registryType.toLowerCase()), weight: 2 },
    { label: 'transport', values: candidate.transportTypes.map((transport) => transport.toLowerCase()), weight: 3 },
    { label: 'repository', values: candidate.repositoryUrl ? [candidate.repositoryUrl.toLowerCase()] : [], weight: 2 },
    { label: 'website', values: candidate.websiteUrl ? [candidate.websiteUrl.toLowerCase()] : [], weight: 2 },
  ];

  let score = 0;
  const matchReasons = new Set<string>();
  for (const token of tokens) {
    for (const field of weightedFields) {
      if (field.values.some((value) => value.includes(token))) {
        score += field.weight;
        matchReasons.add(field.label);
      }
    }
  }

  if (score === 0) {
    return null;
  }

  if (candidate.status === 'deprecated') {
    score -= 1;
  }
  if (candidate.status === 'deleted') {
    score -= 3;
  }

  return {
    ...candidate,
    score,
    matchReasons: Array.from(matchReasons),
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNullableUrl(value: unknown): string | null {
  const text = readNullableString(value);
  if (!text) {
    return null;
  }

  const parsed = z.string().url().safeParse(text);
  return parsed.success ? parsed.data : null;
}

function readNullableDateTime(value: unknown): string | null {
  const text = readNullableString(value);
  if (!text) {
    return null;
  }

  const parsed = z.string().datetime().safeParse(text);
  return parsed.success ? parsed.data : null;
}

function readStatus(value: unknown): McpRegistryCandidate['status'] {
  return value === 'deprecated' || value === 'deleted' ? value : 'active';
}

function readTransportType(value: unknown): z.infer<typeof TransportTypeSchema> | null {
  return value === 'stdio' || value === 'streamable-http' || value === 'sse' ? value : null;
}

function readRemoteTransportType(value: unknown): z.infer<typeof RemoteSummarySchema>['transportType'] | null {
  return value === 'streamable-http' || value === 'sse' ? value : null;
}
