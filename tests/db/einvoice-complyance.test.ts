/**
 * E2: UAE e-invoicing through Complyance on the real app + Postgres, against an in-memory
 * Complyance built from the doc-derived fixtures (tests/fixtures/pint-ae/asp/complyance/README.md).
 * Mirrors tests/db/einvoice-acube.test.ts.
 *
 *   - without configuration: nothing named, nothing sent (503), webhook refused;
 *   - onboarding: connect before the EmaraTax authorisation -> reserved (ASP_LINKAGE_NOT_FOUND);
 *     authorised -> registered, mapping not ready -> pending; ready -> active; inactive blocks;
 *   - submit is gated on the company, claimed once (no double submit); two tracks from the
 *     status poll: delivery_success -> delivered, final_valid -> reported; FTA rejection ->
 *     report_failed; buyer-ASP rejection -> a new document is required;
 *   - 422 rejection -> fix and resubmit with the same number;
 *   - a lost response: the retry meets GETS-HEAD-010, nothing is sent twice, a person links it;
 *   - webhooks: valid / bad signature / tampered / stale / no secret, retries absorbed;
 *   - inbound: purchase.invoice.stored -> draft bill tagged e-invoice, once (webhook + poll);
 *   - F16 mandate gate: before go-live nothing must be reported.
 */
import crypto from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";
import {
  companyCredentialVariable,
  sealCompanyCredentials,
} from "../../server/services/einvoice/providers/company-credentials";
import { PINT_AE_FIXTURES, fixtureCompany, type PintAeFixture } from "../fixtures/pint-ae/fixtures";

const h = useHarness();
const TRN = "100123456700003";
const TIN = "1001234567";
const SECRET = crypto.randomUUID();
const API_KEY = crypto.randomUUID();
const WEBHOOK = "/api/webhooks/einvoice/complyance/sandbox";
const today = () => new Date().toISOString().slice(0, 10);

const SELLER_COLUMNS = {
  einvoice_scope: "b2b",
  einvoice_go_live_date: "2026-01-01",
  trn_vat_number: TRN,
  legal_name: "Pearl Trading L.L.C.",
  address_street: "Office 1204, Al Saqr Tower",
  address_city: "Dubai",
  address_country: "AE",
  emirate: "dubai",
  trade_licence_no: "CN-1234567",
  trade_licence_authority: "Dubai Department of Economy and Tourism",
};

// ─── In-memory Complyance (doc-derived shapes) ─────────────────────────

