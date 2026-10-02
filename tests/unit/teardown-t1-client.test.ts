/**
 * Teardown t1 / t2, client side: the pure rules behind the changed screens.
 * Zero-rated vs exempt, partial credit notes, opening stock, account names, Arabic server errors, the bank list, company address.
 */
import { describe, expect, it } from "vitest";
import { UAE_BANK_NAMES } from "../../server/services/company-setup-rules";
import { BANKS } from "../../client/src/components/banking/BankAccountDialog";
import { accountName } from "../../client/src/lib/account-name";
import { companyAddressLine } from "../../client/src/lib/company-address";
import {
  creditNoteBody,
  creditSelectionTotals,
  creditableLines,
  remainingCreditable,
  type CreditableInvoice,
} from "../../client/src/lib/credit-note";
import { SERVER_ERRORS_AR, localizeServerError } from "../../client/src/lib/server-errors";
import { SALES_ERROR_KEYS, isCashOrBankAccount, itemPayload, priceForProduct } from "../../client/src/lib/sales-api";
import { jobCreatedCount, salesEndpoints } from "../../client/src/lib/sales-endpoints";
import { vatChoiceOf, vatFieldsOf, vatFromSelectValue, vatSelectValue } from "../../client/src/lib/vat-choice";
import { openingStockPayload, openingStockTotal } from "../../client/src/components/inventory/OpeningStockCard";
import { statusText } from "../../client/src/components/ui/badge";

describe("0% is zero-rated or exempt, never just 0%", () => {
  it("a choice carries both the rate and the supply type", () => {
    expect(vatFieldsOf("standard_rated")).toEqual({ vatRate: 0.05, vatSupplyType: "standard_rated" });
    expect(vatFieldsOf("zero_rated")).toEqual({ vatRate: 0, vatSupplyType: "zero_rated" });
    expect(vatFieldsOf("exempt")).toEqual({ vatRate: 0, vatSupplyType: "exempt" });
  });
  it("a stored 0% line is shown as what it is; with no type it is zero-rated, never silently exempt", () => {
    expect(vatChoiceOf(0, "exempt")).toBe("exempt");
    expect(vatChoiceOf(0, "zero_rated")).toBe("zero_rated");
    expect(vatChoiceOf(0, null)).toBe("zero_rated");
    expect(vatChoiceOf(0.05, "exempt")).toBe("standard_rated");
    expect(vatChoiceOf("0.05")).toBe("standard_rated");
  });
  it("the select values round-trip", () => {
    for (const v of ["5", "0:zero_rated", "0:exempt"]) {
      const f = vatFromSelectValue(v);
      expect(vatSelectValue(f.vatRate, f.vatSupplyType)).toBe(v);
    }
    expect(vatFromSelectValue("0").vatSupplyType).toBe("zero_rated");
  });
  it("an exempt 0% line is sent with its supply type so it reaches box 5, a taxed line never carries one", () => {
    const line = { description: "x", quantity: 1, unitPrice: 100 };
    expect(itemPayload({ ...line, vatRate: 0, vatSupplyType: "exempt" })).toMatchObject({ vatRate: 0, vatSupplyType: "exempt" });
    expect(itemPayload({ ...line, vatRate: 0, vatSupplyType: "zero_rated" })).toMatchObject({ vatSupplyType: "zero_rated" });
    expect(itemPayload({ ...line, vatRate: 0.05, vatSupplyType: "exempt" })).not.toHaveProperty("vatSupplyType");
  });
  it("a line keeps its project through every save", () => {
    expect(itemPayload({ description: "x", quantity: 1, unitPrice: 1, vatRate: 0.05, projectId: "p1" })).toMatchObject({ projectId: "p1" });
    expect(itemPayload({ description: "x", quantity: 1, unitPrice: 1, vatRate: 0.05 })).toMatchObject({ projectId: null });
  });
});

