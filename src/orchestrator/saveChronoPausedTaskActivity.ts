import * as df from 'durable-functions';
import {
  SaveChronoPausedTaskInputSchema,
  saveChronoPausedTask,
  type SaveChronoPausedTaskInput,
} from './chronoBackplane.js';

df.app.activity('saveChronoPausedTaskActivity', {
  handler: async (rawInput: unknown): Promise<void> => {
    const input = SaveChronoPausedTaskInputSchema.parse(rawInput) as SaveChronoPausedTaskInput;
    try {
      await saveChronoPausedTask(input);
    } catch (err) {
      console.warn(
        `[saveChronoPausedTaskActivity] Skipping paused-task persistence after timeout/error: ${err instanceof Error ? err.message : err}`,
      );
    }
  },
});