interface FakeDoc {
  id: string;
  number: string;
  source: string;
  body: Record<string, unknown>;
  state: string;
  isTerminal: boolean;
  errors: unknown[];
  ftaApproval?: string | null;
}
const fake = {
  authorised: false,
  ready: false,
  companyStatus: "active",
  companyTin: TIN,
  companyId: "66b9f0a1c2d3e4f567890123",
  sourceName: null as string | null,
  creates: 0,
  posts: 0,
  submitDelayMs: 0,
  nextSubmit: [] as Array<"200" | "422" | "network" | "wrong-id">,
  nextSalesReads: [] as Array<"ok" | "unavailable">,
  docs: new Map<string, FakeDoc>(),
  purchases: [] as Array<{ id: string; number: string; xml: string; companyId: string }>,
  reset() {
    this.authorised = false;
    this.ready = false;
    this.companyStatus = "active";
    this.companyTin = TIN;
    this.companyId = crypto.randomBytes(12).toString("hex");
    this.sourceName = null;
    this.creates = 0;
    this.posts = 0;
    this.submitDelayMs = 0;
    this.nextSubmit = [];
    this.nextSalesReads = [];
    this.docs.clear();
    this.purchases = [];
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function companyItem() {
  return {
    companyId: fake.companyId,
    sourceId: "01JSOURCE",
    branchId: "66b9f0b2c2d3e4f567890456",
    peppolParticipantId: `0235:${TIN}`,
    peppolId: `0235:${TIN}`,
    legalName: "Pearl Trading L.L.C.",
    tin: fake.companyTin,
    vatTrn: TRN,
    sourceName: fake.sourceName,
    sourceVersion: "v1",
    countryCode: "AE",
    branchName: "Dubai",
    status: fake.companyStatus,
    onboardingStatus: "onboarded",
    readyForInvoicing: fake.ready,
    mappingReadiness: fake.ready
      ? { status: "READY", templateId: "default-gets" }
      : { status: "ACTION_REQUIRED", code: "CONNECT_MAPPING_INELIGIBLE" },
  };
}

let idSeq = 0;
async function complyance(url: URL, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const p = url.pathname;
  const headers = init.headers as Record<string, string>;
  if (!headers["User-Agent"]) return new Response("Forbidden", { status: 403 });
  if (p.startsWith("/v3/connect/")) {
    if (headers["X-API-Key"] !== API_KEY)
      return json(401, { code: "invalid_api_key", message: "Invalid API key" });
  } else if (headers.Authorization !== `Bearer ${API_KEY}`) {
    return json(401, { error: "Unauthorized" });
  }
  if (method === "POST" && p === "/v3/connect/companies") {
    fake.creates++;
    const body = JSON.parse(String(init.body));
    if (!fake.authorised || body.tin !== TIN || body.contactPersonEmail !== "owner@pearl.example") {
      return json(409, {
        success: false,
        error: {
          code: "ASP_LINKAGE_NOT_FOUND",
          message: "No pending ASP linkage was found for this company.",
          retryable: false,
        },
        meta: { requestId: "req" },
      });
    }
    if (fake.sourceName) {
      return json(409, {
        success: false,
        error: { code: "CONNECT_COMPANY_ALREADY_EXISTS", message: "exists", retryable: false },
        meta: { requestId: "req" },
      });
    }
    fake.sourceName = body.sourceName;
    return json(201, { success: true, data: companyItem(), meta: { requestId: "req" } });
  }
  if (method === "GET" && p === "/v3/connect/companies") {
    return json(200, {
      success: true,
      data: fake.sourceName ? [companyItem()] : [],
      meta: {
        pagination: {
          page: 1,
          limit: 100,
          total: fake.sourceName ? 1 : 0,
          totalPages: 1,
          hasMore: false,
        },
      },
    });
  }
  if (method === "POST" && p === "/api/v3/unify") {
    fake.posts++;
    const body = JSON.parse(String(init.body)) as Record<string, any>;
    const number = body.payload?.header?.documentNumber as string;
    if (fake.submitDelayMs) await new Promise((r) => setTimeout(r, fake.submitDelayMs));
    if (body.source !== `${fake.sourceName}:v1`)
      return json(404, { error: "No source matches the requested name and version" });
    if (body.environment !== "sandbox")
      return json(403, { code: "permission_denied", message: "A mock API key is required" });
    const existing = [...fake.docs.values()].find((d) => d.number === number);
    if (existing && existing.state !== "rejected") {
      return json(422, {
        documentNumber: number,
        message: `A document with this documentNumber already exists with status ${existing.state === "final_valid" ? "COMPLIANT" : "PROCESSING"}.`,
        validationStage: "gets",
        errors: [
          {
            code: "GETS-HEAD-010",
            getsPath: "header.documentNumber",
            payloadPath: "header.documentNumber",
            message: "Duplicate document number",
            severity: "error",
            ruleSet: "ae:tax_invoice",
          },
        ],
      });
    }
    const mode = fake.nextSubmit.shift() ?? "200";
    const id = existing?.id ?? `01KDOC${String(++idSeq).padStart(20, "0")}`;
    if (mode === "422") {
      fake.docs.set(id, {
        id,
        number,
        source: body.source,
        body,
        state: "rejected",
        isTerminal: true,
        errors: [],
      });
      return json(422, {
        documentId: id,
        documentNumber: number,
        message: "Your invoice could not be validated. Review the errors and try again.",
        validationStage: "gets",
        errors: [
          {
            code: "IBR-132-AE",
            getsPath: "parties.buyer.taxIds",
            payloadPath: "parties.buyer.taxIds",
            message: "The TRN must start with 1 and end with 03.",
            severity: "error",
            ruleSet: "ae:tax_invoice",
          },
        ],
      });
    }
    fake.docs.set(id, {
      id,
      number,
      source: body.source,
      body,
      state: "submitted",
      isTerminal: false,
      errors: [],
    });
    if (mode === "network") throw new TypeError("fetch failed: socket hang up");
    return json(200, {
      documentId: mode === "wrong-id" ? "unexpected-provider-document" : id,
      documentNumber: number,
      message: "Your invoice was validated and is ready for submission.",
      Base64XML: "",
    });
  }
  const one = /^\/api\/v3\/documents\/([^/]+)$/.exec(p);
  if (method === "GET" && one && url.searchParams.get("type") === "sales") {
    if (fake.nextSalesReads.shift() === "unavailable") return json(503, { success: false });
    const d = fake.docs.get(one[1]);
    if (!d) return json(404, { success: false, code: "NOT_FOUND", message: "Document not found" });
    return json(200, {
      success: true,
      data: {
        documentId: d.id,
        documentNumber: d.number,
        // X6a: the seller's source ("name:version" as submitted). ASSUMPTION to confirm in the
        // live sandbox (docs/einvoicing-complyance.md); the link route refuses a document that
        // names no seller.
        source: d.source,
        country: "AE",
        environment: "sandbox",
        state: d.state,
        isTerminal: d.isTerminal,
        errors: d.errors,
        compliance: {
          ftaApprovedStatus:
            d.ftaApproval === undefined
              ? d.state === "final_valid"
                ? "APPROVED"
                : "PENDING"
              : d.ftaApproval,
        },
        validationResults: { status: "Valid", validationSteps: [] },
      },
    });
  }
  if (method === "GET" && one && url.searchParams.get("type") === "purchases") {
    const d = fake.purchases.find((x) => x.id === one[1]);
    if (!d) return json(404, { success: false, code: "NOT_FOUND", message: "Document not found" });
    return json(200, {
      success: true,
      data: {
        documentId: d.id,
        documentNumber: d.number,
        country: "AE",
        environment: "sandbox",
        state: "final_valid",
        isTerminal: true,
        invoice: { header: { documentNumber: d.number }, parties: { buyer: { peppolId: TIN } } },
        xml: d.xml,
      },
    });
  }
  if (
    method === "GET" &&
    p === "/api/v3/documents" &&
    url.searchParams.get("type") === "purchases"
  ) {
    const cid = url.searchParams.get("companyId");
    return json(200, {
      success: true,
      data: {
        items: fake.purchases
          .filter((x) => !cid || x.companyId === cid)
          .map((x) => ({
            documentId: x.id,
            invoiceNumber: x.number,
            status: "purchase.invoice.stored",
            country: "AE",
          })),
        hasMore: false,
        nextCursor: null,
      },
    });
  }
  return json(500, { error: `fake Complyance: no route ${method} ${p}` });
}

const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal("fetch", (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.host === "prod.gets.complyance.io") return complyance(url, init);
    return realFetch(input as string, init);
  }) as typeof fetch);
});

// ─── Env ────────────────────────────────────────────────────────────────

const ENV_KEYS = [
  "EINVOICE_PROVIDER",
  "COMPLYANCE_ENV",
  "COMPLYANCE_WEBHOOK_INLINE",
  "EINVOICE_ASP_BASE_URL",
  "EINVOICE_ASP_API_KEY",
  "ACUBE_EMAIL",
  "ACUBE_PASSWORD",
];
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

let credentialVariable: string | null = null;

function useComplyance(t: Tenant, webhookSecret: string | null = SECRET) {
  const context = {
    companyId: t.company.id,
    provider: "complyance",
    environment: "sandbox",
  } as const;
  credentialVariable = companyCredentialVariable(context);
  process.env[credentialVariable] = sealCompanyCredentials(context, {
    apiKey: API_KEY,
    webhookSecret: webhookSecret ?? undefined,
  });
  process.env.COMPLYANCE_WEBHOOK_INLINE = "false";
}

