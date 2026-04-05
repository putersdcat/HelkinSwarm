import * as df from 'durable-functions';
import { z } from 'zod';
import { trackEvent, type TelemetryEventName } from '../observability/telemetry.js';

const TelemetryPropertyValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const TelemetryEventNameSchema = z.custom<TelemetryEventName>(
  (value): value is TelemetryEventName => typeof value === 'string' && value.length > 0,
  'Telemetry event name is required',
);

const EmitOrchestratorTelemetryInputSchema = z.object({
  name: TelemetryEventNameSchema,
  correlationId: z.string().min(1),
  userId: z.string().min(1).optional(),
  properties: z.record(TelemetryPropertyValueSchema).optional(),
});

export type EmitOrchestratorTelemetryInput = z.infer<typeof EmitOrchestratorTelemetryInputSchema>;

export async function emitOrchestratorTelemetry(rawInput: unknown): Promise<void> {
  const input = EmitOrchestratorTelemetryInputSchema.parse(rawInput);
  trackEvent(input);
}

df.app.activity('emitOrchestratorTelemetryActivity', {
  handler: async (rawInput: unknown): Promise<void> => {
    await emitOrchestratorTelemetry(rawInput);
  },
});