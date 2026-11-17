/**
 * A1 (C2, C6): pure VAT rules. Supplier debit notes mirror the bill's VAT treatment; partial
 * exemption attributes directly first and apportions only residual input VAT (Art. 55).
 */
import { describe, expect, it } from "vitest";
import { planDebitNoteVat } from "../../server/services/debit-note-vat";
import { computePartialExemption } from "../../server/tax/partial-exemption";
import { emptyBoxes } from "../../server/tax/vat-boxes";

describe("A1 C2 planDebitNoteVat", () => {
  const line = [{ amountFils: 100_000, vatFils: 5_000 }];
  it("stand-alone note: full VAT reversed, A/P = net + VAT", () => {
    expect(planDebitNoteVat(line, null)).toEqual({
      treatment: "standard",
      vatFils: 5_000,
      recoverableFils: 5_000,
      lineCostFils: [0],
      apFils: 105_000,
    });
  });
  it("blocked bill: nothing reversed from input VAT, the VAT goes back to the line's cost", () => {
    const p = planDebitNoteVat(line, {
      reverseCharge: false,
      isImport: false,
      vatFils: 400_000,
      recoverableFils: 0,
    });
    expect(p).toMatchObject({ recoverableFils: 0, lineCostFils: [5_000], apFils: 105_000 });
  });
  it("partially recoverable bill: the same share is reversed", () => {
    const p = planDebitNoteVat(line, {
      reverseCharge: false,
      isImport: false,
      vatFils: 10_000,
      recoverableFils: 6_000,
    });
    expect(p).toMatchObject({ recoverableFils: 3_000, lineCostFils: [2_000] });
  });
  it("reverse charge: A/P falls by the net only; self-assessed VAT reversed both sides", () => {
    expect(
      planDebitNoteVat([{ amountFils: 20_000, vatFils: 1_000 }], {
        reverseCharge: true,
        isImport: false,
        vatFils: 10_000,
        recoverableFils: null,
      })
    ).toEqual({
      treatment: "reverse_charge",
      vatFils: 1_000,
      recoverableFils: 1_000,
      lineCostFils: [0],
      apFils: 20_000,
    });
  });
  it("import: customs VAT is not touched by a supplier credit", () => {
    expect(
      planDebitNoteVat(line, {
        reverseCharge: true,
        isImport: true,
        vatFils: 1,
        recoverableFils: 1,
      })
    ).toMatchObject({ treatment: "import", vatFils: 0, apFils: 100_000 });
  });
});

describe("A1 C6 computePartialExemption", () => {
  const boxes = () => {
    const b = emptyBoxes();
    b.box1bDubaiAmount = 800_000;
    b.box5ExemptAmount = 200_000;
    b.box9ExpensesVat = 17_000;
    return b;
  };
  const contributions = [
    { boxes: { box9ExpensesVat: 5_000 }, attribution: "taxable" as const },
    { boxes: { box9ExpensesVat: 2_000 }, attribution: "exempt" as const },
    { boxes: { box9ExpensesVat: 10_000 } },
  ];
  it("standard method: taxable kept, exempt dropped, residual apportioned 80%", () => {
    const r = computePartialExemption(boxes(), contributions, {
      enabled: true,
      fallbackExemptRatio: 0,
    });
    expect(r).toMatchObject({
      method: "standard",
      recoverableRatio: 0.8,
      apportionedFils: 4_000,
      delta: { box9ExpensesVat: -4_000 },
      advisory: null,
    });
  });
  it("no supplies in the period: provisional ratio", () => {
    const b = boxes();
    b.box1bDubaiAmount = 0;
    b.box5ExemptAmount = 0;
    const r = computePartialExemption(b, contributions, {
      enabled: true,
      fallbackExemptRatio: 0.5,
    });
    expect(r).toMatchObject({ method: "provisional", apportionedFils: 2_000 + 5_000 });
  });
  it("disabled: no change, advisory when exempt supplies exist", () => {
    const r = computePartialExemption(boxes(), contributions, {
      enabled: false,
      fallbackExemptRatio: 0,
    });
    expect(r).toMatchObject({
      apportionedFils: 0,
      delta: {},
      advisory: "PARTIAL_EXEMPTION_NOT_ENABLED",
    });
  });
});
