/**
 * Real-Postgres test harness.
 *
 * Each test FILE gets its own freshly migrated database (cloned from the
 * template built by tests/db/global-setup.ts), the real Express app is
 * assembled exactly like server/index.ts (security middleware, body parsing,
 * CSRF, registerRoutes, 404 + error handlers) and served on an ephemeral
 * port. The database is dropped when the file finishes.
 *
 * Usage (see tests/db/README.md):
 *
 *   import { useHarness } from "./harness";
 *   const h = useHarness();
 *   it("...", async () => {
 *     const a = await h.createTenant();
 *     const r = await a.as.get(`/api/companies/${a.company.id}/accounts`);
 *     expect(r.status).toBe(200);
 *   });
 *
 * Server modules are imported lazily, AFTER DATABASE_URL points at the
 * per-file database, because server/db.ts reads it at import time.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, vi } from "vitest";
import pg from "pg";
import { HARNESS_DB_PREFIX, createDatabase, databaseUrl, dropDatabase, repoRoot } from "./pg-admin";

// ─── Types ──────────────────────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Raw body (string/Buffer) instead of JSON. */
  raw?: string | Buffer;
  /** Override Bearer token (null = anonymous). */
  token?: string | null;
}

export interface ApiClient {
  request<T = any>(
    method: HttpMethod,
    url: string,
    body?: unknown,
    opts?: RequestOptions
  ): Promise<ApiResponse<T>>;
  get<T = any>(url: string, opts?: RequestOptions): Promise<ApiResponse<T>>;
  post<T = any>(url: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  put<T = any>(url: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  patch<T = any>(url: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  delete<T = any>(url: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
}

export type CompanyRole = "owner" | "admin" | "accountant" | "cfo" | "employee" | "viewer" | string;

export interface CreateTenantOptions {
  /** company_users.role for the user in their own company (default owner). */
  role?: CompanyRole;
  /** users.firm_role (NR firm staff). */
  firmRole?: "firm_owner" | "firm_admin" | null;
  isAdmin?: boolean;
  userType?: "customer" | "client" | "admin" | "client_portal";
  /** Display name prefix; used in the generated email too. */
  name?: string;
  /** Subscription plan id to set (default: leave the free plan). */
  planId?: string;
  /** Company fields to set directly after registration (snake_case columns). */
  companyColumns?: Record<string, unknown>;
}

export interface Tenant {
  user: { id: string; email: string; name: string };
  company: { id: string; name: string };
  email: string;
  password: string;
  token: string;
  as: ApiClient;
}

export interface RateLimitOverrides {
  api?: number;
  read?: number;
  auth?: number;
  ai?: number;
  authOAuth?: number;
}

export interface Harness {
  mode: "postgres" | "pglite";
  /** False under the PGlite fallback (single connection, no real parallelism). */
  concurrencySupported: boolean;
  fallbackReason?: string;
  baseUrl: string;
  databaseName: string;
  databaseUrl: string;
  /** The current inner Express app (rebuilt by setRateLimits). */
  app(): any;
  /** Anonymous client. */
  anon: ApiClient;
  client(token: string | null): ApiClient;
  sql<T = any>(text: string, params?: unknown[]): Promise<T[]>;
  createTenant(opts?: CreateTenantOptions): Promise<Tenant>;
  createSecondTenant(opts?: CreateTenantOptions): Promise<Tenant>;
  setRateLimits(limits: RateLimitOverrides): Promise<void>;
  resetRateLimits(): Promise<void>;
  /** Express router stack of the live app (for route enumeration). */
  routes(): RegisteredRoute[];
  stop(): Promise<void>;
}

export interface RegisteredRoute {
  method: HttpMethod;
  path: string;
}

// ─── Startup ────────────────────────────────────────────────────────────────

const HARNESS_RATE_LIMIT = 1_000_000;
let current: Harness | null = null;

function makeClient(baseUrl: string, token: string | null): ApiClient {
  const request = async <T = any>(
    method: HttpMethod,
    url: string,
    body?: unknown,
    opts: RequestOptions = {}
  ): Promise<ApiResponse<T>> => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const bearer = opts.token === undefined ? token : opts.token;
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let payload: string | Buffer | undefined;
    if (opts.raw !== undefined) {
      payload = opts.raw;
    } else if (body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + url, {
      method,
      headers,
      body: payload as any,
      redirect: "manual",
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, body: parsed as T, text, headers: res.headers };
  };
  return {
    request,
    get: (url, opts) => request("GET", url, undefined, opts),
    post: (url, body, opts) => request("POST", url, body ?? {}, opts),
    put: (url, body, opts) => request("PUT", url, body ?? {}, opts),
    patch: (url, body, opts) => request("PATCH", url, body ?? {}, opts),
    delete: (url, body, opts) => request("DELETE", url, body, opts),
  };
}

async function preparePgliteDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const db = await PGlite.create();
  // PGlite is single-session; the socket server multiplexes connections onto it.
  const server = new PGLiteSocketServer({
    db,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 16,
  } as any);
  await server.start();
  const addr: any = (server as any).server?.address?.() ?? (server as any).address?.();
  const port = typeof addr === "object" && addr ? addr.port : Number(addr);
  process.env.DB_POOL_MAX = "1";
  process.env.DB_POOL_MIN = "1";
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    stop: async () => {
      await server.stop().catch(() => undefined);
      await db.close().catch(() => undefined);
    },
  };
}

/**
 * Assemble the real app the same way server/index.ts does (minus the static
 * SPA, Socket.io and the background scheduler, which tests drive directly).
 * Keep this in step with server/index.ts.
 */
async function buildApp(): Promise<any> {
  const express = (await import("express")).default;
  const session = (await import("express-session")).default;
  const passport = (await import("passport")).default;
  const compression = (await import("compression")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { getEnv } = await import("../../server/config/env");
  const { applySecurityMiddleware } = await import("../../server/middleware/security");
  const { requestId } = await import("../../server/middleware/requestId");
  const { requestLogger } = await import("../../server/middleware/requestLogger");
  const { globalErrorHandler, notFoundHandler } =
    await import("../../server/middleware/errorHandler");
  const { csrfProtection, csrfTokenHandler, csrfErrorHandler } =
    await import("../../server/middleware/csrf");
  const { registerRoutes } = await import("../../server/routes");
  const { pingDb } = await import("../../server/db");
  await import("../../server/auth");

  const env = getEnv();
  const app = express();
  app.set("trust proxy", 1);
  app.use(requestId);
  applySecurityMiddleware(app);
  app.use(compression());

  const largeJsonRoutes = [
    /^\/api\/ocr\//,
    /^\/api\/export\//,
    /^\/api\/firm\/bulk\/ocr/,
    /^\/api\/companies\/[^/]+\/receipts$/,
    /^\/api\/companies\/[^/]+\/bank-statements\/import$/,
  ];
  const largeJson = express.json({ limit: "10mb" });
  const smallJson = express.json({ limit: "1mb" });
  app.use("/api/webhooks/email-intake", express.raw({ type: "*/*", limit: "20mb" }));
  // Mirrors server/index.ts (W4-D raw-body webhooks).
  const rawWebhookPrefixes = ["/api/webhooks/invoice-payments", "/api/webhooks/email-events"];
  app.use(rawWebhookPrefixes, express.raw({ type: "*/*", limit: "1mb" }));
  app.use((req: any, res: any, next: any) => {
    if (req.path === "/api/webhooks/email-intake") return next();
    if (rawWebhookPrefixes.some((p) => req.path.startsWith(`${p}/`))) return next();
    const useLarge = largeJsonRoutes.some((rx) => rx.test(req.path));
    return (useLarge ? largeJson : smallJson)(req, res, next);
  });
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser(env.SESSION_SECRET));
  // MemoryStore instead of connect-pg-simple: tests authenticate with Bearer
  // tokens and the session table is not under test here.
  app.use(session({ secret: env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(requestLogger);
  app.get("/api/csrf-token", csrfTokenHandler);
  app.use(csrfProtection);
  app.get("/health/live", (_req: any, res: any) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });
  app.get("/health", async (_req: any, res: any) => {
    const ping = await pingDb();
    res.status(ping.ok ? 200 : 503).json({ status: ping.ok ? "ok" : "degraded" });
  });

  await registerRoutes(app);
  app.use("/api/*", notFoundHandler);
  app.use(csrfErrorHandler);
  app.use(globalErrorHandler);
  return app;
}

function trimPathRegexp(layer: any): string {
  // Express 4 mounts routers with a regexp like /^\/api\/?(?=\/|$)/i.
  if (layer.regexp?.fast_slash) return "";
  const src: string = layer.regexp?.source ?? "";
  const m = src
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\//g, "/");
  // Parameterised mount paths are rare here; fall back to a marker so they
  // are visible rather than silently dropped.
  return /[()[\]*+?]/.test(m) ? `<regex:${src}>` : m;
}

export function collectRoutes(app: any): RegisteredRoute[] {
  const out: RegisteredRoute[] = [];
  const walk = (stack: any[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) {
          if (typeof p !== "string") continue;
          for (const m of Object.keys(layer.route.methods)) {
            const method = m.toUpperCase();
            if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) continue;
            out.push({ method: method as HttpMethod, path: (prefix + p).replace(/\/+/g, "/") });
          }
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + trimPathRegexp(layer));
      }
    }
  };
  walk(app._router?.stack ?? [], "");
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function startHarness(): Promise<Harness> {
  if (current) return current;

  const mode = process.env.HARNESS_MODE === "postgres" ? "postgres" : "pglite";
  const adminUrl = process.env.HARNESS_ADMIN_URL ?? "";
  const template = process.env.HARNESS_TEMPLATE_DB ?? "";
  const dbName = `${HARNESS_DB_PREFIX}db_${process.pid}_${randomBytes(3).toString("hex")}_${Date.now().toString(36)}`;
  let dbUrl: string;
  let stopPglite: (() => Promise<void>) | null = null;

  if (mode === "postgres") {
    await createDatabase(adminUrl, dbName, template);
    dbUrl = databaseUrl(adminUrl, dbName);
  } else {
    const p = await preparePgliteDatabase();
    dbUrl = p.url;
    stopPglite = p.stop;
  }
  process.env.DATABASE_URL = dbUrl;

  if (mode === "pglite") {
    const { runMigrations, ensureCriticalSchema } = await import("../../server/db");
    await runMigrations(path.join(repoRoot, "migrations"));
    await ensureCriticalSchema();
  }

  const sqlPool = new pg.Pool({ connectionString: dbUrl, max: mode === "postgres" ? 4 : 1 });
  sqlPool.on("error", () => undefined);

  let inner = await buildApp();
  const server = http.createServer((req, res) => inner(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const { limiterProfiles } = await import("../../server/middleware/rateLimit");
  const defaults = Object.fromEntries(
    Object.entries(limiterProfiles).map(([k, v]: [string, any]) => [k, v.max])
  );

  const sql = async <T = any>(text: string, params: unknown[] = []): Promise<T[]> => {
    const r = await sqlPool.query(text, params as any[]);
    return r.rows as T[];
  };

  let seq = 0;
  const createTenant = async (opts: CreateTenantOptions = {}): Promise<Tenant> => {
    seq++;
    const label = (opts.name ?? "Tenant").replace(/[^A-Za-z0-9 ]/g, "") || "Tenant";
    const slug = `${label.toLowerCase().replace(/\s+/g, "")}${seq}_${randomBytes(4).toString("hex")}`;
    const email = `${slug}@harness.test`;
    const password = `Harness${randomBytes(4).toString("hex")}A1!`;
    const anon = makeClient(baseUrl, null);
    const reg = await anon.post("/api/auth/register", { name: `${label} ${seq}`, email, password });
    if (reg.status !== 200 || !reg.body?.token) {
      throw new Error(`createTenant: register failed ${reg.status} ${reg.text.slice(0, 300)}`);
    }
    const { token, user, company } = reg.body;
    if (opts.role && opts.role !== "owner") {
      await sql(`UPDATE company_users SET role = $1 WHERE company_id = $2 AND user_id = $3`, [
        opts.role,
        company.id,
        user.id,
      ]);
    }
    if (opts.firmRole !== undefined || opts.isAdmin !== undefined || opts.userType !== undefined) {
      await sql(
        `UPDATE users SET firm_role = COALESCE($2, firm_role), is_admin = COALESCE($3, is_admin),
           user_type = COALESCE($4, user_type) WHERE id = $1`,
        [user.id, opts.firmRole ?? null, opts.isAdmin ?? null, opts.userType ?? null]
      );
    }
    if (opts.planId) {
      await sql(`UPDATE subscriptions SET plan_id = $2, plan_name = $2 WHERE company_id = $1`, [
        company.id,
        opts.planId,
      ]);
    }
    if (opts.companyColumns && Object.keys(opts.companyColumns).length) {
      const cols = Object.keys(opts.companyColumns);
      for (const c of cols) if (!/^[a-z_]+$/.test(c)) throw new Error(`bad column ${c}`);
      const sets = cols.map((c, i) => `"${c}" = $${i + 2}`).join(", ");
      await sql(`UPDATE companies SET ${sets} WHERE id = $1`, [
        company.id,
        ...cols.map((c) => opts.companyColumns![c]),
      ]);
    }
    return {
      user: { id: user.id, email: user.email, name: user.name },
      company: { id: company.id, name: company.name },
      email,
      password,
      token,
      as: makeClient(baseUrl, token),
    };
  };

  const rebuild = async () => {
    inner = await buildApp();
  };

  const h: Harness = {
    mode,
    concurrencySupported: mode === "postgres",
    fallbackReason: process.env.HARNESS_FALLBACK_REASON,
    baseUrl,
    databaseName: mode === "postgres" ? dbName : "pglite",
    databaseUrl: dbUrl,
    app: () => inner,
    anon: makeClient(baseUrl, null),
    client: (token) => makeClient(baseUrl, token),
    sql,
    createTenant,
    createSecondTenant: (opts = {}) => createTenant({ name: "TenantB", ...opts }),
    async setRateLimits(limits) {
      for (const [k, v] of Object.entries(limits)) {
        if (v === undefined) continue;
        const profile = (limiterProfiles as any)[k];
        if (!profile) throw new Error(`unknown rate-limit profile ${k}`);
        profile.max = v;
      }
      await rebuild();
    },
    async resetRateLimits() {
      for (const [k, v] of Object.entries(defaults)) (limiterProfiles as any)[k].max = v;
      await rebuild();
    },
    routes: () => collectRoutes(inner),
    async stop() {
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
      await sqlPool.end().catch(() => undefined);
      const { closePool } = await import("../../server/db");
      await closePool(5_000).catch(() => undefined);
      if (mode === "postgres") {
        await dropDatabase(adminUrl, dbName).catch((err) =>
          console.warn(`[db-harness] could not drop ${dbName}: ${err?.message ?? err}`)
        );
      } else {
        await stopPglite?.();
      }
      current = null;
    },
  };
  void HARNESS_RATE_LIMIT;
  current = h;
  return h;
}

/**
 * Register beforeAll/afterAll hooks for the current test file and return a
 * handle whose methods delegate to the started harness.
 */
export function useHarness(): Harness {
  beforeAll(async () => {
    await startHarness();
  }, 300_000);
  afterAll(async () => {
    vi.useRealTimers();
    await current?.stop();
  }, 120_000);
  return new Proxy({} as Harness, {
    get(_t, prop) {
      if (!current) throw new Error("harness not started (call inside a test or hook)");
      return (current as any)[prop];
    },
  });
}

function requireHarness(): Harness {
  if (!current) throw new Error("harness not started: call useHarness() at file top level");
  return current;
}

// ─── Named helpers (delegate to the running harness) ───────────────────────

export const createTenant = (opts?: CreateTenantOptions) => requireHarness().createTenant(opts);
export const createSecondTenant = (opts?: CreateTenantOptions) =>
  requireHarness().createSecondTenant(opts);
export const sql = <T = any>(text: string, params?: unknown[]) =>
  requireHarness().sql<T>(text, params);
export const setRateLimits = (limits: RateLimitOverrides) => requireHarness().setRateLimits(limits);
export const resetRateLimits = () => requireHarness().resetRateLimits();

/**
 * Freeze `Date` (only — timers and the event loop keep running, so HTTP still
 * works) for both the test and the in-process server. Returns a restore
 * function. Note: JWTs issued before freezing are judged against the frozen
 * clock; freezing far in the future expires them, so create tenants after
 * freezing when you jump forward.
 */
export function freezeTime(at: Date | string | number): () => void {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(at) });
  return () => vi.useRealTimers();
}

// ─── Factories ──────────────────────────────────────────────────────────────

export interface AccountRow {
  id: string;
  code: string;
  name_en: string;
  type: string;
}

export async function accountByCode(tenant: Tenant, code: string): Promise<AccountRow> {
  const rows = await sql<AccountRow>(
    `SELECT id, code, name_en, type FROM accounts WHERE company_id = $1 AND code = $2`,
    [tenant.company.id, code]
  );
  if (!rows[0]) throw new Error(`account ${code} not found for company ${tenant.company.id}`);
  return rows[0];
}

export interface JournalLineInput {
  /** Account code (resolved per tenant) or explicit accountId. */
  code?: string;
  accountId?: string;
  debit?: number;
  credit?: number;
  description?: string;
}

/** Create a POSTED manual journal entry through the real API. */
export async function postJournalEntry(
  tenant: Tenant,
  input: { date: string; description?: string; lines: JournalLineInput[]; reference?: string }
): Promise<{ id: string; entryNumber?: string }> {
  const lines = [];
  for (const l of input.lines) {
    const accountId = l.accountId ?? (await accountByCode(tenant, l.code!)).id;
    lines.push({
      accountId,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      description: l.description,
    });
  }
  const r = await tenant.as.post(`/api/companies/${tenant.company.id}/journal`, {
    date: input.date,
    description: input.description ?? "harness entry",
    reference: input.reference,
    status: "posted",
    lines,
  });
  if (r.status >= 300)
    throw new Error(`postJournalEntry failed ${r.status} ${r.text.slice(0, 300)}`);
  return { id: r.body.id, entryNumber: r.body.entryNumber };
}

/** Whole-ledger posted totals for a company (debits, credits). */
export async function ledgerTotals(companyId: string): Promise<{ debit: number; credit: number }> {
  const rows = await sql<{ debit: string; credit: string }>(
    `SELECT COALESCE(SUM(jl.debit), 0)::numeric(18,2)::text AS debit,
            COALESCE(SUM(jl.credit), 0)::numeric(18,2)::text AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted'`,
    [companyId]
  );
  return { debit: Number(rows[0].debit), credit: Number(rows[0].credit) };
}
