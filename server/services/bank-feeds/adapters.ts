/**
 * Provider API adapters for Lean, Tarabut and Wio (W3-C, R06-19).
 * Configuration comes from the environment. An unconfigured adapter reports
 * isConfigured() = false and the service returns 503 BANK_FEED_NOT_CONFIGURED.
 */
import type { BankFeedAdapter, FeedAccount, FeedTokens, FeedTransaction } from "./types";
import { amountFils, collect, env, isoDay, requestJson, str } from "./http";

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function last4(v: string): string | null {
  const s = v.replace(/\s+/g, "");
  return s.length >= 4 ? s.slice(-4) : null;
}
function expiresIn(seconds: unknown): Date | null {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(Date.now() + n * 1000) : null;
}

// ─── Lean Technologies ─────────────────────────────────────────────────────
// The widget returns entity_id as the authorization code. Data API calls carry an app token.

export const leanAdapter: BankFeedAdapter = {
  id: "lean",
  capability: "bank_feed_lean",
  label: "Lean Technologies",
  isConfigured: () => env("LEAN_APP_TOKEN").length > 0,
  authorizeUrl({ state, redirectUri }) {
    const base = env("LEAN_LINK_URL") || "https://cdn.leantech.me/link/loader.html";
    const params = new URLSearchParams({
      app_token: env("LEAN_APP_TOKEN"),
      redirect_uri: redirectUri,
      state,
      permissions: "identity,accounts,balance,transactions",
    });
    return `${base}?${params.toString()}`;
  },
  async exchangeCode({ code }) {
    return { accessToken: code, refreshToken: null, expiresAt: null };
  },
  async listAccounts(tokens) {
    const base = env("LEAN_API_BASE_URL") || "https://sandbox.leantech.me";
    const data = obj(
      await requestJson("lean", `${base}/data/v1/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "lean-app-token": env("LEAN_APP_TOKEN") },
        body: JSON.stringify({ entity_id: tokens.accessToken }),
      })
    );
    return arr(obj(data.payload).accounts).map((raw): FeedAccount => {
      const a = obj(raw);
      const iban = str(a.iban) || null;
      return {
        externalId: str(a.account_id),
        name: str(a.name) || "Account",
        bankName: str(obj(a.institution).name) || "Bank",
        iban,
        currency: (str(a.currency_code) || "AED").toUpperCase(),
        last4: last4(iban ?? str(a.account_number)),
      };
    });
  },
  async fetchTransactions(tokens, accountId, from, to) {
    const base = env("LEAN_API_BASE_URL") || "https://sandbox.leantech.me";
    const data = obj(
      await requestJson("lean", `${base}/data/v1/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "lean-app-token": env("LEAN_APP_TOKEN") },
        body: JSON.stringify({
          entity_id: tokens.accessToken,
          account_id: accountId,
          start_date: from,
          end_date: to,
        }),
      })
    );
    return collect(arr(obj(data.payload).transactions), (t): FeedTransaction | string => {
      const id = str(t.transaction_id);
      if (!id) return "Missing transaction_id";
      const date = isoDay(t.timestamp ?? t.booking_date);
      if (!date) return "Invalid date";
      const fils = amountFils(t.amount);
      if (fils === null) return "Invalid amount";
      // Lean: negative amounts are debits.
      return {
        externalId: id,
        date,
        description: str(t.description).slice(0, 500) || "Bank transaction",
        amountFils: fils,
        reference: str(t.reference) || null,
        balanceFils: amountFils(t.balance),
      };
    });
  },
  async refresh() {
    return null;
  },
};

// ─── Tarabut Gateway ───────────────────────────────────────────────────────
// OAuth 2.0 authorisation-code flow; account information under /accountInformation/v1.

function tarabutBase(): string {
  return env("TARABUT_API_BASE_URL") || "https://api.sandbox.tarabutgateway.io";
}

