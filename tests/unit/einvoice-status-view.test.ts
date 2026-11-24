import { beforeEach, expect, it, vi } from "vitest";
import type { Company, EInvoiceDocument, Invoice } from "../../shared/schema";
import { einvoiceStatusView, projectEInvoiceDocument } from "../../server/services/einvoice/status-view";
import { sha256Hex } from "../../server/services/einvoice/store";

const mocks = vi.hoisted(() => ({
  document: vi.fn(),
  events: vi.fn(),
  journal: vi.fn(),
  revision: vi.fn(),
  configuration: vi.fn(),
  entity: vi.fn(),
  issues: vi.fn(),
  environment: vi.fn(),
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.journal }) }),
    }),
  },
}));
vi.mock("../../server/storage", () => ({
  storage: { getInvoiceLinesByInvoiceId: async () => [] },
}));
vi.mock("../../server/services/einvoice.service", () => ({
  validateForEInvoicing: mocks.issues,
}));
vi.mock("../../server/services/einvoice/context", () => ({
  loadEInvoiceContext: async () => ({ customer: null }),
}));
vi.mock("../../server/services/einvoice/store", async (original) => ({
  ...(await original<typeof import("../../server/services/einvoice/store")>()),
  getEInvoiceDocument: mocks.document,
}));
vi.mock("../../server/services/einvoice/history", () => ({ listDocumentEvents: mocks.events }));
vi.mock("../../server/services/einvoice/legal-entities", () => ({ getLegalEntity: mocks.entity }));
vi.mock("../../server/services/einvoice/legacy-tracking", async (original) => ({
  ...(await original<typeof import("../../server/services/einvoice/legacy-tracking")>()),
  inspectComplyanceRevision: mocks.revision,
  legacyTrackingAvailability: async () => null,
}));
vi.mock("../../server/services/einvoice/workflow", () => ({
  canRecoverAcubeSubmission: () => false,
}));
vi.mock("../../server/services/einvoice/providers/company-provider", () => ({
  companyProviderConfiguration: mocks.configuration,
}));
vi.mock("../../server/services/einvoice/providers/registry", () => ({
  providerModule: (provider: string | null) =>
    provider ? { id: provider, displayName: provider, environment: mocks.environment } : null,
}));

const now = new Date("2026-11-22T08:00:00Z");
const invoice = {
  id: "invoice",
  status: "sent",
  invoiceType: "invoice",
  date: now,
  einvoiceStatus: "not_generated",
} as Invoice;
const company = { id: "company", einvoicePartner: null } as Company;

function mockConnected(provider: string, status: string) {
  mocks.configuration.mockResolvedValue({ module: { id: provider }, environment: "sandbox" });
  mocks.entity.mockResolvedValue({ status });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.events.mockResolvedValue([]);
  mocks.journal.mockResolvedValue([]);
  mocks.revision.mockResolvedValue({ unresolved: false, canRepairClearance: false });
  mocks.configuration.mockResolvedValue(null);
  mocks.environment.mockReturnValue("sandbox");
  mocks.issues.mockReturnValue([]);
});

it("leaves an invoice without a connection in draft with transmission blocked", async () => {
  const view = await einvoiceStatusView(invoice, company, now);

  expect(view).toMatchObject({
    document: null,
    submissionState: "draft",
    transmission: { connected: false, block: "no_provider", canSubmit: false, canRefresh: false },
    rejection: null,
  });
  expect(view.checklist).toEqual([
    { key: "posted", state: "todo", at: null, code: null },
    { key: "validated", state: "todo", at: null, code: null },
    { key: "sent", state: "blocked", at: null, code: "no_provider" },
    { key: "reported", state: "not_applicable", at: null, code: "no_provider" },
  ]);
});

it.each([
  ["inactive", "legal_entity_delinked"],
  ["pending", "legal_entity_not_active"],
  ["active", null],
] as const)("checks the %s legal entity before allowing submission", async (status, block) => {
  mockConnected("complyance", status);
  mocks.journal.mockResolvedValue([{ date: "2026-11-22" }]);
  mocks.document.mockResolvedValue({
    status: "generated",
    validatedAt: now,
    validation: { valid: true },
    nextRetryAt: null,
  });

  const view = await einvoiceStatusView(
    { ...invoice, einvoiceStatus: "generated" },
    { ...company, einvoicePartner: "complyance" },
    now
  );

  expect(view.transmission).toMatchObject({ block, canSubmit: block === null });
  expect(view.checklist.slice(0, 2)).toEqual([
    { key: "posted", state: "done", at: "2026-11-22", code: null },
    { key: "validated", state: "done", at: now.toISOString(), code: null },
  ]);
});

