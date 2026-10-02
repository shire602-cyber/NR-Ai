import { describe, it, expect } from "vitest";
import { accountTypeFrom, contactTypeFrom, normalizeRow, termsToDays, type RowContext } from "../../server/services/import/entities";
import { suggestMapping } from "../../server/services/import/presets";

const ctx = (over: Partial<RowContext["options"]> = {}, existing: Partial<RowContext["existing"]> = {}): RowContext => ({
  options: { dateFormat: "dd/MM/yyyy", numberFormat: "us", currency: "AED", defaultContactType: "customer", foldProfitAndLoss: true, ...over },
  existing: { keys: new Set(), accountsByCode: new Map(), accountsByName: new Map(), invoiceNumbers: new Set(), billNumbers: new Set(), ...existing },
  seen: new Set(),
});

describe("presets", () => {
  it("maps Zoho contact headers", () => {
    const m = suggestMapping("zoho", "contacts", ["Display Name", "EmailID", "Contact Type", "Billing City", "Payment Terms", "Created Time"]);
    expect(m).toMatchObject({ name: "Display Name", email: "EmailID", type: "Contact Type", city: "Billing City", paymentTermsDays: "Payment Terms" });
  });
  it("maps Xero starred headers without the star", () => {
    const m = suggestMapping("xero", "accounts", ["*Code", "*Name", "*Type", "Description"]);
    expect(m).toEqual({ code: "*Code", name: "*Name", type: "*Type", description: "Description" });
  });
  it("maps QuickBooks open-invoice headers", () => {
    const m = suggestMapping("quickbooks", "open_invoices", ["Date", "Num", "Customer", "Due date", "Open balance"]);
    expect(m).toMatchObject({ number: "Num", customer: "Customer", date: "Date", dueDate: "Due date", amount: "Open balance" });
  });
  it("never maps one column to two fields", () => {
    const m = suggestMapping("generic", "open_bills", ["Date", "Amount", "Vendor", "Number"]);
    const columns = Object.values(m);
    expect(new Set(columns).size).toBe(columns.length);
  });
  it("falls back to generic names for another source", () => {
    expect(suggestMapping("zoho", "contacts", ["Name", "Email"])).toMatchObject({ name: "Name", email: "Email" });
  });
});

describe("account types from source labels", () => {
  it.each([
    ["Bank", "asset", "current_asset"],
    ["Accounts Receivable", "asset", "current_asset"],
    ["Fixed Asset", "asset", "fixed_asset"],
    ["Non-current Asset", "asset", "fixed_asset"],
    ["Accounts Payable", "liability", "current_liability"],
    ["Credit Card", "liability", "current_liability"],
    ["Long Term Liabilities", "liability", "long_term_liability"],
    ["Equity", "equity", null],
    ["Other Income", "income", null],
    ["Revenue", "income", null],
    ["Cost of Goods Sold", "expense", null],
    ["Depreciation", "expense", null],
    ["Overhead", "expense", null],
  ])("%s", (label, type, subType) => {
    expect(accountTypeFrom(label)).toEqual({ type, subType });
  });
  it("rejects what it cannot place", () => {
    expect(accountTypeFrom("Banana")).toBeNull();
    expect(accountTypeFrom("")).toBeNull();
  });
});

describe("contact helpers", () => {
  it("reads contact types and payment terms", () => {
    expect(contactTypeFrom("Vendor", "customer")).toBe("vendor");
    expect(contactTypeFrom("Supplier", "customer")).toBe("vendor");
    expect(contactTypeFrom("", "vendor")).toBe("vendor");
    expect(contactTypeFrom("alien", "customer")).toBeNull();
    expect(termsToDays("Net 30")).toBe(30);
    expect(termsToDays("Due on receipt")).toBe(0);
    expect(termsToDays("")).toBeNull();
  });
});

