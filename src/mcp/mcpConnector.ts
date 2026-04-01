import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CompatibilityCallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { join } from 'node:path';
import type { CapabilityManifest, ToolManifestEntry } from '../capabilities/manifestSchema.js';
import type { McpServerConfig } from '../capabilities/manifestSchema.js';
import type { ToolHandler } from '../capabilities/capabilityLoader.js';

type RegisterHandlerFn = (toolName: string, handler: ToolHandler) => void;

type RegisterMcpHandlersInput = {
	relativeSkillDir: string;
	manifest: CapabilityManifest;
	registerHandler: RegisterHandlerFn;
};

type McpToolDescriptor = {
	name: string;
	description?: string;
};

type McpClientState = {
	client: Client;
	transport: StdioClientTransport | StreamableHTTPClientTransport;
	timeoutMs: number;
	stderrLines: string[];
	remoteTools: Map<string, McpToolDescriptor>;
};

export interface McpSmokeTestResult {
	passed: boolean;
	toolCount: number;
	tools: McpToolDescriptor[];
	stderrLines: string[];
}

const clientStates = new Map<string, Promise<McpClientState>>();
const MAX_STDERR_LINES = 20;

export async function registerMcpHandlersForManifest(
	input: RegisterMcpHandlersInput,
): Promise<void> {
	for (const tool of input.manifest.tools) {
		input.registerHandler(
			tool.name,
			buildMcpBackedHandler(input.manifest.domain, tool, async (args) =>
				callRemoteTool(input.manifest, tool, args),
			),
		);
	}
}

export async function smokeTestMcpServerForManifest(
	manifest: CapabilityManifest,
): Promise<McpSmokeTestResult> {
	if (!manifest.mcpServer) {
		throw new Error(`Skill '${manifest.domain}' does not declare an MCP server.`);
	}

	const stderrLines: string[] = [];
	const transport = buildTransport(manifest.mcpServer, stderrLines);

	const client = new Client(
		{ name: `helkinswarm-${manifest.domain}-mcp-smoketest`, version: '1.0.0' },
		{ capabilities: {} },
	);

	try {
		await withTimeout(
			client.connect(transport),
			manifest.mcpServer.timeoutMs,
			`Timed out connecting to MCP server for skill '${manifest.domain}'.`,
		);

		const listToolsResult = await withTimeout(
			client.listTools(),
			manifest.mcpServer.timeoutMs,
			`Timed out listing tools from MCP server for skill '${manifest.domain}'.`,
		);

		const tools = listToolsResult.tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
		}));

		return {
			passed: tools.length > 0,
			toolCount: tools.length,
			tools,
			stderrLines: [...stderrLines],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const stderrSummary = stderrLines.length > 0 ? ` STDERR: ${stderrLines.join(' | ')}` : '';
		throw new Error(`MCP smoke test failed for skill '${manifest.domain}': ${message}.${stderrSummary}`);
	} finally {
		await safeCloseTransport(transport);
	}
}

function buildMcpBackedHandler(
	domain: string,
	tool: ToolManifestEntry,
	invoke: (args: Record<string, unknown>) => Promise<unknown>,
): ToolHandler {
	return async (args: Record<string, unknown>) => {
		try {
			return await invoke(args);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`MCP tool ${tool.name} (${domain}) failed: ${message}`);
		}
	};
}

async function callRemoteTool(
	manifest: CapabilityManifest,
	tool: ToolManifestEntry,
	args: Record<string, unknown>,
): Promise<unknown> {
	const state = await getOrCreateMcpClientState(manifest);
	const remoteToolName = tool.remoteToolName ?? tool.name;
	if (!state.remoteTools.has(remoteToolName)) {
		throw new Error(
			`MCP server for skill '${manifest.domain}' does not expose required tool '${remoteToolName}'.`,
		);
	}

	const result = await withTimeout(
		state.client.callTool(
			{
				name: remoteToolName,
				arguments: args,
			},
			CompatibilityCallToolResultSchema,
		),
		state.timeoutMs,
		`Timed out calling MCP tool '${remoteToolName}' after ${state.timeoutMs}ms.`,
	);

	if ('isError' in result && result.isError) {
		throw new Error(extractTextContent(result.content) || `Remote MCP tool '${remoteToolName}' returned an error.`);
	}

	if ('structuredContent' in result && result.structuredContent && Object.keys(result.structuredContent).length > 0) {
		return result.structuredContent;
	}

	if ('content' in result) {
		const textContent = extractTextContent(result.content);
		if (textContent) {
			const parsed = tryParseJson(textContent);
			if (parsed !== undefined) {
				return parsed;
			}
			return { text: textContent };
		}

		return {
			content: result.content,
			isError: result.isError ?? false,
		};
	}

	if ('toolResult' in result) {
		return result.toolResult;
	}

	return result;
}

