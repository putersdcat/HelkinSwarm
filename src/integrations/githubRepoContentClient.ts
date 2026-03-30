import { createAppAuth } from '@octokit/auth-app';

const OWNER = 'putersdcat';
const REPO = 'HelkinSwarm';
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;

let cachedToken: string | undefined;
let tokenExpiresAt = 0;

export interface RepoFileWriteInput {
  path: string;
  content: string;
}

export interface RepoFileWriteResult {
  path: string;
  action: 'created' | 'updated';
  commitSha: string;
}

async function getGitHubInstallationToken(): Promise<string> {
  const nowMs = Date.now();
  const refreshThresholdMs = 5 * 60 * 1000;

  if (cachedToken && nowMs < tokenExpiresAt - refreshThresholdMs) {
    return cachedToken;
  }

  const appId = process.env['GITHUB_APP_ID'];
  const installationId = process.env['GITHUB_APP_INSTALLATION_ID'];
  const privateKey = process.env['GITHUB_APP_PRIVATE_KEY'];

  if (!appId || !installationId || !privateKey) {
    throw new Error(
      'GitHub App credentials not configured. Ensure GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and GITHUB_APP_PRIVATE_KEY are set.',
    );
  }

  const auth = createAppAuth({
    appId: parseInt(appId, 10),
    installationId: parseInt(installationId, 10),
    privateKey,
  });
  const authResult = await auth({ type: 'installation' });
  cachedToken = authResult.token;
  tokenExpiresAt = nowMs + 55 * 60 * 1000;
  return cachedToken;
}

async function headers(): Promise<Record<string, string>> {
  const token = await getGitHubInstallationToken();
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'HelkinSwarm/1.0',
  };
}

async function fetchExistingSha(path: string, branch: string): Promise<string | null> {
  const response = await fetch(`${API_BASE}/contents/${path}?ref=${encodeURIComponent(branch)}`, {
    headers: await headers(),
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub contents lookup failed for '${path}' with status ${response.status}.`);
  }

  const body = await response.json() as { sha?: unknown };
  return typeof body.sha === 'string' ? body.sha : null;
}

export async function pushRepositoryFiles(input: {
  branch?: string;
  message: string;
  files: RepoFileWriteInput[];
}): Promise<RepoFileWriteResult[]> {
  if (input.files.length === 0) {
    throw new Error('At least one file is required for repository promotion.');
  }

  const branch = input.branch?.trim() || 'main';
  const h = await headers();
  const results: RepoFileWriteResult[] = [];

  for (const file of input.files) {
    const existingSha = await fetchExistingSha(file.path, branch);
    const payload: Record<string, unknown> = {
      message: input.message,
      branch,
      content: Buffer.from(file.content, 'utf8').toString('base64'),
    };
    if (existingSha) {
      payload['sha'] = existingSha;
    }

    const response = await fetch(`${API_BASE}/contents/${file.path}`, {
      method: 'PUT',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub file write failed for '${file.path}' with status ${response.status}: ${errorBody}`);
    }

    const body = await response.json() as { commit?: { sha?: unknown }; content?: { path?: unknown } };
    results.push({
      path: typeof body.content?.path === 'string' ? body.content.path : file.path,
      action: existingSha ? 'updated' : 'created',
      commitSha: typeof body.commit?.sha === 'string' ? body.commit.sha : '',
    });
  }

  return results;
}