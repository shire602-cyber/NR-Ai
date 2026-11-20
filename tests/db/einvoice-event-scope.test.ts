import { expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";
import type { EInvoiceProvider } from "../../server/services/einvoice-provider";

const h = useHarness();
const providerDocumentUuid = "01a0ab23-24d8-7787-bd01-883b1b089b00";

async function submittedInvoice(tenant: Tenant, environment: "production" | "sandbox") {
  const created = await tenant.as.post(`/api/companies/${tenant.company.id}/invoices`, {
    customerName: "Example buyer",
    date: new Date().toISOString().slice(0, 10),
    lines: [{ description: "Service", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(created.status, created.text).toBe(200);
  const { id } = created.body;
  await h.sql(
    `UPDATE invoices SET einvoice_status = 'submitted', einvoice_provider = 'acube',
       einvoice_provider_message_id = $2 WHERE id = $1`,
    [id, providerDocumentUuid]
  );
  await h.sql(
    `INSERT INTO einvoice_documents
       (company_id, invoice_id, status, provider, provider_message_id, delivery_status, validation)
     VALUES ($1, $2, 'submitted', 'acube', $3, 'sending', $4::jsonb)`,
    [
      tenant.company.id,
      id,
      providerDocumentUuid,
      JSON.stringify({ valid: true, submission: { environment } }),
    ]
  );
  return id as string;
}

function provider(environment: "sandbox" | "production") {
  const getStatus = vi.fn<EInvoiceProvider["getStatus"]>(async (providerMessageId) => ({
    providerMessageId,
    status: "accepted",
    delivery: "delivered",
  }));
  const simulated: EInvoiceProvider = {
    name: "acube",
    environment,
    capabilities: { submit: false, getStatus: true, receive: false, cancel: false },
    submit: async () => {
      throw new Error("Unexpected submit");
    },
    getStatus,
    receive: async () => [],
    cancel: async () => {
      throw new Error("Unexpected cancel");
    },
    parseWebhook: () => null,
  };
  return { simulated, getStatus };
}

it("scopes webhook deduplication and status re-reads to the verified company and environment", async () => {
  const a = await h.createTenant();
  const b = await h.createSecondTenant();
  const aInvoice = await submittedInvoice(a, "sandbox");
  const bInvoice = await submittedInvoice(b, "sandbox");
  const { enqueueProviderEvent, runProviderEvents } =
    await import("../../server/services/einvoice/provider-events");
  const event = {
    provider: "acube",
    environment: "sandbox",
    type: "document.delivered" as const,
    eventId: "same-event-id",
    payload: { documentId: providerDocumentUuid },
  };
  const first = await enqueueProviderEvent({ ...event, companyId: a.company.id });
  expect(first.duplicate).toBe(false);
  expect((await enqueueProviderEvent({ ...event, companyId: a.company.id })).duplicate).toBe(true);
  const other = await enqueueProviderEvent({ ...event, companyId: b.company.id });
  expect(other.duplicate).toBe(false);

  const { simulated, getStatus } = provider("sandbox");
  expect(await runProviderEvents({ id: first.id!, provider: simulated })).toMatchObject({
    claimed: 1,
    processed: 1,
  });
  expect(getStatus).toHaveBeenCalledExactlyOnceWith(providerDocumentUuid, { documentType: null });
  expect(
    (await h.sql(`SELECT status FROM einvoice_documents WHERE invoice_id = $1`, [aInvoice]))[0]
      .status
  ).not.toBe("submitted");
  expect(
    (await h.sql(`SELECT status FROM einvoice_documents WHERE invoice_id = $1`, [bInvoice]))[0]
      .status
  ).toBe("submitted");

  const wrongEnvironment = await enqueueProviderEvent({
    ...event,
    environment: "production",
    companyId: b.company.id,
  });
  const production = provider("production");
  expect(
    await runProviderEvents({ id: wrongEnvironment.id!, provider: production.simulated })
  ).toMatchObject({
    claimed: 1,
    failed: 1,
  });
  expect(production.getStatus).not.toHaveBeenCalled();
});

it("polls a manually selected company without opening another company's provider inbox", async () => {
  const a = await h.createTenant();
  const b = await h.createSecondTenant();
  await submittedInvoice(a, "sandbox");
  await submittedInvoice(b, "sandbox");
  const { runProviderPoll } = await import("../../server/services/einvoice/provider-events");
  const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
  await upsertLegalEntity(a.company.id, "acube", "sandbox", "1001111111", {
    status: "active",
    legalEntityId: "example-a",
  });
  await upsertLegalEntity(b.company.id, "acube", "sandbox", "1002222222", {
    status: "active",
    legalEntityId: "example-b",
  });
  const { simulated, getStatus } = provider("sandbox");
  const listInbound = vi.fn(async () => []);
  expect(
    await runProviderPoll("acube", {
      companyId: a.company.id,
      provider: { ...simulated, listInbound },
    })
  ).toEqual({
    refreshed: 1,
    enqueued: 0,
  });
  expect(getStatus).toHaveBeenCalledTimes(1);
  expect(listInbound).toHaveBeenCalledExactlyOnceWith({ legalEntityIds: ["example-a"] });
});
