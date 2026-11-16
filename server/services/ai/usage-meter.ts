// AI usage metering, monthly caps and a small prompt cache (R05-26).
//
// Every model call made through `createMeteredOpenAI` (or `recordAiUsage` for direct
// provider calls) lands in ai_usage_events. Before a call, `assertAiQuota` compares the
// company's month-to-date tokens/cost with its ai_usage_limits row (or env defaults) and
// throws a 429 AI_QUOTA_EXCEEDED error. Storage failures never block a request: metering
// is best-effort and logged.

import { createHash } from "crypto";
import type OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import type { Pool } from "pg";
import { errorCode, errorProperty, errorStatus } from "../../errors";
import { createLogger } from "../../config/logger";
import { resolveModel, type AiTask } from "./model-router";
import { createRedactor, isRedactionEnabled, redactMessages } from "./redact";

const log = createLogger("ai-usage");

export type AiProvider = "openai" | "anthropic" | "local";

export interface AiContext {
  companyId?: string | null;
  userId?: string | null;
  task: AiTask;
  /** Names to mask when AI_REDACT_PII is enabled. */
  redactNames?: string[];
}

export interface UsageEvent {
  companyId: string | null;
  userId: string | null;
  task: AiTask;
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageLimits {
  monthlyTokenCap: number | null;
  monthlyCostCapUsd: number | null;
}

export interface UsageTotals {
  tokens: number;
  costUsd: number;
}

export interface UsageStore {
  insert(event: UsageEvent): Promise<void>;
  monthToDate(companyId: string, since: Date): Promise<UsageTotals>;
  getLimits(companyId: string): Promise<UsageLimits | null>;
}

// ---- errors -------------------------------------------------------------------

export class AiQuotaExceededError extends Error {
  status = 429;
  code = "AI_QUOTA_EXCEEDED";
  constructor(
    message: string,
    public readonly detail: {
      tokens: number;
      costUsd: number;
      tokenCap: number | null;
      costCapUsd: number | null;
    }
  ) {
    super(message);
    this.name = "AiQuotaExceededError";
  }
}

export class AiNotConfiguredError extends Error {
  status = 503;
  code = "AI_NOT_CONFIGURED";
  constructor(message = "AI service not configured — set OPENAI_API_KEY") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

/** Body fields for an AI error response: stable code for 503/429. */
export function aiErrorBody(error: unknown): { code?: string; usage?: unknown } {
  if (errorCode(error) === "AI_QUOTA_EXCEEDED") {
    return { code: "AI_QUOTA_EXCEEDED", usage: errorProperty(error, "detail") };
  }
  if (errorStatus(error) === 503) return { code: "AI_NOT_CONFIGURED" };
  return {};
}

// ---- pricing ------------------------------------------------------------------

/** USD per 1M tokens [input, output]. Unknown models fall back to the gpt-4o price. */
const PRICES: Array<[RegExp, [number, number]]> = [
  [/gpt-4o-mini/i, [0.15, 0.6]],
  [/gpt-4\.1-mini/i, [0.4, 1.6]],
  [/gpt-4o/i, [2.5, 10]],
  [/gpt-3\.5/i, [0.5, 1.5]],
  [/claude.*haiku/i, [0.8, 4]],
  [/claude.*opus/i, [15, 75]],
  [/claude/i, [3, 15]],
];

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES.find(([re]) => re.test(model))?.[1] ?? [2.5, 10];
  const cost = (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

// ---- store --------------------------------------------------------------------

const DEFAULT_MONTHLY_TOKEN_CAP = 5_000_000;
const DEFAULT_MONTHLY_COST_CAP_USD = 100;

let store: UsageStore | null = null;

export function setUsageStore(next: UsageStore | null): void {
  store = next;
}

function pgStore(): UsageStore {
  const getPool = async (): Promise<Pool> => (await import("../../db")).pool;
  return {
    async insert(e) {
      const pool = await getPool();
      await pool.query(
        `INSERT INTO ai_usage_events
           (company_id, user_id, task, provider, model, input_tokens, output_tokens, cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          e.companyId,
          e.userId,
          e.task,
          e.provider,
          e.model,
          e.inputTokens,
          e.outputTokens,
          e.costUsd,
        ]
      );
    },
    async monthToDate(companyId, since) {
      const pool = await getPool();
      const r = await pool.query(
        `SELECT COALESCE(SUM(input_tokens + output_tokens),0)::float8 AS tokens,
                COALESCE(SUM(cost_usd),0)::float8 AS cost
           FROM ai_usage_events WHERE company_id = $1 AND created_at >= $2`,
        [companyId, since]
      );
      return { tokens: Number(r.rows[0]?.tokens ?? 0), costUsd: Number(r.rows[0]?.cost ?? 0) };
    },
    async getLimits(companyId) {
      const pool = await getPool();
      const r = await pool.query(
        `SELECT monthly_token_cap, monthly_cost_cap_usd FROM ai_usage_limits WHERE company_id = $1`,
        [companyId]
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        monthlyTokenCap: row.monthly_token_cap === null ? null : Number(row.monthly_token_cap),
        monthlyCostCapUsd:
          row.monthly_cost_cap_usd === null ? null : Number(row.monthly_cost_cap_usd),
      };
    },
  };
}

const noopStore: UsageStore = {
  async insert() {},
  async monthToDate() {
    return { tokens: 0, costUsd: 0 };
  },
  async getLimits() {
    return null;
  },
};

function getStore(): UsageStore {
  // Unit tests run without the metering tables; they opt in with setUsageStore().
  if (!store) store = process.env.NODE_ENV === "test" ? noopStore : pgStore();
  return store;
}

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Effective caps: company row, else env, else built-in defaults. 0 means unlimited. */
export async function resolveLimits(companyId: string): Promise<UsageLimits> {
  let row: UsageLimits | null = null;
  try {
    row = await getStore().getLimits(companyId);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Could not read ai_usage_limits; using defaults");
  }
  const tokenCap =
    row?.monthlyTokenCap ?? envNumber("AI_MONTHLY_TOKEN_CAP") ?? DEFAULT_MONTHLY_TOKEN_CAP;
  const costCap =
    row?.monthlyCostCapUsd ?? envNumber("AI_MONTHLY_COST_CAP_USD") ?? DEFAULT_MONTHLY_COST_CAP_USD;
  return {
    monthlyTokenCap: tokenCap === 0 ? null : tokenCap,
    monthlyCostCapUsd: costCap === 0 ? null : costCap,
  };
}

/** Throws AiQuotaExceededError (429) when the company has used up its monthly cap. */
export async function assertAiQuota(companyId: string | null | undefined): Promise<void> {
  if (!companyId) return;
  const limits = await resolveLimits(companyId);
  if (limits.monthlyTokenCap === null && limits.monthlyCostCapUsd === null) return;
  let totals: UsageTotals;
  try {
    totals = await getStore().monthToDate(companyId, monthStart());
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Could not read AI usage; skipping quota check");
    return;
  }
  const overTokens = limits.monthlyTokenCap !== null && totals.tokens >= limits.monthlyTokenCap;
  const overCost = limits.monthlyCostCapUsd !== null && totals.costUsd >= limits.monthlyCostCapUsd;
  if (overTokens || overCost) {
    throw new AiQuotaExceededError("Monthly AI usage limit reached for this company", {
      tokens: totals.tokens,
      costUsd: totals.costUsd,
      tokenCap: limits.monthlyTokenCap,
      costCapUsd: limits.monthlyCostCapUsd,
    });
  }
}

export async function recordAiUsage(
  ctx: AiContext,
  provider: AiProvider,
  model: string,
  usage: { inputTokens?: number; outputTokens?: number }
): Promise<UsageEvent> {
  const inputTokens = Math.max(0, Math.round(usage.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(usage.outputTokens ?? 0));
  const event: UsageEvent = {
    companyId: ctx.companyId ?? null,
    userId: ctx.userId ?? null,
    task: ctx.task,
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(model, inputTokens, outputTokens),
  };
  try {
    await getStore().insert(event);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Failed to record AI usage event");
  }
  return event;
}

// ---- prompt cache -------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const promptCache = new Map<string, { at: number; value: unknown }>();

export function clearPromptCache(): void {
  promptCache.clear();
}

function cacheKey(ctx: AiContext, params: Record<string, unknown>): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        c: ctx.companyId ?? null,
        m: params.model,
        msgs: params.messages,
        t: params.temperature ?? null,
        rf: params.response_format ?? null,
        mt: params.max_tokens ?? null,
      })
    )
    .digest("hex");
}

// ---- metered OpenAI client ----------------------------------------------------

/** Chat params a metered caller passes; `model` defaults to the task's routed model. */
export type MeteredChatParams = Omit<ChatCompletionCreateParamsNonStreaming, "model"> & {
  model?: string;
};
export type MeteredChatStreamParams = Omit<ChatCompletionCreateParamsStreaming, "model"> & {
  model?: string;
};

export interface MeteredOpenAI {
  chat: {
    completions: {
      create(params: MeteredChatStreamParams): Promise<AsyncIterable<ChatCompletionChunk>>;
      create(params: MeteredChatParams): Promise<ChatCompletion>;
    };
  };
}

/**
 * Wrap an OpenAI client so every call is quota-checked, optionally PII-redacted,
 * cached (deterministic low-temperature calls only) and recorded in ai_usage_events.
 */
export function createMeteredOpenAI(client: OpenAI, ctx: AiContext): MeteredOpenAI {
  async function create(
    rawParams: MeteredChatParams | MeteredChatStreamParams
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    await assertAiQuota(ctx.companyId);

    const model: string = rawParams.model || resolveModel(ctx.task);
    let params = { ...rawParams, model };
    const redactor = isRedactionEnabled() ? createRedactor({ names: ctx.redactNames }) : null;
    if (redactor && Array.isArray(params.messages)) {
      params = { ...params, messages: redactMessages(params.messages, redactor) };
    }

    const promptText = JSON.stringify(params.messages ?? "");

    if (params.stream) {
      const upstream = await client.chat.completions.create({
        ...params,
        stream: true,
        stream_options: { include_usage: true },
      });
      return meterStream(upstream, ctx, model, promptText, redactor);
    }

    const plainParams = params as ChatCompletionCreateParamsNonStreaming;
    const cacheable = typeof plainParams.temperature === "number" && plainParams.temperature <= 0.3;
    const key = cacheable ? cacheKey(ctx, { ...plainParams }) : null;
    if (key) {
      const hit = promptCache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as ChatCompletion;
    }

    const response = await client.chat.completions.create(plainParams);
    const inputTokens = response?.usage?.prompt_tokens ?? estimateTokens(promptText);
    const content = response?.choices?.[0]?.message?.content ?? "";
    const outputTokens = response?.usage?.completion_tokens ?? estimateTokens(content);
    await recordAiUsage(ctx, "openai", model, { inputTokens, outputTokens });

    if (redactor && response?.choices) {
      for (const choice of response.choices) {
        if (typeof choice?.message?.content === "string") {
          choice.message.content = redactor.restore(choice.message.content);
        }
      }
    }
    if (key) {
      if (promptCache.size >= CACHE_MAX) {
        const oldest = promptCache.keys().next().value;
        if (oldest) promptCache.delete(oldest);
      }
      promptCache.set(key, { at: Date.now(), value: response });
    }
    return response;
  }

  return {
    chat: {
      completions: {
        // One implementation behind the stream / non-stream overloads.
        create: create as MeteredOpenAI["chat"]["completions"]["create"],
      },
    },
  };
}

async function* meterStream(
  upstream: AsyncIterable<ChatCompletionChunk>,
  ctx: AiContext,
  model: string,
  promptText: string,
  redactor: ReturnType<typeof createRedactor> | null
): AsyncGenerator<ChatCompletionChunk> {
  let outputChars = 0;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  try {
    for await (const chunk of upstream) {
      if (chunk?.usage) usage = chunk.usage;
      const delta = chunk?.choices?.[0]?.delta;
      if (delta && typeof delta.content === "string") {
        outputChars += delta.content.length;
        if (redactor) delta.content = redactor.restore(delta.content);
      }
      yield chunk;
    }
  } finally {
    await recordAiUsage(ctx, "openai", model, {
      inputTokens: usage?.prompt_tokens ?? estimateTokens(promptText),
      outputTokens: usage?.completion_tokens ?? Math.ceil(outputChars / 4),
    });
  }
}

/** Month-to-date usage summary for a company (admin/diagnostics). */
export async function getUsageSummary(companyId: string): Promise<{
  tokens: number;
  costUsd: number;
  limits: UsageLimits;
}> {
  const [totals, limits] = await Promise.all([
    getStore().monthToDate(companyId, monthStart()),
    resolveLimits(companyId),
  ]);
  return { ...totals, limits };
}
