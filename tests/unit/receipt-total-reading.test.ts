import { describe, expect, it } from "vitest";
import { parseReceiptOcrText } from "../../shared/receipt-ocr-parser";
import { normalizeOcrJson } from "../../server/services/ocr-extraction.service";

// Forward-fix of review 6098131504 on PR #244. Which line is the receipt's total, and which VAT
// lines are not VAT, decides the booked amount, so the figures here are exact.

const read = (text: string) => {
  const r = parseReceiptOcrText(text, { fallbackDate: "2026-01-01" });
  return {
    figures: [r.subtotal, r.vatAmount, r.total],
    issues: r.validationIssues.map((i) => i.code),
  };
};

describe("Net Total / Sub Total as the only total line", () => {
  it("Net Total is the total when it is the only total line (cash tendered is not)", () => {
    const r = read("Item 10.00\nNet Total 10.50\nVAT 0.50\nCash 100.00\nChange 89.50");
    expect(r.figures).toEqual([10, 0.5, 10.5]);
    expect(r.issues).toEqual([]);
  });

  it("the same Net Total receipt with a TRN and an AED prefix", () => {
    const r = read(
      "Kiosk\nTRN 100111222300003\nItem 10.00\nNet Total AED 10.50\nVAT 5% 0.50\nCash AED 100.00\nChange AED 89.50"
    );
    expect(r.figures).toEqual([10, 0.5, 10.5]);
  });

  it("Arabic net amount with cash and change lines keeps the printed total", () => {
    const r = read("متجر\nصافي المبلغ 10.50\nالضريبة 0.50\nنقدا 100.00\nالباقي 89.50");
    expect(r.figures).toEqual([10, 0.5, 10.5]);
  });

  it("a Net Total never beats an explicit Total Due / Total", () => {
    expect(read("Burger 40.00\nNet Total 40.00\nVAT 2.00\nTotal Due 42.00").figures).toEqual([
      40, 2, 42,
    ]);
    expect(read("Burger 40.00\nNet Total 40.00\nVAT 2.00\nTotal 42.00").figures).toEqual([
      40, 2, 42,
    ]);
  });

  it("a Sub Total with VAT and no total line is the net: total = sub total + VAT", () => {
    const r = read("Shop\nSub Total 100.00\nVAT 5.00\nCash 200.00\nChange 95.00");
    expect(r.figures).toEqual([100, 5, 105]);
  });

  it("a cash / card / change amount is never the total", () => {
    expect(read("Item 10.00\nCash 100.00\nChange 89.50").figures[2]).not.toBe(100);
    expect(read("Item 10.00\nCard 250.00").figures[2]).not.toBe(250);
    expect(read("Item 10.00\nPaid AED 80.00").figures[2]).not.toBe(80);
  });
});

describe("totals that are net figures", () => {
  it("Total Excluding VAT / Total Including VAT reads 100 / 5 / 105", () => {
    const r = read("Total Excluding VAT 100.00\nVAT 5.00\nTotal Including VAT 105.00");
    expect(r.figures).toEqual([100, 5, 105]);
    expect(r.issues).toEqual([]);
  });

  it.each([
    ["Total Excluding VAT 100\nVAT 5\nTotal Including VAT 105"],
    ["Total Exclusive of VAT 100.00\nVAT 5.00\nTotal 105.00"],
    ["Total Excl. VAT 100.00\nVAT 5.00\nTotal 105.00"],
    ["Total (excl. VAT) 100.00\nVAT 5.00\nTotal (incl. VAT) 105.00"],
    ["Total w/o VAT 100.00\nVAT 5.00\nTotal 105.00"],
    ["Total Without VAT 100.00\nVAT 5.00\nTotal 105.00"],
    ["Total Before Tax 100.00\nTax 5.00\nTotal 105.00"],
    ["Total before VAT 100.00\nVAT 5.00\nInvoice Total 105.00"],
  ])("English net line: %s", (text) => {
    expect(read(`Store\nTRN 100111222300003\n${text}`).figures).toEqual([100, 5, 105]);
  });

  it.each([
    ["المبلغ بدون ضريبة 100.00\nالضريبة 5.00\nالمبلغ الاجمالي 105.00"],
    ["الاجمالي قبل الضريبة 100.00\nضريبة القيمة المضافة 5.00\nالاجمالي 105.00"],
    ["المجموع قبل الضريبة 100.00\nالضريبة 5.00\nالمبلغ الاجمالي 105.00"],
    ["الإجمالي قبل الضريبة 100.00\nالضريبة 5.00\nالإجمالي 105.00"],
    ["المبلغ قبل الضريبة 100.00\nالضريبة 5.00\nالاجمالي 105.00"],
  ])("Arabic before-tax line is not VAT and not the total: %s", (text) => {
    const r = read(`متجر\nالرقم الضريبي 100111222300003\n${text}`);
    expect(r.figures).toEqual([100, 5, 105]);
    expect(r.issues).toEqual([]);
  });
});

