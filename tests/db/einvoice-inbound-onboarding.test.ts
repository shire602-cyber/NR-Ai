import { describe, expect, it, vi } from "vitest";
import type { EInvoiceProvider, InboundListing } from "../../server/services/einvoice-provider";
import { PINT_AE_FIXTURES, fixtureCompany } from "../fixtures/pint-ae/fixtures";
import { useHarness } from "./harness";

const h = useHarness();
const BUYER_TRN = "100765432100003";
const BUYER_TIN = "1007654321";
const OWNER = "inbound-example-legal-entity";

function simulatedProvider(xml: string, owner = OWNER, incoming: InboundListing[] = []) {
  const inboundOwner = vi.fn(async () => ({ legalEntityId: owner, tin: null }));
  const fetchSource = vi.fn(async () => xml);
  const getStatus = vi.fn<EInvoiceProvider["getStatus"]>(async (providerMessageId) => ({
    providerMessageId,
    status: "accepted",
    delivery: "delivered",
    providerStatus: "accepted",
  }));
  return {
    name: "acube",
    environment: "sandbox",
    capabilities: { submit: false, getStatus: true, receive: true, cancel: false },
    getStatus,
    inboundOwner,
    fetchSource,
    listInbound: async () => incoming,
    submit: async () => {
      throw new Error("Unexpected submission");
    },
    cancel: async () => {
      throw new Error("Unexpected cancellation");
    },
    receive: async () => [],
    parseWebhook: () => null,
  } satisfies EInvoiceProvider;
}

async function incomingXml(number: string, creditNote = false) {
  const { generateEInvoiceXML } = await import("../../server/services/einvoice.service");
  const f = creditNote
    ? PINT_AE_FIXTURES.find(({ name }) => name === "credit note")!
    : PINT_AE_FIXTURES[0];
  return generateEInvoiceXML({ ...f.invoice, number }, f.lines, fixtureCompany, f.customer, f.opts)
    .xml;
}

async function enqueueReceived(companyId: string, payload: Record<string, unknown>) {
  const { enqueueProviderEvent, providerEventKey } =
    await import("../../server/services/einvoice/provider-events");
  return enqueueProviderEvent({
    provider: "acube",
    environment: "sandbox",
    type: "document.received",
    eventId: providerEventKey("document.received", payload),
    companyId,
    payload,
  });
}

describe("e-invoice inbox onboarding", () => {
  it("holds an event without using its retry budget and processes it once after scoped activation", async () => {
    const t = await h.createTenant({ companyColumns: { trn_vat_number: BUYER_TRN } });
    const other = await h.createSecondTenant();
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(other.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    await upsertLegalEntity(t.company.id, "acube", "production", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const payload = { documentId: "inbound-before-onboarding", documentType: "invoice" };
    const received = await enqueueReceived(t.company.id, payload);
    expect((await enqueueReceived(t.company.id, payload)).duplicate).toBe(true);
    const provider = simulatedProvider(await incomingXml("SUP-WAITING"));

    const run = () => runProviderEvents({ id: received.id!, provider });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "pending",
      legalEntityId: OWNER,
    });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(provider.inboundOwner).not.toHaveBeenCalled();
    expect(provider.fetchSource).not.toHaveBeenCalled();
    expect(
      await h.sql("SELECT status, attempts FROM einvoice_provider_events WHERE id = $1", [
        received.id,
      ])
    ).toEqual([{ status: "pending", attempts: 0 }]);

    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
      activatedAt: new Date(),
    });
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(provider.fetchSource).toHaveBeenCalledTimes(1);
    expect(
      await h.sql("SELECT company_id, status FROM vendor_bills WHERE bill_number = $1", [
        "SUP-WAITING",
      ])
    ).toEqual([{ company_id: t.company.id, status: "draft" }]);
  });

  it.each([
    { note: "document belongs to no company of ours", hasActivationTimestamp: true },
    { note: "legal entity is not active", hasActivationTimestamp: false },
  ])(
    "recovers an event previously ignored before activation ($note)",
    async ({ note, hasActivationTimestamp }) => {
      const t = await h.createTenant({ companyColumns: { trn_vat_number: BUYER_TRN } });
      const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
      const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
      const receipt = await enqueueReceived(t.company.id, { documentId: "legacy-waiting-event" });
      await h.sql(
        `UPDATE einvoice_provider_events SET status = 'ignored', attempts = 1, last_error = $2,
           processed_at = now() - interval '1 hour' WHERE id = $1`,
        [receipt.id, note]
      );
      const provider = simulatedProvider(await incomingXml("SUP-LEGACY-WAITING"));
      const run = () => runProviderEvents({ id: receipt.id!, provider });
      expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
      await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
        status: "active",
        legalEntityId: OWNER,
        activatedAt: hasActivationTimestamp ? new Date() : null,
      });
      expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
      expect(provider.inboundOwner).toHaveBeenCalledTimes(1);
      expect(
        await h.sql("SELECT status, last_error FROM einvoice_provider_events WHERE id = $1", [
          receipt.id,
        ])
      ).toEqual([{ status: "processed", last_error: null }]);
    }
  );

  it("keeps legacy events ignored after routine sync of an unchanged active link", async () => {
    const t = await h.createTenant();
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
      activatedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const receipt = await enqueueReceived(t.company.id, { documentId: "legacy-unchanged-link" });
    await h.sql(
      `UPDATE einvoice_provider_events SET status = 'ignored', attempts = 1,
         last_error = 'document belongs to no company of ours',
         processed_at = now() - interval '30 minutes' WHERE id = $1`,
      [receipt.id]
    );
    const provider = simulatedProvider("");
    expect(await runProviderEvents({ id: receipt.id!, provider })).toEqual({
      claimed: 0,
      processed: 0,
      failed: 0,
    });
    expect(provider.inboundOwner).not.toHaveBeenCalled();
  });

  it("settles a confirmed owner mismatch without fetching source or replaying on later activation", async () => {
    const t = await h.createTenant({ companyColumns: { trn_vat_number: BUYER_TRN } });
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const receipt = await enqueueReceived(t.company.id, { documentId: "mismatched-owner" });
    const provider = simulatedProvider("", "different-legal-entity");
    const run = () => runProviderEvents({ id: receipt.id!, provider });
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
      activatedAt: new Date(Date.now() + 60_000),
    });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(provider.fetchSource).not.toHaveBeenCalled();
    expect(
      await h.sql("SELECT status FROM einvoice_provider_events WHERE id = $1", [receipt.id])
    ).toEqual([{ status: "ignored" }]);
  });
});

