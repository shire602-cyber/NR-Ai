import { describe, expect, it } from "vitest";
import { aggregateInvoiceLines, buildVat201Boxes } from "../../server/services/vat-autopilot.service";
import { calculateVatWorkpaperTotals, mapBooksToVatWorkpaperRows } from "../../server/services/firm-vat-workspace.service";
import { applyJournalAdjustmentsToBoxes, summariseVatJournalAdjustments } from "../../server/services/vat-adjustments";
import { buildGeneratedVatReturnValues } from "../../server/services/vat-return-payload.service";
import { aggregateReturnSalesLines } from "../../server/services/vat-sales-lines";
import { selectPeriodSalesDocuments } from "../../server/services/vat-document-effect";

// The three VAT engines (VAT 201 generator, autopilot, firm workpaper pull)
// each classified sales lines on their own and drifted apart on 0%
// out_of_scope lines. They now share classifyVatLineForReturn; this feeds the
// same lines through all three and demands identical boxes.

type Line = {
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatSupplyType: string | null;
};

const FIXTURE: Line[] = [
  { quantity: 1, unitPrice: 1000, vatRate: 0.05, vatSupplyType: "standard_rated" },
  { quantity: 2, unitPrice: 250, vatRate: 0.05, vatSupplyType: "out_of_scope" }, // taxed: payable
  { quantity: 1, unitPrice: 400, vatRate: 0.05, vatSupplyType: "exempt" }, // taxed: payable
  { quantity: 1, unitPrice: 300, vatRate: 0, vatSupplyType: "zero_rated" },
  { quantity: 1, unitPrice: 50, vatRate: 0, vatSupplyType: "standard_rated" }, // legacy 0%: zero-rated
  { quantity: 1, unitPrice: 75, vatRate: 0, vatSupplyType: null },
  { quantity: 1, unitPrice: 200, vatRate: 0, vatSupplyType: "exempt" },
  { quantity: 3, unitPrice: 500, vatRate: 0, vatSupplyType: "out_of_scope" }, // in none of Boxes 1-5
];

const EXPECTED = {
  standardAmount: 1000 + 500 + 400,
  standardVat: 50 + 25 + 20,
  zeroRatedAmount: 300 + 50 + 75,
  exemptAmount: 200,
};

function viaVatRoute(lines: Line[]) {
  const r = aggregateReturnSalesLines(
    lines.map((l) => ({ ...l, invoiceId: "i1" })),
    new Map([["i1", 1]])
  );
  return {
    standardAmount: r.standardRatedAmount,
    standardVat: r.standardRatedVat,
    zeroRatedAmount: r.zeroRatedAmount,
    exemptAmount: r.exemptAmount,
  };
}

function viaAutopilot(lines: Line[]) {
  const r = aggregateInvoiceLines(lines as any);
  return {
    standardAmount: r.standardRatedAmount,
    standardVat: r.standardRatedVat,
    zeroRatedAmount: r.zeroRatedAmount,
    exemptAmount: r.exemptAmount,
  };
}

function viaFirmWorkspace(lines: Line[]) {
  const rows = mapBooksToVatWorkpaperRows({
    invoices: [{ id: "i1", number: "INV-1", date: "2026-08-10", status: "sent" }],
    invoiceLines: lines.map((l) => ({ ...l, invoiceId: "i1" })),
    receipts: [],
    companyEmirate: "dubai",
    periodStart: new Date("2026-08-01T00:00:00Z"),
    periodEnd: new Date("2026-08-31T00:00:00Z"),
    existingSourceIds: new Set(),
  });
  const sum = (cat: string, key: "taxableAmount" | "vatAmount") =>
    rows.filter((r) => r.rowCategory === cat).reduce((s, r) => s + Number(r[key]), 0);
  return {
    standardAmount: sum("standard_sale", "taxableAmount"),
    standardVat: sum("standard_sale", "vatAmount"),
    zeroRatedAmount: sum("zero_rated_sale", "taxableAmount"),
    exemptAmount: sum("exempt_sale", "taxableAmount"),
  };
}

