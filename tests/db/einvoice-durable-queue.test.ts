import { describe, expect, it } from "vitest";
import type { EInvoiceProvider } from "../../server/services/einvoice-provider";
import { useHarness } from "./harness";

const h = useHarness();

async function readyInvoice() {
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
  const { storage } = await import("../../server/storage");
  const company = (await storage.getCompany(tenant.company.id))!;
  const invoice = (await storage.getInvoice(created.body.id, company.id))!;
  return { invoice, company, actorId: tenant.user.id, tenant };
}

function fakeProvider(overrides: Partial<EInvoiceProvider> = {}): EInvoiceProvider {
  return {
    name: "mock",
    environment: "mock",
    capabilities: { submit: true, getStatus: true, receive: false, cancel: false },
    submit: async (payload) => ({ providerMessageId: payload.uuid, status: "submitted" }),
    getStatus: async (id) => ({ providerMessageId: id, status: "accepted" }),
    receive: async () => [],
    cancel: async (id) => ({ providerMessageId: id, status: "cancelled" }),
    parseWebhook: () => null,
    ...overrides,
  };
}

async function storedDocument(invoiceId: string) {
  const [row] = await h.sql(
    `SELECT d.status, i.einvoice_status, d.attempts, d.next_retry_at AT TIME ZONE 'UTC' AS next_retry_at, d.last_error_code, d.delivery_status,
      d.provider_message_id, i.einvoice_xml, i.einvoice_uuid, i.einvoice_submitted_at
    FROM einvoice_documents AS d JOIN invoices AS i ON d.invoice_id = i.id
    WHERE d.invoice_id = $1`,
    [invoiceId]
  );
  return row;
}

async function selectComplyance(companyId: string) {
  await h.sql("UPDATE companies SET einvoice_partner = 'complyance' WHERE id = $1", [companyId]);
  await h.sql(
    "INSERT INTO einvoice_legal_entities (company_id, provider, environment, tin, status) VALUES ($1, 'complyance', 'sandbox', '1001234567', 'active')",
    [companyId]
  );
}

