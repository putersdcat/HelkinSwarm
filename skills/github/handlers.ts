// GitHub Issues skill handlers — self-repo backlog management.
// Spec ref: 05-Capabilities-Framework.md, 06-Tool-Dispatch-LLM-Layer.md
// Issue: #121
//
// Auth: GitHub App installation token (minted via @octokit/auth-app).
// Credentials: SKILLFORGE_GITHUB_APP_ID, SKILLFORGE_GITHUB_APP_INSTALLATION_ID,
// SKILLFORGE_GITHUB_APP_PRIVATE_KEY (KV refs), with fallback to legacy GITHUB_APP_* names.
// Scope: putersdcat/HelkinSwarm only — no cross-repo access.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';
import { getGitHubInstallationToken } from './githubAppAuth.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const OWNER = 'putersdcat';
const REPO = 'HelkinSwarm';
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;

async function headers(): Promise<Record<string, string>> {
  const token = await getGitHubInstallationToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'HelkinSwarm/1.0',
  };
}

// ---------------------------------------------------------------------------
// Zod schemas for API response validation at boundary
// ---------------------------------------------------------------------------

const GitHubUserSchema = z.object({
  login: z.string(),
  id: z.number(),
}).passthrough();

const GitHubLabelSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
}).passthrough();

const GitHubMilestoneSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  open_issues: z.number().optional(),
  closed_issues: z.number().optional(),
  due_on: z.string().nullable().optional(),
}).passthrough();

const GitHubIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  body: z.string().nullable().optional(),
  user: GitHubUserSchema.nullable().optional(),
  labels: z.array(GitHubLabelSchema).default([]),
  milestone: GitHubMilestoneSchema.nullable().optional(),
  assignees: z.array(GitHubUserSchema).default([]),
  created_at: z.string(),
  updated_at: z.string(),
  html_url: z.string(),
  comments: z.number().optional(),
}).passthrough();

const GitHubCommentSchema = z.object({
  id: z.number(),
  body: z.string().nullable().optional(),
  user: GitHubUserSchema.nullable().optional(),
  created_at: z.string(),
  html_url: z.string(),
}).passthrough();

const GitHubContentItemSchema = z.object({
  sha: z.string(),
  path: z.string(),
}).passthrough();

const GitHubPutFileResultSchema = z.object({
  content: GitHubContentItemSchema.nullable().optional(),
  commit: z.object({
    sha: z.string(),
    html_url: z.string().nullable().optional(),
  }).passthrough().optional(),
}).passthrough();

const GitHubSearchResultSchema = z.object({
  total_count: z.number(),
  items: z.array(GitHubIssueSchema),
}).passthrough();

// ---------------------------------------------------------------------------
// Shared fetch helper with error handling
// ---------------------------------------------------------------------------

async function ghFetch<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const h = await headers();
  const response = await fetch(url, {
    ...init,
    headers: { ...h, ...init?.headers },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API ${response.status}: ${errorBody}`);
  }

  const data: unknown = await response.json();
  return schema.parse(data);
}

async function ghFetchWithPagination<T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<{ data: T; hasNextPage: boolean }> {
  const h = await headers();
  const response = await fetch(url, { headers: h });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API ${response.status}: ${errorBody}`);
  }

  const linkHeader = response.headers.get('link') ?? '';
  const hasNextPage = linkHeader.includes('rel="next"');

  const data: unknown = await response.json();
  return { data: schema.parse(data), hasNextPage };
}

