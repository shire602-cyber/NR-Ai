/**
 * R07-13 / R03-18: the configuration-driven ASP adapter against recorded
 * sandbox-shaped exchanges (tests/fixtures/pint-ae/asp/). Each test replays a
 * recording and asserts both the request we send and how the response is
 * normalised. No network.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpEInvoiceProvider, loadAspMapping } from "../../server/services/einvoice-provider-http";
import { getEInvoiceProvider } from "../../server/services/einvoice-provider";

const dir = path.join(__dirname, "..", "fixtures", "pint-ae", "asp");
type Interaction = {
  name: string;
  request: { method: string; path: string };
  response: { status: number; body: unknown };
};
const load = (f: string) =>
  JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { interactions: Interaction[] };

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function recordedFetch(recording: Interaction[], names: string[], base: string) {
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
    expect(init.method).toBe(next.request.method);
    expect(url).toBe(`${base}${next.request.path.replace(/^\/v1/, "")}`);
    return new Response(JSON.stringify(next.response.body), { status: next.response.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

const env = {
  EINVOICE_ASP_BASE_URL: "https://sandbox.asp.example/v1",
  EINVOICE_ASP_API_KEY: "sandbox-key",
  EINVOICE_ASP_ENV: "sandbox",
} as unknown as NodeJS.ProcessEnv;
const generic = load("generic-sandbox.json").interactions;
const submission = {
  invoiceId: "inv-1",
  invoiceNumber: "INV-2027-0001",
  uuid: "u-1",
  xml: "<Invoice/>",
};

describe("R07-13 generic ASP mapping (recorded sandbox)", () => {
  it("submits base64 PINT AE with bearer auth and tracks the ASP id", async () => {
    const { fetchImpl, sent } = recordedFetch(
      generic,
      ["submit-accepted"],
      env.EINVOICE_ASP_BASE_URL as string
    );
    const p = new HttpEInvoiceProvider(env, { fetch: fetchImpl });
    expect(p.environment).toBe("sandbox");
    const r = await p.submit(submission);
    expect(r).toMatchObject({ providerMessageId: "asp-doc-0001", status: "submitted" });
    expect(sent[0].headers.Authorization).toBe("Bearer sandbox-key");
    const body = JSON.parse(sent[0].body as string);
    expect(body).toMatchObject({
      invoiceNumber: "INV-2027-0001",
      uuid: "u-1",
      documentFormat: "PINT_AE",
    });
    expect(Buffer.from(body.document, "base64").toString("utf8")).toBe("<Invoice/>");
  });

  it("maps the FTA-reported status to cleared", async () => {
    const { fetchImpl } = recordedFetch(
      generic,
      ["status-cleared"],
      env.EINVOICE_ASP_BASE_URL as string
    );
    const r = await new HttpEInvoiceProvider(env, { fetch: fetchImpl }).getStatus("asp-doc-0001");
    expect(r).toMatchObject({ status: "cleared", detail: "Reported to FTA" });
  });

  it("captures structured rejection reasons", async () => {
    const { fetchImpl } = recordedFetch(
      generic,
      ["status-rejected"],
      env.EINVOICE_ASP_BASE_URL as string
    );
    const r = await new HttpEInvoiceProvider(env, { fetch: fetchImpl }).getStatus("asp-doc-0002");
    expect(r.status).toBe("rejected");
    expect(r.reasons).toEqual([
      { code: "ibr-132-ae", message: "Buyer TRN is not a valid TRN", field: "IBT-048" },
      { code: "BR-CO-15", message: "Invoice total with VAT mismatch", field: null },
    ]);
  });

  it("treats a 4xx as a business rejection and a 5xx as retryable", async () => {
    const rec = recordedFetch(
      generic,
      ["submit-validation-error", "submit-unavailable"],
      env.EINVOICE_ASP_BASE_URL as string
    );
    const p = new HttpEInvoiceProvider(env, { fetch: rec.fetchImpl });
    const rejected = await p.submit(submission);
    expect(rejected.status).toBe("rejected");
    expect(rejected.reasons?.[0]).toMatchObject({
      code: "ibr-143-ae",
      message: "Seller city missing",
    });
    const failed = await p.submit(submission);
    expect(failed.status).toBe("failed");
    expect(failed.detail).toBe("Service temporarily unavailable");
  });

  it("receives inbound documents (base64 decoded) and cancels", async () => {
    const rec = recordedFetch(generic, ["inbox", "cancel"], env.EINVOICE_ASP_BASE_URL as string);
    const p = new HttpEInvoiceProvider(env, { fetch: rec.fetchImpl });
    const items = await p.receive(new Date("2027-01-01T00:00:00.000Z"));
    expect(items).toEqual([
      {
        providerMessageId: "asp-in-0001",
        receivedAt: "2027-01-15T10:00:00Z",
        xml: '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
      },
    ]);
    expect((await p.cancel("asp-doc-0001", "issued in error")).status).toBe("cancelled");
    expect(JSON.parse(rec.sent[1].body as string)).toEqual({ reason: "issued in error" });
  });

  it("never claims success on a transport error", async () => {
    const p = new HttpEInvoiceProvider(env, {
      fetch: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    expect((await p.submit(submission)).status).toBe("failed");
    expect((await p.getStatus("x")).status).toBe("failed");
  });
});

describe("R07-13 a different ASP is configuration, not code", () => {
  const mappingFile = path.join(dir, "example-asp-mapping.json");
  const exEnv = {
    EINVOICE_ASP_BASE_URL: "https://uat.example-asp.ae",
    EINVOICE_ASP_API_KEY: "uat-key",
    EINVOICE_ASP_AUTH_SCHEME: "header",
    EINVOICE_ASP_KEY_HEADER: "X-Example-Key",
    EINVOICE_ASP_MAPPING_FILE: mappingFile,
  } as unknown as NodeJS.ProcessEnv;
  const rec = load("example-asp-sandbox.json").interactions;

  it("loads the mapping and exposes its capabilities", () => {
    const p = new HttpEInvoiceProvider(exEnv);
    expect(loadAspMapping(exEnv).name).toBe("example-asp");
    expect(p.name).toBe("http:example-asp");
    expect(p.capabilities).toEqual({
      submit: true,
      getStatus: true,
      receive: false,
      cancel: false,
    });
  });

  it("posts raw XML with the header key and maps its vocabulary", async () => {
    const r = recordedFetch(
      rec,
      ["submit", "state-acknowledged", "state-refused"],
      "https://uat.example-asp.ae"
    );
    const p = new HttpEInvoiceProvider(exEnv, { fetch: r.fetchImpl });
    expect(await p.submit(submission)).toMatchObject({
      providerMessageId: "EX-778899",
      status: "submitted",
    });
    expect(r.sent[0].headers["X-Example-Key"]).toBe("uat-key");
    expect(r.sent[0].headers["Content-Type"]).toBe("application/xml");
    expect(r.sent[0].body).toBe("<Invoice/>");
    expect(await p.getStatus("EX-778899")).toMatchObject({
      status: "cleared",
      detail: "TDD accepted",
    });
    const refused = await p.getStatus("EX-000001");
    expect(refused.status).toBe("rejected");
    expect(refused.reasons).toEqual([
      { code: "ibr-127-ae", message: "Due date missing", field: "/Invoice/cbc:DueDate" },
    ]);
  });

  it("is selected automatically when an ASP is configured", () => {
    expect(getEInvoiceProvider({ ...exEnv, NODE_ENV: "production" }).name).toBe("http:example-asp");
  });
});
