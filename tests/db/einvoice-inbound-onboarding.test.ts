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