describe("document precedence between several total lines", () => {
  it("a hyphenated Sub-Total is a subtotal, not the total", () => {
    expect(read("Sub-Total 100.00\nVAT 5.00\nTotal 105.00").figures).toEqual([100, 5, 105]);
  });

  it("Grand Total / Net Payable / Total Due beat the first Total line", () => {
    expect(read("Total 35.00\nVAT 1.67\nGrand Total 36.67").figures).toEqual([35, 1.67, 36.67]);
    expect(read("Total 50.00\nVAT 2.50\nNet Payable 52.50").figures).toEqual([50, 2.5, 52.5]);
    expect(read("Net Total 40.00\nVAT 2.00\nTotal Due 42.00").figures).toEqual([40, 2, 42]);
  });

  it("the last grand total wins after a discount line", () => {
    expect(read("Grand Total 110.00\nDiscount 5.00\nNet Payable 105.00\nVAT 5.00").figures).toEqual(
      [100, 5, 105]
    );
  });

  it("with several plain Total lines the one that is net + VAT wins", () => {
    expect(
      read("Total 100.00\nDiscount 10.00\nTotal 90.00\nVAT 4.50\nTotal 94.50").figures
    ).toEqual([90, 4.5, 94.5]);
  });
});

describe("explicit VAT 0 is never worked into a calculated 5", () => {
  const route = (extra: Record<string, unknown>) =>
    normalizeOcrJson(
      { merchant: "Cafe", date: "2026-06-01", vatPercentage: 5, vatAmount: 0, ...extra },
      { today: "2026-06-23" }
    );
  const codes = (r: ReturnType<typeof route>) => r.reviewIssues.map((i) => i.code);

  it("subtotal 100 / VAT 0 at a printed 5% / no total stays 100 / 0 / 100 with no VAT_DERIVED", () => {
    const r = route({ subtotal: 100 });
    expect([r.amount, r.vatAmount, r.total]).toEqual([100, 0, 100]);
    expect(codes(r)).not.toContain("VAT_DERIVED");
  });

  it("no subtotal / VAT 0 at a printed 5% / total 105 stays 105 / 0 / 105 with no VAT_DERIVED", () => {
    const r = route({ total: 105 });
    expect([r.amount, r.vatAmount, r.total]).toEqual([105, 0, 105]);
    expect(codes(r)).not.toContain("VAT_DERIVED");
  });

  it("100 / VAT 0 at 5% / 105 keeps 0 and is an AMOUNT_MISMATCH", () => {
    const r = route({ subtotal: 100, total: 105 });
    expect([r.amount, r.vatAmount, r.total]).toEqual([100, 0, 105]);
    expect(codes(r)).toContain("AMOUNT_MISMATCH");
  });

  it("a VAT amount that was not printed is still derived and flagged", () => {
    const r = route({ subtotal: 100, vatAmount: null });
    expect([r.amount, r.vatAmount, r.total]).toEqual([100, 5, 105]);
    expect(codes(r)).toContain("VAT_DERIVED");
  });
});