async function ghFetchAllow404<T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const h = await headers();
  const response = await fetch(url, { headers: h });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API ${response.status}: ${errorBody}`);
  }

  const data: unknown = await response.json();
  return schema.parse(data);
}



// ---------------------------------------------------------------------------
// Tool: github_list_issues
// ---------------------------------------------------------------------------

export const github_list_issues: ToolHandler = async (args) => {
  const params = new URLSearchParams();
  if (args['state']) params.set('state', String(args['state']));
  if (args['labels']) params.set('labels', String(args['labels']));
  if (args['milestone']) params.set('milestone', String(args['milestone']));
  if (args['assignee']) params.set('assignee', String(args['assignee']));
  const perPage = Math.min(Number(args['per_page']) || 30, 100);
  params.set('per_page', String(perPage));
  const page = Math.max(Number(args['page']) || 1, 1);
  params.set('page', String(page));

  const url = `${API_BASE}/issues?${params.toString()}`;
  const { data: issues, hasNextPage } = await ghFetchWithPagination(url, z.array(GitHubIssueSchema));

  return {
    count: issues.length,
    page,
    per_page: perPage,
    has_next_page: hasNextPage,
    issues: issues.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: (i.labels ?? []).map((l) => l.name),
      milestone: i.milestone?.title ?? null,
      assignees: (i.assignees ?? []).map((a) => a.login),
      comments: i.comments,
      created_at: i.created_at,
      url: i.html_url,
    })),
  };
};

// ---------------------------------------------------------------------------
// Tool: github_search_issues
// ---------------------------------------------------------------------------

export const github_search_issues: ToolHandler = async (args) => {
  const query = String(args['query'] ?? '');
  if (!query) return { error: 'query is required' };

  const perPage = Math.min(Number(args['per_page']) || 30, 100);
  const fullQuery = `${query} repo:${OWNER}/${REPO}`;
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(fullQuery)}&per_page=${perPage}`;

  const result = await ghFetch(url, GitHubSearchResultSchema);

  return {
    total_count: result.total_count,
    issues: result.items.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: (i.labels ?? []).map((l) => l.name),
      url: i.html_url,
    })),
  };
};

// ---------------------------------------------------------------------------
// Tool: github_get_issue
// ---------------------------------------------------------------------------

export const github_get_issue: ToolHandler = async (args) => {
  const issueNumber = Number(args['issue_number']);
  if (!issueNumber) return { error: 'issue_number is required' };

  const issue = await ghFetch(`${API_BASE}/issues/${issueNumber}`, GitHubIssueSchema);

  // Also fetch comments
  const comments = await ghFetch(
    `${API_BASE}/issues/${issueNumber}/comments?per_page=30`,
    z.array(GitHubCommentSchema),
  );

  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body,
    labels: (issue.labels ?? []).map((l) => l.name),
    milestone: issue.milestone ? { number: issue.milestone.number, title: issue.milestone.title } : null,
    assignees: (issue.assignees ?? []).map((a) => a.login),
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    url: issue.html_url,
    comments: comments.map((c) => ({
      id: c.id,
      author: c.user?.login ?? 'unknown',
      body: c.body,
      created_at: c.created_at,
    })),
  };
};

// ---------------------------------------------------------------------------
// Tool: github_create_issue
// ---------------------------------------------------------------------------

// Similarity check: extract key words (≥5 chars) and compute overlap ratio.
// Returns true if two titles share ≥60% of their key words — enough to catch
// near-duplicates like the Outlook-search spray (#305–#311) without blocking
// legitimately distinct issues.
function titlesAreSimilar(a: string, b: string): boolean {
  const words = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 5);
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (wa.size === 0 || wb.size === 0) return false;
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  const overlap = intersection / Math.min(wa.size, wb.size);
  return overlap >= 0.6;
}

