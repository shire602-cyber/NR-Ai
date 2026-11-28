import { describe, expect, it } from "vitest";
import { parseReceiptOcrText } from "../../shared/receipt-ocr-parser";
import { amountMismatchMessage } from "../../shared/receipt-amounts";

// Review 6097208226 on PR #231: the reviewer's 31 receipts, run through the parser. Each row is
// [text, subtotal, VAT, total, VAT rate, issue codes]. Total-only receipts work VAT back at the
// 5% default and say so (VAT_DERIVED); a VAT line that reads zero stays 0 with no note.
const T = "Total AED 105.00";
const AR_T = "الاجمالي 105.00 درهم";
const AR_T_INDIC = "الاجمالي ١٠٥٫٠٠ درهم";

type Row = [string, number, number, number, number, string[]];

const CASES: Row[] = [
  // Not VAT figures: unchanged from base (total-only, VAT worked back and flagged).
  [`Cafe\nVAT No. 100123456700003\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`Cafe\nTRN 100123456700003\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`مقهى\nرقم التسجيل الضريبي 100123456700003\n${AR_T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  // The 6 misfires: a non-VAT tax or label that happens to end in 0 is not a zero VAT line.
  [`Cafe\nExcise tax 0.00\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`Cafe\nTourism tax 0.00\n${T}`, 100, 5, 105, 5, ["NON_VAT_FEE", "VAT_DERIVED"]],
  [`Cafe\nTotal before tax 0.00\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`Cafe\nTax 0 items\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`Cafe\nTax Invoice No 0\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  // Positive printed rate with a zero amount: rate kept, VAT 0 as read, flagged for review.
  [`Cafe\nVAT 5% 0.00 discount\n${T}`, 105, 0, 105, 5, ["AMOUNT_MISMATCH"]],
  [`Cafe\nVAT @ 5% : 0.00\n${T}`, 105, 0, 105, 5, ["AMOUNT_MISMATCH"]],
  [`مقهى\nضريبة القيمة المضافة ٥٪ ٠٫٠٠\n${AR_T_INDIC}`, 105, 0, 105, 5, ["AMOUNT_MISMATCH"]],
  // Explicit zero VAT lines: 0%, no note.
  [`Cafe\nVAT 0.00\n${T}`, 105, 0, 105, 0, []],
  [`Cafe\nVAT 0,00\n${T}`, 105, 0, 105, 0, []],
  [`Cafe\nVAT 0 %\n${T}`, 105, 0, 105, 0, []],
  [`Cafe\nVAT%  0\n${T}`, 105, 0, 105, 0, []],
  [`Cafe\nVAT 0%\n${T}`, 105, 0, 105, 0, []], // total on the next line is not the VAT
  [`مقهى\nضريبة القيمة المضافة 0٪ 0.00\n${AR_T}`, 105, 0, 105, 0, []],
  [`مقهى\nضريبة القيمة المضافة ٠٪\n${AR_T_INDIC}`, 105, 0, 105, 0, []],
  [`مقهى\nالضريبة 0\n${AR_T}`, 105, 0, 105, 0, []],
  [`مقهى\nضريبه 0.00\n${AR_T}`, 105, 0, 105, 0, []], // heh spelling
  [`مقهى\nالضريبه ٠٫٠٠\n${AR_T_INDIC}`, 105, 0, 105, 0, []],
  [`مقهى\nضريبة القيمة المضافة: د.إ 0.00\n${AR_T}`, 105, 0, 105, 0, []],
  [`مقهى\nضريبه القيمه المضافه 0.00\n${AR_T}`, 105, 0, 105, 0, []],
  [`مقهى\nض.ق.م 0.00\n${AR_T}`, 105, 0, 105, 0, []],
  [`Cafe\nValue Added Tax 0.00\n${T}`, 105, 0, 105, 0, []],
  // A zero VAT line next to a different total than subtotal: flagged, rate stays 0.
  [`Cafe\nSubtotal 100.00\nVAT 0.00\n${T}`, 100, 0, 105, 0, ["AMOUNT_MISMATCH"]],
  // A real VAT figure wins over a zero line.
  [`Cafe\nVAT 0.00\nVAT 5% 5.00\n${T}`, 100, 5, 105, 5, []],
  [`Cafe\nItem VAT 0.00\nVAT 5.00\n${T}`, 100, 5, 105, 5, []],
  [`Cafe\nVAT 0.50\n${T}`, 104.5, 0.5, 105, 5, []],
  // Other pre-existing readings, unchanged.
  // "VAT Reg" / "TAX INVOICE" are headers, not VAT lines: no VAT is printed, so it is worked back
  // from the total and flagged VAT_DERIVED (was VAT 12345 / VAT 1).
  [`Cafe\nVAT Reg 0012345\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`Cafe\nVAT: 0012345\n${T}`, 100, 12345, 105, 5, ["AMOUNT_MISMATCH"]],
  // "Total incl. VAT 105.00" is a gross total with no VAT line: VAT is worked back and flagged (was VAT 105).
  [`Cafe\nTotal incl. VAT 105.00`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`Cafe\nTAX INVOICE 0001\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`Cafe\nVAT 5%\n0.00\n${T}`, 100, 5, 105, 5, ["VAT_DERIVED"]],
  [`مقهى\nالاجمالي شامل الضريبة 105.00 درهم`, 100, 5, 105, 5, ["VAT_DERIVED"]],
];

describe("parseReceiptOcrText: VAT line reading (PR 231 review 6097208226)", () => {
  it.each(CASES)("%j", (text, subtotal, vat, total, rate, codes) => {
    const p = parseReceiptOcrText(text);
    expect([p.subtotal, p.vatAmount, p.total, p.vatPercentage]).toEqual([
      subtotal,
      vat,
      total,
      rate,
    ]);
    expect(p.validationIssues.map((i) => i.code)).toEqual(codes);
  });

  it("a positive printed rate with a 0.00 amount is reviewed, not read as zero-rated", () => {
    const p = parseReceiptOcrText(`Cafe\nVAT 5% 0.00 discount\n${T}`);
    const issue = p.validationIssues.find((i) => i.code === "AMOUNT_MISMATCH");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toMatch(/prints a VAT rate of 5% but a VAT amount of 0\.00/);
    expect(p.reviewReasonCodes).toContain("AMOUNT_MISMATCH");
  });

  it("the zero-VAT mismatch note does not claim the receipt is zero-rated", () => {
    const p = parseReceiptOcrText(`Cafe\nSubtotal 100.00\nVAT 0.00\n${T}`);
    const message = p.validationIssues[0]?.message ?? "";
    expect(message).toMatch(/The receipt shows VAT of 0\.00/);
    expect(message).not.toMatch(/zero-rated/);
    expect(amountMismatchMessage(100, 0, 110, 0)).not.toMatch(/zero-rated/);
  });
});
