const BOT_FRAMEWORK_MAGIC_CODE_PATTERN = /^[a-f0-9]{32}$/i;

export function isLikelyBotFrameworkMagicCode(text: string): boolean {
  return BOT_FRAMEWORK_MAGIC_CODE_PATTERN.test(text.trim());
}