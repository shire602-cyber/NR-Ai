import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getEnv, type Env } from "../config/env";

export type OcrClients = {
  anthropic: Anthropic | null;
  openai: OpenAI | null;
};

export function resolveOcrProviderKeys(env: Pick<Env, "ANTHROPIC_API_KEY" | "OPENAI_API_KEY">): {
  anthropicKey?: string;
  openaiKey?: string;
} {
  const anthropicKey =
    env.ANTHROPIC_API_KEY ||
    (env.OPENAI_API_KEY?.startsWith("sk-ant-") ? env.OPENAI_API_KEY : undefined);
  const openaiKey =
    env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith("sk-ant-")
      ? env.OPENAI_API_KEY
      : undefined;

  return { anthropicKey, openaiKey };
}

export function createOcrClients(env = getEnv()): OcrClients {
  const { anthropicKey, openaiKey } = resolveOcrProviderKeys(env);
  return {
    anthropic: anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null,
    openai: openaiKey ? new OpenAI({ apiKey: openaiKey }) : null,
  };
}

export function describeOcrProviders(clients: OcrClients): string {
  const providers = [
    clients.anthropic ? "Anthropic" : null,
    clients.openai ? "OpenAI" : null,
  ].filter(Boolean);
  return providers.length ? providers.join(" then ") : "no configured provider";
}

export function summarizeOcrProviderError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message || err);
  }
  return String(err);
}

export function formatProviderFailures(
  failures: Array<{ provider: "Anthropic" | "OpenAI"; error: unknown }>
): string {
  return failures
    .map((failure) => `${failure.provider}: ${summarizeOcrProviderError(failure.error)}`)
    .join("; ");
}
