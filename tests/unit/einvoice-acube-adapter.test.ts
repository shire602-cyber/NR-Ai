/**
 * E1: A-Cube adapter against the doc-derived contract fixtures
 * (tests/fixtures/pint-ae/asp/acube/, see its README: to be re-recorded in sandbox).
 * Each test replays interactions in order and checks the request we send and the two-track
 * outcome we derive. No network.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AcubeEInvoiceProvider,
  acubeViolations,
  jwtExpiry,
  readAcubeConfig,
  resetAcubeTokenCache,
} from "../../server/services/einvoice/providers/acube";
import { aspConfigured, getEInvoiceProvider } from "../../server/services/einvoice-provider";
import { getCapability } from "../../shared/capabilities";

const dir = path.join(__dirname, "..", "fixtures", "pint-ae", "asp", "acube");
type Interaction = {
  name: string;
  request: { method: string; path?: string; url?: string; contentType?: string };
  response: { status: number; body?: unknown; text?: string; contentType?: string };
};
const recording = (
  JSON.parse(fs.readFileSync(path.join(dir, "acube-sandbox.json"), "utf8")) as {
    interactions: Interaction[];
  }
).interactions;

const BASE = "https://ae-sandbox.api.acubeapi.com";
const ENV = {
  EINVOICE_PROVIDER: "acube",
  ACUBE_EMAIL: "sandbox@example.test",
  ACUBE_PASSWORD: "s3cret-sandbox-password",
} as NodeJS.ProcessEnv;

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
    expect(url, next.name).toBe(next.request.url ?? `${BASE}${next.request.path}`);
    const body =
      next.response.text ?? (next.response.body === null ? "" : JSON.stringify(next.response.body));
    return new Response(next.response.status === 204 ? null : body, {
      status: next.response.status,
      headers: { "content-type": next.response.contentType ?? "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent, left: () => queue.length };
}

const submission = (documentType = "380", number = "INV-2026-0001") => ({
  invoiceId: "inv-1",
  invoiceNumber: number,
  uuid: "19e2c9a3-b000-4fb0-9bd5-a9c4ebda2358",
  xml: "<Invoice/>",
  documentType,
});

// The recorded login JWT carries a fixed exp (2026-11-17T12:00Z). Pin the clock to just after its
// iat so token-cache behaviour does not depend on the real date (only Date is faked; timers stay real).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:05:00Z"));
  resetAcubeTokenCache();
});
afterEach(() => {
  vi.useRealTimers();
  resetAcubeTokenCache();
});

describe("E1 A-Cube configuration and selection", () => {
  it("keeps the fixture request paths and resource UUIDs aligned with the published UAE OpenAPI", () => {
    const exchange = (name: string) => recording.find((item) => item.name === name);
    expect([
      exchange("submit-invoice-201")?.request.path,
      exchange("submit-credit-note-201")?.request.path,
      exchange("submit-invoice-201")?.response.body,
      exchange("submit-credit-note-201")?.response.body,
      exchange("status-delivered")?.response.body,
      exchange("list-outgoing")?.response.body,
      exchange("incoming-detail")?.response.body,
      exchange("legal-entity-reserve-201")?.response.body,
    ]).toEqual([
      "/invoices",
      "/credit-notes",
      expect.objectContaining({ uuid: "01a0ab23-24d8-7787-bd01-883b1b089b00" }),
      expect.objectContaining({ uuid: "01a0aec8-7f31-7b17-9122-26ded8285826" }),
      expect.objectContaining({ uuid: "01a0ab23-24d8-7787-bd01-883b1b089b00" }),
      [expect.objectContaining({ uuid: "01a0ab23-24d8-7787-bd01-883b1b089b00" })],
      expect.objectContaining({ uuid: "01a0c453-5398-728c-8b10-84dd471cd797" }),
      expect.objectContaining({ uuid: "64f50adc-1cd6-43e5-a627-437091a8a1d6" }),
    ]);
  });

  it("is selected by EINVOICE_PROVIDER=acube and defaults to the sandbox hosts and documented paths", () => {
    const cfg = readAcubeConfig(ENV);
    expect(cfg).toMatchObject({
      environment: "sandbox",
      baseUrl: BASE,
      loginUrl: "https://common.api.acubeapi.com/login",
      invoiceSubmitPath: "/invoices",
      creditNoteSubmitPath: "/credit-notes",
    });
    expect(readAcubeConfig({ ...ENV, ACUBE_ENV: "production" }).baseUrl).toBe(
      "https://ae.api.acubeapi.com"
    );
    expect(
      readAcubeConfig({
        ...ENV,
        ACUBE_INVOICE_SUBMIT_PATH: "custom/invoices",
        ACUBE_CREDIT_NOTE_SUBMIT_PATH: "/custom/credit-notes",
      })
    ).toMatchObject({
      invoiceSubmitPath: "/custom/invoices",
      creditNoteSubmitPath: "/custom/credit-notes",
    });
    const p = getEInvoiceProvider(ENV);
    expect(p).toBeInstanceOf(AcubeEInvoiceProvider);
    expect(p.capabilities.cancel).toBe(false); // void = credit note
    expect(aspConfigured(ENV)).toBe(true);
    expect(getCapability("einvoicing_asp", ENV).status).toBe("sandbox");
    expect(getCapability("einvoicing_asp", { ...ENV, ACUBE_ENV: "production" }).status).toBe(
      "live"
    );
  });

  it("answers EINVOICE_PROVIDER_NOT_CONFIGURED without credentials", () => {
    expect(() => getEInvoiceProvider({ EINVOICE_PROVIDER: "acube" })).toThrow(
      expect.objectContaining({ code: "EINVOICE_PROVIDER_NOT_CONFIGURED" })
    );
    expect(aspConfigured({ EINVOICE_PROVIDER: "acube" })).toBe(false);
    expect(getCapability("einvoicing_asp", { EINVOICE_PROVIDER: "acube" }).status).toBe(
      "requires_external"
    );
  });
});

describe("E1 A-Cube JWT login, cache and refresh", () => {
  it("logs in once, reuses the 24 h token, and sends it as Bearer", async () => {
    const r = replay(["login", "status-delivered", "status-accepted"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    await p.getStatus("01a0ab23-24d8-7787-bd01-883b1b089b00");
    await p.getStatus("01a0ab23-24d8-7787-bd01-883b1b089b00");
    expect(r.left()).toBe(0);
    expect(JSON.parse(r.sent[0].body as string)).toEqual({
      email: "sandbox@example.test",
      password: "s3cret-sandbox-password",
      environment: "sandbox",
    });
    const token = (recording.find((i) => i.name === "login")!.response.body as { token: string })
      .token;
    expect(r.sent[1].headers.Authorization).toBe(`Bearer ${token}`);
    expect(r.sent[2].headers.Authorization).toBe(`Bearer ${token}`);
    expect(jwtExpiry(token)).toBe(Date.parse("2026-11-17T12:00:00Z"));
  });

  it("refreshes the token an hour before it expires", async () => {
    const r = replay(["login", "login"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    const exp = Date.parse("2026-11-17T12:00:00Z");
    await p.token({ now: exp - 2 * 3600_000 });
    await p.token({ now: exp - 2 * 3600_000 + 1000 }); // cached
    expect(r.sent).toHaveLength(1);
    await p.token({ now: exp - 30 * 60_000 }); // inside the refresh margin
    expect(r.sent).toHaveLength(2);
  });

  it("retries once with a fresh login after a 401", async () => {
    const uuid = "01a0ab23-24d8-7787-bd01-883b1b089b00";
    const queue: Array<{ status: number; body: unknown }> = [
      { status: 200, body: { token: "a.e30.x" } },
      { status: 401, body: { message: "Expired JWT Token" } },
      { status: 200, body: { token: "b.e30.y" } },
      { status: 200, body: { invoiceId: uuid, status: "delivered" } },
    ];
    const auth: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      auth.push((init.headers as Record<string, string>).Authorization ?? "login");
      const next = queue.shift()!;
      return new Response(JSON.stringify(next.body), { status: next.status });
    }) as unknown as typeof fetch;
    const p = new AcubeEInvoiceProvider(ENV, { fetch: fetchImpl });
    const res = await p.getStatus(uuid);
    expect(res.delivery).toBe("delivered");
    expect(auth).toEqual(["login", "Bearer a.e30.x", "login", "Bearer b.e30.y"]);
  });

  it("reports a failed login as ACUBE_AUTH_FAILED without echoing the password", async () => {
    const r = replay(["login-unauthorized"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    const res = await p.submit(submission());
    expect(res).toMatchObject({ status: "failed", errorCode: "ACUBE_AUTH_FAILED" });
    expect(JSON.stringify(res)).not.toContain("s3cret-sandbox-password");
  });
});

describe("E1 A-Cube submit", () => {
  it("tracks the documented uuid in an A-Cube acceptance response", async () => {
    const uuid = "019ffedf-0461-7dd2-b20c-a0df95b2bfff";
    const provider = new AcubeEInvoiceProvider(ENV, {
      fetch: async (input) =>
        String(input).endsWith("/login")
          ? Response.json({ token: "t.e30.s" })
          : Response.json({ uuid, status: "valid" }, { status: 201 }),
    });
    expect(await provider.submit(submission())).toMatchObject({
      providerMessageId: uuid,
      status: "submitted",
    });
  });

  it("posts raw PINT AE XML to /invoices and returns handover with reporting pending", async () => {
    const r = replay(["login", "submit-invoice-201"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    const res = await p.submit(submission());
    expect(r.sent[1].headers["Content-Type"]).toBe("application/xml");
    expect(r.sent[1].body).toBe("<Invoice/>");
    expect(res).toMatchObject({
      providerMessageId: "01a0ab23-24d8-7787-bd01-883b1b089b00",
      status: "submitted",
      delivery: "sending",
      reporting: "pending",
      providerStatus: "processed",
    });
  });

  it("sends a credit note (381) to /credit-notes", async () => {
    const r = replay(["login", "submit-credit-note-201"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    const res = await p.submit(submission("381", "CN-2026-0001"));
    expect(res.providerMessageId).toBe("01a0aec8-7f31-7b17-9122-26ded8285826");
  });

  it("maps a 422 to a rejection with the named field and rule", async () => {
    const r = replay(["login", "submit-invoice-422"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    const res = await p.submit(submission());
    expect(res).toMatchObject({
      status: "rejected",
      delivery: "rejected",
      errorCode: "ACUBE_VALIDATION",
      providerMessageId: "",
    });
    expect(res.reasons).toEqual([
      {
        code: "ibr-138-ae",
        message: "Buyer TRN must be 15 digits (Use the buyer's VAT TRN as registered with the FTA)",
        field: "AccountingCustomerParty/Party/PartyTaxScheme/CompanyID",
      },
    ]);
    expect(acubeViolations({ detail: "Only detail" })).toEqual([
      { code: "ACUBE_VALIDATION", message: "Only detail", field: null },
    ]);
  });

  it("treats 404 as a business rejection (supplier not onboarded) and 503 as retryable", async () => {
    const a = replay(["login", "submit-invoice-404"]);
    const r404 = await new AcubeEInvoiceProvider(ENV, { fetch: a.fetchImpl }).submit(submission());
    expect(r404).toMatchObject({ status: "rejected", errorCode: "ACUBE_LEGAL_ENTITY_NOT_FOUND" });
    resetAcubeTokenCache();
    const b = replay(["login", "submit-invoice-503"]);
    const r503 = await new AcubeEInvoiceProvider(ENV, { fetch: b.fetchImpl }).submit(submission());
    expect(r503).toMatchObject({
      status: "failed",
      delivery: "delivery_failed",
      errorCode: "ACUBE_UNAVAILABLE",
    });
  });

  it("marks a transport failure TRANSPORT_ERROR so the retry looks the document up first", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ token: "t.e30.s" }), { status: 200 });
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const res = await new AcubeEInvoiceProvider(ENV, { fetch: fetchImpl }).submit(submission());
    expect(res).toMatchObject({ status: "failed", errorCode: "TRANSPORT_ERROR" });

    resetAcubeTokenCache();
    const r = replay(["login", "list-outgoing"]);
    const fetchWithSource: typeof fetch = (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/invoices/01a0ab23-24d8-7787-bd01-883b1b089b00/source") {
        return Promise.resolve(new Response(submission().xml));
      }
      return r.fetchImpl(input, init);
    };
    const found = await new AcubeEInvoiceProvider(ENV, { fetch: fetchWithSource }).lookupSubmission(
      submission()
    );
    expect(r.left()).toBe(0);
    expect(found).toMatchObject({
      providerMessageId: "01a0ab23-24d8-7787-bd01-883b1b089b00",
      delivery: "queued",
    });
  });
});

describe("E1 A-Cube status, reporting and inbound", () => {
  it("distinguishes C3 delivery receipt, MLS acceptance and the legacy delivery_error", async () => {
    const r = replay([
      "login",
      "status-sending-queued",
      "status-delivered",
      "status-accepted",
      "status-delivery-error",
    ]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    const id = "01a0ab23-24d8-7787-bd01-883b1b089b00";
    expect(await p.getStatus(id)).toMatchObject({ delivery: "queued", status: "submitted" });
    expect(await p.getStatus(id)).toMatchObject({ delivery: "delivered", status: "submitted" });
    expect(await p.getStatus(id)).toMatchObject({
      delivery: "delivered",
      status: "accepted",
      reporting: "pending",
    });
    expect(await p.getStatus(id)).toMatchObject({
      delivery: "delivery_failed",
      status: "failed",
      errorCode: "ACUBE_DELIVERY_FAILED",
      providerStatus: "delivery_error",
    });
  });

  it("tracks direct MLS acceptance without claiming FTA reporting from the TDD artifact", async () => {
    const r = replay(["login", "submit-invoice-201", "status-accepted"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    const id = "01a0ab23-24d8-7787-bd01-883b1b089b00";
    expect(await p.submit(submission())).toMatchObject({
      delivery: "sending",
      status: "submitted",
    });
    expect(await p.getStatus(id)).toMatchObject({
      delivery: "delivered",
      status: "accepted",
      reporting: "pending",
    });
    expect("getReportingStatus" in p).toBe(false);
    expect(r.left()).toBe(0);
  });

  it("lists incoming documents and fetches each one's source XML (two-step receive)", async () => {
    const r = replay(["login", "list-incoming-invoices", "list-incoming-credit-notes"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    expect(await p.listInbound()).toEqual([
      {
        providerMessageId: "01a0c453-5398-728c-8b10-84dd471cd797",
        documentCollection: "invoice",
        documentType: "380",
        documentNumber: "AE-INV-005",
        legalEntityId: "64f50adc-1cd6-43e5-a627-437091a8a1d6",
        ownerFiscalId: "1001234567",
      },
    ]);
  });

  it("reserves a TIN and reads the active legal entity", async () => {
    const r = replay(["login", "legal-entity-reserve-201", "legal-entity-active"]);
    const p = new AcubeEInvoiceProvider(ENV, { fetch: r.fetchImpl });
    const reserved = await p.reserveLegalEntity("1001234567");
    expect(JSON.parse(r.sent[1].body as string)).toEqual({ tin: "1001234567" });
    expect(reserved).toMatchObject({
      status: "RESERVED",
      legalEntityId: "64f50adc-1cd6-43e5-a627-437091a8a1d6",
    });
    const active = await p.getLegalEntity(reserved.legalEntityId);
    expect(active.status).toBe("Active");
    expect(active.enabledCapabilities?.map((c) => c.key)).toContain("billing.invoice");
  });

  it("has no cancellation: a sent invoice is corrected with a credit note", async () => {
    const p = new AcubeEInvoiceProvider(ENV, { fetch: (async () => new Response("")) as never });
    expect((await p.cancel("x")).status).toBe("failed");
  });
});
