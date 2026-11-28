/**
 * X5 (J1 end-to-end defects): pure helpers behind the launch fixes. Behaviour tests on the
 * functions the pages and services call; the DB-backed flows are in tests/db/x5-j1-launch-fixes.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultPaymentAccountId,
  postablePaymentAccounts,
} from "../../client/src/lib/payment-accounts";
import { currencyChoices, rateToSend } from "../../client/src/lib/document-currency";
import {
  askLockReason,
  encodeLockReason,
  isOverridableSoftLock,
  registerLockReasonPrompter,
} from "../../client/src/lib/period-lock-reason";
import { einvoiceFieldHint } from "../../client/src/lib/einvoice-issues";
import { companyAddressLine, vatStaggerLabel } from "../../client/src/lib/company-address";
import { isUnpaidInvoice } from "../../client/src/pages/reports/model/reportWorkspace";
import { vatPeriodEnded } from "../../client/src/lib/vat-period";
import { statementClosingFils } from "../../server/services/dashboard-stats.service";
import { obligationsApplyFrom } from "../../server/services/compliance-obligations.service";
import { decodeLockReason } from "../../server/services/period-lock.service";

const accounts = [
  { id: "cash", code: "1010", type: "asset", subType: "cash" },
  { id: "bankHeader", code: "1020", type: "asset", subType: "bank" },
  { id: "enbd", code: "1021", type: "asset", subType: "bank", parentId: "bankHeader" },
  { id: "usd", code: "1022", type: "asset", subType: "bank", parentId: "bankHeader" },
  { id: "ar", code: "1040", type: "asset", subType: "receivable" },
  { id: "old", code: "1023", type: "asset", subType: "bank", isArchived: true },
];

describe("[J1-D1] payment account default", () => {
  it("offers only postable cash/bank leaves (no header, receivable or archived account)", () => {
    expect(postablePaymentAccounts(accounts).map((a) => a.code)).toEqual(["1010", "1021", "1022"]);
  });

  it("defaults to the primary bank account's GL, preferring the payment currency", () => {
    const banks = [
      { id: "b2", glAccountId: "usd", currency: "USD", createdAt: "2026-02-01" },
      { id: "b1", glAccountId: "enbd", currency: "AED", createdAt: "2026-01-01" },
    ];
    expect(defaultPaymentAccountId(accounts, banks)).toBe("enbd");
    expect(defaultPaymentAccountId(accounts, banks, { currency: "USD" })).toBe("usd");
    expect(defaultPaymentAccountId(accounts, banks, { method: "cash" })).toBe("cash");
  });

  it("falls back to 1020 only while it is a leaf (no managed bank account yet)", () => {
    const fresh = accounts.filter((a) => !a.parentId);
    expect(defaultPaymentAccountId(fresh, [])).toBe("bankHeader");
    expect(defaultPaymentAccountId(accounts, [])).toBe("enbd");
  });
});

describe("[J1-D2] document currency and rate", () => {
  it("lists the base currency first, then rated, then common currencies", () => {
    const list = currencyChoices("AED", [{ fromCurrency: "CNY", toCurrency: "AED" }]);
    expect(list.slice(0, 3)).toEqual(["AED", "CNY", "USD"]);
    expect(new Set(list).size).toBe(list.length);
  });

  it("sends a typed foreign rate only, rejects a malformed one", () => {
    expect(rateToSend("AED", "AED", "3.67")).toBeNull();
    expect(rateToSend("USD", "AED", "")).toBeNull();
    expect(rateToSend("USD", "AED", "3.6725")).toBe("3.6725");
    expect(rateToSend("USD", "AED", "3.6.7")).toBeUndefined();
    expect(rateToSend("USD", "AED", "0")).toBeUndefined();
  });
});

describe("[J1-D3] soft-lock override reason", () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });
  const refusal = {
    code: "PERIOD_SOFT_LOCKED",
    details: { lockedThrough: "2026-10-31", canOverride: true },
  };

  it("asks the registered dialog only for an overridable refusal", async () => {
    const asked: unknown[] = [];
    unregister = registerLockReasonPrompter(async (info) => {
      asked.push(info);
      return "  Supplier invoice arrived late  ";
    });
    expect(await askLockReason(refusal)).toBe("Supplier invoice arrived late");
    expect(asked).toEqual([{ lockedThrough: "2026-10-31" }]);
    expect(
      await askLockReason({ code: "PERIOD_SOFT_LOCKED", details: { canOverride: false } })
    ).toBeNull();
    expect(await askLockReason({ code: "PERIOD_LOCKED" })).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it("treats a cancelled or too-short reason as no reason", async () => {
    unregister = registerLockReasonPrompter(async () => "ab");
    expect(await askLockReason(refusal)).toBeNull();
    unregister();
    unregister = registerLockReasonPrompter(async () => null);
    expect(await askLockReason(refusal)).toBeNull();
    expect(isOverridableSoftLock(refusal)).toBe(true);
  });

  it("round-trips an Arabic reason through the Latin-1 header", () => {
    const header = encodeLockReason("فاتورة مورد متأخرة");
    expect(/^[\x20-\x7e]+$/.test(header)).toBe(true);
    expect(decodeLockReason(header)).toBe("فاتورة مورد متأخرة");
    expect(decodeLockReason("Auditor adjustment 100%")).toBe("Auditor adjustment 100%");
  });
});

describe("[J1-D4] obligations start with the books", () => {
  it("uses the later of the books start and registration / incorporation", () => {
    expect(obligationsApplyFrom("2026-11-17", "2025-01-01")).toBe("2026-11-17");
    expect(obligationsApplyFrom("2026-07-01", "2026-09-15", null)).toBe("2026-09-15");
    expect(obligationsApplyFrom("2026-07-01")).toBe("2026-07-01");
  });
});

describe("[J1-D5] statement closing balance", () => {
  it("picks the chain end among same-day lines regardless of row order", () => {
    // Opening 100,000.00; three lines on one day, running balance column.
    const lines = [
      { date: "2026-11-17", amountFils: 525_000, balanceFils: 10_525_000 },
      { date: "2026-11-17", amountFils: -105_000, balanceFils: 10_572_500 },
      { date: "2026-11-17", amountFils: 152_500, balanceFils: 10_677_500 },
      { date: "2026-11-16", amountFils: 0, balanceFils: 10_000_000 },
    ];
    // Shuffle: the chain is 100,000 -> 105,250 -> 106,775 -> 105,725.
    const chained = [
      { date: "2026-11-17", amountFils: -105_000, balanceFils: 10_572_500 },
      { date: "2026-11-17", amountFils: 525_000, balanceFils: 10_525_000 },
      { date: "2026-11-17", amountFils: 152_500, balanceFils: 10_677_500 },
    ];
    expect(statementClosingFils(10_000_000, chained)).toEqual({
      fils: 10_572_500,
      date: "2026-11-17",
    });
    expect(statementClosingFils(10_000_000, [...chained].reverse()).fils).toBe(10_572_500);
    expect(statementClosingFils(0, lines).date).toBe("2026-11-17");
  });

  it("falls back to opening + every line without a balance column", () => {
    const lines = [
      { date: "2026-11-17", amountFils: 500, balanceFils: null },
      { date: "2026-11-17", amountFils: -200, balanceFils: null },
    ];
    expect(statementClosingFils(1_000, lines)).toEqual({ fils: 1_300, date: "2026-11-17" });
    expect(statementClosingFils(1_000, [])).toEqual({ fils: 1_000, date: null });
  });
});

describe("[J1-D7] VAT period preview", () => {
  it("generates only once the period has ended (the server allows its last day)", () => {
    expect(vatPeriodEnded("2026-12-31", "2026-11-17")).toBe(false);
    expect(vatPeriodEnded("2026-09-30", "2026-11-17")).toBe(true);
    expect(vatPeriodEnded("2026-11-17", "2026-11-17")).toBe(true);
  });
});

describe("[J1-L2] company address and stagger", () => {
  it("joins street, city and country, with the legacy one-line address as fallback", () => {
    expect(
      companyAddressLine({
        addressStreet: "Office 12, Bay Square",
        addressCity: "Dubai",
        addressCountry: "AE",
      })
    ).toBe("Office 12, Bay Square, Dubai, United Arab Emirates");
    expect(
      companyAddressLine({ businessAddress: "Shop 3, Al Barsha, Dubai", addressCity: "Dubai" })
    ).toBe("Shop 3, Al Barsha, Dubai");
    expect(companyAddressLine({})).toBe("");
  });

  it("describes the quarterly stagger by its start months", () => {
    const m = (n: number) =>
      ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][n];
    expect(vatStaggerLabel("Quarterly", 2, m)).toBe("Quarterly (Feb, May, Aug, Nov)");
    expect(vatStaggerLabel("Monthly", 1, m)).toBe("Monthly");
  });
});

describe("[J1-L3] e-invoice hints", () => {
  it("names the field and where to fix it instead of the raw path", () => {
    expect(einvoiceFieldHint("company.addressCity")).toEqual({
      labelKey: "invoices.einvoiceField.city",
      whereKey: "invoices.einvoiceWhere.companyProfile",
      href: "/settings/company",
      ruleLabel: null,
    });
    expect(einvoiceFieldHint("lines[2].unitPrice").labelKey).toBe(
      "invoices.einvoiceField.linePrice"
    );
    expect(einvoiceFieldHint("customer.address").href).toBe("/contacts");
    expect(einvoiceFieldHint("PINT AE rule ibr-143-ae").ruleLabel).toBe("PINT AE rule ibr-143-ae");
    expect(einvoiceFieldHint("something.unknown")).toMatchObject({ labelKey: null, href: null });
  });

  it("links tax identity and payment fields to the controls that save them", () => {
    expect(einvoiceFieldHint("company.einvoiceTin").href).toBe(
      "/settings/company#company-tax-id-tin"
    );
    expect(einvoiceFieldHint("company.sellerIdCountry").href).toBe(
      "/settings/company#company-tax-id-seller-id-country"
    );
    expect(einvoiceFieldHint("company.tradeLicenceNo").href).toBe(
      "/settings/einvoicing#trade-licence"
    );
    expect(einvoiceFieldHint("company.einvoicePayeeIban").href).toBe("/settings/einvoicing#iban");
  });

  it("links a named buyer or invoice issue to its saved record", () => {
    const source = { contactId: "contact & id", invoiceId: "invoice-id" };
    expect(einvoiceFieldHint("customer.endpointId", source).href).toBe(
      "/contacts?open=contact%20%26%20id"
    );
    expect(einvoiceFieldHint("PINT AE rule ibr-144-ae", source).href).toBe(
      "/contacts?open=contact%20%26%20id"
    );
    expect(einvoiceFieldHint("invoice.dueDate", source).href).toBe("/invoices?open=invoice-id");
  });
});

describe("[J1-L5] unpaid invoices KPI", () => {
  it("does not count credit notes or invoices settled by credit", () => {
    expect(isUnpaidInvoice({ status: "sent", invoiceType: "credit_note" })).toBe(false);
    expect(isUnpaidInvoice({ status: "sent", invoiceType: "invoice", openBalanceBase: 0 })).toBe(
      false
    );
    expect(
      isUnpaidInvoice({ status: "partial", invoiceType: "invoice", openBalanceBase: 50 })
    ).toBe(true);
    expect(isUnpaidInvoice({ status: "paid", invoiceType: "invoice" })).toBe(false);
    expect(isUnpaidInvoice({ status: "sent" })).toBe(true);
  });
});
