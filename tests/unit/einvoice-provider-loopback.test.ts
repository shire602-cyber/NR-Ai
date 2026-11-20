import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  AcubeEInvoiceProvider,
  resetAcubeTokenCache,
} from "../../server/services/einvoice/providers/acube";
import { ComplyanceEInvoiceProvider } from "../../server/services/einvoice/providers/complyance";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";
import acubeContract from "../fixtures/pint-ae/asp/acube/acube-sandbox.json";
import complyanceContract from "../fixtures/pint-ae/asp/complyance/complyance-sandbox.json";
import { fixtureCompany, PINT_AE_FIXTURES } from "../fixtures/pint-ae/fixtures";

interface Exchange {
  method: string;
  path: string;
  status: number;
  body?: unknown;
  text?: string;
  contentType?: string;
  headers?: Record<string, string>;
  stall?: boolean;
}

function fixture(provider: "acube" | "complyance", name: string): Exchange {
  const data = (provider === "acube" ? acubeContract : complyanceContract).interactions.find(
    (entry) => entry.name === name
  );
  if (!data?.request.path) throw new Error(`No mock exchange for ${name}`);
  return { method: data.request.method, path: data.request.path, ...data.response };
}

let server: Server | undefined;
afterEach(async () => {
  resetAcubeTokenCache();
  if (!server) return;
  const current = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
    current.closeAllConnections();
  });
});

/** Serve only scripted responses, using a real listening socket and native fetch. */
async function loopback(exchanges: Exchange[]) {
  const seen: { method: string; path: string; headers: IncomingHttpHeaders; body: string }[] = [];
  const fixtureServer = createServer(async (req, res) => {
    const body: Buffer[] = [];
    for await (const chunk of req) body.push(chunk as Buffer);
    const next = exchanges[seen.length];
    seen.push({
      method: req.method ?? "",
      path: req.url ?? "",
      headers: req.headers,
      body: Buffer.concat(body).toString(),
    });
    if (!next || req.method !== next.method || req.url !== next.path) {
      res.writeHead(500).end("Unexpected mock request");
      return;
    }
    res.writeHead(next.status, {
      "content-type": next.contentType ?? "application/json",
      ...next.headers,
    });
    if (next.stall) {
      res.write("{");
      return;
    }
    res.end(next.text ?? (next.body === undefined ? undefined : JSON.stringify(next.body)));
  });
  server = fixtureServer;
  await new Promise<void>((resolve, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(0, "127.0.0.1", resolve);
  });
  const address = fixtureServer.address();
  if (!address || typeof address === "string") throw new Error("Loopback server did not bind");
  return { url: `http://127.0.0.1:${address.port}`, seen };
}

function acube(url: string, overrides: NodeJS.ProcessEnv = {}) {
  return new AcubeEInvoiceProvider({
    ACUBE_EMAIL: "loopback@example.test",
    ACUBE_PASSWORD: randomUUID(),
    ACUBE_LOGIN_URL: `${url}/login`,
    ACUBE_BASE_URL: url,
    ...overrides,
  });
}

function complyance(url: string, overrides: NodeJS.ProcessEnv = {}, sourceVersion = "v1") {
  return new ComplyanceEInvoiceProvider(
    { COMPLYANCE_API_KEY: randomUUID(), COMPLYANCE_BASE_URL: url, ...overrides },
    { sourceFor: async () => ({ name: "loopback-company", version: sourceVersion }) }
  );
}

const standard = PINT_AE_FIXTURES[0];
const built = generateEInvoiceXML(
  standard.invoice,
  standard.lines,
  fixtureCompany,
  standard.customer,
  standard.opts
);
const submission = {
  invoiceId: "local-invoice",
  companyId: "local-company",
  invoiceNumber: standard.invoice.number,
  uuid: built.uuid,
  xml: built.xml,
  documentType: built.documentType ?? undefined,
};
const ACUBE_ID = "01a0ab23-24d8-7787-bd01-883b1b089b00";
const COMPLYANCE_ID = "01K5EXAMPLE00000000000142";

