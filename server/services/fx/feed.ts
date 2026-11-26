/**
 * Exchange-rate feed (W5-C: R14-14).
 *
 * Provider adapters turn a published payload into SYSTEM rate rows (company_id NULL) with the
 * provider as `source` and the rate type `spot`:
 *
 *  - CBUAE: the Central Bank of the UAE's published "AED per 1 unit" table. Rows are stored
 *    canonically as (CUR, AED, rate). Parsed from the HTML table (currency name + rate) or a
 *    JSON array [{ currency | code, rate }] — see tests/fixtures/fx-feed/.
 *  - ECB: the European Central Bank euro reference rates XML (eurofxref-daily). Rows are stored
 *    as published: (EUR, CUR, rate) = "1 EUR = rate CUR". The ECB does not publish AED; cross
 *    rates are not derived.
 *
 * The feed is ENABLED ONLY when FX_RATE_FEED is set ("cbuae", "ecb" or "cbuae,ecb"); otherwise
 * the `fx_rate_feed` capability reports requires_external and the scheduled job does nothing.
 * Provider URLs come from FX_RATE_FEED_CBUAE_URL / FX_RATE_FEED_ECB_URL (the ECB default is
 * its public daily file). Every write goes through saveRate (ISO codes, rate > 0, not future,
 * 20% sanity band — a suspicious jump is skipped and reported, never written). Every run is
 * logged in fx_rate_feed_runs. Admins can also upload a CSV of system rates.
 */
import { todayDubai } from "@shared/accounting-date";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { fxRateFeedRuns } from "../../../shared/schema";
import { getCapability } from "../../../shared/capabilities";
import { createLogger } from "../../config/logger";
import { DomainError } from "../../errors";
import { listJobs, registerJob } from "../../platform/job-registry";
import { ISO_4217_CODES } from "../../../shared/validators/primitives";
import { saveRate } from "./rates";

const log = createLogger("fx-feed");
const ISO = new Set<string>(ISO_4217_CODES);

