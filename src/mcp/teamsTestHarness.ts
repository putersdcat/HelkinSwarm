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
import { fileURLToPath } from 'url';

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
const TOKEN_CACHE_PATH = join(REPO_ROOT, '.local', 'msal-cache.json');

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
let _cachedToken: string | null = null;

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
  if (_cachedToken) return _cachedToken;

  const app = getMsalApp();
  const accounts = await app.getTokenCache().getAllAccounts();

  if (accounts.length > 0) {
    try {
      const result = await app.acquireTokenSilent({
        scopes: GRAPH_SCOPES,
        account: accounts[0] as AccountInfo,
      });
      if (result?.accessToken) {
        _cachedToken = result.accessToken;
        return _cachedToken;
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
  _cachedToken = result.accessToken;
  return _cachedToken;
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

async function graphGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const resp = await fetch(`${GRAPH_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new McpError(ErrorCode.InternalError, `Graph GET ${path} failed: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<T>;
}

async function graphPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const resp = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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

interface GraphMessageFrom {
  user?: { displayName?: string; id?: string };
  application?: { displayName?: string; id?: string };
}

interface GraphMessage {
  id: string;
  createdDateTime: string;
  from?: GraphMessageFrom;
  body?: { content?: string; contentType?: string };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'helkin-teams-test-harness', version: '0.1.0' },
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
        '/me/chats?$expand=members&$top=100',
      );
      const chats = chatsResp.value;

      let botChat: GraphChat | undefined;
      let botUserId: string | undefined;

      for (const chat of chats) {
        if (chat.chatType !== 'oneOnOne') continue;
        for (const member of chat.members ?? []) {
          const name_lower = (member.displayName ?? '').toLowerCase();
          if (
            name_lower.includes(BOT_DISPLAY_NAME_HINT.toLowerCase()) ||
            name_lower.includes('helkin')
          ) {
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

      const msgsResp = await graphGet<{ value: GraphMessage[] }>(
        `/me/chats/${settings.chatId}/messages?$top=${count}`,
      );

      const lines = msgsResp.value
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