beforeEach(() => fake.reset());
afterEach(() => {
  if (credentialVariable) delete process.env[credentialVariable];
  credentialVariable = null;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────

type Events = typeof import("../../server/services/einvoice/provider-events");
type Onboarding = typeof import("../../server/services/einvoice/providers/complyance-onboarding");
let events: Events;
let onboarding: Onboarding;
let Provider: typeof import("../../server/services/einvoice/providers/complyance").ComplyanceEInvoiceProvider;
let companyProviderConfiguration: typeof import("../../server/services/einvoice/providers/company-provider").companyProviderConfiguration;
let runEInvoiceRetries: typeof import("../../server/services/einvoice/workflow").runEInvoiceRetries;
let generateEInvoiceXML: typeof import("../../server/services/einvoice.service").generateEInvoiceXML;
let storage: typeof import("../../server/storage").storage;
beforeAll(async () => {
  events = await import("../../server/services/einvoice/provider-events");
  onboarding = await import("../../server/services/einvoice/providers/complyance-onboarding");
  ({ ComplyanceEInvoiceProvider: Provider } =
    await import("../../server/services/einvoice/providers/complyance"));
  ({ generateEInvoiceXML } = await import("../../server/services/einvoice.service"));
  ({ storage } = await import("../../server/storage"));
  ({ companyProviderConfiguration } =
    await import("../../server/services/einvoice/providers/company-provider"));
  ({ runEInvoiceRetries } = await import("../../server/services/einvoice/workflow"));
});

const poll = () => events.runProviderPoll("complyance");
const syncPending = () =>
  onboarding.syncPendingComplyanceCompanies(
    "sandbox",
    (id) => storage.getCompany(id),
    async (company) => {
      const config = await companyProviderConfiguration(company.id, company.einvoicePartner);
      return config ? new Provider(config.env) : null;
    }
  );

function webhook(
  tenant: Tenant,
  type: string,
  data: Record<string, unknown>,
  opts: { eventId?: string; secret?: string; body?: string; timestamp?: string } = {}
) {
  const eventId = opts.eventId ?? `evt-${crypto.randomUUID()}`;
  const body = JSON.stringify({
    eventId,
    data: {
      id: eventId,
      type,
      timestamp: new Date().toISOString(),
      data,
      metadata: { requestId: "r" },
    },
  });
  const signature = crypto
    .createHmac("sha256", opts.secret ?? SECRET)
    .update(body)
    .digest("hex");
  return h.anon.post(`${WEBHOOK}/${tenant.company.id}`, undefined, {
    raw: Buffer.from(opts.body ?? body, "utf8"),
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Event": type,
      "X-Webhook-ID": eventId,
      "X-Webhook-Timestamp": opts.timestamp ?? new Date().toISOString(),
      "X-Webhook-Signature": signature,
    },
  });
}

async function issuedInvoice(t: Tenant, customerTrn = "100765432100003") {
  const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Acme Gulf FZ-LLC",
    trnNumber: customerTrn,
    address: "Building 7, Dubai Internet City",
    city: "Dubai",
    emirate: "dubai",
    country: "AE",
  });
  expect(c.status, c.text).toBeLessThan(300);
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme Gulf FZ-LLC",
    customerTrn,
    contactId: c.body.id,
    date: today(),
    paymentTerms: "net30",
    lines: [{ description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  return inv.body as { id: string; number: string };
}

const connect = (t: Tenant, adminEmail = "owner@pearl.example") =>
  t.as.post(`/api/companies/${t.company.id}/einvoicing/complyance/connect`, { adminEmail });

async function readyTenant(columns: Record<string, unknown> = SELLER_COLUMNS) {
  const t = await h.createTenant({
    companyColumns: { ...columns, einvoice_partner: "complyance" },
  });
  useComplyance(t);
  fake.authorised = true;
  fake.ready = true;
  const r = await connect(t);
  expect(r.status, r.text).toBe(200);
  expect(r.body.legalEntity.status).toBe("active");
  return t;
}

const statusOf = async (t: Tenant, id: string) =>
  (await t.as.get(`/api/invoices/${id}/einvoice/status`)).body;
const docOf = (t: Tenant, id: string) => [...fake.docs.values()].find((d) => d.number === id);

// ─── Tests ──────────────────────────────────────────────────────────────

describe("E2 without Complyance configured: nothing named, nothing sent", () => {
  it("provider card is neutral, Complyance calls 503, webhook refused", async () => {
    const t = await h.createTenant({ companyColumns: SELLER_COLUMNS });
    const prov = await t.as.get(`/api/companies/${t.company.id}/einvoicing/provider`);
    expect(prov.status).toBe(200);
    expect(prov.body).toMatchObject({ provider: null, tin: TIN });
    expect(prov.body.goLive.timeline.large).toBeTruthy();
    expect(prov.body.status).toBe("not_selected");
    const choice = await t.as.put(`/api/companies/${t.company.id}/einvoicing/partner`, {
      partner: "complyance",
    });
    expect(choice.status, choice.text).toBe(200);
    const selected = await t.as.get(`/api/companies/${t.company.id}/einvoicing/provider`);
    expect(selected.body).toMatchObject({
      provider: null,
      chosenProvider: "complyance",
      environment: "sandbox",
      status: "not_configured",
    });
    const card = await t.as.get(`/api/companies/${t.company.id}/einvoicing/complyance`);
    expect(card.body).toMatchObject({
      configured: false,
      accreditationNumber: "112219",
      legalEntity: null,
      canSend: false,
    });
    expect((await connect(t)).status).toBe(503);
    const inv = await issuedInvoice(t);
    const sub = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(sub.status).toBe(503);
    expect(sub.body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");
    expect((await webhook(t, "invoice.passed", { documentId: "x" })).status).toBe(503);
    expect(fake.posts + fake.creates).toBe(0);
  });
});

describe("E2 onboarding gates sending", () => {
  it("before EmaraTax -> reserved; registered -> pending; ready -> active; inactive -> 409", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "complyance" },
    });
    useComplyance(t);
    const prov = await t.as.get(`/api/companies/${t.company.id}/einvoicing/provider`);
    expect(prov.body.provider).toMatchObject({
      id: "complyance",
      accreditationNumber: "112219",
      environment: "sandbox",
    });

    const viewer = await h.createTenant({ role: "viewer" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      viewer.user.id,
    ]);
    expect(
      (
        await viewer.as.post(`/api/companies/${t.company.id}/einvoicing/complyance/connect`, {
          adminEmail: "owner@pearl.example",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await t.as.post(`/api/companies/${t.company.id}/einvoicing/complyance/connect`, {
          adminEmail: "nope",
        })
      ).status
    ).toBe(400);

    const inv = await issuedInvoice(t);
    let r = await connect(t);
    expect(r.status, r.text).toBe(200);
    expect(r.body.legalEntity).toMatchObject({
      status: "reserved",
      tin: TIN,
      lastError: "ASP_LINKAGE_NOT_FOUND",
      adminEmail: "owner@pearl.example",
    });
    expect(r.body.steps.map((s: any) => s.state)).toEqual(["done", "current", "todo"]);
    let blocked = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("EINVOICE_LEGAL_ENTITY_NOT_ACTIVE");
    expect(blocked.body.message).toMatch(/Complyance/);

    // The administrator authorises Complyance in EmaraTax; the poll job retries registration.
    fake.authorised = true;
    expect(await syncPending()).toMatchObject({ checked: 1, activated: 0 });
    r = await t.as.get(`/api/companies/${t.company.id}/einvoicing/complyance`);
    expect(r.body.legalEntity).toMatchObject({
      status: "pending",
      legalEntityId: fake.companyId,
      peppolAddress: `0235:${TIN}`,
      sourceName: `muhasib-${t.company.id}`,
      mappingReadinessCode: "CONNECT_MAPPING_INELIGIBLE",
      readyForInvoicing: false,
    });
    expect(r.body.steps.map((s: any) => s.state)).toEqual(["done", "done", "current"]);
    blocked = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(blocked.body.code).toBe("EINVOICE_LEGAL_ENTITY_NOT_ACTIVE");

    fake.ready = true;
    r = await t.as.post(`/api/companies/${t.company.id}/einvoicing/complyance/sync`, {});
    expect(r.body.legalEntity.status).toBe("active");
    expect(r.body.canSend).toBe(true);
    expect(r.body.steps.map((s: any) => s.state)).toEqual(["done", "done", "done"]);
    expect(fake.creates).toBe(2); // one refused (no authorisation), one created; never re-created

    // The source is archived at Complyance; an onboarding event re-reads it -> sending blocked.
    fake.companyStatus = "inactive";
    const w = await webhook(t, "company.data.modified", { companyId: fake.companyId });
    expect(w.status, w.text).toBe(200);
    await events.runProviderEvents();
    const delinked = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(delinked.status).toBe(409);
    expect(delinked.body.code).toBe("EINVOICE_LEGAL_ENTITY_DELINKED");
    expect(fake.posts).toBe(0);
  });
});