it("blocks submission in a test environment and shows void invoice validation failures", async () => {
  mocks.environment.mockReturnValue("mock");
  mocks.issues.mockReturnValue([{ code: "BUYER_NAME_REQUIRED" }]);
  const view = await einvoiceStatusView(
    { ...invoice, status: "void" },
    { ...company, einvoicePartner: "acube" },
    now
  );
  expect(view.transmission).toMatchObject({ block: "test_provider", canSubmit: false });
  expect(view.checklist.slice(0, 2)).toMatchObject([
    { state: "failed", code: "INVOICE_VOID" },
    { state: "failed", code: "EINVOICE_VALIDATION_FAILED" },
  ]);
});

it("keeps a handed-off A-Cube invoice trackable after the selected provider changes", async () => {
  mockConnected("acube", "inactive");
  mocks.document.mockResolvedValue({
    provider: "acube",
    providerMessageId: "message",
    providerStatus: "delivered",
    status: "accepted",
    deliveryStatus: "delivered",
    deliveredAt: now,
    reportingStatus: "reported",
    reportedAt: now,
    validation: { valid: true, submission: { environment: "sandbox" } },
  });
  mocks.events.mockResolvedValue([
    {
      id: "delivery",
      track: "delivery",
      toStatus: "delivered",
      provider: "acube",
      providerStatus: "delivered",
      createdAt: now,
    },
    {
      id: "reporting",
      track: "reporting",
      fromStatus: "pending",
      toStatus: "reported",
      provider: "acube",
      code: "UNVERIFIED",
      message: "No reporting confirmation",
      createdAt: now,
    },
  ]);

  const view = await einvoiceStatusView(
    { ...invoice, einvoiceStatus: "accepted", einvoiceProvider: "acube", einvoiceProviderMessageId: "message" },
    { ...company, einvoicePartner: "complyance" },
    now
  );

  expect(view.submissionState).toBe("sent");
  expect(view.transmission).toMatchObject({
    provider: "acube",
    environment: "sandbox",
    block: "legal_entity_delinked",
    canSubmit: false,
    canRefresh: true,
    recipientAcknowledgement: "received",
  });
  expect(view.tracks.reporting).toMatchObject({ status: "pending", confirmationUnavailable: true });
  expect(view.events).toMatchObject([
    { id: "delivery", to: "delivered", recipientAcknowledgement: "received", environment: "sandbox" },
    { id: "reporting", to: "pending", confirmationUnavailable: true, code: null, message: null },
  ]);
});

it("requires reconciliation before sending or refreshing an invoice with conflicting receipts", async () => {
  mockConnected("complyance", "active");
  mocks.document.mockResolvedValue({
    provider: "complyance",
    providerMessageId: "document-reference",
    deliveryStatus: "delivered",
    validation: { submission: { environment: "sandbox" } },
  });

  const view = await einvoiceStatusView(
    { ...invoice, einvoiceStatus: "accepted", einvoiceProvider: "complyance", einvoiceProviderMessageId: "invoice-reference" },
    { ...company, einvoicePartner: "complyance" },
    now
  );

  expect(view.submissionState).toBe("needs_reconciliation");
  expect(view.tracks.delivery).toMatchObject({ status: "queued", confirmationUnavailable: true });
  expect(view.transmission).toMatchObject({ providerDocumentId: null, canSubmit: false, canRefresh: false });
});

it("requires a credit note when a production final rejection matches the frozen document", async () => {
  const xml = "<Invoice/>";
  const xmlHash = sha256Hex(xml);
  mockConnected("complyance", "active");
  mocks.document.mockResolvedValue({
    provider: "complyance",
    providerMessageId: "message",
    providerStatus: " FINAL_INVALID ",
    status: "rejected",
    deliveryStatus: "rejected",
    xmlHash,
    lastErrorCode: "COMPLYANCE_FINAL_INVALID",
    lastError: "Invalid tax reference",
    rejectionReasons: ["tax"],
    validation: { submission: { environment: "production", environmentVerifiedAt: now.toISOString() } },
  });

  const view = await einvoiceStatusView(
    {
      ...invoice,
      einvoiceStatus: "rejected",
      einvoiceProvider: "complyance",
      einvoiceProviderMessageId: "message",
      einvoiceXml: xml,
      einvoiceHash: xmlHash,
    },
    { ...company, einvoicePartner: "complyance" },
    now
  );

  expect(view.submissionState).toBe("rejected");
  expect(view.rejection).toMatchObject({
    environment: "production",
    creditNoteRequired: true,
    code: "COMPLYANCE_FINAL_INVALID",
    reasons: ["tax"],
    providerHoldsDocument: true,
    resubmittable: false,
  });
});

it("projects a scheduled retry as queued without exposing submission metadata", () => {
  const doc = {
    status: "failed",
    nextRetryAt: now,
    providerMessageId: null,
    validation: { valid: false, submission: { environment: "sandbox" } },
  } as EInvoiceDocument;
  const tracks = {
    delivery: "queued",
    reporting: "pending",
    reportingRequired: true,
  } as Parameters<typeof projectEInvoiceDocument>[1];

  expect(projectEInvoiceDocument(doc, tracks)).toMatchObject({
    status: "queued",
    environment: "sandbox",
    clearedAt: null,
    reportedAt: null,
    validation: { valid: false },
  });
});
