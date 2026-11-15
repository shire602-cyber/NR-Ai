/**
 * OAuth connector skeletons for accounting systems (Xero, QuickBooks Online,
 * Zoho Books) and POS / commerce (Foodics, Salla) — W5-B, R19-14, R19-09.
 *
 * Built to the external boundary: the authorize URL, the code -> token
 * exchange and token refresh follow each provider's documented OAuth 2.0
 * contract and are covered by mocked contract tests. They stay
 * `requires_external` until the provider app is registered and its client
 * id / secret / redirect URI are configured; nothing here claims a live
 * connection. Data sync for these systems is done today through the
 * migration import (CSV exports), see server/services/migration-import.
 */
import crypto from "node:crypto";
import type { CapabilityStatus, LocalizedText } from "../../../shared/capabilities";
import { ecommerceHttp } from "../ecommerce/http";

export type ConnectorId = "xero" | "quickbooks" | "zoho_books" | "foodics" | "salla";

export interface ConnectorDef {
  id: ConnectorId;
  category: "accounting" | "pos";
  label: LocalizedText;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  envVars: { clientId: string; clientSecret: string; redirectUri: string };
  /** What the connector does once registered. */
  purpose: LocalizedText;
}

export const CONNECTORS: readonly ConnectorDef[] = [
  {
    id: "xero",
    category: "accounting",
    label: { en: "Xero", ar: "زيرو" },
    authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    scopes: [
      "openid",
      "offline_access",
      "accounting.transactions.read",
      "accounting.contacts.read",
      "accounting.settings.read",
    ],
    envVars: {
      clientId: "XERO_CLIENT_ID",
      clientSecret: "XERO_CLIENT_SECRET",
      redirectUri: "XERO_REDIRECT_URI",
    },
    purpose: {
      en: "Read contacts, invoices and the chart of accounts for migration",
      ar: "قراءة جهات الاتصال والفواتير ودليل الحسابات للترحيل",
    },
  },
  {
    id: "quickbooks",
    category: "accounting",
    label: { en: "QuickBooks Online", ar: "كويك بوكس أونلاين" },
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    envVars: {
      clientId: "QUICKBOOKS_CLIENT_ID",
      clientSecret: "QUICKBOOKS_CLIENT_SECRET",
      redirectUri: "QUICKBOOKS_REDIRECT_URI",
    },
    purpose: {
      en: "Read customers, vendors, invoices and bills for migration",
      ar: "قراءة العملاء والموردين والفواتير للترحيل",
    },
  },
  {
    id: "zoho_books",
    category: "accounting",
    label: { en: "Zoho Books", ar: "زوهو بوكس" },
    authorizeUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scopes: ["ZohoBooks.fullaccess.READ"],
    envVars: {
      clientId: "ZOHO_CLIENT_ID",
      clientSecret: "ZOHO_CLIENT_SECRET",
      redirectUri: "ZOHO_REDIRECT_URI",
    },
    purpose: {
      en: "Read the organisation's books for migration",
      ar: "قراءة دفاتر المؤسسة للترحيل",
    },
  },
  {
    id: "foodics",
    category: "pos",
    label: { en: "Foodics POS", ar: "فودكس" },
    authorizeUrl: "https://console.foodics.com/authorize",
    tokenUrl: "https://api.foodics.com/oauth/token",
    scopes: ["general.read", "orders.limited.read"],
    envVars: {
      clientId: "FOODICS_CLIENT_ID",
      clientSecret: "FOODICS_CLIENT_SECRET",
      redirectUri: "FOODICS_REDIRECT_URI",
    },
    purpose: {
      en: "Import daily POS sales as draft invoices",
      ar: "استيراد مبيعات نقاط البيع اليومية كمسودات فواتير",
    },
  },
  {
    id: "salla",
    category: "pos",
    label: { en: "Salla", ar: "سلة" },
    authorizeUrl: "https://accounts.salla.sa/oauth2/auth",
    tokenUrl: "https://accounts.salla.sa/oauth2/token",
    scopes: ["offline_access"],
    envVars: {
      clientId: "SALLA_CLIENT_ID",
      clientSecret: "SALLA_CLIENT_SECRET",
      redirectUri: "SALLA_REDIRECT_URI",
    },
    purpose: {
      en: "Import store orders as draft invoices",
      ar: "استيراد طلبات المتجر كمسودات فواتير",
    },
  },
];