describe("Durable UAE e-invoice submission queue", () => {
  it("queues a single audited snapshot and sends it once through parallel workers", async () => {
    const args = await readyInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const sent: string[] = [];
    const provider = fakeProvider({
      submit: async ({ uuid, xml }) => {
        sent.push(xml);
        return { providerMessageId: uuid, status: "submitted" };
      },
    });
    const now = new Date();
    const request = { ...args, provider, now };
    const queued = await Promise.all([
      enqueueEInvoiceSubmission(request),
      enqueueEInvoiceSubmission(request),
    ]);
    expect(queued.map((result) => result.ok)).toEqual([true, true]);
    const before = await storedDocument(args.invoice.id);
    expect(before).toMatchObject({
      status: "generated",
      einvoice_status: "queued",
      attempts: 0,
      provider_message_id: null,
      einvoice_submitted_at: null,
    });
    expect(sent).toEqual([]);
    const [audit] = await h.sql(
      "SELECT count(*)::int AS count FROM audit_logs WHERE resource_id = $1 AND action = 'invoice.einvoice_submit'",
      [args.invoice.id]
    );
    expect(audit.count).toBe(1);

    const workers = await Promise.all([
      runEInvoiceRetries(now, () => provider),
      runEInvoiceRetries(new Date(now.getTime() + 5), () => provider),
    ]);
    expect(workers.reduce((total, worker) => total + worker.submitted, 0)).toBe(1);
    expect(sent).toEqual([before.einvoice_xml]);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      status: "submitted",
      provider_message_id: before.einvoice_uuid,
      attempts: 1,
      next_retry_at: null,
    });
    const attempts = await h.sql(
      "SELECT to_status FROM einvoice_document_events WHERE invoice_id = $1 AND track = 'delivery' AND to_status = 'sending'",
      [args.invoice.id]
    );
    expect(attempts).toHaveLength(1);
  });

  it("recovers a stale lease using the pinned environment and frozen XML without another POST", async () => {
    const args = await readyInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const { SUBMISSION_LEASE_MS } = await import("../../server/services/einvoice/store");
    const now = new Date();
    let posted = 0;
    let lookedUp = 0;
    const provider = fakeProvider({
      name: "acube",
      environment: "sandbox",
      submit: async ({ uuid }) => {
        posted++;
        return { providerMessageId: uuid, status: "submitted" };
      },
      lookupSubmission: async ({ uuid, xml }) => {
        lookedUp++;
        expect(xml).toContain("Acme Gulf FZ-LLC");
        return { providerMessageId: uuid, status: "submitted" };
      },
    });
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    // Simulate a process that recorded its attempt, handed it off, and stopped before finalizing.
    await h.sql(
      "UPDATE einvoice_documents SET submit_claimed_at = $1, attempts = 1 WHERE invoice_id = $2",
      [now.toISOString(), args.invoice.id]
    );
    await h.sql("UPDATE invoices SET customer_name = $1 WHERE id = $2", [
      "Updated buyer name",
      args.invoice.id,
    ]);
    expect(
      await runEInvoiceRetries(new Date(now.getTime() + SUBMISSION_LEASE_MS - 1), () => provider)
    ).toEqual({ attempted: 0, submitted: 0 });
    const stale = new Date(now.getTime() + SUBMISSION_LEASE_MS);
    expect(
      await runEInvoiceRetries(stale, () => ({ ...provider, environment: "production" }))
    ).toEqual({ attempted: 0, submitted: 0 });
    expect(await runEInvoiceRetries(stale, () => provider)).toEqual({ attempted: 1, submitted: 1 });
    expect(lookedUp).toBe(1);
    expect(posted).toBe(0);
    expect(await storedDocument(args.invoice.id)).toMatchObject({ attempts: 2 });
  });

  it("reconciles an ambiguous A-Cube handoff with backoff and stops for linking if still unknown", async () => {
    const args = await readyInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const { EINVOICE_MAX_ATTEMPTS } = await import("../../server/services/einvoice-status");
    let posted = 0;
    let lookedUp = 0;
    const provider = fakeProvider({
      name: "acube",
      environment: "sandbox",
      submit: async () => {
        posted++;
        return { providerMessageId: "", status: "failed", errorCode: "ACUBE_NO_DOCUMENT_ID" };
      },
      lookupSubmission: async () => {
        lookedUp++;
        return null;
      },
    });
    let now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    for (let attempt = 1; attempt <= EINVOICE_MAX_ATTEMPTS; attempt++) {
      expect(await runEInvoiceRetries(now, () => provider)).toEqual({ attempted: 1, submitted: 0 });
      const row = await storedDocument(args.invoice.id);
      expect(row.attempts).toBe(attempt);
      if (attempt < EINVOICE_MAX_ATTEMPTS) {
        expect(new Date(row.next_retry_at).getTime() - now.getTime()).toBe(
          60_000 * 2 ** (attempt - 1)
        );
        now = new Date(row.next_retry_at);
      }
    }
    expect(posted).toBe(1);
    expect(lookedUp).toBe(EINVOICE_MAX_ATTEMPTS - 1);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      delivery_status: "needs_link",
      next_retry_at: null,
      provider_message_id: null,
      last_error_code: "EINVOICE_NEEDS_LINK",
      einvoice_submitted_at: null,
    });
  });

  it("discards a status response overtaken by a concurrent poll", async () => {
    const args = await readyInvoice();
    const { submitAndPersist, refreshAndPersist } =
      await import("../../server/services/einvoice/workflow");
    const { storage } = await import("../../server/storage");
    const provider = fakeProvider();
    expect((await submitAndPersist({ ...args, provider })).ok).toBe(true);
    const invoice = (await storage.getInvoice(args.invoice.id, args.company.id))!;
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = refreshAndPersist({
      ...args,
      invoice,
      provider: fakeProvider({
        getStatus: async (id) => {
          markStarted();
          await wait;
          return { providerMessageId: id, status: "rejected" };
        },
      }),
    });
    await started;
    try {
      const newer = await refreshAndPersist({ ...args, invoice, provider });
      expect(newer.ok).toBe(true);
    } finally {
      release();
    }
    expect(await delayed).toMatchObject({ ok: false, status: 409 });
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      status: "accepted",
      delivery_status: "delivered",
    });
  });

  it("reads a historical A-Cube receipt only after proving its frozen provider source", async () => {
    const args = await readyInvoice();
    const { submitAndPersist, refreshAndPersist } =
      await import("../../server/services/einvoice/workflow");
    const { documentSubmissionSnapshot } = await import("../../server/services/einvoice/store");
    const { storage } = await import("../../server/storage");
    const inheritedProvider = fakeProvider({ name: "acube", environment: "sandbox" });
    expect((await submitAndPersist({ ...args, provider: inheritedProvider })).ok).toBe(true);
    // Pre-fix A-Cube recorded the recipient receipt as cleared and did not pin a credential scope.
    await h.sql("UPDATE invoices SET einvoice_status = 'cleared' WHERE id = $1", [args.invoice.id]);
    await h.sql(
      "UPDATE einvoice_documents SET status = 'cleared', delivery_status = 'delivered', reporting_status = 'reported', reported_at = now(), provider_status = 'delivered' WHERE invoice_id = $1",
      [args.invoice.id]
    );
    const invoice = (await storage.getInvoice(args.invoice.id, args.company.id))!;
    let source = "<OtherCompanyInvoice/>";
    let reads = 0;
    const provider = fakeProvider({
      ...inheritedProvider,
      getSubmissionScope: async () => "fixture-current-provider-scope",
      fetchSource: async () => source,
      getStatus: async (id) => {
        reads++;
        return {
          providerMessageId: id,
          status: "accepted",
          delivery: "delivered",
          providerStatus: "accepted",
        };
      },
    });
    const refused = await refreshAndPersist({ ...args, invoice, provider });
    expect(refused).toMatchObject({ ok: false, code: "EINVOICE_PROVIDER_NOT_CONFIGURED" });
    expect(reads).toBe(0);
    source = invoice.einvoiceXml!;
    const refreshed = await refreshAndPersist({ ...args, invoice, provider });
    expect(refreshed).toMatchObject({
      ok: true,
      documentRow: {
        status: "accepted",
        reportingStatus: "not_required",
        reportBy: null,
        reportedAt: null,
        clearedAt: null,
      },
    });
    if (!refreshed.ok) throw new Error("Expected the verified provider receipt to refresh");
    expect(documentSubmissionSnapshot(refreshed.documentRow)).toMatchObject({
      reportingRequired: false,
    });
    const events = await h.sql(
      `SELECT track, provider_status FROM einvoice_document_events
       WHERE invoice_id = $1 AND ((track = 'delivery' AND provider_status = 'accepted')
                                  OR (track = 'reporting' AND to_status = 'reported'))`,
      [args.invoice.id]
    );
    expect(events).toEqual([{ track: "delivery", provider_status: "accepted" }]);
    expect(reads).toBe(1);
  });

  it("keeps a Complyance replay scoped to the first attempt after an intervening rate limit", async () => {
    const args = await readyInvoice();
    await selectComplyance(args.company.id);
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const { documentValidation, getEInvoiceDocument } =
      await import("../../server/services/einvoice/store");
    let posted = 0;
    let scope = "fixture-workspace-one";
    const provider = fakeProvider({
      name: "complyance",
      environment: "sandbox",
      requiresLegalEntity: true,
      getSubmissionScope: async () => scope,
      submit: async (submission) => {
        expect(submission.scopeFingerprint).toBe("fixture-workspace-one");
        posted++;
        return {
          providerMessageId: "",
          status: "failed",
          errorCode: posted === 1 ? "TRANSPORT_ERROR" : "COMPLYANCE_RATE_LIMITED",
        };
      },
    });
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    await runEInvoiceRetries(now, () => provider);
    let doc = await getEInvoiceDocument(args.company.id, args.invoice.id);
    expect(documentValidation(doc)).not.toHaveProperty("submission");
    await runEInvoiceRetries(doc!.nextRetryAt!, () => provider);
    doc = await getEInvoiceDocument(args.company.id, args.invoice.id);
    expect(doc?.lastErrorCode).toBe("TRANSPORT_ERROR");
    scope = "fixture-workspace-two";
    await runEInvoiceRetries(doc!.nextRetryAt!, () => provider);
    expect(posted).toBe(2);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      delivery_status: "needs_link",
      next_retry_at: null,
      provider_message_id: null,
    });
  });

  it("prevents replacing a rejected document that already has a provider reference", async () => {
    const args = await readyInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    let posts = 0;
    const provider = fakeProvider({
      submit: async () => {
        posts++;
        return { providerMessageId: "already-recorded", status: "rejected" };
      },
    });
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    await runEInvoiceRetries(now, () => provider);
    const retry = await enqueueEInvoiceSubmission({ ...args, provider, regenerate: true });
    expect(retry).toMatchObject({ ok: false, status: 409, code: "EINVOICE_ALREADY_SUBMITTED" });
    expect(posts).toBe(1);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      status: "rejected",
      provider_message_id: "already-recorded",
      next_retry_at: null,
    });
  });

  it("rejects a queued submission when the initiating actor loses tax permission", async () => {
    const args = await readyInvoice();
    await selectComplyance(args.company.id);
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    let posts = 0;
    const provider = fakeProvider({
      name: "complyance",
      environment: "sandbox",
      requiresLegalEntity: true,
      getSubmissionScope: async () => "fixture-workspace",
      submit: async () => {
        posts++;
        return { providerMessageId: "unexpected", status: "submitted" };
      },
    });
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    await h.sql(
      "UPDATE company_users SET role = 'bookkeeper' WHERE company_id = $1 AND user_id = $2",
      [args.company.id, args.actorId]
    );
    expect(await runEInvoiceRetries(now, () => provider)).toMatchObject({ submitted: 0 });
    expect(posts).toBe(0);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      status: "failed",
      next_retry_at: null,
      last_error_code: "PERMISSION_DENIED",
    });
  });

  it("refuses changed workspace credentials before the first provider handoff", async () => {
    const args = await readyInvoice();
    await selectComplyance(args.company.id);
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    let scope = "fixture-original-workspace";
    let posts = 0;
    const provider = fakeProvider({
      name: "complyance",
      environment: "sandbox",
      requiresLegalEntity: true,
      getSubmissionScope: async () => scope,
      submit: async () => {
        posts++;
        return { providerMessageId: "unexpected", status: "submitted" };
      },
    });
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    scope = "fixture-replacement-workspace";
    expect(await runEInvoiceRetries(now, () => provider)).toMatchObject({ submitted: 0 });
    expect(posts).toBe(0);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      status: "failed",
      next_retry_at: null,
      last_error_code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("keeps an exhausted attempt bound to its provider on both write endpoints and in the queue", async () => {
    const args = await readyInvoice();
    await selectComplyance(args.company.id);
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const { EINVOICE_MAX_ATTEMPTS } = await import("../../server/services/einvoice-status");
    let originalAttempts = 0;
    let replacementAttempts = 0;
    const original = fakeProvider({
      name: "complyance",
      environment: "sandbox",
      requiresLegalEntity: true,
      getSubmissionScope: async () => "fixture-original",
      submit: async () => {
        originalAttempts++;
        return { providerMessageId: "", status: "failed", errorCode: "COMPLYANCE_RATE_LIMITED" };
      },
    });
    const replacement = fakeProvider({
      name: "acube",
      environment: "sandbox",
      requiresLegalEntity: true,
      getSubmissionScope: async () => "fixture-replacement",
      submit: async () => {
        replacementAttempts++;
        return { providerMessageId: "unexpected", status: "submitted" };
      },
    });
    let now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider: original, now })).ok).toBe(true);
    for (let attempts = 1; attempts <= EINVOICE_MAX_ATTEMPTS; attempts++) {
      await runEInvoiceRetries(now, () => original);
      const row = await storedDocument(args.invoice.id);
      expect(row.attempts).toBe(attempts);
      if (row.next_retry_at) now = new Date(row.next_retry_at);
    }
    await h.sql("UPDATE companies SET einvoice_partner = 'acube' WHERE id = $1", [args.company.id]);
    await h.sql(
      "INSERT INTO einvoice_legal_entities (company_id, provider, environment, tin, status) VALUES ($1, 'acube', 'sandbox', '1001234567', 'active')",
      [args.company.id]
    );
    for (const endpoint of ["submit", "resubmit"]) {
      const response = await args.tenant.as.post(
        `/api/invoices/${args.invoice.id}/einvoice/${endpoint}`,
        {}
      );
      expect(response.status, response.text).toBe(409);
      expect(response.body.code).toBe("EINVOICE_RETRY_PROVIDER_CHANGED");
    }
    const direct = await enqueueEInvoiceSubmission({
      ...args,
      provider: replacement,
      regenerate: true,
    });
    expect(direct).toMatchObject({
      ok: false,
      status: 409,
      code: "EINVOICE_RETRY_PROVIDER_CHANGED",
    });
    expect(originalAttempts).toBe(EINVOICE_MAX_ATTEMPTS);
    expect(replacementAttempts).toBe(0);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      attempts: EINVOICE_MAX_ATTEMPTS,
      next_retry_at: null,
      provider_message_id: null,
    });
  });

  it("releases an unused queue item when its provider is replaced and no longer configured", async () => {
    const args = await readyInvoice();
    await selectComplyance(args.company.id);
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const provider = fakeProvider({
      name: "complyance",
      environment: "sandbox",
      requiresLegalEntity: true,
      getSubmissionScope: async () => "fixture-former-workspace",
    });
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    await h.sql("UPDATE companies SET einvoice_partner = 'acube' WHERE id = $1", [args.company.id]);
    const result = await runEInvoiceRetries(now, () => {
      throw new Error("Fixture provider is no longer configured");
    });
    expect(result).toEqual({ attempted: 0, submitted: 0 });
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      status: "failed",
      attempts: 0,
      next_retry_at: null,
      last_error_code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("does not replay a lost Complyance response after the legal entity is delinked", async () => {
    const args = await readyInvoice();
    await selectComplyance(args.company.id);
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    let posts = 0;
    const provider = fakeProvider({
      name: "complyance",
      environment: "sandbox",
      requiresLegalEntity: true,
      getSubmissionScope: async () => "fixture-workspace",
      submit: async () => {
        posts++;
        return { providerMessageId: "", status: "failed", errorCode: "TRANSPORT_ERROR" };
      },
    });
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    await runEInvoiceRetries(now, () => provider);
    const failed = await storedDocument(args.invoice.id);
    await h.sql("UPDATE einvoice_legal_entities SET status = 'inactive' WHERE company_id = $1", [
      args.company.id,
    ]);
    expect(await runEInvoiceRetries(new Date(failed.next_retry_at), () => provider)).toMatchObject({
      submitted: 0,
    });
    expect(posts).toBe(1);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      delivery_status: "needs_link",
      next_retry_at: null,
      provider_message_id: null,
    });
  });

  it("stops an unused queue entry when the accounting document is voided", async () => {
    const args = await readyInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    let posted = 0;
    const provider = fakeProvider({
      submit: async ({ uuid }) => {
        posted++;
        return { providerMessageId: uuid, status: "submitted" };
      },
    });
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    const voided = await args.tenant.as.patch(`/api/invoices/${args.invoice.id}/status`, {
      status: "void",
      reason: "Voided before e-invoice handoff",
    });
    expect(voided.status, voided.text).toBe(200);
    await runEInvoiceRetries(now, () => provider);
    expect(posted).toBe(0);
    expect(await storedDocument(args.invoice.id)).toMatchObject({
      status: "failed",
      last_error_code: "EINVOICE_INVOICE_VOID",
      next_retry_at: null,
      provider_message_id: null,
    });
  });

  it("prevents accounting void during a claimed handoff", async () => {
    const args = await readyInvoice();
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = fakeProvider({
      submit: async ({ invoiceId, uuid }) => {
        if (invoiceId !== args.invoice.id) {
          return { providerMessageId: uuid, status: "submitted" };
        }
        markStarted();
        await wait;
        return { providerMessageId: uuid, status: "submitted" };
      },
    });
    const now = new Date();
    expect((await enqueueEInvoiceSubmission({ ...args, provider, now })).ok).toBe(true);
    const worker = runEInvoiceRetries(now, () => provider);
    await started;
    try {
      const { SUBMISSION_LEASE_MS } = await import("../../server/services/einvoice/store");
      const concurrent = await runEInvoiceRetries(
        new Date(now.getTime() + SUBMISSION_LEASE_MS + 1),
        () => provider
      );
      expect(concurrent).toEqual({ attempted: 0, submitted: 0 });
      const voided = await args.tenant.as.patch(`/api/invoices/${args.invoice.id}/status`, {
        status: "void",
        reason: "Attempt to void during e-invoice handoff",
      });
      expect(voided.status, voided.text).toBe(409);
      expect(voided.body.code).toBe("EINVOICE_SUBMISSION_IN_PROGRESS");
    } finally {
      release();
    }
    expect(await worker).toEqual({ attempted: 1, submitted: 1 });
  });
});
