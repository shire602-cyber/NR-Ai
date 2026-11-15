import { describe, it, expect } from "vitest";
import {
  buildEInvoiceDocument,
  submitEInvoice,
  refreshEInvoiceStatus,
} from "../../server/services/einvoice-submit.service";
import { MockEInvoiceProvider } from "../../server/services/einvoice-provider";

const company = { name: "Pearl Trading LLC", trnVatNumber: "100123456700003", businessAddress: "Dubai" } as any;
const lines = [
  { description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 0.05, vatSupplyType: "standard_rated" },
] as any[];
const baseInvoice = (o: Record<string, unknown> = {}) =>
  ({
    id: "inv-1",
    number: "INV-2026-001",
    customerName: "Acme LLC",
    customerTrn: "100765432100003",
    date: new Date("2026-06-01"),
    currency: "AED",
    subtotal: 1000,
    vatAmount: 50,
    total: 1050,
    ...o,
  }) as any;

describe("buildEInvoiceDocument", () => {
  it("generates a document for a valid invoice", () => {
    const r = buildEInvoiceDocument(baseInvoice(), lines, company);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
  });
  it("returns issues for an invalid invoice (missing supplier TRN)", () => {
    const r = buildEInvoiceDocument(baseInvoice(), lines, { ...company, trnVatNumber: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.field === "company.trnVatNumber")).toBe(true);
  });
});

describe("submitEInvoice (with mock ASP)", () => {
  it("submits a valid invoice and returns a submitted status update", async () => {
    const r = await submitEInvoice({
      invoice: baseInvoice(),
      lines,
      company,
      provider: new MockEInvoiceProvider(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.update.einvoiceStatus).toBe("submitted");
      expect(r.update.einvoiceProvider).toBe("mock");
      expect(r.providerMessageId).toMatch(/^mock-/);
      expect(r.update.einvoiceSubmittedAt).toBeInstanceOf(Date);
    }
  });

  it("blocks resubmitting an already-accepted invoice", async () => {
    const r = await submitEInvoice({
      invoice: baseInvoice({ einvoiceStatus: "accepted" }),
      lines,
      company,
      provider: new MockEInvoiceProvider(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EINVOICE_ALREADY_ACCEPTED");
  });

  it("surfaces validation issues instead of submitting", async () => {
    const r = await submitEInvoice({
      invoice: baseInvoice(),
      lines,
      company: { ...company, trnVatNumber: null },
      provider: new MockEInvoiceProvider(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EINVOICE_VALIDATION_FAILED");
  });
});

describe("refreshEInvoiceStatus (with mock ASP)", () => {
  it("advances submitted → accepted", async () => {
    const r = await refreshEInvoiceStatus({
      invoice: baseInvoice({ einvoiceStatus: "submitted", einvoiceProviderMessageId: "mock-u1" }),
      provider: new MockEInvoiceProvider({ outcome: "accepted" }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.update.einvoiceStatus).toBe("accepted");
  });

  it("records a rejection with detail", async () => {
    const r = await refreshEInvoiceStatus({
      invoice: baseInvoice({ einvoiceStatus: "submitted", einvoiceProviderMessageId: "mock-u1" }),
      provider: new MockEInvoiceProvider({ outcome: "rejected", detail: "Buyer TRN invalid" }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.update.einvoiceStatus).toBe("rejected");
      expect(r.update.einvoiceStatusDetail).toBe("Buyer TRN invalid");
    }
  });

  it("errors when nothing was submitted", async () => {
    const r = await refreshEInvoiceStatus({
      invoice: baseInvoice(),
      provider: new MockEInvoiceProvider(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EINVOICE_NOT_SUBMITTED");
  });
});
