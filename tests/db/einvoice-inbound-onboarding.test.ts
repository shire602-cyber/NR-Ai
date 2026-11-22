import { describe, expect, it, vi } from "vitest";
import type { EInvoiceProvider, InboundListing } from "../../server/services/einvoice-provider";
import { PINT_AE_FIXTURES, fixtureCompany } from "../fixtures/pint-ae/fixtures";
import { useHarness } from "./harness";

const h = useHarness();
const BUYER_TRN = "100765432100003";
const BUYER_TIN = "1007654321";
const OWNER = "inbound-example-legal-entity";
const REPLACEMENT_TIN = "1009999999";
const REPLACEMENT_TRN = "100999999900003";

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
  it.each(["parked during the switch", "previously ignored"])(
    "resumes a signed receipt after a temporary provider switch (%s)",
    async (state) => {
      const t = await h.createTenant({
        companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
      });
      const { enqueueVerifiedProviderCallback, runProviderEvents } =
        await import("../../server/services/einvoice/provider-events");
      const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
      await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
        status: "active",
        legalEntityId: OWNER,
      });
      const callback = (documentId: string) =>
        enqueueVerifiedProviderCallback({
          provider: "acube",
          environment: "sandbox",
          companyId: t.company.id,
          type: "document.received",
          eventId: documentId,
          payload: { documentId, ownerLegalEntityId: OWNER },
        });
      const { id } = await callback("accepted-before-switch");
      expect(id).toBeTruthy();
      const provider = simulatedProvider(await incomingXml("SUP-RESUME-ORIGINAL"));
      const run = () => runProviderEvents({ id: id!, provider });
      const select = (partner: string) =>
        t.as.put(`/api/companies/${t.company.id}/einvoicing/partner`, { partner });
      expect((await select("complyance")).status).toBe(200);
      expect(await callback("arrived-after-switch")).toMatchObject({ id: null, ignored: true });
      if (state === "previously ignored") {
        await h.sql(
          "UPDATE einvoice_provider_events SET status = 'ignored', last_error = $2 WHERE id = $1",
          [id, "Receipt does not match the current provider and taxpayer"]
        );
      } else {
        expect(await run()).toEqual({ claimed: 1, processed: 0, failed: 0 });
        expect(provider.fetchSource).not.toHaveBeenCalled();
        expect(
          await h.sql("SELECT status FROM einvoice_provider_events WHERE id = $1", [id])
        ).toEqual([{ status: "pending" }]);
      }

      expect((await select("acube")).status).toBe(200);
      expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
      expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
      expect(
        await h.sql("SELECT bill_number FROM vendor_bills WHERE company_id = $1", [t.company.id])
      ).toEqual([{ bill_number: "SUP-RESUME-ORIGINAL" }]);
    }
  );

  it("matches formatted VAT numbers without accepting a different full VAT registration", async () => {
    const formattedTrn = "100 7654321 00003";
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: formattedTrn, einvoice_partner: "acube" },
    });
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
      vatTrn: formattedTrn,
    });
    const run = async (documentId: string, vatTrn: string, billNumber: string) => {
      const { id } = await enqueueReceived(t.company.id, { documentId });
      const provider: EInvoiceProvider = {
        ...simulatedProvider(await incomingXml(billNumber)),
        inboundOwner: async () => ({ legalEntityId: OWNER, tin: BUYER_TIN, vatTrn }),
      };
      expect(await runProviderEvents({ id: id!, provider })).toEqual({
        claimed: 1,
        processed: 1,
        failed: 0,
      });
    };
    await run("mismatched-vat", "100 7654321 01003", "SUP-OTHER-VAT");
    await run("formatted-vat", "1007654 32100003", "SUP-FORMATTED-VAT");
    expect(
      await h.sql("SELECT bill_number FROM vendor_bills WHERE company_id = $1", [t.company.id])
    ).toEqual([{ bill_number: "SUP-FORMATTED-VAT" }]);
  });

  it("holds an event without using its retry budget and processes it once after scoped activation", async () => {
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
    });
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
      const t = await h.createTenant({
        companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
      });
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

  it("rechecks previously ignored receipt validation only with independent ownership and correct buyer", async () => {
    const t = await h.createTenant({
      vatRegistered: false,
      companyColumns: { einvoice_tin: BUYER_TIN, einvoice_partner: "acube" },
    });
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const source = await incomingXml("SUP-RECHECK-BUYER");
    const matching = await enqueueReceived(t.company.id, { documentId: "legacy-matching-buyer" });
    const wrongBuyer = await enqueueReceived(t.company.id, { documentId: "legacy-wrong-buyer" });
    const wrongOwner = await enqueueReceived(t.company.id, { documentId: "legacy-wrong-owner" });
    await h.sql(
      `UPDATE einvoice_provider_events
          SET status = 'ignored', attempts = 1, last_error = 'inbound document failed validation',
              processed_at = now()
        WHERE company_id = $1`,
      [t.company.id]
    );
    const matchingProvider = simulatedProvider(source);
    const foreignBuyer = simulatedProvider(source.replaceAll(BUYER_TIN, "1001112223"));
    const foreignOwner = simulatedProvider(source, "foreign-provider-entity");
    for (const [receipt, provider] of [
      [matching, matchingProvider],
      [wrongBuyer, foreignBuyer],
      [wrongOwner, foreignOwner],
    ] as const) {
      expect(await runProviderEvents({ id: receipt.id!, provider })).toEqual({
        claimed: 1,
        processed: 1,
        failed: 0,
      });
      expect(await runProviderEvents({ id: receipt.id!, provider })).toEqual({
        claimed: 0,
        processed: 0,
        failed: 0,
      });
    }
    expect(foreignOwner.fetchSource).not.toHaveBeenCalled();
    expect(
      await h.sql("SELECT bill_number FROM vendor_bills WHERE company_id = $1", [t.company.id])
    ).toEqual([{ bill_number: "SUP-RECHECK-BUYER" }]);
  });

  it("keeps receipts queued without configuration and recovers a formerly dead receipt", async () => {
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
    });
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const receipt = await enqueueReceived(t.company.id, { documentId: "legacy-dead-receipt" });
    await h.sql(
      `UPDATE einvoice_provider_events
          SET status = 'dead', attempts = 10, next_attempt_at = now(),
              last_error = 'Provider event could not be processed'
        WHERE id = $1`,
      [receipt.id]
    );
    expect(await runProviderEvents({ id: receipt.id! })).toEqual({
      claimed: 1,
      processed: 0,
      failed: 0,
    });
    expect(
      await h.sql("SELECT status, last_error FROM einvoice_provider_events WHERE id = $1", [
        receipt.id,
      ])
    ).toEqual([
      { status: "pending", last_error: "Inbound receipt is waiting for provider configuration" },
    ]);

    await h.sql("UPDATE einvoice_provider_events SET next_attempt_at = now() WHERE id = $1", [
      receipt.id,
    ]);
    const provider = simulatedProvider(await incomingXml("SUP-RECONFIGURED"));
    expect(await runProviderEvents({ id: receipt.id!, provider })).toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });
    expect(provider.fetchSource).toHaveBeenCalledTimes(1);
  });

  it("rechecks a legacy active link without an activation timestamp against authenticated ownership", async () => {
    const t = await h.createTenant({
      vatRegistered: false,
      companyColumns: { einvoice_tin: BUYER_TIN, einvoice_partner: "acube" },
    });
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
      activatedAt: null,
    });
    const matching = await enqueueReceived(t.company.id, { documentId: "legacy-link-matching" });
    const other = await enqueueReceived(t.company.id, { documentId: "legacy-link-other" });
    await h.sql(
      `UPDATE einvoice_provider_events
          SET status = 'ignored', attempts = 1, last_error = 'legal entity is not active',
              processed_at = now() + interval '1 second'
        WHERE company_id = $1`,
      [t.company.id]
    );
    const provider = simulatedProvider(await incomingXml("SUP-ONBOARDED-TIN"));
    const foreign = simulatedProvider("", "foreign-provider-company");
    expect(await runProviderEvents({ id: matching.id!, provider })).toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });
    expect(await runProviderEvents({ id: other.id!, provider: foreign })).toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });
    expect(foreign.fetchSource).not.toHaveBeenCalled();
    expect(
      await h.sql("SELECT bill_number FROM vendor_bills WHERE company_id = $1", [t.company.id])
    ).toEqual([{ bill_number: "SUP-ONBOARDED-TIN" }]);
  });

  it("checks each provider ownership marker and the scheme-qualified source buyer", async () => {
    const t = await h.createTenant({
      vatRegistered: false,
      companyColumns: { einvoice_tin: BUYER_TIN, einvoice_partner: "acube" },
    });
    const { runProviderEvents, runProviderPoll } =
      await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const original = await incomingXml("SUP-CONTRADICTORY");
    const provider = simulatedProvider(original, OWNER, [
      {
        providerMessageId: "wrong-poll-tin",
        documentType: "380",
        legalEntityId: OWNER,
        ownerFiscalId: "1001111111",
      },
    ]);
    expect(await runProviderPoll("acube", { companyId: t.company.id, provider })).toEqual({
      refreshed: 0,
      enqueued: 0,
    });
    const contradictoryOwner = await enqueueReceived(t.company.id, {
      documentId: "wrong-owner-tin",
    });
    const wrongOwner = {
      ...provider,
      inboundOwner: async () => ({ legalEntityId: OWNER, tin: "1001111111" }),
    };
    await runProviderEvents({ id: contradictoryOwner.id!, provider: wrongOwner });
    expect(provider.fetchSource).not.toHaveBeenCalled();

    const contradictoryPayload = await enqueueReceived(t.company.id, {
      documentId: "wrong-payload-tin",
      ownerFiscalId: "1001111111",
    });
    await runProviderEvents({ id: contradictoryPayload.id!, provider });
    expect(provider.fetchSource).not.toHaveBeenCalled();

    const wrongScheme = await enqueueReceived(t.company.id, {
      documentId: "wrong-recipient-scheme",
    });
    const wrongEndpoint = simulatedProvider(
      original.replace(`schemeID="0235">${BUYER_TIN}`, `schemeID="0088">${BUYER_TIN}`)
    );
    await runProviderEvents({ id: wrongScheme.id!, provider: wrongEndpoint });
    expect(wrongEndpoint.fetchSource).toHaveBeenCalledTimes(1);
    expect(
      await h.sql("SELECT bill_number FROM vendor_bills WHERE company_id = $1", [t.company.id])
    ).toEqual([]);
  });

  it("settles a confirmed owner mismatch without fetching source or replaying on later activation", async () => {
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
    });
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

  it("parks a receipt if the verified legal entity is deactivated during the source fetch", async () => {
    const t = await h.createTenant({
      vatRegistered: false,
      companyColumns: { einvoice_tin: BUYER_TIN, einvoice_partner: "acube" },
    });
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    const setStatus = (status: "active" | "inactive") =>
      upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
        status,
        legalEntityId: OWNER,
      });
    await setStatus("active");
    const { id } = await enqueueReceived(t.company.id, { documentId: "source-fetch-race" });
    const xml = await incomingXml("SUP-SOURCE-FETCH-RACE");
    const provider = simulatedProvider(xml);
    provider.fetchSource.mockImplementationOnce(async () => {
      await setStatus("inactive");
      return xml;
    });
    const run = () => runProviderEvents({ id: id!, provider });
    expect(await run()).toEqual({ claimed: 1, processed: 0, failed: 0 });
    expect(
      await h.sql("SELECT id FROM einvoice_archive WHERE company_id = $1", [t.company.id])
    ).toEqual([]);
    expect(
      await h.sql("SELECT status, last_error FROM einvoice_provider_events WHERE id = $1", [id])
    ).toEqual([
      { status: "pending", last_error: "Inbound receipt is waiting for legal entity activation" },
    ]);
    await setStatus("active");
    await h.sql("UPDATE einvoice_provider_events SET next_attempt_at = now() WHERE id = $1", [id]);
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
  });
});

