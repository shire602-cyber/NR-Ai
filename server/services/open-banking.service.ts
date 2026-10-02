// Bank feed provider: Lean Technologies (UAE open finance aggregator). OFF unless LEAN_APP_TOKEN and LEAN_CLIENT_SECRET
// are set; sandbox unless LEAN_ENV=production. Wio is not offered.
//
// Paths, verified on docs.leantech.me (2026-10-02):
//   token        POST {auth}/oauth2/token   form: client_id, client_secret, grant_type=client_credentials, scope=api | customer.<id>
//                auth: https://auth.sandbox.leantech.me (sandbox)  https://auth.leantech.me (production)
//   customer     POST {api}/customers/v1/   json {app_user_id}  -> {customer_id}
//   entities     GET  {api}/customers/v1/entities?start_date&end_date&page_number&page_size   (data[]: customer_id, id, status,
//                bank_identifier, created_at ...). There is NO per-customer entities endpoint in the docs (re-checked
//                2026-10-02): the list is per application and date range, so we ask for a narrow window (the day the Link
//                session started to tomorrow) and filter to the company's customer ourselves.
//   accounts     GET  {api}/data/v2/accounts?entity_id&page&size
//   balances     GET  {api}/data/v2/accounts/{account_id}/balances?entity_id
//   transactions GET  {api}/data/v2/accounts/{account_id}/transactions?entity_id&start_date&end_date&page&size<=100
//                api: https://sandbox.leantech.me (sandbox)  https://api2.leantech.me (production)
// Assumed, to confirm against a real sandbox app: LEAN_APP_TOKEN is the application id used as client_id, and an entity
// row carries its own id as `id` (`entity_id` is accepted too).
// The Link SDK in the browser gets the app token and a customer-scoped access token from our session endpoint.

import { getEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { uaeYmdParts } from "../utils/date";
import type { ParsedStatementLine } from "./bank-statement-parsers";

const log = createLogger("open-banking");

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export interface LeanConfig {
  appToken: string;
  clientSecret: string;
  environment: "sandbox" | "production";
  apiBase: string;
  authBase: string;
}

export class ProviderError extends Error {
  readonly code = "BANK_PROVIDER_ERROR";
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderAccount {
  externalId: string;
  iban: string;
  bankName: string;
  accountType: string;
  currency: string;
  last4: string;
  name: string;
}

export interface ProviderEntity {
  id: string;
  customerId: string;
  status: string | null;
  bankName: string | null;
  createdAt: string | null;
}

const DEFAULT_BASES = {
  sandbox: { api: "https://sandbox.leantech.me", auth: "https://auth.sandbox.leantech.me" },
  production: { api: "https://api2.leantech.me", auth: "https://auth.leantech.me" },
} as const;

export function leanConfig(env: Record<string, any> = getEnv() as any): LeanConfig | null {
  if (!env.LEAN_APP_TOKEN || !env.LEAN_CLIENT_SECRET) return null;
  const environment: "sandbox" | "production" = env.LEAN_ENV === "production" ? "production" : "sandbox";
  return {
    appToken: env.LEAN_APP_TOKEN,
    clientSecret: env.LEAN_CLIENT_SECRET,
    environment,
    apiBase: (env.LEAN_API_BASE_URL || DEFAULT_BASES[environment].api).replace(/\/+$/, ""),
    authBase: (env.LEAN_AUTH_BASE_URL || DEFAULT_BASES[environment].auth).replace(/\/+$/, ""),
  };
}

export function isOpenBankingConfigured(): boolean {
  return leanConfig() !== null;
}

/** Providers the UI may offer: ["lean"] when configured, [] otherwise. */
export function getAvailableProviders(): string[] {
  return isOpenBankingConfigured() ? ["lean"] : [];
}

export const providerEnvironment = (): "sandbox" | "production" | null => leanConfig()?.environment ?? null;

/** Bank day (Dubai calendar day) of a provider timestamp, as UTC midnight of that day. */
export function bankDay(isoTimestamp: string): Date | null {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return null;
  const p = uaeYmdParts(d);
  return new Date(Date.UTC(p.year, p.month, p.day));
}

const signed = (a: any, indicator: string | undefined): number | null => {
  const n = Number(a?.amount ?? a);
  if (!Number.isFinite(n)) return null;
  return indicator === "DEBIT" ? -Math.abs(n) : Math.abs(n);
};

/** One Lean transaction as a statement line. null when it is not booked, has no date or no amount. */
export function mapLeanTransaction(tx: any): { line: ParsedStatementLine; currency: string | null } | null {
  if (tx?.status && String(tx.status).toUpperCase() !== "BOOKED") return null;
  const date = bankDay(tx?.booking_date_time ?? tx?.value_date_time);
  const amount = signed(tx?.amount, tx?.credit_debit_indicator);
  if (!date || amount === null || Math.abs(amount) < 0.005 || !tx?.transaction_id) return null;
  const balance = tx?.balance ? signed(tx.balance.amount, tx.balance.credit_debit_indicator) : null;
  const description = String(tx.transaction_information || tx.merchant_details?.merchant_name || "Bank transaction").replace(/\s+/g, " ").trim();
  return {
    currency: typeof tx?.amount?.currency === "string" ? tx.amount.currency.toUpperCase() : null,
    line: {
      date,
      valueDate: bankDay(tx?.value_date_time) ?? null,
      amount: Math.round(amount * 100) / 100,
      description: description.slice(0, 500),
      reference: null,
      externalId: String(tx.transaction_id),
      balance: balance === null ? null : Math.round(balance * 100) / 100,
    },
  };
}

export class LeanClient {
  private tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly config: LeanConfig,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike
  ) {}

  get environment() {
    return this.config.environment;
  }
  get appToken() {
    return this.config.appToken;
  }

  private async request(method: string, url: string, init: { headers?: Record<string, string>; body?: string }): Promise<any> {
    let res;
    try {
      res = await this.fetchImpl(url, { method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new ProviderError(`Bank provider unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn({ status: res.status, url: url.split("?")[0], body: body.slice(0, 200) }, "Lean request failed");
      throw new ProviderError(`Bank provider answered ${res.status}`, res.status);
    }
    return await res.json();
  }

  /** OAuth client-credentials token for scope `api` (backend) or `customer.<id>` (Link SDK). Cached until a minute before expiry. */
  async token(scope: string): Promise<string> {
    const cached = this.tokens.get(scope);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const body = new URLSearchParams({ client_id: this.config.appToken, client_secret: this.config.clientSecret, grant_type: "client_credentials", scope });
    const json = await this.request("POST", `${this.config.authBase}/oauth2/token`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!json?.access_token) throw new ProviderError("Bank provider returned no access token");
    this.tokens.set(scope, { token: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 });
    return json.access_token;
  }

  private async get(path: string, params: Record<string, string | number | undefined>): Promise<any> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    return await this.request("GET", `${this.config.apiBase}${path}?${q.toString()}`, {
      headers: { Authorization: `Bearer ${await this.token("api")}`, "Content-Type": "application/json" },
    });
  }

  async createCustomer(appUserId: string): Promise<string> {
    const json = await this.request("POST", `${this.config.apiBase}/customers/v1/`, {
      headers: { Authorization: `Bearer ${await this.token("api")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ app_user_id: appUserId }),
    });
    if (!json?.customer_id) throw new ProviderError("Bank provider returned no customer id");
    return String(json.customer_id);
  }

  /** The token the Link SDK in the browser uses for one customer. */
  customerToken(customerId: string): Promise<string> {
    return this.token(`customer.${customerId}`);
  }

  async listEntities(from: string, to: string): Promise<ProviderEntity[]> {
    const out: ProviderEntity[] = [];
    for (let page = 0; page < 20; page++) {
      const json = await this.get("/customers/v1/entities", { start_date: from, end_date: to, page_number: page, page_size: 100 });
      const rows: any[] = Array.isArray(json?.data) ? json.data : [];
      for (const r of rows) {
        const id = r?.id ?? r?.entity_id;
        if (id) {
          out.push({ id: String(id), customerId: String(r.customer_id ?? ""), status: r.status ?? null, bankName: r.bank_identifier ?? null, createdAt: r.created_at ?? null });
        }
      }
      if (rows.length < 100) break;
    }
    return out;
  }

  async listAccounts(entityId: string): Promise<ProviderAccount[]> {
    const out: ProviderAccount[] = [];
    for (let page = 0; page < 20; page++) {
      const json = await this.get("/data/v2/accounts", { entity_id: entityId, page, size: 100 });
      const rows: any[] = json?.data?.accounts ?? [];
      for (const a of rows) {
        if (a?.status && String(a.status).toUpperCase() !== "ENABLED") continue;
        const ids: any[] = Array.isArray(a.account) ? a.account : [];
        const iban = ids.find((x) => String(x.scheme_name).toUpperCase() === "IBAN")?.identification ?? "";
        const any = iban || ids[0]?.identification || "";
        out.push({
          externalId: String(a.account_id),
          iban: String(iban),
          bankName: String(a.servicer?.identification ?? a.account_holder_name ?? "Bank"),
          accountType: String(a.account_sub_type ?? a.account_type ?? "CURRENT"),
          currency: String(a.currency ?? "AED").toUpperCase(),
          last4: String(any).slice(-4),
          name: String(a.nickname ?? a.account_holder_name ?? ""),
        });
      }
      if (rows.length < 100) break;
    }
    return out;
  }

  /** Booked transactions in a day range, oldest page first. Capped at 50 pages (5,000 lines) per call. */
  async listTransactions(entityId: string, accountId: string, from: string, to: string): Promise<any[]> {
    const out: any[] = [];
    for (let page = 0; page < 50; page++) {
      const json = await this.get(`/data/v2/accounts/${encodeURIComponent(accountId)}/transactions`, { entity_id: entityId, start_date: from, end_date: to, page, size: 100 });
      const rows: any[] = json?.data?.transactions ?? [];
      out.push(...rows);
      const totalPages = Number(json?.data?.page?.total_pages ?? 1);
      if (page + 1 >= totalPages || rows.length === 0) break;
    }
    return out;
  }

  async fetchBalance(entityId: string, accountId: string): Promise<{ current: number; currency: string } | null> {
    const json = await this.get(`/data/v2/accounts/${encodeURIComponent(accountId)}/balances`, { entity_id: entityId });
    const rows: any[] = json?.data?.balances ?? [];
    const pick = rows.find((b) => /BOOKED|CLOSING/.test(String(b.type))) ?? rows[0];
    if (!pick) return null;
    const v = signed(pick.amount, pick.credit_debit_indicator);
    return v === null ? null : { current: Math.round(v * 100) / 100, currency: String(pick.amount?.currency ?? "AED") };
  }
}

let shared: LeanClient | null = null;
let sharedKey = "";

/** The configured Lean client, or null when the provider is off. Rebuilt if the configuration changes (tests). */
export function getLeanClient(): LeanClient | null {
  const cfg = leanConfig();
  if (!cfg) return null;
  const key = JSON.stringify(cfg);
  if (!shared || key !== sharedKey) {
    shared = new LeanClient(cfg);
    sharedKey = key;
  }
  return shared;
}
