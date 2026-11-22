import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const trn = "100123456700003";
const tin = trn.slice(0, 10);

async function fixture() {
  const tenant = await h.createTenant({
    companyColumns: {
      einvoice_partner: "complyance",
      einvoice_scope: "b2b",
      einvoice_go_live_date: "2025-01-01",
      trn_vat_number: trn,
    },
  });
  const companyId = tenant.company.id;
  const { companyCredentialVariable, sealCompanyCredentials } =
    await import("../../server/services/einvoice/providers/company-credentials");
  for (const provider of ["acube", "complyance"] as const) {
    const binding = { companyId, provider, environment: "sandbox" as const };
    vi.stubEnv(
      companyCredentialVariable(binding),
      sealCompanyCredentials(
        binding,
        provider === "acube"
          ? { email: "sender@example.test", password: randomUUID() }
          : { apiKey: randomUUID() }
      )
    );
    await h.sql(
      `INSERT INTO einvoice_legal_entities (company_id, provider, environment, tin, status)
       VALUES ($1, $2, 'sandbox', $3, 'active')`,
      [companyId, provider, tin]
    );
  }
  vi.stubEnv("ACUBE_ENV", "sandbox");
  vi.stubEnv("COMPLYANCE_ENV", "sandbox");
  vi.stubEnv("ACUBE_LOGIN_URL", "http://127.0.0.1:1/login");
  vi.stubEnv("ACUBE_BASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("COMPLYANCE_BASE_URL", "http://127.0.0.1:1");
  const created = await tenant.as.post(`/api/companies/${companyId}/invoices`, {
    customerName: "Example buyer",
    customerTrn: "100200300400003",
    date: new Date().toISOString().slice(0, 10),
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Service", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(created.status, created.text).toBe(200);
  const invoiceId = created.body.id;
  const statusPath = `/api/invoices/${invoiceId}/einvoice/status`;
  return { tenant, companyId, invoiceId, statusPath };
}

afterEach(() => vi.unstubAllEnvs());

it.each([
  { rawStatus: null, delivery: "queued", unconfirmed: true },
  { rawStatus: " ", delivery: "queued", unconfirmed: true },
  { rawStatus: "historical_unrecognized_value", delivery: "queued", unconfirmed: true },
  { rawStatus: "delivery_error", delivery: "delivery_failed", unconfirmed: false },
  { rawStatus: "accepted", delivery: "delivered", unconfirmed: false },
])(
  "projects historical A-Cube delivery with provider status $rawStatus consistently",
  async ({ rawStatus, delivery, unconfirmed }) => {
    const { tenant, invoiceId, companyId, statusPath } = await fixture();
    const docId = randomUUID();
    await h.sql(
      `UPDATE invoices SET status = 'sent', einvoice_status = 'accepted', einvoice_provider = 'acube',
       einvoice_provider_message_id = $2 WHERE id = $1`,
      [invoiceId, docId]
    );
    await h.sql(
      `INSERT INTO einvoice_documents
       (company_id, invoice_id, status, provider, provider_message_id, delivery_status,
        provider_status, validation)
     VALUES ($1, $2, 'accepted', 'acube', $3, 'delivered', $4, $5::jsonb)`,
      [companyId, invoiceId, docId, rawStatus, { submission: { environment: "sandbox" } }]
    );
    await h.sql(
      `INSERT INTO einvoice_document_events
      (company_id, invoice_id, track, from_status, to_status, provider, provider_status, source)
     VALUES ($1, $2, 'delivery', 'sending', 'delivered', 'acube', $3, 'poll')`,
      [companyId, invoiceId, rawStatus]
    );
    const [batch, status] = await Promise.all([
      tenant.as.get(`/api/companies/${companyId}/einvoicing/compliance?invoiceIds=${invoiceId}`),
      tenant.as.get(statusPath),
    ]);
    expect(batch.status, batch.text).toBe(200);
    expect(status.status, status.text).toBe(200);
    expect(batch.body.documents).toMatchObject([{ invoiceId, deliveryStatus: delivery }]);
    expect(batch.body.items).toMatchObject([{ invoiceId, delivery }]);
    expect(status.body.tracks.delivery.status).toBe(delivery);
    expect(status.body.events).toMatchObject([{ track: "delivery", to: delivery }]);
    if (unconfirmed) {
      expect(batch.body.documents[0].deliveryConfirmationUnavailable).toBe(true);
      expect(batch.body.items[0].deliveryConfirmationUnavailable).toBe(true);
      expect(status.body.tracks.delivery.confirmationUnavailable).toBe(true);
      expect(status.body.events[0].confirmationUnavailable).toBe(true);
    }
  }
);

it("tracks a prior A-Cube receipt through its original configuration, not the selected provider", async () => {
  const { tenant, invoiceId, companyId, statusPath } = await fixture();
  const docId = randomUUID();
  await h.sql(
    `UPDATE invoices SET status = 'sent', einvoice_status = 'cleared', einvoice_provider = 'acube',
       einvoice_provider_message_id = $2 WHERE id = $1`,
    [invoiceId, docId]
  );
  await h.sql(
    `INSERT INTO einvoice_documents
       (company_id, invoice_id, status, provider, provider_message_id, delivery_status,
        reporting_status, provider_status, validation)
     VALUES ($1, $2, 'cleared', 'acube', $3, 'delivered', 'reported', 'delivered', $4::jsonb)`,
    [
      companyId,
      invoiceId,
      docId,
      JSON.stringify({ valid: true, submission: { environment: "sandbox" } }),
    ]
  );

  const status = await tenant.as.get(statusPath);
  expect(status.status, status.text).toBe(200);
  expect(status.body).toMatchObject({
    status: "submitted",
    submissionState: "sent",
    tracks: { reporting: { status: "pending" } },
    transmission: {
      provider: "acube",
      environment: "sandbox",
      connected: true,
      block: null,
      providerDocumentId: docId,
      recipientAcknowledgement: "received",
      canSubmit: false,
      canRefresh: true,
    },
  });

  await h.sql(`UPDATE einvoice_documents SET provider_status = 'processed' WHERE invoice_id = $1`, [
    invoiceId,
  ]);
  await h.sql(
    `INSERT INTO einvoice_document_events
      (company_id, invoice_id, track, from_status, to_status, provider, provider_status, source)
     VALUES ($1, $2, 'delivery', 'sending', 'delivered', 'acube', 'processed', 'poll')`,
    [companyId, invoiceId]
  );
  expect((await tenant.as.get(statusPath)).body).toMatchObject({
    status: "submitted",
    submissionState: "sent",
    tracks: { delivery: { status: "sending" }, reporting: { status: "pending" } },
    transmission: { recipientAcknowledgement: null, canRefresh: true },
    events: [{ track: "delivery", to: "sending", providerStatus: "processed" }],
  });

  await h.sql(`UPDATE einvoice_documents SET provider_status = 'accepted' WHERE invoice_id = $1`, [
    invoiceId,
  ]);
  expect((await tenant.as.get(statusPath)).body).toMatchObject({
    status: "accepted",
    submissionState: "accepted",
    tracks: { reporting: { status: "pending" } },
    transmission: { recipientAcknowledgement: "accepted" },
  });

  vi.stubEnv("ACUBE_ENV", "production");
  const environmentChanged = await tenant.as.get(statusPath);
  expect(environmentChanged.status, environmentChanged.text).toBe(200);
  expect(environmentChanged.body.transmission).toMatchObject({
    provider: "acube",
    environment: "sandbox",
    connected: false,
    block: "no_provider",
    canRefresh: false,
  });
});

it("keeps a not-yet-sent queue pinned and shows that the original selection must be restored", async () => {
  const { tenant, invoiceId, companyId, statusPath } = await fixture();
  await h.sql(
    `UPDATE invoices SET status = 'sent', einvoice_status = 'queued', einvoice_provider = 'acube'
     WHERE id = $1`,
    [invoiceId]
  );
  await h.sql(
    `INSERT INTO einvoice_documents
       (company_id, invoice_id, status, provider, delivery_status, next_retry_at, validation)
     VALUES ($1, $2, 'generated', 'acube', 'queued', now(), $3::jsonb)`,
    [companyId, invoiceId, JSON.stringify({ valid: true, submission: { environment: "sandbox" } })]
  );

  const status = await tenant.as.get(statusPath);
  expect(status.status, status.text).toBe(200);
  expect(status.body).toMatchObject({
    status: "queued",
    submissionState: "queued",
    transmission: {
      provider: "acube",
      environment: "sandbox",
      block: "provider_selection_changed",
      canSubmit: false,
      canRefresh: false,
    },
  });
});