describe("Complyance taxpayer verification", () => {
  it("preserves the unlinked state when the provider responds with a different TIN", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "complyance" },
    });
    useComplyance(t);
    fake.authorised = true;
    fake.ready = true;
    fake.companyTin = "1005555555";
    const route = `/api/companies/${t.company.id}/einvoicing/complyance`;
    const rejected = await connect(t);
    expect(rejected.status, rejected.text).toBe(502);
    expect(rejected.body.code).toBe("EINVOICE_PROVIDER_TIN_MISMATCH");
    expect((await t.as.get(route)).body.legalEntity).toMatchObject({
      status: "reserved",
      legalEntityId: null,
      tin: TIN,
    });

    fake.companyTin = TIN;
    const connected = await t.as.post(`${route}/sync`, {});
    expect(connected.status, connected.text).toBe(200);
    expect(connected.body.legalEntity.status).toBe("active");
    fake.companyTin = "1005555555";
    const synced = await t.as.post(`${route}/sync`, {});
    expect(synced.status, synced.text).toBe(502);
    expect(synced.body.code).toBe("EINVOICE_PROVIDER_TIN_MISMATCH");
    expect((await t.as.get(route)).body.legalEntity).toMatchObject({
      status: "active",
      tin: TIN,
    });
  });
});

