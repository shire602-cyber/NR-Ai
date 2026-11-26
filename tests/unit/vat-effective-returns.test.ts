// F02 — VAT summary card counts each company/period once, at its effective version.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  effectiveNetVatDeclared,
  selectEffectiveVatReturns,
} from "../../shared/vat-effective-returns";

const r = (
  id: string,
  status: string,
  box14: number,
  submittedAt: string | null,
  opts: { companyId?: string; periodStart?: string; periodEnd?: string } = {}
) => ({
  id,
  companyId: opts.companyId ?? "co-1",
  periodStart: opts.periodStart ?? "2026-01-01",
  periodEnd: opts.periodEnd ?? "2026-03-31",
  status,
  submittedAt,
  createdAt: submittedAt ?? "2026-05-01T00:00:00Z",
  box14PayableTax: box14,
});

describe("F02 effective VAT return selection", () => {
  it("AED 10,000 original superseded by AED 9,000 counts once at 9,000", () => {
    const rows = [
      r("orig", "amended", 10000, "2026-04-20T08:00:00Z"),
      r("amend", "filed", 9000, "2026-05-10T08:00:00Z"),
    ];
    expect(effectiveNetVatDeclared(rows)).toBe(9000);
    expect(selectEffectiveVatReturns(rows).map((x) => x.id)).toEqual(["amend"]);
  });

  it("even if the original was never re-flagged, the later effective version wins", () => {
    const rows = [
      r("orig", "filed", 10000, "2026-04-20T08:00:00Z"),
      r("amend", "submitted", 9000, "2026-05-10T08:00:00Z"),
    ];
    expect(effectiveNetVatDeclared(rows)).toBe(9000);
  });

  it("pending amendment does not take effect before submission", () => {
    const rows = [
      r("orig", "filed", 10000, "2026-04-20T08:00:00Z"),
      r("draft-amend", "draft", 9000, null),
      r("review-amend", "pending_review", 8500, null),
    ];
    expect(effectiveNetVatDeclared(rows)).toBe(10000);
  });

  it("pending amendment: the amended original (as the server leaves it) keeps counting; the filed amendment then replaces it", () => {
    // amendVatReturn flips the original to "amended" when the amendment DRAFT is created, and the
    // original keeps its submittedAt. A pending amendment must not remove the period's tax.
    const original = r("orig", "amended", 10000, "2026-04-20T08:00:00Z");
    const pending = { ...r("amend", "draft", 9000, null), amendsReturnId: original.id };
    expect(effectiveNetVatDeclared([original, pending])).toBe(10000);
    expect(selectEffectiveVatReturns([pending, original]).map((x) => x.id)).toEqual(["orig"]);

    const filed = r("amend", "filed", 9000, "2026-05-10T08:00:00Z");
    expect(effectiveNetVatDeclared([original, filed])).toBe(9000);
    expect(selectEffectiveVatReturns([filed, original]).map((x) => x.id)).toEqual(["amend"]);
  });

  it.each(["submitted", "filed"])(
    "a %s amendment supersedes a predecessor recorded after its historical filing date",
    (status) => {
      const original = r("orig", "amended", 10000, "2026-06-01T08:00:00Z");
      const amendment = {
        ...r("amend", status, 9000, "2026-04-25T08:00:00Z"),
        amendsReturnId: original.id,
      };

      expect(selectEffectiveVatReturns([original, amendment])).toEqual([amendment]);
      expect(effectiveNetVatDeclared([amendment, original])).toBe(9000);
    }
  );

  it("multiple amendments: only the latest effective counts", () => {
    const rows = [
      r("orig", "amended", 10000, "2026-04-20T08:00:00Z"),
      r("a1", "amended", 9000, "2026-05-10T08:00:00Z"),
      r("a2", "filed", 9500.55, "2026-06-01T08:00:00Z"),
    ];
    expect(effectiveNetVatDeclared(rows)).toBe(9500.55);
  });

  it("refunds net against payables; two periods and two companies stay separate", () => {
    const rows = [
      r("q1", "filed", 9000, "2026-04-20T08:00:00Z"),
      r("q2", "filed", -1250.25, "2026-07-20T08:00:00Z", {
        periodStart: "2026-04-01",
        periodEnd: "2026-06-30",
      }),
      r("co2-q1", "filed", 300, "2026-04-21T08:00:00Z", { companyId: "co-2" }),
    ];
    expect(effectiveNetVatDeclared(rows)).toBe(8049.75);
    expect(selectEffectiveVatReturns(rows)).toHaveLength(3);
  });

  it("VATFiling card uses the effective selector, not a raw reduce over all rows", () => {
    const page = readFileSync("client/src/pages/VATFiling.tsx", "utf8");
    expect(page).toContain("effectiveNetVatDeclared(vatReturns)");
    expect(page).not.toMatch(/vatReturns\.reduce\(\(sum, r\) => sum \+ \(r\.box14PayableTax/);
  });
});
