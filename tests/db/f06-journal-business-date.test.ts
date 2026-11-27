/**
 * F06: period locks and stored journal dates use the Dubai business date, not the UTC date.
 * journal_entries.date is a timestamp without time zone holding the Dubai calendar day, so
 * `date::date` reads it back independent of the session time zone.
 *
 * Two clock windows are used to prove two distinct reversal behaviours:
 * 1. Open-period reversal (clock advanced to Dubai Feb 2): the reversal uses the ORIGINAL
 *    date (Feb 1), not "today" (Feb 2). Both dates are in the same open period.
 * 2. Locked-period reversal (clock back to Dubai Feb 1): the reversal defaults to Dubai
 *    today (Feb 1) because the original period (Jan) is locked.
 *    UTC is 2026-01-31 but Dubai is 2026-02-01 (UTC+4); the stored date must be "2026-02-01".
 */
import { expect, it, vi } from "vitest";
import { freezeTime, useHarness } from "./harness";

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
  // Start with clock frozen at 2026-01-31T20:30:00Z (UTC = Jan 31, Dubai = Feb 1 UTC+4).
  const thaw = freezeTime("2026-01-31T20:30:00Z");
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

  // Seed a January journal before locking January — the locked-period reversal below needs an
  // entry whose period is locked so it defaults to Dubai today rather than the original date.
  const jan = await t.as.post(`${base}/journal`, entry("2026-01-15", "January seed"));
  expect(jan.status, jan.text).toBeLessThan(300);

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

  // A plain date is stored as written (Feb 1, still in the open period after the Jan lock).
  const plain = await t.as.post(`${base}/journal`, entry("2026-02-01", "plain"));
  expect(plain.status, plain.text).toBeLessThan(300);
  expect(await storedDate(plain.body.id)).toBe("2026-02-01");
  if (plain.body.date) expect(String(plain.body.date).slice(0, 10)).toBe("2026-02-01");

  // Advance to 2026-02-01T20:00:00Z (Dubai = Feb 2, 00:00) to prove the open-period reversal
  // uses the ORIGINAL date (Feb 1), not today (Feb 2). The access token expires at 20:30Z so
  // 20:00Z leaves a 30-minute window. The plain entry's period (Feb) is still open.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-01T20:00:00Z") });
  const rev = await t.as.post(`/api/journal/${plain.body.id}/reverse`, {});
  expect(rev.status, rev.text).toBe(200);
  const revStored = await storedDate(rev.body.reversalId);
  // Original date Feb 1 is earlier than Dubai today Feb 2 → server must return original date.
  expect(revStored).toBe("2026-02-01");
  if (rev.body.reversalDate) expect(String(rev.body.reversalDate).slice(0, 10)).toBe("2026-02-01");

  // Restore to 2026-01-31T20:30:00Z (Dubai = Feb 1) for the locked-period assertion.
  // January is locked (through 2026-01-31). The Jan-15 entry's period is locked, so an
  // undated reversal must default to Dubai today (Feb 1), not the original date (Jan 15).
  // UTC is 2026-01-31, Dubai is 2026-02-01 (UTC+4); stored date must be "2026-02-01".
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-31T20:30:00Z") });
  const rev2 = await t.as.post(`/api/journal/${jan.body.id}/reverse`, {});
  expect(rev2.status, rev2.text).toBe(200);
  const rev2Stored = await storedDate(rev2.body.reversalId);
  expect(rev2Stored).toBe("2026-02-01");
  if (rev2.body.reversalDate) {
    expect(String(rev2.body.reversalDate).slice(0, 10)).toBe("2026-02-01");
  }
  thaw();
});
