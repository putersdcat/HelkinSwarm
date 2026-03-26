// GitHub Issues skill handlers — self-repo backlog management.
// Spec ref: 05-Capabilities-Framework.md, 06-Tool-Dispatch-LLM-Layer.md
// Issue: #121
//
// Auth: GitHub App installation token (minted via @octokit/auth-app).
// Credentials: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY (KV refs).
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

export const github_create_issue: ToolHandler = async (args) => {
  const title = String(args['title'] ?? '').trim();
  if (!title) return { error: 'title is required' };

  const issueBody = String(args['body'] ?? '').trim();
  if (!issueBody) return { error: 'body is required — every issue needs context and acceptance criteria' };

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
