import { describe, expect, it } from "vitest";
import {
  vatReturnPatchSchema,
  evaluateVatReturnPatch,
  LEGACY_VAT_RETURN_FIELDS,
  buildGeneratedVatReturnValues,
  stripLegacyVatReturnFields,
} from "../../server/services/vat-return-payload.service";
import { buildVatReturnValuesFromWorkpaper } from "../../server/services/firm-vat-workspace.service";
import { emptyVat201Totals } from "../../server/services/firm-vat-workspace.service";

const LEGACY_KEYS = [
  "box1SalesStandard",
  "box2SalesOtherEmirates",
  "box3SalesTaxExempt",
  "box4SalesExempt",
  "box5TotalOutputTax",
  "box6ExpensesStandard",
  "box7ExpensesTouristRefund",
  "box8TotalInputTax",
  "box9NetTax",
];

const baseInput = () => ({
  companyId: "c1",
  userId: "u1",
  periodStart: new Date("2026-07-01T00:00:00Z"),
  periodEnd: new Date("2026-09-30T23:59:59.999Z"),
  dueDate: new Date("2026-10-28T23:59:59.999Z"),
  vatStagger: "quarterly",
  emirateBreakdown: { box1bDubaiAmount: 1000, box1bDubaiVat: 50 },
  standardRatedAmount: 1000,
  zeroRatedAmount: 200,
  exemptAmount: 300,
  reverseChargeAmount: 100,
  reverseChargeVat: 5,
  reverseChargeVatRecoverable: 5,
  totalExpenses: 400,
  inputTax: 20,
  totalOutputAmount: 1600,
  totalOutputVat: 55,
  totalInputAmount: 500,
  totalInputVat: 25,
});

describe("buildGeneratedVatReturnValues", () => {
  it("emits no legacy 8-box alias fields", () => {
    const values = buildGeneratedVatReturnValues(baseInput()) as Record<string, unknown>;
    for (const key of LEGACY_KEYS) expect(values).not.toHaveProperty(key);
  });

  it("keeps the canonical boxes unchanged", () => {
    const v = buildGeneratedVatReturnValues(baseInput()) as Record<string, unknown>;
    expect(v).toMatchObject({
      companyId: "c1",
      status: "draft",
      vatStagger: "quarterly",
      box1bDubaiAmount: 1000,
      box1bDubaiVat: 50,
      box2TouristRefundAmount: 0,
      box2TouristRefundVat: 0,
      box3ReverseChargeAmount: 100,
      box3ReverseChargeVat: 5,
      box4ZeroRatedAmount: 200,
      box5ExemptAmount: 300,
      box6ImportsAmount: 0,
      box7ImportsAdjVat: 0,
      box8TotalAmount: 1600,
      box8TotalVat: 55,
      box9ExpensesAmount: 400,
      box9ExpensesVat: 20,
      box10ReverseChargeAmount: 100,
      box10ReverseChargeVat: 5,
      box11TotalAmount: 500,
      box11TotalVat: 25,
      box12TotalDueTax: 55,
      box13RecoverableTax: 25,
      box14PayableTax: 30,
      createdBy: "u1",
    });
  });
});

describe("stripLegacyVatReturnFields", () => {
  it("removes every legacy alias and leaves canonical fields untouched", () => {
    const row = {
      id: "r1",
      box8TotalVat: 55,
      box14PayableTax: 30,
      ...Object.fromEntries(LEGACY_KEYS.map((k) => [k, 0])),
    };
    const out = stripLegacyVatReturnFields(row);
    expect(out).toEqual({ id: "r1", box8TotalVat: 55, box14PayableTax: 30 });
    // input not mutated
    expect(row).toHaveProperty("box3SalesTaxExempt");
  });

  it("covers exactly the known legacy field set", () => {
    expect([...LEGACY_VAT_RETURN_FIELDS].sort()).toEqual([...LEGACY_KEYS].sort());
  });
});

describe("buildVatReturnValuesFromWorkpaper", () => {
  it("emits no legacy aliases and keeps canonical fields", () => {
    const totals = {
      ...emptyVat201Totals(),
      box1bDubaiAmount: 1000,
      box4ZeroRatedAmount: 200,
      box5ExemptAmount: 300,
      box8TotalVat: 55,
      box11TotalVat: 25,
      box14PayableTax: 30,
    };
    const workpaper = {
      companyId: "c1",
      periodStart: new Date("2026-04-01T00:00:00Z"),
      periodEnd: new Date("2026-06-30T23:59:59.999Z"),
      dueDate: new Date("2026-07-28T00:00:00Z"),
    };
    const v = buildVatReturnValuesFromWorkpaper(workpaper as any, totals, "u1") as Record<
      string,
      unknown
    >;
    for (const key of LEGACY_KEYS) expect(v).not.toHaveProperty(key);
    expect(v).toMatchObject({
      status: "pending_review",
      box1bDubaiAmount: 1000,
      box4ZeroRatedAmount: 200,
      box5ExemptAmount: 300,
      box8TotalVat: 55,
      box11TotalVat: 25,
      box14PayableTax: 30,
      createdBy: "u1",
    });
  });
});

