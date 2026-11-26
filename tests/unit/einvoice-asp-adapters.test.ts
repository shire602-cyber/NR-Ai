import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AcubeEInvoiceProvider,
  resetAcubeTokenCache,
} from "../../server/services/einvoice/providers/acube";
import { ComplyanceEInvoiceProvider } from "../../server/services/einvoice/providers/complyance";
import {
  unifyXmlRequest,
  ublToGets,
} from "../../server/services/einvoice/providers/complyance-gets";
import { mapAcubeDeliveryStatus } from "../../server/services/einvoice/tracks";
import { getEInvoiceProvider } from "../../server/services/einvoice-provider";

const XML = `<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID>INV-1</cbc:ID></Invoice>`;
const submission = {
  invoiceId: "i1",
  invoiceNumber: "INV-1",
  uuid: "u1",
  xml: XML,
  companyId: "11111111-1111-1111-1111-111111111111",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetAcubeTokenCache();
});

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
      } as any).name
    ).toBe("complyance");
  });

  it("refuses to construct without credentials", () => {
    expect(() => new AcubeEInvoiceProvider({} as any)).toThrow(/ACUBE_EMAIL and ACUBE_PASSWORD/);
    expect(() => new ComplyanceEInvoiceProvider({} as any)).toThrow(/COMPLYANCE_API_KEY/);
  });
});

describe("A-Cube status mapping", () => {
  it("maps in-flight states to queued or sending", () => {
    for (const s of ["new", "valid", "sending_queued"])
      expect(mapAcubeDeliveryStatus(s), s).toBe("queued");
    for (const s of ["sending_started", "processed", "sending_failed", "delivery_failed"])
      expect(mapAcubeDeliveryStatus(s), s).toBe("sending");
  });

  it("maps terminal states correctly", () => {
    for (const s of ["delivered", "accepted"])
      expect(mapAcubeDeliveryStatus(s), s).toBe("delivered");
    for (const s of ["rejected", "withdrawn"])
      expect(mapAcubeDeliveryStatus(s), s).toBe("rejected");
    for (const s of ["sending_error", "delivery_error", "action_required"])
      expect(mapAcubeDeliveryStatus(s), s).toBe("delivery_failed");
  });

  it("never treats an unknown status as delivered", () => {
    for (const s of ["", "received", "banana", undefined, null])
      expect(mapAcubeDeliveryStatus(s)).toBe("delivery_failed");
  });
});

