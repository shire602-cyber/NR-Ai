// Per-task model routing (R05-21). Models are configurable through
// AI_MODEL_CATEGORIZE / AI_MODEL_OCR / AI_MODEL_ADVISORY / AI_MODEL_NL.
// The legacy AI_MODEL variable only applies to tasks without an explicit value,
// and the built-in defaults no longer include gpt-3.5-turbo.

export type AiTask = "categorize" | "ocr" | "advisory" | "nl";

export const AI_TASKS: readonly AiTask[] = ["categorize", "ocr", "advisory", "nl"] as const;

export const DEFAULT_MODELS: Record<AiTask, string> = {
  categorize: "gpt-4o-mini", // small, cheap, high-volume
  ocr: "gpt-4o", // vision
  advisory: "gpt-4o", // CFO advice, forecasting, anomaly narrative
  nl: "gpt-4o", // natural-language gateway / assistant
};

export const DEFAULT_ANTHROPIC_OCR_MODEL = "claude-sonnet-4-6";

const TASK_ENV: Record<AiTask, string> = {
  categorize: "AI_MODEL_CATEGORIZE",
  ocr: "AI_MODEL_OCR",
  advisory: "AI_MODEL_ADVISORY",
  nl: "AI_MODEL_NL",
};

type EnvLike = Record<string, string | undefined>;

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Resolve the OpenAI-compatible model for a task. */
export function resolveModel(task: AiTask, env: EnvLike = process.env): string {
  return clean(env[TASK_ENV[task]]) ?? clean(env.AI_MODEL) ?? DEFAULT_MODELS[task];
}

/**
 * Resolve the OCR/vision model for a provider. AI_MODEL_OCR applies to the provider
 * its name belongs to (claude-* -> Anthropic, anything else -> OpenAI).
 */
export function resolveOcrModel(
  provider: "anthropic" | "openai",
  env: EnvLike = process.env
): string {
  const configured = clean(env[TASK_ENV.ocr]);
  const isClaude = configured ? /^claude/i.test(configured) : false;
  if (provider === "anthropic") {
    return configured && isClaude ? configured : DEFAULT_ANTHROPIC_OCR_MODEL;
  }
  return configured && !isClaude ? configured : DEFAULT_MODELS.ocr;
}

/** Models a client may request on /api/ask (cost-controlled allow-list). */
export function allowedClientModels(env: EnvLike = process.env): string[] {
  return Array.from(new Set(["gpt-4o-mini", resolveModel("nl", env)]));
}

export function providerForModel(model: string): "anthropic" | "openai" {
  return /^claude/i.test(model) ? "anthropic" : "openai";
}
