/**
 * R13-09: monthly trends on the 31st must return six distinct, ordered UAE months.
 */
import { afterAll, describe, expect, it } from "vitest";
import { freezeTime, postJournalEntry, useHarness } from "./harness";

const h = useHarness();
const restore = freezeTime("2026-10-31T10:00:00Z");
afterAll(() => restore());

describe("R13-09 monthly trends on 31 October", () => {
  it("returns May..Oct with no skipped or duplicated month", async () => {
    const t = await h.createTenant();
    await postJournalEntry(t, {
      date: "2026-10-31",
      description: "Late sale",
      lines: [
        { code: "1020", debit: 300 },
        { code: "4010", credit: 300 },
      ],
    });
    const r = await t.as.get(`/api/companies/${t.company.id}/dashboard/monthly-trends`);
    expect(r.status).toBe(200);
    expect(r.body.map((m: any) => m.month)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
    expect(r.body.map((m: any) => m.key)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(r.body.at(-1).revenue).toBe(300);
    const trend = await t.as.get(`/api/companies/${t.company.id}/analytics/profit-trend?months=6`);
    expect(trend.body.map((m: any) => m.month)).toEqual(r.body.map((m: any) => m.key));
  });

  it("UAE late-evening entries land in the UAE month, not the UTC one", async () => {
    const t = await h.createTenant();
    // 31 Oct 21:30 UTC is already 1 Nov 01:30 in the UAE.
    await h.sql(
      `WITH je AS (
         INSERT INTO journal_entries (company_id, entry_number, date, status, source, created_by, posted_by, posted_at)
         VALUES ($1, 'JE-LATE-1', '2026-10-31T21:30:00Z', 'posted', 'manual', $2, $2, now()) RETURNING id)
       INSERT INTO journal_lines (entry_id, account_id, debit, credit)
       SELECT je.id, a.id, CASE WHEN a.code = '1020' THEN 100 ELSE 0 END, CASE WHEN a.code = '4010' THEN 100 ELSE 0 END
         FROM je, accounts a WHERE a.company_id = $1 AND a.code IN ('1020', '4010')`,
      [t.company.id, t.user.id]
    );
    const r = await t.as.get(`/api/companies/${t.company.id}/analytics/profit-trend?months=2`);
    // frozen "now" is 31 Oct (UTC 10:00 -> UAE 14:00), so Nov is outside the window: Oct stays 0.
    const oct = r.body.find((m: any) => m.month === "2026-10");
    expect(oct.revenue).toBe(0);
  });
});