describe("e-invoice poll resource selection", () => {
  it.each(["before listing", "during listing"])(
    "does not discover receipts after the registered taxpayer changes %s",
    async (when) => {
      const t = await h.createTenant({
        companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
      });
      const { runProviderPoll } = await import("../../server/services/einvoice/provider-events");
      const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
      await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
        status: "active",
        legalEntityId: OWNER,
      });
      const changeTaxpayer = () =>
        h.sql("UPDATE companies SET trn_vat_number = $2 WHERE id = $1", [
          t.company.id,
          REPLACEMENT_TRN,
        ]);
      if (when === "before listing") await changeTaxpayer();
      const listInbound = vi.fn(async (): Promise<InboundListing[]> => {
        await changeTaxpayer();
        return [{ providerMessageId: "old-taxpayer", documentType: "380", legalEntityId: OWNER }];
      });
      const provider = { ...simulatedProvider(await incomingXml("SUP-OLD-TAXPAYER")), listInbound };
      expect(await runProviderPoll("acube", { companyId: t.company.id, provider })).toEqual({
        refreshed: 0,
        enqueued: 0,
      });
      expect(listInbound).toHaveBeenCalledTimes(when === "before listing" ? 0 : 1);
      expect(
        await h.sql("SELECT id FROM einvoice_provider_events WHERE company_id = $1", [t.company.id])
      ).toEqual([]);
    }
  );

  it("stops discovery across a provider switch and preserves its queued receipt without writing a bill", async () => {
    const t = await h.createTenant({
      vatRegistered: false,
      companyColumns: { einvoice_tin: BUYER_TIN, einvoice_partner: "acube" },
    });
    const { runProviderEvents, runProviderPoll } =
      await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const queued = await enqueueReceived(t.company.id, { documentId: "before-partner-switch" });
    const selectOther = () =>
      h.sql("UPDATE companies SET einvoice_partner = 'complyance' WHERE id = $1", [t.company.id]);
    const listInbound = vi.fn(async (): Promise<InboundListing[]> => {
      await selectOther();
      return [
        { providerMessageId: "after-partner-switch", documentType: "380", legalEntityId: OWNER },
      ];
    });
    const provider = { ...simulatedProvider(await incomingXml("SUP-PARTNER-SWITCH")), listInbound };
    const poll = () => runProviderPoll("acube", { companyId: t.company.id, provider });
    expect(await poll()).toEqual({ refreshed: 0, enqueued: 0 });
    expect(await poll()).toEqual({ refreshed: 0, enqueued: 0 });
    expect(listInbound).toHaveBeenCalledTimes(1);
    expect(await runProviderEvents({ id: queued.id!, provider })).toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });
    expect(provider.inboundOwner).not.toHaveBeenCalled();
    expect(
      await h.sql("SELECT status FROM einvoice_provider_events WHERE id = $1", [queued.id])
    ).toEqual([{ status: "ignored" }]);
    expect(
      await h.sql("SELECT id FROM vendor_bills WHERE company_id = $1", [t.company.id])
    ).toEqual([]);
    expect(
      await h.sql(
        "SELECT COUNT(*)::int AS count FROM einvoice_provider_events WHERE company_id = $1",
        [t.company.id]
      )
    ).toEqual([{ count: 1 }]);
  });

  it.each(["poll", "legacy event"])(
    "preserves the 261 credit-note collection from %s",
    async (discovery) => {
      const t = await h.createTenant({
        companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
      });
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
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
    });
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

  it("resumes an archived purchase when the provider switched during draft preparation", async () => {
    const { t, id, run, bills } = await purchase("SUP-SWITCH-BEFORE-POST", "provider-write-race");
    const registry = await import("../../server/platform/service-registry");
    type Prepare =
      typeof import("../../server/services/bill-payment.service").prepareDraftFromInbound;
    const prepare = registry.resolve<Prepare>("bills.prepareDraftFromInbound");
    const select = (partner: string) =>
      t.as.put(`/api/companies/${t.company.id}/einvoicing/partner`, { partner });
    registry.provide(
      "bills.prepareDraftFromInbound",
      (async (...args) => {
        const write = await prepare(...args);
        expect((await select("complyance")).status).toBe(200);
        return write;
      }) satisfies Prepare,
      { replace: true }
    );
    try {
      expect(await run()).toEqual({ claimed: 1, processed: 0, failed: 0 });
    } finally {
      registry.provide("bills.prepareDraftFromInbound", prepare, { replace: true });
    }
    expect(await bills()).toEqual([]);
    expect(
      await h.sql(
        "SELECT archive_id, status FROM einvoice_inbound_documents WHERE company_id = $1",
        [t.company.id]
      )
    ).toEqual([{ archive_id: expect.any(String), status: "received" }]);
    expect(await h.sql("SELECT status FROM einvoice_provider_events WHERE id = $1", [id])).toEqual([
      { status: "pending" },
    ]);

    expect((await select("acube")).status).toBe(200);
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(await bills()).toHaveLength(1);
  });

  it("keeps the archived receipt but never writes a bill after taxpayer re-selection during preparation", async () => {
    const { t, id, run, bills } = await purchase("SUP-CHANGED-BEFORE-POST", "taxpayer-write-race");
    const registry = await import("../../server/platform/service-registry");
    type Prepare =
      typeof import("../../server/services/bill-payment.service").prepareDraftFromInbound;
    const prepare = registry.resolve<Prepare>("bills.prepareDraftFromInbound");
    registry.provide(
      "bills.prepareDraftFromInbound",
      (async (...args) => {
        const write = await prepare(...args);
        await h.sql("UPDATE companies SET einvoice_tin = $2, trn_vat_number = $3 WHERE id = $1", [
          t.company.id,
          REPLACEMENT_TIN,
          REPLACEMENT_TRN,
        ]);
        return write;
      }) satisfies Prepare,
      { replace: true }
    );
    try {
      await run();
    } finally {
      registry.provide("bills.prepareDraftFromInbound", prepare, { replace: true });
    }
    expect(await bills()).toEqual([]);
    expect(
      await h.sql(
        "SELECT archive_id, bill_id FROM einvoice_inbound_documents WHERE company_id = $1",
        [t.company.id]
      )
    ).toEqual([{ archive_id: expect.any(String), bill_id: null }]);
    expect(await h.sql("SELECT status FROM einvoice_provider_events WHERE id = $1", [id])).toEqual([
      { status: "ignored" },
    ]);
  });

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

  it.each([
    { includeUuid: true, includeArchive: true },
    { includeUuid: false, includeArchive: true },
    { includeUuid: false, includeArchive: false },
  ])(
    "repairs a processed legacy event by linking its bill ($includeUuid UUID, $includeArchive archive)",
    async ({ includeUuid, includeArchive }) => {
      const number = "SUP-LEGACY-ORPHAN";
      const documentId = "legacy-orphan";
      const { t, id, xml, run, bills } = await purchase(number, documentId, includeUuid);
      const { parseInboundUbl, toInboundBill } =
        await import("../../server/services/einvoice/inbound");
      const { archiveEInvoiceXml, insertInboundDocument, sha256Hex } =
        await import("../../server/services/einvoice/store");
      const { createDraftFromInbound } = await import("../../server/services/bill-payment.service");
      const parsed = parseInboundUbl(xml);
      const original = (
        await createDraftFromInbound(t.company.id, t.user.id, toInboundBill(parsed))
      ).bill;
      const archive = includeArchive
        ? await archiveEInvoiceXml({
            companyId: t.company.id,
            direction: "inbound",
            kind: "received",
            documentNumber: number,
            documentType: parsed.typeCode,
            uuid: parsed.uuid,
            xml,
            providerMessageId: documentId,
          })
        : null;
      await insertInboundDocument({
        companyId: t.company.id,
        supplierKey: parsed.supplierTrn!,
        documentNumber: number,
        documentType: parsed.typeCode,
        uuid: parsed.uuid,
        sha256: sha256Hex(xml),
        status: "failed",
        archiveId: archive?.id ?? null,
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
          "SELECT status, bill_id, archive_id FROM einvoice_inbound_documents WHERE company_id = $1",
          [t.company.id]
        )
      ).toEqual([
        {
          status: "bill_created",
          bill_id: original.id,
          archive_id: archive?.id ?? expect.any(String),
        },
      ]);
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

  it("repairs missing archive linkage from an authenticated, byte-identical legacy receipt", async () => {
    const { t, id, run, bills } = await purchase("SUP-LEGACY-NO-ARCHIVE", "legacy-no-archive");
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    const [bill] = await bills();
    const [archive] = await h.sql(
      "SELECT archive_id FROM einvoice_inbound_documents WHERE company_id = $1",
      [t.company.id]
    );
    await h.sql("UPDATE einvoice_inbound_documents SET archive_id = NULL WHERE company_id = $1", [
      t.company.id,
    ]);
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(await bills()).toEqual([bill]);
    expect(
      await h.sql(
        "SELECT archive_id, bill_id FROM einvoice_inbound_documents WHERE company_id = $1",
        [t.company.id]
      )
    ).toEqual([{ ...archive, bill_id: bill.id }]);
    expect(id).toBeTruthy();
  });

  it("reattaches a legacy credit only to the debit note recorded for this receipt", async () => {
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
    });
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    const { createVendorCreditFromInbound } =
      await import("../../server/services/bill-payment.service");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const receipt = await enqueueReceived(t.company.id, {
      documentId: "legacy-credit-link",
      documentType: "credit-note",
    });
    const provider = simulatedProvider(await incomingXml("SUP-LEGACY-CREDIT-LINK", true));
    const run = () => runProviderEvents({ id: receipt.id!, provider });
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    const [row] = await h.sql<{ id: string }>(
      "SELECT id FROM einvoice_inbound_documents WHERE company_id = $1",
      [t.company.id]
    );
    const actual = await createVendorCreditFromInbound({
      companyId: t.company.id,
      actorId: t.user.id,
      inboundId: row.id,
      input: {},
    });
    await h.sql("UPDATE einvoice_inbound_documents SET debit_note_id = NULL WHERE id = $1", [
      row.id,
    ]);
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(
      await h.sql("SELECT status, debit_note_id FROM einvoice_inbound_documents WHERE id = $1", [
        row.id,
      ])
    ).toEqual([{ status: "credit_created", debit_note_id: actual.debitNote.id }]);
    expect(
      await h.sql("SELECT id FROM vendor_debit_notes WHERE company_id = $1", [t.company.id])
    ).toEqual([{ id: actual.debitNote.id }]);
  });

  it("preserves an unverifiable legacy credit without enabling a second conversion", async () => {
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: BUYER_TRN, einvoice_partner: "acube" },
    });
    const { runProviderEvents } = await import("../../server/services/einvoice/provider-events");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "active",
      legalEntityId: OWNER,
    });
    const receipt = await enqueueReceived(t.company.id, {
      documentId: "unmatched-credit-link",
      documentType: "credit-note",
    });
    const provider = simulatedProvider(await incomingXml("SUP-UNVERIFIED-CREDIT", true));
    const run = () => runProviderEvents({ id: receipt.id!, provider });
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    await h.sql(
      "UPDATE einvoice_inbound_documents SET status = 'credit_created', archive_id = NULL WHERE company_id = $1",
      [t.company.id]
    );
    expect(await run()).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(await run()).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(
      await h.sql(
        "SELECT status, archive_id, debit_note_id FROM einvoice_inbound_documents WHERE company_id = $1",
        [t.company.id]
      )
    ).toEqual([{ status: "credit_created", archive_id: expect.any(String), debit_note_id: null }]);
    expect(
      await h.sql("SELECT status, last_error FROM einvoice_provider_events WHERE id = $1", [
        receipt.id,
      ])
    ).toEqual([
      { status: "ignored", last_error: "Legacy credit requires administrator reconciliation" },
    ]);
  });
});

