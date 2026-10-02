import { describe, expect, it } from "vitest";
import {
  journalLinesForReturn,
  summariseVatJournalAdjustments,
  type VatJournalLineRow,
} from "../../server/services/vat-adjustments";
import { mapBooksToVatWorkpaperRows } from "../../server/services/firm-vat-workspace.service";
import { journalLinesForBoxes } from "../../client/src/components/vat/VatJournalLineRows";

// A manual journal that credits revenue AND output VAT 2020 in one entry is a taxable SALE: its net revenue goes to box 1
// amount and its VAT to box 1 VAT, once. A journal touching 2020 without a same-direction revenue line stays an adjustment.

const line = (over: Partial<VatJournalLineRow>): VatJournalLineRow => ({
  entryId: "e1",
  entryNumber: "JE-0001",
  description: "Consulting sold off-system",
  date: "2026-08-20",
  accountCode: "2020",
  accountType: "liability",
  debit: 0,
  credit: 0,
  ...over,
});
const sale = [
  line({ accountCode: "4010", accountType: "income", credit: 1000 }),
  line({ accountCode: "2020", credit: 50 }),
];

describe("summariseVatJournalAdjustments: taxable sales by journal", () => {
  it("Dr 1040 1,050 / Cr 4010 1,000 / Cr 2020 50 is box 1 amount +1,000 and VAT +50, with no output adjustment", () => {
    const s = summariseVatJournalAdjustments(sale, "dubai");
    expect(s.salesAmount).toBe(1000);
    expect(s.salesVat).toBe(50);
    expect(s.outputAdjustment).toBe(0);
    expect(s.lines).toEqual([]);
    expect(s.sales).toEqual([
      {
        kind: "journal_sale",
        entryId: "e1",
        entryNumber: "JE-0001",
        description: "Consulting sold off-system",
        date: "2026-08-20",
        side: "output",
        box: "box1bDubaiAmount",
        amount: 1000,
        vat: 50,
      },
    ]);
  });

  it("the sale lands in the amount column of the company's own emirate", () => {
    expect(summariseVatJournalAdjustments(sale, "sharjah").sales[0].box).toBe("box1cSharjahAmount");
  });

  it("the mirror entry (a reversal, both lines debited) is a negative sale", () => {
    const s = summariseVatJournalAdjustments(
      [line({ accountCode: "4010", accountType: "income", debit: 1000 }), line({ accountCode: "2020", debit: 50 })],
      "dubai"
    );
    expect([s.salesAmount, s.salesVat, s.outputAdjustment]).toEqual([-1000, -50, 0]);
  });

  it("a correction of declared tax (Dr 2020, no revenue line) stays an adjustment", () => {
    const s = summariseVatJournalAdjustments([line({ debit: 50 })], "dubai");
    expect([s.salesAmount, s.salesVat, s.outputAdjustment]).toEqual([0, 0, -50]);
    expect(s.sales).toEqual([]);
  });

  it("revenue and output VAT running opposite ways is not a sale (still an adjustment)", () => {
    const s = summariseVatJournalAdjustments(
      [line({ accountCode: "4010", accountType: "income", credit: 1000 }), line({ accountCode: "2020", debit: 50 })],
      "dubai"
    );
    expect([s.salesAmount, s.salesVat, s.outputAdjustment]).toEqual([0, 0, -50]);
  });

  it("an input VAT line in the same entry is still an input adjustment; the sale counts once", () => {
    const s = summariseVatJournalAdjustments([...sale, line({ accountCode: "1050", accountType: "asset", debit: 7 })], "dubai");
    expect([s.salesAmount, s.salesVat, s.inputAdjustment, s.outputAdjustment]).toEqual([1000, 50, 7, 0]);
  });

  it("sales and corrections add up independently across entries", () => {
    const s = summariseVatJournalAdjustments(
      [...sale, line({ entryId: "e2", entryNumber: "JE-0002", debit: 20 }), ...sale.map((l) => ({ ...l, entryId: "e3", entryNumber: "JE-0003" }))],
      "dubai"
    );
    expect([s.salesAmount, s.salesVat, s.outputAdjustment]).toEqual([2000, 100, -20]);
    expect(journalLinesForReturn(s).map((l) => l.entryNumber)).toEqual(["JE-0001", "JE-0002", "JE-0003"]);
  });
});

