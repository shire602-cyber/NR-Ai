import { FAKE_PASSWORD } from "../fixtures/credentials/fake-credentials";
/**
 * A-Cube adapter against a real local HTTP server (tests/fixtures/pint-ae/asp/acube/mock-server.ts).
 *
 * Unlike einvoice-acube-adapter.test.ts (a fetch stub replaying doc-derived fixtures) this goes
 * through the real fetch path: sockets, headers, bodies, AbortSignal timeouts. The adapter is
 * pointed at the mock with ACUBE_BASE_URL / ACUBE_LOGIN_URL / ACUBE_TIMEOUT_MS only.
 *
 * The mock mirrors only what A-Cube documents. Idempotency-key, duplicate-POST, 409/429/5xx
 * semantics are NOT documented, so nothing here asserts A-Cube-side behaviour for them: the tests
 * prove OUR side (stable UBL id, one POST per document, look up the outgoing collection before
 * any re-POST).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AcubeEInvoiceProvider,
  resetAcubeTokenCache,
} from "../../server/services/einvoice/providers/acube";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";
import { PINT_AE_FIXTURES, fixtureCompany } from "../fixtures/pint-ae/fixtures";
import {
  problem,
  startAcubeMock,
  violationsBody,
  type AcubeMock,
} from "../fixtures/pint-ae/asp/acube/mock-server";

let mock: AcubeMock;
beforeEach(async () => {
  resetAcubeTokenCache();
  mock = await startAcubeMock();
});
afterEach(async () => {
  await mock.close();
  resetAcubeTokenCache();
});

const env = (extra: Record<string, string> = {}) =>
  ({
    EINVOICE_PROVIDER: "acube",
    ACUBE_ENV: "sandbox",
    ACUBE_EMAIL: "sandbox@example.test",
    ACUBE_PASSWORD: FAKE_PASSWORD,
    ACUBE_BASE_URL: mock.baseUrl,
    ACUBE_LOGIN_URL: mock.loginUrl,
    ACUBE_TIMEOUT_MS: "5000",
    ...extra,
  }) as NodeJS.ProcessEnv;

function documentFor(name: string) {
  const f = PINT_AE_FIXTURES.find((x) => x.name === name)!;
  const built = generateEInvoiceXML(f.invoice, f.lines, fixtureCompany, f.customer, f.opts);
  return {
    invoiceId: f.invoice.id,
    invoiceNumber: f.invoice.number,
    uuid: built.uuid,
    xml: built.xml,
    documentType: built.documentType ?? undefined,
  };
}

describe("A-Cube mock server: happy path (invoice)", () => {
  it("logs in once, POSTs application/xml with a Bearer token, then tracks delivered -> accepted", async () => {
    const provider = new AcubeEInvoiceProvider(env());
    const doc = documentFor("standard");

    const sent = await provider.submit(doc);
    expect(mock.logins()).toBe(1);
    const [post] = mock.posts();
    expect(post.path).toBe("/invoices");
    expect(post.headers["content-type"]).toBe("application/xml");
    expect(post.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(post.body).toBe(doc.xml);
    // The login body carries the environment and the credentials, and nothing else.
    const login = mock.requests.find((r) => r.path === "/login")!;
    expect(JSON.parse(login.body)).toEqual({
      email: "sandbox@example.test",
      password: FAKE_PASSWORD,
      environment: "sandbox",
    });

    // 201 {status: processed} = handed over to Peppol: still in flight, reporting pending.
    const uuid = [...mock.documents.keys()][0];
    expect(sent).toMatchObject({
      providerMessageId: uuid,
      providerStatus: "processed",
      delivery: "sending",
      reporting: "pending",
    });

    mock.setStatus(uuid, "delivered");
    const delivered = await provider.getStatus(uuid, { documentType: "380" });
    expect(delivered).toMatchObject({
      providerMessageId: uuid,
      providerStatus: "delivered",
      delivery: "delivered",
    });
    mock.setStatus(uuid, "accepted");
    const accepted = await provider.getStatus(uuid, { documentType: "380" });
    expect(accepted).toMatchObject({ providerStatus: "accepted", delivery: "delivered" });

    expect(mock.logins()).toBe(1); // the 24 h token was reused for all three calls
    expect(mock.requests.filter((r) => r.method === "GET").map((r) => r.path)).toEqual([
      `/invoices/${uuid}`,
      `/invoices/${uuid}`,
    ]);
  });
});

describe("A-Cube mock server: rejections", () => {
  it("maps a 422 violations[] body to a rejection and keeps field, rule and message", async () => {
    mock.script.push({
      type: "reply",
      status: 422,
      contentType: "application/problem+json",
      body: violationsBody([
        {
          propertyPath: "AccountingCustomerParty/Party/PartyTaxScheme/CompanyID",
          message: "Buyer TRN must be 15 digits",
          code: "ibr-138-ae",
          hint: "Check the buyer's TRN",
        },
        { propertyPath: "InvoiceLine[1]/Price", message: "Price is required", code: "ibr-lne-01" },
      ]),
    });
    const res = await new AcubeEInvoiceProvider(env()).submit(documentFor("standard"));
    expect(res).toMatchObject({
      status: "rejected",
      delivery: "rejected",
      errorCode: "ACUBE_VALIDATION",
      providerMessageId: "",
    });
    expect(res.reasons).toEqual([
      {
        code: "ibr-138-ae",
        message: "Buyer TRN must be 15 digits (Check the buyer's TRN)",
        field: "AccountingCustomerParty/Party/PartyTaxScheme/CompanyID",
      },
      { code: "ibr-lne-01", message: "Price is required", field: "InvoiceLine[1]/Price" },
    ]);
    expect(mock.posts()).toHaveLength(1); // a business rejection is never re-posted
  });

  it("maps 400 (format) and 404 (legal entity not found) to rejected with their own codes", async () => {
    mock.script.push(
      { type: "reply", status: 400, body: problem(400, "Bad request", "Malformed XML document") },
      { type: "reply", status: 404, body: problem(404, "Not Found", "Legal entity not found") }
    );
    const provider = new AcubeEInvoiceProvider(env());
    const bad = await provider.submit(documentFor("standard"));
    expect(bad).toMatchObject({
      status: "rejected",
      errorCode: "ACUBE_BAD_REQUEST",
      reasons: [{ code: "ACUBE_VALIDATION", message: "Malformed XML document", field: null }],
    });
    const missing = await provider.submit(documentFor("standard"));
    expect(missing).toMatchObject({
      status: "rejected",
      errorCode: "ACUBE_LEGAL_ENTITY_NOT_FOUND",
      reasons: [{ message: "Legal entity not found" }],
    });
  });
});

describe("A-Cube mock server: timeouts, retries and reconciliation", () => {
  it("returns a retryable TRANSPORT_ERROR when the server stalls past ACUBE_TIMEOUT_MS", async () => {
    mock.script.push({ type: "stall" });
    const provider = new AcubeEInvoiceProvider(env({ ACUBE_TIMEOUT_MS: "300" }));
    const started = Date.now();
    const first = await provider.submit(documentFor("standard"));
    expect(Date.now() - started).toBeLessThan(4000);
    expect(first).toMatchObject({
      status: "failed",
      delivery: "delivery_failed",
      errorCode: "TRANSPORT_ERROR",
      providerMessageId: "",
    });
    // The next attempt (the document was never created) succeeds.
    const second = await provider.submit(documentFor("standard"));
    expect(second.providerMessageId).not.toBe("");
    expect(second.errorCode ?? null).toBeNull();
  });

  it.each([
    [503, "ACUBE_UNAVAILABLE"],
    [429, "ACUBE_RATE_LIMITED"],
  ])("treats HTTP %i as retryable (%s) and a later attempt succeeds", async (status, code) => {
    mock.script.push({ type: "reply", status, body: problem(status, "Try later", "busy") });
    const provider = new AcubeEInvoiceProvider(env());
    const first = await provider.submit(documentFor("standard"));
    expect(first).toMatchObject({ status: "failed", delivery: "delivery_failed", errorCode: code });
    const second = await provider.submit(documentFor("standard"));
    expect(second.providerMessageId).toBe([...mock.documents.keys()][0]);
  });

  it("after a lost response, searches the outgoing collection and finds the earlier document (no second POST)", async () => {
    mock.script.push({ type: "lost" }); // A-Cube stored it, the 201 never arrived
    const provider = new AcubeEInvoiceProvider(env({ ACUBE_TIMEOUT_MS: "300" }));
    const doc = documentFor("standard");
    const lost = await provider.submit(doc);
    expect(lost).toMatchObject({ errorCode: "TRANSPORT_ERROR", providerMessageId: "" });
    expect(mock.posts()).toHaveLength(1);
    expect(mock.documents.size).toBe(1);

    const found = await provider.lookupSubmission(doc);
    expect(found).toMatchObject({
      providerMessageId: [...mock.documents.keys()][0],
      providerStatus: "processed",
      delivery: "sending",
    });
    // The search is a read of the outgoing collection plus the stored source XML.
    const reads = mock.requests.filter((r) => r.method === "GET").map((r) => r.path + r.search);
    expect(reads[0]).toMatch(/^\/invoices\?direction=outgoing&itemsPerPage=\d+&page=1$/);
    expect(reads[1]).toMatch(/^\/invoices\/[^/]+\/source$/);
    expect(mock.posts()).toHaveLength(1); // still one POST
    expect(mock.documents.size).toBe(1);
  });

  it("finds nothing when the stalled request never created a document (caller decides what next)", async () => {
    mock.script.push({ type: "stall" });
    const provider = new AcubeEInvoiceProvider(env({ ACUBE_TIMEOUT_MS: "300" }));
    const doc = documentFor("standard");
    await provider.submit(doc);
    expect(await provider.lookupSubmission(doc)).toBeNull();
    expect(mock.posts()).toHaveLength(1);
  });

  it("on a 401 logs in again once and retries the same request", async () => {
    const provider = new AcubeEInvoiceProvider(env());
    await provider.token(); // first login
    expect(mock.logins()).toBe(1);
    mock.expireTokens(); // A-Cube rotated/expired the JWT
    const res = await provider.submit(documentFor("standard"));
    expect(mock.logins()).toBe(2);
    const attempts = mock.posts();
    expect(attempts).toHaveLength(2); // the 401 and the retry
    expect(attempts[0].headers.authorization).not.toBe(attempts[1].headers.authorization);
    expect(mock.documents.size).toBe(1); // 401 stored nothing, so one document
    expect(res.providerMessageId).toBe([...mock.documents.keys()][0]);
  });

  it("reports a refused login as ACUBE_AUTH_FAILED without posting anything", async () => {
    mock.failLogins(401);
    const res = await new AcubeEInvoiceProvider(env()).submit(documentFor("standard"));
    expect(res).toMatchObject({ errorCode: "ACUBE_AUTH_FAILED", delivery: "delivery_failed" });
    expect(mock.logins()).toBe(1);
    expect(mock.posts()).toHaveLength(0);
  });
});

describe("A-Cube mock server: credit note", () => {
  it("posts a 381 to /credit-notes, references the original invoice and polls /credit-notes/{uuid}", async () => {
    const provider = new AcubeEInvoiceProvider(env());
    const credit = documentFor("credit note");
    expect(credit.documentType).toBe("381");
    // The credit note names the invoice it corrects.
    expect(credit.xml).toMatch(
      /<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>INV-2027-0001<\/cbc:ID>/
    );

    const res = await provider.submit(credit);
    const [post] = mock.posts();
    expect(post.path).toBe("/credit-notes");
    expect(post.headers["content-type"]).toBe("application/xml");
    const uuid = [...mock.documents.keys()][0];
    expect(mock.documents.get(uuid)?.kind).toBe("credit-notes");
    expect(res).toMatchObject({ providerMessageId: uuid, delivery: "sending" });

    mock.setStatus(uuid, "accepted");
    const status = await provider.getStatus(uuid, { documentType: "381" });
    expect(status).toMatchObject({ providerStatus: "accepted", delivery: "delivered" });
    const gets = mock.requests.filter((r) => r.method === "GET").map((r) => r.path);
    expect(gets).toEqual([`/credit-notes/${uuid}`]);
    expect(mock.requests.some((r) => r.path.startsWith("/invoices"))).toBe(false);
  });

  it("reconciles a lost credit-note response through the credit-notes collection", async () => {
    mock.script.push({ type: "lost" });
    const provider = new AcubeEInvoiceProvider(env({ ACUBE_TIMEOUT_MS: "300" }));
    const credit = documentFor("credit note");
    await provider.submit(credit);
    const found = await provider.lookupSubmission(credit);
    expect(found?.providerMessageId).toBe([...mock.documents.keys()][0]);
    expect(
      mock.requests.filter((r) => r.method === "GET").map((r) => r.path.split("?")[0])
    ).toEqual(["/credit-notes", `/credit-notes/${found?.providerMessageId}/source`]);
    expect(mock.posts()).toHaveLength(1);
  });
});
