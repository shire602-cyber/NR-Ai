import { describe, it, expect } from "vitest";
import {
  buildEInvoiceDocument,
  submitEInvoice,
  refreshEInvoiceStatus,
} from "../../server/services/einvoice-submit.service";
import { MockEInvoiceProvider } from "../../server/services/einvoice-provider";
import {
  applyProviderOutcome,
  cancelEInvoice,
} from "../../server/services/einvoice-submit.service";
import { fixtureCompany, uaeBuyer } from "../fixtures/pint-ae/fixtures";

const company = fixtureCompany as any;
const ctx = { customer: uaeBuyer };
const lines = [
  {
    description: "Consulting",
    quantity: 2,
    unitPrice: 500,
    vatRate: 0.05,
    vatSupplyType: "standard_rated",
  },
] as any[];
const baseInvoice = (o: Record<string, unknown> = {}) =>
  ({
    id: "inv-1",
    number: "INV-2026-001",
    customerName: "Acme LLC",
    customerTrn: "100765432100003",
    date: new Date("2026-06-01"),
    dueDate: new Date("2026-07-01"),
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
  it.each([
    { field: "VAT", oldValue: ">50.00<", newValue: ">49.99<" },
    {
      field: "taxable base",
      oldValue: ">1000.00</cbc:TaxableAmount>",
      newValue: ">1000.01</cbc:TaxableAmount>",
    },
    {
      field: "line extension",
      oldValue: ">1000.00</cbc:LineExtensionAmount>",
      newValue: ">999.99</cbc:LineExtensionAmount>",
    },
  ])(
    "rebuilds an unsent stored document with stale $field and preserves its UUID",
    ({ oldValue, newValue }) => {
      const invoice = baseInvoice();
      const generated = buildEInvoiceDocument(invoice, lines, company, ctx);
      expect(generated.ok).toBe(true);
      if (!generated.ok) return;
      const stale = generated.xml.replaceAll(oldValue, newValue);
      expect(stale).not.toBe(generated.xml);
      const saved = {
        ...invoice,
        einvoiceXml: stale,
        einvoiceHash: "previous-hash",
        einvoiceUuid: generated.uuid,
      };
      expect(buildEInvoiceDocument(saved, lines, company, ctx)).toEqual(generated);
      expect(buildEInvoiceDocument(saved, lines, company, ctx, true)).toMatchObject({
        ok: true,
        xml: stale,
        hash: "previous-hash",
      });
    }
  );
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
      ctx,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // R07-13: the document passed XSD + schematron + rules before hand-off.
      expect(r.document.validation?.valid).toBe(true);
      expect(r.document.validation?.schematron.available).toBe(true);
      expect(r.handedOver).toBe(true);
      expect(r.document.attempts).toBe(1);
      expect(r.update.einvoiceStatus).toBe("submitted");
      expect(r.update.einvoiceProvider).toBe("mock");
      expect(r.providerMessageId).toMatch(/^mock-/);
      expect(r.update.einvoiceSubmittedAt).toBeInstanceOf(Date);
    }
  });

  it("blocks resubmitting an in-flight or accepted invoice", async () => {
    for (const status of ["submitted"]) {
      const r = await submitEInvoice({
        invoice: baseInvoice({ einvoiceStatus: status }),
        lines,
        company,
        provider: new MockEInvoiceProvider(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("EINVOICE_ALREADY_SUBMITTED");
    }
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
  it("advances submitted → cleared (R07-13)", async () => {
    const r = await refreshEInvoiceStatus({
      invoice: baseInvoice({ einvoiceStatus: "submitted", einvoiceProviderMessageId: "mock-u1" }),
      provider: new MockEInvoiceProvider(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.update.einvoiceStatus).toBe("cleared");
      expect(r.document.clearedAt).toBeInstanceOf(Date);
    }
  });

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
      provider: new MockEInvoiceProvider({
        outcome: "rejected",
        detail: "Buyer TRN invalid",
        reasons: [{ code: "ibr-132-ae", message: "Buyer TRN invalid", field: "IBT-048" }],
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.update.einvoiceStatus).toBe("rejected");
      expect(r.update.einvoiceStatusDetail).toBe("Buyer TRN invalid");
      expect(r.document.rejectionReasons).toEqual([
        { code: "ibr-132-ae", message: "Buyer TRN invalid", field: "IBT-048" },
      ]);
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

describe("R07-13 retries with backoff and cancellation", () => {
  it("schedules exponential retries for transport failures and stops after the budget", () => {
    const now = new Date("2027-01-15T10:00:00Z");
    const fail = { providerMessageId: "", status: "failed" as const, detail: "timeout" };
    const first = applyProviderOutcome(fail, 0, now);
    expect(first.attempts).toBe(1);
    expect(first.nextRetryAt?.toISOString()).toBe("2027-01-15T10:01:00.000Z");
    expect(applyProviderOutcome(fail, 2, now).nextRetryAt?.toISOString()).toBe(
      "2027-01-15T10:04:00.000Z"
    );
    expect(applyProviderOutcome(fail, 5, now).nextRetryAt).toBeNull();
  });

  it("never retries a business rejection", () => {
    const r = applyProviderOutcome(
      { providerMessageId: "m1", status: "rejected", detail: "BR-CO-15" },
      0,
      new Date()
    );
    expect(r.nextRetryAt).toBeNull();
    expect(r.rejectionReasons).toEqual([{ code: "ASP", message: "BR-CO-15" }]);
  });

  it("refuses to cancel a cleared invoice (credit note required)", async () => {
    const r = await cancelEInvoice({
      invoice: baseInvoice({ einvoiceStatus: "cleared", einvoiceProviderMessageId: "m1" }),
      provider: new MockEInvoiceProvider(),
      reason: "duplicate",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EINVOICE_CREDIT_NOTE_REQUIRED");
  });

  it("cancels a submitted document through the provider", async () => {
    const r = await cancelEInvoice({
      invoice: baseInvoice({ einvoiceStatus: "submitted", einvoiceProviderMessageId: "m1" }),
      provider: new MockEInvoiceProvider(),
      reason: "issued in error",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.update.einvoiceStatus).toBe("cancelled");
  });
});
