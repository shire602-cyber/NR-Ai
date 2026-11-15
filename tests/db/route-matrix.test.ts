/**
 * Cross-tenant route matrix (R17-21).
 *
 * Enumerates EVERY route registered on the real Express app and probes each
 * authenticated route as tenant B against tenant A's data:
 *
 * - ""        B calls the route with A's company id and freshly created A rows
 *             (rows come from the schema-introspecting row factory).
 * - "#mixed"  B's OWN company id in the URL plus A's row ids (catches handlers
 *             that check the company but then load/update the row by id only).
 * - "#inject" B PUT/PATCHes B's own row with { companyId: A } in the body
 *             (catches mass assignment that moves rows into another tenant).
 * - "#global" routes with no tenant param: B's GET response must not contain
 *             A's ids/markers; plus explicit global write probes (below).
 *
 * A probe FAILS when B gets a 2xx on A's resource, when an A row changed
 * after B's request, when B's row was moved into A, or when A's data shows up
 * in a global response. 401/403/404 are the expected answers; other 4xx/5xx
 * are reported but do not fail (no A data was touched).
 *
 * Known failures owned by later workstreams live in route-matrix-allow/, ONE
 * JSON file per issue id: { issue, owner, reason, routes: ["METHOD /path#shape"] }.
 * The test fails for a failing probe with no allow entry, for a probe listed
 * in two allow files, and for an allow entry that no longer fails (delete your
 * issue's file when you fix it).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useHarness, type HttpMethod, type RegisteredRoute, type Tenant } from "./harness";
import { insertRow, snapshotRow, type RowContext } from "./row-factory";

const h = useHarness();
const ALLOW_DIR = path.join(__dirname, "route-matrix-allow");

// ─── Param → table resolution ──────────────────────────────────────────────

const PARAM_TABLES: Record<string, string> = {
  invoiceId: "invoices",
  requirementId: "document_requirements",
  workpaperId: "vat_workpapers",
  rowId: "vat_workpaper_rows",
  tid: "bank_transactions",
  memberId: "company_users",
  runId: "company_report_delivery_runs",
  subscriptionId: "company_report_delivery_subscriptions",
  periodId: "vat_return_periods",
  taskId: "compliance_tasks",
  documentId: "invoices", // document-versions/:documentType(invoice)/:documentId
  noteId: "client_notes",
  integrationId: "ecommerce_integrations",
  messageId: "whatsapp_messages",
  sessionId: "whatsapp_bridge_sessions",
  jobId: "whatsapp_bridge_jobs",
  invitationId: "invitations",
  attachmentId: "vat_workpaper_attachments",
  accountId: "bank_accounts",
};

const SEGMENT_TABLES: Record<string, string> = {
  invoices: "invoices",
  accounts: "accounts",
  receipts: "receipts",
  journal: "journal_entries",
  products: "products",
  employees: "employees",
  "payroll-runs": "payroll_runs",
  "payroll-items": "payroll_items",
  "expense-claims": "expense_claims",
  bills: "vendor_bills",
  "fixed-assets": "fixed_assets",
  "budget-plans": "budget_plans",
  "budget-lines": "budget_lines",
  "anomaly-alerts": "anomaly_alerts",
  anomalies: "anomaly_alerts",
  "bank-transactions": "bank_transactions",
  quotes: "quotes",
  "credit-notes": "invoices", // credit notes are invoices rows (invoice_type credit_note)
  "purchase-orders": "purchase_orders",
  "cost-centers": "cost_centers",
  "reconciliation-rules": "reconciliation_rules",
  "invoice-templates": "invoice_templates",
  "bank-connections": "bank_connections",
  "api-keys": "api_keys",
  webhooks: "webhook_endpoints",
  "recurring-invoices": "recurring_invoices",
  notifications: "notifications",
  "reminder-settings": "reminder_settings",
  backups: "backups",
  "vat-returns": "vat_returns",
  returns: "corporate_tax_returns",
  "compliance-tasks": "compliance_tasks",
  documents: "documents",
  "customer-contacts": "customer_contacts",
  templates: "chase_templates",
  "document-requirements": "document_requirements",
  queue: "ai_gl_queue",
  leads: "firm_leads",
  alerts: "firm_alerts",
  "growth-opportunities": "firm_growth_opportunities",
  sources: "client_email_sources",
  notes: "client_notes",
  invitations: "invitations",
};

/** Params whose value is a company id. */
const COMPANY_PARAMS = new Set(["companyId", "clientId"]);
const NON_ID_PARAM_VALUES: Record<string, string> = {
  period: "month",
  persona: "owner",
  documentType: "invoice",
  provider: "google",
  token: "xt-probe-token",
  code: "XTPROBE",
};

