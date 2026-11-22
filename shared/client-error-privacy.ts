// Invitation and auth tokens are 32-byte hex strings. Match percent-encoded hex as well.
const TOKEN = /(?:[\da-f]|%3[0-9]|%[46][1-6]){64}/gi;

export function redactClientErrorText(value: string): string {
  return value.replace(TOKEN, "[redacted]");
}

export function clientErrorPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return redactClientErrorText(new URL(value, "https://telemetry.invalid").pathname);
  } catch {
    return undefined;
  }
}