describe("vatReturnPatchSchema", () => {
  it("does not carry the period at all (a return cannot be moved to another period)", () => {
    const r = vatReturnPatchSchema.safeParse({ periodStart: "2026-07-01", periodEnd: "2026-09-30", notes: "n" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ notes: "n" });
      expect("periodStart" in r.data).toBe(false);
      expect("periodEnd" in r.data).toBe(false);
    }
  });

  it("accepts known statuses and rejects unknown ones", () => {
    for (const status of ["draft", "pending_review", "submitted", "filed", "amended"]) {
      expect(vatReturnPatchSchema.safeParse({ status }).success).toBe(true);
    }
    expect(vatReturnPatchSchema.safeParse({ status: "bogus" }).success).toBe(false);
    expect(vatReturnPatchSchema.safeParse({ status: 5 }).success).toBe(false);
  });

  it("accepts numeric box amounts (the edit dialog) and rejects non-numeric ones", () => {
    expect(vatReturnPatchSchema.safeParse({ box1bDubaiAmount: 1234.5, box9ExpensesVat: 0, notes: "n" }).success).toBe(true);
    expect(vatReturnPatchSchema.safeParse({ box1bDubaiAmount: "5,000" }).success).toBe(false);
    expect(vatReturnPatchSchema.safeParse({ box9ExpensesVat: Number.NaN }).success).toBe(false);
  });

  it("strips fields a client may never set (tenant scope, identity)", () => {
    const r = vatReturnPatchSchema.safeParse({ companyId: "x", id: "y", createdBy: "z", submittedBy: "w", notes: "ok" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ notes: "ok" });
  });
});

describe("evaluateVatReturnPatch", () => {
  const NOW = new Date("2026-09-29T08:00:00Z");
  const closed = { status: "draft", periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-08-31T00:00:00Z") };
  const open = { status: "draft", periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T00:00:00Z") };
  const check = (existing: any, body: any) =>
    evaluateVatReturnPatch({ existing, body, patch: vatReturnPatchSchema.parse(body), now: NOW });

  it("a plain edit of a draft is allowed", () => {
    expect(check(closed, { notes: "x", box8TotalVat: 12 })).toEqual({ ok: true });
  });

  it("refuses to change the period (the proven attack: closed return moved into the current month)", () => {
    const r = check(closed, { periodStart: "2026-09-01", periodEnd: "2026-09-30", status: "pending_review", box8TotalVat: 1 });
    expect(r).toMatchObject({ ok: false, status: 400, code: "VAT_PERIOD_IMMUTABLE" });
  });

  it("sending the stored period back unchanged is fine, in any date format", () => {
    expect(check(closed, { periodStart: "2026-08-01", periodEnd: "2026-08-31" })).toEqual({ ok: true });
    expect(check(closed, { periodEnd: "2026-08-31T00:00:00.000Z" })).toEqual({ ok: true });
  });

  it("an unparseable period is a 400, not silently ignored", () => {
    expect(check(closed, { periodEnd: "not-a-date" })).toMatchObject({ ok: false, status: 400, code: "VAT_PERIOD_IMMUTABLE" });
  });

  it("no non-draft status while the period has not ended", () => {
    for (const status of ["pending_review", "submitted", "filed", "amended"]) {
      expect(check(open, { status })).toMatchObject({ ok: false, status: 400, code: "PERIOD_NOT_ENDED" });
    }
    expect(check(open, { status: "draft", notes: "still a draft" })).toEqual({ ok: true });
  });

  it("a non-draft status is fine once the period has ended", () => {
    expect(check(closed, { status: "pending_review" })).toEqual({ ok: true });
  });

  it("a submitted / filed / accepted return is immutable: no box edits", () => {
    for (const status of ["submitted", "filed", "accepted"]) {
      const existing = { ...closed, status };
      expect(check(existing, { box8TotalVat: 1 })).toMatchObject({ ok: false, status: 409, code: "VAT_RETURN_LOCKED" });
      expect(check(existing, { adjustmentAmount: 5 })).toMatchObject({ ok: false, status: 409, code: "VAT_RETURN_LOCKED" });
    }
  });

  it("a locked return cannot be re-opened by PATCH, but notes and payment details still save", () => {
    const filed = { ...closed, status: "filed" };
    expect(check(filed, { status: "draft" })).toMatchObject({ ok: false, code: "VAT_RETURN_LOCKED" });
    expect(check(filed, { status: "pending_review" })).toMatchObject({ ok: false, code: "VAT_RETURN_LOCKED" });
    expect(check(filed, { notes: "paid via bank", paymentAmount: 10 })).toEqual({ ok: true });
  });
});