describe("E2 submit, two tracks and history", () => {
  it("submits once (concurrent double submit), then delivered, then reported", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    fake.submitDelayMs = 150;
    const [a, b] = await Promise.all([
      t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {}),
      t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {}),
    ]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(fake.posts).toBe(0);
    await Promise.all([runEInvoiceRetries(), runEInvoiceRetries()]);
    expect(fake.posts).toBe(1);
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(409);
    expect(fake.posts).toBe(1);

    const sent = docOf(t, inv.number)!;
    expect(sent.source).toBe(`muhasib-${t.company.id}:v1`);
    expect((sent.body.payload as any).parties.seller.peppolId).toBe(TIN);
    let s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("queued");
    expect(s.transmission).toMatchObject({
      provider: "complyance",
      connected: true,
      providerDocumentId: sent.id,
    });

    // invoice.passed says only "validated"; the re-read decides. Retries are absorbed.
    sent.state = "delivery_success";
    expect(
      (await webhook(t, "invoice.passed", { documentId: sent.id }, { eventId: "e1" })).body
        .duplicate
    ).toBe(false);
    expect(
      (await webhook(t, "invoice.passed", { documentId: sent.id }, { eventId: "e1" })).body
        .duplicate
    ).toBe(true);
    await events.runProviderEvents();
    s = await statusOf(t, inv.id);
    expect(s).toMatchObject({ status: "submitted", submissionState: "sent" });
    expect(s.tracks.delivery.status).toBe("delivered");
    expect(s.tracks.reporting.status).toBe("pending");

    // No webhook reports the final outcome: the poll does.
    sent.state = "final_valid";
    sent.isTerminal = true;
    expect((await poll()).refreshed).toBe(1);
    s = await statusOf(t, inv.id);
    expect(s.status).toBe("cleared");
    expect(s.tracks.reporting.status).toBe("reported");
    expect(Object.fromEntries(s.checklist.map((c: any) => [c.key, c.state]))).toEqual({
      posted: "done",
      validated: "done",
      sent: "done",
      reported: "done",
    });
    expect(s.events.map((e: any) => `${e.source}:${e.track}:${e.to}`)).toEqual(
      expect.arrayContaining([
        "user:delivery:queued",
        "webhook:delivery:delivered",
        "poll:reporting:reported",
      ])
    );
  });

  it("422 names the GETS field; fix and resubmit reuses the same number", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const inv = await issuedInvoice(t);
    fake.nextSubmit = ["422"];
    const r = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(r.body.status).toBe("queued");
    await runEInvoiceRetries();
    let s = await statusOf(t, inv.id);
    const held = docOf(t, inv.number)!;
    expect(s.rejection).toMatchObject({
      code: "COMPLYANCE_VALIDATION",
      resubmittable: true,
      providerHoldsDocument: true,
    });
    expect(s.transmission.providerDocumentId).toBe(held.id);
    expect(s.rejection.reasons[0]).toMatchObject({
      code: "IBR-132-AE",
      field: "parties.buyer.taxIds",
    });
    const re = await t.as.post(`/api/invoices/${inv.id}/einvoice/resubmit`, {});
    expect(re.status, re.text).toBe(202);
    expect(re.body.tracks.delivery.status).toBe("queued");
    expect(
      (await t.as.post(`/api/invoices/${inv.id}/einvoice/refresh-status`, {})).body.status
    ).toBe("queued");
    await runEInvoiceRetries();
    expect(fake.posts).toBe(2);
    expect(fake.docs.size).toBe(1); // Complyance updated the stored document, same id
    s = await statusOf(t, inv.id);
    expect(s.rejection).toBeNull();
    expect(s.transmission.providerDocumentId).toBe(held.id);
  });

  it("rechecks terminal Needs Correction and never switches provider identity on an unexpected resend response", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const inv = await issuedInvoice(t);
    const prefix = `/api/invoices/${inv.id}/einvoice`;
    fake.nextSubmit = ["422"];
    expect((await t.as.post(`${prefix}/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = docOf(t, inv.number)!;
    const originalHash = (await statusOf(t, inv.id)).document.xmlHash;
    expect((await t.as.post(`${prefix}/resubmit`, {})).status).toBe(202);
    held.ftaApproval = "APPROVED";
    await runEInvoiceRetries();
    expect(fake.posts).toBe(1);
    expect((await statusOf(t, inv.id)).transmission.providerDocumentId).toBe(held.id);

    held.ftaApproval = "PENDING";
    await t.as.post(`${prefix}/refresh-status`, {});
    expect((await statusOf(t, inv.id)).rejection.resubmittable).toBe(true);
    expect((await t.as.post(`${prefix}/resubmit`, {})).status).toBe(202);
    fake.nextSubmit = ["wrong-id"];
    await runEInvoiceRetries();
    expect(fake.posts).toBe(2);
    expect(await statusOf(t, inv.id)).toMatchObject({
      document: { xmlHash: originalHash },
      transmission: { providerDocumentId: held.id },
    });
    expect((await t.as.post(`${prefix}/resubmit`, {})).status).toBe(409);
    await runEInvoiceRetries();
    expect(fake.posts).toBe(2);
  });

  it("FTA rejection -> report_failed; buyer-ASP rejection -> a new document is required", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    await runEInvoiceRetries();
    const d = docOf(t, inv.number)!;
    d.state = "final_invalid";
    d.isTerminal = true;
    d.errors = [
      {
        code: "FTA-MLS-RE",
        message: "FTA rejected the TDD",
        path: ["parties", "buyer"],
        source: "government",
      },
    ];
    await poll();
    let s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("delivered");
    expect(s.tracks.reporting.status).toBe("report_failed");
    expect(s.rejection.reasons).toContainEqual(expect.objectContaining({ field: "parties.buyer" }));
    expect(s.checklist.find((c: any) => c.key === "reported")).toMatchObject({
      state: "failed",
      code: "EINVOICE_REPORT_FAILED",
    });

    const inv2 = await issuedInvoice(t);
    await t.as.post(`/api/invoices/${inv2.id}/einvoice/submit`, {});
    await runEInvoiceRetries();
    const d2 = docOf(t, inv2.number)!;
    d2.state = "final_invalid";
    d2.isTerminal = true;
    d2.errors = [
      { code: "C3-MLS-RE", message: "Buyer ASP rejected", path: [], source: "delivery" },
    ];
    await poll();
    s = await statusOf(t, inv2.id);
    expect(s.tracks.delivery.status).toBe("rejected");
    expect(s.rejection).toMatchObject({
      code: "COMPLYANCE_FINAL_INVALID",
      resubmittable: false,
      newDocumentRequired: true,
    });
    const re = await t.as.post(`/api/invoices/${inv2.id}/einvoice/resubmit`, {});
    expect(re.status).toBe(409);
    expect(re.body.code).toBe("EINVOICE_NEW_DOCUMENT_REQUIRED");
    expect(fake.posts).toBe(2);
  });

  it("keeps required FTA reporting pending until an approved provider response arrives", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const doc = docOf(t, inv.number)!;
    doc.state = "final_valid";
    doc.isTerminal = true;
    for (const approval of [null, "REJECTED"]) {
      doc.ftaApproval = approval;
      expect((await poll()).refreshed).toBe(1);
      expect(await statusOf(t, inv.id)).toMatchObject({
        status: "accepted",
        submissionState: "accepted",
        document: { reportedAt: null },
        tracks: { reporting: { status: "pending", required: true } },
      });
    }
    doc.ftaApproval = "APPROVED";
    expect((await poll()).refreshed).toBe(1);
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "cleared",
      submissionState: "accepted",
      tracks: { reporting: { status: "reported", required: true } },
    });
    doc.ftaApproval = null;
    const refreshed = await t.as.post(`/api/invoices/${inv.id}/einvoice/refresh-status`, {});
    expect(refreshed.status, refreshed.text).toBe(200);
    expect(refreshed.body.status).toBe("cleared");
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "cleared",
      tracks: { reporting: { status: "reported" } },
    });
  });

  it("a lost response is never sent twice: GETS-HEAD-010 reads 'needs link' (not rejected), then a person links the document", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const inv = await issuedInvoice(t);
    fake.nextSubmit = ["network"];
    const first = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(first.body.status).toBe("queued");
    await runEInvoiceRetries();
    expect((await statusOf(t, inv.id)).status).toBe("failed");
    await runEInvoiceRetries(new Date(Date.now() + 2 * 60_000));
    expect(fake.docs.size).toBe(1); // the retry was refused as a duplicate, nothing new stored
    let s = await statusOf(t, inv.id);
    // X6a: Complyance may have delivered and reported it: a distinct state, never "rejected".
    expect(s.tracks.delivery.status).toBe("needs_link");
    expect(s.rejection).toBeNull();
    expect(s.checklist.find((c: any) => c.key === "sent")).toMatchObject({
      state: "in_progress",
      code: "EINVOICE_NEEDS_LINK",
    });
    // Not retried again, and a manual resend is refused.
    expect(await runEInvoiceRetries(new Date(Date.now() + 60 * 60_000))).toEqual({
      attempted: 0,
      submitted: 0,
    });
    const resend = await t.as.post(`/api/invoices/${inv.id}/einvoice/resubmit`, {});
    expect(resend.status).toBe(409);
    expect(fake.posts).toBe(2);

    const stored = docOf(t, inv.number)!;
    const wrong = await t.as.post(`/api/companies/${t.company.id}/einvoicing/complyance/link`, {
      invoiceId: inv.id,
      documentId: "01KNOTTHISONE000000",
    });
    expect(wrong.status).toBe(422);
    // X6a: same invoice number, another tenant's source (one platform key serves every tenant).
    fake.docs.set("01KOTHERTENANT000000", {
      ...stored,
      id: "01KOTHERTENANT000000",
      source: "muhasib-someoneelse:v1",
    });
    const foreign = await t.as.post(`/api/companies/${t.company.id}/einvoicing/complyance/link`, {
      invoiceId: inv.id,
      documentId: "01KOTHERTENANT000000",
    });
    expect(foreign.status).toBe(422);
    expect(foreign.body.code).toBe("EINVOICE_LINK_MISMATCH");
    expect(foreign.body.details?.mismatched).toEqual(["source"]);
    // A document that names no seller cannot be proven to be this company's.
    fake.docs.set("01KNOSELLER000000000", { ...stored, id: "01KNOSELLER000000000", source: "" });
    const anonymous = await t.as.post(`/api/companies/${t.company.id}/einvoicing/complyance/link`, {
      invoiceId: inv.id,
      documentId: "01KNOSELLER000000000",
    });
    expect(anonymous.status).toBe(422);
    // Linking needs e-invoice transmission permission; documents.write alone is insufficient.
    const employee = await h.createTenant({ name: "CmpEmployee" });
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'employee')`,
      [t.company.id, employee.user.id]
    );
    const denied = await employee.as.post(
      `/api/companies/${t.company.id}/einvoicing/complyance/link`,
      { invoiceId: inv.id, documentId: stored.id }
    );
    expect(denied.status).toBe(403);
    // Current configuration changed after the provider received the immutable invoice.
    await h.sql("UPDATE companies SET einvoice_partner = 'acube' WHERE id = $1", [t.company.id]);
    await h.sql(
      "UPDATE einvoice_legal_entities SET status = 'inactive', provider_details = jsonb_set(provider_details, '{sourceName}', to_jsonb('replacement-source'::text)) WHERE company_id = $1 AND provider = 'complyance'",
      [t.company.id]
    );
    fake.nextSalesReads = ["unavailable"];
    const unavailable = await t.as.post(
      `/api/companies/${t.company.id}/einvoicing/complyance/link`,
      {
        invoiceId: inv.id,
        documentId: stored.id,
      }
    );
    expect(unavailable.status, unavailable.text).toBe(502);
    expect(unavailable.body.code).toBe("EINVOICE_PROVIDER_UNAVAILABLE");
    expect((await statusOf(t, inv.id)).tracks.delivery.status).toBe("needs_link");
    fake.nextSalesReads = ["ok", "unavailable"];
    const link = await t.as.post(`/api/companies/${t.company.id}/einvoicing/complyance/link`, {
      invoiceId: inv.id,
      documentId: stored.id,
    });
    expect(link.status, link.text).toBe(200);
    expect(link.body).toEqual({ linked: true, refreshed: false });
    s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("queued");
    expect(s.transmission.providerDocumentId).toBe(stored.id);
    expect(s.rejection).toBeNull();
    const [archived] = await h.sql(
      "SELECT provider_message_id FROM einvoice_archive WHERE invoice_id = $1 AND kind = 'submitted'",
      [inv.id]
    );
    expect(archived?.provider_message_id).toBe(stored.id);
    stored.state = "final_valid";
    stored.isTerminal = true;
    await poll();
    expect((await statusOf(t, inv.id)).status).toBe("cleared");
    expect(fake.posts).toBe(2);
  });
});

