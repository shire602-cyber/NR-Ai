/**
 * E1: UAE e-invoicing through A-Cube on the real app + Postgres, against an in-memory A-Cube
 * built from the doc-derived fixtures (tests/fixtures/pint-ae/asp/acube/README.md).
 *
 *   - without configuration everything works up to the boundary and says "not sent";
 *   - onboarding: reserve TIN -> signed legal_entity.synchronized LINK -> active; DELINK blocks;
 *   - submit is gated on the legal entity, claimed once (no double submit), two-track statuses
 *     with history; delivered + TDD -> reported; 422 rejection -> fix and resubmit (same UUID);
 *   - webhooks: valid / bad signature / bad token / stale, duplicate deliveries absorbed;
 *   - inbound: document.received -> source XML -> draft bill tagged e-invoice, once;
 *   - an ambiguous transport failure is looked up before re-posting.
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

const PUBLIC_BASE = "https://app.muhasib.example";
const WEBHOOK = "/api/webhooks/einvoice/acube/sandbox";
const today = () => new Date().toISOString().slice(0, 10);

// Opted in to e-invoicing with a go-live date already reached, so FTA reporting applies.
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

// ─── In-memory A-Cube (doc-derived shapes) ──────────────────────────────

interface FakeDoc {
  id: string;
  number: string;
  xml: string;
  status: string;
  tdd: boolean;
}
const fake = {
  posts: 0,
  submitDelayMs: 0,
  nextSubmit: [] as Array<"201" | "422" | "network">,
  docs: new Map<string, FakeDoc>(),
  legalEntityStatus: "Active",
  leId: crypto.randomUUID() as string,
  incoming: [] as Array<{ id: string; number: string; xml: string }>,
  reset() {
    this.posts = 0;
    this.submitDelayMs = 0;
    this.nextSubmit = [];
    this.docs.clear();
    this.legalEntityStatus = "Active";
    this.leId = crypto.randomUUID();
    this.incoming = [];
  },
};

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function acube(url: URL, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const p = url.pathname;
  if (url.host === "common.api.acubeapi.com" && p === "/login") {
    return json(200, { token: "e30.eyJleHAiOjQxMDI0NDQ4MDB9.c2ln" });
  }
  if (method === "POST" && p === "/legal-entities") {
    return json(201, {
      legalEntityId: fake.leId,
      tin: TIN,
      status: "RESERVED",
      enabledCapabilities: [],
    });
  }
  if (method === "GET" && p === `/legal-entities/${fake.leId}`) {
    const active = fake.legalEntityStatus === "Active";
    return json(200, {
      legalEntityId: fake.leId,
      tin: TIN,
      status: fake.legalEntityStatus,
      nameEn: "Pearl Trading L.L.C.",
      nameAr: "بيرل للتجارة ش.ذ.م.م",
      vatTrn: TRN,
      isEnabled: active,
      enabledCapabilities: active
        ? [{ key: "billing.invoice" }, { key: "billing.credit_note" }]
        : [],
      smpSyncAt: active ? "2026-11-16T08:04:52+00:00" : null,
      registrySyncAt: active ? "2026-11-16T08:04:55+00:00" : null,
    });
  }
  if (method === "POST" && (p === "/invoices/outgoing" || p === "/credit-notes/outgoing")) {
    fake.posts++;
    const xml = String(init.body);
    const number = /<cbc:ID>([^<]+)<\/cbc:ID>/.exec(xml)?.[1] ?? "?";
    const mode = fake.nextSubmit.shift() ?? "201";
    if (fake.submitDelayMs) await new Promise((r) => setTimeout(r, fake.submitDelayMs));
    if (mode === "422") {
      return json(422, {
        status: 422,
        detail: "Buyer TRN must be 15 digits",
        violations: [
          {
            propertyPath: "AccountingCustomerParty/Party/PartyTaxScheme/CompanyID",
            message: "Buyer TRN must be 15 digits",
            code: "ibr-138-ae",
          },
        ],
      });
    }
    const id = crypto.randomUUID();
    fake.docs.set(id, { id, number, xml, status: "valid", tdd: false });
    if (mode === "network") throw new TypeError("fetch failed: socket hang up");
    return json(201, {
      invoiceId: id,
      status: "valid",
      direction: "outgoing",
      invoiceNumber: number,
    });
  }
  const list = /^\/(invoices|credit-notes)$/.exec(p);
  if (method === "GET" && list) {
    if (url.searchParams.get("direction") === "incoming") {
      return json(
        200,
        list[1] === "invoices"
          ? fake.incoming.map((d) => ({
              invoiceId: d.id,
              direction: "incoming",
              status: "received",
              invoiceNumber: d.number,
              legalEntityUuid: fake.leId,
              ownerFiscalId: TIN,
            }))
          : []
      );
    }
    return json(
      200,
      [...fake.docs.values()].map((d) => ({
        invoiceId: d.id,
        direction: "outgoing",
        status: d.status,
        invoiceNumber: d.number,
      }))
    );
  }
  const m = /^\/invoices\/([^/]+)(\/tdd|\/source)?$/.exec(p);
  if (method === "GET" && m) {
    const incoming = fake.incoming.find((d) => d.id === m[1]);
    if (incoming) {
      if (m[2] === "/source") return new Response(incoming.xml, { status: 200 });
      return json(200, {
        invoiceId: incoming.id,
        direction: "incoming",
        status: "received",
        legalEntityUuid: fake.leId,
        ownerFiscalId: TIN,
      });
    }
    const d = fake.docs.get(m[1]);
    if (!d) return json(404, { detail: "Not found" });
    if (m[2] === "/source") return new Response(d.xml, { status: 200 });
    if (m[2] === "/tdd") {
      return d.tdd
        ? new Response("<TaxDataDocument/>", { status: 200 })
        : new Response(null, { status: 204 });
    }
    return json(200, { invoiceId: d.id, status: d.status, invoiceNumber: d.number });
  }
  return json(500, { detail: `fake A-Cube: no route ${method} ${p}` });
}

const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal("fetch", (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.host.endsWith("acubeapi.com")) return acube(url, init);
    return realFetch(input as string, init);
  }) as typeof fetch);
});

// ─── Env ────────────────────────────────────────────────────────────────

const keys = crypto.generateKeyPairSync("ed25519");
const ENV_KEYS = [
  "EINVOICE_PROVIDER",
  "ACUBE_ENV",
  "ACUBE_SIGNATURE_PUBLIC_KEY",
  "ACUBE_WEBHOOK_BASE_URL",
  "ACUBE_WEBHOOK_INLINE",
  "EINVOICE_ASP_BASE_URL",
  "EINVOICE_ASP_API_KEY",
];
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

let credentialVariable: string | null = null;

async function useAcube(t: Tenant, webhookToken?: string) {
  const context = { companyId: t.company.id, provider: "acube", environment: "sandbox" } as const;
  credentialVariable = companyCredentialVariable(context);
  process.env[credentialVariable] = sealCompanyCredentials(context, {
    email: "sandbox@example.test",
    password: crypto.randomUUID(),
    webhookToken,
  });
  process.env.ACUBE_SIGNATURE_PUBLIC_KEY = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  process.env.ACUBE_WEBHOOK_BASE_URL = PUBLIC_BASE;
  process.env.ACUBE_WEBHOOK_INLINE = "false";
  const { resetAcubeTokenCache } = await import("../../server/services/einvoice/providers/acube");
  resetAcubeTokenCache();
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

let signAcubeRequest: typeof import("../../server/services/einvoice/acube-signature").signAcubeRequest;
let runProviderEvents: typeof import("../../server/services/einvoice/provider-events").runProviderEvents;
let runEInvoiceRetries: typeof import("../../server/services/einvoice/workflow").runEInvoiceRetries;
let runAcubePoll: typeof import("../../server/services/einvoice/provider-events").runAcubePoll;
let generateEInvoiceXML: typeof import("../../server/services/einvoice.service").generateEInvoiceXML;
beforeAll(async () => {
  ({ signAcubeRequest } = await import("../../server/services/einvoice/acube-signature"));
  ({ runProviderEvents, runAcubePoll } =
    await import("../../server/services/einvoice/provider-events"));
  ({ generateEInvoiceXML } = await import("../../server/services/einvoice.service"));
  ({ runEInvoiceRetries } = await import("../../server/services/einvoice/workflow"));
});

function webhook(
  tenant: Tenant,
  payload: Record<string, unknown>,
  opts: { created?: number; key?: crypto.KeyObject; token?: string; body?: string } = {}
) {
  const body = JSON.stringify(payload);
  const path = `${WEBHOOK}/${tenant.company.id}`;
  const headers = signAcubeRequest({
    privateKey: opts.key ?? keys.privateKey,
    method: "POST",
    targetUri: `${PUBLIC_BASE}${path}`,
    body,
    created: opts.created,
  });
  return h.anon.post(path, undefined, {
    raw: Buffer.from(opts.body ?? body, "utf8"),
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...(opts.token ? { "X-Acube-Token": opts.token } : {}),
    },
  });
}

const linkEvent = (action = "LINK", status = "Active") => ({
  eventId: crypto.randomUUID(),
  eventType: "legal_entity.synchronized",
  legalEntityId: fake.leId,
  tin: TIN,
  name: "Pearl Trading L.L.C.",
  status,
  action,
  timestamp: new Date().toISOString(),
});

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

async function linkedTenant() {
  const t = await h.createTenant({
    companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "acube" },
  });
  await useAcube(t);
  const r = await t.as.post(`/api/companies/${t.company.id}/einvoicing/acube/reserve`, {
    approver: "me",
  });
  expect(r.status, r.text).toBe(200);
  const w = await webhook(t, linkEvent());
  expect(w.status, w.text).toBe(200);
  await runProviderEvents();
  return t;
}

const statusOf = async (t: Tenant, id: string) =>
  (await t.as.get(`/api/invoices/${id}/einvoice/status`)).body;

// ─── Tests ──────────────────────────────────────────────────────────────

describe("F16: no FTA report-by deadline before the mandate applies", () => {
  const OLD_DATE = "2026-01-01";

  async function setScope(
    t: Tenant,
    cols: { scope: string | null; band: string | null; go: string | null }
  ) {
    await h.sql(
      `UPDATE companies SET einvoice_scope = $2, einvoice_turnover_band = $3, einvoice_go_live_date = $4 WHERE id = $1`,
      [t.company.id, cols.scope, cols.band, cols.go]
    );
  }

  async function oldInvoice(t: Tenant) {
    const inv = await issuedInvoice(t);
    // Back-date past the reporting window so a wrongly-applied deadline would read overdue.
    await h.sql(`UPDATE invoices SET date = $2 WHERE id = $1`, [inv.id, `${OLD_DATE}T00:00:00Z`]);
    return inv;
  }

  it("pre-mandate: nothing required, no report-by, never overdue", async () => {
    process.env.EINVOICE_PROVIDER = "http";
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_go_live_date: null },
    });
    await setScope(t, { scope: "b2b", band: "large", go: null }); // go-live 2027-01-01
    const inv = await oldInvoice(t);
    await t.as.post(`/api/invoices/${inv.id}/generate-einvoice`, {});
    const s = await statusOf(t, inv.id);
    expect(s.tracks.reporting).toMatchObject({
      required: false,
      reportBy: null,
      overdue: false,
      status: "not_required",
    });
  });

  it("opted-in company (explicit go-live reached) gets a report-by and overdue flag", async () => {
    process.env.EINVOICE_PROVIDER = "http";
    const t = await h.createTenant({ companyColumns: SELLER_COLUMNS });
    const inv = await oldInvoice(t);
    await t.as.post(`/api/invoices/${inv.id}/generate-einvoice`, {});
    const s = await statusOf(t, inv.id);
    expect(s.tracks.reporting).toMatchObject({ required: true, status: "pending", overdue: true });
    expect(s.tracks.reporting.reportBy).toBe("2026-01-15");
  });

  it("post-go-live band company gets a deadline; a draft never reads overdue", async () => {
    process.env.EINVOICE_PROVIDER = "http";
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_go_live_date: null },
    });
    await setScope(t, { scope: "b2b", band: "large", go: "2026-06-01" });
    const inv = await oldInvoice(t);
    await t.as.post(`/api/invoices/${inv.id}/generate-einvoice`, {});
    const s = await statusOf(t, inv.id);
    expect(s.tracks.reporting).toMatchObject({ required: true, overdue: true });

    await h.sql(`UPDATE invoices SET status = 'draft' WHERE id = $1`, [inv.id]);
    const d = await statusOf(t, inv.id);
    expect(d.tracks.reporting).toMatchObject({ reportBy: null, overdue: false });
  });
});

describe("E1 without a provider: generated and validated, honestly not sent", () => {
  it("keeps 503 for transmission and shows the checklist blocked on 'no provider'", async () => {
    process.env.EINVOICE_PROVIDER = "http"; // no base URL / key = nothing configured
    const t = await h.createTenant({ companyColumns: SELLER_COLUMNS });
    const inv = await issuedInvoice(t);
    const g = await t.as.post(`/api/invoices/${inv.id}/generate-einvoice`, {});
    expect(g.status, g.text).toBe(200);
    const sub = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(sub.status).toBe(503);
    expect(sub.body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");

    const s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("validated");
    expect(s.tracks.reporting).toMatchObject({ status: "pending", required: true });
    expect(s.tracks.reporting.reportBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.transmission).toMatchObject({ connected: false, block: "no_provider" });
    expect(Object.fromEntries(s.checklist.map((c: any) => [c.key, c.state]))).toEqual({
      posted: "done",
      validated: "done",
      sent: "blocked",
      reported: "blocked",
    });
    expect(s.events.map((e: any) => `${e.track}:${e.to}`)).toEqual(
      expect.arrayContaining(["validation:passed", "delivery:validated", "reporting:pending"])
    );

    const card = await t.as.get(`/api/companies/${t.company.id}/einvoicing/acube`);
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({
      configured: false,
      accreditationNumber: "188961",
      tin: TIN,
      legalEntity: null,
      canSend: false,
    });
    const reserve = await t.as.post(`/api/companies/${t.company.id}/einvoicing/acube/reserve`, {
      approver: "me",
    });
    expect(reserve.status).toBe(503);
    const hook = await webhook(t, linkEvent());
    expect(hook.status).toBe(503);
  });
});

describe("E1 legal entity onboarding gates sending", () => {
  it("reserve -> LINK webhook -> active; DELINK -> 409; viewer cannot reserve", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "acube" },
    });
    await useAcube(t);
    const inv = await issuedInvoice(t);

    const blocked = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("EINVOICE_LEGAL_ENTITY_NOT_ACTIVE");

    const noEmail = await t.as.post(`/api/companies/${t.company.id}/einvoicing/acube/reserve`, {
      approver: "someone_else",
    });
    expect(noEmail.status).toBe(400);
    const viewer = await h.createTenant({ role: "viewer" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      viewer.user.id,
    ]);
    const denied = await viewer.as.post(`/api/companies/${t.company.id}/einvoicing/acube/reserve`, {
      approver: "me",
    });
    expect(denied.status).toBe(403);

    const r = await t.as.post(`/api/companies/${t.company.id}/einvoicing/acube/reserve`, {
      approver: "someone_else",
      approverEmail: "owner@pearl.example",
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.legalEntity).toMatchObject({
      status: "reserved",
      tin: TIN,
      legalEntityId: fake.leId,
    });
    expect(r.body.steps.map((s: any) => s.state)).toEqual(["done", "current", "todo"]);

    const w = await webhook(t, linkEvent());
    expect(w.body).toEqual({ received: true, duplicate: false });
    expect(await runProviderEvents()).toMatchObject({ claimed: 1, processed: 1 });
    const card = await t.as.get(`/api/companies/${t.company.id}/einvoicing/acube`);
    expect(card.body.legalEntity).toMatchObject({
      status: "active",
      peppolAddress: `0235:${TIN}`,
      capabilities: ["billing.invoice", "billing.credit_note"],
      lastAction: "LINK",
    });
    expect(card.body.steps.map((s: any) => s.state)).toEqual(["done", "done", "done"]);
    expect(card.body.canSend).toBe(true);

    fake.legalEntityStatus = "Inactive";
    await webhook(t, linkEvent("DELINK", "Inactive"));
    await runProviderEvents();
    const delinked = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(delinked.status).toBe(409);
    expect(delinked.body.code).toBe("EINVOICE_LEGAL_ENTITY_DELINKED");
    expect(fake.posts).toBe(0);
  });

  it("refuses an invoice whose supplier endpoint is not the linked 0235:TIN", async () => {
    const t = await linkedTenant();
    await h.sql(`UPDATE companies SET peppol_scheme = '9922' WHERE id = $1`, [t.company.id]);
    const inv = await issuedInvoice(t);
    const r = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("EINVOICE_SUPPLIER_ENDPOINT_MISMATCH");
    expect(fake.posts).toBe(0);
  });
});

describe("E1 submit, two tracks and history", () => {
  it("submits once (concurrent double submit sends one document), then delivered + reported", async () => {
    const t = await linkedTenant();
    const inv = await issuedInvoice(t);
    fake.submitDelayMs = 150;
    const [a, b] = await Promise.all([
      t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {}),
      t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {}),
    ]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect([a.body.status, b.body.status]).toEqual(["queued", "queued"]);
    expect(fake.posts).toBe(0);
    await Promise.all([runEInvoiceRetries(), runEInvoiceRetries()]);
    expect(fake.posts).toBe(1);
    const again = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(again.status).toBe(409);
    expect(fake.posts).toBe(1);

    let s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("queued");
    expect(s.tracks.reporting.status).toBe("pending");
    expect(s.transmission).toMatchObject({ provider: "acube", connected: true });
    const docId = s.transmission.providerDocumentId as string;
    expect(fake.docs.has(docId)).toBe(true);

    // document.delivered webhook: the status is re-read from A-Cube, not trusted from the body.
    fake.docs.get(docId)!.status = "delivered";
    const payload = {
      documentId: docId,
      documentNumber: inv.number,
      documentType: "invoice",
      status: "delivered",
    };
    expect((await webhook(t, payload)).body.duplicate).toBe(false);
    expect((await webhook(t, payload)).body.duplicate).toBe(true); // A-Cube retry
    await runProviderEvents();
    s = await statusOf(t, inv.id);
    expect(s.status).toBe("accepted");
    expect(s.tracks.delivery.status).toBe("delivered");
    expect(s.tracks.reporting.status).toBe("pending");

    // The TDD appears: the poll fallback moves reporting to reported.
    fake.docs.get(docId)!.tdd = true;
    expect((await runAcubePoll()).refreshed).toBe(1);
    s = await statusOf(t, inv.id);
    expect(s.status).toBe("cleared");
    expect(s.tracks.reporting.status).toBe("reported");
    expect(Object.fromEntries(s.checklist.map((c: any) => [c.key, c.state]))).toEqual({
      posted: "done",
      validated: "done",
      sent: "done",
      reported: "done",
    });
    const history = s.events.map((e: any) => `${e.source}:${e.track}:${e.to}`);
    expect(history).toEqual(
      expect.arrayContaining([
        "user:delivery:queued",
        "webhook:delivery:delivered",
        "poll:reporting:reported",
      ])
    );
    const rows = await h.sql(
      `SELECT status, attempts FROM einvoice_provider_events WHERE provider = 'acube' AND event_type = 'document.delivered'`
    );
    expect(rows).toEqual([{ status: "processed", attempts: 1 }]);
  });

  it("shows a 422 rejection with the named field, then fix and resubmit keeps the UUID", async () => {
    const t = await linkedTenant();
    const inv = await issuedInvoice(t);
    fake.nextSubmit = ["422"];
    const r = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(r.status, r.text).toBe(202);
    await runEInvoiceRetries();
    let s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("rejected");
    expect(s.rejection).toMatchObject({ code: "ACUBE_VALIDATION", resubmittable: true });
    expect(s.rejection.reasons[0]).toMatchObject({
      code: "ibr-138-ae",
      field: "AccountingCustomerParty/Party/PartyTaxScheme/CompanyID",
    });
    expect(s.checklist.find((c: any) => c.key === "sent")).toMatchObject({
      state: "failed",
      code: "ACUBE_VALIDATION",
    });
    const uuid = (await h.sql(`SELECT einvoice_uuid FROM invoices WHERE id = $1`, [inv.id]))[0]
      .einvoice_uuid;

    const re = await t.as.post(`/api/invoices/${inv.id}/einvoice/resubmit`, {});
    expect(re.status, re.text).toBe(202);
    expect(re.body.tracks.delivery.status).toBe("queued");
    expect(re.body.rejection).toBeNull();
    await runEInvoiceRetries();
    expect(fake.posts).toBe(2);
    const sentXml = [...fake.docs.values()][0].xml;
    expect(sentXml).toContain(`<cbc:UUID>${uuid}</cbc:UUID>`);
    const notAgain = await t.as.post(`/api/invoices/${inv.id}/einvoice/resubmit`, {});
    expect(notAgain.status).toBe(409);
    expect(notAgain.body.code).toBe("EINVOICE_NOT_RESUBMITTABLE");
    s = await statusOf(t, inv.id);
    expect(s.events.filter((e: any) => e.track === "delivery").map((e: any) => e.to)).toEqual(
      expect.arrayContaining(["queued", "sending", "rejected"])
    );
  });

  it("a provider-reported delivery error is shown and not auto-retried", async () => {
    const t = await linkedTenant();
    const inv = await issuedInvoice(t);
    await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    await runEInvoiceRetries();
    const docId = (await statusOf(t, inv.id)).transmission.providerDocumentId as string;
    fake.docs.get(docId)!.status = "delivery_error";
    await runAcubePoll();
    const s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("delivery_failed");
    expect(s.rejection).toMatchObject({ code: "ACUBE_DELIVERY_FAILED", retryScheduledAt: null });
    const row = await h.sql(
      `SELECT status, next_retry_at FROM einvoice_documents WHERE invoice_id = $1`,
      [inv.id]
    );
    expect(row[0]).toEqual({ status: "failed", next_retry_at: null });
  });

  it("an ambiguous transport failure is looked up at A-Cube before posting again", async () => {
    const t = await linkedTenant();
    const inv = await issuedInvoice(t);
    fake.nextSubmit = ["network"]; // A-Cube created it, the response was lost
    const first = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(first.body.status).toBe("queued");
    await runEInvoiceRetries();
    expect((await statusOf(t, inv.id)).status).toBe("failed");
    expect(fake.posts).toBe(1);
    const retry = await runEInvoiceRetries(new Date(Date.now() + 2 * 60_000));
    expect(retry).toEqual({ attempted: 1, submitted: 1 });
    expect(fake.posts).toBe(1); // found by invoice number, not posted twice
    const s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("queued");
    expect(fake.docs.has(s.transmission.providerDocumentId)).toBe(true);
  });
});

describe("E1 webhook authentication", () => {
  it("refuses a bad signature, a stale replay and a bad token", async () => {
    const t = await linkedTenant();
    const other = crypto.generateKeyPairSync("ed25519").privateKey;
    const bad = await webhook(t, linkEvent(), { key: other });
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({
      code: "EINVOICE_WEBHOOK_BAD_SIGNATURE",
      reason: "bad_signature",
    });
    const tampered = await webhook(t, linkEvent(), { body: JSON.stringify(linkEvent("DELINK")) });
    expect(tampered.body.reason).toBe("bad_content_digest");
    const stale = await webhook(t, linkEvent(), {
      created: Math.floor(Date.now() / 1000) - 13 * 3600,
    });
    expect(stale.body.reason).toBe("stale");

    const webhookToken = crypto.randomUUID();
    await useAcube(t, webhookToken);
    expect((await webhook(t, linkEvent())).status).toBe(401);
    expect((await webhook(t, linkEvent(), { token: "wrong" })).body.code).toBe(
      "EINVOICE_WEBHOOK_BAD_TOKEN"
    );
    expect((await webhook(t, linkEvent(), { token: webhookToken })).status).toBe(200);
  });
});

describe("E1 inbound: document.received -> draft bill tagged e-invoice", () => {
  it("fetches the source XML once and creates one draft bill, webhook and poll deduplicated", async () => {
    const t = await linkedTenant();
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
    const id = "01a0c453-5398-728c-8b10-84dd471cd797";
    fake.incoming.push({ id, number: "AE-INV-005", xml });
    const payload = {
      documentId: id,
      documentNumber: "AE-INV-005",
      documentType: "invoice",
      status: "received",
    };
    expect((await webhook(t, payload)).status).toBe(200);
    await runProviderEvents();
    expect((await runAcubePoll()).enqueued).toBe(0); // same key as the webhook
    expect((await webhook(t, payload)).body.duplicate).toBe(true);
    await runProviderEvents();

    const bills = await h.sql(
      `SELECT status, origin, bill_number FROM vendor_bills WHERE company_id = $1`,
      [t.company.id]
    );
    expect(bills).toEqual([{ status: "draft", origin: "einvoice", bill_number: "AE-INV-005" }]);
    const inbound = await t.as.get(`/api/companies/${t.company.id}/einvoicing/inbound`);
    expect(inbound.body.items).toHaveLength(1);
    expect(inbound.body.items[0]).toMatchObject({
      status: "bill_created",
      documentNumber: "AE-INV-005",
    });
  });
});