type Env = Readonly<Record<string, string | undefined>>;

const configured = (def: ConnectorDef, env: Env) =>
  !!(env[def.envVars.clientId] && env[def.envVars.clientSecret] && env[def.envVars.redirectUri]);

export interface ConnectorStatus {
  id: ConnectorId;
  category: ConnectorDef["category"];
  label: LocalizedText;
  purpose: LocalizedText;
  /** sandbox at best: sync adapters beyond OAuth are not built, so never "live". */
  status: Extract<CapabilityStatus, "sandbox" | "requires_external">;
  externalAction: LocalizedText;
  envVars: string[];
}

export function connectorStatuses(env: Env = process.env): ConnectorStatus[] {
  return CONNECTORS.map((def) => ({
    id: def.id,
    category: def.category,
    label: def.label,
    purpose: def.purpose,
    status: configured(def, env) ? "sandbox" : "requires_external",
    externalAction: {
      en: `Register a ${def.label.en} app and set ${Object.values(def.envVars).join(", ")}. Until then, use the CSV import.`,
      ar: `سجّل تطبيق ${def.label.ar} واضبط ${Object.values(def.envVars).join("، ")}. حتى ذلك الحين استخدم الاستيراد عبر CSV.`,
    },
    envVars: Object.values(def.envVars),
  }));
}

function defOf(id: ConnectorId): ConnectorDef {
  const def = CONNECTORS.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown connector ${id}`);
  return def;
}

export class ConnectorNotConfiguredError extends Error {
  constructor(id: ConnectorId) {
    super(`${id} is not configured (app registration required)`);
    this.name = "ConnectorNotConfiguredError";
  }
}

/** Authorize URL with a CSRF `state`; throws when the app is not registered. */
export function buildAuthorizeUrl(
  id: ConnectorId,
  env: Env = process.env
): { url: string; state: string } {
  const def = defOf(id);
  if (!configured(def, env)) throw new ConnectorNotConfiguredError(id);
  const state = crypto.randomBytes(16).toString("hex");
  const u = new URL(def.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env[def.envVars.clientId]!);
  u.searchParams.set("redirect_uri", env[def.envVars.redirectUri]!);
  u.searchParams.set("scope", def.scopes.join(" "));
  u.searchParams.set("state", state);
  if (id === "zoho_books") u.searchParams.set("access_type", "offline");
  return { url: u.toString(), state };
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

async function tokenRequest(
  def: ConnectorDef,
  form: Record<string, string>,
  env: Env
): Promise<OAuthTokens> {
  const basic = Buffer.from(
    `${env[def.envVars.clientId]}:${env[def.envVars.clientSecret]}`
  ).toString("base64");
  const res = await ecommerceHttp()(def.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (res.body ?? {}) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (res.status < 200 || res.status >= 300 || !body.access_token) {
    throw new Error(`${def.id} token endpoint returned HTTP ${res.status}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null,
  };
}

/** Exchange an authorization code (RFC 6749 §4.1.3). */
export async function exchangeAuthorizationCode(
  id: ConnectorId,
  code: string,
  env: Env = process.env
): Promise<OAuthTokens> {
  const def = defOf(id);
  if (!configured(def, env)) throw new ConnectorNotConfiguredError(id);
  return tokenRequest(
    def,
    { grant_type: "authorization_code", code, redirect_uri: env[def.envVars.redirectUri]! },
    env
  );
}

/** Refresh an access token (RFC 6749 §6). */
export async function refreshAccessToken(
  id: ConnectorId,
  refreshToken: string,
  env: Env = process.env
): Promise<OAuthTokens> {
  const def = defOf(id);
  if (!configured(def, env)) throw new ConnectorNotConfiguredError(id);
  return tokenRequest(def, { grant_type: "refresh_token", refresh_token: refreshToken }, env);
}