describe("E2 webhook authentication", () => {
  it("refuses a bad signature, a tampered body, a stale stamp and an unset secret", async () => {
    const t = await readyTenant();
    const bad = await webhook(t, "invoice.passed", { documentId: "x" }, { secret: "other" });
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({
      code: "EINVOICE_WEBHOOK_BAD_SIGNATURE",
      reason: "bad_signature",
    });
    const tampered = await webhook(
      t,
      "invoice.passed",
      { documentId: "x" },
      { body: '{"eventId":"forged"}' }
    );
    expect(tampered.body.reason).toBe("bad_signature");
    const stale = await webhook(
      t,
      "invoice.passed",
      { documentId: "x" },
      { timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }
    );
    expect(stale.body.reason).toBe("stale");
    expect((await webhook(t, "isv.credits.pool.low", {})).body).toEqual({
      received: true,
      ignored: true,
    });
    useComplyance(t, null);
    expect((await webhook(t, "invoice.passed", { documentId: "x" })).status).toBe(503);
  });
});

describe("E2 inbound: purchase.invoice.stored -> draft bill tagged e-invoice", () => {
  it("one draft bill for a purchase seen by webhook and poll", async () => {
    const t = await readyTenant();
    const f = PINT_AE_FIXTURES[0] as PintAeFixture;
    const supplier = {
      ...fixtureCompany,
      trnVatNumber: "100987654300003",
      peppolParticipantId: "1009876543",
      legalName: "Gulf Supplies L.L.C.",
    } as typeof fixtureCompany;
    const { xml } = generateEInvoiceXML(
      { ...f.invoice, number: "AE-INV-005" } as PintAeFixture["invoice"],
      f.lines,
      supplier,
      { ...f.customer, name: "Pearl Trading L.L.C.", trn: TRN, endpointId: TIN },
      f.opts
    );
    const id = "01JPURCHASE000000000000142";
    fake.purchases.push({ id, number: "AE-INV-005", xml, companyId: fake.companyId });
    const w = await webhook(t, "purchase.invoice.stored", {
      documentId: id,
      documentNumber: "AE-INV-005",
      documentType: "tax_invoice",
      country: "AE",
      attribution: { companyId: fake.companyId },
    });
    expect(w.body).toEqual({ received: true, duplicate: false });
    await events.runProviderEvents();
    expect((await poll()).enqueued).toBe(0); // same key as the webhook
    await events.runProviderEvents();
    const bills = await h.sql(
      `SELECT status, origin, bill_number FROM vendor_bills WHERE company_id = $1`,
      [t.company.id]
    );
    expect(bills).toEqual([{ status: "draft", origin: "einvoice", bill_number: "AE-INV-005" }]);
    const rows = await h.sql(
      `SELECT status FROM einvoice_provider_events WHERE provider = 'complyance' AND event_type = 'document.received'`
    );
    expect(rows).toEqual([{ status: "processed" }]);
  });
});