export const github_create_issue: ToolHandler = async (args) => {
  const title = String(args['title'] ?? '').trim();
  if (!title) return { error: 'title is required' };

  const issueBody = String(args['body'] ?? '').trim();
  if (!issueBody) return { error: 'body is required — every issue needs context and acceptance criteria' };

  // Dedup guard (#312): search for open issues with similar title before creating.
  // This prevents a single complaint from spawning multiple near-identical issues
  // during model fallback/retry loops.
  try {
    // Fetch recent open issues (first page, up to 100) and compare titles client-side.
    const recentUrl = `${API_BASE}/issues?state=open&per_page=100&sort=created&direction=desc`;
    const h = await headers();
    const recentResponse = await fetch(recentUrl, { headers: h });
    if (recentResponse.ok) {
      const recentIssues = z.array(GitHubIssueSchema).parse(await recentResponse.json() as unknown);
      const duplicate = recentIssues.find((i) => titlesAreSimilar(i.title, title));
      if (duplicate) {
        return {
          status: 'duplicate_skipped',
          message: `A similar open issue already exists — commenting on it is preferred over creating a new one.`,
          existing_issue: {
            number: duplicate.number,
            title: duplicate.title,
            url: duplicate.html_url,
          },
        };
      }
    }
  } catch {
    // Dedup check failed — proceed with creation rather than blocking the tool.
  }

  const payload: Record<string, unknown> = { title, body: issueBody };
  if (args['labels'] && Array.isArray(args['labels'])) payload['labels'] = args['labels'];
  if (args['milestone']) payload['milestone'] = Number(args['milestone']);
  if (args['assignees'] && Array.isArray(args['assignees'])) payload['assignees'] = args['assignees'];

  const issue = await ghFetch(`${API_BASE}/issues`, GitHubIssueSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return {
    status: 'created',
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
  };
};

// ---------------------------------------------------------------------------
// Tool: github_update_issue
// ---------------------------------------------------------------------------

export const github_update_issue: ToolHandler = async (args) => {
  const issueNumber = Number(args['issue_number']);
  if (!issueNumber) return { error: 'issue_number is required' };

  const body: Record<string, unknown> = {};
  if (args['title'] !== undefined) body['title'] = String(args['title']);
  if (args['body'] !== undefined) body['body'] = String(args['body']);
  if (args['state'] !== undefined) body['state'] = String(args['state']);
  if (args['labels'] !== undefined) body['labels'] = args['labels'];
  if (args['milestone'] !== undefined) body['milestone'] = args['milestone'] === null ? null : Number(args['milestone']);
  if (args['assignees'] !== undefined) body['assignees'] = args['assignees'];

  if (Object.keys(body).length === 0) return { error: 'No fields to update' };

  const issue = await ghFetch(`${API_BASE}/issues/${issueNumber}`, GitHubIssueSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    status: 'updated',
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
  };
};

// ---------------------------------------------------------------------------
// Tool: github_add_comment
// ---------------------------------------------------------------------------

export const github_add_comment: ToolHandler = async (args) => {
  const issueNumber = Number(args['issue_number']);
  const body = String(args['body'] ?? '');
  if (!issueNumber) return { error: 'issue_number is required' };
  if (!body) return { error: 'body is required' };

  const comment = await ghFetch(
    `${API_BASE}/issues/${issueNumber}/comments`,
    GitHubCommentSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  );

  return {
    status: 'created',
    comment_id: comment.id,
    issue_number: issueNumber,
    url: comment.html_url,
  };
};

// ---------------------------------------------------------------------------
// Tool: github_push_files
// ---------------------------------------------------------------------------

const GitHubPushFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const github_push_files: ToolHandler = async (args) => {
  const files = z.array(GitHubPushFileInputSchema).parse(args['files'] ?? []);
  if (files.length === 0) return { error: 'files is required' };

  const message = String(args['message'] ?? '').trim();
  if (!message) return { error: 'message is required' };

  const branch = String(args['branch'] ?? 'main').trim() || 'main';
  const h = await headers();
  const results: Array<{ path: string; action: 'created' | 'updated'; sha: string }> = [];

  for (const file of files) {
    const existing = await ghFetchAllow404(
      `${API_BASE}/contents/${file.path}?ref=${encodeURIComponent(branch)}`,
      GitHubContentItemSchema,
    );

    const payload: Record<string, unknown> = {
      message,
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      branch,
    };
    if (existing?.sha) {
      payload['sha'] = existing.sha;
    }

    const result = await ghFetch(
      `${API_BASE}/contents/${file.path}`,
      GitHubPutFileResultSchema,
      {
        method: 'PUT',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    results.push({
      path: result.content?.path ?? file.path,
      action: existing ? 'updated' : 'created',
      sha: result.commit?.sha ?? result.content?.sha ?? '',
    });
  }

  return {
    status: 'ok',
    branch,
    message,
    files: results,
  };
};

// ---------------------------------------------------------------------------
// Tool: github_list_milestones
// ---------------------------------------------------------------------------

export const github_list_milestones: ToolHandler = async (args) => {
  const state = String(args['state'] ?? 'open');
  const url = `${API_BASE}/milestones?state=${encodeURIComponent(state)}&per_page=100`;

  const milestones = await ghFetch(url, z.array(GitHubMilestoneSchema));

  return {
    count: milestones.length,
    milestones: milestones.map((m) => ({
      number: m.number,
      title: m.title,
      state: m.state,
      open_issues: m.open_issues,
      closed_issues: m.closed_issues,
      due_on: m.due_on,
    })),
  };
};

// ---------------------------------------------------------------------------
// Zod schemas for Actions/workflow run endpoints
// ---------------------------------------------------------------------------

const WorkflowRunActorSchema = z.object({
  login: z.string(),
}).passthrough();

const WorkflowRunSchema = z.object({
  id: z.number(),
  name: z.string().nullable().optional(),
  display_title: z.string().nullable().optional(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  event: z.string(),
  head_branch: z.string().nullable().optional(),
  head_sha: z.string(),
  run_number: z.number(),
  run_attempt: z.number().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  run_started_at: z.string().nullable().optional(),
  html_url: z.string(),
  triggering_actor: WorkflowRunActorSchema.nullable().optional(),
  path: z.string().nullable().optional(),
}).passthrough();

const WorkflowRunsListSchema = z.object({
  total_count: z.number(),
  workflow_runs: z.array(WorkflowRunSchema),
}).passthrough();

const WorkflowBillableOSSchema = z.object({
  total_ms: z.number(),
  jobs: z.number().optional(),
}).passthrough();

const WorkflowTimingSchema = z.object({
  billable: z.object({
    UBUNTU: WorkflowBillableOSSchema.optional(),
    MACOS: WorkflowBillableOSSchema.optional(),
    WINDOWS: WorkflowBillableOSSchema.optional(),
  }).passthrough().optional(),
  run_duration_ms: z.number().optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Tool: github_list_workflow_runs
// ---------------------------------------------------------------------------

export const github_list_workflow_runs: ToolHandler = async (args) => {
  const rawLimit = typeof args['limit'] === 'number' ? args['limit'] : 10;
  const limit = Math.min(Math.max(1, rawLimit), 30);
  const params = new URLSearchParams({ per_page: String(limit) });

  if (args['branch']) params.set('branch', String(args['branch']));
  if (args['status']) params.set('status', String(args['status']));

  let runsUrl: string;
  if (args['workflow_id']) {
    const wf = encodeURIComponent(String(args['workflow_id']));
    runsUrl = `${API_BASE}/actions/workflows/${wf}/runs?${params.toString()}`;
  } else {
    runsUrl = `${API_BASE}/actions/runs?${params.toString()}`;
  }

  const result = await ghFetch(runsUrl, WorkflowRunsListSchema);

  return {
    total_count: result.total_count,
    returned: result.workflow_runs.length,
    runs: result.workflow_runs.map((r) => {
      const startedAt = r.run_started_at ?? r.created_at;
      const endedAt = r.updated_at;
      const durationMs = r.status === 'completed'
        ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
        : null;
      return {
        id: r.id,
        name: r.name ?? r.display_title ?? '(unnamed)',
        status: r.status,
        conclusion: r.conclusion,
        event: r.event,
        branch: r.head_branch ?? null,
        run_number: r.run_number,
        created_at: r.created_at,
        duration_seconds: durationMs !== null ? Math.round(durationMs / 1000) : null,
        url: r.html_url,
        triggered_by: r.triggering_actor?.login ?? null,
      };
    }),
  };
};

// ---------------------------------------------------------------------------
// Tool: github_get_workflow_run
// ---------------------------------------------------------------------------

export const github_get_workflow_run: ToolHandler = async (args) => {
  const runId = args['run_id'];
  if (typeof runId !== 'number') {
    return { error: 'run_id must be a number' };
  }

  const [run, timing] = await Promise.all([
    ghFetch(`${API_BASE}/actions/runs/${runId}`, WorkflowRunSchema),
    ghFetch(`${API_BASE}/actions/runs/${runId}/timing`, WorkflowTimingSchema)
      .catch(() => null as null),
  ]);

  const startedAt = run.run_started_at ?? run.created_at;
  const durationMs = run.status === 'completed'
    ? new Date(run.updated_at).getTime() - new Date(startedAt).getTime()
    : null;

  const billable = timing?.billable;
  const totalBillableMs = billable
    ? (billable['UBUNTU']?.total_ms ?? 0) + (billable['MACOS']?.total_ms ?? 0) + (billable['WINDOWS']?.total_ms ?? 0)
    : null;

  return {
    id: run.id,
    name: run.name ?? run.display_title ?? '(unnamed)',
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    branch: run.head_branch ?? null,
    run_number: run.run_number,
    run_attempt: run.run_attempt ?? 1,
    created_at: run.created_at,
    started_at: run.run_started_at ?? null,
    updated_at: run.updated_at,
    duration_seconds: durationMs !== null ? Math.round(durationMs / 1000) : null,
    url: run.html_url,
    triggered_by: run.triggering_actor?.login ?? null,
    billable_ms: {
      linux: billable?.['UBUNTU']?.total_ms ?? null,
      macos: billable?.['MACOS']?.total_ms ?? null,
      windows: billable?.['WINDOWS']?.total_ms ?? null,
      total: totalBillableMs,
    },
    run_duration_ms: timing?.run_duration_ms ?? null,
  };
};