describe("partial credit notes", () => {
  const invoice: CreditableInvoice = {
    id: "i1",
    number: "INV-1",
    currency: "AED",
    total: 997.5,
    creditedAmount: 0,
    lines: [
      { id: "l1", lineKind: "item", description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "percent", discountValue: 10 },
      { id: "l2", lineKind: "item", description: "Goods", quantity: 10, unitPrice: 20, vatRate: 0.05, productId: "prod" },
      { id: "l3", lineKind: "discount", description: "Discount", quantity: 1, unitPrice: -100, vatRate: 0.05 },
      { id: "l4", lineKind: "shipping", description: "Shipping", quantity: 1, unitPrice: 100, vatRate: 0.05 },
    ],
  };
  it("lists item and shipping lines only, at the price actually paid per unit", () => {
    const lines = creditableLines(invoice);
    expect(lines.map((l) => l.id)).toEqual(["l1", "l2", "l4"]);
    expect(lines[0].creditUnitPrice).toBe(900);
    expect(lines[1].creditableQty).toBe(10);
  });
  it("shows what is still creditable: total less what earlier credit notes took", () => {
    expect(remainingCreditable(invoice)).toBe(997.5);
    expect(remainingCreditable({ total: 997.5, creditedAmount: 200 })).toBe(797.5);
    expect(remainingCreditable({ total: 100, creditedAmount: 100 })).toBe(0);
    expect(remainingCreditable({ total: 100, creditedAmount: 120 })).toBe(0);
  });
  it("previews net, VAT and gross of the lines and quantities picked", () => {
    const lines = creditableLines(invoice);
    const picked = creditSelectionTotals([{ line: lines[1], quantity: 4 }, { line: lines[0], quantity: 0 }]);
    expect(picked).toEqual({ subtotal: 80, vat: 4, total: 84 });
  });
  it("each credited line names the original line it credits; a whole credit sends no lines", () => {
    const lines = creditableLines(invoice);
    const body = creditNoteBody({ mode: "lines", choices: [{ line: lines[1], quantity: 4 }, { line: lines[0], quantity: 0 }], date: "2026-09-10", restock: true, reason: " damaged " });
    expect(body).toMatchObject({ date: "2026-09-10", restock: true, reason: "damaged" });
    expect((body as { lines: unknown[] }).lines).toEqual([{ description: "Goods", quantity: 4, unitPrice: 20, vatRate: 0.05, originalLineId: "l2" }]);
    const whole = creditNoteBody({ mode: "whole", choices: [], date: "2026-09-10", restock: false });
    expect(whole).toEqual({ date: "2026-09-10" });
  });
  it("a 0% exempt line is credited as exempt", () => {
    const inv: CreditableInvoice = { ...invoice, lines: [{ id: "x", lineKind: "item", description: "Rent", quantity: 1, unitPrice: 500, vatRate: 0, vatSupplyType: "exempt" }] };
    const [line] = creditableLines(inv);
    const body = creditNoteBody({ mode: "lines", choices: [{ line, quantity: 1 }], date: "2026-09-10", restock: false }) as { lines: Array<Record<string, unknown>> };
    expect(body.lines[0]).toMatchObject({ vatRate: 0, vatSupplyType: "exempt", originalLineId: "x" });
  });
});

describe("opening stock", () => {
  it("only items with a quantity are sent; the value is quantity x cost", () => {
    const stock = { a: { quantity: "200", unitCost: "18" }, b: { quantity: "", unitCost: "5" }, c: { quantity: "0", unitCost: "9" } };
    expect(openingStockPayload(stock)).toEqual([{ productId: "a", quantity: 200, unitCost: 18 }]);
    expect(openingStockTotal(stock)).toBe(3600);
  });
});