/** Harmless partial-update body so update handlers reach their write path. */
const PROBE_BODY = {
  name: "xt-probe",
  nameEn: "xt-probe",
  description: "xt-probe",
  notes: "xt-probe",
  merchant: "xt-probe",
  emailSubject: "xt-probe",
  isEnabled: false,
  role: "employee",
};

interface ParamSpec {
  name: string;
  kind: "company" | "row" | "unresolved-id" | "value";
  table?: string;
}

export function paramSpecs(route: RegisteredRoute): ParamSpec[] {
  const segs = route.path.split("/");
  const specs: ParamSpec[] = [];
  segs.forEach((seg, i) => {
    if (!seg.startsWith(":")) return;
    const name = seg.slice(1).replace(/\?$/, "");
    const prev = segs[i - 1] ?? "";
    if (
      COMPANY_PARAMS.has(name) ||
      (name === "id" && (prev === "companies" || prev === "clients"))
    ) {
      specs.push({ name, kind: "company", table: "companies" });
    } else if (name !== "id" && PARAM_TABLES[name]) {
      specs.push({ name, kind: "row", table: PARAM_TABLES[name] });
    } else if (name === "id" && SEGMENT_TABLES[prev]) {
      specs.push({ name, kind: "row", table: SEGMENT_TABLES[prev] });
    } else if (name === "id" || /Id$/.test(name)) {
      specs.push({ name, kind: "unresolved-id" });
    } else {
      specs.push({ name, kind: "value" });
    }
  });
  return specs;
}

const inScope = (specs: ParamSpec[]) => specs.some((s) => s.kind !== "value");

// ─── Global write probes (routes with no tenant param) ─────────────────────

interface GlobalProbe {
  key: string;
  /** Returns true when tenant B's call changed what tenant A sees. */
  run(a: Tenant, b: Tenant): Promise<boolean>;
}

const GLOBAL_WRITE_PROBES: GlobalProbe[] = [
  {
    key: "POST /api/exchange-rates#global",
    async run(a, b) {
      const before = await a.as.get("/api/exchange-rates/lookup?base=USD&target=AED");
      const w = await b.as.post("/api/exchange-rates", {
        baseCurrency: "USD",
        targetCurrency: "AED",
        rate: 9.99,
        date: new Date().toISOString().slice(0, 10),
      });
      const after = await a.as.get("/api/exchange-rates/lookup?base=USD&target=AED");
      await h.sql(`DELETE FROM exchange_rates WHERE rate::numeric = 9.99`).catch(() => undefined);
      return (
        w.status < 300 && Number(after.body?.rate) === 9.99 && Number(before.body?.rate) !== 9.99
      );
    },
  },
  {
    key: "POST /api/exchange-rates/fta/bulk#global",
    async run(a, b) {
      const date = new Date().toISOString().slice(0, 10);
      const w = await b.as.post("/api/exchange-rates/fta/bulk", {
        baseCurrency: "AED",
        rates: [{ targetCurrency: "GBP", rate: 7.77, date }],
      });
      const rows = await h.sql(`SELECT 1 FROM exchange_rates WHERE rate::numeric = 7.77`);
      const visible = await a.as.get("/api/exchange-rates/lookup?base=AED&target=GBP");
      await h.sql(`DELETE FROM exchange_rates WHERE rate::numeric = 7.77`).catch(() => undefined);
      return w.status < 300 && rows.length > 0 && Number(visible.body?.rate) === 7.77;
    },
  },
  {
    key: "DELETE /api/push/unsubscribe#global",
    async run(a, b) {
      const endpoint = `https://push.harness.test/${randomUUID()}`;
      const id = await insertRow(
        h.sql,
        "push_subscriptions",
        { companyId: a.company.id, userId: a.user.id },
        { endpoint, is_active: true }
      );
      // The handler passes `endpoint` to deactivatePushSubscription(id), which
      // matches on the subscription id with no user filter — try both.
      await b.as.delete("/api/push/unsubscribe", { endpoint });
      await b.as.delete("/api/push/unsubscribe", { endpoint: id });
      const rows = await h.sql(`SELECT is_active FROM push_subscriptions WHERE id = $1`, [id]);
      return rows[0]?.is_active === false;
    },
  },
];

