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
import {
  recordMessagePathFailure,
  recordMessagePathStart,
  recordMessagePathSuccess,
} from '../observability/messagePathHealth.js';

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

  const turnId = crypto.randomUUID();
  recordMessagePathStart(turnId);

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

    // Teams retries the webhook POST if 200 isn't returned within ~15s (#300).
    // Use Promise.race with a 14s timeout so normal slash-command / immediate-reply
    // turns get more time to complete before we fall back to background execution.
    // If the handler is still running when the timeout fires, processing continues
    // in the background (Container Apps keeps the Node.js process alive).
    const EARLY_RESPONSE_MS = 14_000;

    const adapterPromise = adapter.processActivityForFunctions(
      authHeader,
      activity,
      async (turnContext) => {
        await bot.run(turnContext);
      },
    );

    let timeoutHandle: ReturnType<typeof setTimeout>;

    try {
      const result = await Promise.race([
        adapterPromise.then((r) => {
          clearTimeout(timeoutHandle);
          return { timedOut: false as const, response: r };
        }),
        new Promise<{ timedOut: true }>((resolve) => {
          timeoutHandle = setTimeout(
            () => resolve({ timedOut: true }),
            EARLY_RESPONSE_MS,
          );
        }),
      ]);

      if (result.timedOut) {
        context.warn(
          '[messages] Handler exceeded 9s — returning 200 early to prevent Teams retry',
        );
        // Track completion/failure in background — don't await
        void adapterPromise
          .then(() => recordMessagePathSuccess(turnId))
          .catch((bgErr: unknown) => {
            const msg =
              bgErr instanceof Error ? bgErr.message : String(bgErr);
            context.error('[messages] Background processing error:', msg);
            void recordMessagePathFailure(turnId, msg);
          });
        return { status: 200 };
      }

      if (result.response) {
        await recordMessagePathSuccess(turnId);
        return {
          status: result.response.status,
          body: JSON.stringify(result.response.body),
          headers: { 'Content-Type': 'application/json' },
        };
      }

      await recordMessagePathSuccess(turnId);
      return { status: 200 };
    } catch (err: unknown) {
      clearTimeout(timeoutHandle!);
      const message = err instanceof Error ? err.message : String(err);
      await recordMessagePathFailure(turnId, message);
      context.error('Bot processing error:', message);
      return { status: 500, body: JSON.stringify({ error: message }) };
    }
  },
});
