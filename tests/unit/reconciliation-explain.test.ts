import { describe, expect, it } from "vitest";
import { explainItems, reconciliationVerdict } from "../../client/src/components/banking/reconciliation-explain";
import type { ReconciliationStatement } from "../../client/src/lib/banking-api-types";

const base = (over: Partial<ReconciliationStatement> = {}, items: Partial<ReconciliationStatement["items"]> = {}): ReconciliationStatement => ({
  bankAccountId: "b1",
  asOf: "2026-09-30",
  currency: "AED",
  statementBalance: 207270,
  statementBalanceSource: "param",
  ledgerBalance: 207270,
  unreconciledCredits: 0,
  unreconciledDebits: 0,
  depositsInTransit: 0,
  outstandingPayments: 0,
  adjustedStatementBalance: 207270,
  adjustedLedgerBalance: 207270,
  difference: 0,
  items: { unreconciledCredits: [], unreconciledDebits: [], depositsInTransit: [], outstandingPayments: [], ...items },
  ...over,
});
const led = (id: string, amount: number, date = "2026-09-10", source = "payment") => ({ entryId: id, entryNumber: `JE-${id}`, date, memo: `memo ${id}`, source, sourceId: null, amount });
const stm = (id: string, amount: number, date = "2026-09-12") => ({ transactionId: id, date, description: `line ${id}`, reference: `REF-${id}`, amount });

describe("explainItems", () => {
  it("gives every item a type, a document and a positive amount, oldest first", () => {
    const items = explainItems(base({}, { depositsInTransit: [led("a", 600, "2026-09-20")], outstandingPayments: [led("b", -2100, "2026-09-29", "bill_payment")], unreconciledCredits: [stm("c", 50, "2026-09-05")] }));
    expect(items.map((i) => [i.type, i.amount])).toEqual([["STATEMENT_CREDIT", 50], ["DEPOSIT_IN_TRANSIT", 600], ["OUTSTANDING_PAYMENT", 2100]]);
    expect(items[2].document).toEqual({ source: "bill_payment", number: "JE-b", reference: null });
    expect(items[0].document.reference).toBe("REF-c");
  });
  it("pairs a deposit in transit with a statement credit of the same amount", () => {
    const items = explainItems(base({}, { depositsInTransit: [led("a", 21000)], unreconciledCredits: [stm("c", 21000), stm("d", 9000)] }));
    const dep = items.find((i) => i.key === "L:a")!;
    expect(dep.pairedWith).toBe("S:c");
    expect(items.find((i) => i.key === "S:d")!.pairedWith).toBeNull();
  });
  it("pairs an outstanding payment with a statement debit", () => {
    const items = explainItems(base({}, { outstandingPayments: [led("a", -400)], unreconciledDebits: [stm("c", -400)] }));
    expect(items.every((i) => i.pairedWith)).toBe(true);
  });
});

describe("reconciliationVerdict", () => {
  it("is balanced for a genuine outstanding cheque", () => {
    const v = reconciliationVerdict(base({ outstandingPayments: 2100 }, { outstandingPayments: [led("a", -2100, "2026-09-29", "bill_payment")] }));
    expect(v.verdict).toBe("balanced");
    expect(v.items).toHaveLength(1);
  });
  it("never says balanced while items are half of an unmatched pair (the teardown's six phantom items)", () => {
    const v = reconciliationVerdict(base({}, { depositsInTransit: [led("a", 21000), led("b", 10500)], unreconciledCredits: [stm("c", 21000), stm("d", 10500)] }));
    expect(v.verdict).toBe("balanced_with_unmatched");
    expect(v.unmatchedPairs).toBe(2);
  });
  it("is not balanced with a difference, and needs a statement balance without one", () => {
    expect(reconciliationVerdict(base({ difference: 10000 })).verdict).toBe("not_balanced");
    expect(reconciliationVerdict(base({ difference: null, statementBalance: null })).verdict).toBe("needs_statement_balance");
  });
});