// The 92 receipts from the review's regression sweep, with the figures and issue codes the parser
// gives them now. Each row is [name, text, [subtotal, VAT, total], issue codes].
type Row = [string, string, [number, number, number], string[]];
const SWEEP: Row[] = [
  [
    "grocery1",
    "LULU HYPERMARKET\nTRN 100234567800003\nMilk 2L 7.50\nBread 4.00\nEggs 12.50\nSubtotal 24.00\nVAT 5% 1.20\nTotal 25.20",
    [24, 1.2, 25.2],
    [],
  ],
  [
    "grocery2",
    "Carrefour\nTRN: 100345678900003\nApples 10.00\nRice 40.00\nSub Total 50.00\nVAT 2.50\nTotal AED 52.50\nCash 60.00\nChange 7.50",
    [50, 2.5, 52.5],
    [],
  ],
  [
    "grocery3",
    "Spinneys\nTAX INVOICE\nTRN 100456789000003\nCheese 20.00\nTotal Excl VAT 20.00\nVAT 5% 1.00\nTotal Incl VAT 21.00",
    [20, 1, 21],
    [],
  ],
  [
    "fuel-enoc",
    "ENOC\nTAX INVOICE\nVAT Reg No 100067432100003\nSuper 98 40.00 L\nAmount 120.00\nVAT 5% 6.00\nTotal 126.00",
    [120, 6, 126],
    [],
  ],
  [
    "fuel-adnoc",
    "ADNOC Distribution\nTRN 100012345600003\nSpecial 95\nNet Amount 95.24\nVAT 4.76\nTotal 100.00",
    [95.24, 4.76, 100],
    [],
  ],
  [
    "fuel-emarat",
    "EMARAT\nTax Invoice No 55512\nTRN 100022233300003\nE-Plus 91 200.00\nVAT 10.00\nTotal Amount 210.00",
    [200, 10, 210],
    [],
  ],
  [
    "rest1",
    "Al Safadi\nTRN 100111222300003\nHummus 25.00\nGrill 60.00\nSubtotal 85.00\nVAT 5% 4.25\nGrand Total 89.25",
    [85, 4.25, 89.25],
    [],
  ],
  [
    "rest2",
    "Cafe\nTRN 100111222300003\nLatte 20.00\nCroissant 15.00\nTotal 35.00\nVAT 1.67\nGrand Total 36.67",
    [35, 1.67, 36.67],
    [],
  ],
  [
    "rest3",
    "Bistro\nTRN 100111222300003\nFood 100.00\nService Charge 10% 10.00\nVAT 5.50\nTotal 115.50",
    [110, 5.5, 115.5],
    ["NON_VAT_FEE"],
  ],
  [
    "rest4",
    "Shake Shack\nTRN 100111222300003\nBurger 40.00\nNet Total 40.00\nVAT 2.00\nTotal Due 42.00",
    [40, 2, 42],
    [],
  ],
  [
    "rest5",
    "Pizza Co\nTRN 100111222300003\nPizza 50.00\nTotal 50.00\nVAT 2.50\nNet Payable 52.50",
    [50, 2.5, 52.5],
    [],
  ],
  ["rest6", "Diner\nTRN 100111222300003\nMeal 80.00\nAmount Due 84.00\nVAT 4.00", [80, 4, 84], []],
  [
    "nettotal-only",
    "Kiosk\nTRN 100111222300003\nItem A 10.00\nItem B 10.00\nVAT 1.00\nNet Total 21.00",
    [20, 1, 21],
    [],
  ],
  ["nettotal-only2", "Shop\nNet Total 52.50", [50, 2.5, 52.5], ["VAT_DERIVED"]],
  [
    "nettotal-only3",
    "Shop\nTRN 100111222300003\nWater 5.00\nJuice 45.00\nNet Total AED 52.50\nVAT incl 2.50",
    [50, 2.5, 52.5],
    [],
  ],
  ["subtotal-only", "Shop\nSub Total 100.00\nVAT 5.00", [100, 5, 105], []],
  [
    "sub-hyphen",
    "Shop\nTRN 100111222300003\nSub-Total 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "multi-total",
    "Mall\nTRN 100111222300003\nTotal 100.00\nDiscount 10.00\nTotal 90.00\nVAT 4.50\nTotal 94.50",
    [90, 4.5, 94.5],
    [],
  ],
  [
    "grand-first",
    "Store\nTRN 100111222300003\nGrand Total 105.00\nSubtotal 100.00\nVAT 5.00",
    [100, 5, 105],
    [],
  ],
  [
    "total-before-tax",
    "Store\nTRN 100111222300003\nTotal Before Tax 100.00\nTax 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "total-excluding",
    "Store\nTRN 100111222300003\nTotal Excluding VAT 100.00\nVAT 5.00\nTotal Including VAT 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "vat-paren",
    "Store\nTRN 100111222300003\nSubtotal 100.00\nVAT (5%) 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "vat-at",
    "Store\nTRN 100111222300003\nSubtotal 100.00\nVAT @ 5% 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  ["total-only", "Taxi\nTotal 52.50", [50, 2.5, 52.5], ["VAT_DERIVED"]],
  [
    "incl-vat",
    "Supermarket\nTRN 100111222300003\nTotal (incl. VAT) 105.00\nVAT included 5.00",
    [100, 5, 105],
    [],
  ],
  [
    "ar1",
    "فاتورة ضريبية مبسطة\nالرقم الضريبي 100111222300003\nخبز 10.00\nالمجموع الفرعي 100.00\nضريبة القيمة المضافة 5% 5.00\nالاجمالي 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "ar2",
    "فاتورة ضريبية\nالرقم الضريبي 100111222300003\nالمبلغ قبل الضريبة 200.00\nالضريبة 10.00\nالمبلغ الاجمالي 210.00",
    [200, 10, 210],
    [],
  ],
  [
    "ar3",
    "مطعم\nالرقم الضريبي 100111222300003\nالمجموع الكلي 52.50\nضريبة 2.50",
    [50, 2.5, 52.5],
    [],
  ],
  ["ar4", "بقالة\nاجمالي 31.50\nضريبة القيمة المضافة 1.50", [30, 1.5, 31.5], []],
  [
    "ar-fee",
    "فندق\nالرقم الضريبي 100111222300003\nالغرفة 500.00\nضريبة سياحية 20.00\nضريبة القيمة المضافة 25.00\nالاجمالي 545.00",
    [520, 25, 545],
    ["NON_VAT_FEE"],
  ],
  [
    "ar-fee2",
    "فندق\nالرقم الضريبي 100111222300003\nالغرفة 500.00\nرسوم بلدية 35.00\nضريبة القيمة المضافة 25.00\nالاجمالي 560.00",
    [535, 25, 560],
    ["NON_VAT_FEE"],
  ],
  [
    "ar-fee3",
    "مطعم\nالرقم الضريبي 100111222300003\nطعام 100.00\nرسوم خدمة 10.00\nضريبة القيمة المضافة 5.50\nالاجمالي 115.50",
    [110, 5.5, 115.5],
    ["NON_VAT_FEE"],
  ],
  [
    "ar-prod",
    "متجر\nالرقم الضريبي 100111222300003\nخدمة توصيل 10.00\nسياحة دبي كتاب 40.00\nالمجموع الفرعي 50.00\nالضريبة 2.50\nالاجمالي 52.50",
    [50, 2.5, 52.5],
    [],
  ],
  [
    "hotel1",
    "Hilton\nTRN 100111222300003\nRoom 500.00\nTourism Dirham (2 nights) 20.00\nVAT 25.00\nTotal 545.00",
    [520, 25, 545],
    ["NON_VAT_FEE"],
  ],
  [
    "hotel2",
    "Hotel\nTRN 100111222300003\nRoom 1000.00\nTourism Dirham 4 nights 80.00\nMunicipality Fee 70.00\nVAT 50.00\nTotal 1200.00",
    [1150, 50, 1200],
    ["NON_VAT_FEE"],
  ],
  ["hotel-fee-only", "Hotel\nTourism dirham 20.00\nTotal 20.00", [20, 0, 20], ["NON_VAT_FEE"]],
  [
    "svc-incl",
    "Rest\nTRN 100111222300003\nFood 100.00\nService charge (VAT incl) 10.00\nVAT 5.00\nTotal 115.00",
    [110, 5, 115],
    ["NON_VAT_FEE"],
  ],
  [
    "svc-prod",
    "Garage\nTRN 100111222300003\nService Package A 300.00\nSubtotal 300.00\nVAT 15.00\nTotal 315.00",
    [300, 15, 315],
    [],
  ],
  [
    "svc-prod2",
    "Salon\nTRN 100111222300003\nServices rendered 200.00\nVAT 10.00\nTotal 210.00",
    [200, 10, 210],
    [],
  ],
  [
    "rasoom",
    "Shop\nTRN 100111222300003\nRasoom khidma 10.00\nItem 90.00\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "nights-prod",
    "Hotel\nTRN 100111222300003\nRoom 2 nights 400.00\nVAT 20.00\nTotal 420.00",
    [400, 20, 420],
    [],
  ],
  [
    "vat-no-header",
    "Shop\nVAT No 100111222300003\nItem 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  ["tax-receipt", "Shop\nTAX RECEIPT\nItem 100.00\nTax 5.00\nTotal 105.00", [100, 5, 105], []],
  [
    "tax-invoice-no",
    "Shop\nTax Invoice No: 2024\nItem 100.00\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "vat-reg-line-amount",
    "Shop\nVAT Registration 100111222300003\nItem 100.00\nTotal 105.00",
    [100, 5, 105],
    ["VAT_DERIVED"],
  ],
  [
    "tax-id",
    "Shop\nTax ID 123\nItem 100.00\nSubtotal 100.00\nTax 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "zero-rated",
    "Pharmacy\nTRN 100111222300003\nMedicine 50.00\nVAT 0% 0.00\nTotal 50.00",
    [50, 0, 50],
    [],
  ],
  ["no-vat", "Laundry\nShirts 30.00\nTotal 30.00", [28.57, 1.43, 30], ["VAT_DERIVED"]],
  [
    "total-vat-line",
    "Shop\nTRN 100111222300003\nSubtotal 100.00\nTotal VAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "balance-due",
    "Shop\nTRN 100111222300003\nSubtotal 100.00\nVAT 5.00\nBalance Due 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "netpay-after-disc",
    "Shop\nTRN 100111222300003\nGrand Total 110.00\nDiscount 5.00\nNet Payable 105.00\nVAT 5.00",
    [100, 5, 105],
    [],
  ],
  [
    "known-svc",
    "Rest\nSubtotal 100.00\nVAT on service charge 0.50\nVAT 5.00\nTotal 115.50",
    [100, 0.5, 115.5],
    ["AMOUNT_MISMATCH"],
  ],
  [
    "fee-vat-both",
    "Rest\nFood 100.00\nService charge 10% 10.00 VAT 0.50\nVAT 5.00\nTotal 115.00",
    [110, 5, 115],
    ["NON_VAT_FEE", "AMOUNT_MISMATCH"],
  ],
  [
    "ar-def-fee",
    "فندق\nالغرفة 500.00\nدرهم السياحة 20.00\nضريبة القيمة المضافة 25.00\nالاجمالي 545.00",
    [520, 25, 545],
    ["NON_VAT_FEE"],
  ],
  [
    "tot-excluding",
    "Store\nTotal Excluding VAT 100.00\nVAT 5.00\nTotal Including VAT 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "tot-exclusive-of",
    "Store\nTotal Exclusive of VAT 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  ["tot-excl-dot", "Store\nTotal Excl. VAT 100.00\nVAT 5%  5.00\nTotal 105.00", [100, 5, 105], []],
  ["tot-wo-vat", "Store\nTotal w/o VAT 100.00\nVAT 5.00\nTotal 105.00", [100, 5, 105], []],
  ["tot-net", "Store\nTotal Net 100.00\nVAT 5.00\nTotal Gross 105.00", [100, 5, 105], []],
  ["tot-taxable", "Store\nTotal Taxable 100.00\nVAT 5.00\nTotal 105.00", [100, 5, 105], []],
  [
    "tot-before-vat",
    "Store\nTotal before VAT 100.00\nVAT 5.00\nInvoice Total 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "nettot-totvat",
    "Store\nNet Total 100.00\nTotal VAT 5.00\nTotal Amount 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "only-nettotal-hasvat",
    "Store\nItem 50.00\nItem 50.00\nVAT 5% 5.00\nNet Total 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "only-nettotal-small-items",
    "Store\nItem 10.00\nNet Total 10.50\nVAT 0.50",
    [10, 0.5, 10.5],
    [],
  ],
  [
    "only-nettotal-big-cash",
    "Store\nItem 10.00\nNet Total 10.50\nVAT 0.50\nCash 100.00\nChange 89.50",
    [10, 0.5, 10.5],
    [],
  ],
  [
    "only-subtotal-cash",
    "Store\nItem 10.00\nSub Total 10.50\nVAT 0.50\nCash 100.00",
    [10.5, 0.5, 11],
    [],
  ],
  [
    "ar-before",
    "فاتورة\nالاجمالي قبل الضريبة 100.00\nضريبة القيمة المضافة 5.00\nالاجمالي 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "ar-prod-fee1",
    "متجر\nرسوم خدمة التوصيل 10.00\nمنتج 90.00\nالمجموع الفرعي 100.00\nالضريبة 5.00\nالاجمالي 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "ar-prod2",
    "مكتبة\nرسم هندسي 40.00\nخدمة عملاء 10.00\nالاجمالي 52.50\nالضريبة 2.50",
    [50, 2.5, 52.5],
    [],
  ],
  ["ar-prod3", "سوق\nضريبة 5% 5.00\nسياحية جولة 100.00\nالاجمالي 105.00", [100, 5, 105], []],
  [
    "en-prod-svc",
    "Garage\nService charge free 0.00\nOil change 100.00\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "fee-paren-amt",
    "Hotel\nRoom 500.00\nTourism Dirham (10.00 x 2) 20.00\nVAT 25.00\nTotal 545.00",
    [520, 25, 545],
    ["NON_VAT_FEE"],
  ],
  [
    "fee-paren-vat",
    "Rest\nFood 100.00\nService charge (VAT 5%) 10.50\nVAT 5.00\nTotal 115.50",
    [110.5, 5, 115.5],
    ["NON_VAT_FEE"],
  ],
  [
    "fee-nights-prod",
    "Hotel\nRoom Deluxe 3 nights 900.00\nTourism fee 3 nights 30.00\nVAT 45.00\nTotal 975.00",
    [930, 45, 975],
    ["NON_VAT_FEE"],
  ],
  [
    "fee-only-two",
    "Hotel\nTourism dirham 20.00\nMunicipality fee 7.00\nTotal 27.00",
    [27, 0, 27],
    ["NON_VAT_FEE"],
  ],
  [
    "fee-only-vat",
    "Hotel\nService charge 10.00\nVAT 0.50\nTotal 10.50",
    [10, 0.5, 10.5],
    ["NON_VAT_FEE"],
  ],
  ["fee-only-svc", "Rest\nService charge 10.00\nTotal 10.00", [10, 0, 10], ["NON_VAT_FEE"]],
  ["fee-only-notot", "Hotel\nTourism dirham 20.00", [0, 0, 0], ["NON_VAT_FEE"]],
  [
    "fee-eq-total-sub",
    "Hotel\nSubtotal 20.00\nTourism dirham 20.00\nTotal 20.00",
    [20, 0, 20],
    ["NON_VAT_FEE"],
  ],
  ["sub-hyphen-2", "Shop\nSub-Total 100.00\nVAT 5.00\nTotal 105.00", [100, 5, 105], []],
  [
    "multi-total-2",
    "Mall\nTotal 100.00\nDiscount 10.00\nTotal 90.00\nVAT 4.50\nTotal 94.50",
    [90, 4.5, 94.5],
    [],
  ],
  [
    "gt-then-netpay",
    "Shop\nGrand Total 110.00\nDiscount 5.00\nNet Payable 105.00",
    [100, 5, 105],
    ["VAT_DERIVED"],
  ],
  ["total-vat-before", "Shop\nItem 100.00\nTax Invoice\nVAT 5.00\nTotal 105.00", [100, 5, 105], []],
  [
    "vat-no-later",
    "Shop\nItem 100.00\nVAT 5.00\nTotal 105.00\nVAT No: 100111222300003",
    [100, 5, 105],
    [],
  ],
  [
    "vat-reg-before-amt",
    "Shop\nVAT Reg. No. 100111222300003\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  ["vat-code", "Shop\nSubtotal 100.00\nVAT Code S 5.00\nTotal 105.00", [100, 5, 105], []],
  [
    "tax-number-label",
    "Shop\nTax Number 100111222300003\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "before-tax-disc",
    "Shop\nItem 100.00\nDiscount before tax 10.00\nVAT 4.50\nTotal 94.50",
    [90, 4.5, 94.5],
    [],
  ],
  ["excl-vat-price", "Shop\nPrice excl VAT 100.00\nVAT 5.00\nTotal 105.00", [100, 5, 105], []],
  [
    "exclusive-of-vat",
    "Shop\nAmount exclusive of VAT 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "total-due-before",
    "Shop\nTotal Due 105.00\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
    [100, 5, 105],
    [],
  ],
  [
    "amount-due-after-total",
    "Shop\nTotal 105.00\nPaid 50.00\nAmount Due 55.00\nVAT 5.00",
    [100, 5, 105],
    [],
  ],
];

describe("review 6098131504 regression sweep (92 receipts, English and Arabic)", () => {
  it.each(SWEEP)("%s", (_name, text, figures, issues) => {
    const r = read(text);
    expect(r.figures).toEqual(figures);
    expect(r.issues).toEqual(issues);
  });
});
