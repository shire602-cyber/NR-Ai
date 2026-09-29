import { beforeEach, describe, expect, it, vi } from "vitest";

const getBankTransactionById = vi.fn();
const reconcileBankTransaction = vi.fn();
const assertPeriodNotLocked = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    getBankTransactionById: (...a: unknown[]) => getBankTransactionById(...a),
    reconcileBankTransaction: (...a: unknown[]) => reconcileBankTransaction(...a),
  },
}));
vi.mock("../../server/services/period-lock.service", () => ({
  assertPeriodNotLocked: (...a: unknown[]) => assertPeriodNotLocked(...a),
}));

import { applyReconcileMatches } from "../../server/services/auto-reconcile.service";

const match = [{ bankTransactionId: "t1", matchedType: "invoice", matchedId: "i1" }];
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

beforeEach(() => {
  getBankTransactionById.mockReset();
  reconcileBankTransaction.mockReset();
  assertPeriodNotLocked.mockReset();
});

describe("applyReconcileMatches uses the shared settlement-date rules", () => {
  it("rejects a bank line dated in the future and reconciles nothing", async () => {
    getBankTransactionById.mockResolvedValue({ transactionDate: daysFromNow(5) });
    const r = await applyReconcileMatches("c1", match, "u1");
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/future/i);
    expect(reconcileBankTransaction).not.toHaveBeenCalled();
  });

  it("checks the period lock on the bank date and reports a locked period", async () => {
    const bankDate = daysFromNow(-3);
    getBankTransactionById.mockResolvedValue({ transactionDate: bankDate });
    assertPeriodNotLocked.mockRejectedValue(new Error("Period is locked"));
    const r = await applyReconcileMatches("c1", match, "u1");
    expect(assertPeriodNotLocked).toHaveBeenCalledWith("c1", bankDate);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/locked/i);
    expect(reconcileBankTransaction).not.toHaveBeenCalled();
  });

  it("reconciles a past-dated bank line (even one before the invoice: a deposit)", async () => {
    getBankTransactionById.mockResolvedValue({ transactionDate: daysFromNow(-90) });
    assertPeriodNotLocked.mockResolvedValue(undefined);
    const r = await applyReconcileMatches("c1", match, "u1");
    expect(r).toEqual({ applied: 1, errors: [] });
    expect(reconcileBankTransaction).toHaveBeenCalledTimes(1);
  });
});
