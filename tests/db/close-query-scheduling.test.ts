import { expect, it, vi } from "vitest";
import pg from "pg";
import { useHarness } from "./harness";

const h = useHarness();

it.for(["month", "year"])(
  "runs the %s close with one outstanding query per connection",
  async (close, { skip }) => {
    if (!h.concurrencySupported) skip();
    const tenant = await h.createTenant({ name: `Serial ${close} close` });
    const base = `/api/companies/${tenant.company.id}/month-end`;
    const path = close === "month" ? "lock-period" : "year-end-close";
    const period =
      close === "month"
        ? { periodEnd: "2025-11-30" }
        : { fiscalYearEnd: "2025-12-31", hardClose: true };
    const original = pg.Client.prototype.query;
    const outstanding = new Map<pg.Client, number>();
    let peak = 0;
    const probe = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const pending = Reflect.apply(original, this, args);
      if (!(pending instanceof Promise)) return pending;
      const current = (outstanding.get(this) ?? 0) + 1;
      outstanding.set(this, current);
      peak = Math.max(peak, current);
      return pending.finally(() => outstanding.set(this, (outstanding.get(this) ?? 0) - 1));
    } as typeof original);

    try {
      const result = await tenant.as.post(`${base}/${path}`, {
        ...period,
        overrideChecklist: true,
        reason: "Close query scheduling regression",
      });
      expect(result.status, result.text).toBe(close === "month" ? 200 : 201);
      expect(peak).toBe(1);
    } finally {
      probe.mockRestore();
    }
  }
);

it("starts independent reads concurrently through a pooled report cache", async () => {
  const { memoQueryable, runReportReads } = await import("../../server/reporting");
  const q = memoQueryable();
  const issued = vi.spyOn(q, "query");
  const reads = runReportReads(
    q,
    () => q.query("SELECT 1 AS value"),
    () => q.query("SELECT 2 AS value")
  );
  try {
    expect(issued).toHaveBeenCalledTimes(2);
  } finally {
    await reads;
  }
});
