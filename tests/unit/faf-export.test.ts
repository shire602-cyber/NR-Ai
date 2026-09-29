import { describe, expect, it } from "vitest";
import {
  csvNumber,
  csvText,
  fafSupplyTaxCode,
  fafPurchaseTaxCode,
  streamFaf,
  validateFafRange,
  type FafDataSource,
  type FafGlRow,
  type FafPurchaseRow,
  type FafSupplyRow,
  type FafTotals,
} from "../../server/services/faf-export.service";
import { FAF_BLOCKS, FAF_COLUMNS, FAF_FILE_VERSION, FAF_TAX_CODES } from "../../server/services/faf-format";

async function* batches<T>(rows: T[], size = 2): AsyncGenerator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

const purchase = (over: Partial<FafPurchaseRow> = {}): FafPurchaseRow => ({
  supplierName: "Al Noor Trading",
  supplierTrn: "100200300400003",
  invoiceDate: "2026-08-10",
  invoiceNumber: "B-1",
  permitNumber: null,
  lineNumber: 1,
  description: "Goods",
  valueAed: 400,
  vatAed: 20,
  taxCode: "SR",
  fcyCode: null,
  valueFcy: null,
  vatFcy: null,
  ...over,
});

const supply = (over: Partial<FafSupplyRow> = {}): FafSupplyRow => ({
  customerName: "Filing Co",
  customerTrn: null,
  invoiceDate: "2026-08-15",
  invoiceNumber: "INV-1",
  lineNumber: 1,
  description: "Service",
  valueAed: 1000,
  vatAed: 50,
  taxCode: "SR",
  country: "AE",
  fcyCode: null,
  valueFcy: null,
  vatFcy: null,
  ...over,
});

const gl = (over: Partial<FafGlRow> = {}): FafGlRow => ({
  transactionDate: "2026-08-15",
  accountId: "1040",
  accountName: "Accounts Receivable",
  description: "Invoice INV-1",
  name: "Filing Co",
  transactionId: "JE-20260815-001",
  sourceDocumentId: "doc-1",
  sourceType: "invoice",
  debit: 1050,
  credit: 0,
  balance: 0,
  ...over,
});

function source(p: FafPurchaseRow[], s: FafSupplyRow[], g: FafGlRow[], opening: Record<string, number> = {}): FafDataSource {
  return {
    purchases: () => batches(p),
    supplies: () => batches(s),
    ledger: () => batches(g),
    openingBalances: async () => new Map(Object.entries(opening)),
  };
}

const META = {
  companyName: "Muhasib Test LLC",
  trn: "100123456700003",
  from: "2026-08-01",
  to: "2026-08-31",
  createdOn: "2026-09-29",
  productVersion: "Muhasib.ai 1.0.0",
};

async function build(src: FafDataSource) {
  const totals: FafTotals = { purchases: { value: 0, vat: 0, count: 0 }, supplies: { value: 0, vat: 0, count: 0 }, ledger: { debit: 0, credit: 0, count: 0 } };
  let text = "";
  for await (const chunk of streamFaf(src, META, totals)) text += chunk;
  return { text, lines: text.split("\r\n"), totals };
}