export const FEED_PROVIDERS = ["cbuae", "ecb"] as const;
export type FeedProvider = (typeof FEED_PROVIDERS)[number];
export const ECB_DEFAULT_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export interface ParsedRate {
  from: string;
  to: string;
  rate: string;
}
export interface ParsedFeed {
  provider: FeedProvider | "csv";
  date: string;
  rates: ParsedRate[];
  rejected: Array<{ value: string; reason: string }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /^\d+(\.\d+)?$/;

// ─── ECB ───────────────────────────────────────────────────────────────────

export function parseEcbXml(xml: string): ParsedFeed {
  const time = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/i.exec(xml);
  if (!time)
    throw new DomainError(
      "FEED_PARSE_ERROR",
      422,
      { provider: "ecb" },
      "No ECB reference date found"
    );
  const rates: ParsedRate[] = [];
  const rejected: ParsedFeed["rejected"] = [];
  const re = /<Cube\s+currency=['"]([A-Za-z]{3})['"]\s+rate=['"]([^'"]+)['"]\s*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const cur = m[1].toUpperCase();
    const rate = m[2].trim();
    if (!ISO.has(cur)) rejected.push({ value: cur, reason: "UNKNOWN_CURRENCY" });
    else if (!RATE_RE.test(rate) || Number(rate) <= 0)
      rejected.push({ value: `${cur}=${rate}`, reason: "INVALID_RATE" });
    else rates.push({ from: "EUR", to: cur, rate });
  }
  if (!rates.length)
    throw new DomainError("FEED_PARSE_ERROR", 422, { provider: "ecb" }, "No ECB rates found");
  return { provider: "ecb", date: time[1], rates, rejected };
}

// ─── CBUAE ─────────────────────────────────────────────────────────────────

/** Currency names as printed in the CBUAE table → ISO 4217. */
export const CBUAE_NAMES: Record<string, string> = {
  "us dollar": "USD",
  euro: "EUR",
  "british pound": "GBP",
  "pound sterling": "GBP",
  "japanese yen": "JPY",
  "swiss franc": "CHF",
  "indian rupee": "INR",
  "pakistani rupee": "PKR",
  "saudi riyal": "SAR",
  "qatari riyal": "QAR",
  "kuwaiti dinar": "KWD",
  "bahraini dinar": "BHD",
  "omani rial": "OMR",
  "chinese yuan": "CNY",
  "canadian dollar": "CAD",
  "australian dollar": "AUD",
  "egyptian pound": "EGP",
  "jordanian dinar": "JOD",
  "philippine peso": "PHP",
  "singapore dollar": "SGD",
  "hong kong dollar": "HKD",
  "south african rand": "ZAR",
  "turkish lira": "TRY",
  "swedish krona": "SEK",
  "norwegian krone": "NOK",
  "danish krone": "DKK",
  "sri lankan rupee": "LKR",
  "bangladeshi taka": "BDT",
};

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

function cbuaeDate(text: string): string | null {
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1];
  const dmy = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(text);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function cbuaeCode(label: string): string | null {
  const t = label.trim();
  const code = /\b([A-Z]{3})\b/.exec(t);
  if (code && ISO.has(code[1])) return code[1];
  return CBUAE_NAMES[t.toLowerCase()] ?? null;
}

/** CBUAE "AED per 1 unit" table → (CUR, AED, rate) rows. `fallbackDate` when none is printed. */
export function parseCbuae(payload: string, fallbackDate?: string): ParsedFeed {
  const trimmed = payload.trim();
  const rates: ParsedRate[] = [];
  const rejected: ParsedFeed["rejected"] = [];
  let date: string | null = null;
  const push = (label: string, rateRaw: string) => {
    const cur = cbuaeCode(label);
    const rate = rateRaw.replace(/,/g, "").trim();
    if (!cur) rejected.push({ value: label, reason: "UNKNOWN_CURRENCY" });
    else if (cur === "AED") rejected.push({ value: label, reason: "SAME_CURRENCY" });
    else if (!RATE_RE.test(rate) || Number(rate) <= 0)
      rejected.push({ value: `${label}=${rateRaw}`, reason: "INVALID_RATE" });
    else rates.push({ from: cur, to: "AED", rate });
  };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new DomainError("FEED_PARSE_ERROR", 422, { provider: "cbuae" }, "Invalid CBUAE JSON");
    }
    const obj = (Array.isArray(data) ? { rates: data } : data) as {
      date?: string;
      rates?: Array<Record<string, unknown>>;
    };
    date = typeof obj.date === "string" ? cbuaeDate(obj.date) : null;
    for (const r of obj.rates ?? []) {
      push(String(r.code ?? r.currency ?? r.name ?? ""), String(r.rate ?? r.value ?? ""));
    }
  } else {
    date =
      cbuaeDate(stripTags(/(?:date|updated)[^<]{0,80}/i.exec(trimmed)?.[0] ?? "")) ??
      cbuaeDate(/data-date=['"]([^'"]+)['"]/i.exec(trimmed)?.[1] ?? "");
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(trimmed))) {
      const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        stripTags(c[1])
      );
      if (cells.length < 2 || /currency/i.test(cells[0])) continue;
      push(cells[0], cells[cells.length - 1]);
    }
  }
  date = date ?? fallbackDate ?? null;
  if (!date || !DATE_RE.test(date)) {
    throw new DomainError(
      "FEED_PARSE_ERROR",
      422,
      { provider: "cbuae" },
      "No CBUAE rate date found"
    );
  }
  if (!rates.length)
    throw new DomainError("FEED_PARSE_ERROR", 422, { provider: "cbuae" }, "No CBUAE rates found");
  return { provider: "cbuae", date, rates, rejected };
}

// ─── CSV (admin import) ────────────────────────────────────────────────────

/** "date,from,to,rate[,rate_type]" with a header row; one system rate per line. */
export function parseRateCsv(csv: string): Array<ParsedRate & { date: string; rateType?: string }> {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new DomainError("CSV_EMPTY", 400);
  const head = lines[0]
    .toLowerCase()
    .split(",")
    .map((h) => h.trim());
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iDate = idx(["date", "effective_date", "effectivedate"]);
  const iFrom = idx(["from", "base", "base_currency", "from_currency"]);
  const iTo = idx(["to", "target", "target_currency", "to_currency"]);
  const iRate = idx(["rate"]);
  const iType = idx(["rate_type", "ratetype", "type"]);
  if ([iDate, iFrom, iTo, iRate].some((i) => i < 0)) {
    throw new DomainError("CSV_HEADER_INVALID", 400, { expected: "date,from,to,rate[,rate_type]" });
  }
  if (lines.length > 5001) throw new DomainError("CSV_TOO_LARGE", 400, { maxRows: 5000 });
  return lines.slice(1).map((l) => {
    const c = l.split(",").map((x) => x.trim());
    return {
      date: c[iDate],
      from: (c[iFrom] ?? "").toUpperCase(),
      to: (c[iTo] ?? "").toUpperCase(),
      rate: c[iRate] ?? "",
      ...(iType >= 0 && c[iType] ? { rateType: c[iType].toLowerCase() } : {}),
    };
  });
}