describe("E2 + F16: no FTA reporting before the mandate applies", () => {
  it.each([false, true])(
    "continues to a buyer rejection for a voluntary receipt (legacy cleared: %s)",
    async (legacy) => {
      const t = await readyTenant({ ...SELLER_COLUMNS, einvoice_scope: "none" });
      const inv = await issuedInvoice(t);
      expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      const received = docOf(t, inv.number)!;
      received.state = "delivery_success";
      if (legacy) {
        await h.sql(`UPDATE invoices SET einvoice_status = 'cleared' WHERE id = $1`, [inv.id]);
        await h.sql(
          `UPDATE einvoice_documents SET status = 'cleared', delivery_status = 'delivered',
          provider_status = 'delivery_success', reporting_status = 'not_required', cleared_at = NOW()
          WHERE invoice_id = $1`,
          [inv.id]
        );
      } else {
        expect((await poll()).refreshed).toBe(1);
      }
      expect(await statusOf(t, inv.id)).toMatchObject({
        status: "submitted",
        submissionState: "sent",
        tracks: { reporting: { status: "not_required" } },
        transmission: { recipientAcknowledgement: "received" },
      });
      received.state = "final_invalid";
      received.isTerminal = true;
      received.errors = [
        { code: "C3-MLS-RE", message: "Buyer ASP rejected", path: [], source: "delivery" },
      ];
      expect((await poll()).refreshed).toBe(1);
      expect(await statusOf(t, inv.id)).toMatchObject({
        status: "rejected",
        submissionState: "rejected",
        tracks: { delivery: { status: "rejected" }, reporting: { status: "not_required" } },
        rejection: { code: "COMPLYANCE_FINAL_INVALID", newDocumentRequired: true },
      });
      expect(fake.posts).toBe(1);
    }
  );

  it("preserves provider-confirmed reporting without a local filing obligation", async () => {
    const t = await readyTenant({ ...SELLER_COLUMNS, einvoice_go_live_date: null });
    await h.sql(
      `UPDATE companies SET einvoice_scope = 'b2b', einvoice_turnover_band = 'large', einvoice_go_live_date = NULL WHERE id = $1`,
      [t.company.id]
    );
    const inv = await issuedInvoice(t);
    await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    await runEInvoiceRetries();
    const d = docOf(t, inv.number)!;
    d.state = "final_valid";
    d.isTerminal = true;
    // The current company settings no longer match the terms frozen on this invoice.
    await h.sql(`UPDATE companies SET einvoice_go_live_date = '2026-01-01' WHERE id = $1`, [
      t.company.id,
    ]);
    await poll();
    const s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("delivered");
    expect(s.tracks.reporting).toMatchObject({
      status: "reported",
      required: false,
      reportBy: null,
      overdue: false,
    });
    const documents = await t.as.get(`/api/companies/${t.company.id}/einvoicing/documents`);
    expect(documents.status, documents.text).toBe(200);
    expect(documents.body.items).toContainEqual(
      expect.objectContaining({
        invoiceId: inv.id,
        reportingRequired: false,
        reportingStatus: "reported",
        reportBy: null,
      })
    );
    const compliance = await t.as.get(`/api/companies/${t.company.id}/einvoicing/compliance`);
    expect(compliance.status, compliance.text).toBe(200);
    expect(compliance.body.items).toContainEqual(
      expect.objectContaining({
        invoiceId: inv.id,
        reportingRequired: false,
        reporting: "reported",
        reportBy: null,
      })
    );
    expect((await poll()).refreshed).toBe(0);
  });

  it.each([false, true])(
    "keeps an actual government rejection visible on a voluntary submission (buyer rejected: %s)",
    async (buyerRejected) => {
      const t = await readyTenant({ ...SELLER_COLUMNS, einvoice_scope: "none" });
      const inv = await issuedInvoice(t);
      expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      const d = docOf(t, inv.number)!;
      d.state = "final_invalid";
      d.isTerminal = true;
      d.errors = [{ code: "FTA-MLS-RE", message: "FTA rejected", path: [], source: "government" }];
      if (buyerRejected)
        d.errors.push({
          code: "C3-MLS-RE",
          message: "Buyer rejected",
          path: [],
          source: "delivery",
        });
      expect((await poll()).refreshed).toBe(1);
      expect(await statusOf(t, inv.id)).toMatchObject({
        submissionState: "rejected",
        tracks: {
          delivery: { status: buyerRejected ? "rejected" : "delivered" },
          reporting: { status: "report_failed", required: false, reportBy: null, overdue: false },
        },
        rejection: { code: buyerRejected ? "COMPLYANCE_FINAL_INVALID" : "EINVOICE_REPORT_FAILED" },
      });
      expect((await poll()).refreshed).toBe(0);
    }
  );

  it("reverifies legacy reported rows before projecting their approval, while preserving the old audit entry", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const d = docOf(t, inv.number)!;
    d.state = "final_valid";
    d.isTerminal = true;
    const oldAt = "2026-01-01T00:00:00.000Z";
    await h.sql("UPDATE companies SET einvoice_scope = 'none' WHERE id = $1", [t.company.id]);
    await h.sql(`UPDATE invoices SET einvoice_status = 'cleared' WHERE id = $1`, [inv.id]);
    await h.sql(
      `UPDATE einvoice_documents SET status = 'cleared', delivery_status = 'delivered',
      provider_status = 'final_valid', reporting_status = 'reported', reported_at = $2,
      reporting_status_at = $2, cleared_at = $2, validation = validation #- '{submission,reportingRequired}'
      WHERE invoice_id = $1`,
      [inv.id, oldAt]
    );
    const [{ id: earlierEvent }] = await h.sql(
      `INSERT INTO einvoice_document_events
      (company_id, invoice_id, track, from_status, to_status, provider, source, created_at)
      VALUES ($1, $2, 'reporting', 'pending', 'reported', 'complyance', 'poll', $3) RETURNING id`,
      [t.company.id, inv.id, oldAt]
    );
    const before = await statusOf(t, inv.id);
    expect(before).toMatchObject({
      status: "accepted",
      tracks: { reporting: { status: "pending", required: true } },
      document: { reportedAt: null, clearedAt: null },
    });
    expect(before.events).toContainEqual(
      expect.objectContaining({ id: earlierEvent, to: "pending", confirmationUnavailable: true })
    );
    const compliance = await t.as.get(`/api/companies/${t.company.id}/einvoicing/compliance`);
    expect(compliance.body).toMatchObject({
      mandateApplies: false,
      items: expect.arrayContaining([
        expect.objectContaining({
          invoiceId: inv.id,
          reportingRequired: true,
          reporting: "pending",
          reportBy: expect.any(String),
        }),
      ]),
    });
    expect((await poll()).refreshed).toBe(1);
    const confirmed = await statusOf(t, inv.id);
    expect(confirmed).toMatchObject({
      status: "cleared",
      tracks: { reporting: { status: "reported", required: true } },
    });
    expect(confirmed.document.reportedAt).not.toBe(oldAt);
    expect(confirmed.document.clearedAt).toBe(confirmed.document.reportedAt);
    expect(confirmed.document.validation).not.toHaveProperty("submission");
    expect(confirmed.events).toContainEqual(
      expect.objectContaining({ id: earlierEvent, to: "pending", confirmationUnavailable: true })
    );
    expect(confirmed.events).toContainEqual(
      expect.objectContaining({
        track: "reporting",
        to: "reported",
        at: confirmed.document.reportedAt,
      })
    );
    expect((await poll()).refreshed).toBe(0);
  });
});