describe("summariseVatJournalAdjustments: fixed-asset disposal (t4's van)", () => {
  it("2,000 of VAT on a van sold for 40,000 is a 40,000 supply even though only the 9,000 GAIN is credited to revenue", () => {
    const s = summariseVatJournalAdjustments(
      [
        line({ accountCode: "1020", accountType: "asset", debit: 42000 }),
        line({ accountCode: "1240", accountType: "asset", debit: 29000 }),
        line({ accountCode: "1290", accountType: "asset", credit: 60000 }),
        line({ accountCode: "4080", accountType: "income", credit: 9000 }),
        line({ accountCode: "2020", credit: 2000 }),
      ],
      "abu_dhabi"
    );
    expect([s.salesAmount, s.salesVat, s.outputAdjustment]).toEqual([40000, 2000, 0]);
    expect(s.sales[0].box).toBe("box1aAbuDhabiAmount");
  });
});

const cost = (over: Partial<VatJournalLineRow>): VatJournalLineRow =>
  line({ accountCode: "5050", accountType: "expense", accountName: "Office Supplies", ...over });
const purchase = [cost({ debit: 500 }), line({ accountCode: "1050", accountType: "asset", debit: 25 }), line({ accountCode: "2070", credit: 525 })];

describe("summariseVatJournalAdjustments: purchases by journal", () => {
  it("Dr 5050 500 / Dr 1050 25 / Cr card 525 is box 9 amount 500 and VAT 25, with no input adjustment", () => {
    const s = summariseVatJournalAdjustments(purchase, "dubai");
    expect([s.purchasesAmount, s.purchasesVat, s.inputAdjustment]).toEqual([500, 25, 0]);
    expect(s.lines).toEqual([]);
    expect(s.purchases).toEqual([
      expect.objectContaining({ kind: "journal_purchase", box: "box9ExpensesAmount", amount: 500, vat: 25, blocked: false, entryNumber: "JE-0001" }),
    ]);
  });

  it("a fixed asset bought with input VAT (Dr 1290 40,000 / Dr 1050 2,000) is a purchase too", () => {
    const s = summariseVatJournalAdjustments(
      [line({ accountCode: "1290", accountType: "asset", accountSubType: "fixed_asset", debit: 40000 }), line({ accountCode: "1050", accountType: "asset", debit: 2000 })],
      "dubai"
    );
    expect([s.purchasesAmount, s.purchasesVat]).toEqual([40000, 2000]);
  });

  it("paying from the bank does not hide the cost: the settlement account is not a cost line", () => {
    const s = summariseVatJournalAdjustments(
      [cost({ debit: 500 }), line({ accountCode: "1050", accountType: "asset", debit: 25 }), line({ accountCode: "1020", accountType: "asset", credit: 525 })],
      "dubai"
    );
    expect([s.purchasesAmount, s.purchasesVat]).toEqual([500, 25]);
  });

  it("the reversal (both lines credited) is a negative purchase", () => {
    const s = summariseVatJournalAdjustments(
      [cost({ credit: 500 }), line({ accountCode: "1050", accountType: "asset", credit: 25 }), line({ accountCode: "1020", accountType: "asset", debit: 525 })],
      "dubai"
    );
    expect([s.purchasesAmount, s.purchasesVat]).toEqual([-500, -25]);
  });

  it("a VAT amount that is not 5% of the cost implies the consideration (box 9 is the standard-rated part)", () => {
    const s = summariseVatJournalAdjustments([cost({ debit: 1000 }), line({ accountCode: "1050", accountType: "asset", debit: 25 })], "dubai");
    expect([s.purchasesAmount, s.purchasesVat]).toEqual([500, 25]);
  });

  it("a blocked category (entertainment) is listed but counts nowhere: no box 9 amount, no VAT, no adjustment", () => {
    const s = summariseVatJournalAdjustments(
      [cost({ debit: 100, accountName: "Client Entertainment" }), line({ accountCode: "1050", accountType: "asset", debit: 5 })],
      "dubai"
    );
    expect([s.purchasesAmount, s.purchasesVat, s.inputAdjustment]).toEqual([0, 0, 0]);
    expect(s.purchases).toEqual([expect.objectContaining({ blocked: true, amount: 100, vat: 5 })]);
    expect(s.lines).toEqual([]);
  });

  it("an Arabic blocked category is blocked too", () => {
    const s = summariseVatJournalAdjustments(
      [cost({ debit: 100, accountName: "Gifts", accountNameAr: "ضيافة العملاء" }), line({ accountCode: "1050", accountType: "asset", debit: 5 })],
      "dubai"
    );
    expect(s.purchases[0].blocked).toBe(true);
  });

  it("a correction (Dr 1050, Cr expense) stays an input adjustment", () => {
    const s = summariseVatJournalAdjustments([line({ accountCode: "1050", accountType: "asset", debit: 30 }), cost({ credit: 30 })], "dubai");
    expect([s.purchasesAmount, s.purchasesVat, s.inputAdjustment]).toEqual([0, 0, 30]);
  });

  it("the purchase appears once in the lines the screen shows, with its blocked flag", () => {
    const s = summariseVatJournalAdjustments([...purchase, ...sale.map((l) => ({ ...l, entryId: "e9", entryNumber: "JE-0009" }))], "dubai");
    expect(journalLinesForReturn(s).map((l) => (l as any).kind)).toEqual(["journal_purchase", "journal_sale"]);
  });
});

