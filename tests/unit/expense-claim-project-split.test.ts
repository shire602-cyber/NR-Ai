import { describe, it, expect } from "vitest";
import { buildExpenseClaimJournalLines } from "../../server/services/expense-claim-posting";

const ids: Record<string, string> = { "5050": "acc-5050", "5090": "acc-5090", "1050": "acc-vat", "2045": "acc-payable" };
const resolveByCode = (code: string) => ids[code];

describe("buildExpenseClaimJournalLines project split", () => {
  it("aggregates by (account, project) instead of account alone", () => {
    const built = buildExpenseClaimJournalLines({
      resolveByCode,
      items: [
        { category: "office supplies", amount: 100, vatAmount: 5, projectId: "p1" },
        { category: "office supplies", amount: 50, vatAmount: 0, projectId: "p1" },
        { category: "office supplies", amount: 200, vatAmount: 10, projectId: "p2" },
        { category: "office supplies", amount: 30, vatAmount: 0 },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const expense = built.lines.filter((l) => l.accountId === "acc-5050");
    expect(expense.map((l) => [l.projectId ?? null, l.debit]).sort()).toEqual([[null, 30], ["p1", 150], ["p2", 200]].sort());
    const vat = built.lines.find((l) => l.accountId === "acc-vat");
    expect(vat?.debit).toBe(15);
    expect(vat?.projectId ?? null).toBeNull();
    const dr = built.lines.reduce((s, l) => s + l.debit, 0);
    const cr = built.lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it("without any project the lines are exactly as before (one per account)", () => {
    const built = buildExpenseClaimJournalLines({
      resolveByCode,
      items: [
        { category: "office supplies", amount: 100, vatAmount: 5 },
        { category: "office supplies", amount: 50, vatAmount: 0 },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines.filter((l) => l.accountId === "acc-5050")).toHaveLength(1);
    expect(built.lines.every((l) => !("projectId" in l) || l.projectId == null)).toBe(true);
  });
});
