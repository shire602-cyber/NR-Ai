/**
 * A-Cube duplicate-submit and lost-response proofs through the durable queue, with the REAL
 * adapter talking HTTP to the local mock (tests/fixtures/pint-ae/asp/acube/mock-server.ts).
 *
 * Idempotency here is client-side (A-Cube documents no idempotency header): one stable UBL id per
 * document, one queued snapshot, a lease so parallel workers cannot both post, and a search of the
 * outgoing collection by original source XML before anything that might be a re-POST.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AcubeEInvoiceProvider,
  resetAcubeTokenCache,
} from "../../server/services/einvoice/providers/acube";
import { recordTestAppointment } from "./einvoice-appointment-fixture";
import { startAcubeMock, type AcubeMock } from "../fixtures/pint-ae/asp/acube/mock-server";
import { useHarness } from "./harness";

// Generated per run so no credential-shaped literal sits in the source (secret scanners).
const MOCK_PASSWORD = randomUUID();

const h = useHarness();

let mock: AcubeMock;
beforeEach(async () => {
  resetAcubeTokenCache();
  mock = await startAcubeMock();
});
afterEach(async () => {
  await mock.close();
  resetAcubeTokenCache();
});

const provider = (timeoutMs = 5000) =>
  new AcubeEInvoiceProvider({
    EINVOICE_PROVIDER: "acube",
    ACUBE_ENV: "sandbox",
    ACUBE_EMAIL: "sandbox@example.test",
    ACUBE_PASSWORD: MOCK_PASSWORD,
    ACUBE_BASE_URL: mock.baseUrl,
    ACUBE_LOGIN_URL: mock.loginUrl,
    ACUBE_TIMEOUT_MS: String(timeoutMs),
  } as NodeJS.ProcessEnv);

async function linkedInvoice() {
  const tenant = await h.createTenant({
    companyColumns: {
      trn_vat_number: "100123456700003",
      legal_name: "Pearl Trading L.L.C.",
      address_street: "Office 1204, Al Saqr Tower",
      address_city: "Dubai",
      address_country: "AE",
      emirate: "dubai",
      trade_licence_no: "CN-1234567",
      trade_licence_authority: "Dubai Department of Economy and Tourism",
      einvoice_partner: "acube",
    },
  });
  const contact = await tenant.as.post(`/api/companies/${tenant.company.id}/customer-contacts`, {
    name: "Acme Gulf FZ-LLC",
    trnNumber: "100765432100003",
    address: "Building 7, Dubai Internet City",
    city: "Dubai",
    emirate: "dubai",
    country: "AE",
  });
  expect(contact.status, contact.text).toBeLessThan(300);
  const created = await tenant.as.post(`/api/companies/${tenant.company.id}/invoices`, {
    customerName: "Acme Gulf FZ-LLC",
    customerTrn: "100765432100003",
    contactId: contact.body.id,
    date: new Date().toISOString().slice(0, 10),
    paymentTerms: "net30",
    lines: [{ description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 5 }],
  });
  expect(created.status, created.text).toBe(200);
  const issued = await tenant.as.patch(`/api/invoices/${created.body.id}/status`, {
    status: "sent",
  });
  expect(issued.status, issued.text).toBe(200);
  await h.sql(
    "INSERT INTO einvoice_legal_entities (company_id, provider, environment, tin, status) VALUES ($1, 'acube', 'sandbox', '1001234567', 'active')",
    [tenant.company.id]
  );
  await recordTestAppointment(tenant, "acube");
  const { storage } = await import("../../server/storage");
  const company = (await storage.getCompany(tenant.company.id))!;
  const invoice = (await storage.getInvoice(created.body.id, company.id))!;
  return { invoice, company, actorId: tenant.user.id, tenant };
}

async function storedDocument(invoiceId: string) {
  const [row] = await h.sql(
    `SELECT d.status, d.attempts, d.next_retry_at AT TIME ZONE 'UTC' AS next_retry_at,
            d.last_error_code, d.delivery_status, d.provider_message_id, d.uuid, i.einvoice_xml
       FROM einvoice_documents AS d JOIN invoices AS i ON d.invoice_id = i.id
      WHERE d.invoice_id = $1`,
    [invoiceId]
  );
  return row;
}

describe("A-Cube over HTTP: client-side idempotency", () => {
  it("duplicate submit (same document) results in exactly one POST and reuses the stored provider uuid", async () => {
    const args = await linkedInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const acube = provider();
    const now = new Date();
    const request = { ...args, provider: acube, now };

    const queued = await Promise.all([
      enqueueEInvoiceSubmission(request),
      enqueueEInvoiceSubmission(request),
    ]);
    expect(queued.map((q) => q.ok)).toEqual([true, true]);
    expect(mock.posts()).toHaveLength(0);

    const workers = await Promise.all([
      runEInvoiceRetries(now, () => acube),
      runEInvoiceRetries(new Date(now.getTime() + 5), () => acube),
    ]);
    expect(workers.reduce((n, w) => n + w.submitted, 0)).toBe(1);
    expect(mock.posts()).toHaveLength(1);
    expect(mock.documents.size).toBe(1);

    const stored = await storedDocument(args.invoice.id);
    const [remoteUuid] = [...mock.documents.keys()];
    expect(stored).toMatchObject({
      status: "submitted",
      provider_message_id: remoteUuid,
      attempts: 1,
    });
    // The posted body is the frozen snapshot, and its UBL UUID is the stable per-document key.
    expect(mock.posts()[0].body).toBe(stored.einvoice_xml);
    expect(stored.einvoice_xml).toContain(stored.uuid);

    // A third attempt on the same document is refused up front, and a worker finds nothing to send.
    const again = await enqueueEInvoiceSubmission({
      ...request,
      now: new Date(now.getTime() + 10),
    });
    expect(again.ok).toBe(false);
    await runEInvoiceRetries(new Date(now.getTime() + 60_000), () => acube);
    expect(mock.posts()).toHaveLength(1);
    expect((await storedDocument(args.invoice.id)).provider_message_id).toBe(remoteUuid);
  });

  it("a lost 201 is recovered from the outgoing collection on the retry: still one POST", async () => {
    const args = await linkedInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const acube = provider(300);
    mock.script.push({ type: "lost" }); // A-Cube stored the document; the response never arrives
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider: acube, now })).ok).toBe(true);

    expect(await runEInvoiceRetries(now, () => acube)).toEqual({ attempted: 1, submitted: 0 });
    let row = await storedDocument(args.invoice.id);
    expect(row).toMatchObject({ attempts: 1, last_error_code: "TRANSPORT_ERROR" });
    expect(row.provider_message_id).toBeNull();
    expect(mock.posts()).toHaveLength(1);

    const retryAt = new Date(row.next_retry_at);
    expect(await runEInvoiceRetries(retryAt, () => acube)).toEqual({ attempted: 1, submitted: 1 });
    row = await storedDocument(args.invoice.id);
    expect(row.provider_message_id).toBe([...mock.documents.keys()][0]);
    expect(mock.posts()).toHaveLength(1); // no second POST
    const reads = mock.requests.filter((r) => r.method === "GET").map((r) => r.path.split("?")[0]);
    expect(reads.slice(0, 2)).toEqual(["/invoices", `/invoices/${row.provider_message_id}/source`]);
  });

  it("a timed-out POST that created nothing is never blindly re-posted: it ends at needs_link", async () => {
    const args = await linkedInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const { EINVOICE_MAX_ATTEMPTS } = await import("../../server/services/einvoice-status");
    const acube = provider(300);
    mock.script.push({ type: "stall" });
    let now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider: acube, now })).ok).toBe(true);
    for (let attempt = 1; attempt <= EINVOICE_MAX_ATTEMPTS; attempt++) {
      expect(await runEInvoiceRetries(now, () => acube)).toEqual({ attempted: 1, submitted: 0 });
      const row = await storedDocument(args.invoice.id);
      expect(row.attempts).toBe(attempt);
      if (row.next_retry_at) now = new Date(row.next_retry_at);
    }
    expect(mock.posts()).toHaveLength(1);
    expect(mock.documents.size).toBe(0);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      delivery_status: "needs_link",
      provider_message_id: null,
      next_retry_at: null,
    });
  });
});