describe("A-Cube adapter", () => {
  // env uses ACUBE_ENV (not ACUBE_ENVIRONMENT) per the new provider.
  const env = { ACUBE_EMAIL: "a@b.c", ACUBE_PASSWORD: "pw", ACUBE_ENV: "sandbox" } as any;

  it("logs in, posts raw XML to the sandbox and tracks the returned invoiceId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }))
      .mockResolvedValueOnce(jsonResponse(201, { invoiceId: "acube-1", status: "sending_queued" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new AcubeEInvoiceProvider(env).submit(submission);
    expect(result).toMatchObject({ providerMessageId: "acube-1", status: "submitted" });

    const [loginUrl, loginInit] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe("https://common.api.acubeapi.com/login");
    expect(JSON.parse(loginInit.body)).toEqual({
      email: "a@b.c",
      password: "pw",
      environment: "sandbox",
    });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe("https://ae-sandbox.api.acubeapi.com/invoices");
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
    const result = await new AcubeEInvoiceProvider(env).submit(submission);
    expect(result.providerMessageId).toBe("acube-2");
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer new");
  });

  it("reports validation violations as rejected and a missing legal entity as rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }))
      .mockResolvedValueOnce(
        jsonResponse(422, { violations: [{ propertyPath: "cbc:ID", message: "is required" }] })
      )
      .mockResolvedValueOnce(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);
    const p = new AcubeEInvoiceProvider(env);
    expect(await p.submit(submission)).toMatchObject({
      status: "rejected",
      detail: "is required",
    });
    const missing = await p.submit(submission);
    expect(missing.status).toBe("rejected");
    expect(missing.errorCode).toBe("ACUBE_LEGAL_ENTITY_NOT_FOUND");
  });

  it("routes credit notes to the credit-note endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }))
      .mockResolvedValueOnce(jsonResponse(201, { invoiceId: "cn-1", status: "new" }));
    vi.stubGlobal("fetch", fetchMock);
    await new AcubeEInvoiceProvider(env).submit({
      ...submission,
      xml: "<CreditNote xmlns='x'/>",
      documentType: "381",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://ae-sandbox.api.acubeapi.com/credit-notes");
  });

  it("uses the production host when configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { token: "jwt" }))
      .mockResolvedValueOnce(jsonResponse(200, { invoiceId: "acube-1", status: "delivered" }));
    vi.stubGlobal("fetch", fetchMock);
    // A-Cube "delivered" = recipient receipt only, not MLS; legacy status stays "submitted".
    const result = await new AcubeEInvoiceProvider({
      ...env,
      ACUBE_ENV: "production",
    }).getStatus("acube-1");
    expect(result.status).toBe("submitted");
    expect(fetchMock.mock.calls[1][0]).toBe("https://ae.api.acubeapi.com/invoices/acube-1");
  });
});

describe("Complyance XML request builder", () => {
  it("wraps our XML in a Unify envelope without the XML declaration", () => {
    const { documentType } = ublToGets(XML);
    const xml = unifyXmlRequest({
      xml: XML,
      environment: "sandbox",
      source: "a:v1",
      purpose: "mapping",
      documentType,
    });
    expect(xml).toContain("<purpose>mapping</purpose>");
    expect(xml).toContain("<base>tax_invoice</base>");
    expect(xml).toContain(
      '<payload><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">'
    );
    expect(xml.match(/<\?xml/g)).toHaveLength(1);

    const cnXml = "<CreditNote/>";
    const { documentType: cnType } = ublToGets(cnXml);
    const cn = unifyXmlRequest({
      xml: cnXml,
      environment: "sandbox",
      source: "a:v1",
      purpose: "invoicing",
      documentType: cnType,
    });
    expect(cn).toContain("<base>credit_note</base>");
  });
});

describe("Complyance adapter", () => {
  const env = {
    COMPLYANCE_API_KEY: "key",
    COMPLYANCE_SUBMIT_FORMAT: "xml",
  } as any;
  const companySource = { name: "client-a", version: "v1" };
  const sourceFor = vi.fn().mockResolvedValue(companySource);

  it("submits with the company source and tracks documentId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { documentId: "doc-1", message: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new ComplyanceEInvoiceProvider(env, { sourceFor }).submit(submission);
    expect(result).toMatchObject({ providerMessageId: "doc-1", status: "submitted" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://prod.gets.complyance.io/api/v3/unify");
    expect(init.headers.Authorization).toBe("Bearer key");
    expect(init.headers["Content-Type"]).toMatch(/^application\/xml/);
    expect(init.headers["User-Agent"]).toMatch(/^Muhasib-EInvoicing\//);
    expect(init.body).toContain("<source>client-a:v1</source>");
    expect(init.body).toContain("<environment>sandbox</environment>");
  });

  it("returns rejected when no source is configured for the company", async () => {
    const noSource = vi.fn().mockResolvedValue(null);
    const result = await new ComplyanceEInvoiceProvider(env, { sourceFor: noSource }).submit(
      submission
    );
    expect(result.status).toBe("rejected");
    expect(result.errorCode).toBe("COMPLYANCE_SOURCE_MISSING");
  });

  it("reports validation errors as rejected and mapping errors as rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(422, {
          documentId: "doc-3",
          documentNumber: "INV-1",
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
      );
    vi.stubGlobal("fetch", fetchMock);
    const p = new ComplyanceEInvoiceProvider(env, { sourceFor });
    expect(await p.submit(submission)).toMatchObject({
      providerMessageId: "doc-3",
      status: "rejected",
      detail: "Amount due missing",
    });
    expect(await p.submit(submission)).toMatchObject({
      status: "rejected",
      detail: "No mapping — no_mapping",
    });
  });

  it("flags a duplicate-number 422 without claiming a document id", async () => {
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
    const result = await new ComplyanceEInvoiceProvider(env, { sourceFor }).submit(submission);
    expect(result.status).toBe("rejected");
    expect(result.errorCode).toBe("COMPLYANCE_DUPLICATE_NUMBER");
    expect(result.providerMessageId).toBe("");
  });

  it("returns failed without an outbound identity reference", async () => {
    const p = new ComplyanceEInvoiceProvider(env, { sourceFor });
    const result = await p.getStatus("doc-1");
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("COMPLYANCE_UNAVAILABLE");
  });
});