describe("e-invoice poll resource selection", () => {
  it.each(["poll", "legacy event"])(
    "preserves the 261 credit-note collection from %s",
    async (discovery) => {
      const t = await h.createTenant({ companyColumns: { trn_vat_number: BUYER_TRN } });
      const { runProviderEvents, runProviderPoll } =
        await import("../../server/services/einvoice/provider-events");
      const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
      const number = "SCN-261";
      const documentId = "self-billed-credit-note";
      await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
        status: "active",
        legalEntityId: OWNER,
      });
      const xml = (await incomingXml(number, true)).replace(
        "<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>",
        "<cbc:CreditNoteTypeCode>261</cbc:CreditNoteTypeCode>"
      );
      const provider = simulatedProvider(xml, OWNER, [
        {
          providerMessageId: documentId,
          documentType: "261",
          documentCollection: "credit-note",
          documentNumber: number,
          legalEntityId: OWNER,
        },
      ]);
      if (discovery === "poll") {
        expect(await runProviderPoll("acube", { companyId: t.company.id, provider })).toEqual({
          refreshed: 0,
          enqueued: 1,
        });
      } else {
        // Older polls stored the raw code with an incorrect generic resource hint.
        await enqueueReceived(t.company.id, {
          documentId,
          documentType: "invoice",
          documentTypeCode: 261,
        });
      }

      expect(await runProviderEvents({ companyId: t.company.id, provider })).toEqual({
        claimed: 1,
        processed: 1,
        failed: 0,
      });
      const ref = { documentType: "261", documentCollection: "credit-note" };
      expect(provider.inboundOwner).toHaveBeenCalledExactlyOnceWith(
        documentId,
        ref,
        expect.anything()
      );
      expect(provider.fetchSource).toHaveBeenCalledExactlyOnceWith(documentId, ref);
      expect(
        await h.sql(
          "SELECT document_type FROM einvoice_archive WHERE company_id = $1 AND document_number = $2",
          [t.company.id, number]
        )
      ).toEqual([{ document_type: "261" }]);
    }
  );

  it("polls recipient ASP receipts and preserves final recipient decisions without reporting-only polls", async () => {
    const t = await h.createTenant();
    const { runProviderPoll } = await import("../../server/services/einvoice/provider-events");
    const provider = simulatedProvider("");
    for (const [id, status, providerStatus, reporting] of [
      ["receipt-current", "submitted", "delivered", "not_required"],
      ["receipt-historical", "cleared", "delivered", "reported"],
      ["handoff-historical", "accepted", "  Processed  ", "pending"],
      ["buyer-accepted", "accepted", "accepted", "pending"],
    ]) {
      const [invoice] = await h.sql<{ id: string }>(
        `INSERT INTO invoices (company_id, number, customer_name, date, status, einvoice_status,
                               einvoice_provider, einvoice_provider_message_id)
         VALUES ($1, $2, 'Example buyer', now(), 'sent', $3, 'acube', $2) RETURNING id`,
        [t.company.id, id, status]
      );
      await h.sql(
        `INSERT INTO einvoice_documents (company_id, invoice_id, provider, provider_message_id,
                                         status, provider_status, delivery_status, reporting_status, validation)
         VALUES ($1, $2, 'acube', $3, $4, $5, 'delivered', $6, '{"submission":{"environment":"sandbox"}}')`,
        [t.company.id, invoice.id, id, status, providerStatus, reporting]
      );
    }
    await runProviderPoll("acube", { companyId: t.company.id, provider });
    expect(provider.getStatus.mock.calls.map(([id]) => id).sort()).toEqual([
      "handoff-historical",
      "receipt-current",
      "receipt-historical",
    ]);
  });
});