async function getOrCreateMcpClientState(
	manifest: CapabilityManifest,
): Promise<McpClientState> {
	const cacheKey = manifest.domain;
	const existing = clientStates.get(cacheKey);
	if (existing) {
		return existing;
	}

	const created = createMcpClientState(manifest).catch((error) => {
		clientStates.delete(cacheKey);
		throw error;
	});
	clientStates.set(cacheKey, created);
	return created;
}

async function createMcpClientState(
	manifest: CapabilityManifest,
): Promise<McpClientState> {
	if (!manifest.mcpServer) {
		throw new Error(`Skill '${manifest.domain}' does not declare an MCP server.`);
	}

	const stderrLines: string[] = [];
	const transport = buildTransport(manifest.mcpServer, stderrLines);

	const client = new Client(
		{ name: `helkinswarm-${manifest.domain}-mcp-client`, version: '1.0.0' },
		{ capabilities: {} },
	);

	try {
		await withTimeout(
			client.connect(transport),
			manifest.mcpServer.timeoutMs,
			`Timed out connecting to MCP server for skill '${manifest.domain}'.`,
		);

		const listToolsResult = await withTimeout(
			client.listTools(),
			manifest.mcpServer.timeoutMs,
			`Timed out listing tools from MCP server for skill '${manifest.domain}'.`,
		);

		const remoteTools = new Map(
			listToolsResult.tools.map((listedTool) => [listedTool.name, { name: listedTool.name, description: listedTool.description }]),
		);

		return {
			client,
			transport,
			timeoutMs: manifest.mcpServer.timeoutMs,
			stderrLines,
			remoteTools,
		};
	} catch (error) {
		await safeCloseTransport(transport);
		const message = error instanceof Error ? error.message : String(error);
		const stderrSummary = stderrLines.length > 0
			? ` STDERR: ${stderrLines.join(' | ')}`
			: '';
		throw new Error(`Failed to initialize MCP server for skill '${manifest.domain}': ${message}.${stderrSummary}`);
	}
}

function bindStderrCapture(transport: StdioClientTransport, stderrLines: string[]): void {
	const stderr = transport.stderr;
	if (!stderr) {
		return;
	}

	stderr.on('data', (chunk) => {
		const text = String(chunk).trim();
		if (!text) {
			return;
		}

		stderrLines.push(text);
		if (stderrLines.length > MAX_STDERR_LINES) {
			stderrLines.splice(0, stderrLines.length - MAX_STDERR_LINES);
		}
	});
}

function buildTransport(
	config: McpServerConfig,
	stderrLines: string[],
): StdioClientTransport | StreamableHTTPClientTransport {
	if (config.transport === 'stdio') {
		const transport = new StdioClientTransport(resolveServerParameters(config));
		bindStderrCapture(transport, stderrLines);
		return transport;
	}

	return new StreamableHTTPClientTransport(new URL(config.url), {
		requestInit: {
			headers: config.headers,
		},
	});
}

function resolveServerParameters(config: Extract<McpServerConfig, { transport: 'stdio' }>): StdioServerParameters {
	const inheritedEnv = Object.fromEntries(
		Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	);

	return {
		command: interpolateWorkspaceRoot(config.command),
		args: config.args.map(interpolateWorkspaceRoot),
		cwd: config.cwd ? interpolateWorkspaceRoot(config.cwd) : process.cwd(),
		env: {
			...inheritedEnv,
			...Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, interpolateWorkspaceRoot(value)])),
		},
		stderr: 'pipe',
	};
}

function interpolateWorkspaceRoot(value: string): string {
	return value.replaceAll('${workspaceRoot}', process.cwd()).replaceAll('${distRoot}', join(process.cwd(), 'dist'));
}

function extractTextContent(content: unknown): string {
	if (!Array.isArray(content)) {
		return '';
	}

	return content
		.filter((item): item is { type?: string; text?: string } =>
			typeof item === 'object'
			&& item !== null
			&& 'type' in item
			&& 'text' in item,
		)
		.filter((item) => item.type === 'text' && typeof item.text === 'string')
		.map((item) => item.text?.trim() ?? '')
		.filter((item) => item.length > 0)
		.join('\n\n');
}

function tryParseJson(value: string): unknown | undefined {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	timeoutMessage: string,
): Promise<T> {
	let timeoutHandle: NodeJS.Timeout | undefined;

	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
			}),
		]);
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	}
}

async function safeCloseTransport(
	transport: StdioClientTransport | StreamableHTTPClientTransport,
): Promise<void> {
	try {
		await transport.close();
	} catch {
		// Best-effort cleanup only.
	}
}
