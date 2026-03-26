#!/usr/bin/env node
/**
 * HelkinSwarm Teams Test Harness MCP Server
 *
 * Local-only development tool. Runs as a standalone MCP server in VS Code.
 * Uses Microsoft Graph API + MSAL device-code flow to send/receive Teams messages.
 *
 * MVP Tools:
 *   teams_test_setup            – One-time auth + discover the HelkinSwarm bot chat ID
 *   teams_test_send_probe       – Send a message to the HelkinSwarm Teams chat
 *   teams_test_get_recent       – Read recent messages (includes bot replies)
 *   teams_test_wait_for_bot_reply – Send + poll for reply with timeout
 *   teams_test_correlate_runtime  – Check stamp health endpoint
 *   teams_test_full_probe       – ⭐ Send + wait + correlate in one call
 *
 * Spec: docs/14-Testing-E2E.md, docs/0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md
 * Issue: https://github.com/putersdcat/HelkinSwarm/issues/33
 *
 * NEVER use Playwright for sending Teams messages — Graph API only.
 * Hardcoded safe settings: chatId stored in .vscode/mcp-settings.json (gitignored).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { PublicClientApplication, type DeviceCodeRequest, type AccountInfo } from '@azure/msal-node';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  buildHarnessSessionBundle,
  getHarnessMessageWindow,
  queryHarnessMessages,
  type HarnessMessageDirection,
  type HarnessMessageWindowQuery,
  type HarnessPickMode,
  type HarnessRawMessage,
} from './teamsTestHarnessQuery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Configuration ─────────────────────────────────────────────────────────────
const TENANT_ID = '51b1f02a-e19b-4089-a5f6-3ebb72835521';
const CLIENT_ID = '129a0ea3-3970-4d68-95e2-77438e5f891d'; // HelkinSwarm-DevLoop-MCP
const GRAPH_SCOPES = ['Chat.ReadWrite', 'offline_access'];
const BOT_DISPLAY_NAME_HINT = 'HelkinSwarm';
const STAMP_HEALTH_URL =
  'https://helkinswarm-func-a7f2.purplepebble-508e1162.eastus2.azurecontainerapps.io/api/health';
const REPO_ROOT = join(__dirname, '..', '..', '..'); // dist-mcp/src/mcp → repo root

const SETTINGS_PATH = join(REPO_ROOT, '.vscode', 'mcp-settings.json');
const APP_INSIGHTS_QUERY_SCRIPT = join(REPO_ROOT, 'scripts', 'Invoke-AzOperationalInsightsQuery.ps1');
const RUNTIME_SESSION_BUNDLE_SCRIPT = join(REPO_ROOT, 'scripts', 'Invoke-DevLoopSessionBundle.ps1');
const STAMP_USER_ALIAS = 'a7f2';
// Persist cache outside the repo so it survives workspace resets and re-clones.
// One device-code auth per machine; refresh token persists ~90 days silently.
const TOKEN_CACHE_PATH = join(homedir(), '.helkinswarm', 'msal-cache.json');

// ── MSAL Auth ─────────────────────────────────────────────────────────────────

interface TokenCache {
  deserialize(data: string): void;
  serialize(): string;
}

interface CacheContext {
  tokenCache: TokenCache;
  hasChanged: boolean;
}

let _msalApp: PublicClientApplication | null = null;
let _cachedToken: { token: string; expiresAt: number } | null = null;
const execFileAsync = promisify(execFile);

function parseJwtExpiry(token: string): number | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      exp?: number;
    };
    return parsed.exp ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

function cacheAccessToken(token: string): string {
  _cachedToken = {
    token,
    expiresAt: parseJwtExpiry(token) ?? Date.now() + 5 * 60 * 1000,
  };
  return token;
}

function clearCachedToken(): void {
  _cachedToken = null;
}

function getMsalApp(): PublicClientApplication {
  if (!_msalApp) {
    _msalApp = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      },
      cache: {
        cachePlugin: {
          async beforeCacheAccess(ctx: CacheContext) {
            if (existsSync(TOKEN_CACHE_PATH)) {
              const data = await readFile(TOKEN_CACHE_PATH, 'utf-8');
              ctx.tokenCache.deserialize(data);
            }
          },
          async afterCacheAccess(ctx: CacheContext) {
            if (ctx.hasChanged) {
              await mkdir(dirname(TOKEN_CACHE_PATH), { recursive: true });
              await writeFile(TOKEN_CACHE_PATH, ctx.tokenCache.serialize());
            }
          },
        },
      },
    });
  }
  return _msalApp;
}

async function getAccessToken(): Promise<string> {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 60_000) {
    return _cachedToken.token;
  }

  clearCachedToken();

  const app = getMsalApp();
  const accounts = await app.getTokenCache().getAllAccounts();

  if (accounts.length > 0) {
    try {
      const result = await app.acquireTokenSilent({
        scopes: GRAPH_SCOPES,
        account: accounts[0] as AccountInfo,
      });
      if (result?.accessToken) {
        return cacheAccessToken(result.accessToken);
      }
    } catch {
      // Cache expired — fall through to device flow
    }
  }

  // Device code flow - prints instructions to stderr (not MCP stdout)
  const result = await app.acquireTokenByDeviceCode({
    scopes: GRAPH_SCOPES,
    deviceCodeCallback: (resp) => {
      process.stderr.write(`\n╔═══════════════════════════════════════╗\n`);
      process.stderr.write(`║   HELKINSWARM MCP — AUTH REQUIRED     ║\n`);
      process.stderr.write(`╚═══════════════════════════════════════╝\n`);
      process.stderr.write(`${resp.message}\n\n`);
    },
  } as DeviceCodeRequest);

  if (!result?.accessToken) throw new Error('Authentication failed — no access token returned');
  return cacheAccessToken(result.accessToken);
}

// ── Settings ──────────────────────────────────────────────────────────────────

interface HarnessSettings {
  chatId?: string;
  botUserId?: string;
  setupAt?: string;
}

async function loadSettings(): Promise<HarnessSettings> {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const data = await readFile(SETTINGS_PATH, 'utf-8');
      return JSON.parse(data) as HarnessSettings;
    }
  } catch {
    // First run — no settings yet
  }
  return {};
}

async function saveSettings(settings: HarnessSettings): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// ── Graph API helpers ─────────────────────────────────────────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphRequest(path: string, init?: RequestInit, retryOnAuthFailure = true): Promise<Response> {
  const token = await getAccessToken();
  const resp = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (retryOnAuthFailure && (resp.status === 401 || resp.status === 403)) {
    clearCachedToken();
    return graphRequest(path, init, false);
  }

  return resp;
}

async function graphGet<T>(path: string): Promise<T> {
  const resp = await graphRequest(path);
  if (!resp.ok) {
    const body = await resp.text();
    throw new McpError(ErrorCode.InternalError, `Graph GET ${path} failed: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<T>;
}

async function graphPost<T>(path: string, body: unknown): Promise<T> {
  const resp = await graphRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const respBody = await resp.text();
    throw new McpError(ErrorCode.InternalError, `Graph POST ${path} failed: ${resp.status} ${respBody}`);
  }
  return resp.json() as Promise<T>;
}

interface GraphChatMember {
  displayName?: string;
  userId?: string;
}

interface GraphChat {
  id: string;
  chatType: string;
  topic?: string;
  members?: GraphChatMember[];
}

interface GraphMessage extends HarnessRawMessage {
  id: string;
  createdDateTime: string;
  body?: { content?: string; contentType?: string };
}

function parseDirection(value: unknown): HarnessMessageDirection | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  const allowed: HarnessMessageDirection[] = [
    'any',
    'human-to-bot',
    'bot-to-human',
    'human-only',
    'bot-only',
    'system',
  ];

  return allowed.includes(value as HarnessMessageDirection)
    ? value as HarnessMessageDirection
    : undefined;
}

function parsePickMode(value: unknown): HarnessPickMode | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  const allowed: HarnessPickMode[] = ['all', 'first', 'last'];
  return allowed.includes(value as HarnessPickMode) ? value as HarnessPickMode : undefined;
}

async function getRecentChatMessages(chatId: string, count: number): Promise<GraphMessage[]> {
  const cappedCount = Math.min(Math.max(count, 1), 50);
  const msgsResp = await graphGet<{ value: GraphMessage[] }>(
    `/me/chats/${chatId}/messages?$top=${cappedCount}`,
  );
  return msgsResp.value;
}

function escapeKqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function queryAppInsightsForCorrelation(correlationTag: string): Promise<unknown> {
  if (!existsSync(APP_INSIGHTS_QUERY_SCRIPT)) {
    return { available: false, error: 'App Insights query script not found.' };
  }

  const kql = [
    'AppTraces',
    `| where Message contains '${escapeKqlLiteral(correlationTag)}' or tostring(Properties) contains '${escapeKqlLiteral(correlationTag)}'`,
    '| project TimeGenerated, AppRoleName, Message, Properties, OperationId, SeverityLevel',
    '| order by TimeGenerated asc',
    '| take 20',
  ].join(' ');

  try {
    const { stdout } = await execFileAsync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        APP_INSIGHTS_QUERY_SCRIPT,
        '-UserAlias',
        STAMP_USER_ALIAS,
        '-Query',
        kql,
        '-Timespan',
        '00:30:00',
        '-OutputFormat',
        'Json',
      ],
      { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 },
    );

    return JSON.parse(stdout) as unknown;
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

async function queryRuntimeSessionBundleForCorrelation(correlationTag: string): Promise<unknown> {
  if (!existsSync(RUNTIME_SESSION_BUNDLE_SCRIPT)) {
    return { available: false, error: 'Runtime session bundle script not found.' };
  }

  try {
    const { stdout } = await execFileAsync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        RUNTIME_SESSION_BUNDLE_SCRIPT,
        '-UserAlias',
        STAMP_USER_ALIAS,
        '-CorrelationTag',
        correlationTag,
        '-OutputFormat',
        'Json',
      ],
      { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 },
    );

    return JSON.parse(stdout) as unknown;
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

function extractAppInsightsCandidates(bundle: { correlationTag: string | null; telemetryFooters: string[] }): string[] {
  const candidates = new Set<string>();

  if (bundle.correlationTag) {
    candidates.add(bundle.correlationTag);
  }

  for (const footer of bundle.telemetryFooters) {
    for (const match of footer.matchAll(/corr:([A-Za-z0-9-]+)/g)) {
      if (match[0]) {
        candidates.add(match[0]);
      }
    }
  }

  return [...candidates];
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'helkin-teams-test-harness', version: '1.0.7' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'teams_test_setup',
      description:
        'One-time setup: authenticate to Microsoft Graph via device code and discover the HelkinSwarm bot chat ID. Must be run before any other tools.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'teams_test_send_probe',
      description:
        'Send a message to the HelkinSwarm Teams chat via Graph API. Requires teams_test_setup to have been run successfully.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message text to send to the HelkinSwarm bot' },
        },
        required: ['message'],
      },
    },
    {
      name: 'teams_test_get_recent',
      description:
        'Read the N most recent messages from the HelkinSwarm Teams chat. Includes messages from both user and bot.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of messages to retrieve (default: 10, max: 50)' },
        },
        required: [],
      },
    },
    {
      name: 'teams_test_query_messages',
      description:
        'Targeted Teams chat lookup by correlation tag, direction, message id, text search, time range, and first/last match helpers.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'How many recent chat messages to inspect first (default: 50, max: 50).' },
          direction: {
            type: 'string',
            description: 'Message direction filter: any, human-to-bot, bot-to-human, human-only, bot-only, system.',
          },
          correlation: { type: 'string', description: 'Correlation tag or footer fragment to match.' },
          contains: { type: 'string', description: 'Substring to match inside the normalized text body.' },
          messageId: { type: 'string', description: 'Exact Teams message id to return.' },
          beforeMessageId: { type: 'string', description: 'Only return messages before this message id.' },
          afterMessageId: { type: 'string', description: 'Only return messages after this message id.' },
          sinceIso: { type: 'string', description: 'Lower timestamp bound (ISO 8601).' },
          untilIso: { type: 'string', description: 'Upper timestamp bound (ISO 8601).' },
          newestFirst: { type: 'boolean', description: 'Return matches newest-first instead of chronological order.' },
          limit: { type: 'number', description: 'Maximum number of matches to return after filtering.' },
          pick: { type: 'string', description: 'Return all, first, or last match only.' },
        },
        required: [],
      },
    },
    {
      name: 'teams_test_get_message_window',
      description:
        'Return a narrow message window around a message id, correlation tag, or text fragment for fast DevLoop session inspection.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'How many recent chat messages to inspect first (default: 50, max: 50).' },
          aroundMessageId: { type: 'string', description: 'Anchor window around this exact Teams message id.' },
          aroundCorrelation: { type: 'string', description: 'Anchor window around the first correlation tag/footer match.' },
          aroundContains: { type: 'string', description: 'Anchor window around the first text match.' },
          beforeCount: { type: 'number', description: 'How many messages before the anchor to include (default: 3).' },
          afterCount: { type: 'number', description: 'How many messages after the anchor to include (default: 3).' },
          direction: {
            type: 'string',
            description: 'Optional direction filter: any, human-to-bot, bot-to-human, human-only, bot-only, system.',
          },
        },
        required: [],
      },
    },
    {
      name: 'teams_test_get_session_bundle',
      description:
        'Return a structured end-to-end session bundle around a correlation tag, message id, or text anchor, including rich Teams message payloads plus current runtime health.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'How many recent chat messages to inspect first (default: 30, max: 50).' },
          correlation: { type: 'string', description: 'Correlation tag/footer fragment to anchor the bundle.' },
          aroundMessageId: { type: 'string', description: 'Anchor the bundle around this exact Teams message id.' },
          aroundContains: { type: 'string', description: 'Anchor the bundle around this text or card-payload match.' },
          beforeCount: { type: 'number', description: 'How many messages before the anchor to include (default: 3).' },
          afterCount: { type: 'number', description: 'How many messages after the anchor to include (default: 3).' },
          direction: {
            type: 'string',
            description: 'Optional direction filter: any, human-to-bot, bot-to-human, human-only, bot-only, system.',
          },
        },
        required: [],
      },
    },
    {
      name: 'teams_test_wait_for_bot_reply',
      description:
        'Send a message and poll for a bot reply with a configurable timeout. Returns the reply text or a timeout error with elapsed time.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to send' },
          timeoutSeconds: {
            type: 'number',
            description: 'Max seconds to wait for a reply (default: 45)',
          },
        },
        required: ['message'],
      },
    },
    {
      name: 'teams_test_correlate_runtime',
      description:
        'Fetch the stamp health endpoint to check bot status, LLM connectivity, and safety mode. No Teams auth required.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'teams_test_full_probe',
      description:
        '⭐ Recommended. Send a probe message, wait for the bot reply, and check runtime health in one call. Returns: { passed, botReply, elapsed, runtime }.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Probe message to send (e.g. "hello, are you there?")' },
          timeoutSeconds: {
            type: 'number',
            description: 'Max seconds to wait for bot reply (default: 45)',
          },
        },
        required: ['message'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'teams_test_setup': {
      // Authenticate and enumerate chats to find the HelkinSwarm bot chat
      await getAccessToken(); // triggers device flow if needed

      const chatsResp = await graphGet<{ value: GraphChat[] }>(
        '/me/chats?$expand=members&$top=50',
      );
      const chats = chatsResp.value;

      let botChat: GraphChat | undefined;
      let botUserId: string | undefined;

      // Known bot user IDs for auto-detection (router UAMI client ID = global bot identity)
      const KNOWN_BOT_USER_IDS = new Set([
        '42d3359f-8757-421d-a853-fb2960cf2dac', // helkinswarm-id-router (v2 global bot)
      ]);

      for (const chat of chats) {
        if (chat.chatType !== 'oneOnOne') continue;
        for (const member of chat.members ?? []) {
          const name_lower = (member.displayName ?? '').toLowerCase();
          const matchesName =
            name_lower.includes(BOT_DISPLAY_NAME_HINT.toLowerCase()) ||
            name_lower.includes('helkin');
          const matchesId = member.userId ? KNOWN_BOT_USER_IDS.has(member.userId) : false;
          if (matchesName || matchesId) {
            botChat = chat;
            botUserId = member.userId;
            break;
          }
        }
        if (botChat) break;
      }

      if (!botChat) {
        const chatList = chats
          .slice(0, 20)
          .map((c) => `  ID: ${c.id}  type: ${c.chatType}  topic: ${c.topic ?? 'none'}`)
          .join('\n');
        return {
          content: [
            {
              type: 'text',
              text: [
                '⚠️  Could not auto-detect HelkinSwarm chat.',
                '',
                'Chats found (first 20):',
                chatList,
                '',
                'To set manually, create .vscode/mcp-settings.json:',
                '  { "chatId": "<id from the list above>" }',
              ].join('\n'),
            },
          ],
        };
      }

      const settings: HarnessSettings = {
        chatId: botChat.id,
        botUserId,
        setupAt: new Date().toISOString(),
      };
      await saveSettings(settings);

      return {
        content: [
          {
            type: 'text',
            text: [
              '✅ Setup complete!',
              `  Chat ID:    ${botChat.id}`,
              `  Bot user:   ${botUserId ?? 'unknown'}`,
              `  Saved to:   .vscode/mcp-settings.json`,
              '',
              'You can now use teams_test_full_probe to test the bot.',
            ].join('\n'),
          },
        ],
      };
    }

    case 'teams_test_send_probe': {
      const message = String(typedArgs['message'] ?? '');
      if (!message) throw new McpError(ErrorCode.InvalidParams, 'message is required');

      const settings = await loadSettings();
      if (!settings.chatId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Chat ID not configured. Run teams_test_setup first.',
        );
      }

      await graphPost(`/me/chats/${settings.chatId}/messages`, {
        body: { contentType: 'text', content: message },
      });

      return {
        content: [{ type: 'text', text: `✅ Message sent: "${message}"` }],
      };
    }

    case 'teams_test_get_recent': {
      const count = Math.min(Number(typedArgs['count'] ?? 10), 50);
      const settings = await loadSettings();
      if (!settings.chatId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Chat ID not configured. Run teams_test_setup first.',
        );
      }

      const messages = await getRecentChatMessages(settings.chatId, count);

      const lines = messages
        .sort(
          (a, b) => new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
        )
        .map((m) => {
          const sender =
            m.from?.application?.displayName ?? m.from?.user?.displayName ?? 'unknown';
          const isBot = !!m.from?.application;
          const tag = isBot ? '🤖' : '👤';
          const time = new Date(m.createdDateTime).toISOString();
          const text = (m.body?.content ?? '').replace(/<[^>]+>/g, '').trim();
          return `${tag} [${time}] ${sender}: ${text}`;
        });

      return {
        content: [{ type: 'text', text: lines.join('\n') || '(no messages)' }],
      };
    }

    case 'teams_test_query_messages': {
      const count = Math.min(Number(typedArgs['count'] ?? 50), 50);
      const settings = await loadSettings();
      if (!settings.chatId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Chat ID not configured. Run teams_test_setup first.',
        );
      }

      const messages = await getRecentChatMessages(settings.chatId, count);
      const direction = parseDirection(typedArgs['direction']);
      if (typedArgs['direction'] !== undefined && !direction) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid direction filter.');
      }

      const pick = parsePickMode(typedArgs['pick']);
      if (typedArgs['pick'] !== undefined && !pick) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid pick mode.');
      }

      const results = queryHarnessMessages(messages, {
        direction,
        correlation: typeof typedArgs['correlation'] === 'string' ? typedArgs['correlation'] : undefined,
        contains: typeof typedArgs['contains'] === 'string' ? typedArgs['contains'] : undefined,
        messageId: typeof typedArgs['messageId'] === 'string' ? typedArgs['messageId'] : undefined,
        beforeMessageId: typeof typedArgs['beforeMessageId'] === 'string' ? typedArgs['beforeMessageId'] : undefined,
        afterMessageId: typeof typedArgs['afterMessageId'] === 'string' ? typedArgs['afterMessageId'] : undefined,
        sinceIso: typeof typedArgs['sinceIso'] === 'string' ? typedArgs['sinceIso'] : undefined,
        untilIso: typeof typedArgs['untilIso'] === 'string' ? typedArgs['untilIso'] : undefined,
        newestFirst: Boolean(typedArgs['newestFirst']),
        limit: Number(typedArgs['limit'] ?? count),
        pick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: results.length,
            inspected: count,
            direction: direction ?? 'any',
            pick: pick ?? 'all',
            messages: results,
          }, null, 2),
        }],
      };
    }

    case 'teams_test_get_message_window': {
      const count = Math.min(Number(typedArgs['count'] ?? 50), 50);
      const settings = await loadSettings();
      if (!settings.chatId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Chat ID not configured. Run teams_test_setup first.',
        );
      }

      const messages = await getRecentChatMessages(settings.chatId, count);
      const direction = parseDirection(typedArgs['direction']);
      if (typedArgs['direction'] !== undefined && !direction) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid direction filter.');
      }

      const windowQuery: HarnessMessageWindowQuery = {
        aroundMessageId: typeof typedArgs['aroundMessageId'] === 'string' ? typedArgs['aroundMessageId'] : undefined,
        aroundCorrelation: typeof typedArgs['aroundCorrelation'] === 'string' ? typedArgs['aroundCorrelation'] : undefined,
        aroundContains: typeof typedArgs['aroundContains'] === 'string' ? typedArgs['aroundContains'] : undefined,
        beforeCount: Number(typedArgs['beforeCount'] ?? 3),
        afterCount: Number(typedArgs['afterCount'] ?? 3),
        direction,
      };

      if (!windowQuery.aroundMessageId && !windowQuery.aroundCorrelation && !windowQuery.aroundContains) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'One of aroundMessageId, aroundCorrelation, or aroundContains is required.',
        );
      }

      const result = getHarnessMessageWindow(messages, windowQuery);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            inspected: count,
            anchor: result.anchor,
            count: result.messages.length,
            messages: result.messages,
          }, null, 2),
        }],
      };
    }

    case 'teams_test_get_session_bundle': {
      const count = Math.min(Number(typedArgs['count'] ?? 30), 50);
      const settings = await loadSettings();
      if (!settings.chatId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Chat ID not configured. Run teams_test_setup first.',
        );
      }

      const direction = parseDirection(typedArgs['direction']);
      if (typedArgs['direction'] !== undefined && !direction) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid direction filter.');
      }

      const messages = await getRecentChatMessages(settings.chatId, count);
      const bundle = buildHarnessSessionBundle(messages, {
        correlation: typeof typedArgs['correlation'] === 'string' ? typedArgs['correlation'] : undefined,
        aroundMessageId: typeof typedArgs['aroundMessageId'] === 'string' ? typedArgs['aroundMessageId'] : undefined,
        aroundContains: typeof typedArgs['aroundContains'] === 'string' ? typedArgs['aroundContains'] : undefined,
        beforeCount: Number(typedArgs['beforeCount'] ?? 3),
        afterCount: Number(typedArgs['afterCount'] ?? 3),
        direction,
      });

      let health: unknown;
      try {
        const resp = await fetch(STAMP_HEALTH_URL);
        health = await resp.json();
      } catch (error) {
        health = { error: String(error) };
      }

      const insightCandidates = extractAppInsightsCandidates(bundle);
      let appInsights: unknown = { available: false, reason: 'No correlation tag available for App Insights lookup.' };
      let runtimeTrace: unknown = { available: false, reason: 'No correlation tag available for runtime trace lookup.' };

      if (insightCandidates.length > 0) {
        const attempts: Array<{ candidate: string; result: unknown }> = [];
        let firstNonEmpty: unknown | null = null;

        for (const candidate of insightCandidates) {
          const result = await queryAppInsightsForCorrelation(candidate);
          attempts.push({ candidate, result });

          const parsed = result as { tables?: unknown[] };
          if (!firstNonEmpty && Array.isArray(parsed.tables) && parsed.tables.length > 0) {
            firstNonEmpty = result;
          }
        }

        appInsights = {
          candidates: insightCandidates,
          selected: firstNonEmpty ?? attempts[0]?.candidate ?? null,
          result: firstNonEmpty ?? attempts[0]?.result ?? null,
          attempts,
        };

        const runtimeAttempts: Array<{ candidate: string; result: unknown }> = [];
        let firstRuntimeMatch: unknown | null = null;

        for (const candidate of insightCandidates) {
          const result = await queryRuntimeSessionBundleForCorrelation(candidate);
          runtimeAttempts.push({ candidate, result });

          const parsed = result as {
            bundle?: { relayMessageCount?: number; traceTree?: unknown | null };
          };
          const relayCount = parsed.bundle?.relayMessageCount ?? 0;
          const hasTraceTree = parsed.bundle?.traceTree !== null && parsed.bundle?.traceTree !== undefined;
          if (!firstRuntimeMatch && (relayCount > 0 || hasTraceTree)) {
            firstRuntimeMatch = result;
          }
        }

        runtimeTrace = {
          candidates: insightCandidates,
          selected: firstRuntimeMatch ?? runtimeAttempts[0]?.candidate ?? null,
          result: firstRuntimeMatch ?? runtimeAttempts[0]?.result ?? null,
          attempts: runtimeAttempts,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            inspected: count,
            bundle,
            runtime: health,
            runtimeTrace,
            appInsights,
          }, null, 2),
        }],
      };
    }

    case 'teams_test_wait_for_bot_reply': {
      const message = String(typedArgs['message'] ?? '');
      const timeoutSeconds = Number(typedArgs['timeoutSeconds'] ?? 45);
      if (!message) throw new McpError(ErrorCode.InvalidParams, 'message is required');

      const settings = await loadSettings();
      if (!settings.chatId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Chat ID not configured. Run teams_test_setup first.',
        );
      }

      const sentAt = new Date();
      await graphPost(`/me/chats/${settings.chatId}/messages`, {
        body: { contentType: 'text', content: message },
      });

      const deadline = Date.now() + timeoutSeconds * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));

        const msgsResp = await graphGet<{ value: GraphMessage[] }>(
          `/me/chats/${settings.chatId}/messages?$top=10`,
        );

        for (const m of msgsResp.value) {
          const isBot = !!m.from?.application;
          const isAfterSent = new Date(m.createdDateTime) > sentAt;
          if (isBot && isAfterSent) {
            const elapsed = ((Date.now() - sentAt.getTime()) / 1000).toFixed(1);
            const text = (m.body?.content ?? '').replace(/<[^>]+>/g, '').trim();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ passed: true, botReply: text, elapsed: `${elapsed}s` }),
                },
              ],
            };
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              passed: false,
              error: `Timeout after ${timeoutSeconds}s — no bot reply received`,
            }),
          },
        ],
      };
    }

    case 'teams_test_correlate_runtime': {
      const resp = await fetch(STAMP_HEALTH_URL);
      if (!resp.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Health endpoint returned ${resp.status}` }),
            },
          ],
        };
      }
      const health = await resp.json();
      return {
        content: [{ type: 'text', text: JSON.stringify(health, null, 2) }],
      };
    }

    case 'teams_test_full_probe': {
      const message = String(typedArgs['message'] ?? '');
      const timeoutSeconds = Number(typedArgs['timeoutSeconds'] ?? 45);
      if (!message) throw new McpError(ErrorCode.InvalidParams, 'message is required');

      const settings = await loadSettings();
      if (!settings.chatId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Chat ID not configured. Run teams_test_setup first.',
        );
      }

      // Step 1: Correlate runtime health
      let health: unknown;
      try {
        const resp = await fetch(STAMP_HEALTH_URL);
        health = await resp.json();
      } catch (e) {
        health = { error: String(e) };
      }

      // Step 2: Send message + poll for bot reply
      const sentAt = new Date();
      await graphPost(`/me/chats/${settings.chatId}/messages`, {
        body: { contentType: 'text', content: message },
      });

      const deadline = Date.now() + timeoutSeconds * 1000;
      let botReply: string | null = null;
      let elapsed = '';

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));

        const msgsResp = await graphGet<{ value: GraphMessage[] }>(
          `/me/chats/${settings.chatId}/messages?$top=10`,
        );

        for (const m of msgsResp.value) {
          if (m.from?.application && new Date(m.createdDateTime) > sentAt) {
            elapsed = ((Date.now() - sentAt.getTime()) / 1000).toFixed(1) + 's';
            botReply = (m.body?.content ?? '').replace(/<[^>]+>/g, '').trim();
            break;
          }
        }
        if (botReply !== null) break;
      }

      const correlationId = `MCP-${Date.now().toString(16).toUpperCase()}`;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                passed: botReply !== null,
                botReply: botReply ?? null,
                elapsed: botReply ? elapsed : `timeout after ${timeoutSeconds}s`,
                runtime: health,
                correlationId,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('[HelkinSwarm Teams Test Harness MCP] Server ready ✓\n');
