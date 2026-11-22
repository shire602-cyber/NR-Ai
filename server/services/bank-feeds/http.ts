/** Shared HTTP and parsing helpers for bank adapters (injectable fetch for contract tests). */
import { toFils } from "../../../shared/money";
import { BankFeedProviderError, type FetchLike, type FeedTransaction } from "./types";

let fetchImpl: FetchLike | null = null;

/** Tests inject recorded sandbox-shaped responses; production uses global fetch. */
export function setBankFeedFetch(fn: FetchLike | null): void {
  fetchImpl = fn;
}

export function feedFetch(): FetchLike {
  if (fetchImpl) return fetchImpl;
  return (url, init) => fetch(url, init) as ReturnType<FetchLike>;
}

export function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export async function requestJson(
  provider: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<unknown> {
  let res;
  try {
    res = await feedFetch()(url, init);
  } catch (err) {
    throw new BankFeedProviderError(provider, 0, `Network error: ${(err as Error).message}`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      detail = "";
    }
    throw new BankFeedProviderError(provider, res.status, `HTTP ${res.status} ${detail}`.trim());
  }
  return res.json();
}

/** Provider amount (number or string, possibly > 2dp) -> fils; null when unreadable. */
export function amountFils(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const s = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  try {
    return toFils(s, { rounding: "halfUp" });
  } catch {
    return null;
  }
}

/** Provider date -> YYYY-MM-DD; null when it is not a real date. */
export function isoDay(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  const d = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const dt = new Date(`${d}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d) return null;
  return d;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function collect(
  rows: unknown[],
  map: (row: Record<string, unknown>) => FeedTransaction | string
): {
  transactions: FeedTransaction[];
  rejected: Array<{ externalId: string | null; reason: string }>;
} {
  const transactions: FeedTransaction[] = [];
  const rejected: Array<{ externalId: string | null; reason: string }> = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      rejected.push({ externalId: null, reason: "Not an object" });
      continue;
    }
    const row = raw as Record<string, unknown>;
    const out = map(row);
    if (typeof out === "string") {
      rejected.push({
        externalId: str(row.transaction_id ?? row.transactionId ?? row.id) || null,
        reason: out,
      });
    } else transactions.push(out);
  }
  return { transactions, rejected };
}
