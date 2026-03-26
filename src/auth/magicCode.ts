const BOT_FRAMEWORK_HEX_CODE_PATTERN = /\b[a-f0-9]{32}\b/i;
const BOT_FRAMEWORK_NUMERIC_CODE_PATTERN = /\b\d{6}\b/;

export function extractBotFrameworkAuthCode(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  const hexMatch = trimmed.match(BOT_FRAMEWORK_HEX_CODE_PATTERN);
  if (hexMatch?.[0]) {
    return hexMatch[0];
  }

  const numericMatch = trimmed.match(BOT_FRAMEWORK_NUMERIC_CODE_PATTERN);
  return numericMatch?.[0];
}