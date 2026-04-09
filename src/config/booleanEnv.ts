export function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return /^(1|true|yes|on)$/i.test(value.trim());
}