describe("the movement of stock and ledger accounts", () => {
  it("1025 Payment Gateway Clearing is a payment account", () => {
    expect(isCashOrBankAccount({ code: "1025", type: "asset", nameEn: "Payment Gateway Clearing" })).toBe(true);
    expect(isCashOrBankAccount({ code: "1040", type: "asset", nameEn: "Accounts Receivable" })).toBe(false);
  });
  it("shows the Arabic name when the account has one", () => {
    expect(accountName({ nameEn: "Bank Accounts", nameAr: "الحسابات البنكية" }, "ar")).toBe("الحسابات البنكية");
    expect(accountName({ nameEn: "Bank Accounts", nameAr: "الحسابات البنكية" }, "en")).toBe("Bank Accounts");
    // a standard name without its own Arabic name still reads in Arabic; a custom name stays as typed
    expect(accountName({ nameEn: "Bank Accounts", nameAr: null }, "ar")).toBe("الحسابات البنكية");
    expect(accountName({ nameEn: "Travel & Meals", nameAr: null }, "ar")).toBe("السفر والوجبات");
    expect(accountName({ nameEn: "Falcon Escrow", nameAr: null }, "ar")).toBe("Falcon Escrow");
    expect(accountName(null, "ar")).toBe("");
  });
});

describe("setup lists match the server", () => {
  it("offers exactly the banks the server accepts", () => {
    expect([...BANKS]).toEqual([...UAE_BANK_NAMES]);
  });
});

describe("Arabic server errors", () => {
  it("every message is Arabic", () => {
    for (const [code, text] of Object.entries(SERVER_ERRORS_AR)) expect(text, code).toMatch(/[؀-ۿ]/);
  });
  it("a known code reads in Arabic; an unknown code keeps the server's sentence; English is untouched", () => {
    expect(localizeServerError("FLAT_RATE_NOT_SUPPORTED", "The UAE has no Flat Rate VAT scheme.", "ar")).toMatch(/[؀-ۿ]/);
    expect(localizeServerError("SOMETHING_NEW", "The server says no.", "ar")).toBe("The server says no.");
    expect(localizeServerError("FLAT_RATE_NOT_SUPPORTED", "The UAE has no Flat Rate VAT scheme.", "en")).toBe("The UAE has no Flat Rate VAT scheme.");
    expect(localizeServerError(undefined, "plain", "ar")).toBe("plain");
  });
  it("the sales codes use the shared sales table", () => {
    expect(localizeServerError("ADVANCE_EXCEEDED", "raw", "en")).not.toBe("raw");
    expect(Object.keys(SALES_ERROR_KEYS)).toContain("ADVANCE_EXCEEDED");
  });
});

describe("company address and job results", () => {
  it("prints the single-line address, or street, city and country", () => {
    expect(companyAddressLine({ businessAddress: "Office 1, Sharjah" })).toBe("Office 1, Sharjah");
    expect(companyAddressLine({ addressStreet: "Al Wahda St", addressCity: "Sharjah", addressCountry: "AE" })).toBe("Al Wahda St, Sharjah, AE");
    expect(companyAddressLine({})).toBe("");
    expect(companyAddressLine(null)).toBe("");
  });
  it("reads how many records a run-now call created", () => {
    expect(jobCreatedCount({ generated: 2 })).toBe(2);
    expect(jobCreatedCount({ created: 1 })).toBe(1);
    expect(jobCreatedCount({ invoices: [{}, {}, {}] })).toBe(3);
    expect(jobCreatedCount({})).toBe(0);
    expect(jobCreatedCount(null)).toBe(0);
  });
  it("action endpoints are built in one place", () => {
    expect(salesEndpoints.runRecurringNow("c")).toBe("/api/companies/c/recurring-invoices/run-now");
    expect(salesEndpoints.runLateFeesNow("c")).toBe("/api/companies/c/late-fees/run-now");
    expect(salesEndpoints.refundPayment("c", "i")).toBe("/api/companies/c/invoices/i/payment-refunds");
  });
});

describe("statuses in the reader's language", () => {
  it("knows partial, cancelled and the rest; leaves an unknown status as it is", () => {
    expect(statusText("partial")).toBe("Partially paid");
    expect(statusText("paid")).toBe("Paid");
    expect(statusText("PARTIAL")).toBe("Partially paid");
    expect(statusText("weird")).toBe("weird");
    expect(statusText(null)).toBe("");
  });
});

describe("price list lookups stay as before", () => {
  it("the list price wins", () => {
    expect(priceForProduct("p", 100, { priceListId: "l", prices: { p: 80 } })).toEqual({ unitPrice: 80, priceListId: "l" });
  });
});
