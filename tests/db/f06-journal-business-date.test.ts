/**
 * F06: period locks and stored journal dates use the Dubai business date, not the UTC date.
 * journal_entries.date is a timestamp without time zone holding the Dubai calendar day, so
 * `date::date` reads it back independent of the session time zone.
 */
import { expect, it } from "vitest";
import { todayDubai } from "../../shared/accounting-date";
import { useHarness } from "./harness";

const h = useHarness();

async function accountId(companyId: string, code: string): Promise<string> {
  const rows = await h.sql<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id=$1 AND code=$2`,
    [companyId, code]
  );
  return rows[0].id;
}

async function storedDate(id: string): Promise<string> {
  const rows = await h.sql<{ d: string }>(
    `SELECT to_char(date::date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE id=$1`,
    [id]
  );
  return rows[0].d;
}

it("F06: Dubai business date drives period locks, stored dates and reversal defaults", async () => {
  const t = await h.createTenant({ name: "F06Dates" });
  const base = `/api/companies/${t.company.id}`;
  const debit = await accountId(t.company.id, "1060");
  const credit = await accountId(t.company.id, "1020");
  const entry = (date: string, memo: string) => ({
    date,
    description: memo,
    status: "posted",
    lines: [
      { accountId: debit, debit: 50, credit: 0 },
      { accountId: credit, debit: 0, credit: 50 },
    ],
  });
  const lock = async (periodEnd: string) => {
    const r = await t.as.post(`${base}/month-end/lock-period`, {
      periodEnd,
      overrideChecklist: true,
      lockType: "hard",
      reason: "F06 fixture",
    });
    expect(r.status, r.text).toBe(200);
  };

  await lock("2026-01-31");

  // 19:59Z on 31 Jan is 23:59 Dubai on 31 Jan: still the locked month.
  const locked = await t.as.post(`${base}/journal`, entry("2026-01-31T19:59:00Z", "late Jan"));
  expect(locked.status, locked.text).toBe(403);
  expect(locked.body.code).toBe("PERIOD_LOCKED");

  // 20:30Z on 31 Jan is 00:30 Dubai on 1 Feb: open month, stored as the Dubai day.
  const next = await t.as.post(`${base}/journal`, entry("2026-01-31T20:30:00Z", "Dubai Feb 1"));
  expect(next.status, next.text).toBeLessThan(300);
  expect(await storedDate(next.body.id)).toBe("2026-02-01");
  if (next.body.date) expect(String(next.body.date).slice(0, 10)).toBe("2026-02-01");

  // A plain date is stored as written.
  const plain = await t.as.post(`${base}/journal`, entry("2026-02-10", "plain"));
  expect(plain.status, plain.text).toBeLessThan(300);
  expect(await storedDate(plain.body.id)).toBe("2026-02-10");
  if (plain.body.date) expect(String(plain.body.date).slice(0, 10)).toBe("2026-02-10");

  // Reversal without a date: original date when its period is open.
  const rev = await t.as.post(`/api/journal/${plain.body.id}/reverse`, {});
  expect(rev.status, rev.text).toBe(200);
  const revStored = await storedDate(rev.body.reversalId);
  expect(revStored).toBe("2026-02-10");
  if (rev.body.reversalDate) expect(String(rev.body.reversalDate).slice(0, 10)).toBe(revStored);

  // Reversal without a date once the original's period is locked: today (Dubai).
  await lock("2026-02-28");
  const rev2 = await t.as.post(`/api/journal/${next.body.id}/reverse`, {});
  expect(rev2.status, rev2.text).toBe(200);
  const rev2Stored = await storedDate(rev2.body.reversalId);
  expect(rev2Stored).toBe(todayDubai());
  if (rev2.body.reversalDate) {
    expect(String(rev2.body.reversalDate).slice(0, 10)).toBe(rev2Stored);
  }
});
