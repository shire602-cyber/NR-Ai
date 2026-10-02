import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../server/errors";

const bulkMatch = vi.fn();
vi.mock("../../server/services/bank-bulk-match.service", () => ({ bulkMatch: (...a: unknown[]) => bulkMatch(...a) }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/bank-matching.service", () => ({ suggestForTransactions: vi.fn() }));

import { applyReconcileMatches, toLegacyMatch } from "../../server/services/auto-reconcile.service";

const match = [{ bankTransactionId: "t1", matchedType: "invoice", matchedId: "i1" }];

beforeEach(() => {
  bulkMatch.mockReset();
});

describe("applyReconcileMatches delegates to bulk-match", () => {
  it("maps legacy match types and reports the applied count", async () => {
    bulkMatch.mockResolvedValue({ applied: 2, results: [], dryRun: false });
    const r = await applyReconcileMatches("c1", [...match, { bankTransactionId: "t2", matchedType: "journal_entry", matchedId: "j1" }], "u1");
    expect(r).toEqual({ applied: 2, errors: [] });
    expect(bulkMatch).toHaveBeenCalledWith({ companyId: "c1", userId: "u1" }, [
      { transactionId: "t1", kind: "invoice", targetId: "i1" },
      { transactionId: "t2", kind: "journal", targetId: "j1" },
    ]);
  });

  it("a batch that cannot be applied comes back as applied 0 with the reasons (future date, locked period)", async () => {
    bulkMatch.mockImplementation(async () => {
      throw new AppError({ message: "x", statusCode: 422, code: "BULK_MATCH_INVALID", details: { errors: [{ index: 0, transactionId: "t1", code: "PAYMENT_DATE_IN_FUTURE", message: "Payment date 2099-01-01 is in the future." }] } });
    });
    const r = await applyReconcileMatches("c1", match, "u1");
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/future/i);
  });

  it("a race that stops the run reports what was applied", async () => {
    bulkMatch.mockImplementation(async () => {
      throw new AppError({ message: "x", statusCode: 409, code: "BULK_MATCH_PARTIAL", details: { applied: ["t0"], failed: { transactionId: "t1", message: "already reconciled" } } });
    });
    const r = await applyReconcileMatches("c1", match, "u1");
    expect(r).toEqual({ applied: 1, errors: ["Failed to reconcile t1: already reconciled"] });
  });

  it("other errors propagate", async () => {
    bulkMatch.mockImplementation(async () => {
      throw new Error("boom");
    });
    await expect(applyReconcileMatches("c1", match, "u1")).rejects.toThrow("boom");
  });
});

describe("toLegacyMatch", () => {
  const s = { transactionId: "t1", kind: "invoice", targetId: "i1", confidence: 80, reasons: ["AMOUNT_EXACT"], label: "Invoice 1", amount: 10, date: "2026-09-01", proposedLines: [], posts: true } as const;
  it("keeps invoice, bill, receipt and journal suggestions and drops rule and account ones", () => {
    expect(toLegacyMatch(s as any, "d")?.matchedType).toBe("invoice");
    expect(toLegacyMatch({ ...s, kind: "journal" } as any, "d")?.matchedType).toBe("journal_entry");
    expect(toLegacyMatch({ ...s, kind: "rule" } as any, "d")).toBeNull();
    expect(toLegacyMatch({ ...s, kind: "account" } as any, "d")).toBeNull();
  });
});