describe("firm workspace books-pull", () => {
  const base = {
    invoices: [],
    invoiceLines: [],
    receipts: [],
    companyEmirate: "dubai",
    periodStart: new Date("2026-08-01T00:00:00Z"),
    periodEnd: new Date("2026-08-31T23:59:59Z"),
    existingSourceIds: new Set<string>(),
  };

  it("a taxable journal sale becomes a box 1 row (amount and VAT) and no adjustment row", () => {
    const rows = mapBooksToVatWorkpaperRows({ ...base, vatJournalLines: sale });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rowCategory: "standard_sale", taxableAmount: 1000, vatAmount: 50, sourceDocumentType: "journal_entry", invoiceNumber: "JE-0001" });
  });

  it("a journal purchase becomes a box 9 row; a blocked one gets no row", () => {
    const rows = mapBooksToVatWorkpaperRows({ ...base, vatJournalLines: purchase });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rowCategory: "standard_expense", taxableAmount: 500, vatAmount: 25, sourceDocumentType: "journal_entry" });
    const blocked = mapBooksToVatWorkpaperRows({
      ...base,
      vatJournalLines: [cost({ debit: 100, accountName: "Client Entertainment" }), line({ accountCode: "1050", accountType: "asset", debit: 5 })],
    });
    expect(blocked).toEqual([]);
  });

  it("vendor bills and credits become box 9 rows (a credit negative); a reverse-charge bill adds both legs", () => {
    const rows = mapBooksToVatWorkpaperRows({
      ...base,
      purchaseDocs: [
        { kind: "bill", id: "b1", date: "2026-08-10", number: "B-1", vendor: "Acme", vendorTrn: null, net: "1000", vat: "50", reverseCharge: false },
        { kind: "vendor_credit", id: "c1", date: "2026-08-12", number: "VCN-1", vendor: "Acme", vendorTrn: null, net: "-200", vat: "-10", reverseCharge: false },
        { kind: "bill", id: "b2", date: "2026-08-14", number: "B-2", vendor: "Abroad", vendorTrn: null, net: "400", vat: "20", reverseCharge: true },
      ],
    });
    expect(rows.map((r) => [r.sourceDocumentId, r.rowCategory, r.taxableAmount, r.vatAmount])).toEqual([
      ["b1", "standard_expense", 1000, 50],
      ["c1", "standard_expense", -200, -10],
      ["b2", "reverse_charge_input", 400, 20],
      ["b2", "reverse_charge_output", 400, 20],
    ]);
  });

  it("documents already pulled are skipped", () => {
    const rows = mapBooksToVatWorkpaperRows({
      ...base,
      existingSourceIds: new Set(["b1", "e1"]),
      vatJournalLines: sale,
      purchaseDocs: [{ kind: "bill", id: "b1", date: "2026-08-10", number: "B-1", vendor: "Acme", vendorTrn: null, net: "1000", vat: "50", reverseCharge: false }],
    });
    expect(rows).toEqual([]);
  });
});

describe("VAT return screen: journal lines under their boxes", () => {
  const lines = [
    { entryId: "e1", entryNumber: "JE-0001", box: "box1bDubaiAmount", amount: 1000, vat: 50, kind: "journal_sale" as const },
    { entryId: "e2", entryNumber: "JE-0002", box: "box1bDubaiAdj", amount: -20 },
    { entryId: "e3", entryNumber: "JE-0003", box: "box9ExpensesAdj", amount: 30 },
  ];
  it("picks the lines of a box's amount and adjustment columns", () => {
    expect(journalLinesForBoxes(lines, ["box1bDubaiAmount", "box1bDubaiAdj"]).map((l) => l.entryNumber)).toEqual(["JE-0001", "JE-0002"]);
    expect(journalLinesForBoxes(lines, ["box9ExpensesAdj"]).map((l) => l.entryNumber)).toEqual(["JE-0003"]);
    expect(journalLinesForBoxes(null, ["box9ExpensesAdj"])).toEqual([]);
  });
});
