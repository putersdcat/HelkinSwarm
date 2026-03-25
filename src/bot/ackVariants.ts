// Ack variants — rotating acknowledgment messages + Braille spinner.
// Prevents jarring repetition of "Working on it..." during processing.
// Fix: #143
// Spec ref: docs/ADDENDA/ADDENDA-04-Capability-Hot-Reload-Tool-Registry-and-Confirmation-Cards.md

// ---------------------------------------------------------------------------
// Rotating variants — round-robin with no immediate repetition
// ---------------------------------------------------------------------------

const ACK_VARIANTS = [
  '⌛ Working on it...',
  '⌛ Processing...',
  '⌛ Just a moment...',
  '⌛ On it...',
  '⌛ Let me check...',
  '⌛ Looking into that...',
  '⌛ Hold on...',
  '⌛ Handling it...',
  '⌛ Right away...',
  '⌛ Sorting it out...',
] as const;

let lastIndex = -1;

/** Returns a rotating ack message. Never repeats the previous one. */
export function getAckVariant(): string {
  let nextIndex: number;
  do {
    nextIndex = Math.floor(Math.random() * ACK_VARIANTS.length);
  } while (nextIndex === lastIndex && ACK_VARIANTS.length > 1);
  lastIndex = nextIndex;
  return ACK_VARIANTS[nextIndex]!;
}

/** Returns a correlated ack: rotating variant + compact correlation tag. */
export function getCorrelatedAck(correlationTag: string): string {
  return `${getAckVariant()} \`[corr:${correlationTag}]\``;
}

// ---------------------------------------------------------------------------
// Braille spinner — in-place update characters for long operations
// ---------------------------------------------------------------------------

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠦', '⠧', '⠇', '⠏'] as const;

let spinnerFrameIndex = 0;

/** Returns the next Braille spinner frame (cycles through all 9). */
export function nextSpinnerFrame(): string {
  const frame = BRAILLE_FRAMES[spinnerFrameIndex];
  spinnerFrameIndex = (spinnerFrameIndex + 1) % BRAILLE_FRAMES.length;
  return frame;
}

/** Resets spinner frame index (call when starting a new operation). */
export function resetSpinner(): void {
  spinnerFrameIndex = 0;
}

/** Builds a spinner ack string: "⠋ Processing..." */
export function getSpinnerAck(baseMessage?: string): string {
  const frame = nextSpinnerFrame();
  return `${frame} ${baseMessage ?? 'Processing...'}`;
}

/** Builds a correlated spinner update: "⠋ Still thinking... `[corr:abcd1234]`" */
export function getCorrelatedSpinnerAck(correlationTag: string, baseMessage?: string): string {
  const frame = nextSpinnerFrame();
  return `${frame} ${baseMessage ?? 'Still thinking...'} \`[corr:${correlationTag}]\``;
}