// ─── Configuration ─────────────────────────────────────────────────────────

export function configuredProviders(env: NodeJS.ProcessEnv = process.env): FeedProvider[] {
  const raw = (env.FX_RATE_FEED ?? "").toLowerCase();
  return FEED_PROVIDERS.filter((p) => raw.split(/[\s,]+/).includes(p));
}

export function providerUrl(p: FeedProvider, env: NodeJS.ProcessEnv = process.env): string | null {
  if (p === "ecb") return env.FX_RATE_FEED_ECB_URL?.trim() || ECB_DEFAULT_URL;
  return env.FX_RATE_FEED_CBUAE_URL?.trim() || null;
}

// ─── Writing ───────────────────────────────────────────────────────────────

export interface FeedRunResult {
  provider: FeedProvider | "csv";
  status: "ok" | "failed" | "skipped";
  date: string | null;
  inserted: number;
  skipped: Array<{ pair: string; date: string; reason: string }>;
  rejected: ParsedFeed["rejected"];
  error?: string;
}

const RATE_TYPES = new Set(["spot", "closing", "average"]);

/** Write parsed rows as SYSTEM rates (company_id NULL) through saveRate. */
export async function writeSystemRates(
  rows: Array<ParsedRate & { date: string; rateType?: string }>,
  userId: string | null,
  source: "cbuae" | "ecb" | "manual" | "fta"
): Promise<Pick<FeedRunResult, "inserted" | "skipped">> {
  let inserted = 0;
  const skipped: FeedRunResult["skipped"] = [];
  for (const r of rows) {
    const rateType = r.rateType ?? "spot";
    if (!RATE_TYPES.has(rateType)) {
      skipped.push({ pair: `${r.from}/${r.to}`, date: r.date, reason: "INVALID_RATE_TYPE" });
      continue;
    }
    try {
      await saveRate(null, userId, {
        fromCurrency: r.from,
        toCurrency: r.to,
        rate: r.rate,
        effectiveDate: r.date,
        rateType: rateType as "spot" | "closing" | "average",
        source,
      });
      inserted++;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      skipped.push({ pair: `${r.from}/${r.to}`, date: r.date, reason: err.code });
    }
  }
  return { inserted, skipped };
}

async function logRun(r: FeedRunResult, userId: string | null): Promise<void> {
  await db.insert(fxRateFeedRuns).values({
    provider: r.provider,
    status: r.status,
    rateDate: r.date,
    inserted: r.inserted,
    skipped: r.skipped.length + r.rejected.length,
    error: r.error ?? null,
    createdBy: userId,
  });
}

/** Parse a provider payload and write its rows. Logged in fx_rate_feed_runs. */
export async function ingestFeedPayload(
  provider: FeedProvider,
  payload: string,
  userId: string | null,
  opts: { fallbackDate?: string } = {}
): Promise<FeedRunResult> {
  let parsed: ParsedFeed;
  try {
    parsed = provider === "ecb" ? parseEcbXml(payload) : parseCbuae(payload, opts.fallbackDate);
  } catch (err) {
    const result: FeedRunResult = {
      provider,
      status: "failed",
      date: null,
      inserted: 0,
      skipped: [],
      rejected: [],
      error: err instanceof Error ? err.message : String(err),
    };
    await logRun(result, userId);
    if (err instanceof DomainError) throw err;
    throw new DomainError("FEED_PARSE_ERROR", 422, { provider });
  }
  const { inserted, skipped } = await writeSystemRates(
    parsed.rates.map((r) => ({ ...r, date: parsed.date })),
    userId,
    provider
  );
  const result: FeedRunResult = {
    provider,
    status: "ok",
    date: parsed.date,
    inserted,
    skipped,
    rejected: parsed.rejected,
  };
  await logRun(result, userId);
  return result;
}

export type FeedFetcher = (url: string) => Promise<string>;

