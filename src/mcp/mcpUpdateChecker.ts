/**
 * Low-cost MCP skill update checker (#481).
 *
 * Performs cheap metadata-only probes (GitHub releases API, MCP Registry catalog)
 * to detect available updates for installed MCP-integrated skills.
 *
 * - Never executes remote code.
 * - Results are stored in-memory only; no Cosmos write.
 * - Designed to run without an LLM session.
 */

import https from 'node:https';
import { type McpProvenance } from '../capabilities/manifestSchema.js';
import { getAllManifests } from '../capabilities/capabilityLoader.js';
import { getMcpRegistryCandidate } from './mcpRegistryCatalog.js';

export type UpdateCheckStatus =
  | 'up-to-date'
  | 'update-available'
  | 'check-failed'
  | 'not-configured'
  | 'pending';

export interface UpdateCheckResult {
  domain: string;
  status: UpdateCheckStatus;
  installedVersion: string;
  latestVersion: string | null;
  checkedAt: string;
  source: string | null;
  error: string | null;
  updateSourceUrl: string | null;
}

// In-memory result cache keyed by domain.
const updateCheckCache = new Map<string, UpdateCheckResult>();

export function getLastUpdateCheckResult(domain: string): UpdateCheckResult | undefined {
  return updateCheckCache.get(domain);
}

export function getAllUpdateCheckResults(): Map<string, UpdateCheckResult> {
  return new Map(updateCheckCache);
}

/**
 * Check a single MCP skill for available updates.
 * Determines status by comparing `installedVersion` vs the latest published version.
 */
export async function checkMcpSkillForUpdates(
  domain: string,
  installedVersion: string,
  provenance: McpProvenance,
): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString();

  const makeResult = (
    status: UpdateCheckStatus,
    latestVersion: string | null = null,
    error: string | null = null,
  ): UpdateCheckResult => ({
    domain,
    status,
    installedVersion,
    latestVersion,
    checkedAt,
    source: provenance.updateSource ?? null,
    error,
    updateSourceUrl: provenance.updateSourceUrl ?? null,
  });

  if (!provenance.updateCheckEnabled || !provenance.updateSource) {
    const result = makeResult('not-configured');
    updateCheckCache.set(domain, result);
    return result;
  }

  try {
    let latestVersion: string | null = null;

    if (provenance.updateSource === 'github' && provenance.updateSourceUrl) {
      latestVersion = await fetchGitHubLatestRelease(provenance.updateSourceUrl);
    } else if (provenance.updateSource === 'mcp-registry' && provenance.mcpRegistryId) {
      latestVersion = await fetchMcpRegistryLatestVersion(provenance.mcpRegistryId);
    }
    // 'manual' source: skip automated check

    const status: UpdateCheckStatus =
      latestVersion === null
        ? 'check-failed'
        : latestVersion !== installedVersion
          ? 'update-available'
          : 'up-to-date';

    const result = makeResult(status, latestVersion);
    updateCheckCache.set(domain, result);
    return result;
  } catch (err) {
    const result = makeResult('check-failed', null, err instanceof Error ? err.message : String(err));
    updateCheckCache.set(domain, result);
    return result;
  }
}

/**
 * Run update checks for all currently loaded skills that have `updateCheckEnabled: true`.
 * Returns results for each skill that was checked.
 */
export async function runAllEnabledUpdateChecks(): Promise<UpdateCheckResult[]> {
  const manifests = getAllManifests().filter((m) => m.mcpProvenance?.updateCheckEnabled);
  const results = await Promise.all(
    manifests.map((m) => checkMcpSkillForUpdates(m.domain, m.version, m.mcpProvenance!)),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Source-specific fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch the latest release tag from GitHub releases API.
 * Parses URLs of the form https://github.com/owner/repo[/...].
 * Returns `null` on 404 (no releases) or parse failure.
 */
async function fetchGitHubLatestRelease(repoUrl: string): Promise<string | null> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!match) {
    throw new Error(`Cannot parse GitHub repository URL: ${repoUrl}`);
  }

  const owner = match[1];
  const repo = match[2]!.replace(/\.git$/, '');

  return new Promise<string | null>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'HelkinSwarm/1.0 (update-checker)',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode === 404) {
            // No releases published yet.
            resolve(null);
            return;
          }
          if (!res.statusCode || res.statusCode >= 300) {
            reject(new Error(`GitHub API responded ${res.statusCode} for ${owner}/${repo}`));
            return;
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
              tag_name?: string;
            };
            resolve(data.tag_name ?? null);
          } catch {
            reject(new Error('Failed to parse GitHub releases response'));
          }
        });
        res.on('error', (err) => reject(err));
      },
    );

    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error(`GitHub API timed out for ${repoUrl}`));
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

/**
 * Fetch the latest version from the local MCP Registry catalog by registry ID.
 * Returns `null` if the entry is not found or has no version.
 */
async function fetchMcpRegistryLatestVersion(mcpRegistryId: string): Promise<string | null> {
  // Use the direct O(1) catalog lookup rather than a fuzzy search.
  const entry = getMcpRegistryCandidate(mcpRegistryId);
  return entry?.latestVersion ?? null;
}
