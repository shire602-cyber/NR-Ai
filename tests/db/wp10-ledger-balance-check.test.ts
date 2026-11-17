/**
 * WP10/WP12 (code audit §2.9): the firm bookkeeper dashboard, client health and the
 * two value-ops readers summed journal_lines themselves for their trial-balance
 * in-balance check. They now read `ledgerBalanceCheckByCompany` from the reporting
 * kernel. Pin that the kernel helper gives the same figures (difference and latest
 * journal activity) as the old ad-hoc query, across companies, for balanced books,
 * drafts, a closing entry and a deliberately unbalanced ledger.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

let a: Tenant;
let b: Tenant;
let empty: Tenant;

async function journal(t: Tenant, amount: number, status: "draft" | "posted" = "posted") {
  const cash = (await accountByCode(t, "1020")).id;
  const capital = (await accountByCode(t, "3010")).id;
  const r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
    date: today(),
    memo: "wp10 tb check",
    status,
    lines: [
      { accountId: cash, debit: amount, credit: 0 },
      { accountId: capital, debit: 0, credit: amount },
    ],
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body.id as string;
}

/** The query the four call sites used to run (the oracle). */
async function legacyCheck(companyIds: string[]) {
  const rows = await h.sql<{ company_id: string; d: string | null; c: string | null; last: Date }>(
    `SELECT je.company_id, SUM(jl.debit)::text AS d, SUM(jl.credit)::text AS c,
            MAX(COALESCE(je.updated_at, je.posted_at, je.created_at)) AS last
       FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.company_id = ANY($1::uuid[]) AND je.status = 'posted'
      GROUP BY je.company_id`,
    [companyIds]
  );
  return new Map(
    rows.map((r) => [
      r.company_id,
      {
        discrepancy: Math.round(Math.abs(Number(r.d ?? 0) - Number(r.c ?? 0)) * 100) / 100,
        last: new Date(r.last).getTime(),
      },
    ])
  );
}

beforeAll(async () => {
  a = await h.createTenant({ name: "TbA" });
  b = await h.createTenant({ name: "TbB" });
  empty = await h.createTenant({ name: "TbEmpty" });
  // A: balanced books, a draft that must not count, and a balanced closing entry.
  await journal(a, 1234.56);
  await journal(a, 99.99, "draft");
  const closing = await journal(a, 500);
  await h.sql(`UPDATE journal_entries SET source = 'year_end_close' WHERE id = $1`, [closing]);
  // B: a ledger knocked out of balance by 12.34 behind the kernel's back.
  const off = await journal(b, 1000);
  await h.sql(`UPDATE journal_lines SET debit = debit + 12.34 WHERE entry_id = $1 AND debit > 0`, [
    off,
  ]);
});

describe("WP10 ledgerBalanceCheckByCompany (reporting kernel)", () => {
  it("WP10: matches the old per-company trial-balance query to the fil", async () => {
    const { ledgerBalanceCheckByCompany } = await import("../../server/reporting");
    const ids = [a.company.id, b.company.id, empty.company.id];
    const kernel = await ledgerBalanceCheckByCompany(ids);
    const legacy = await legacyCheck(ids);
    for (const id of ids) {
      const k = kernel.get(id);
      const l = legacy.get(id);
      expect(k?.differenceFils ?? 0, id).toBe(Math.round((l?.discrepancy ?? 0) * 100));
      expect(k?.lastJournalAt?.getTime() ?? null, id).toBe(l?.last ?? null);
    }
    expect(kernel.get(a.company.id)).toMatchObject({
      debitFils: 123_456, // the closing entry is excluded from the totals, drafts never count
      creditFils: 123_456,
      differenceFils: 0,
    });
    expect(kernel.get(b.company.id)?.differenceFils).toBe(1234);
    expect(kernel.has(empty.company.id)).toBe(false);
    expect((await ledgerBalanceCheckByCompany([])).size).toBe(0);
  });
});
