#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'helkinswarm-reference-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'mcpreference_echo',
      description: 'Echo a message through the reference MCP server.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to echo back.' },
        },
        required: ['message'],
      },
    },
    {
      name: 'mcpreference_uppercase',
      description: 'Convert input text to uppercase through the reference MCP server.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to transform.' },
        },
        required: ['text'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};

  switch (name) {
    case 'mcpreference_echo': {
      const message = typeof args.message === 'string' ? args.message : '';
      if (!message) {
        throw new McpError(ErrorCode.InvalidParams, 'message is required');
      }

      return {
        structuredContent: {
          echoed: message,
          echoedLength: message.length,
          via: 'reference-mcp',
        },
        content: [{ type: 'text', text: JSON.stringify({ echoed: message, via: 'reference-mcp' }) }],
      };
    }

    case 'mcpreference_uppercase': {
      const text = typeof args.text === 'string' ? args.text : '';
      if (!text) {
        throw new McpError(ErrorCode.InvalidParams, 'text is required');
      }

      return {
        structuredContent: {
          original: text,
          uppercased: text.toUpperCase(),
          via: 'reference-mcp',
        },
        content: [{ type: 'text', text: JSON.stringify({ original: text, uppercased: text.toUpperCase() }) }],
      };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