describe("e-invoice inbox recovers incomplete purchases", () => {
  async function purchase(number: string, documentId: string, includeUuid = true) {
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    const t = await h.createTenant({ companyColumns: { trn_vat_number: BUYER_TRN } });
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const source = await incomingXml(number);
    const xml = includeUuid ? source : source.replace(/<cbc:UUID>[^<]*<\/cbc:UUID>/, "");
    const provider = simulatedProvider(xml);
    const { id } = await enqueueReceived(t.company.id, { documentId });
    const run = () => runProviderEvents({ id: id!, provider });
    const bills = () =>
      h.sql<{ id: string }>(
        "SELECT id FROM vendor_bills WHERE company_id = $1 AND bill_number = $2",
        [t.company.id, number]
      );
    return { t, id, xml, run, bills };
  }

  it("rolls back a partially written bill and finishes exactly one purchase on retry", async () => {
    const { t, id, run, bills } = await purchase("SUP-RETRY-ROLLBACK", "retry-rollback");
    const registry = await import("../../server/platform/service-registry");
    type Prepare =
      typeof import("../../server/services/bill-payment.service").prepareDraftFromInbound;
    const prepare = registry.resolve<Prepare>("bills.prepareDraftFromInbound");
    registry.provide(
      "bills.prepareDraftFromInbound",
      (async (...args) => {
        const write = await prepare(...args);
        return async (tx) => {
          await write(tx);
          throw new Error("Interrupted after bill write");
        };
      }) satisfies Prepare,
      { replace: true }
    );
    try {
      expect(await run()).toEqual({ claimed: 1, processed: 0, failed: 1 });
    } finally {
      registry.provide("bills.prepareDraftFromInbound", prepare, { replace: true });
    }
    expect(await bills()).toEqual([]);
    const [received] = await h.sql(
      "SELECT status, bill_id, archive_id FROM einvoice_inbound_documents WHERE company_id = $1",
      [t.company.id]
    );
    expect(received).toMatchObject({
      status: "failed",
      bill_id: null,
      archive_id: expect.any(String),
    });
    const [event] = await h.sql(
      "SELECT status, attempts, processed_at FROM einvoice_provider_events WHERE id = $1",
      [id]
    );
    expect(event).toEqual({ status: "pending", attempts: 1, processed_at: null });
    await h.sql("UPDATE einvoice_provider_events SET next_attempt_at = now() WHERE id = $1", [id]);

    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    const [bill] = await bills();
    expect(bill?.id).toBeTruthy();
    expect(
      await h.sql(
        "SELECT status, bill_id, archive_id FROM einvoice_inbound_documents WHERE company_id = $1",
        [t.company.id]
      )
    ).toEqual([{ status: "bill_created", bill_id: bill.id, archive_id: received.archive_id }]);
    expect(await bills()).toHaveLength(1);
  });

  it("keeps an inbound event retryable while the company has no draft owner", async () => {
    const { t, id, run, bills } = await purchase("SUP-WAITING-OWNER", "waiting-draft-owner");
    await h.sql("DELETE FROM company_users WHERE company_id = $1", [t.company.id]);
    expect(await run()).toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(await bills()).toEqual([]);
    expect(
      await h.sql(
        "SELECT status, bill_id, error FROM einvoice_inbound_documents WHERE company_id = $1",
        [t.company.id]
      )
    ).toEqual([
      { status: "failed", bill_id: null, error: "Company has no member to own the draft bill" },
    ]);
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')", [
      t.company.id,
      t.user.id,
    ]);
    await h.sql("UPDATE einvoice_provider_events SET next_attempt_at = now() WHERE id = $1", [id]);
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(await bills()).toHaveLength(1);
  });

  it.each([true, false])(
    "repairs a processed legacy event by linking its bill (UUID: %s)",
    async (includeUuid) => {
      const number = "SUP-LEGACY-ORPHAN";
      const documentId = "legacy-orphan";
      const { t, id, xml, run, bills } = await purchase(number, documentId, includeUuid);
      const { parseInboundUbl, toInboundBill } =
        await import("../../server/services/einvoice/inbound");
      const { archiveEInvoiceXml, insertInboundDocument } =
        await import("../../server/services/einvoice/store");
      const { createDraftFromInbound } = await import("../../server/services/bill-payment.service");
      const parsed = parseInboundUbl(xml);
      const original = (
        await createDraftFromInbound(t.company.id, t.user.id, toInboundBill(parsed))
      ).bill;
      const archive = await archiveEInvoiceXml({
        companyId: t.company.id,
        direction: "inbound",
        kind: "received",
        documentNumber: number,
        documentType: parsed.typeCode,
        uuid: parsed.uuid,
        xml,
        providerMessageId: documentId,
      });
      await insertInboundDocument({
        companyId: t.company.id,
        supplierKey: parsed.supplierTrn!,
        documentNumber: number,
        documentType: parsed.typeCode,
        uuid: parsed.uuid,
        sha256: archive.sha256,
        status: "failed",
        archiveId: archive.id,
        validation: { valid: true },
      });
      await h.sql(
        "UPDATE einvoice_provider_events SET status = 'processed', processed_at = now(), attempts = 2 WHERE id = $1",
        [id]
      );
      expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
      expect(await bills()).toEqual([{ id: original.id }]);
      expect(
        await h.sql(
          "SELECT status, bill_id FROM einvoice_inbound_documents WHERE company_id = $1",
          [t.company.id]
        )
      ).toEqual([{ status: "bill_created", bill_id: original.id }]);
    }
  );

  it("leaves an incomplete legacy event alone when its message ID spans environments", async () => {
    const documentId = "legacy-ambiguous-environment";
    const { t, run } = await purchase("SUP-LEGACY-SCOPE", documentId);
    const { enqueueProviderEvent, providerEventKey } =
      await import("../../server/services/einvoice/provider-events");
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    await h.sql(
      "UPDATE einvoice_inbound_documents SET status = 'failed', bill_id = NULL WHERE company_id = $1",
      [t.company.id]
    );
    const payload = { documentId };
    await enqueueProviderEvent({
      provider: "acube",
      environment: "production",
      companyId: t.company.id,
      type: "document.received",
      eventId: providerEventKey("document.received", payload),
      payload,
    });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(
      await h.sql("SELECT status, bill_id FROM einvoice_inbound_documents WHERE company_id = $1", [
        t.company.id,
      ])
    ).toEqual([{ status: "failed", bill_id: null }]);
  });
});