describe("row normalisation", () => {
  const map = { name: "N", email: "E", trn: "T" };
  it("flags bad email and TRN, keeps good rows, de-duplicates inside the file", () => {
    const c = ctx();
    expect(normalizeRow("contacts", { N: "A", E: "a@b.co", T: "" }, map, c).action).toBe("create");
    expect(normalizeRow("contacts", { N: "A", E: "a@b.co", T: "" }, map, c).action).toBe("skip_duplicate");
    expect(normalizeRow("contacts", { N: "B", E: "nope", T: "" }, map, c).errors[0].code).toBe("EMAIL_INVALID");
    expect(normalizeRow("contacts", { N: "C", E: "", T: "123" }, map, c).errors[0].code).toBe("TRN_INVALID");
    expect(normalizeRow("contacts", { N: "", E: "", T: "" }, map, c).errors[0].code).toBe("NAME_REQUIRED");
  });
  it("recognises a TRN duplicate against existing contacts", () => {
    const c = ctx({}, { keys: new Set(["trn:100123456700003"]) });
    expect(normalizeRow("contacts", { N: "Other name", E: "", T: "100 1234 5670 0003" }, map, c).action).toBe("skip_duplicate");
  });
  const docMap = { number: "No", customer: "C", date: "D", dueDate: "Due", amount: "A", currency: "Cur", exchangeRate: "R" };
  it("open invoices: dates follow the chosen format and amounts must be positive", () => {
    const row = { No: "X1", C: "Acme", D: "03/04/2026", Due: "", A: "(1,000.50)", Cur: "", R: "" };
    expect(normalizeRow("open_invoices", row, docMap, ctx()).errors[0].code).toBe("AMOUNT_INVALID");
    const good = normalizeRow("open_invoices", { ...row, A: "1,000.50" }, docMap, ctx());
    expect(good.normalized).toMatchObject({ date: "2026-04-03", amount: 1000.5, currency: "AED", exchangeRate: 1 });
    const us = normalizeRow("open_invoices", { ...row, A: "5" }, docMap, ctx({ dateFormat: "MM/dd/yyyy" }));
    expect(us.normalized).toMatchObject({ date: "2026-03-04" });
  });
  it("a foreign-currency document needs a rate; a repeated number is an error", () => {
    const row = { No: "X1", C: "Acme", D: "2026-04-01", Due: "", A: "10", Cur: "USD", R: "" };
    const c = ctx();
    expect(normalizeRow("open_invoices", row, docMap, c).errors[0].code).toBe("RATE_REQUIRED");
    expect(normalizeRow("open_invoices", { ...row, R: "3.6725" }, docMap, c).action).toBe("create");
    expect(normalizeRow("open_invoices", { ...row, R: "3.6725" }, docMap, c).errors[0].code).toBe("NUMBER_DUPLICATE");
  });
  it("trial balance: resolves by code or name, folds P&L, reads signed balances", () => {
    const bank = { id: "1", code: "1010", nameEn: "Cash", type: "asset" };
    const sales = { id: "2", code: "4010", nameEn: "Product Sales", type: "income" };
    const c = ctx({}, { accountsByCode: new Map([["1010", bank], ["4010", sales]]), accountsByName: new Map([["cash", bank], ["product sales", sales]]) });
    const tbMap = { accountCode: "Code", accountName: "Name", debit: "Dr", credit: "Cr" };
    const r1 = normalizeRow("opening_tb", { Code: "1010", Name: "", Dr: "1,000.00", Cr: "" }, tbMap, c);
    expect(r1.normalized).toMatchObject({ accountCode: "1010", debit: 1000, credit: 0, foldedIntoRetainedEarnings: false });
    const r2 = normalizeRow("opening_tb", { Code: "", Name: "Product Sales", Dr: "", Cr: "(500)" }, tbMap, c);
    expect(r2.normalized).toMatchObject({ accountCode: "4010", debit: 500, credit: 0, foldedIntoRetainedEarnings: true });
    expect(normalizeRow("opening_tb", { Code: "9999", Name: "", Dr: "1", Cr: "" }, tbMap, c).errors[0].code).toBe("ACCOUNT_UNKNOWN");
    expect(normalizeRow("opening_tb", { Code: "1010", Name: "", Dr: "1", Cr: "" }, tbMap, c).errors[0].code).toBe("ACCOUNT_DUPLICATE");
    const bal = normalizeRow("opening_tb", { Code: "1010", B: "-250" }, { accountCode: "Code", balance: "B" }, ctx({}, { accountsByCode: new Map([["1010", bank]]) }));
    expect(bal.normalized).toMatchObject({ debit: 0, credit: 250 });
    const zero = normalizeRow("opening_tb", { Code: "1010", Name: "", Dr: "0", Cr: "" }, tbMap, ctx({}, { accountsByCode: new Map([["1010", bank]]) }));
    expect(zero.action).toBe("skip_duplicate");
  });
  it("trial balance without the roll-up refuses P&L rows", () => {
    const sales = { id: "2", code: "4010", nameEn: "Product Sales", type: "income" };
    const c = ctx({ foldProfitAndLoss: false }, { accountsByCode: new Map([["4010", sales]]) });
    expect(normalizeRow("opening_tb", { Code: "4010", Cr: "5" }, { accountCode: "Code", credit: "Cr" }, c).errors[0].code).toBe("ACCOUNT_NOT_BALANCE_SHEET");
  });
});