describe("the three VAT engines classify sales lines identically", () => {
  it("VAT 201 generator", () => expect(viaVatRoute(FIXTURE)).toEqual(EXPECTED));
  it("VAT autopilot", () => expect(viaAutopilot(FIXTURE)).toEqual(EXPECTED));
  it("firm VAT workpaper pull", () => expect(viaFirmWorkspace(FIXTURE)).toEqual(EXPECTED));

  it("identical box results for the same fixture", () => {
    const a = viaVatRoute(FIXTURE);
    expect(viaAutopilot(FIXTURE)).toEqual(a);
    expect(viaFirmWorkspace(FIXTURE)).toEqual(a);
  });

  it("ordinary standard / zero / exempt data is unchanged", () => {
    const ordinary: Line[] = [
      { quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" },
      { quantity: 1, unitPrice: 200, vatRate: 0, vatSupplyType: "zero_rated" },
      { quantity: 1, unitPrice: 300, vatRate: 0, vatSupplyType: "exempt" },
    ];
    const want = { standardAmount: 100, standardVat: 5, zeroRatedAmount: 200, exemptAmount: 300 };
    expect(viaVatRoute(ordinary)).toEqual(want);
    expect(viaAutopilot(ordinary)).toEqual(want);
    expect(viaFirmWorkspace(ordinary)).toEqual(want);
  });

  it("a credit note (negative lines) nets off in every engine", () => {
    const lines: Line[] = [
      { quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" },
      { quantity: -1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" },
    ];
    const zero = { standardAmount: 0, standardVat: 0, zeroRatedAmount: 0, exemptAmount: 0 };
    expect(viaVatRoute(lines)).toEqual(zero);
    expect(viaAutopilot(lines)).toEqual(zero);
    // the workpaper pull only emits rows for positive totals
    expect(viaFirmWorkspace(lines)).toEqual(zero);
  });
});

// ─── A void that crosses a period boundary ───────────────────────────────────
// Two August invoices of 1,000 + 5%, one of them voided on 29 September. A return reflects the
// documents as they stood in the period: August still shows both (the ledger for August holds
// both), September shows the cancellation as a negative line. All three engines, identical boxes.

describe("a void dated in a later period: identical boxes in every engine", () => {
  const invoices = [
    { id: "keep", number: "INV-1", date: "2026-08-10", status: "sent", voidedOn: null as string | null },
    { id: "voided", number: "INV-2", date: "2026-08-12", status: "void", voidedOn: "2026-09-29" as string | null },
    { id: "draft-void", number: "INV-3", date: "2026-08-14", status: "void", voidedOn: null as string | null }, // never posted
  ];
  const lines = invoices.map((i) => ({ invoiceId: i.id, quantity: 1, unitPrice: 1000, vatRate: 0.05, vatSupplyType: "standard_rated" }));
  const period = (start: string, end: string) => ({ periodStart: start, periodEnd: end });
  const AUG = period("2026-08-01", "2026-08-31");
  const SEP = period("2026-09-01", "2026-09-30");
  const OCT = period("2026-10-01", "2026-10-31");

  // each engine's own path: the shared selection, then that engine's aggregation
  const vat201 = (p: ReturnType<typeof period>) => {
    const sel = selectPeriodSalesDocuments({ invoices, lines, ...p });
    const r = aggregateReturnSalesLines(sel.lines as any, new Map(sel.invoices.map((i) => [i.id, 1])));
    return { standardAmount: r.standardRatedAmount, standardVat: r.standardRatedVat, zeroRatedAmount: r.zeroRatedAmount, exemptAmount: r.exemptAmount };
  };
  const autopilot = (p: ReturnType<typeof period>) => {
    const sel = selectPeriodSalesDocuments({ invoices, lines, ...p });
    const r = aggregateInvoiceLines(sel.lines as any);
    return { standardAmount: r.standardRatedAmount, standardVat: r.standardRatedVat, zeroRatedAmount: r.zeroRatedAmount, exemptAmount: r.exemptAmount };
  };
  const firm = (p: ReturnType<typeof period>) => {
    const rows = mapBooksToVatWorkpaperRows({
      invoices,
      invoiceLines: lines,
      receipts: [],
      companyEmirate: "dubai",
      periodStart: new Date(`${p.periodStart}T00:00:00Z`),
      periodEnd: new Date(`${p.periodEnd}T00:00:00Z`),
      existingSourceIds: new Set(),
    });
    const sum = (cat: string, key: "taxableAmount" | "vatAmount") =>
      rows.filter((r) => r.rowCategory === cat).reduce((s, r) => s + Number(r[key]), 0);
    return { standardAmount: sum("standard_sale", "taxableAmount"), standardVat: sum("standard_sale", "vatAmount"), zeroRatedAmount: sum("zero_rated_sale", "taxableAmount"), exemptAmount: sum("exempt_sale", "taxableAmount") };
  };

  it("August: both invoices are still supplies of August (box 12 = 100, not 50)", () => {
    const want = { standardAmount: 2000, standardVat: 100, zeroRatedAmount: 0, exemptAmount: 0 };
    expect(vat201(AUG)).toEqual(want);
    expect(autopilot(AUG)).toEqual(want);
    expect(firm(AUG)).toEqual(want);
  });

  it("September: the void is a negative line of 1,000 / -50 VAT", () => {
    const want = { standardAmount: -1000, standardVat: -50, zeroRatedAmount: 0, exemptAmount: 0 };
    expect(vat201(SEP)).toEqual(want);
    expect(autopilot(SEP)).toEqual(want);
    expect(firm(SEP)).toEqual(want);
  });

  it("October: nothing is left to report", () => {
    const zero = { standardAmount: 0, standardVat: 0, zeroRatedAmount: 0, exemptAmount: 0 };
    expect(vat201(OCT)).toEqual(zero);
    expect(autopilot(OCT)).toEqual(zero);
    expect(firm(OCT)).toEqual(zero);
  });

  it("the three periods together net to the one surviving invoice (1,000 / 50)", () => {
    const total = (f: typeof vat201) => [AUG, SEP, OCT].reduce((s, p) => s + f(p).standardVat, 0);
    expect(total(vat201)).toBe(50);
    expect(total(autopilot)).toBe(50);
    expect(total(firm)).toBe(50);
  });
});

// ─── A manual journal to the VAT accounts ────────────────────────────────────
// Dr 2020 50 ("Correct over-declared output VAT") in a period with 100 of output VAT and 20 of
// input VAT: every engine reports a -50 output adjustment in the company's emirate box, and boxes
// 12 / 13 / 14 = 50 / 20 / 30 with no hand edit.

describe("a manual VAT journal is an adjustment in every engine", () => {
  const journalLines = [
    { entryId: "je1", entryNumber: "JE-20260820-001", description: "Correct over-declared output VAT", date: "2026-08-20", accountCode: "2020", debit: 50, credit: 0 },
  ];
  const period = { periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-08-31T00:00:00Z") };
  const invoices = [{ id: "i1", number: "INV-1", date: "2026-08-10", status: "sent" }];
  const lines = [{ invoiceId: "i1", quantity: 2, unitPrice: 1000, vatRate: 0.05, vatSupplyType: "standard_rated" }];
  const receipts = [{ id: "r1", date: "2026-08-12", posted: true, amount: 400, vatAmount: 20, reverseCharge: false }];
  const pick = (b: Record<string, any>) => ({
    adj: b.box1bDubaiAdj, box8Adj: b.box8TotalAdj, box9Adj: b.box9ExpensesAdj, box11Adj: b.box11TotalAdj,
    box12: b.box12TotalDueTax, box13: b.box13RecoverableTax, box14: b.box14PayableTax,
  });
  const WANT = { adj: -50, box8Adj: -50, box9Adj: 0, box11Adj: 0, box12: 50, box13: 20, box14: 30 };

  it("VAT 201 generator", () => {
    const summary = summariseVatJournalAdjustments(journalLines, "dubai");
    const v = buildGeneratedVatReturnValues({
      companyId: "c", userId: "u", periodStart: period.periodStart, periodEnd: period.periodEnd, dueDate: new Date(),
      vatStagger: "monthly", emirateBreakdown: { box1bDubaiAmount: 2000, box1bDubaiVat: 100, box1bDubaiAdj: summary.outputAdjustment },
      zeroRatedAmount: 0, exemptAmount: 0, reverseChargeAmount: 0, reverseChargeVat: 0, reverseChargeVatRecoverable: 0,
      totalExpenses: 400, inputTax: 20, totalOutputAmount: 2000, totalOutputVat: 100, totalInputAmount: 400, totalInputVat: 20,
      outputAdjustment: summary.outputAdjustment, inputAdjustment: summary.inputAdjustment, vatAdjustments: summary.lines,
    });
    expect(pick(v as any)).toEqual(WANT);
    expect((v as any).vatAdjustments).toEqual([expect.objectContaining({ entryNumber: "JE-20260820-001", description: "Correct over-declared output VAT", amount: -50 })]);
  });

  it("VAT autopilot", () => {
    const base = buildVat201Boxes(
      { standardRatedAmount: 2000, standardRatedVat: 100, zeroRatedAmount: 0, exemptAmount: 0, reverseChargeAmount: 0, reverseChargeVat: 0, reverseChargeVatRecoverable: 0, totalExpenses: 400, inputVatRecoverable: 20 },
      "dubai"
    );
    expect(pick(applyJournalAdjustmentsToBoxes(base, summariseVatJournalAdjustments(journalLines, "dubai")) as any)).toEqual(WANT);
  });

  it("firm VAT workpaper pull", () => {
    const rows = mapBooksToVatWorkpaperRows({
      invoices, invoiceLines: lines, receipts, vatJournalLines: journalLines, companyEmirate: "dubai", existingSourceIds: new Set(), ...period,
    });
    const adj = rows.filter((r) => r.rowCategory === "manual_adjustment");
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ vat201Box: "box1bDubaiAdj", adjustmentAmount: -50, sourceDocumentId: "je1", invoiceNumber: "JE-20260820-001" });
    expect(adj[0].auditReason).toContain("Correct over-declared output VAT");
    const totals = calculateVatWorkpaperTotals(rows.map((r) => ({ ...r, status: "approved" })) as any);
    expect(pick(totals as any)).toEqual(WANT);
  });

  it("a second pull does not duplicate an adjustment already in the workpaper", () => {
    const rows = mapBooksToVatWorkpaperRows({
      invoices: [], invoiceLines: [], receipts: [], vatJournalLines: journalLines, companyEmirate: "dubai", existingSourceIds: new Set(["je1"]), ...period,
    });
    expect(rows).toHaveLength(0);
  });
});
