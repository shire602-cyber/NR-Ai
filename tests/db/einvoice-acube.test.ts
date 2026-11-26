import { recordTestAppointment } from "./einvoice-appointment-fixture";
/**
 * E1: UAE e-invoicing through A-Cube on the real app + Postgres, against an in-memory A-Cube
 * built from the doc-derived fixtures (tests/fixtures/pint-ae/asp/acube/README.md).
 *
 *   - without configuration everything works up to the boundary and says "not sent";
 *   - onboarding: reserve TIN -> signed legal_entity.synchronized LINK -> active; DELINK blocks;
 *   - submit is gated on the legal entity, claimed once (no double submit), two-track statuses
 *     with history; Peppol receipt and MLS acceptance are distinct; 422 rejection allows a fix;
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

type DocumentKind = "invoices" | "credit-notes";

interface FakeDocument {
  id: string;
  kind: DocumentKind;
  number: string;
  xml: string;
}

interface FakeDoc extends FakeDocument {
  status: string;
  tdd: boolean;
}

function documentUuid(): string {
  const epochMs = Date.now().toString(16).padStart(12, "0");
  const [, , random, variant, tail] = crypto.randomUUID().split("-");
  return `${epochMs.slice(0, 8)}-${epochMs.slice(8)}-7${random.slice(1)}-${variant}-${tail}`;
}

function restDocument(d: FakeDocument, direction: "incoming" | "outgoing", status: string) {
  return {
    uuid: d.id,
    direction,
    status,
    ...(d.kind === "invoices"
      ? { invoiceNumber: d.number, documentTypeCode: 380 }
      : { creditNoteNumber: d.number, documentTypeCode: 381 }),
  };
}

const fake = {
  posts: 0,
  requests: 0,
  destination: null as {
    eventId: string;
    event: string;
    target: string;
    authType: string;
    authKey: string | null;
    authToken: string | null;
  } | null,
  outboundOwnerTin: null as string | null,
  beforeSourceRead: null as (() => Promise<void>) | null,
  tddReads: 0,
  submitDelayMs: 0,
  nextSubmit: [] as Array<"201" | "422" | "network">,
  docs: new Map<string, FakeDoc>(),
  legalEntityStatus: "Active",
  legalEntityTin: TIN,
  reservations: 0,
  beforeReserveReply: null as (() => Promise<void>) | null,
  leId: crypto.randomUUID() as string,
  incoming: [] as FakeDocument[],
  reset() {
    this.posts = 0;
    this.requests = 0;
    this.destination = null;
    this.outboundOwnerTin = null;
    this.beforeSourceRead = null;
    this.tddReads = 0;
    this.submitDelayMs = 0;
    this.nextSubmit = [];
    this.docs.clear();
    this.legalEntityStatus = "Active";
    this.legalEntityTin = TIN;
    this.reservations = 0;
    this.beforeReserveReply = null;
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
  fake.requests++;
  const method = (init.method ?? "GET").toUpperCase();
  const p = url.pathname;
  if (url.host === "common.api.acubeapi.com" && p === "/login") {
    return json(200, { token: "e30.eyJleHAiOjQxMDI0NDQ4MDB9.c2ln" });
  }
  if (method === "GET" && p === "/event-destinations" && fake.destination) {
    return json(200, {
      member: [{ ...fake.destination, authToken: "****", delivery: "webhook" }],
      view: {},
    });
  }
  if (
    method === "PUT" &&
    fake.destination &&
    p === `/event-destinations/${fake.destination.eventId}`
  ) {
    const { authType, authKey, authToken } = JSON.parse(String(init.body));
    fake.destination = { ...fake.destination, authType, authKey, authToken };
    return json(200, { eventId: fake.destination.eventId });
  }
  if (method === "POST" && p === "/legal-entities") {
    fake.reservations++;
    const beforeReply = fake.beforeReserveReply;
    fake.beforeReserveReply = null;
    await beforeReply?.();
    return json(201, {
      uuid: fake.leId,
      tin: fake.legalEntityTin,
      status: "RESERVED",
      enabledCapabilities: [],
    });
  }
  if (method === "GET" && p === `/legal-entities/${fake.leId}`) {
    const active = fake.legalEntityStatus === "Active";
    return json(200, {
      uuid: fake.leId,
      tin: fake.legalEntityTin,
      status: fake.legalEntityStatus,
      nameEn: "Pearl Trading L.L.C.",
      nameAr: "بيرل للتجارة ش.ذ.م.م",
      vatTrn: `${fake.legalEntityTin}00003`,
      isEnabled: active,
      enabledCapabilities: active
        ? [{ key: "billing.invoice" }, { key: "billing.credit_note" }]
        : [],
      smpSyncAt: active ? "2026-11-16T08:04:52+00:00" : null,
      registrySyncAt: active ? "2026-11-16T08:04:55+00:00" : null,
    });
  }
  if (method === "POST" && (p === "/invoices" || p === "/credit-notes")) {
    const kind = p === "/invoices" ? "invoices" : "credit-notes";
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
    const id = documentUuid();
    const document = { id, kind, number, xml, status: "processed", tdd: false } satisfies FakeDoc;
    fake.docs.set(id, document);
    if (mode === "network") throw new TypeError("fetch failed: socket hang up");
    return json(201, restDocument(document, "outgoing", document.status));
  }
  const list = /^\/(invoices|credit-notes)$/.exec(p);
  if (method === "GET" && list) {
    const kind = list[1];
    if (url.searchParams.get("direction") === "incoming") {
      return json(
        200,
        fake.incoming
          .filter((d) => d.kind === kind)
          .map((d) => ({
            ...restDocument(d, "incoming", "received"),
            legalEntityUuid: fake.leId,
            ownerFiscalId: TIN,
          }))
      );
    }
    return json(
      200,
      [...fake.docs.values()]
        .filter((d) => d.kind === kind)
        .map((d) => restDocument(d, "outgoing", d.status))
    );
  }

  const m = /^\/(invoices|credit-notes)\/([^/]+)(\/tdd|\/source)?$/.exec(p);
  if (method === "GET" && m) {
    const [, kind, id, resource] = m;
    const incoming = fake.incoming.find((d) => d.id === id && d.kind === kind);
    if (incoming) {
      if (resource === "/source") return new Response(incoming.xml, { status: 200 });
      return json(200, {
        ...restDocument(incoming, "incoming", "received"),
        legalEntityUuid: fake.leId,
        ownerFiscalId: TIN,
      });
    }
    const document = fake.docs.get(id);
    if (!document || document.kind !== kind) return json(404, { detail: "Not found" });
    if (resource === "/source") {
      const before = fake.beforeSourceRead;
      fake.beforeSourceRead = null;
      await before?.();
      return new Response(document.xml, { status: 200 });
    }
    if (resource === "/tdd") {
      fake.tddReads++;
      return document.tdd
        ? new Response("<TaxDataDocument/>", { status: 200 })
        : new Response(null, { status: 204 });
    }
    return json(200, {
      ...restDocument(document, "outgoing", document.status),
      ...(fake.outboundOwnerTin ? { ownerFiscalId: fake.outboundOwnerTin } : {}),
    });
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
  "ACUBE_WEBHOOK_TOKEN_HEADER",
  "ACUBE_WEBHOOK_EVENTS",
  "EINVOICE_ASP_BASE_URL",
  "EINVOICE_ASP_API_KEY",
];
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

let credentialVariable: string | null = null;

async function useAcube(t: Tenant, webhookToken?: string) {
  await recordTestAppointment(t, "acube");
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
  opts: {
    created?: number;
    key?: crypto.KeyObject;
    token?: string;
    tokenHeader?: string;
    body?: string;
  } = {}
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
      ...(opts.token ? { [opts.tokenHeader ?? "X-Acube-Token"]: opts.token } : {}),
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

  it("freezes the linked buyer's VAT identity and report-by date with the submitted XML", async () => {
    const t = await linkedTenant();
    const inv = await oldInvoice(t);
    await h.sql("UPDATE invoices SET customer_trn = NULL WHERE id = $1", [inv.id]);
    const prefix = `/api/invoices/${inv.id}`;
    const generated = await t.as.post(`${prefix}/generate-einvoice`, {});
    expect(generated.status, generated.text).toBe(200);
    expect((await statusOf(t, inv.id)).tracks.reporting).toMatchObject({
      required: true,
      reportBy: "2026-01-15",
    });
    expect((await t.as.post(`${prefix}/einvoice/submit`, {})).status).toBe(202);
    const [frozen] = await h.sql("SELECT contact_id, einvoice_xml from invoices WHERE id = $1", [
      inv.id,
    ]);
    expect(frozen.einvoice_xml).toContain("100765432100003");
    const [obligation] = await h.sql(
      "SELECT report_by::text, validation->'submission'->>'reportingRequired' AS required FROM einvoice_documents WHERE invoice_id = $1",
      [inv.id]
    );
    expect(obligation).toEqual({ report_by: "2026-01-15", required: "true" });

    await h.sql(
      "UPDATE customer_contacts SET trn_number = NULL WHERE company_id = $1 AND id = $2",
      [t.company.id, frozen.contact_id]
    );
    await setScope(t, { scope: "b2b", band: "large", go: "2027-01-01" });
    await runEInvoiceRetries();
    const [held] = fake.docs.values();
    expect(held.xml).toBe(frozen.einvoice_xml);
    held.status = "accepted";
    expect((await t.as.post(`${prefix}/einvoice/refresh-status`, {})).status).toBe(200);
    expect((await statusOf(t, inv.id)).tracks.reporting).toMatchObject({
      required: true,
      reportBy: "2026-01-15",
    });
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
  it("hides a superseded A-Cube taxpayer and reconnects without changing submitted evidence", async () => {
    const t = await linkedTenant();
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
    expect(original).toEqual([
      expect.objectContaining({
        provider_message_id: expect.any(String),
        pin: expect.objectContaining({
          supplierTin: TIN,
          legalEntityId: fake.leId,
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
    expect((await t.as.get(`${path}/acube`)).body).toMatchObject({
      canSend: false,
      legalEntity: null,
    });

    const old = linkEvent();
    fake.leId = crypto.randomUUID();
    fake.legalEntityTin = nextTin;
    const reserve = await t.as.post(`${path}/acube/reserve`, { approver: "me" });
    expect(reserve.status, reserve.text).toBe(200);
    expect(reserve.body.legalEntity).toMatchObject({
      status: "reserved",
      tin: nextTin,
      legalEntityId: fake.leId,
    });
    expect((await webhook(t, old)).status).toBe(200);
    expect((await webhook(t, { ...linkEvent(), tin: nextTin })).status).toBe(200);
    await runProviderEvents({ companyId: t.company.id });
    expect((await t.as.get(`${path}/acube`)).body.canSend).toBe(true);
    expect((await t.as.get(`${path}/settings`)).body.asp.connected).toBe(true);
    expect(await evidence()).toEqual(original);
    const oldId = original[0].provider_message_id;
    fake.docs.get(oldId)!.status = "accepted";
    const tracked = await t.as.post(`/api/invoices/${inv.id}/einvoice/refresh-status`, {});
    expect(tracked.status, tracked.text).toBe(200);
    expect((await statusOf(t, inv.id)).transmission).toMatchObject({
      providerDocumentId: oldId,
      recipientAcknowledgement: "accepted",
    });
  });

  it("keeps an early ID-only signed LINK pending until the reservation response is verified", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "acube" },
    });
    await useAcube(t);
    const route = `/api/companies/${t.company.id}/einvoicing/acube`;
    const event = {
      eventId: crypto.randomUUID(),
      legalEntityUuid: fake.leId,
      eventType: "legal_entity.synchronized",
      action: "LINK",
    };
    let during: Record<string, unknown> | undefined;
    let duplicateStatus: number | undefined;
    fake.beforeReserveReply = async () => {
      const receipt = await webhook(t, event);
      if (receipt.status !== 200) throw new Error(receipt.text);
      await runProviderEvents({ companyId: t.company.id });
      [during] = await h.sql(
        `SELECT e.status, e.next_attempt_at > e.received_at AS deferred,
                le.legal_entity_id IS NULL AS unverified
           FROM einvoice_provider_events e LEFT JOIN einvoice_legal_entities le
             ON le.company_id = e.company_id AND le.provider = e.provider AND le.environment = e.environment
          WHERE e.company_id = $1`,
        [t.company.id]
      );
      duplicateStatus = (await t.as.post(`${route}/reserve`, { approver: "me" })).status;
      const unrelated = await webhook(t, {
        ...event,
        eventId: crypto.randomUUID(),
        legalEntityUuid: crypto.randomUUID(),
      });
      if (unrelated.status !== 200) throw new Error(unrelated.text);
    };
    const result = await t.as.post(`${route}/reserve`, { approver: "me" });
    expect(during).toEqual({ status: "pending", deferred: true, unverified: true });
    expect(duplicateStatus).toBe(202);
    expect(fake.reservations).toBe(1);
    expect(result.status, result.text).toBe(200);
    expect(result.body.legalEntity).toMatchObject({ legalEntityId: fake.leId, status: "reserved" });
    await h.sql(
      `UPDATE einvoice_provider_events SET next_attempt_at = now() WHERE company_id = $1`,
      [t.company.id]
    );
    expect(await runProviderEvents({ companyId: t.company.id })).toMatchObject({ processed: 2 });
    expect(
      await h.sql(
        `SELECT status FROM einvoice_provider_events WHERE company_id = $1 ORDER BY status`,
        [t.company.id]
      )
    ).toEqual([{ status: "ignored" }, { status: "processed" }]);
    expect((await t.as.get(route)).body.legalEntity).toMatchObject({
      legalEntityId: fake.leId,
      tin: TIN,
      status: "active",
      lastAction: "LINK",
    });
  });

  it("does not apply a reservation response after the company changes provider", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "acube" },
    });
    await useAcube(t);
    fake.beforeReserveReply = async () => {
      await h.sql(`UPDATE companies SET einvoice_partner = 'complyance' WHERE id = $1`, [
        t.company.id,
      ]);
    };
    const route = `/api/companies/${t.company.id}/einvoicing/acube/reserve`;
    const stale = await t.as.post(route, { approver: "me" });
    expect(stale.status, stale.text).toBe(409);
    expect(
      await h.sql(
        `SELECT status, legal_entity_id FROM einvoice_legal_entities WHERE company_id = $1`,
        [t.company.id]
      )
    ).toEqual([{ status: "reserved", legal_entity_id: null }]);
    await h.sql(`UPDATE companies SET einvoice_partner = 'acube' WHERE id = $1`, [t.company.id]);
    const retried = await t.as.post(route, { approver: "me" });
    expect(retried.status, retried.text).toBe(200);
    expect(retried.body.legalEntity.legalEntityId).toBe(fake.leId);
  });

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

describe("A-Cube taxpayer verification", () => {
  it("refuses a 0235 endpoint different from the statutory TIN before reserving", async () => {
    const t = await h.createTenant({
      companyColumns: {
        ...SELLER_COLUMNS,
        einvoice_partner: "acube",
        peppol_scheme: "0235",
        peppol_participant_id: "1005555555",
      },
    });
    await useAcube(t);
    const response = await t.as.post(`/api/companies/${t.company.id}/einvoicing/acube/reserve`, {
      approver: "me",
    });
    expect(response.status, response.text).toBe(422);
    expect(response.body.code).toBe("EINVOICE_SUPPLIER_ENDPOINT_MISMATCH");
    expect(fake.reservations).toBe(0);
  });

  it("refuses provider TIN mismatches on reservation and manual sync", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "acube" },
    });
    await useAcube(t);
    const route = `/api/companies/${t.company.id}/einvoicing/acube`;
    fake.legalEntityTin = "1005555555";
    const reserve = () => t.as.post(`${route}/reserve`, { approver: "me" });
    const rejected = await reserve();
    expect(rejected.status, rejected.text).toBe(502);
    expect(rejected.body.code).toBe("EINVOICE_PROVIDER_TIN_MISMATCH");
    expect((await t.as.get(route)).body.legalEntity).toMatchObject({
      status: "reserved",
      tin: TIN,
      legalEntityId: null,
    });

    fake.legalEntityTin = TIN;
    expect((await reserve()).body.legalEntity.status).toBe("reserved");
    fake.legalEntityTin = "1005555555";
    const synced = await t.as.post(`${route}/sync`, {});
    expect(synced.status, synced.text).toBe(502);
    expect(synced.body.code).toBe("EINVOICE_PROVIDER_TIN_MISMATCH");
    expect((await t.as.get(route)).body.legalEntity).toMatchObject({
      status: "reserved",
      tin: TIN,
    });

    fake.legalEntityTin = TIN;
    const confirmed = await t.as.post(`${route}/sync`, {});
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(confirmed.body.legalEntity.status).toBe("active");
  });
});

describe("A-Cube native signed webhook payloads", () => {
  it.each([
    { remoteStatus: "Inactive", remoteTin: "1005555555", eventStatus: "ignored" },
    { remoteStatus: "Reserved", remoteTin: "1005555555", eventStatus: "ignored" },
    { remoteStatus: "Inactive", remoteTin: "", eventStatus: "pending" },
  ])(
    "keeps the link when $remoteStatus sync lacks matching TIN evidence",
    async ({ remoteStatus, remoteTin, eventStatus }) => {
      const t = await linkedTenant();
      fake.legalEntityStatus = remoteStatus;
      fake.legalEntityTin = remoteTin;
      const receipt = await webhook(t, linkEvent("DELINK", remoteStatus));
      expect(receipt.status, receipt.text).toBe(200);
      await runProviderEvents({ companyId: t.company.id });
      const route = `/api/companies/${t.company.id}/einvoicing/acube`;
      expect((await t.as.get(route)).body.legalEntity).toMatchObject({
        status: "active",
        tin: TIN,
      });
      expect(
        await h.sql(
          `SELECT status FROM einvoice_provider_events WHERE company_id = $1
         AND event_type = 'legal_entity.synchronized' ORDER BY received_at DESC LIMIT 1`,
          [t.company.id]
        )
      ).toEqual([{ status: eventStatus }]);
    }
  );

  it("uses the native legal entity UUID to confirm onboarding", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "acube" },
    });
    await useAcube(t);
    const reserved = await t.as.post(`/api/companies/${t.company.id}/einvoicing/acube/reserve`, {
      approver: "me",
    });
    expect(reserved.body.legalEntity.status).toBe("reserved");
    const payload = {
      eventId: "019e91b7-f799-7df7-a469-4824b2656b0e",
      eventType: "legal_entity.synchronized",
      legalEntityUuid: fake.leId,
      action: "LINK",
    };
    const received = await webhook(t, payload);
    expect(received.status, received.text).toBe(200);
    expect(received.body.duplicate).toBe(false);
    expect((await webhook(t, payload)).body.duplicate).toBe(true);
    expect(await runProviderEvents()).toMatchObject({ claimed: 1, processed: 1 });
    const linked = await t.as.get(`/api/companies/${t.company.id}/einvoicing/acube`);
    expect(linked.body.legalEntity).toMatchObject({ status: "active", legalEntityId: fake.leId });
  });

  it.each([
    { kind: "invoices", eventType: "invoice.outbound", uuidField: "invoiceUuid" },
    { kind: "credit-notes", eventType: "credit_note.outbound", uuidField: "creditNoteUuid" },
  ] as const)(
    "uses the native $uuidField to refresh an outbound document",
    async ({ kind, eventType, uuidField }) => {
      const t = await linkedTenant();
      const invoice = await issuedInvoice(t);
      let id = invoice.id;
      if (kind === "credit-notes") {
        const note = await t.as.post(
          `/api/companies/${t.company.id}/invoices/${invoice.id}/credit-note`,
          {
            reason: "Service credit",
          }
        );
        expect(note.status, note.text).toBe(201);
        id = note.body.id;
      }
      const queued = await t.as.post(`/api/invoices/${id}/einvoice/submit`, {});
      expect(queued.status, queued.text).toBe(202);
      await runEInvoiceRetries();
      const providerDocumentId = (await statusOf(t, id)).transmission.providerDocumentId;
      const document = fake.docs.get(providerDocumentId);
      expect(document?.kind).toBe(kind);
      document!.status = "accepted";
      const payload = {
        eventId: "019e91b7-f799-7df7-a469-4824b2656b0f",
        eventType,
        [uuidField]: providerDocumentId,
      };
      const received = await webhook(t, payload);
      expect(received.status, received.text).toBe(200);
      expect(received.body.duplicate).toBe(false);
      expect((await webhook(t, payload)).body.duplicate).toBe(true);
      expect(await runProviderEvents()).toMatchObject({ claimed: 1, processed: 1 });
      expect((await statusOf(t, id)).status).toBe("accepted");
    }
  );
});

describe("E1 submit, two tracks and history", () => {
  it("sends once, waits for MLS after receipt, and leaves reporting pending with a downloadable TDD", async () => {
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
    expect(s).toMatchObject({ status: "submitted", submissionState: "sent" });
    expect(s.tracks.delivery.status).toBe("sending");
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
    expect(s).toMatchObject({ status: "submitted", submissionState: "sent" });
    expect(s.tracks.delivery.status).toBe("delivered");
    expect(s.tracks.reporting.status).toBe("pending");

    // A TDD is already downloadable when the recipient's MLS arrives.
    fake.docs.get(docId)!.tdd = true;
    fake.docs.get(docId)!.status = "accepted";
    expect((await runAcubePoll()).refreshed).toBe(1);
    s = await statusOf(t, inv.id);
    expect(s).toMatchObject({ status: "accepted", submissionState: "accepted" });
    expect(s.tracks.reporting.status).toBe("pending");
    expect(fake.tddReads).toBe(0);
    expect((await runAcubePoll()).refreshed).toBe(0);
    expect(Object.fromEntries(s.checklist.map((c: any) => [c.key, c.state]))).toEqual({
      posted: "done",
      validated: "done",
      sent: "done",
      reported: "in_progress",
    });
    const history = s.events.map((e: any) => `${e.source}:${e.track}:${e.to}`);
    expect(history).toEqual(
      expect.arrayContaining([
        "user:delivery:queued",
        "webhook:delivery:delivered",
        "job:delivery:sending",
      ])
    );
    const rows = await h.sql(
      `SELECT status, attempts FROM einvoice_provider_events
        WHERE company_id = $1 AND provider = 'acube' AND event_type = 'document.delivered'`,
      [t.company.id]
    );
    expect(rows).toEqual([{ status: "processed", attempts: 1 }]);
  });

  it("shows a 422 rejection with the named field, then fix and resubmit keeps the UUID", async () => {
    const t = await linkedTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
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
    const before = await h.sql(
      "SELECT status, validation, xml_hash, last_error_code FROM einvoice_documents WHERE invoice_id = $1",
      [inv.id]
    );
    expect((await t.as.post(`/api/invoices/${inv.id}/generate-einvoice`, {})).status).toBe(409);
    expect(
      await h.sql(
        "SELECT status, validation, xml_hash, last_error_code FROM einvoice_documents WHERE invoice_id = $1",
        [inv.id]
      )
    ).toEqual(before);
    const ordinary = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(ordinary.status).toBe(409);
    expect(fake.posts).toBe(1);

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

  it("shows a provider-held delivery failure and polls for recovery without another POST", async () => {
    const t = await linkedTenant();
    const inv = await issuedInvoice(t);
    await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    await runEInvoiceRetries();
    const docId = (await statusOf(t, inv.id)).transmission.providerDocumentId as string;
    fake.docs.get(docId)!.status = "delivery_error";
    await runAcubePoll();
    const s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("delivery_failed");
    expect(s).toMatchObject({
      submissionState: "failed",
      transmission: { providerDocumentId: docId },
    });
    expect(s.rejection).toMatchObject({ code: "ACUBE_DELIVERY_FAILED", retryScheduledAt: null });
    const row = await h.sql(
      `SELECT status, next_retry_at FROM einvoice_documents WHERE invoice_id = $1`,
      [inv.id]
    );
    expect(row[0]).toEqual({ status: "failed", next_retry_at: null });
    fake.docs.get(docId)!.status = "accepted";
    expect((await runAcubePoll()).refreshed).toBe(1);
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "accepted",
      submissionState: "accepted",
    });
    expect(fake.posts).toBe(1);
  });

  it.each(["delivered", null, "unrecognised"])(
    "projects a legacy TDD download as pending across status, documents and compliance (%s)",
    async (providerStatus) => {
      const t = await linkedTenant();
      const inv = await issuedInvoice(t);
      expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
      await runEInvoiceRetries();
      await h.sql(`UPDATE invoices SET einvoice_status = 'cleared' WHERE id = $1`, [inv.id]);
      await h.sql(
        `UPDATE einvoice_documents SET status = 'cleared', delivery_status = 'delivered',
        provider_status = $2, reporting_status = 'reported', reported_at = NOW(),
        reporting_status_at = NOW(), cleared_at = NOW() WHERE invoice_id = $1`,
        [inv.id, providerStatus]
      );
      const [{ id: eventId }] = await h.sql(
        `INSERT INTO einvoice_document_events
          (company_id, invoice_id, track, from_status, to_status, provider, source, message)
          VALUES ($1, $2, 'reporting', 'pending', 'reported', 'acube', 'poll', 'FTA accepted')
          RETURNING id`,
        [t.company.id, inv.id]
      );

      const delivery = providerStatus === "delivered" ? "delivered" : "queued";
      const docProjection = {
        status: "submitted",
        deliveryStatus: delivery,
        reportingStatus: "pending",
        reportedAt: null,
        reportingStatusAt: null,
        clearedAt: null,
      };
      const detail = await statusOf(t, inv.id);
      expect(detail).toMatchObject({
        status: "submitted",
        submissionState: "sent",
        document: docProjection,
        tracks: { reporting: { status: "pending", at: null, confirmationUnavailable: true } },
      });
      expect(detail.events).toContainEqual(
        expect.objectContaining({
          id: eventId,
          track: "reporting",
          to: "pending",
          confirmationUnavailable: true,
          message: null,
        })
      );
      expect(
        await h.sql(`SELECT to_status, message FROM einvoice_document_events WHERE id = $1`, [
          eventId,
        ])
      ).toEqual([{ to_status: "reported", message: "FTA accepted" }]);
      const list = await t.as.get(`/api/companies/${t.company.id}/einvoicing/documents`);
      expect(list.status, list.text).toBe(200);
      expect(list.body.items).toContainEqual(
        expect.objectContaining({ invoiceId: inv.id, ...docProjection })
      );
      const pills = await t.as.get(`/api/companies/${t.company.id}/einvoicing/compliance`);
      expect(pills.status, pills.text).toBe(200);
      expect(pills.body.items).toContainEqual(
        expect.objectContaining({
          invoiceId: inv.id,
          reporting: "pending",
          delivery,
        })
      );
    }
  );

  it("recovers an ambiguous A-Cube handoff after the selected provider and actor permission change", async () => {
    const t = await linkedTenant();
    const inv = await issuedInvoice(t);
    fake.nextSubmit = ["network"]; // A-Cube created it, the response was lost
    const first = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(first.body.status).toBe("queued");
    await runEInvoiceRetries();
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "failed",
      submissionState: "queued",
      rejection: { code: "TRANSPORT_ERROR", retryScheduledAt: expect.any(String) },
    });
    expect(fake.posts).toBe(1);
    await h.sql("UPDATE companies SET einvoice_partner = 'complyance' WHERE id = $1", [
      t.company.id,
    ]);
    await h.sql("UPDATE company_users SET role = 'viewer' WHERE company_id = $1 AND user_id = $2", [
      t.company.id,
      t.user.id,
    ]);
    await h.sql(
      "UPDATE einvoice_legal_entities SET status = 'inactive' WHERE company_id = $1 AND provider = 'acube'",
      [t.company.id]
    );
    const retry = await runEInvoiceRetries(new Date(Date.now() + 2 * 60_000));
    expect(retry).toEqual({ attempted: 1, submitted: 1 });
    expect(fake.posts).toBe(1); // found by invoice number, not posted twice
    const s = await statusOf(t, inv.id);
    expect(s.tracks.delivery.status).toBe("sending");
    expect(fake.docs.has(s.transmission.providerDocumentId)).toBe(true);
  });

  it("Refresh attaches an exact A-Cube document after the automatic lookup budget is exhausted", async () => {
    const t = await linkedTenant();
    const inv = await issuedInvoice(t);
    fake.nextSubmit = ["network"];
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = [...fake.docs.values()][0];
    expect(held).toBeDefined();
    fake.docs.delete(held.id);
    const { EINVOICE_MAX_ATTEMPTS } = await import("../../server/services/einvoice-status");
    for (let attempt = 1; attempt < EINVOICE_MAX_ATTEMPTS; attempt++) {
      const [row] = await h.sql(
        "SELECT next_retry_at AT TIME ZONE 'UTC' AS due FROM einvoice_documents WHERE invoice_id = $1",
        [inv.id]
      );
      expect(row.due).toBeTruthy();
      await runEInvoiceRetries(new Date(row.due));
    }
    await h.sql("UPDATE companies SET einvoice_partner = 'complyance' WHERE id = $1", [
      t.company.id,
    ]);
    await h.sql("UPDATE company_users SET role = 'viewer' WHERE company_id = $1 AND user_id = $2", [
      t.company.id,
      t.user.id,
    ]);
    const status = await statusOf(t, inv.id);
    expect(status.tracks.delivery.status).toBe("needs_link");
    expect(status.transmission.canRefresh).toBe(true);
    fake.docs.set(held.id, { ...held, status: "accepted" });
    const recovered = await t.as.post(`/api/invoices/${inv.id}/einvoice/refresh-status`, {});
    expect(recovered.status, recovered.text).toBe(200);
    expect(recovered.body).toMatchObject({ status: "accepted", providerMessageId: held.id });
    const [row] = await h.sql(
      "SELECT attempts, provider_message_id, next_retry_at FROM einvoice_documents WHERE invoice_id = $1",
      [inv.id]
    );
    expect(row).toMatchObject({
      attempts: EINVOICE_MAX_ATTEMPTS,
      provider_message_id: held.id,
      next_retry_at: null,
    });
    expect(fake.posts).toBe(1);
  });
});

describe("E1 webhook authentication", () => {
  it("publishes and registers only the selected company's callback on a valid HTTPS origin", async () => {
    const t = await linkedTenant();
    const settings = `/api/companies/${t.company.id}/einvoicing/settings`;
    const connection = `/api/companies/${t.company.id}/einvoicing/acube`;
    const expected = `${PUBLIC_BASE}${WEBHOOK}/${t.company.id}`;
    expect((await t.as.get(settings)).body.inbound).toMatchObject({
      providerCallbackUrl: expected,
    });
    expect((await t.as.get(connection)).body.webhook.url).toBe(expected);

    process.env.ACUBE_WEBHOOK_BASE_URL = `${PUBLIC_BASE}/unrouted-prefix?param=1`;
    expect((await t.as.get(settings)).body.inbound.providerCallbackUrl).toBeNull();
    expect((await t.as.get(connection)).body.webhook.url).toBeNull();
    const refused = await t.as.post(`${connection}/webhooks`, {});
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.code).toBe("EINVOICE_WEBHOOK_URL_NOT_CONFIGURED");
  });

  it("reconciles a rotated destination token and still requires the signed callback", async () => {
    const t = await linkedTenant();
    const previous = crypto.randomUUID();
    const active = crypto.randomUUID();
    await useAcube(t, active);
    process.env.ACUBE_WEBHOOK_EVENTS = "invoice.outbound";
    process.env.ACUBE_WEBHOOK_TOKEN_HEADER = "  X-Rotated-Token  ";
    fake.destination = {
      eventId: crypto.randomUUID(),
      event: "invoice.outbound",
      target: `${PUBLIC_BASE}${WEBHOOK}/${t.company.id}`,
      authType: "header",
      authKey: "X-Acube-Token",
      authToken: previous,
    };
    const setup = await t.as.post(`/api/companies/${t.company.id}/einvoicing/acube/webhooks`, {});
    expect(setup.status, setup.text).toBe(200);
    expect(setup.body).toEqual({ created: [], existing: ["invoice.outbound"] });
    expect(fake.destination.authKey).toBe("X-Rotated-Token");
    expect(fake.destination.authToken === active).toBe(true);
    const tokenHeader = "X-Rotated-Token";
    expect((await webhook(t, linkEvent(), { token: previous, tokenHeader })).body.code).toBe(
      "EINVOICE_WEBHOOK_BAD_TOKEN"
    );
    const wrongKey = crypto.generateKeyPairSync("ed25519").privateKey;
    expect(
      (await webhook(t, linkEvent(), { token: active, tokenHeader, key: wrongKey })).body.code
    ).toBe("EINVOICE_WEBHOOK_BAD_SIGNATURE");
    expect((await webhook(t, linkEvent(), { token: active, tokenHeader })).status).toBe(200);
  });
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

function incomingXml(fixture: PintAeFixture, documentNumber = fixture.invoice.number): string {
  const supplier = {
    ...fixtureCompany,
    trnVatNumber: "100987654300003",
    peppolParticipantId: "1009876543",
    legalName: "Gulf Supplies L.L.C.",
  } as typeof fixtureCompany;
  return generateEInvoiceXML(
    { ...fixture.invoice, number: documentNumber },
    fixture.lines,
    supplier,
    { ...fixture.customer, name: "Pearl Trading L.L.C.", trn: TRN, endpointId: TIN },
    fixture.opts
  ).xml;
}

describe("E1 inbound: document.received -> draft bill tagged e-invoice", () => {
  it("stores a signed receipt for the current taxpayer until its registration activates", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, einvoice_partner: "acube" },
    });
    await useAcube(t);
    const id = documentUuid();
    const number = "SUP-CURRENT-ACUBE-BEFORE-LINK";
    fake.incoming.push({
      id,
      kind: "invoices",
      number,
      xml: incomingXml(PINT_AE_FIXTURES[0], number),
    });
    const receipt = await webhook(t, { eventType: "invoice.inbound", invoiceUuid: id });
    expect(receipt.status, receipt.text).toBe(200);
    expect(receipt.body).toEqual({ received: true, duplicate: false });
    expect(await runProviderEvents({ companyId: t.company.id })).toMatchObject({ claimed: 0 });
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", TIN, {
      status: "active",
      legalEntityId: fake.leId,
    });
    expect(await runProviderEvents({ companyId: t.company.id })).toMatchObject({ processed: 1 });
    expect(
      await h.sql("SELECT bill_number FROM vendor_bills WHERE company_id = $1", [t.company.id])
    ).toEqual([{ bill_number: number }]);
  });

  it.each(["retired provider", "former taxpayer"])(
    "acknowledges a signed receipt for a %s without accepting it",
    async (scope) => {
      const t = await linkedTenant();
      const id = documentUuid();
      const number = "SUP-RETIRED-ACUBE";
      fake.incoming.push({
        id,
        kind: "invoices",
        number,
        xml: incomingXml(PINT_AE_FIXTURES[0], number),
      });
      await h.sql(
        scope === "retired provider"
          ? "UPDATE companies SET einvoice_partner = 'complyance' WHERE id = $1"
          : "UPDATE companies SET einvoice_tin = '1009999999', trn_vat_number = '100999999900003' WHERE id = $1",
        [t.company.id]
      );
      const receipt = await webhook(t, { eventType: "invoice.inbound", invoiceUuid: id });
      expect(receipt.status, receipt.text).toBe(200);
      expect(receipt.body).toEqual({ received: true, ignored: true });
      await runProviderEvents();
      expect(
        await h.sql("SELECT id FROM vendor_bills WHERE company_id = $1", [t.company.id])
      ).toEqual([]);
      expect(
        await h.sql(
          "SELECT id FROM einvoice_provider_events WHERE company_id = $1 AND event_type = 'document.received'",
          [t.company.id]
        )
      ).toEqual([]);
    }
  );

  it.each(["prose", "native"])(
    "deduplicates the %s webhook and poll and creates one draft bill",
    async (shape) => {
      const t = await linkedTenant();
      const id = "01a0c453-5398-728c-8b10-84dd471cd797";
      const xml = incomingXml(PINT_AE_FIXTURES[0], "AE-INV-005");
      fake.incoming.push({ id, kind: "invoices", number: "AE-INV-005", xml });
      const payload =
        shape === "native"
          ? {
              eventId: "019e91b7-f799-7df7-a469-4824b2656b10",
              eventType: "invoice.inbound",
              invoiceUuid: id,
            }
          : {
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
    }
  );

  it.each(["poll", "webhook"])(
    "deduplicates a native inbound credit note with %s first",
    async (first) => {
      const t = await linkedTenant();
      const f = PINT_AE_FIXTURES.find((item) => item.name === "credit note")!;
      const id = "01a0aec8-7f31-7b17-9122-26ded8285826";
      const xml = incomingXml(f);
      fake.incoming.push({ id, kind: "credit-notes", number: f.invoice.number, xml });
      if (first === "poll") expect((await runAcubePoll()).enqueued).toBe(1);
      const received = await webhook(t, {
        eventId: "019e91b7-f799-7df7-a469-4824b2656b11",
        eventType: "credit_note.inbound",
        creditNoteUuid: id,
      });
      expect(received.status, received.text).toBe(200);
      expect(received.body.duplicate).toBe(first === "poll");
      expect((await runAcubePoll()).enqueued).toBe(0);
      expect(await runProviderEvents()).toMatchObject({ claimed: 1, processed: 1 });
      const inbound = await t.as.get(`/api/companies/${t.company.id}/einvoicing/inbound`);
      expect(inbound.body.items).toEqual([
        expect.objectContaining({
          status: "received",
          documentNumber: f.invoice.number,
          billId: null,
        }),
      ]);
    }
  );
});

describe("Legacy A-Cube environment verification", () => {
  it("recovers the exact original connection for a sole audited pre-upgrade validation refusal", async () => {
    const t = await linkedTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const inv = await issuedInvoice(t);
    const prefix = `/api/invoices/${inv.id}/einvoice`;
    const [buyer] = await h.sql(
      "UPDATE invoices SET customer_trn = NULL, date = '2026-03-01' WHERE id = $1 RETURNING contact_id",
      [inv.id]
    );
    await h.sql(
      "UPDATE customer_contacts SET trn_number = NULL WHERE company_id = $1 AND id = $2",
      [t.company.id, buyer.contact_id]
    );
    await h.sql(
      "INSERT INTO einvoice_buyer_endpoints (company_id, contact_id, scheme, participant_id) VALUES ($1, $2, '0235', '1007654321')",
      [t.company.id, buyer.contact_id]
    );
    expect((await t.as.post(`/api/invoices/${inv.id}/generate-einvoice`, {})).status).toBe(200);
    await h.sql(
      "UPDATE invoices SET einvoice_status = 'rejected', einvoice_provider = 'acube' WHERE id = $1",
      [inv.id]
    );
    await h.sql(
      `UPDATE einvoice_documents SET provider = 'acube', status = 'rejected', delivery_status = 'rejected', last_error_code = 'ACUBE_VALIDATION', attempts = 1, validation = validation - 'submission' WHERE invoice_id = $1`,
      [inv.id]
    );
    await h.sql(
      `INSERT INTO einvoice_document_events (company_id, invoice_id, track, to_status, code, provider, source) VALUES ($1, $2, 'delivery', 'rejected', 'ACUBE_VALIDATION', 'acube', 'user')`,
      [t.company.id, inv.id]
    );
    const [original] = await h.sql(
      "SELECT xml_hash, report_by FROM einvoice_documents WHERE invoice_id = $1",
      [inv.id]
    );
    const audit = JSON.stringify({
      after: {
        provider: "acube",
        environment: "sandbox",
        providerMessageId: "",
        status: "rejected",
      },
    });
    await h.sql(
      `INSERT INTO audit_logs (company_id, resource_type, resource_id, user_id, action, details) VALUES ($1, 'invoice', $2, $3, 'invoice.einvoice_submit', $4)`,
      [t.company.id, inv.id, t.user.id, audit]
    );
    const originalRequests = fake.requests;
    expect((await t.as.post(`${prefix}/resubmit`, {})).status).toBe(409);
    expect(
      (await t.as.post(`${prefix}/confirm-environment`, { environment: "production" })).status
    ).toBe(409);
    expect(await statusOf(t, inv.id)).toMatchObject({
      transmission: {
        environmentVerification: {
          provider: "acube",
          reference: "refusal",
          environments: ["sandbox"],
        },
      },
      rejection: { code: "ACUBE_VALIDATION", resubmittable: false },
    });
    expect(fake.requests).toBe(originalRequests);

    const confirmations = await Promise.all(
      [1, 2].map(() => t.as.post(`${prefix}/confirm-environment`, { environment: "sandbox" }))
    );
    for (const result of confirmations) {
      expect(result.status, result.text).toBe(200);
      expect(result.body).toMatchObject({
        retryEligible: true,
        environment: "sandbox",
        provider: "acube",
      });
    }
    expect(fake.requests).toBe(originalRequests);
    expect(
      (
        await h.sql(
          "SELECT status, xml_hash, report_by, last_error_code, next_retry_at FROM einvoice_documents WHERE invoice_id = $1",
          [inv.id]
        )
      )[0]
    ).toEqual({
      ...original,
      status: "rejected",
      last_error_code: "ACUBE_VALIDATION",
      next_retry_at: null,
    });
    expect(
      await h.sql(
        "SELECT id FROM audit_logs WHERE resource_id = $1 AND action = 'invoice.einvoice_refusal_verified'",
        [inv.id]
      )
    ).toHaveLength(1);
    expect((await statusOf(t, inv.id)).rejection.resubmittable).toBe(true);
    expect((await statusOf(t, inv.id)).tracks.reporting).toMatchObject({
      required: true,
      reportBy: "2026-03-15",
    });
    await h.sql(
      "UPDATE customer_contacts SET trn_number = '100765432100003' WHERE company_id = $1 AND id = $2",
      [t.company.id, buyer.contact_id]
    );
    expect((await t.as.post(`${prefix}/submit`, {})).status).toBe(409);
    const corrected = await t.as.post(`${prefix}/resubmit`, {});
    expect(corrected.status, corrected.text).toBe(202);
    expect(corrected.body.tracks.reporting).toMatchObject({
      required: true,
      reportBy: expect.any(String),
    });
    await runEInvoiceRetries();
    expect(fake.posts).toBe(1);
    expect([...fake.docs.values()][0].number).toBe(inv.number);
    expect([...fake.docs.values()][0].xml).toContain("100765432100003");
  });
  it("finds an ambiguous legacy attempt by its exact outbound source without resending", async () => {
    const t = await linkedTenant();
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    const inv = await issuedInvoice(t);
    const prefix = `/api/invoices/${inv.id}/einvoice`;
    expect((await t.as.post(`${prefix}/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const [held] = fake.docs.values();
    await h.sql(
      "UPDATE invoices SET einvoice_status = 'failed', einvoice_provider_message_id = NULL WHERE id = $1",
      [inv.id]
    );
    await h.sql(
      "UPDATE einvoice_documents SET status = 'failed', provider_message_id = NULL, delivery_status = 'delivery_failed', next_retry_at = NULL, validation = '{}' WHERE invoice_id = $1",
      [inv.id]
    );
    await h.sql("UPDATE companies SET einvoice_partner = 'complyance' WHERE id = $1", [
      t.company.id,
    ]);
    expect(await statusOf(t, inv.id)).toMatchObject({
      submissionState: "needs_reconciliation",
      transmission: {
        canRefresh: false,
        canSubmit: false,
        environmentVerification: {
          provider: "acube",
          reference: "search",
          environments: ["sandbox"],
        },
      },
    });
    const requests = fake.requests;
    for (const action of ["submit", "resubmit"])
      expect((await t.as.post(`${prefix}/${action}`, {})).status).toBe(409);
    expect(
      (await t.as.post(`${prefix}/confirm-environment`, { environment: "production" })).status
    ).toBe(503);
    expect(fake.requests).toBe(requests);

    const duplicateId = documentUuid();
    fake.docs.set(duplicateId, { ...held, id: duplicateId });
    expect(
      (await t.as.post(`${prefix}/confirm-environment`, { environment: "sandbox" })).status
    ).toBe(422);
    fake.docs.delete(duplicateId);
    const found = await t.as.post(`${prefix}/confirm-environment`, { environment: "sandbox" });
    expect(found.status, found.text).toBe(200);
    expect(found.body).toMatchObject({
      providerDocumentId: held.id,
      provider: "acube",
      environment: "sandbox",
    });
    held.status = "accepted";
    const refresh = await t.as.post(`${prefix}/refresh-status`, {});
    expect(refresh.status, refresh.text).toBe(200);
    expect(refresh.body.status).toBe("accepted");
    expect(fake.posts).toBe(1);
  });
  it("verifies one scoped reference, restores polling and signed callbacks, and never sends again", async () => {
    const t = await linkedTenant();
    const inv = await issuedInvoice(t);
    const path = `/api/invoices/${inv.id}/einvoice/confirm-environment`;
    expect((await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {})).status).toBe(202);
    await runEInvoiceRetries();
    const held = [...fake.docs.values()][0];
    expect(held).toBeDefined();
    await h.sql(
      "UPDATE einvoice_documents SET validation = validation #- '{submission,environment}', delivery_status = NULL WHERE invoice_id = $1",
      [inv.id]
    );

    const readsBefore = fake.requests;
    expect(await statusOf(t, inv.id)).toMatchObject({
      transmission: {
        canRefresh: false,
        environmentVerification: { provider: "acube", environments: ["sandbox"] },
      },
    });
    const other = await h.createTenant({ name: "Other tracking company" });
    const denied = await other.as.post(path, { environment: "sandbox" });
    expect(denied.status, denied.text).toBe(404);
    await h.sql("UPDATE users SET email_verified = false WHERE id = $1", [t.user.id]);
    const unverified = await t.as.post(path, { environment: "sandbox" });
    expect(unverified.status, unverified.text).toBe(403);
    expect(unverified.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    await h.sql("UPDATE users SET email_verified = true WHERE id = $1", [t.user.id]);
    await h.sql("UPDATE company_users SET role = 'viewer' WHERE company_id = $1 AND user_id = $2", [
      t.company.id,
      t.user.id,
    ]);
    expect((await t.as.post(path, { environment: "sandbox" })).status).toBe(403);
    await h.sql("UPDATE company_users SET role = 'owner' WHERE company_id = $1 AND user_id = $2", [
      t.company.id,
      t.user.id,
    ]);

    const otherEnvironment = {
      companyId: t.company.id,
      provider: "acube",
      environment: "production",
    } as const;
    const otherVariable = companyCredentialVariable(otherEnvironment);
    process.env[otherVariable] = sealCompanyCredentials(otherEnvironment, {
      email: "historic-account@example.test",
      password: crypto.randomUUID(),
    });
    try {
      const wrongEnvironment = await t.as.post(path, { environment: "production" });
      expect(wrongEnvironment.status, wrongEnvironment.text).toBe(503);
      expect(wrongEnvironment.body.code).toBe("EINVOICE_ENVIRONMENT_VERIFICATION_UNAVAILABLE");
    } finally {
      delete process.env[otherVariable];
    }
    const forged = await t.as.post(path, { environment: "sandbox", provider: "complyance" });
    expect(forged.status, forged.text).toBe(400);
    await h.sql("UPDATE invoices SET einvoice_provider = 'complyance' WHERE id = $1", [inv.id]);
    expect((await t.as.post(path, { environment: "sandbox" })).status).toBe(503);
    await h.sql("UPDATE invoices SET einvoice_provider = 'acube' WHERE id = $1", [inv.id]);
    expect(fake.requests).toBe(readsBefore);

    fake.outboundOwnerTin = "1007654321";
    const wrongSeller = await t.as.post(path, { environment: "sandbox" });
    expect(wrongSeller.status, wrongSeller.text).toBe(422);
    expect(wrongSeller.body.code).toBe("EINVOICE_ENVIRONMENT_PROOF_MISMATCH");
    fake.outboundOwnerTin = TIN;
    const trackedId = held.id;
    held.id = documentUuid();
    const wrongId = await t.as.post(path, { environment: "sandbox" });
    expect(wrongId.status, wrongId.text).toBe(422);
    expect(wrongId.body.code).toBe("EINVOICE_ENVIRONMENT_PROOF_MISMATCH");
    held.id = trackedId;
    const source = held.xml;
    held.xml += " ";
    const wrongBytes = await t.as.post(path, { environment: "sandbox" });
    expect(wrongBytes.status, wrongBytes.text).toBe(422);
    held.xml = source;

    let sourceStarted!: () => void;
    let releaseSource!: () => void;
    const entered = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });
    fake.beforeSourceRead = async () => {
      sourceStarted();
      await release;
    };
    const stale = t.as.post(path, { environment: "sandbox" });
    await entered;
    try {
      await h.sql("UPDATE invoices SET einvoice_provider_message_id = $2 WHERE id = $1", [
        inv.id,
        documentUuid(),
      ]);
    } finally {
      releaseSource();
    }
    expect((await stale).status).toBe(422);
    const [unpinned] = await h.sql(
      "SELECT validation->'submission'->>'environment' AS environment FROM einvoice_documents WHERE invoice_id = $1",
      [inv.id]
    );
    expect(unpinned.environment).toBeNull();
    await h.sql("UPDATE invoices SET einvoice_provider_message_id = $2 WHERE id = $1", [
      inv.id,
      trackedId,
    ]);

    const duplicate = await issuedInvoice(t);
    await h.sql(
      "INSERT INTO einvoice_documents (company_id, invoice_id, status, provider, provider_message_id, validation) VALUES ($1,$2,'submitted','acube',$3, '{\"submission\":{\"environment\":\"sandbox\"}}')",
      [t.company.id, duplicate.id, trackedId]
    );
    expect((await t.as.post(path, { environment: "sandbox" })).status).toBe(422);
    await h.sql("DELETE FROM einvoice_documents WHERE invoice_id = $1", [duplicate.id]);

    // The older document row can also be the only record of its tracking reference.
    await h.sql(
      "UPDATE invoices SET einvoice_provider = NULL, einvoice_provider_message_id = NULL WHERE id = $1",
      [inv.id]
    );
    expect(await statusOf(t, inv.id)).toMatchObject({
      transmission: {
        providerDocumentId: trackedId,
        environmentVerification: { provider: "acube", environments: ["sandbox"] },
      },
    });

    const event = await webhook(t, {
      eventId: crypto.randomUUID(),
      eventType: "invoice.outbound",
      documentId: held.id,
      status: "accepted",
    });
    expect(event.status, event.text).toBe(200);
    await h.sql(
      "UPDATE einvoice_provider_events SET attempts = 2 WHERE company_id = $1 AND event_type = 'document.delivered'",
      [t.company.id]
    );
    await runProviderEvents({ companyId: t.company.id });
    const [ignored] = await h.sql(
      "SELECT status FROM einvoice_provider_events WHERE company_id = $1 AND event_type = 'document.delivered'",
      [t.company.id]
    );
    expect(ignored.status).toBe("ignored");

    const results = await Promise.all([
      t.as.post(path, { environment: "sandbox" }),
      t.as.post(path, { environment: "sandbox" }),
    ]);
    for (const response of results) {
      expect(response.status, response.text).toBe(200);
      expect(response.body).toEqual({ provider: "acube", environment: "sandbox", verified: true });
    }
    const afterProof = fake.requests;
    expect((await t.as.post(path, { environment: "sandbox" })).status).toBe(200);
    expect((await t.as.post(path, { environment: "production" })).status).toBe(409);
    expect(fake.requests).toBe(afterProof);
    const audits = await h.sql(
      "SELECT user_id FROM audit_logs WHERE resource_id = $1 AND action = 'invoice.einvoice_environment_verified'",
      [inv.id]
    );
    expect(audits).toEqual([{ user_id: t.user.id }]);
    const [mirrors] = await h.sql(
      "SELECT einvoice_provider, einvoice_provider_message_id FROM invoices WHERE id = $1",
      [inv.id]
    );
    expect(mirrors).toEqual({
      einvoice_provider: "acube",
      einvoice_provider_message_id: trackedId,
    });

    held.status = "delivered";
    expect((await runAcubePoll({ companyId: t.company.id })).refreshed).toBe(1);
    expect(await statusOf(t, inv.id)).toMatchObject({
      status: "submitted",
      transmission: { canRefresh: true, environmentVerification: null },
    });
    held.status = "accepted";
    expect((await runProviderEvents({ companyId: t.company.id })).processed).toBe(1);
    expect(await statusOf(t, inv.id)).toMatchObject({ status: "accepted" });
    expect(await runEInvoiceRetries()).toEqual({ attempted: 0, submitted: 0 });
    expect(fake.posts).toBe(1);
  });
});
