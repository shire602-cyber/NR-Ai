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
  response?: Record<string, unknown>;
}
const fake = {
  authorised: false,
  ready: false,
  companyStatus: "active",
  companyTin: TIN,
  expectedConnectTin: TIN,
  companyId: "66b9f0a1c2d3e4f567890123",
  beforeConnectReply: null as (() => Promise<void>) | null,
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
    this.expectedConnectTin = TIN;
    this.companyId = crypto.randomBytes(12).toString("hex");
    this.beforeConnectReply = null;
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
    peppolParticipantId: `0235:${fake.companyTin}`,
    peppolId: `0235:${fake.companyTin}`,
    legalName: "Pearl Trading L.L.C.",
    tin: fake.companyTin,
    vatTrn: `${fake.companyTin}00003`,
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
    if (
      !fake.authorised ||
      body.tin !== fake.expectedConnectTin ||
      body.contactPersonEmail !== "owner@pearl.example"
    ) {
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
    await fake.beforeConnectReply?.();
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
        ...d.response,
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
  it("does not activate a Complyance taxpayer superseded while its response was pending", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "complyance" },
    });
    useComplyance(t);
    fake.authorised = true;
    fake.ready = true;
    fake.beforeConnectReply = async () => {
      await h.sql(
        `UPDATE companies SET trn_vat_number = $2, einvoice_tin = $3, peppol_participant_id = $3
        WHERE id = $1`,
        [t.company.id, "100555555500003", "1005555555"]
      );
    };
    const response = await connect(t);
    expect(response.status, response.text).toBe(422);
    expect(
      await h.sql(
        `SELECT status, tin, legal_entity_id FROM einvoice_legal_entities WHERE company_id = $1`,
        [t.company.id]
      )
    ).toEqual([{ status: "reserved", tin: TIN, legal_entity_id: null }]);
    const path = `/api/companies/${t.company.id}/einvoicing/complyance`;
    expect((await t.as.get(path)).body).toMatchObject({ canSend: false, legalEntity: null });
    // The file shares a database with the separate poll batch fixtures.
    await h.sql(`DELETE FROM einvoice_legal_entities WHERE company_id = $1`, [t.company.id]);
  });

  it("hides a superseded Complyance taxpayer and explicitly reconnects with a distinct source", async () => {
    const t = await readyTenant();
    const path = `/api/companies/${t.company.id}/einvoicing`;
    const inv = await issuedInvoice(t);
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const evidence = () =>
      h.sql(
        `SELECT xml_hash, provider_message_id, validation->'submission' AS pin
      FROM einvoice_documents WHERE invoice_id = $1`,
        [inv.id]
      );
    const original = await evidence();
    const oldEntity = fake.companyId;
    const oldSource = fake.sourceName;
    expect(original).toEqual([
      expect.objectContaining({
        provider_message_id: expect.any(String),
        pin: expect.objectContaining({
          supplierTin: TIN,
          legalEntityId: oldEntity,
          sourceName: oldSource,
          environment: "sandbox",
        }),
      }),
    ]);

    const nextTin = "1005555555";
    await h.sql(
      `UPDATE companies SET trn_vat_number = $2, einvoice_tin = $3, peppol_participant_id = $3
      WHERE id = $1`,
      [t.company.id, `${nextTin}00003`, nextTin]
    );
    expect((await t.as.get(`${path}/settings`)).body.asp.connected).toBe(false);
    expect((await t.as.get(`${path}/complyance`)).body).toMatchObject({
      canSend: false,
      legalEntity: null,
    });
    expect((await t.as.post(`${path}/complyance/sync`, {})).status).toBe(422);

    fake.companyId = crypto.randomBytes(12).toString("hex");
    fake.companyTin = nextTin;
    fake.expectedConnectTin = nextTin;
    fake.sourceName = null;
    const replacement = await connect(t);
    expect(replacement.status, replacement.text).toBe(200);
    expect(replacement.body.legalEntity).toMatchObject({
      status: "active",
      tin: nextTin,
      legalEntityId: fake.companyId,
    });
    expect(fake.sourceName).not.toBe(oldSource);
    expect((await t.as.get(`${path}/settings`)).body.asp.connected).toBe(true);
    expect(await evidence()).toEqual(original);
    const oldId = original[0].provider_message_id;
    fake.docs.get(oldId)!.state = "final_valid";
    const tracked = await t.as.post(`/api/invoices/${inv.id}/einvoice/refresh-status`, {});
    expect(tracked.status, tracked.text).toBe(200);
    expect((await statusOf(t, inv.id)).transmission).toMatchObject({
      providerDocumentId: oldId,
      recipientAcknowledgement: "accepted",
    });
  });

  it("filters switched providers before the batch and rotates unconfigured candidates fairly", async () => {
    const insertWaiting = (provider: string, count: number) =>
      h.sql(
        `WITH waiting AS (
          INSERT INTO companies (name, einvoice_partner, trn_vat_number)
          SELECT 'Waiting ' || n, $1, $2 FROM generate_series(1, $3::int) n RETURNING id
        ) INSERT INTO einvoice_legal_entities (company_id, provider, environment, tin, status, created_at)
          SELECT id, 'complyance', 'sandbox', $4, 'reserved', now() - interval '1 day' FROM waiting`,
        [provider, TRN, count, TIN]
      );
    await insertWaiting("acube", 55);
    await insertWaiting("complyance", 50);
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "complyance" },
    });
    useComplyance(t);
    const started = await connect(t);
    expect(started.body.legalEntity.status).toBe("reserved");
    fake.authorised = true;
    fake.ready = true;
    const first = await syncPending();
    expect(first).toEqual({ checked: 50, activated: 0 });
    const second = await syncPending();
    expect(second).toEqual({ checked: 1, activated: 1 });
    expect((await syncPending()).checked).toBe(0);
    expect(
      (await t.as.get(`/api/companies/${t.company.id}/einvoicing/complyance`)).body.canSend
    ).toBe(true);
  });

  it("does not send onboarding work after selection changes during provider resolution", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "complyance" },
    });
    useComplyance(t);
    expect((await connect(t)).body.legalEntity.status).toBe("reserved");
    fake.authorised = true;
    const creates = fake.creates;
    const result = await onboarding.syncPendingComplyanceCompanies(
      "sandbox",
      (id) => storage.getCompany(id),
      async (company) => {
        const config = await companyProviderConfiguration(company.id, company.einvoicePartner);
        await h.sql(`UPDATE companies SET einvoice_partner = 'acube' WHERE id = $1`, [company.id]);
        return config ? new Provider(config.env) : null;
      }
    );
    expect(result).toEqual({ checked: 1, activated: 0 });
    expect(fake.creates).toBe(creates);
  });

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
  it("keeps the persisted status and history when a poll contradicts the frozen submission", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    const submission = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(submission.status).toBe(202);
    await runEInvoiceRetries();
    const sent = docOf(t, inv.number)!;
    const original = await statusOf(t, inv.id);
    expect(original.submissionState).toBe("sent");
    sent.state = "final_valid";
    sent.isTerminal = true;

    for (const response of [
      { documentId: "OTHER" },
      { documentNumber: "OTHER" },
      { environment: "production" },
      { country: "ZZ" },
      { seller: { trn: "100999888700003" } },
      { attribution: { companyId: "another-company" } },
      { payload: { header: { documentNumber: "OTHER" } } },
      { sourceName: [] },
    ]) {
      sent.response = response;
      await poll();
      const unchanged = await statusOf(t, inv.id);
      expect(unchanged.submissionState).toBe(original.submissionState);
      expect(unchanged.tracks).toEqual(original.tracks);
      expect(unchanged.events).toEqual(original.events);
    }
    // The documented status can omit ownership fields or use a nullable document number.
    sent.response = { source: undefined, documentNumber: null };
    expect((await poll()).refreshed).toBe(1);
    expect(await statusOf(t, inv.id)).toMatchObject({
      submissionState: "accepted",
      tracks: { reporting: { status: "reported" } },
    });
  });

  it.each([false, true])(
    "recovers the exact archived source and ends polling at valid approval (document hash missing: %s)",
    async (missingDocumentHash) => {
      const t = await readyTenant();
      const inv = await issuedInvoice(t);
      expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      const held = docOf(t, inv.number)!;
      const [original] = await h.sql(
        "SELECT xml, sha256 FROM einvoice_archive WHERE company_id = $1 AND invoice_id = $2 AND kind = 'submitted'",
        [t.company.id, inv.id]
      );
      held.state = "final_valid";
      held.isTerminal = true;
      await h.sql(
        "UPDATE invoices SET einvoice_xml = NULL, einvoice_hash = NULL, einvoice_uuid = NULL WHERE id = $1",
        [inv.id]
      );
      await h.sql(
        "UPDATE einvoice_documents SET validation = jsonb_set(validation, '{submission,environment}', '\"production\"'::jsonb) WHERE invoice_id = $1",
        [inv.id]
      );
      expect((await poll()).refreshed).toBe(0);
      await h.sql(
        "UPDATE einvoice_documents SET validation = jsonb_set(validation, '{submission,environment}', '\"sandbox\"'::jsonb) WHERE invoice_id = $1",
        [inv.id]
      );

      const unrelated = await h.createSecondTenant();
      const { archiveEInvoiceXml } = await import("../../server/services/einvoice/store");
      const foreign = await archiveEInvoiceXml({
        companyId: unrelated.company.id,
        invoiceId: inv.id,
        direction: "outbound",
        kind: "submitted",
        provider: "complyance",
        providerMessageId: held.id,
        documentNumber: inv.number,
        xml: `${original.xml}\n`,
      });
      await h.sql("UPDATE einvoice_documents SET xml_hash = $2 WHERE invoice_id = $1", [
        inv.id,
        foreign.sha256,
      ]);
      fake.nextSalesReads = ["unavailable"];
      expect((await poll()).refreshed).toBe(0);
      expect(fake.nextSalesReads).toEqual(["unavailable"]);
      fake.nextSalesReads = [];
      await h.sql("UPDATE einvoice_documents SET xml_hash = $2 WHERE invoice_id = $1", [
        inv.id,
        missingDocumentHash ? null : original.sha256,
      ]);

      expect((await poll()).refreshed).toBe(1);
      expect(await statusOf(t, inv.id)).toMatchObject({
        status: "cleared",
        document: { xmlHash: original.sha256 },
        tracks: { reporting: { status: "reported" } },
      });
      const [cleared] = await h.sql(
        "SELECT xml, sha256 FROM einvoice_archive WHERE company_id = $1 AND invoice_id = $2 AND kind = 'cleared'",
        [t.company.id, inv.id]
      );
      expect(cleared).toEqual(original);
      expect((await poll()).refreshed).toBe(0);
      expect(fake.posts).toBe(1);
    }
  );

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
    const rejectedHash = s.document.xmlHash;
    await h.sql(
      "UPDATE invoice_lines SET description = 'Corrected line submitted to provider' WHERE invoice_id = $1",
      [inv.id]
    );
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
    const accepted = docOf(t, inv.number)!;
    accepted.state = "final_valid";
    accepted.isTerminal = true;
    const correctionHash = s.document.xmlHash;
    await h.sql(
      "UPDATE invoices SET einvoice_xml = NULL, einvoice_hash = NULL, einvoice_uuid = NULL WHERE id = $1",
      [inv.id]
    );
    await h.sql("UPDATE einvoice_documents SET xml_hash = NULL WHERE invoice_id = $1", [inv.id]);
    fake.nextSalesReads = ["unavailable"];
    expect((await poll()).refreshed).toBe(0);
    expect(fake.nextSalesReads).toEqual(["unavailable"]);
    fake.nextSalesReads = [];
    await h.sql("UPDATE einvoice_documents SET xml_hash = $2 WHERE invoice_id = $1", [
      inv.id,
      correctionHash,
    ]);
    expect((await poll()).refreshed).toBe(1);
    const final = await statusOf(t, inv.id);
    expect(final.document.xmlHash).not.toBe(rejectedHash);
    const sqlRows = await h.sql(
      "SELECT kind, sha256 FROM einvoice_archive WHERE invoice_id = $1 ORDER BY kind, created_at",
      [inv.id]
    );
    expect(sqlRows).toEqual([
      { kind: "cleared", sha256: final.document.xmlHash },
      { kind: "submitted", sha256: rejectedHash },
      { kind: "submitted", sha256: final.document.xmlHash },
    ]);
  });

  it.each([
    { outcome: "200", originalRequiresReport: false, correctedRequiresReport: true },
    { outcome: "network", originalRequiresReport: true, correctedRequiresReport: false },
    {
      outcome: "configuration-unavailable",
      originalRequiresReport: false,
      correctedRequiresReport: true,
    },
  ] as const)(
    "freezes the obligation for the tracked XML revision after correction ($outcome)",
    async ({ outcome, originalRequiresReport, correctedRequiresReport }) => {
      const t = await readyTenant();
      await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
      const inv = await issuedInvoice(t);
      const [buyer] = await h.sql(
        "UPDATE invoices SET customer_trn = NULL, date = '2026-03-01' WHERE id = $1 RETURNING contact_id",
        [inv.id]
      );
      const setBuyerAndScope = async (required: boolean) => {
        await h.sql("UPDATE customer_contacts SET trn_number = $2 WHERE id = $1", [
          buyer.contact_id,
          required ? "100765432100003" : null,
        ]);
        // A valid buyer endpoint establishes B2B identity even without a VAT number.
        await h.sql("UPDATE companies SET einvoice_scope = $2 WHERE id = $1", [
          t.company.id,
          required ? "b2b" : "none",
        ]);
      };
      await setBuyerAndScope(originalRequiresReport);
      const endpoint = await t.as.put(
        `/api/companies/${t.company.id}/einvoicing/buyer-endpoints/${buyer.contact_id}`,
        { scheme: "0235", participantId: "1007654321" }
      );
      expect(endpoint.status, endpoint.text).toBe(200);
      const prefix = `/api/invoices/${inv.id}/einvoice`;
      fake.nextSubmit = ["422"];
      const submitted = await t.as.post(`${prefix}/submit`, {});
      expect(submitted.status, submitted.text).toBe(202);
      await runEInvoiceRetries();
      const rejected = await statusOf(t, inv.id);
      const expectedReporting = (required: boolean) => ({
        required,
        obligationKnown: true,
        reportBy: required ? "2026-03-15" : null,
      });
      expect(rejected.tracks.reporting).toMatchObject(expectedReporting(originalRequiresReport));

      await setBuyerAndScope(correctedRequiresReport);
      const correction = await t.as.post(`${prefix}/resubmit`, {});
      expect(correction.status, correction.text).toBe(202);
      expect(correction.body.tracks.reporting).toMatchObject(
        expectedReporting(correctedRequiresReport)
      );
      const correctedHash = correction.body.document.xmlHash;
      expect(correctedHash).not.toBe(rejected.document.xmlHash);

      const configured = outcome !== "configuration-unavailable";
      if (configured) {
        fake.nextSubmit = [outcome];
        await runEInvoiceRetries();
      } else {
        const credential = credentialVariable!;
        const savedCredential = process.env[credential]!;
        delete process.env[credential];
        try {
          await runEInvoiceRetries();
        } finally {
          process.env[credential] = savedCredential;
        }
      }
      const current = await statusOf(t, inv.id);
      expect(fake.posts).toBe(configured ? 2 : 1);
      const originalIsTracked = outcome !== "200";
      expect(current.document.xmlHash).toBe(
        originalIsTracked ? rejected.document.xmlHash : correctedHash
      );
      expect(current.tracks.reporting).toMatchObject(
        expectedReporting(originalIsTracked ? originalRequiresReport : correctedRequiresReport)
      );
    }
  );

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
    const byteIdentical = docOf(t, inv.number)!;
    byteIdentical.state = "final_valid";
    byteIdentical.isTerminal = true;
    expect((await poll()).refreshed).toBe(1);
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "cleared",
      document: { xmlHash: originalHash },
    });
  });

  it("restores the cleared correction instead of releasing the rejected XML from stale mirrors", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    const prefix = `/api/invoices/${inv.id}`;
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    fake.nextSubmit = ["422"];
    expect((await t.as.post(`${prefix}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const [rejected] = await h.sql(
      "SELECT einvoice_xml, einvoice_hash, einvoice_uuid FROM invoices WHERE id = $1",
      [inv.id]
    );

    await h.sql(
      "UPDATE invoice_lines SET description = 'Confirmed revised XML' WHERE invoice_id = $1",
      [inv.id]
    );
    expect((await t.as.post(`${prefix}/einvoice/resubmit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = docOf(t, inv.number)!;
    held.state = "final_valid";
    held.isTerminal = true;

    const [corrected] = await h.sql(
      "SELECT einvoice_xml, einvoice_hash, einvoice_uuid FROM invoices WHERE id = $1",
      [inv.id]
    );
    expect(corrected.einvoice_hash).not.toBe(rejected.einvoice_hash);
    const staleMirrors = async () => {
      await h.sql(
        "UPDATE invoices SET einvoice_xml = $2, einvoice_hash = $3, einvoice_uuid = $4 WHERE id = $1",
        [inv.id, rejected.einvoice_xml, rejected.einvoice_hash, rejected.einvoice_uuid]
      );
      await h.sql("UPDATE einvoice_documents SET xml_hash = $2, uuid = $3 WHERE invoice_id = $1", [
        inv.id,
        rejected.einvoice_hash,
        rejected.einvoice_uuid,
      ]);
    };
    await staleMirrors();
    await h.sql("UPDATE einvoice_documents SET report_by = '2026-03-15' WHERE invoice_id = $1", [
      inv.id,
    ]);
    const refused = await t.as.post(`${prefix}/einvoice/refresh-status`, {});
    expect(refused.status, refused.text).toBe(409);
    expect(
      await h.sql(
        "SELECT sha256 FROM einvoice_archive WHERE invoice_id = $1 AND kind = 'cleared'",
        [inv.id]
      )
    ).toEqual([]);

    const { archiveEInvoiceXml } = await import("../../server/services/einvoice/store");
    const clearance = {
      companyId: t.company.id,
      invoiceId: inv.id,
      direction: "outbound" as const,
      kind: "cleared" as const,
      documentNumber: inv.number,
      documentType: "380",
      provider: "complyance",
      providerMessageId: held.id,
    };
    await archiveEInvoiceXml({
      ...clearance,
      uuid: corrected.einvoice_uuid,
      xml: corrected.einvoice_xml,
    });
    expect((await t.as.get(`${prefix}/einvoice-xml`)).text).toBe(corrected.einvoice_xml);
    const restored = await t.as.post(`${prefix}/einvoice/refresh-status`, {});
    expect(restored.status, restored.text).toBe(200);
    expect(await statusOf(t, inv.id)).toMatchObject({
      document: { xmlHash: corrected.einvoice_hash },
      tracks: {
        reporting: { status: "reported", obligationKnown: false, reportBy: null },
      },
    });
    expect(
      await h.sql(
        "SELECT sha256 FROM einvoice_archive WHERE invoice_id = $1 AND kind = 'cleared'",
        [inv.id]
      )
    ).toEqual([{ sha256: corrected.einvoice_hash }]);

    await archiveEInvoiceXml({
      ...clearance,
      uuid: rejected.einvoice_uuid,
      xml: rejected.einvoice_xml,
    });
    expect((await t.as.get(`${prefix}/einvoice-xml`)).status).toBe(409);
    expect((await t.as.post(`${prefix}/einvoice/refresh-status`, {})).status).toBe(409);
    expect((await statusOf(t, inv.id)).document.xmlHash).toBe(corrected.einvoice_hash);
  });

  it("does not transfer an older revision's filing evidence during archive repair", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const invoice = await issuedInvoice(t);
    const path = `/api/invoices/${invoice.id}`;
    fake.nextSubmit = ["422"];
    expect((await t.as.post(`${path}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const [original] = await h.sql(
      "SELECT einvoice_xml, einvoice_hash, einvoice_uuid FROM invoices WHERE id = $1",
      [invoice.id]
    );
    await h.sql("UPDATE invoice_lines SET description = 'Revised supply' WHERE invoice_id = $1", [
      invoice.id,
    ]);
    expect((await t.as.post(`${path}/einvoice/resubmit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = docOf(t, invoice.number)!;
    held.state = "final_valid";
    held.isTerminal = true;
    held.ftaApproval = "APPROVED";
    expect((await poll()).refreshed).toBe(1);
    const [corrected] = await h.sql("SELECT einvoice_hash FROM invoices WHERE id = $1", [
      invoice.id,
    ]);
    await h.sql(
      "UPDATE invoices SET einvoice_xml = $2, einvoice_hash = $3, einvoice_uuid = $4 WHERE id = $1",
      [invoice.id, original.einvoice_xml, original.einvoice_hash, original.einvoice_uuid]
    );
    await h.sql(
      `UPDATE einvoice_documents SET xml_hash = $2, uuid = $3, report_by = '2026-03-15',
        reporting_status = 'report_failed', reported_at = '2026-03-15',
        validation = jsonb_set(validation, '{submission,reportingEvidence}', '{"report_failed":"2026-03-15T00:00:00.000Z"}')
      WHERE invoice_id = $1`,
      [invoice.id, original.einvoice_hash, original.einvoice_uuid]
    );

    const proof = await t.as.post(`${path}/einvoice/confirm-environment`, {
      environment: "sandbox",
    });
    expect(proof.status, proof.text).toBe(200);
    const [repaired] = await h.sql(
      `SELECT xml_hash, report_by, reported_at, validation->'submission'->'reportingEvidence' AS evidence
       FROM einvoice_documents WHERE invoice_id = $1`,
      [invoice.id]
    );
    expect(repaired).toMatchObject({
      xml_hash: corrected.einvoice_hash,
      report_by: null,
      reported_at: null,
    });
    expect(repaired.evidence).toBeNull();
    expect(await statusOf(t, invoice.id)).toMatchObject({
      tracks: { reporting: { status: "pending", obligationKnown: false, reportBy: null } },
    });
  });

  it("uses one submitted revision decision for download, status, verification and polling", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const invoice = await issuedInvoice(t);
    const path = `/api/invoices/${invoice.id}`;
    fake.nextSubmit = ["422"];
    expect((await t.as.post(`${path}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const [original] = await h.sql(
      "SELECT einvoice_xml, einvoice_hash, einvoice_uuid FROM invoices WHERE id = $1",
      [invoice.id]
    );
    await h.sql(
      "UPDATE invoice_lines SET description = 'New submitted revision' WHERE invoice_id = $1",
      [invoice.id]
    );
    expect((await t.as.post(`${path}/einvoice/resubmit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    await h.sql(
      "UPDATE invoices SET einvoice_xml = $2, einvoice_hash = $3, einvoice_uuid = $4 WHERE id = $1",
      [invoice.id, original.einvoice_xml, original.einvoice_hash, original.einvoice_uuid]
    );
    await h.sql("UPDATE einvoice_documents SET xml_hash = $2, uuid = $3 WHERE invoice_id = $1", [
      invoice.id,
      original.einvoice_hash,
      original.einvoice_uuid,
    ]);

    const download = await t.as.get(`${path}/einvoice-xml`);
    expect(download.status).toBe(409);
    expect(download.text).not.toContain(original.einvoice_xml);
    const proof = await t.as.post(`${path}/einvoice/confirm-environment`, {
      environment: "sandbox",
    });
    expect(proof.status, proof.text).toBe(409);
    expect(await statusOf(t, invoice.id)).toMatchObject({
      submissionState: "needs_reconciliation",
      transmission: { correctionRevisionUnverified: true, canRefresh: false },
    });
    const held = docOf(t, invoice.number)!;
    held.state = "final_valid";
    held.isTerminal = true;
    held.ftaApproval = "APPROVED";
    expect((await poll()).refreshed).toBe(0);
    expect(
      await h.sql("SELECT id FROM einvoice_archive WHERE invoice_id = $1 AND kind = 'cleared'", [
        invoice.id,
      ])
    ).toEqual([]);
  });

  it("keeps the original rejection when correction proof fails before dispatch", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const invoice = await issuedInvoice(t);
    const path = `/api/invoices/${invoice.id}`;
    fake.nextSubmit = ["422"];
    expect((await t.as.post(`${path}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const original = await statusOf(t, invoice.id);
    expect(original).toMatchObject({ status: "rejected", rejection: { resubmittable: true } });
    await h.sql(
      "UPDATE invoice_lines SET description = 'Unsent revised supply' WHERE invoice_id = $1",
      [invoice.id]
    );
    expect((await t.as.post(`${path}/einvoice/resubmit`, {})).status).toBe(202);
    fake.nextSalesReads = ["unavailable"];
    expect((await runEInvoiceRetries()).submitted).toBe(0);
    expect(fake.posts).toBe(1);
    expect(await statusOf(t, invoice.id)).toMatchObject({
      status: "rejected",
      submissionState: "rejected",
      transmission: { correctionRevisionUnverified: false },
      document: { xmlHash: original.document.xmlHash, submittedAt: original.document.submittedAt },
      rejection: { resubmittable: true, reasons: original.rejection.reasons },
    });
    expect(
      await h.sql("SELECT sha256 FROM einvoice_archive WHERE invoice_id = $1", [invoice.id])
    ).toEqual([{ sha256: original.document.xmlHash }]);
  });

  it("never marks the rejected XML cleared after a response-lost correction with different XML", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const inv = await issuedInvoice(t);
    const prefix = `/api/invoices/${inv.id}/einvoice`;
    fake.nextSubmit = ["422"];
    expect((await t.as.post(`${prefix}/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const readRevision = async () =>
      (
        await h.sql(
          `SELECT i.einvoice_hash, i.einvoice_xml, i.einvoice_submitted_at::text AS invoice_handoff,
        d.submitted_at::text AS document_handoff, d.validation->'submission'->'correctionCandidate' AS candidate
       FROM invoices i JOIN einvoice_documents d ON d.invoice_id = i.id WHERE i.id = $1`,
          [inv.id]
        )
      )[0];
    const rejected = await readRevision();
    expect(rejected.invoice_handoff).toBeTruthy();
    expect(rejected.document_handoff).toBeTruthy();

    await h.sql(
      "UPDATE invoice_lines SET description = 'Corrected consultancy' WHERE invoice_id = $1",
      [inv.id]
    );
    expect((await t.as.post(`${prefix}/resubmit`, {})).status).toBe(202);
    const corrected = await readRevision();
    expect(corrected.einvoice_hash).not.toBe(rejected.einvoice_hash);
    expect(corrected).toMatchObject({
      invoice_handoff: rejected.invoice_handoff,
      document_handoff: rejected.document_handoff,
      candidate: { xml: corrected.einvoice_xml, hash: corrected.einvoice_hash },
    });
    fake.nextSubmit = ["network"];
    await runEInvoiceRetries();
    expect(await readRevision()).toMatchObject({
      einvoice_hash: rejected.einvoice_hash,
      einvoice_xml: rejected.einvoice_xml,
      invoice_handoff: rejected.invoice_handoff,
      document_handoff: rejected.document_handoff,
      candidate: { xml: corrected.einvoice_xml, hash: corrected.einvoice_hash },
    });
    const held = docOf(t, inv.number)!;
    held.state = "final_valid";
    held.isTerminal = true;
    await poll();

    const view = await statusOf(t, inv.id);
    expect(view.status).not.toBe("cleared");
    expect(view.submissionState).toBe("needs_reconciliation");
    expect(view.tracks.reporting.status).not.toBe("reported");
    expect(view.transmission).toMatchObject({
      providerDocumentId: held.id,
      correctionRevisionUnverified: true,
      canRefresh: false,
    });
    expect(view.document.validation).not.toHaveProperty("submission");
    expect(
      await h.sql("SELECT id FROM einvoice_archive WHERE invoice_id = $1 AND kind = 'cleared'", [
        inv.id,
      ])
    ).toEqual([]);
    expect((await t.as.post(`${prefix}/resubmit`, {})).status).toBe(409);
    await runEInvoiceRetries();
    expect(fake.posts).toBe(2);

    // A later verified clearance archive can identify the candidate. The status response's
    // resource ID alone, used above, cannot.
    const { archiveEInvoiceXml } = await import("../../server/services/einvoice/store");
    await archiveEInvoiceXml({
      companyId: t.company.id,
      invoiceId: inv.id,
      direction: "outbound",
      kind: "cleared",
      documentNumber: inv.number,
      documentType: "380",
      uuid: corrected.candidate.uuid,
      xml: corrected.einvoice_xml,
      provider: "complyance",
      providerMessageId: held.id,
    });
    expect(await statusOf(t, inv.id)).toMatchObject({
      transmission: { correctionRevisionUnverified: false, canRefresh: true },
    });
    expect((await poll()).refreshed).toBe(1);
    expect(await readRevision()).toMatchObject({
      einvoice_hash: corrected.einvoice_hash,
      einvoice_xml: corrected.einvoice_xml,
      invoice_handoff: rejected.invoice_handoff,
      document_handoff: rejected.document_handoff,
      candidate: null,
    });
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
    expect(s.tracks.delivery).toMatchObject({ status: "queued", confirmationUnavailable: true });
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
      environment: "sandbox",
      creditNoteRequired: false,
    });
    const re = await t.as.post(`/api/invoices/${inv2.id}/einvoice/resubmit`, {});
    expect(re.status).toBe(409);
    expect(re.body.code).toBe("EINVOICE_NEW_DOCUMENT_REQUIRED");
    expect(re.body.message).not.toMatch(/credit note/i);
    // Exercise the projection with a stored production result without using a production provider.
    await h.sql(
      `UPDATE einvoice_documents SET validation = jsonb_set(validation, '{submission,environment}', '"production"')
       WHERE invoice_id = $1`,
      [inv2.id]
    );
    expect((await statusOf(t, inv2.id)).rejection).toMatchObject({
      environment: "production",
      creditNoteRequired: true,
    });
    await h.sql(
      `UPDATE einvoice_documents SET validation = validation #- '{submission,environment}'
       WHERE invoice_id = $1`,
      [inv2.id]
    );
    expect((await statusOf(t, inv2.id)).rejection).toMatchObject({
      environment: null,
      creditNoteRequired: false,
    });
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
  it("acknowledges a signed purchase notice from a retired provider without accepting it", async () => {
    const t = await readyTenant();
    const f = PINT_AE_FIXTURES[0] as PintAeFixture;
    const number = "SUP-RETIRED-COMPLYANCE";
    const { xml } = generateEInvoiceXML(
      { ...f.invoice, number },
      f.lines,
      fixtureCompany,
      { ...f.customer, trn: TRN, endpointId: TIN },
      f.opts
    );
    const id = "01JPURCHASE000000000000143";
    fake.purchases.push({ id, number, xml, companyId: fake.companyId });
    await h.sql("UPDATE companies SET einvoice_partner = 'acube' WHERE id = $1", [t.company.id]);
    const receipt = await webhook(t, "purchase.invoice.stored", {
      documentId: id,
      documentNumber: number,
      documentType: "tax_invoice",
      country: "AE",
      attribution: { companyId: fake.companyId },
    });
    expect(receipt.status, receipt.text).toBe(200);
    expect(receipt.body).toEqual({ received: true, ignored: true });
    await events.runProviderEvents();
    expect(
      await h.sql("SELECT id FROM vendor_bills WHERE company_id = $1", [t.company.id])
    ).toEqual([]);
    expect(
      await h.sql("SELECT id FROM einvoice_provider_events WHERE company_id = $1", [t.company.id])
    ).toEqual([]);
  });

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
  it("records verified FTA approval even when the provider's delivery transition returns 409", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    const path = `/api/invoices/${inv.id}/einvoice`;
    expect((await t.as.post(`${path}/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = docOf(t, inv.number)!;
    held.state = "final_valid";
    held.isTerminal = true;
    held.ftaApproval = "PENDING";
    expect((await t.as.post(`${path}/refresh-status`, {})).status).toBe(200);
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "accepted",
      tracks: { delivery: { status: "delivered" }, reporting: { status: "pending" } },
    });

    held.state = "delivery_failed";
    held.ftaApproval = "APPROVED";
    const receipt = await t.as.post(`${path}/refresh-status`, {});
    expect(receipt.status, receipt.text).toBe(409);
    expect(receipt.body.code).toBe("EINVOICE_INVALID_TRANSITION");
    const status = await statusOf(t, inv.id);
    expect(status).toMatchObject({
      status: "accepted",
      tracks: { delivery: { status: "delivered" }, reporting: { status: "reported" } },
      transmission: { recipientAcknowledgement: "accepted" },
    });
    expect(
      status.events.filter(
        (event: { track: string; to: string }) =>
          event.track === "reporting" && event.to === "reported"
      )
    ).toHaveLength(1);
    expect((await t.as.post(`${path}/refresh-status`, {})).status).toBe(409);
    const after = await statusOf(t, inv.id);
    expect(
      after.events.filter(
        (event: { track: string; to: string }) =>
          event.track === "reporting" && event.to === "reported"
      )
    ).toHaveLength(1);
  });

  it.each(["delivery", "revision", "environment"] as const)(
    "records a raced FTA approval only when tracking still identifies the original %s",
    async (changed) => {
      const t = await readyTenant();
      const inv = await issuedInvoice(t);
      const path = `/api/invoices/${inv.id}/einvoice`;
      expect((await t.as.post(`${path}/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      const held = docOf(t, inv.number)!;
      held.state = "final_valid";
      held.ftaApproval = "APPROVED";
      const getStatus = Provider.prototype.getStatus;
      const spy = vi.spyOn(Provider.prototype, "getStatus").mockImplementationOnce(async function (
        this: InstanceType<typeof Provider>,
        ...args
      ) {
        const result = await getStatus.call(this, ...args);
        if (changed === "revision") {
          await h.sql("UPDATE einvoice_documents SET xml_hash = $2 WHERE invoice_id = $1", [
            inv.id,
            "a".repeat(64),
          ]);
        } else if (changed === "environment") {
          await h.sql(
            `UPDATE einvoice_documents SET validation = jsonb_set(validation,
                 '{submission,environment}', '"production"') WHERE invoice_id = $1`,
            [inv.id]
          );
        } else {
          await h.sql(
            `UPDATE einvoice_documents SET delivery_status = 'rejected',
                 provider_status = 'final_invalid', status = 'rejected' WHERE invoice_id = $1`,
            [inv.id]
          );
          await h.sql("UPDATE invoices SET einvoice_status = 'rejected' WHERE id = $1", [inv.id]);
        }
        return result;
      });
      try {
        const receipt = await t.as.post(`${path}/refresh-status`, {});
        expect(receipt.status, receipt.text).toBe(409);
        expect(receipt.body.code).toBe("EINVOICE_INVALID_TRANSITION");
      } finally {
        spy.mockRestore();
      }
      const status = await statusOf(t, inv.id);
      expect(status.tracks.reporting.status).toBe(changed === "delivery" ? "reported" : "pending");
      if (changed === "delivery") {
        expect(status).toMatchObject({
          status: "rejected",
          tracks: { delivery: { status: "rejected" } },
          document: { providerStatus: "final_invalid" },
        });
      }
    }
  );

  it("selects only eligible Complyance delivery and FTA candidates from PostgreSQL", async () => {
    const t = await readyTenant();
    const ready = [];
    for (const outcome of ["pending", "malformed", "already-confirmed", "needs-correction"]) {
      const inv = await issuedInvoice(t);
      expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      const held = docOf(t, inv.number)!;
      const rejected = outcome === "needs-correction";
      const approved = outcome === "already-confirmed";
      held.state = rejected ? "rejected" : approved ? "final_valid" : "final_invalid";
      held.isTerminal = true;
      held.ftaApproval = "APPROVED";
      if (!rejected && !approved)
        held.errors = [{ code: "BUYER", message: "Rejected", source: "delivery" }];
      const state = approved ? "cleared" : "rejected";
      await h.sql("UPDATE invoices SET einvoice_status = $2 WHERE id = $1", [inv.id, state]);
      await h.sql(
        `UPDATE einvoice_documents SET status = $2, provider_status = $3, delivery_status = $4,
           reporting_status = $5, last_error_code = $6, report_by = '2026-05-19',
           validation = validation || jsonb_build_object('submission', validation->'submission'
             || jsonb_build_object('reportingEvidence', jsonb_build_object('reported', $7::text)))
         WHERE invoice_id = $1`,
        [
          inv.id,
          state,
          held.state,
          approved ? "delivered" : "rejected",
          approved || outcome === "malformed" ? "reported" : "pending",
          rejected ? "COMPLYANCE_VALIDATION" : null,
          approved ? "2026-05-01T09:12:00.000Z" : "2026-19-99T00:00:00.000Z",
        ]
      );
      if (outcome === "pending" || outcome === "malformed") ready.push(inv.id);
    }
    const { pool } = await import("../../server/db");
    const query = vi.spyOn(pool, "query");
    try {
      expect(
        (await events.runProviderPoll("complyance", { companyId: t.company.id })).refreshed
      ).toBe(2);
      const candidates = query.mock.calls.findIndex(([config]) => {
        const text = typeof config === "string" ? config : config?.text;
        return (
          text?.includes('from "einvoice_documents"') &&
          text.includes('order by "einvoice_documents"."updated_at" asc')
        );
      });
      expect(candidates).toBeGreaterThanOrEqual(0);
      const selection = await query.mock.results[candidates].value;
      expect(selection.rows).toHaveLength(ready.length);
      expect(selection.rows.flat()).toEqual(expect.arrayContaining(ready));
    } finally {
      query.mockRestore();
    }
  });

  it.each([
    ["stored obligation", "final_invalid", "rejected", "not_required", true, null],
    ["deadline overrides a flag", "delivery_failed", "delivery_failed", null, false, "2026-05-19"],
    ["missing provider status", null, "rejected", "pending", true, null],
    ["missing delivery track", "final_invalid", null, "pending", true, null],
  ])(
    "polls the independent FTA outcome for historical rows with %s",
    async (_scenario, providerStatus, deliveryStatus, reportingStatus, required, reportBy) => {
      const t = await readyTenant();
      const inv = await issuedInvoice(t);
      expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      const held = docOf(t, inv.number)!;
      held.state = providerStatus === "delivery_failed" ? providerStatus : "final_invalid";
      held.isTerminal = true;
      held.errors = [{ code: "C3-MLS-RE", message: "Buyer outcome failed", source: "delivery" }];
      held.ftaApproval = "APPROVED";
      const status = held.state === "delivery_failed" ? "failed" : "rejected";
      await h.sql(`UPDATE invoices SET einvoice_status = $2 WHERE id = $1`, [inv.id, status]);
      await h.sql(
        `UPDATE einvoice_documents SET status = $2, provider_status = $3, delivery_status = $4,
           reporting_status = $5, report_by = $6,
           validation = jsonb_set(validation, '{submission,reportingRequired}', to_jsonb($7::boolean))
         WHERE invoice_id = $1`,
        [inv.id, status, providerStatus, deliveryStatus, reportingStatus, reportBy, required]
      );
      expect((await statusOf(t, inv.id)).tracks.reporting).toMatchObject({
        status: "pending",
        required: true,
      });

      expect(
        (await events.runProviderPoll("complyance", { companyId: t.company.id })).refreshed
      ).toBe(1);
      expect((await statusOf(t, inv.id)).tracks.reporting).toMatchObject({
        status: "reported",
        required: true,
        reportBy,
      });
      expect(
        (await events.runProviderPoll("complyance", { companyId: t.company.id })).refreshed
      ).toBe(0);
      expect(fake.posts).toBe(1);
    }
  );

  it("persists the obligation and due date when queued at 00:30 in Dubai", async () => {
    const t = await readyTenant({ ...SELLER_COLUMNS, einvoice_go_live_date: "2027-01-01" });
    const inv = await issuedInvoice(t);
    await h.sql("UPDATE invoices SET date = '2027-01-01' WHERE id = $1", [inv.id]);
    const { enqueueEInvoiceSubmission } = await import("../../server/services/einvoice/workflow");
    const company = (await storage.getCompany(t.company.id))!;
    const invoice = (await storage.getInvoice(inv.id, t.company.id))!;
    const configuration = (await companyProviderConfiguration(company.id, "complyance"))!;
    const result = await enqueueEInvoiceSubmission({
      invoice,
      company,
      actorId: t.user.id,
      provider: new Provider(configuration.env),
      now: new Date("2026-12-31T20:30:00.000Z"),
    });
    expect(result).toMatchObject({
      ok: true,
      documentRow: { reportBy: "2027-01-15", reportingStatus: "pending" },
    });
    expect(fake.posts).toBe(0);
  });
  it.each([
    "final_invalid",
    "delivery_failed",
    "refused-validation",
    "voluntary-final_valid",
  ] as const)(
    "polls an independently pending FTA outcome for %s only after handoff",
    async (scenario) => {
      const voluntary = scenario === "voluntary-final_valid";
      const t = await readyTenant(
        voluntary ? { ...SELLER_COLUMNS, einvoice_scope: "none" } : SELLER_COLUMNS
      );
      const inv = await issuedInvoice(t);
      if (scenario === "refused-validation") fake.nextSubmit = ["422"];
      expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      const held = docOf(t, inv.number)!;
      if (scenario !== "refused-validation") {
        held.state = voluntary ? "final_valid" : scenario;
        held.isTerminal = true;
        if (!voluntary)
          held.errors = [{ code: "C3-MLS-RE", message: "Buyer rejected", source: "delivery" }];
        held.ftaApproval = null;
        expect((await poll()).refreshed).toBe(1);
        expect((await statusOf(t, inv.id)).tracks.reporting.status).toBe(
          voluntary ? "not_required" : "pending"
        );
      }
      held.ftaApproval = "APPROVED";
      if (scenario === "refused-validation") {
        expect((await poll()).refreshed).toBe(0);
      } else {
        expect((await poll()).refreshed).toBe(1);
        const view = await statusOf(t, inv.id);
        expect(view.tracks.reporting.status).toBe("reported");
        if (!voluntary)
          expect(view.tracks.delivery.status).toBe(
            scenario === "final_invalid" ? "rejected" : "delivery_failed"
          );
        expect((await poll()).refreshed).toBe(0);
      }
      expect(fake.posts).toBe(1);
    }
  );
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
          delivery: {
            status: buyerRejected ? "rejected" : "queued",
            confirmationUnavailable: !buyerRejected,
          },
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

  it("keeps polling a legacy document with unknown filing obligation without inventing its report-by date", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = docOf(t, inv.number)!;
    held.state = "final_valid";
    held.isTerminal = true;
    held.ftaApproval = "PENDING";
    await h.sql(
      "UPDATE invoices SET date = '2026-02-03', einvoice_status = 'accepted' WHERE id = $1",
      [inv.id]
    );
    await h.sql(
      `UPDATE einvoice_documents SET status = 'accepted', delivery_status = 'delivered', provider_status = 'final_valid',
        reporting_status = NULL, report_by = NULL, validation = validation #- '{submission,reportingRequired}' WHERE invoice_id = $1`,
      [inv.id]
    );
    expect((await poll()).refreshed).toBe(1);
    expect((await statusOf(t, inv.id)).tracks.reporting).toMatchObject({
      required: false,
      obligationKnown: false,
      status: "pending",
      reportBy: null,
      overdue: false,
    });
    const [stored] = await h.sql(
      "SELECT report_by, validation->'submission'->>'reportingRequired' AS required FROM einvoice_documents WHERE invoice_id = $1",
      [inv.id]
    );
    expect(stored).toMatchObject({ report_by: null, required: null });

    held.ftaApproval = "APPROVED";
    expect((await poll()).refreshed).toBe(1);
    expect((await statusOf(t, inv.id)).tracks.reporting).toMatchObject({
      required: false,
      obligationKnown: false,
      status: "reported",
      reportBy: null,
      overdue: false,
    });
    expect(fake.posts).toBe(1);
  });
});

describe("Legacy Complyance environment verification", () => {
  it("saves tracking without granting correction until the original source and version are proven", async () => {
    const t = await readyTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const inv = await issuedInvoice(t);
    const path = `/api/invoices/${inv.id}/einvoice`;
    fake.nextSubmit = ["422"];
    expect((await t.as.post(`${path}/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = docOf(t, inv.number)!;
    held.errors = [{ code: "IBR-132-AE", source: "validation", message: "Invalid buyer VAT" }];
    const oldAfterVerification = {
      environmentVerifiedAt: new Date().toISOString(),
      correctableRejection: true,
    };
    await h.sql(
      `UPDATE einvoice_documents
       SET validation = jsonb_set(validation, '{submission}', ((validation->'submission') - 'sourceVersion') || $2::jsonb)
       WHERE invoice_id = $1`,
      [inv.id, JSON.stringify(oldAfterVerification)]
    );
    held.response = {
      source: fake.sourceName,
      attribution: { companyId: fake.companyId },
      validationResults: { status: "Invalid" },
    };
    const tracking = await t.as.post(`${path}/confirm-environment`, { environment: "sandbox" });
    expect(tracking.status, tracking.text).toBe(200);
    expect((await t.as.post(`${path}/resubmit`, {})).status).toBe(409);
    expect(fake.posts).toBe(1);
    expect(await statusOf(t, inv.id)).toMatchObject({
      rejection: { resubmittable: false },
      transmission: { providerDocumentId: held.id },
    });

    held.response.source = `${fake.sourceName}:v1`;
    const verified = await t.as.post(`${path}/confirm-environment`, { environment: "sandbox" });
    expect(verified.status, verified.text).toBe(200);
    expect(await statusOf(t, inv.id)).toMatchObject({
      rejection: { resubmittable: true },
      transmission: { providerDocumentId: held.id, environmentVerification: null },
    });
    const [proof] = await h.sql(
      "SELECT validation->'submission'->>'sourceVersion' AS version FROM einvoice_documents WHERE invoice_id = $1",
      [inv.id]
    );
    expect(proof.version).toBe("v1");
    expect(fake.posts).toBe(1);
  });

  it.each(["unverified reference", "partially verified", "missing reference"])(
    "restores a doc-derived terminal Needs Correction without dispatching it (%s)",
    async (legacy) => {
      const t = await readyTenant();
      await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
      const inv = await issuedInvoice(t);
      const path = `/api/invoices/${inv.id}/einvoice`;
      fake.nextSubmit = ["422"];
      expect((await t.as.post(`${path}/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      const held = docOf(t, inv.number)!;
      // The published Needs Correction example uses REJECTED for FTA approval while
      // explicitly attributing the failure to validation, before any delivery.
      held.ftaApproval = "REJECTED";
      held.errors = [{ code: "IBR-132-AE", source: "validation", message: "Invalid buyer TRN" }];
      held.response = { validationResults: { status: "Invalid", validationSteps: [] } };
      const validation =
        legacy === "partially verified"
          ? {
              submission: {
                environment: "sandbox",
                environmentVerifiedAt: new Date().toISOString(),
              },
            }
          : {};
      await h.sql(
        `UPDATE einvoice_documents SET validation = $2, provider_message_id = $3 WHERE invoice_id = $1`,
        [inv.id, JSON.stringify(validation), legacy === "missing reference" ? null : held.id]
      );
      if (legacy === "missing reference") {
        await h.sql("UPDATE invoices SET einvoice_provider_message_id = NULL WHERE id = $1", [
          inv.id,
        ]);
      }
      expect((await statusOf(t, inv.id)).transmission.environmentVerification).toMatchObject({
        provider: "complyance",
        environments: ["sandbox"],
        reference: legacy === "missing reference" ? "manual" : "stored",
      });
      const verifyBody = {
        environment: "sandbox",
        ...(legacy === "missing reference" ? { documentId: held.id } : {}),
      };
      held.errors.push({ code: "WRONG_STAGE", source: "government", message: "Already reported" });
      const contradictory = await t.as.post(`${path}/confirm-environment`, verifyBody);
      expect(contradictory.status, contradictory.text).toBe(200);
      expect((await t.as.post(`${path}/resubmit`, {})).status).toBe(409);
      expect(fake.posts).toBe(1);
      held.errors.pop();

      const verified = await t.as.post(`${path}/confirm-environment`, { environment: "sandbox" });
      expect(verified.status, verified.text).toBe(200);
      expect(await statusOf(t, inv.id)).toMatchObject({
        status: "rejected",
        transmission: { providerDocumentId: held.id, environmentVerification: null },
        rejection: { code: "COMPLYANCE_VALIDATION", resubmittable: true },
      });
      expect(fake.posts).toBe(1);
      const correction = await t.as.post(`${path}/resubmit`, {});
      expect(correction.status, correction.text).toBe(202);
      await runEInvoiceRetries();
      expect(fake.posts).toBe(2);
      expect(fake.docs.size).toBe(1);
      expect(docOf(t, inv.number)?.id).toBe(held.id);
    }
  );

  it.each([false, true])(
    "downloads and verifies byte-identical cleared-only XML with missing legacy mirrors (previously verified: %s)",
    async (previouslyVerified) => {
      const t = await readyTenant();
      const inv = await issuedInvoice(t);
      const invoicePath = `/api/invoices/${inv.id}`;
      expect((await t.as.post(`${invoicePath}/generate-einvoice`, {})).status).toBe(200);
      const [source] = await h.sql(
        "SELECT einvoice_xml AS xml, einvoice_uuid AS uuid FROM invoices WHERE id = $1",
        [inv.id]
      );
      const held = {
        id: "01K5EXAMPLE00000000000142",
        number: inv.number,
        source: `${fake.sourceName}:v1`,
        body: {},
        state: "final_valid",
        isTerminal: true,
        errors: [],
      };
      fake.docs.set(held.id, held);
      const { archiveEInvoiceXml } = await import("../../server/services/einvoice/store");
      await archiveEInvoiceXml({
        companyId: t.company.id,
        invoiceId: inv.id,
        direction: "outbound",
        kind: "cleared",
        documentNumber: inv.number,
        documentType: "380",
        uuid: source.uuid,
        xml: source.xml,
        provider: "complyance",
        providerMessageId: held.id,
      });
      if (previouslyVerified) {
        await h.sql(
          `UPDATE einvoice_documents SET status = 'cleared', provider = 'complyance',
          provider_message_id = $2, xml_hash = NULL,
          validation = '{"submission":{"environment":"sandbox"}}' WHERE invoice_id = $1`,
          [inv.id, held.id]
        );
      } else {
        await h.sql("DELETE FROM einvoice_documents WHERE invoice_id = $1", [inv.id]);
      }
      await h.sql(
        `UPDATE invoices SET einvoice_status = 'cleared', einvoice_provider = 'complyance',
        einvoice_provider_message_id = $2, einvoice_xml = NULL, einvoice_hash = NULL, einvoice_uuid = NULL WHERE id = $1`,
        [inv.id, held.id]
      );
      const foreign = await h.createTenant({ name: "Unrelated cleared XML company" });
      expect((await foreign.as.get(`${invoicePath}/einvoice-xml`)).status).toBe(404);
      const download = await t.as.get(`${invoicePath}/einvoice-xml`);
      expect(download.status, download.text).toBe(200);
      expect(download.text).toBe(source.xml);
      expect(download.headers.get("content-type")).toContain("application/xml");
      await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
      const proof = await t.as.post(`${invoicePath}/einvoice/confirm-environment`, {
        environment: "sandbox",
      });
      expect(proof.status, proof.text).toBe(200);
      const [restored] = await h.sql("SELECT einvoice_xml AS xml FROM invoices WHERE id = $1", [
        inv.id,
      ]);
      expect(restored.xml).toBe(source.xml);
      expect(fake.posts).toBe(0);
    }
  );

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