describe("Legacy Complyance environment verification", () => {
  it("verifies a user-supplied original document ID for a legacy ambiguous attempt", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const inv = await issuedInvoice(t);
    const path = `/api/invoices/${inv.id}/einvoice/confirm-environment`;
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = docOf(t, inv.number)!;
    await h.sql(
      "UPDATE invoices SET einvoice_status = 'failed', einvoice_provider_message_id = NULL WHERE id = $1",
      [inv.id]
    );
    await h.sql(
      "UPDATE einvoice_documents SET status = 'failed', provider_message_id = NULL, delivery_status = 'delivery_failed', next_retry_at = NULL, validation = '{}' WHERE invoice_id = $1",
      [inv.id]
    );
    expect(await statusOf(t, inv.id)).toMatchObject({
      submissionState: "needs_reconciliation",
      transmission: {
        canSubmit: false,
        environmentVerification: {
          provider: "complyance",
          reference: "manual",
          environments: ["sandbox"],
        },
      },
    });
    const other = await h.createTenant({ name: "Unrelated Complyance recovery company" });
    expect(
      (await other.as.post(path, { environment: "sandbox", documentId: held.id })).status
    ).toBe(404);
    expect((await t.as.post(path, { environment: "sandbox" })).status).toBe(422);
    expect((await t.as.post(path, { environment: "sandbox", documentId: "wrong-id" })).status).toBe(
      422
    );
    const seller = held.source;
    held.source = "another-company:v1";
    expect((await t.as.post(path, { environment: "sandbox", documentId: held.id })).status).toBe(
      422
    );
    held.source = seller;
    const attached = await t.as.post(path, { environment: "sandbox", documentId: held.id });
    expect(attached.status, attached.text).toBe(200);
    expect(attached.body.providerDocumentId).toBe(held.id);
    held.state = "final_valid";
    held.isTerminal = true;
    await events.runProviderPoll("complyance", { companyId: t.company.id });
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "cleared",
      transmission: { providerDocumentId: held.id },
    });
    expect(fake.posts).toBe(1);
  });
  it("restores an invoice-only reference from immutable archived proof and resumes polling", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    const path = `/api/invoices/${inv.id}/einvoice/confirm-environment`;
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = docOf(t, inv.number)!;
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    await h.sql("DELETE FROM einvoice_documents WHERE invoice_id = $1", [inv.id]);
    await h.sql(
      "UPDATE invoices SET einvoice_xml = NULL, einvoice_hash = NULL, einvoice_uuid = NULL WHERE id = $1",
      [inv.id]
    );
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "submitted",
      transmission: {
        environmentVerification: { provider: "complyance", environments: ["sandbox"] },
      },
    });
    const originalSource = held.source;
    held.source = "wrong-seller:v1";
    const wrong = await t.as.post(path, { environment: "sandbox" });
    expect(wrong.status, wrong.text).toBe(422);
    expect(wrong.body.code).toBe("EINVOICE_ENVIRONMENT_PROOF_MISMATCH");
    expect(
      await h.sql("SELECT id FROM einvoice_documents WHERE invoice_id = $1", [inv.id])
    ).toEqual([]);

    held.source = originalSource;
    const verified = await t.as.post(path, { environment: "sandbox" });
    expect(verified.status, verified.text).toBe(200);
    expect(verified.body).toEqual({
      provider: "complyance",
      environment: "sandbox",
      verified: true,
    });
    const [doc] = await h.sql(
      "SELECT status, provider_message_id, attempts, next_retry_at, validation ->> 'valid' AS validation_result FROM einvoice_documents WHERE invoice_id = $1",
      [inv.id]
    );
    expect(doc).toEqual({
      status: "submitted",
      provider_message_id: held.id,
      attempts: 0,
      next_retry_at: null,
      validation_result: null,
    });
    held.state = "final_valid";
    held.isTerminal = true;
    expect(
      (await events.runProviderPoll("complyance", { companyId: t.company.id })).refreshed
    ).toBe(1);
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "cleared",
      transmission: { environmentVerification: null, providerDocumentId: held.id },
    });
    expect(fake.posts).toBe(1);
  });
});
