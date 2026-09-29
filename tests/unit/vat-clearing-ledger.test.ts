import { describe, expect, it } from "vitest";
import { buildClearingLines, VAT_ROUNDING_TOLERANCE_FILS } from "../../server/services/tax-settlement";

const A = { outputId: "out", inputId: "in", controlId: "ctl", irrecoverableId: "irr" };
const net = (lines: Array<{ accountId: string; debit: number; credit: number }>, id: string) =>
  Math.round(lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;
const total = (lines: Array<{ debit: number; credit: number }>, k: "debit" | "credit") =>
  Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;

function ok(res: ReturnType<typeof buildClearingLines>) {
  if (!res.ok) throw new Error("expected ok, got " + JSON.stringify(res));
  expect(total(res.lines, "debit")).toBe(total(res.lines, "credit"));
  return res;
}

describe("buildClearingLines: ledger balances against the return", () => {
  it("plain payable: ledger equals the return", () => {
    const r = ok(buildClearingLines({ outputVat: 150, inputVat: 40 }, { outputVat: 150, inputVat: 40, net: 110 }, A));
    expect(net(r.lines, "out")).toBe(150);
    expect(net(r.lines, "in")).toBe(-40);
    expect(net(r.lines, "ctl")).toBe(-110);
    expect(net(r.lines, "irr")).toBe(0);
    expect(r.irrecoverable).toBe(0);
    expect(r.rounding).toBe(0);
  });

  it("refundable: control account is debited", () => {
    const r = ok(buildClearingLines({ outputVat: 50, inputVat: 200 }, { outputVat: 50, inputVat: 200, net: -150 }, A));
    expect(net(r.lines, "ctl")).toBe(150);
    expect(net(r.lines, "in")).toBe(-200);
    expect(net(r.lines, "out")).toBe(50);
  });

  it("zero net: no control line", () => {
    const r = ok(buildClearingLines({ outputVat: 40, inputVat: 40 }, { outputVat: 40, inputVat: 40, net: 0 }, A));
    expect(r.lines.map((l) => l.accountId).sort()).toEqual(["in", "out"]);
  });

  it("nothing to clear produces no lines", () => {
    const r = ok(buildClearingLines({ outputVat: 0, inputVat: 0 }, { outputVat: 0, inputVat: 0, net: 0 }, A));
    expect(r.lines).toEqual([]);
  });

  it("reverse charge: self-assessed output and the matching input both clear", () => {
    // 100 ordinary sales VAT + 50 self-assessed; 30 ordinary input + 50 reverse-charge input
    const r = ok(buildClearingLines({ outputVat: 150, inputVat: 80 }, { outputVat: 150, inputVat: 80, net: 70 }, A));
    expect(net(r.lines, "out")).toBe(150);
    expect(net(r.lines, "in")).toBe(-80);
    expect(net(r.lines, "ctl")).toBe(-70);
  });

  it("partial exemption 160 vs 200: the irrecoverable 40 is expensed, all accounts clear", () => {
    const r = ok(buildClearingLines({ outputVat: 50, inputVat: 200 }, { outputVat: 50, inputVat: 160, net: -110, expectedIrrecoverable: 40 }, A));
    expect(net(r.lines, "in")).toBe(-200);
    expect(net(r.lines, "out")).toBe(50);
    expect(net(r.lines, "ctl")).toBe(110);
    expect(net(r.lines, "irr")).toBe(40);
    expect(r.irrecoverable).toBe(40);
    expect(r.rounding).toBe(0);
  });

  it("0.01 rounding between ledger and return goes to a rounding line on the expense account", () => {
    const r = ok(buildClearingLines({ outputVat: 100.01, inputVat: 20 }, { outputVat: 100, inputVat: 20, net: 80 }, A));
    expect(net(r.lines, "out")).toBe(100.01);
    expect(net(r.lines, "ctl")).toBe(-80);
    expect(net(r.lines, "irr")).toBe(-0.01);
    expect(r.rounding).toBe(-0.01);
    expect(r.lines.find((l) => l.accountId === "irr")?.description).toMatch(/rounding/i);
  });

  it("rounding on the input side is an expense", () => {
    const r = ok(buildClearingLines({ outputVat: 100, inputVat: 20.03 }, { outputVat: 100, inputVat: 20, net: 80 }, A));
    expect(net(r.lines, "irr")).toBe(0.03);
    expect(r.rounding).toBe(0.03);
  });

  it("partial exemption together with rounding keeps two separate explanations", () => {
    const r = ok(buildClearingLines({ outputVat: 50, inputVat: 200.02 }, { outputVat: 50, inputVat: 160, net: -110, expectedIrrecoverable: 40 }, A));
    expect(r.irrecoverable).toBe(40);
    expect(r.rounding).toBe(0.02);
    expect(net(r.lines, "irr")).toBe(40.02);
  });

  it("a mismatch of 45 is refused with both figures and the per-account differences", () => {
    const res = buildClearingLines({ outputVat: 100, inputVat: 245 }, { outputVat: 100, inputVat: 200, net: -100 }, A);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VAT_LEDGER_MISMATCH");
    expect(res.details.ledger).toEqual({ outputVat: 100, inputVat: 245 });
    expect(res.details.returned).toMatchObject({ outputVat: 100, inputVat: 200 });
    expect(res.details.differences).toMatchObject({ outputVat: 0, inputVat: 45, unexplained: 45 });
  });

  it("a mismatch on the output side is refused too", () => {
    const res = buildClearingLines({ outputVat: 160, inputVat: 20 }, { outputVat: 100, inputVat: 20, net: 80 }, A);
    expect(res.ok).toBe(false);
  });

  it("errors on opposite sides cannot cancel each other", () => {
    const res = buildClearingLines({ outputVat: 110, inputVat: 120 }, { outputVat: 100, inputVat: 110, net: -10 }, A);
    expect(res.ok).toBe(false);
  });

  it("exactly 1.00 is written off, 1.01 is refused", () => {
    expect(VAT_ROUNDING_TOLERANCE_FILS).toBe(100);
    expect(buildClearingLines({ outputVat: 100, inputVat: 21 }, { outputVat: 100, inputVat: 20, net: 80 }, A).ok).toBe(true);
    expect(buildClearingLines({ outputVat: 100, inputVat: 21.01 }, { outputVat: 100, inputVat: 20, net: 80 }, A).ok).toBe(false);
  });

  it("amendment: only the DIFFERENCE is cleared (deltas of ledger and return)", () => {
    // the amendment adds 25 output VAT to both the ledger and the return
    const r = ok(buildClearingLines({ outputVat: 25, inputVat: 0 }, { outputVat: 25, inputVat: 0, net: 25 }, A));
    expect(net(r.lines, "out")).toBe(25);
    expect(net(r.lines, "ctl")).toBe(-25);
    expect(r.lines).toHaveLength(2);
  });

  it("amendment that lowers input VAT reverses part of the clearing", () => {
    const r = ok(buildClearingLines({ outputVat: 0, inputVat: -30 }, { outputVat: 0, inputVat: -30, net: 30 }, A));
    expect(net(r.lines, "in")).toBe(30);
    expect(net(r.lines, "ctl")).toBe(-30);
  });

  it("balances to the fils for awkward decimals", () => {
    ok(buildClearingLines({ outputVat: 1234.57, inputVat: 233.34 }, { outputVat: 1234.57, inputVat: 233.33, net: 1001.24 }, A));
  });

  it("manual adjustment recorded on the return explains a gap and carries the reason", () => {
    // box 12 hand-edited from 50 to 5; ledger still holds 50
    const r = ok(
      buildClearingLines(
        { outputVat: 50, inputVat: 0 },
        { outputVat: 5, inputVat: 0, net: 5, manual: { outputVat: -45, inputVat: 0, reason: "Client-agreed correction" } },
        A
      )
    );
    expect(net(r.lines, "out")).toBe(50);
    expect(net(r.lines, "ctl")).toBe(-5);
    expect(net(r.lines, "irr")).toBe(-45);
    expect(r.manualAdjustment).toBe(-45);
    expect(r.lines.find((l) => l.accountId === "irr")?.description).toMatch(/Client-agreed correction/);
  });

  it("a manual adjustment that does not explain the gap is still refused", () => {
    const res = buildClearingLines(
      { outputVat: 50, inputVat: 0 },
      { outputVat: 5, inputVat: 0, net: 5, manual: { outputVat: -10, inputVat: 0, reason: "x" } },
      A
    );
    expect(res.ok).toBe(false);
  });
});