describe("e-invoice legal entity synchronization", () => {
  it("keeps a verified old callback from mutating a replacement legal entity", async () => {
    const t = await h.createTenant();
    const { enqueueProviderEvent, runProviderEvents } =
      await import("../../server/services/einvoice/provider-events");
    const { getLegalEntity, upsertLegalEntity } =
      await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const { id } = await enqueueProviderEvent({
      provider: "acube",
      environment: "sandbox",
      companyId: t.company.id,
      type: "legal_entity.synchronized",
      eventId: "old-entity-callback",
      payload: { legalEntityId: OWNER, action: "DELINK" },
    });
    const replacement = { status: "pending", legalEntityId: "replacement", tin: "1009999999" };
    const legalEntityPatch = vi.fn(async () => {
      await upsertLegalEntity(t.company.id, "acube", "sandbox", replacement.tin, {
        status: replacement.status,
        legalEntityId: replacement.legalEntityId,
      });
      return { legalEntityId: OWNER, status: "inactive", peppolAddress: null };
    });
    const provider = { ...simulatedProvider(""), legalEntityPatch };
    expect(await runProviderEvents({ id: id!, provider })).toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });
    expect(legalEntityPatch).toHaveBeenCalledExactlyOnceWith(
      OWNER,
      { legalEntityId: OWNER, action: "DELINK" },
      BUYER_TIN
    );
    expect(await getLegalEntity(t.company.id, "acube", "sandbox")).toMatchObject(replacement);
    expect(await h.sql("SELECT status FROM einvoice_provider_events WHERE id = $1", [id])).toEqual([
      { status: "ignored" },
    ]);
  });
});
