import { describe, expect, it } from "vitest";
import { accountByCode, freezeTime, ledgerTotals, postJournalEntry, useHarness } from "./harness";

const h = useHarness();

describe("db harness", () => {
  it("boots the real app against a fresh migrated database", async () => {
    const live = await h.anon.get("/health/live");
    expect(live.status).toBe(200);
    const rows = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM drizzle.__drizzle_migrations`
    );
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(109);
    // 0089 platform foundation is applied.
    const t = await h.sql(`SELECT to_regclass('public.ai_usage_events') AS t`);
    expect(t[0].t).toBe("ai_usage_events");
  });

  it("creates isolated tenants with Bearer clients", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    expect(a.company.id).not.toBe(b.company.id);
    const own = await a.as.get(`/api/companies/${a.company.id}/accounts`);
    expect(own.status).toBe(200);
    expect(Array.isArray(own.body)).toBe(true);
    const foreign = await b.as.get(`/api/companies/${a.company.id}/accounts`);
    expect([403, 404]).toContain(foreign.status);
  });

  it("supports roles, account lookup and posted journal factories", async () => {
    const t = await h.createTenant({ role: "accountant" });
    const role = await h.sql(`SELECT role FROM company_users WHERE user_id = $1`, [t.user.id]);
    expect(role[0].role).toBe("accountant");
    const bank = await accountByCode(t, "1020");
    expect(bank.id).toBeTruthy();
    await postJournalEntry(t, {
      date: "2026-01-15",
      description: "capital",
      lines: [
        { code: "1020", debit: 1000 },
        { code: "3010", credit: 1000 },
      ],
    });
    const totals = await ledgerTotals(t.company.id);
    expect(totals.debit).toBe(1000);
    expect(totals.credit).toBe(1000);
  });

  it("can enforce and reset rate limits", async () => {
    const t = await h.createTenant();
    await h.setRateLimits({ read: 2 });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await t.as.get(`/api/companies/${t.company.id}/accounts`)).status);
      }
      expect(statuses).toContain(429);
    } finally {
      await h.resetRateLimits();
    }
    expect((await t.as.get(`/api/companies/${t.company.id}/accounts`)).status).toBe(200);
  });

  it("freezes Date for test and server", async () => {
    const restore = freezeTime("2030-06-01T00:00:00Z");
    try {
      expect(new Date().toISOString().startsWith("2030-06-01")).toBe(true);
    } finally {
      restore();
    }
    expect(new Date().getFullYear()).toBeLessThan(2030);
  });
});
