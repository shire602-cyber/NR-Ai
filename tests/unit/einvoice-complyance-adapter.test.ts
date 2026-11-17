/**
 * E2: Complyance adapter against the doc-derived contract fixtures
 * (tests/fixtures/pint-ae/asp/complyance/, see its README: to be re-recorded in sandbox).
 * Each test replays interactions in order and checks the request we send and the two-track
 * outcome we derive. No network.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ComplyanceEInvoiceProvider,
  complyanceLegalEntityStatus,
  mapComplyanceStatus,
  patchFromComplyance,
  readComplyanceConfig,
  type ComplyanceCompany,
} from "../../server/services/einvoice/providers/complyance";
import {
  ublToGets,
  unifyXmlRequest,
} from "../../server/services/einvoice/providers/complyance-gets";
import { aspConfigured, getEInvoiceProvider } from "../../server/services/einvoice-provider";
import { getCapability } from "../../shared/capabilities";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";
import { PINT_AE_FIXTURES, fixtureCompany } from "../fixtures/pint-ae/fixtures";

const dir = path.join(__dirname, "..", "fixtures", "pint-ae", "asp", "complyance");
type Interaction = {
  name: string;
  request: { method: string; path?: string; pathPrefix?: string };
  response: { status: number; body?: unknown; headers?: Record<string, string> };
};
const recording = (
  JSON.parse(fs.readFileSync(path.join(dir, "complyance-sandbox.json"), "utf8")) as {
    interactions: Interaction[];
  }
).interactions;

const BASE = "https://prod.gets.complyance.io";
const KEY = "cmp_sandbox_key_never_logged_0123456789";
const ENV = {
  EINVOICE_PROVIDER: "complyance",
  COMPLYANCE_API_KEY: KEY,
} as NodeJS.ProcessEnv;
const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const SOURCE = { name: `muhasib-${COMPANY_ID}`, version: "v1" };

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function replay(names: string[]) {
  const sent: Sent[] = [];
  const queue = names.map((n) => {
    const found = recording.find((i) => i.name === n);
    if (!found) throw new Error(`no recording ${n}`);
    return found;
  });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    sent.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    expect(init.method, next.name).toBe(next.request.method);
    if (next.request.path) expect(url, next.name).toBe(`${BASE}${next.request.path}`);
    if (next.request.pathPrefix) {
      expect(url.startsWith(`${BASE}${next.request.pathPrefix}`), `${next.name} ${url}`).toBe(true);
    }
    return new Response(JSON.stringify(next.response.body ?? null), {
      status: next.response.status,
      headers: { "content-type": "application/json", ...(next.response.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent, left: () => queue.length };
}

const xmlOf = (i: number) => {
  const f = PINT_AE_FIXTURES[i];
  return generateEInvoiceXML(f.invoice, f.lines, fixtureCompany, f.customer, f.opts).xml;
};

const submission = (xml = xmlOf(0), documentType = "380") => ({
  invoiceId: "inv-1",
  invoiceNumber: "INV-2027-0001",
  uuid: "19e2c9a3-b000-4fb0-9bd5-a9c4ebda2358",
  xml,
  documentType,
  companyId: COMPANY_ID,
});

function provider(names: string[], env: NodeJS.ProcessEnv = ENV) {
  const r = replay(names);
  const p = new ComplyanceEInvoiceProvider(env, {
    fetch: r.fetchImpl,
    sourceFor: async () => SOURCE,
  });
  return { p, ...r };
}

describe("E2 Complyance configuration", () => {
  it("is selected by EINVOICE_PROVIDER=complyance and needs the API key", () => {
    expect(aspConfigured({ EINVOICE_PROVIDER: "complyance" } as NodeJS.ProcessEnv)).toBe(false);
    expect(aspConfigured(ENV)).toBe(true);
    expect(() =>
      getEInvoiceProvider({ EINVOICE_PROVIDER: "complyance" } as NodeJS.ProcessEnv)
    ).toThrow(/COMPLYANCE_API_KEY/);
    const p = getEInvoiceProvider(ENV);
    expect(p).toBeInstanceOf(ComplyanceEInvoiceProvider);
    expect(p.environment).toBe("sandbox");
    expect(p.capabilities.cancel).toBe(false);
    expect(readComplyanceConfig({ ...ENV, COMPLYANCE_ENV: "production" }).environment).toBe(
      "production"
    );
    expect(readComplyanceConfig(ENV).baseUrl).toBe(BASE);
  });

  it("capability detection reports sandbox / live, never the key", () => {
    expect(getCapability("einvoicing_asp", ENV).status).toBe("sandbox");
    expect(getCapability("einvoicing_asp", { ...ENV, COMPLYANCE_ENV: "production" }).status).toBe(
      "live"
    );
    expect(getCapability("einvoicing_asp", { EINVOICE_PROVIDER: "complyance" }).status).toBe(
      "requires_external"
    );
    expect(JSON.stringify(getCapability("einvoicing_asp", ENV))).not.toContain(KEY);
  });
});

describe("E2 Complyance submit", () => {
  it("sends GETS JSON to Unify with the company's source, Bearer key, new-api and User-Agent", async () => {
    const { p, sent, left } = provider(["submit_ok"]);
    const r = await p.submit(submission());
    expect(left()).toBe(0);
    expect(r).toMatchObject({
      providerMessageId: "01K5EXAMPLE00000000000142",
      delivery: "queued",
      reporting: "pending",
      status: "submitted",
      providerStatus: "submitted",
    });
    const req = sent[0];
    expect(req.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers["new-api"]).toBe("true");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(req.headers["User-Agent"]).toMatch(/\//);
    const body = JSON.parse(req.body!);
    expect(body).toMatchObject({
      country: "AE",
      environment: "sandbox",
      purpose: "invoicing",
      source: `${SOURCE.name}:v1`,
      documentType: { base: "tax_invoice", modifiers: [] },
    });
    expect(body.payload.header).toMatchObject({
      documentNumber: "INV-2027-0001",
      uuid: expect.any(String),
      issueDate: "2027-01-15",
      currency: "AED",
    });
    expect(body.payload.parties.seller).toMatchObject({
      peppolId: "1001234567",
      taxIds: [{ type: "VAT", value: "100123456700003" }],
      registrationNumbers: [{ type: "TL", value: "CN-1234567" }],
    });
    expect(body.payload.extensions).toMatchObject({
      peppol_seller_peppolIdScheme: "0235",
      ae_seller_authorityName: "Dubai Department of Economy and Tourism",
    });
    expect(body.payload.totals).toMatchObject({
      totalAmountIncludingTax: 1774.5,
      amountDue: 1774.5,
    });
    expect(req.body).not.toContain(KEY);
  });

  it("maps a 422 to a rejection naming the GETS field and rule", async () => {
    const { p } = provider(["submit_validation_422"]);
    const r = await p.submit(submission());
    expect(r).toMatchObject({
      status: "rejected",
      delivery: "rejected",
      errorCode: "COMPLYANCE_VALIDATION",
    });
    expect(r.reasons?.[0]).toEqual({
      code: "IBR-015",
      message: "An Invoice MUST have the Amount due for payment (ibt-115).",
      field: "totals.amountDue",
    });
  });

  it("GETS-HEAD-010 (number already used) is a rejection that needs a person, never a retry", async () => {
    const { p } = provider(["submit_duplicate_422"]);
    const r = await p.submit(submission());
    expect(r).toMatchObject({
      status: "rejected",
      errorCode: "COMPLYANCE_DUPLICATE_NUMBER",
      providerMessageId: "",
    });
    expect(r.detail).toMatch(/COMPLIANT/);
  });

  it("412 mapping not ready, 401 and 429 are told apart", async () => {
    const a = await provider(["submit_mapping_412"]).p.submit(submission());
    expect(a).toMatchObject({ status: "rejected", errorCode: "COMPLYANCE_MAPPING_NOT_READY" });
    expect(a.reasons?.[0].code).toBe("required_scenarios_incomplete");
    const b = await provider(["submit_unauthorized_401"]).p.submit(submission());
    expect(b).toMatchObject({
      status: "failed",
      delivery: "delivery_failed",
      errorCode: "COMPLYANCE_AUTH_FAILED",
    });
    const c = await provider(["submit_rate_limited_429"]).p.submit(submission());
    expect(c).toMatchObject({ status: "failed", errorCode: "COMPLYANCE_RATE_LIMITED" });
  });

  it("a transport failure is ambiguous (retried; a stored document answers GETS-HEAD-010)", async () => {
    const p = new ComplyanceEInvoiceProvider(ENV, {
      fetch: (async () => {
        throw new TypeError("fetch failed: socket hang up");
      }) as unknown as typeof fetch,
      sourceFor: async () => SOURCE,
    });
    const r = await p.submit(submission());
    expect(r).toMatchObject({ status: "failed", errorCode: "TRANSPORT_ERROR" });
  });

  it("refuses to send without the company's Complyance source", async () => {
    const p = new ComplyanceEInvoiceProvider(ENV, {
      fetch: (async () => {
        throw new Error("must not be called");
      }) as unknown as typeof fetch,
      sourceFor: async () => null,
    });
    expect(await p.submit(submission())).toMatchObject({
      status: "rejected",
      errorCode: "COMPLYANCE_SOURCE_MISSING",
    });
  });

  it("COMPLYANCE_SUBMIT_FORMAT=xml sends our UBL inside a UnifyRequest envelope", async () => {
    const { p, sent } = provider(["submit_ok"], { ...ENV, COMPLYANCE_SUBMIT_FORMAT: "xml" });
    await p.submit(submission());
    expect(sent[0].headers["Content-Type"]).toMatch(/^application\/xml/);
    expect(sent[0].headers["new-api"]).toBeUndefined();
    expect(sent[0].body).toMatch(/^<\?xml[^>]+\?><UnifyRequest><country>AE<\/country>/);
    expect(sent[0].body).toContain(`<source>${SOURCE.name}:v1</source>`);
    expect(sent[0].body).toContain("<payload><Invoice ");
    expect(sent[0].body!.match(/<\?xml/g)).toHaveLength(1);
  });
});

describe("E2 Complyance status -> two tracks", () => {
  const cases: Array<[string, string, string, string, string | null]> = [
    ["status_submitted", "queued", "pending", "submitted", null],
    ["status_processing", "sending", "pending", "submitted", null],
    ["status_delivery_success", "delivered", "pending", "accepted", null],
    ["status_delivery_failed_retrying", "sending", "pending", "submitted", null],
    ["status_final_valid", "delivered", "reported", "cleared", null],
    [
      "status_final_invalid_fta",
      "delivered",
      "report_failed",
      "accepted",
      "EINVOICE_REPORT_FAILED",
    ],
    ["status_final_invalid_buyer", "rejected", "pending", "rejected", "COMPLYANCE_FINAL_INVALID"],
    ["status_rejected", "rejected", "pending", "rejected", "COMPLYANCE_VALIDATION"],
  ];
  for (const [name, delivery, reporting, legacy, code] of cases) {
    it(`${name} -> ${delivery} / ${reporting}`, async () => {
      const { p, sent } = provider([name]);
      const r = await p.getStatus("01K5EXAMPLE00000000000142");
      expect(r).toMatchObject({ delivery, reporting, status: legacy, errorCode: code });
      expect(sent[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    });
  }

  it("FTA rejection keeps the reason with its field path", async () => {
    const r = await provider(["status_final_invalid_fta"]).p.getStatus("01K5EXAMPLE00000000000142");
    expect(r.reasons?.[0]).toEqual({
      code: "FTA-MLS-RE",
      message: "The FTA rejected the tax data document.",
      field: "parties.buyer.taxIds",
    });
  });

  it("a failed poll says nothing about the document (transient code)", async () => {
    const r = await provider(["status_not_found"]).p.getStatus("01K5EXAMPLE00000000000142");
    expect(r).toMatchObject({ status: "failed", errorCode: "COMPLYANCE_UNAVAILABLE" });
  });

  it("unknown states never read as success", () => {
    expect(mapComplyanceStatus({ state: "teleported" })).toMatchObject({
      delivery: "delivery_failed",
      errorCode: "COMPLYANCE_UNKNOWN_STATE",
    });
    expect(mapComplyanceStatus({ state: "delivery_failed", isTerminal: true })).toMatchObject({
      delivery: "delivery_failed",
      errorCode: "COMPLYANCE_DELIVERY_FAILED",
    });
  });
});

describe("E2 Complyance inbound (purchases)", () => {
  it("lists purchases per company, then reads owner and XML from one GET", async () => {
    const { p, sent } = provider(["purchases_list", "purchase_get"]);
    const items = await p.listInbound({ legalEntityIds: ["66b9f0a1c2d3e4f567890123"] });
    expect(items).toEqual([
      expect.objectContaining({
        providerMessageId: "01JEXAMPLE0000000000000142",
        documentNumber: "AE-INV-005",
        legalEntityId: "66b9f0a1c2d3e4f567890123",
      }),
    ]);
    const q = new URL(sent[0].url).searchParams;
    expect(q.get("companyId")).toBe("66b9f0a1c2d3e4f567890123");
    expect(q.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No attribution in the payload: the buyer's Peppol id decides; XML comes from the same read.
    expect(await p.inboundOwner("01JEXAMPLE0000000000000142", {}, {})).toEqual({
      legalEntityId: null,
      tin: "1001234567",
    });
    expect(await p.fetchSource("01JEXAMPLE0000000000000142")).toMatch(/^<Invoice /);
    expect(sent).toHaveLength(2);
  });

  it("uses the webhook's attribution without a read", async () => {
    const { p, sent } = provider([]);
    expect(
      await p.inboundOwner("x", {}, { complyanceCompanyId: "66b9f0a1c2d3e4f567890123" })
    ).toEqual({ legalEntityId: "66b9f0a1c2d3e4f567890123", tin: null });
    expect(sent).toHaveLength(0);
  });
});

describe("E2 Complyance Connect onboarding", () => {
  it("creates the company with X-API-Key and reads readiness", async () => {
    const { p, sent } = provider(["connect_create_201"]);
    const c = await p.createCompany({
      sourceName: SOURCE.name,
      sourceVersion: "v1",
      tin: "1001234567",
      contactPersonEmail: "owner@pearl.example",
      branchName: "Dubai",
    });
    expect(sent[0].headers["X-API-Key"]).toBe(KEY);
    expect(sent[0].headers.Authorization).toBeUndefined();
    expect(JSON.parse(sent[0].body!)).toEqual({
      sourceName: SOURCE.name,
      sourceVersion: "v1",
      countryCode: "AE",
      tin: "1001234567",
      contactPersonEmail: "owner@pearl.example",
      branchName: "Dubai",
      platformEnvironment: "sandbox",
    });
    expect(complyanceLegalEntityStatus(c)).toBe("pending");
    const patch = patchFromComplyance(c);
    expect(patch).toMatchObject({
      legalEntityId: "66b9f0a1c2d3e4f567890123",
      status: "pending",
      peppolAddress: "0235:1001234567",
    });
    expect(patch.providerDetails).toMatchObject({
      sourceName: SOURCE.name,
      readyForInvoicing: false,
      mappingReadiness: { code: "CONNECT_MAPPING_INELIGIBLE" },
    });
  });

  it("ASP_LINKAGE_NOT_FOUND surfaces as its Connect code", async () => {
    const { p } = provider(["connect_asp_linkage_409"]);
    await expect(
      p.createCompany({
        sourceName: SOURCE.name,
        sourceVersion: "v1",
        tin: "1001234567",
        contactPersonEmail: "owner@pearl.example",
        branchName: "Dubai",
      })
    ).rejects.toMatchObject({ code: "ASP_LINKAGE_NOT_FOUND", status: 409 });
  });

  it("a listed ready source is active; an inactive one blocks", async () => {
    const { p } = provider(["connect_list_ready"]);
    const c = (await p.findCompany({ companyId: "66b9f0a1c2d3e4f567890123" })) as ComplyanceCompany;
    expect(complyanceLegalEntityStatus(c)).toBe("active");
    expect(complyanceLegalEntityStatus({ ...c, status: "inactive" })).toBe("inactive");
    expect(patchFromComplyance({ ...c, status: "inactive" }).peppolAddress).toBeNull();
  });
});

describe("E2 PINT AE UBL -> GETS", () => {
  const byName = (n: string) => PINT_AE_FIXTURES.findIndex((f) => f.name === n);

  it("credit note: base, preceding invoice, reason as GETS value", () => {
    const g = ublToGets(xmlOf(byName("credit note")));
    expect(g.documentType).toEqual({ base: "credit_note", modifiers: [] });
    expect(g.payload.header).toMatchObject({ referenceId: "INV-2027-0001" });
    expect(g.payload.extensions).toMatchObject({
      peppol_precedingInvoiceIssueDate: "2027-01-15",
      ae_creditNoteReasonCode: "CONSIDERATION_ALTERED",
    });
  });

  it("export, out of scope and reverse charge become document modifiers", () => {
    expect(ublToGets(xmlOf(byName("zero-rated export"))).documentType.modifiers).toContain(
      "export"
    );
    expect(ublToGets(xmlOf(byName("out of scope"))).documentType).toEqual({
      base: "tax_invoice",
      modifiers: ["out_of_scope"],
    });
    const rc = ublToGets(xmlOf(byName("reverse charge")));
    expect(rc.documentType.modifiers).toContain("reverse_charge");
    const line = (rc.payload.lineItems as Array<Record<string, unknown>>)[0];
    expect(line.extensions).toEqual({ ae_rcmType: "CRUDE_OR_REFINED_OIL" });
  });

  it("foreign currency carries the tax currency, rate and AED tax total", () => {
    const g = ublToGets(xmlOf(byName("foreign currency")));
    expect(g.payload.header).toMatchObject({ currency: "USD", taxCurrency: "AED" });
    expect((g.payload.header as Record<string, unknown>).exchangeRate).toEqual({ rate: 3.6725 });
    expect(
      (g.payload.extensions as Record<string, unknown>).peppol_totalTaxAmountInTaxCurrency
    ).toBe(183.63);
  });

  it("every PINT AE fixture maps (lines carry gross price, base quantity and tax)", () => {
    for (let i = 0; i < PINT_AE_FIXTURES.length; i++) {
      const g = ublToGets(xmlOf(i));
      const lines = g.payload.lineItems as Array<{
        price: Record<string, unknown>;
        taxCategory: string;
      }>;
      expect(lines.length, PINT_AE_FIXTURES[i].name).toBeGreaterThan(0);
      for (const l of lines) {
        expect(l.price.grossPrice).toBeTypeOf("number");
        expect(l.price.baseQuantity).toBeTypeOf("number");
        expect(l.taxCategory).toBeTruthy();
      }
    }
  });

  it("escapes the envelope and drops the inner XML declaration", () => {
    const out = unifyXmlRequest({
      environment: "sandbox",
      source: "a&b:v1",
      purpose: "validate",
      documentType: { base: "tax_invoice", modifiers: ["export"] },
      xml: '<?xml version="1.0"?><Invoice/>',
    });
    expect(out).toContain("<source>a&amp;b:v1</source>");
    expect(out).toContain("<modifiers><item>export</item></modifiers>");
    expect(out).toContain("<payload><Invoice/></payload>");
  });
});
