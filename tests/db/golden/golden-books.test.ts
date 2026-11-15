import { describe, expect, it } from "vitest";
import { ledgerTotals, useHarness } from "../harness";
import { seedGoldenBooksFY2025_2026 } from "./seed";

const h = useHarness();

describe("golden books FY2025-FY2026 (report 11)", () => {
  it("seeds through the real API and the whole ledger balances", async () => {
    const t = await h.createTenant({ name: "Golden" });
    const books = await seedGoldenBooksFY2025_2026(t);
    expect(Object.keys(books.invoices)).toHaveLength(4);
    expect(Object.keys(books.bills)).toHaveLength(3);

    const totals = await ledgerTotals(t.company.id);
    expect(totals.debit).toBeGreaterThan(100_000);
    expect(Math.abs(totals.debit - totals.credit)).toBeLessThan(0.005);

    // Every seeded document reached the ledger.
    const posted = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries WHERE company_id = $1 AND status = 'posted'`,
      [t.company.id]
    );
    // 3 manual + 4 invoice issues + 3 invoice payments + 3 bill approvals + 1 bill payment
    expect(Number(posted[0].n)).toBeGreaterThanOrEqual(14);
  });
});