describe("e-invoice legal entity synchronization", () => {
  it("revisits an old early callback only when its exact scoped reservation is now known", async () => {
    const t = await h.createTenant({
      companyColumns: {
        einvoice_partner: "acube",
        trn_vat_number: `${BUYER_TIN}00003`,
      },
    });
    const { enqueueProviderEvent, runProviderEvents } =
      await import("../../server/services/einvoice/provider-events");
    const { getLegalEntity, upsertLegalEntity } =
      await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "reserved",
      legalEntityId: OWNER,
    });
    const old = async (legalEntityId: string) => {
      const { id } = await enqueueProviderEvent({
        provider: "acube",
        environment: "sandbox",
        companyId: t.company.id,
        type: "legal_entity.synchronized",
        eventId: `early-${legalEntityId}`,
        payload: { legalEntityId, action: "LINK" },
      });
      await h.sql(
        `UPDATE einvoice_provider_events SET status = 'ignored',
        last_error = 'legal entity not reserved by us' WHERE id = $1`,
        [id]
      );
    };
    await old("foreign-entity");
    await old(OWNER);
    const legalEntityPatch = vi.fn(async () => ({ status: "active", legalEntityId: OWNER }));
    expect(
      await runProviderEvents({
        companyId: t.company.id,
        provider: { ...simulatedProvider(""), legalEntityPatch },
      })
    ).toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });
    expect(legalEntityPatch).toHaveBeenCalledExactlyOnceWith(
      OWNER,
      { legalEntityId: OWNER, action: "LINK" },
      BUYER_TIN
    );
    expect((await getLegalEntity(t.company.id, "acube", "sandbox"))?.status).toBe("active");
  });

  it("keeps an old dead LINK and queued delivery durably waiting for the pinned configuration", async () => {
    const t = await h.createTenant({
      companyColumns: {
        einvoice_partner: "acube",
        trn_vat_number: `${BUYER_TIN}00003`,
      },
    });
    const { enqueueProviderEvent, runProviderEvents } =
      await import("../../server/services/einvoice/provider-events");
    const { getLegalEntity, upsertLegalEntity } =
      await import("../../server/services/einvoice/legal-entities");
    await upsertLegalEntity(t.company.id, "acube", "sandbox", BUYER_TIN, {
      status: "pending",
      legalEntityId: OWNER,
    });
    const link = await enqueueProviderEvent({
      provider: "acube",
      environment: "sandbox",
      companyId: t.company.id,
      type: "legal_entity.synchronized",
      eventId: "historical-link",
      payload: { legalEntityId: OWNER, action: "LINK", tin: BUYER_TIN },
    });
    const delivery = await enqueueProviderEvent({
      provider: "acube",
      environment: "sandbox",
      companyId: t.company.id,
      type: "document.delivered",
      eventId: "historical-delivery",
      payload: { documentId: "held-delivery" },
    });
    await h.sql(
      `UPDATE einvoice_provider_events SET attempts = 10, next_attempt_at = now(),
              status = CASE WHEN id = $1 THEN 'dead' ELSE 'pending' END,
              last_error = 'Provider event could not be processed'
        WHERE id IN ($1, $2)`,
      [link.id, delivery.id]
    );
    for (const item of [link, delivery]) {
      expect(await runProviderEvents({ id: item.id! })).toEqual({
        claimed: 1,
        processed: 0,
        failed: 0,
      });
      const [parked] = await h.sql(
        "SELECT status, last_error, next_attempt_at > now() AS scheduled FROM einvoice_provider_events WHERE id = $1",
        [item.id]
      );
      expect(parked).toEqual({
        status: "pending",
        last_error: "Provider event is waiting for provider configuration",
        scheduled: true,
      });
      await h.sql("UPDATE einvoice_provider_events SET next_attempt_at = now() WHERE id = $1", [
        item.id,
      ]);
    }
    const legalEntityPatch = vi.fn(async () => ({ status: "active", legalEntityId: OWNER }));
    const sandbox = { ...simulatedProvider(""), legalEntityPatch };
    const production = { ...sandbox, environment: "production" as const };
    expect(await runProviderEvents({ id: link.id!, provider: production })).toEqual({
      claimed: 0,
      processed: 0,
      failed: 0,
    });
    expect(legalEntityPatch).not.toHaveBeenCalled();
    expect((await getLegalEntity(t.company.id, "acube", "sandbox"))?.status).toBe("pending");
    expect(await runProviderEvents({ id: link.id!, provider: sandbox })).toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });
    expect(legalEntityPatch).toHaveBeenCalledTimes(1);
    expect((await getLegalEntity(t.company.id, "acube", "sandbox"))?.status).toBe("active");
  });

  it("keeps a verified old callback from mutating a replacement legal entity", async () => {
    const t = await h.createTenant({
      companyColumns: {
        einvoice_partner: "acube",
        trn_vat_number: `${BUYER_TIN}00003`,
      },
    });
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