describe("A-Cube over loopback HTTP", () => {
  it("submits UBL, confirms recipient receipt and acceptance separately, and records rejection", async () => {
    const loginToken = randomUUID();
    const { url, seen } = await loopback([
      { method: "POST", path: "/login", status: 200, body: { token: loginToken } },
      fixture("acube", "submit-invoice-201"),
      fixture("acube", "status-delivered"),
      fixture("acube", "status-accepted"),
      fixture("acube", "submit-invoice-422"),
    ]);
    const provider = acube(url);
    const handedOver = await provider.submit(submission);
    expect(handedOver).toMatchObject({
      status: "submitted",
      delivery: "sending",
      providerMessageId: ACUBE_ID,
    });
    expect(await provider.getStatus(ACUBE_ID)).toMatchObject({
      status: "submitted",
      delivery: "delivered",
    });
    expect(await provider.getStatus(ACUBE_ID)).toMatchObject({
      status: "accepted",
      delivery: "delivered",
      reporting: "pending",
    });
    expect(await provider.submit(submission)).toMatchObject({
      status: "rejected",
      errorCode: "ACUBE_VALIDATION",
      reasons: [expect.objectContaining({ code: "ibr-138-ae" })],
    });
    expect(seen).toHaveLength(5);
    expect(seen[1].headers.authorization === `Bearer ${loginToken}`).toBe(true);
    expect(seen[1].headers["content-type"]).toBe("application/xml");
    expect(seen[1].body).toBe(submission.xml);
  });

  it("reconciles across Hydra pages using exact UTF-8 XML including BOM, spaces and email text", async () => {
    const alternate = randomUUID();
    const email = "loopback@example.test";
    const xml = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n<Invoice><Contact>${email}</Contact></Invoice>\r\n`;
    const outgoing = fixture("acube", "list-outgoing");
    const pageTwo = outgoing.path.replace("page=1", "page=2");
    const record = (uuid: string) => ({
      uuid,
      status: "processed",
      invoiceNumber: submission.invoiceNumber,
      direction: "outgoing",
    });
    const { url, seen } = await loopback([
      { method: "POST", path: "/login", status: 200, body: { token: randomUUID() } },
      { ...outgoing, body: { member: [record(alternate)], view: { next: pageTwo } } },
      {
        method: "GET",
        path: `/invoices/${alternate}/source`,
        status: 200,
        text: `${xml} `,
        contentType: "application/xml",
      },
      {
        ...outgoing,
        path: pageTwo,
        body: { "hydra:member": [record(ACUBE_ID)], "hydra:view": {} },
      },
      {
        method: "GET",
        path: `/invoices/${ACUBE_ID}/source`,
        status: 200,
        text: xml,
        contentType: "application/xml",
      },
      {
        method: "GET",
        path: `/invoices/${ACUBE_ID}/source`,
        status: 200,
        text: xml,
        contentType: "application/xml",
      },
    ]);
    const provider = acube(url, { ACUBE_EMAIL: email });
    expect(await provider.lookupSubmission({ ...submission, xml })).toMatchObject({
      providerMessageId: ACUBE_ID,
      status: "submitted",
    });
    expect(await provider.fetchSource(ACUBE_ID)).toBe(xml);
    expect(seen[1].headers.accept).toBe("application/ld+json");
    expect(seen.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /login",
      `GET ${outgoing.path}`,
      `GET /invoices/${alternate}/source`,
      `GET ${pageTwo}`,
      `GET /invoices/${ACUBE_ID}/source`,
      `GET /invoices/${ACUBE_ID}/source`,
    ]);
  });

  it("reads plain inbound pages and retains the credit-note resource from a Hydra collection", async () => {
    const first = Array.from({ length: 30 }, () => ({ uuid: randomUUID(), direction: "incoming" }));
    const later = randomUUID();
    const credit = randomUUID();
    const invoices = fixture("acube", "list-incoming-invoices");
    const creditNotes = fixture("acube", "list-incoming-credit-notes");
    const { url } = await loopback([
      { method: "POST", path: "/login", status: 200, body: { token: randomUUID() } },
      { ...invoices, body: first },
      {
        ...invoices,
        path: invoices.path.replace("page=1", "page=2"),
        body: [first[29], { uuid: later, direction: "incoming" }],
      },
      {
        ...creditNotes,
        body: { member: [{ uuid: credit, direction: "incoming", documentTypeCode: 261 }] },
      },
      {
        method: "GET",
        path: `/credit-notes/${credit}/source`,
        status: 200,
        text: "<CreditNote/>",
        contentType: "application/xml",
      },
    ]);
    const provider = acube(url);
    const rows = await provider.listInbound();
    expect(rows).toHaveLength(32);
    expect(rows[30]).toMatchObject({ providerMessageId: later, documentCollection: "invoice" });
    expect(rows[31]).toMatchObject({
      providerMessageId: credit,
      documentCollection: "credit-note",
      documentType: "261",
    });
    expect(await provider.fetchSource(credit, rows[31])).toBe("<CreditNote/>");
  });

  it("fails closed if an outgoing collection repeats a page during reconciliation", async () => {
    const outgoing = fixture("acube", "list-outgoing");
    const next = outgoing.path.replace("page=1", "page=2");
    const item = {
      uuid: ACUBE_ID,
      status: "processed",
      direction: "outgoing",
      invoiceNumber: submission.invoiceNumber,
    };
    const { url } = await loopback([
      { method: "POST", path: "/login", status: 200, body: { token: randomUUID() } },
      { ...outgoing, body: { member: [item], view: { next } } },
      { method: "GET", path: `/invoices/${ACUBE_ID}/source`, status: 200, text: submission.xml },
      { ...outgoing, path: next, body: { member: [item], view: {} } },
    ]);
    await expect(acube(url).lookupSubmission(submission)).rejects.toMatchObject({
      code: "ACUBE_UNAVAILABLE",
    });
  });

  it("bounds a stalled login body and does not send an invoice without authenticating", async () => {
    const { url, seen } = await loopback([
      { method: "POST", path: "/login", status: 200, stall: true },
    ]);
    const result = await acube(url, { ACUBE_TIMEOUT_MS: "500" }).submit(submission);
    expect(result).toMatchObject({ status: "failed", errorCode: "ACUBE_AUTH_FAILED" });
    expect(seen.map(({ path }) => path)).toEqual(["/login"]);
  });

  it("reconciles a timed-out submit against the exact source instead of matching duplicate numbers", async () => {
    const otherId = randomUUID();
    const outgoing = fixture("acube", "list-outgoing");
    const { url, seen } = await loopback([
      { method: "POST", path: "/login", status: 200, body: { token: randomUUID() } },
      { ...fixture("acube", "submit-invoice-201"), stall: true },
      { ...outgoing, status: 503, body: { detail: "Outage" } },
      { ...outgoing, body: { "hydra:member": {} } },
      {
        ...outgoing,
        body: [
          {
            uuid: otherId,
            status: "delivered",
            invoiceNumber: submission.invoiceNumber,
            direction: "outgoing",
          },
          {
            uuid: ACUBE_ID,
            status: "valid",
            invoiceNumber: submission.invoiceNumber,
            direction: "outgoing",
          },
        ],
      },
      {
        method: "GET",
        path: `/invoices/${otherId}/source`,
        status: 200,
        text: "<Invoice/>",
        contentType: "application/xml",
      },
      {
        method: "GET",
        path: `/invoices/${ACUBE_ID}/source`,
        status: 200,
        text: submission.xml,
        contentType: "application/xml",
      },
    ]);
    const provider = acube(url, { ACUBE_TIMEOUT_MS: "500" });
    expect(await provider.submit(submission)).toMatchObject({
      status: "failed",
      errorCode: "TRANSPORT_ERROR",
    });
    await expect(provider.lookupSubmission(submission)).rejects.toMatchObject({
      code: "ACUBE_UNAVAILABLE",
    });
    await expect(provider.lookupSubmission(submission)).rejects.toMatchObject({
      code: "ACUBE_UNAVAILABLE",
    });
    expect(await provider.lookupSubmission(submission)).toMatchObject({
      providerMessageId: ACUBE_ID,
      status: "submitted",
    });
    expect(
      seen.filter(({ method, path }) => method === "POST" && path === "/invoices")
    ).toHaveLength(1);
  });

  it("keeps A-Cube login sessions apart across companies and password rotations", async () => {
    const tokens = [randomUUID(), randomUUID(), randomUUID()];
    const { url, seen } = await loopback(
      tokens.map((token) => ({
        method: "POST",
        path: "/login",
        status: 200,
        body: { token },
      }))
    );
    const password = randomUUID();
    const first = acube(url, { ACUBE_CREDENTIAL_SCOPE: "company-1", ACUBE_PASSWORD: password });
    const other = acube(url, { ACUBE_CREDENTIAL_SCOPE: "company-2", ACUBE_PASSWORD: password });
    const rotated = acube(url, { ACUBE_CREDENTIAL_SCOPE: "company-1" });
    expect(await first.token()).toBe(tokens[0]);
    expect(await first.token()).toBe(tokens[0]);
    expect(await other.token()).toBe(tokens[1]);
    expect(await rotated.token()).toBe(tokens[2]);
    expect(seen).toHaveLength(3);
  });

  it("pins scope to the A-Cube account, environment and configured routing", async () => {
    const url = "http://127.0.0.1";
    const auth = { ACUBE_PASSWORD: randomUUID() };
    const company = submission.companyId;
    const scope = await acube(url, auth).getSubmissionScope(company);
    expect(scope).toMatch(/^[0-9a-f]{64}$/);
    expect(await acube(url, auth).getSubmissionScope(company)).toBe(scope);
    expect(await acube(url, auth).getSubmissionScope("another-company")).not.toBe(scope);
    expect(
      await acube(url, { ...auth, ACUBE_ENV: "production" }).getSubmissionScope(company)
    ).not.toBe(scope);
    expect(
      await acube(url, { ...auth, ACUBE_INVOICE_SUBMIT_PATH: "/custom" }).getSubmissionScope(
        company
      )
    ).not.toBe(scope);
    expect(await acube(url).getSubmissionScope(company)).not.toBe(scope);
  });
});

describe("Complyance over loopback HTTP", () => {
  it("submits GETS for the company source and maps accepted and rejected statuses", async () => {
    const { url, seen } = await loopback([
      fixture("complyance", "submit_ok"),
      fixture("complyance", "status_delivery_success"),
      fixture("complyance", "status_final_valid"),
      fixture("complyance", "submit_validation_422"),
    ]);
    const credential = randomUUID();
    const provider = complyance(url, { COMPLYANCE_API_KEY: credential });
    expect(await provider.submit(submission)).toMatchObject({
      status: "submitted",
      providerMessageId: COMPLYANCE_ID,
    });
    expect(await provider.getStatus(COMPLYANCE_ID)).toMatchObject({ status: "accepted" });
    expect(await provider.getStatus(COMPLYANCE_ID)).toMatchObject({
      status: "cleared",
      reporting: "reported",
    });
    expect(await provider.submit(submission)).toMatchObject({
      status: "rejected",
      errorCode: "COMPLYANCE_VALIDATION",
    });
    expect(seen).toHaveLength(4);
    expect(seen[0].headers.authorization === `Bearer ${credential}`).toBe(true);
    expect(seen[0].headers["new-api"]).toBe("true");
    expect(JSON.parse(seen[0].body)).toMatchObject({
      country: "AE",
      environment: "sandbox",
      purpose: "invoicing",
      source: "loopback-company:v1",
      payload: { header: { documentNumber: submission.invoiceNumber, currency: "AED" } },
    });
    expect(seen[0].body.includes(credential)).toBe(false);
  });

  it("returns the documented duplicate outcome after an ambiguous timeout on the same request", async () => {
    const duplicate = fixture("complyance", "submit_duplicate_422");
    const { url, seen } = await loopback([{ ...duplicate, status: 200, stall: true }, duplicate]);
    const provider = complyance(url, { COMPLYANCE_TIMEOUT_MS: "500" });
    expect(await provider.submit(submission)).toMatchObject({
      status: "failed",
      errorCode: "TRANSPORT_ERROR",
    });
    expect(await provider.submit(submission)).toMatchObject({
      status: "rejected",
      errorCode: "COMPLYANCE_DUPLICATE_NUMBER",
      numberAlreadyHeld: true,
      providerMessageId: "",
    });
    expect(seen).toHaveLength(2);
    expect(seen[0].body).toBe(seen[1].body);
  });

  it("binds a retry to the credential and source used by the original company", async () => {
    const { url, seen } = await loopback([]);
    const config = { COMPLYANCE_API_KEY: randomUUID() };
    const original = complyance(url, config);
    const scope = await original.getSubmissionScope(submission.companyId);
    expect(scope).toMatch(/^[0-9a-f]{64}$/);
    expect(await complyance(url, config).getSubmissionScope(submission.companyId)).toBe(scope);
    expect(await complyance(url).getSubmissionScope(submission.companyId)).not.toBe(scope);
    expect(await complyance(url, config, "v2").getSubmissionScope(submission.companyId)).not.toBe(
      scope
    );
    expect(await original.getSubmissionScope("another-company")).not.toBe(scope);
    expect(
      await complyance(url, { ...config, COMPLYANCE_SUBMIT_FORMAT: "xml" }).getSubmissionScope(
        submission.companyId
      )
    ).not.toBe(scope);
    expect(
      await complyance(url, config, "v2").submit({
        ...submission,
        scopeFingerprint: scope ?? undefined,
      })
    ).toMatchObject({ status: "failed", errorCode: "COMPLYANCE_SOURCE_AMBIGUOUS" });
    expect(seen).toHaveLength(0);
  });

  it("uses the Complyance source read under the handoff lock", async () => {
    const { url, seen } = await loopback([fixture("complyance", "submit_ok")]);
    const provider = new ComplyanceEInvoiceProvider(
      { COMPLYANCE_API_KEY: randomUUID(), COMPLYANCE_BASE_URL: url },
      {
        sourceFor: async () => {
          throw new Error("unexpected source lookup outside the handoff lock");
        },
      }
    );
    const context = {
      legalEntity: { providerDetails: { sourceName: "locked-company", sourceVersion: "v2" } },
    };
    const scope = await provider.getSubmissionScope(submission.companyId, context);
    expect(scope).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await provider.submit({ ...submission, context, scopeFingerprint: scope ?? undefined })
    ).toMatchObject({ status: "submitted" });
    expect(JSON.parse(seen[0].body).source).toBe("locked-company:v2");
  });

  it("proves legacy tracked Complyance documents with the exact document ID, number and seller", async () => {
    const status = fixture("complyance", "status_final_valid");
    const data = {
      documentId: COMPLYANCE_ID,
      documentNumber: submission.invoiceNumber,
      environment: "sandbox",
      source: "loopback-company:v1",
      seller: { tin: "1001234567" },
    };
    const reply = (overrides: Record<string, unknown> = {}) => ({
      ...status,
      body: { success: true, data: { ...data, ...overrides } },
    });
    const { url, seen } = await loopback([
      reply(),
      reply({ documentId: "another-document" }),
      reply({ documentNumber: "other-invoice" }),
      reply({ source: "other-company:v1" }),
      reply({ environment: "production" }),
    ]);
    const provider = complyance(url);
    const identity = {
      documentNumber: submission.invoiceNumber,
      supplierTin: "1001234567",
      supplierTrn: null,
      legalEntityId: null,
      sourceName: "loopback-company",
    };
    expect(await provider.verifyOutboundDocument(COMPLYANCE_ID, identity)).toBe(true);
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(await provider.verifyOutboundDocument(COMPLYANCE_ID, identity)).toBe(false);
    }
    expect(seen.map(({ method }) => method)).toEqual(Array(5).fill("GET"));
  });
});

describe.each(["acube", "complyance"] as const)("%s outage and malformed responses", (name) => {
  it("does not forward a credential-bearing request to a redirect target", async () => {
    const acubeMode = name === "acube";
    const path = acubeMode ? "/login" : "/api/v3/unify";
    const { url, seen } = await loopback([
      { method: "POST", path, status: 307, headers: { location: "/redirect-target" } },
    ]);
    const provider = acubeMode ? acube(url) : complyance(url);
    expect(await provider.submit(submission)).toMatchObject({ status: "failed" });
    expect(seen.map((request) => request.path)).toEqual([path]);
  });

  it("never claims acceptance and redacts a credential echoed by the provider", async () => {
    const credential = randomUUID();
    const acubeMode = name === "acube";
    const submit = acubeMode
      ? fixture("acube", "submit-invoice-201")
      : fixture("complyance", "submit_ok");
    const poll = acubeMode
      ? fixture("acube", "status-delivered")
      : fixture("complyance", "status_final_valid");
    const outage = acubeMode ? "ACUBE_UNAVAILABLE" : "COMPLYANCE_UNAVAILABLE";
    const rateLimited = acubeMode ? "ACUBE_RATE_LIMITED" : "COMPLYANCE_RATE_LIMITED";
    const malformed = acubeMode ? "ACUBE_NO_DOCUMENT_ID" : "COMPLYANCE_NO_DOCUMENT_ID";
    const login: Exchange = {
      method: "POST",
      path: "/login",
      status: 200,
      body: { token: randomUUID() },
    };
    const { url, seen } = await loopback([
      ...(acubeMode ? [login] : []),
      { ...submit, status: 429, body: { detail: "Rate limit" } },
      { ...submit, status: 503, body: { description: `Echoed ${credential}` } },
      { ...submit, body: acubeMode ? { uuid: {}, status: "valid" } : { documentId: {} } },
      {
        ...submit,
        status: 422,
        body: { detail: `Echoed ${credential}`, message: `Echoed ${credential}` },
      },
      { ...poll, text: "not JSON" },
    ]);
    const provider = acubeMode
      ? acube(url, { ACUBE_PASSWORD: credential })
      : complyance(url, { COMPLYANCE_API_KEY: credential });
    expect(await provider.submit(submission)).toMatchObject({
      status: "failed",
      errorCode: rateLimited,
    });
    const unavailable = await provider.submit(submission);
    expect(unavailable).toMatchObject({ status: "failed", errorCode: outage });
    expect(JSON.stringify(unavailable).includes(credential)).toBe(false);
    expect(await provider.submit(submission)).toMatchObject({
      status: "failed",
      errorCode: malformed,
      providerMessageId: "",
    });
    const rejected = await provider.submit(submission);
    expect(rejected.status).toBe("rejected");
    expect(rejected.detail).toContain("[REDACTED]");
    expect(JSON.stringify(rejected).includes(credential)).toBe(false);
    expect(await provider.getStatus(acubeMode ? ACUBE_ID : COMPLYANCE_ID)).toMatchObject({
      status: "failed",
      errorCode: outage,
    });
    expect(seen).toHaveLength(acubeMode ? 6 : 5);
  });
});
