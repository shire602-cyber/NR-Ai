import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ACubeEInvoiceProvider,
  mapACubeStatus,
} from "../../server/services/einvoice-provider-acube";
import {
  ComplyanceEInvoiceProvider,
  buildUnifyXmlRequest,
  mapComplyanceState,
} from "../../server/services/einvoice-provider-complyance";
import { getEInvoiceProvider } from "../../server/services/einvoice-provider";

const XML = `<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID>INV-1</cbc:ID></Invoice>`;
const submission = {
  invoiceId: "i1",
  invoiceNumber: "INV-1",
  uuid: "u1",
  xml: XML,
  sellerTrn: "100000000000003",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("provider selection", () => {
  it("selects acube and complyance by name", () => {
    expect(
      getEInvoiceProvider({
        EINVOICE_PROVIDER: "acube",
        ACUBE_EMAIL: "a",
        ACUBE_PASSWORD: "b",
      } as any).name
    ).toBe("acube");
    expect(
      getEInvoiceProvider({
        EINVOICE_PROVIDER: "complyance",
        COMPLYANCE_API_KEY: "k",
        COMPLYANCE_SOURCE: "s:v1",
      } as any).name
    ).toBe("complyance");
  });

  it("refuses to construct without credentials", () => {
    expect(() => new ACubeEInvoiceProvider({} as any)).toThrow(/ACUBE_EMAIL and ACUBE_PASSWORD/);
    expect(() => new ComplyanceEInvoiceProvider({} as any)).toThrow(/COMPLYANCE_API_KEY/);
    expect(() => new ComplyanceEInvoiceProvider({ COMPLYANCE_API_KEY: "k" } as any)).toThrow(
      /COMPLYANCE_SOURCE/
    );
    expect(
      () =>
        new ComplyanceEInvoiceProvider({
          COMPLYANCE_API_KEY: "k",
          COMPLYANCE_SOURCE: "nocolon",
        } as any)
    ).toThrow(/name:version/);
  });
});

describe("A-Cube status mapping", () => {
  it("maps in-flight, delivered, rejected and error states", () => {
    for (const s of ["new", "valid", "sending_started", "sending_queued", "processed"]) {
      expect(mapACubeStatus(s), s).toBe("submitted");
    }
    expect(mapACubeStatus("delivered")).toBe("accepted");
    expect(mapACubeStatus("rejected")).toBe("rejected");
    expect(mapACubeStatus("action_required")).toBe("rejected");
    for (const s of [
      "sending_failed",
      "sending_error",
      "delivery_failed",
      "delivery_error",
      "withdrawn",
    ]) {
      expect(mapACubeStatus(s), s).toBe("failed");
    }
  });

  it("never treats an unknown status as accepted", () => {
    for (const s of ["", "received", "banana", undefined, null])
      expect(mapACubeStatus(s)).toBe("failed");
  });
});

describe("A-Cube adapter", () => {
  const env = { ACUBE_EMAIL: "a@b.c", ACUBE_PASSWORD: "pw", ACUBE_ENVIRONMENT: "sandbox" } as any;

  it("logs in, posts raw XML to the sandbox and tracks the returned invoiceId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }))
      .mockResolvedValueOnce(jsonResponse(201, { invoiceId: "acube-1", status: "sending_queued" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ACubeEInvoiceProvider(env).submit(submission);
    expect(result).toMatchObject({ providerMessageId: "acube-1", status: "submitted" });

    const [loginUrl, loginInit] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe("https://common.api.acubeapi.com/login");
    expect(JSON.parse(loginInit.body)).toEqual({
      email: "a@b.c",
      password: "pw",
      environment: "sandbox",
    });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe("https://ae-sandbox.api.acubeapi.com/invoices/outgoing");
    expect(sendInit.headers.Authorization).toBe("Bearer jwt");
    expect(sendInit.headers["Content-Type"]).toBe("application/xml");
    expect(sendInit.body).toBe(XML);
  });

  it("re-logs in once when the cached token is rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "old" }))
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { token: "new" }))
      .mockResolvedValueOnce(jsonResponse(201, { invoiceId: "acube-2", status: "new" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new ACubeEInvoiceProvider(env).submit(submission);
    expect(result.providerMessageId).toBe("acube-2");
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer new");
  });

  it("reports validation violations as rejected and a missing legal entity as failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }))
        .mockResolvedValueOnce(
          jsonResponse(422, { violations: [{ propertyPath: "cbc:ID", message: "is required" }] })
        )
        .mockResolvedValueOnce(jsonResponse(404, {}))
    );
    const p = new ACubeEInvoiceProvider(env);
    expect(await p.submit(submission)).toMatchObject({
      status: "rejected",
      detail: "cbc:ID: is required",
    });
    const missing = await p.submit(submission);
    expect(missing.status).toBe("failed");
    expect(missing.detail).toMatch(/EmaraTax onboarding/);
  });

  it("routes credit notes to the credit-note endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }))
      .mockResolvedValueOnce(jsonResponse(201, { invoiceId: "cn-1", status: "new" }));
    vi.stubGlobal("fetch", fetchMock);
    await new ACubeEInvoiceProvider(env).submit({ ...submission, xml: "<CreditNote xmlns='x'/>" });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://ae-sandbox.api.acubeapi.com/credit-notes/outgoing"
    );
  });

  it("uses the production host when configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }))
      .mockResolvedValueOnce(jsonResponse(200, { invoiceId: "acube-1", status: "delivered" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new ACubeEInvoiceProvider({
      ...env,
      ACUBE_ENVIRONMENT: "production",
    }).getStatus("acube-1");
    expect(result.status).toBe("accepted");
    expect(fetchMock.mock.calls[1][0]).toBe("https://ae.api.acubeapi.com/invoices/acube-1");
  });
});

describe("Complyance state mapping", () => {
  it("only final_valid counts as accepted; delivery_failed keeps polling", () => {
    expect(mapComplyanceState("final_valid")).toBe("accepted");
    for (const s of ["submitted", "processing", "delivery_success", "delivery_failed"]) {
      expect(mapComplyanceState(s), s).toBe("submitted");
    }
    expect(mapComplyanceState("final_invalid")).toBe("rejected");
    expect(mapComplyanceState("rejected")).toBe("rejected");
    expect(mapComplyanceState("banana")).toBe("failed");
  });
});

describe("Complyance adapter", () => {
  const env = {
    COMPLYANCE_API_KEY: "key",
    COMPLYANCE_SOURCE: "muhasib:v1",
    COMPLYANCE_SOURCES_BY_TRN: JSON.stringify({ "100000000000003": "client-a:v1" }),
  } as any;

  it("wraps our XML in a Unify envelope without the XML declaration", () => {
    const xml = buildUnifyXmlRequest({
      xml: XML,
      environment: "sandbox",
      source: "a:v1",
      purpose: "mapping",
    });
    expect(xml).toContain("<purpose>mapping</purpose>");
    expect(xml).toContain("<base>tax_invoice</base>");
    expect(xml).toContain(
      '<payload><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">'
    );
    expect(xml.match(/<\?xml/g)).toHaveLength(1);
    const cn = buildUnifyXmlRequest({
      xml: "<Invoice><cbc:InvoiceTypeCode>381</cbc:InvoiceTypeCode></Invoice>",
      environment: "sandbox",
      source: "a:v1",
      purpose: "invoicing",
    });
    expect(cn).toContain("<base>credit_note</base>");
  });

  it("submits with the seller's own source and tracks documentId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { documentId: "doc-1", message: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new ComplyanceEInvoiceProvider(env).submit(submission);
    expect(result).toMatchObject({ providerMessageId: "doc-1", status: "submitted" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://prod.gets.complyance.io/api/v3/unify");
    expect(init.headers.Authorization).toBe("Bearer key");
    expect(init.headers["Content-Type"]).toMatch(/^application\/xml/);
    expect(init.body).toContain("<source>client-a:v1</source>");
    expect(init.body).toContain("<environment>sandbox</environment>");
  });

  it("falls back to the default source for other sellers", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { documentId: "doc-2" }));
    vi.stubGlobal("fetch", fetchMock);
    await new ComplyanceEInvoiceProvider(env).submit({
      ...submission,
      sellerTrn: "999999999999999",
    });
    expect(fetchMock.mock.calls[0][1].body).toContain("<source>muhasib:v1</source>");
  });

  it("reports validation errors as rejected and config errors as failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(422, {
            documentId: "doc-3",
            errors: [
              { code: "IBR-015", getsPath: "totals.amountDue", message: "Amount due missing" },
            ],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse(412, {
            code: "failed_precondition",
            message: "No mapping",
            reason: "no_mapping",
          })
        )
    );
    const p = new ComplyanceEInvoiceProvider(env);
    expect(await p.submit(submission)).toMatchObject({
      providerMessageId: "doc-3",
      status: "rejected",
      detail: "IBR-015 · totals.amountDue · Amount due missing",
    });
    expect(await p.submit(submission)).toMatchObject({
      status: "failed",
      detail: "No mapping (no_mapping)",
    });
  });

  it("does not claim a fresh document on a duplicate-number 422", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(422, {
            errors: [{ code: "GETS-HEAD-010", message: "Already stored as COMPLIANT" }],
          })
        )
    );
    const result = await new ComplyanceEInvoiceProvider(env).submit(submission);
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/already has invoice INV-1/);
  });

  it("polls the sales document and maps its state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          data: { state: "final_valid", isTerminal: true, errors: [] },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new ComplyanceEInvoiceProvider(env).getStatus("doc-1");
    expect(result).toMatchObject({ status: "accepted", detail: null });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://prod.gets.complyance.io/api/v3/documents/doc-1?type=sales"
    );
  });
});