describe("csvText", () => {
  it("leaves plain text alone and quotes what CSV requires", () => {
    expect(csvText("Al Noor")).toBe("Al Noor");
    expect(csvText("Smith, John")).toBe('"Smith, John"');
    expect(csvText('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvText("line1\nline2")).toBe('"line1\nline2"');
    expect(csvText(" padded ")).toBe('" padded "');
  });

  it("prefixes values a spreadsheet would run as formulas with a single quote", () => {
    expect(csvText("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvText("+971501234567")).toBe("'+971501234567");
    expect(csvText("-1+1")).toBe("'-1+1");
    expect(csvText("@cmd")).toBe("'@cmd");
    expect(csvText("\t=1")).toBe("'\t=1");
    // and still quotes when the guarded value needs it
    expect(csvText('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });

  it("keeps Arabic and null handling", () => {
    expect(csvText("شركة النور")).toBe("شركة النور");
    expect(csvText(null)).toBe("");
    expect(csvText(undefined)).toBe("");
  });
});

describe("csvNumber", () => {
  it("is always 2dp and never gets the formula prefix (credit notes are negative)", () => {
    expect(csvNumber(1000)).toBe("1000.00");
    expect(csvNumber(-100)).toBe("-100.00");
    expect(csvNumber(0.005)).toBe("0.01");
    expect(csvNumber(-0.004)).toBe("0.00");
    expect(csvNumber(Number.NaN)).toBe("0.00");
    expect(csvNumber(null)).toBe("");
  });
});

describe("tax code mapping", () => {
  it("maps supply classes to SR / ZR / ES / OS / RC", () => {
    expect(fafSupplyTaxCode({ klass: "standard", reverseCharge: false })).toBe(FAF_TAX_CODES.standardRated);
    expect(fafSupplyTaxCode({ klass: "zero_rated", reverseCharge: false })).toBe("ZR");
    expect(fafSupplyTaxCode({ klass: "exempt", reverseCharge: false })).toBe("ES");
    expect(fafSupplyTaxCode({ klass: "excluded", reverseCharge: false })).toBe("OS");
    expect(fafSupplyTaxCode({ klass: "zero_rated", reverseCharge: true })).toBe("RC");
  });

  it("purchases: reverse charge RC, import IG, VAT-bearing SR, otherwise OS", () => {
    expect(fafPurchaseTaxCode({ reverseCharge: true, isImport: false, vat: 5 })).toBe("RC");
    expect(fafPurchaseTaxCode({ reverseCharge: false, isImport: true, vat: 5 })).toBe("IG");
    expect(fafPurchaseTaxCode({ reverseCharge: false, isImport: false, vat: 5 })).toBe("SR");
    expect(fafPurchaseTaxCode({ reverseCharge: false, isImport: false, vat: 0 })).toBe("OS");
  });
});

describe("validateFafRange", () => {
  it("accepts a normal period and a full year", () => {
    expect(validateFafRange("2026-08-01", "2026-08-31")).toEqual({ ok: true, from: "2026-08-01", to: "2026-08-31" });
    expect(validateFafRange("2026-01-01", "2026-12-31").ok).toBe(true);
  });
  it("rejects missing, malformed, impossible and reversed dates with a code", () => {
    expect(validateFafRange(undefined, "2026-08-31")).toMatchObject({ ok: false, code: "FAF_RANGE_REQUIRED" });
    expect(validateFafRange("01/08/2026", "2026-08-31")).toMatchObject({ ok: false, code: "FAF_RANGE_INVALID" });
    expect(validateFafRange("2026-02-30", "2026-03-31")).toMatchObject({ ok: false, code: "FAF_RANGE_INVALID" });
    // month 13 makes Date invalid: must be a clean 400, never a thrown RangeError
    expect(validateFafRange("2026-13-01", "2026-03-31")).toMatchObject({ ok: false, code: "FAF_RANGE_INVALID" });
    expect(validateFafRange("2026-01-01", "9999-99-99")).toMatchObject({ ok: false, code: "FAF_RANGE_INVALID" });
    expect(validateFafRange("2026-09-01", "2026-08-01")).toMatchObject({ ok: false, code: "FAF_RANGE_INVALID" });
  });
  it("caps the range at one financial year with a clear message", () => {
    const r = validateFafRange("2025-01-01", "2026-12-31");
    expect(r).toMatchObject({ ok: false, code: "FAF_RANGE_TOO_LARGE" });
    expect((r as { message: string }).message).toMatch(/one financial year|366/);
  });
});

describe("streamFaf layout", () => {
  it("emits the four blocks in order, each with its header row from the constants module", async () => {
    const { lines } = await build(source([purchase()], [supply()], [gl()]));
    const at = (marker: string) => lines.indexOf(marker);
    expect(at(FAF_BLOCKS.company.start)).toBe(0);
    expect(at(FAF_BLOCKS.company.start)).toBeLessThan(at(FAF_BLOCKS.company.end));
    expect(at(FAF_BLOCKS.company.end)).toBeLessThan(at(FAF_BLOCKS.purchases.start));
    expect(at(FAF_BLOCKS.purchases.end)).toBeLessThan(at(FAF_BLOCKS.supplies.start));
    expect(at(FAF_BLOCKS.supplies.end)).toBeLessThan(at(FAF_BLOCKS.ledger.start));
    expect(at(FAF_BLOCKS.ledger.end)).toBeGreaterThan(at(FAF_BLOCKS.ledger.start));
    expect(lines[at(FAF_BLOCKS.company.start) + 1]).toBe(FAF_COLUMNS.company.join(","));
    expect(lines[at(FAF_BLOCKS.purchases.start) + 1]).toBe(FAF_COLUMNS.purchases.join(","));
    expect(lines[at(FAF_BLOCKS.supplies.start) + 1]).toBe(FAF_COLUMNS.supplies.join(","));
    expect(lines[at(FAF_BLOCKS.ledger.start) + 1]).toBe(FAF_COLUMNS.ledger.join(","));
  });

  it("company block: name, TRN, period, creation date, product version", async () => {
    const { lines } = await build(source([], [], []));
    expect(lines[2]).toBe("Muhasib Test LLC,100123456700003,2026-08-01,2026-08-31,2026-09-29,Muhasib.ai 1.0.0,"  + FAF_FILE_VERSION);
  });

  it("purchase and supply footers carry totals and the line count; credit notes are negative lines", async () => {
    const supplies = [
      supply({ lineNumber: 1, valueAed: 1000, vatAed: 50 }),
      supply({ invoiceNumber: "CN-1", lineNumber: 1, valueAed: -200, vatAed: -10, description: "Credit note" }),
      supply({ invoiceNumber: "INV-2", lineNumber: 1, valueAed: 300.5, vatAed: 0, taxCode: "ZR" }),
    ];
    const { text, totals } = await build(source([purchase(), purchase({ invoiceNumber: "B-2", valueAed: 99.99, vatAed: 5 })], supplies, []));
    expect(totals.supplies).toEqual({ value: 1100.5, vat: 40, count: 3 });
    expect(totals.purchases).toEqual({ value: 499.99, vat: 25, count: 2 });
    expect(text).toContain("CN-1,1,Credit note,-200.00,-10.00,SR,AE");
    expect(text).toContain(`${FAF_COLUMNS.purchasesFooter.join(",")}\r\n499.99,25.00,2`);
    expect(text).toContain(`${FAF_COLUMNS.suppliesFooter.join(",")}\r\n1100.50,40.00,3`);
  });

  it("foreign-currency documents show AED at the booked rate plus the foreign amounts", async () => {
    const usd = supply({ invoiceNumber: "INV-USD", valueAed: 3672.5, vatAed: 183.63, fcyCode: "USD", valueFcy: 1000, vatFcy: 50 });
    const { text } = await build(source([], [usd], []));
    expect(text).toContain("INV-USD,1,Service,3672.50,183.63,SR,AE,USD,1000.00,50.00");
  });

  it("guards text cells against spreadsheet formulas and quotes correctly", async () => {
    const evil = supply({ customerName: "=cmd|' /C calc'!A0", description: 'Line, with "quotes"' });
    const { text } = await build(source([], [evil], []));
    expect(text).toContain("'=cmd|' /C calc'!A0");
    expect(text).toContain('"Line, with ""quotes"""');
  });

  it("general ledger: running balance per account from the opening balance; totals balance", async () => {
    const rows = [
      gl({ accountId: "1040", debit: 1050, credit: 0, transactionId: "JE-1" }),
      gl({ accountId: "1040", debit: 0, credit: 200, transactionId: "JE-2" }),
      gl({ accountId: "4010", accountName: "Product Sales", debit: 0, credit: 1000, transactionId: "JE-1" }),
      gl({ accountId: "2020", accountName: "VAT Payable", debit: 0, credit: 50, transactionId: "JE-1" }),
      gl({ accountId: "1020", accountName: "Bank", debit: 200, credit: 0, transactionId: "JE-2" }),
      gl({ accountId: "4010", accountName: "Product Sales", debit: 0, credit: 0, transactionId: "JE-2", description: "x" }),
    ];
    // ledger rows must arrive ordered by account (the DB source guarantees it); sort here as the source would
    rows.sort((a, b) => a.accountId.localeCompare(b.accountId));
    const { text, totals } = await build(source([], [], rows, { "1040": 500 }));
    expect(totals.ledger.count).toBe(6);
    expect(totals.ledger.debit).toBe(1250);
    expect(totals.ledger.credit).toBe(1250);
    // receivable: opening 500, +1050 = 1550, -200 = 1350
    expect(text).toMatch(/Accounts Receivable[^\r\n]*1050\.00,0\.00,1550\.00/);
    expect(text).toMatch(/Accounts Receivable[^\r\n]*0\.00,200\.00,1350\.00/);
    expect(text).toContain(`${FAF_COLUMNS.ledgerFooter.join(",")}\r\n1250.00,1250.00,6,AED`);
  });

  it("an empty period still produces every block with zero footers", async () => {
    const { text, totals } = await build(source([], [], []));
    expect(totals.purchases.count + totals.supplies.count + totals.ledger.count).toBe(0);
    expect(text).toContain(`${FAF_COLUMNS.purchasesFooter.join(",")}\r\n0.00,0.00,0`);
    expect(text).toContain(`${FAF_COLUMNS.ledgerFooter.join(",")}\r\n0.00,0.00,0,AED`);
  });

  it("preserves Arabic names as UTF-8", async () => {
    const { text } = await build(source([purchase({ supplierName: "شركة النور للتجارة" })], [], []));
    expect(text).toContain("شركة النور للتجارة");
  });
});