async function tarabutToken(body: Record<string, string>): Promise<FeedTokens> {
  const data = obj(
    await requestJson("tarabut", `${tarabutBase()}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("TARABUT_CLIENT_ID"),
        client_secret: env("TARABUT_CLIENT_SECRET"),
        ...body,
      }).toString(),
    })
  );
  const accessToken = str(data.access_token);
  if (!accessToken) throw new Error("Tarabut token response had no access_token");
  return {
    accessToken,
    refreshToken: str(data.refresh_token) || null,
    expiresAt: expiresIn(data.expires_in),
    consentId: str(data.consent_id) || null,
  };
}

export const tarabutAdapter: BankFeedAdapter = {
  id: "tarabut",
  capability: "bank_feed_tarabut",
  label: "Tarabut Gateway",
  isConfigured: () =>
    env("TARABUT_CLIENT_ID").length > 0 && env("TARABUT_CLIENT_SECRET").length > 0,
  authorizeUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: env("TARABUT_CLIENT_ID"),
      redirect_uri: redirectUri,
      scope: "accounts transactions balances",
      state,
    });
    return `${env("TARABUT_AUTH_URL") || `${tarabutBase()}/connect/authorize`}?${params.toString()}`;
  },
  exchangeCode: ({ code, redirectUri }) =>
    tarabutToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  async listAccounts(tokens) {
    const data = obj(
      await requestJson("tarabut", `${tarabutBase()}/accountInformation/v1/accounts`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
    );
    return arr(data.accounts).map((raw): FeedAccount => {
      const a = obj(raw);
      const iban = str(a.iban) || null;
      return {
        externalId: str(a.accountId),
        name: str(a.nickname) || str(a.accountType) || "Account",
        bankName: str(a.providerName) || "Bank",
        iban,
        currency: (str(a.currency) || "AED").toUpperCase(),
        last4: last4(iban ?? str(a.maskedAccountNumber)),
      };
    });
  },
  async fetchTransactions(tokens, accountId, from, to) {
    const params = new URLSearchParams({ fromBookingDateTime: from, toBookingDateTime: to });
    const data = obj(
      await requestJson(
        "tarabut",
        `${tarabutBase()}/accountInformation/v1/accounts/${encodeURIComponent(accountId)}/transactions?${params}`,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
      )
    );
    return collect(arr(data.transactions), (t): FeedTransaction | string => {
      const id = str(t.transactionId);
      if (!id) return "Missing transactionId";
      const date = isoDay(t.bookingDateTime);
      if (!date) return "Invalid date";
      const amount = obj(t.amount);
      const fils = amountFils(amount.value ?? t.amount);
      if (fils === null || fils < 0) return "Invalid amount";
      const indicator = str(t.creditDebitIndicator).toLowerCase();
      if (indicator !== "credit" && indicator !== "debit") return "Missing credit/debit indicator";
      return {
        externalId: id,
        date,
        description: str(t.transactionInformation).slice(0, 500) || "Bank transaction",
        amountFils: indicator === "credit" ? fils : -fils,
        reference: str(t.transactionReference) || null,
        balanceFils: null,
      };
    });
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) return null;
    return tarabutToken({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  },
};

// ─── Wio Business transaction provider ────────────────────────────────────

function wioBase(): string {
  return env("WIO_API_BASE_URL") || "https://sandbox.api.business.wio.io";
}

async function wioToken(body: Record<string, string>): Promise<FeedTokens> {
  const data = obj(
    await requestJson("wio", `${wioBase()}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("WIO_CLIENT_ID"),
        client_secret: env("WIO_CLIENT_SECRET"),
        ...body,
      }).toString(),
    })
  );
  const accessToken = str(data.access_token);
  if (!accessToken) throw new Error("Wio token response had no access_token");
  return {
    accessToken,
    refreshToken: str(data.refresh_token) || null,
    expiresAt: expiresIn(data.expires_in),
    consentId: str(data.consent_id) || null,
  };
}

export const wioAdapter: BankFeedAdapter = {
  id: "wio",
  capability: "bank_feed_wio",
  label: "Wio Bank",
  isConfigured: () => env("WIO_CLIENT_ID").length > 0 && env("WIO_CLIENT_SECRET").length > 0,
  authorizeUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: env("WIO_CLIENT_ID"),
      redirect_uri: redirectUri,
      scope: "accounts transactions balances",
      state,
    });
    return `${wioBase()}/oauth2/authorize?${params.toString()}`;
  },
  exchangeCode: ({ code, redirectUri }) =>
    wioToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  async listAccounts(tokens) {
    const data = obj(
      await requestJson("wio", `${wioBase()}/open-banking/v1/accounts`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
    );
    return arr(data.accounts).map((raw): FeedAccount => {
      const a = obj(raw);
      const iban = str(a.iban) || null;
      return {
        externalId: str(a.accountId ?? a.id),
        name: str(a.nickname) || "Wio account",
        bankName: "Wio Bank",
        iban,
        currency: (str(a.currency) || "AED").toUpperCase(),
        last4: last4(iban ?? ""),
      };
    });
  },
  async fetchTransactions(tokens, accountId, from, to) {
    const params = new URLSearchParams({ fromDate: from, toDate: to });
    const data = obj(
      await requestJson(
        "wio",
        `${wioBase()}/open-banking/v1/accounts/${encodeURIComponent(accountId)}/transactions?${params}`,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
      )
    );
    return collect(arr(data.transactions), (t): FeedTransaction | string => {
      const id = str(t.transactionId ?? t.id);
      if (!id) return "Missing transactionId";
      const date = isoDay(t.bookingDate ?? t.date);
      if (!date) return "Invalid date";
      const fils = amountFils(t.amount);
      if (fils === null) return "Invalid amount";
      const indicator = str(t.creditDebitIndicator).toLowerCase();
      if (indicator !== "credit" && indicator !== "debit") return "Missing credit/debit indicator";
      const abs = Math.abs(fils);
      return {
        externalId: id,
        date,
        description: str(t.description ?? t.remittanceInfo).slice(0, 500) || "Bank transaction",
        amountFils: indicator === "credit" ? abs : -abs,
        reference: str(t.reference ?? t.endToEndId) || null,
        balanceFils: amountFils(t.runningBalance),
      };
    });
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) return null;
    return wioToken({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  },
};

export const BANK_FEED_ADAPTERS: Record<string, BankFeedAdapter> = {
  lean: leanAdapter,
  tarabut: tarabutAdapter,
  wio: wioAdapter,
};