const defaultFetcher: FeedFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

/** Fetch and ingest one provider. Refuses (503) when the feed is not configured. */
export async function runFeedProvider(
  provider: FeedProvider,
  opts: { fetcher?: FeedFetcher; userId?: string | null; env?: NodeJS.ProcessEnv } = {}
): Promise<FeedRunResult> {
  const env = opts.env ?? process.env;
  if (!configuredProviders(env).includes(provider)) {
    throw new DomainError(
      "FX_RATE_FEED_NOT_CONFIGURED",
      503,
      { provider, capability: getCapability("fx_rate_feed", env).status },
      `The ${provider.toUpperCase()} rate feed is not configured (set FX_RATE_FEED).`
    );
  }
  const url = providerUrl(provider, env);
  if (!url) {
    throw new DomainError(
      "FX_RATE_FEED_URL_MISSING",
      503,
      { provider },
      `Set FX_RATE_FEED_${provider.toUpperCase()}_URL to the provider's published rates URL.`
    );
  }
  let payload: string;
  try {
    payload = await (opts.fetcher ?? defaultFetcher)(url);
  } catch (err) {
    const result: FeedRunResult = {
      provider,
      status: "failed",
      date: null,
      inserted: 0,
      skipped: [],
      rejected: [],
      error: err instanceof Error ? err.message : String(err),
    };
    await logRun(result, opts.userId ?? null);
    return result;
  }
  return ingestFeedPayload(provider, payload, opts.userId ?? null, {
    fallbackDate: todayDubai(),
  });
}

/** Scheduled run: every configured provider; nothing at all when unconfigured. */
export async function runConfiguredFeeds(
  opts: { fetcher?: FeedFetcher; env?: NodeJS.ProcessEnv } = {}
): Promise<FeedRunResult[]> {
  const out: FeedRunResult[] = [];
  for (const p of configuredProviders(opts.env)) {
    try {
      out.push(await runFeedProvider(p, opts));
    } catch (err) {
      log.warn({ provider: p, err: (err as Error).message }, "FX rate feed run failed");
    }
  }
  return out;
}

export async function feedStatus(env: NodeJS.ProcessEnv = process.env) {
  const runs = await db
    .select()
    .from(fxRateFeedRuns)
    .orderBy(desc(fxRateFeedRuns.createdAt))
    .limit(20);
  const lastRun = (p: string) => runs.find((r: (typeof runs)[number]) => r.provider === p) ?? null;
  return {
    capability: getCapability("fx_rate_feed", env).status,
    configured: configuredProviders(env),
    providers: FEED_PROVIDERS.map((p) => ({
      provider: p,
      configured: configuredProviders(env).includes(p),
      urlConfigured: Boolean(providerUrl(p, env)),
      lastRun: lastRun(p),
    })),
    lastCsvImport: lastRun("csv"),
  };
}

export async function lastFeedRun(provider: FeedProvider | "csv") {
  const [row] = await db
    .select()
    .from(fxRateFeedRuns)
    .where(eq(fxRateFeedRuns.provider, provider))
    .orderBy(desc(fxRateFeedRuns.createdAt))
    .limit(1);
  return row ?? null;
}

/** Register the daily job once (weekdays 14:05 UTC, after CBUAE/ECB publication). */
export function registerFxFeedJob(): void {
  if (listJobs().some((j) => j.name === "fx.rateFeed")) return;
  registerJob({
    name: "fx.rateFeed",
    cron: "5 14 * * 1-5",
    description:
      "Fetch CBUAE / ECB published rates into system rows (only when FX_RATE_FEED is set)",
    run: async () => {
      if (!configuredProviders().length) return;
      await runConfiguredFeeds();
    },
  });
}

/** Admin CSV import of system rates (provider "csv"). */
export async function importRateCsv(
  csv: string,
  userId: string,
  source: "manual" | "fta"
): Promise<FeedRunResult> {
  const rows = parseRateCsv(csv);
  const { inserted, skipped } = await writeSystemRates(rows, userId, source);
  const result: FeedRunResult = {
    provider: "csv",
    status: "ok",
    date:
      rows
        .map((r) => r.date)
        .sort()
        .pop() ?? null,
    inserted,
    skipped,
    rejected: [],
  };
  await logRun(
    { ...result, date: result.date && DATE_RE.test(result.date) ? result.date : null },
    userId
  );
  return result;
}
