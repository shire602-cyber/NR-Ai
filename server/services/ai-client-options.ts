const DEFAULT_AI_SDK_TIMEOUT_MS = 60_000;

export function aiSdkTimeoutMs(): number {
  const raw = process.env.AI_SDK_TIMEOUT_MS;
  if (!raw) return DEFAULT_AI_SDK_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_SDK_TIMEOUT_MS;
}

export function openAiClientOptions(apiKey: string, extra: Record<string, unknown> = {}) {
  return {
    apiKey,
    timeout: aiSdkTimeoutMs(),
    ...extra,
  };
}

export function anthropicClientOptions(apiKey: string) {
  return {
    apiKey,
    timeout: aiSdkTimeoutMs(),
  };
}
