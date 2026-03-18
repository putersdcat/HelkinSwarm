// Messages HTTP trigger — receives Teams webhook POST, routes through bot handler.
// Spec ref: 10-Teams-Interface.md

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import type { Activity } from 'botbuilder';
import { createAdapter } from '../bot/adapter.js';
import { HelkinSwarmBot } from '../bot/HelkinSwarmBot.js';

app.http('messages', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'messages',
  extraInputs: [df.input.durableClient()],
  handler: async (
    req: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> => {
    // GET = health probe / Bot Service ARM validation — return 200 immediately
    if (req.method === 'GET') {
      return { status: 200, body: 'Bot endpoint ready' };
    }

    context.log('Received bot message webhook');

    const adapter = createAdapter();
    const bot = new HelkinSwarmBot();

    // Inject the Durable client into the bot handler
    const durableClient = df.getClient(context);
    bot.setDurableClient(durableClient);

    const authHeader =
      req.headers.get('authorization') ??
      req.headers.get('Authorization') ??
      '';
    const activity = (await req.json()) as Activity;

    try {
      const invokeResponse = await adapter.processActivityForFunctions(
        authHeader,
        activity,
        async (turnContext) => {
          await bot.run(turnContext);
        },
      );

      if (invokeResponse) {
        return {
          status: invokeResponse.status,
          body: JSON.stringify(invokeResponse.body),
          headers: { 'Content-Type': 'application/json' },
        };
      }

      return { status: 200 };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      context.error('Bot processing error:', message);
      return { status: 500, body: JSON.stringify({ error: message }) };
    }
  },
});