/** Seed tenant-A marker rows in global/aggregate tables before #global GETs. */
async function seedGlobalMarkers(a: Tenant): Promise<void> {
  const marker = `xt-mark-${a.company.id.slice(0, 8)}`;
  const ctx = { companyId: a.company.id, userId: a.user.id };
  await insertRow(h.sql, "analytics_events", ctx, {
    event_type: "page_view",
    event_name: marker,
    page_url: `/${marker}`,
  });
  await insertRow(h.sql, "feature_usage_metrics", ctx, { feature_name: marker, period: "daily" });
  await insertRow(h.sql, "notifications", ctx, { title: marker, message: marker });
}

// ─── Allow files ────────────────────────────────────────────────────────────

interface AllowFile {
  issue: string;
  owner?: string;
  reason?: string;
  routes: string[];
}

function readAllowFiles(): Map<string, AllowFile> {
  const out = new Map<string, AllowFile>();
  if (!fs.existsSync(ALLOW_DIR)) return out;
  for (const f of fs
    .readdirSync(ALLOW_DIR)
    .filter((x) => x.endsWith(".json"))
    .sort()) {
    out.set(f, JSON.parse(fs.readFileSync(path.join(ALLOW_DIR, f), "utf8")) as AllowFile);
  }
  return out;
}

// ─── Matrix ─────────────────────────────────────────────────────────────────

type Shape = "" | "#mixed" | "#inject" | "#global";

interface Outcome {
  key: string;
  status: number;
  mutated: boolean;
  resolved: boolean;
  failing: boolean;
  note?: string;
}

interface Watched {
  table: string;
  id: string;
  before: string | null;
}

