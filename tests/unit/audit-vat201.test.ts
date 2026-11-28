import { expect, it } from "vitest";
import { computeSalesDocument } from "../../server/services/document-totals.service";
import { computePartialExemption } from "../../server/tax/partial-exemption";
import { emptyBoxes } from "../../server/tax/vat-boxes";

it("applies the 2026 Q1 UAE standard input-tax recovery percentage to residual VAT", () => {
  // FTA VATGIT1 (September 2025), section 3.3, steps 3–4. All amounts are in fils.
  const boxes = emptyBoxes();
  boxes.box1bDubaiAmount = 900_000;
  boxes.box5ExemptAmount = 100_000;
  boxes.box9ExpensesVat = 13_000;
  const result = computePartialExemption(
    boxes,
    [
      { boxes: { box9ExpensesVat: 1_000 }, attribution: "taxable" },
      { boxes: { box9ExpensesVat: 2_000 }, attribution: "exempt" },
      { boxes: { box9ExpensesVat: 10_000 }, attribution: "residual" },
    ],
    { enabled: true, fallbackExemptRatio: 0 }
  );
  // AED 10 / (10 + 20) rounds to 33%. Recover AED 10 + 33 out of AED 130 input.
  expect(boxes.box9ExpensesVat + (result.delta.box9ExpensesVat ?? 0)).toBe(4_300);
});

it("sums the rounded VAT on each taxable invoice line into the document total", () => {
  // FTA clarification VATP006 requires tax-invoice rounding at the level of each line.
  const line = { quantity: 1, unitPriceFils: 10, vatRate: 5 };
  const invoice = computeSalesDocument([line, line], { resolve: true });
  expect(invoice.lines.map((row) => row.vatFils)).toEqual([1, 1]);
  expect([invoice.vatFils, invoice.totalFils]).toEqual([2, 22]);
});