describe("cross-tenant route matrix", () => {
  it("tenant B cannot read or change tenant A's resources on any route", async () => {
    const routes = h.routes();
    // Acceptance: the matrix must see (nearly) the whole API surface.
    expect(routes.length).toBeGreaterThanOrEqual(300);

    let a: Tenant = await h.createTenant({ name: "MatrixA" });
    let b: Tenant = await h.createSecondTenant({ name: "MatrixB" });
    await seedGlobalMarkers(a);
    const outcomes: Outcome[] = [];
    const factoryErrors = new Map<string, string>();
    const companyCol = new Map<string, boolean>();

    const resolveParams = async (
      specs: ParamSpec[],
      template: string,
      companyFor: Tenant,
      rowsFor: Tenant
    ) => {
      const ctx: RowContext = {
        companyId: rowsFor.company.id,
        userId: rowsFor.user.id,
        created: new Map(),
      };
      const watched: Watched[] = [];
      let resolved = true;
      let url = template;
      for (const spec of specs) {
        let value: string;
        if (spec.kind === "company") {
          value = companyFor.company.id;
          if (companyFor === rowsFor) watched.push({ table: "companies", id: value, before: null });
        } else if (spec.kind === "row") {
          try {
            const existing = ctx.created!.get(spec.table!);
            if (existing) {
              value = existing;
            } else {
              const overrides: Record<string, unknown> = {};
              if (spec.table === "company_users") {
                overrides.user_id = await insertRow(h.sql, "users", ctx, {
                  email: `xt-member-${randomUUID().slice(0, 8)}@harness.test`,
                  user_type: "customer",
                });
                overrides.role = "accountant";
              }
              value = await insertRow(h.sql, spec.table!, ctx, overrides);
              ctx.created!.set(spec.table!, value);
            }
            watched.push({ table: spec.table!, id: value, before: null });
          } catch (err: any) {
            factoryErrors.set(spec.table!, String(err?.message ?? err).slice(0, 240));
            value = randomUUID();
            resolved = false;
          }
        } else if (spec.kind === "unresolved-id") {
          value = randomUUID();
          resolved = false;
        } else {
          value = NON_ID_PARAM_VALUES[spec.name] ?? "xt-probe";
        }
        url = url.replace(new RegExp(`:${spec.name}\\??`), value);
      }
      for (const w of watched) w.before = await snapshotRow(h.sql, w.table, w.id);
      return { url, watched, resolved };
    };

    // DELETEs run last and the bare company route after everything, so a
    // leaking destructive route cannot mask the routes after it.
    const rank = (r: RegisteredRoute) =>
      (r.method === "DELETE" ? 2 : 0) + (/^\/api\/companies\/:id$/.test(r.path) ? 4 : 0);
    const all = routes
      .map((route) => ({ route, specs: paramSpecs(route) }))
      .sort((x, y) => rank(x.route) - rank(y.route));

    for (const { route, specs } of all) {
      const method = route.method as HttpMethod;
      // Public routes (no auth required) are out of scope for tenancy.
      const anonUrl = route.path.replace(/:([A-Za-z]+)\??/g, () => randomUUID());
      const anon = await h.anon.request(method, anonUrl, method === "GET" ? undefined : {});
      if (![401, 403].includes(anon.status)) continue;

      const shapes: Shape[] = [];
      if (inScope(specs)) {
        shapes.push("");
        if (specs.some((s) => s.kind === "company") && specs.some((s) => s.kind === "row")) {
          shapes.push("#mixed");
        }
        if ((method === "PUT" || method === "PATCH") && specs.some((s) => s.kind === "row")) {
          shapes.push("#inject");
        }
      } else if (method === "GET" && route.path.startsWith("/api/")) {
        shapes.push("#global");
      }

      for (const shape of shapes) {
        const key = `${route.method} ${route.path}${shape}`;
        let resetA = false;
        let resetB = false;

        if (shape === "#global") {
          const res = await b.as.get(route.path);
          const marker = `xt-mark-${a.company.id.slice(0, 8)}`;
          const leaked =
            res.status >= 200 &&
            res.status < 300 &&
            [a.company.id, a.user.id, a.email, marker].some((n) => res.text.includes(n));
          outcomes.push({
            key,
            status: res.status,
            mutated: false,
            resolved: true,
            failing: leaked,
            note: leaked ? "response contains tenant A data" : undefined,
          });
          continue;
        }

        if (shape === "#inject") {
          const rowSpec = specs.find((s) => s.kind === "row")!;
          if (!companyCol.has(rowSpec.table!)) {
            const cols = await h.sql(
              `SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'company_id'`,
              [rowSpec.table]
            );
            companyCol.set(rowSpec.table!, cols.length > 0);
          }
          if (!companyCol.get(rowSpec.table!)) continue;
          const { url, watched, resolved } = await resolveParams(specs, route.path, b, b);
          if (!resolved) continue;
          const res = await b.as.request(method, url, {
            ...PROBE_BODY,
            companyId: a.company.id,
            company_id: a.company.id,
          });
          const target = watched.find((w) => w.table === rowSpec.table)!;
          const rows = await h.sql(`SELECT company_id FROM "${target.table}" WHERE id::text = $1`, [
            target.id,
          ]);
          const moved = rows[0]?.company_id === a.company.id;
          outcomes.push({
            key,
            status: res.status,
            mutated: moved,
            resolved,
            failing: moved,
            note: moved ? "B's row was moved into tenant A" : undefined,
          });
          resetB = moved;
        } else {
          const companyFor = shape === "#mixed" ? b : a;
          const { url, watched, resolved } = await resolveParams(specs, route.path, companyFor, a);
          const res = await b.as.request(method, url, method === "GET" ? undefined : PROBE_BODY);
          let mutated = false;
          for (const w of watched) {
            if ((await snapshotRow(h.sql, w.table, w.id)) !== w.before) mutated = true;
          }
          const ok2xx = res.status >= 200 && res.status < 300;
          // Direct: any 2xx on A's company/row is a failure. Mixed: the URL
          // names B's own company, so a 2xx is only a failure when A's row
          // changed or A's row/company shows up in the response.
          const aIds = [a.company.id, ...watched.map((w) => w.id)];
          const failing =
            shape === "#mixed"
              ? mutated || (ok2xx && aIds.some((id) => res.text.includes(id)))
              : ok2xx || mutated;
          outcomes.push({
            key,
            status: res.status,
            mutated,
            resolved,
            failing,
            note: failing ? res.text.slice(0, 160) : undefined,
          });
          const touchesTenancy = watched.some(
            (w) => w.table === "companies" || w.table === "company_users"
          );
          resetA = failing && touchesTenancy;
          resetB = failing && touchesTenancy;
        }

        // Never judge later routes against a damaged tenant.
        if (resetA) {
          a = await h.createTenant({ name: "MatrixA" });
          await seedGlobalMarkers(a);
        }
        if (resetB) b = await h.createSecondTenant({ name: "MatrixB" });
      }
    }

    for (const probe of GLOBAL_WRITE_PROBES) {
      const failing = await probe.run(a, b);
      outcomes.push({ key: probe.key, status: 0, mutated: failing, resolved: true, failing });
    }

    // ── Report ──
    const failingKeys = new Set(outcomes.filter((o) => o.failing).map((o) => o.key));
    const allow = readAllowFiles();
    const allowedBy = new Map<string, string[]>();
    for (const [file, entry] of allow) {
      expect(entry.issue, `${file}: issue id`).toBe(file.replace(/\.json$/, ""));
      for (const r of entry.routes) allowedBy.set(r, [...(allowedBy.get(r) ?? []), file]);
    }

    const histogram: Record<string, number> = {};
    for (const o of outcomes) histogram[o.status] = (histogram[o.status] ?? 0) + 1;
    const count = (pred: (o: Outcome) => boolean) => outcomes.filter(pred).length;
    console.log(
      `[route-matrix] routes=${routes.length} probes=${outcomes.length} ` +
        `(direct=${count((o) => !o.key.includes("#"))} mixed=${count((o) => o.key.endsWith("#mixed"))} ` +
        `inject=${count((o) => o.key.endsWith("#inject"))} global=${count((o) => o.key.endsWith("#global"))}) ` +
        `withTenantRows=${count((o) => o.resolved)} failing=${failingKeys.size} ` +
        `statuses=${JSON.stringify(histogram)}`
    );
    for (const [table, err] of factoryErrors) {
      console.log(`[route-matrix] no factory for ${table} (probed with random ids): ${err}`);
    }
    for (const o of outcomes.filter((x) => x.failing)) {
      console.log(
        `[route-matrix] FAIL ${o.key} -> ${o.status}${o.mutated ? " (tenant row changed)" : ""} ` +
          `allow=${(allowedBy.get(o.key) ?? []).join(",") || "NONE"} ${o.note ?? ""}`
      );
    }

    const unexpected = [...failingKeys].filter((k) => !allowedBy.has(k)).sort();
    const duplicated = [...allowedBy.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([k, files]) => `${k} (${files.join(", ")})`);
    const stale = [...allowedBy.keys()].filter((k) => !failingKeys.has(k)).sort();

    expect(duplicated, "probe listed in more than one allow file").toEqual([]);
    expect(unexpected, "cross-tenant failures with no allow file").toEqual([]);
    expect(stale, "allow entries that no longer fail — delete them").toEqual([]);
  }, 900_000);
});
