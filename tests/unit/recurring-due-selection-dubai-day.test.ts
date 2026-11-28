import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DatabaseStorage } from "../../server/storage";

// Due selection is pure SQL (`next_run_date::date <= $1::date`), and the database's own now()
// cannot be frozen from JS, so this asserts the bound parameter instead: it must be the Dubai
// day from the JS clock, not the UTC day or the DB clock.
describe("recurring due selection binds the Dubai day", () => {
  afterEach(() => vi.useRealTimers());

  it("binds 2026-11-28 at 2026-11-27T21:30:00Z", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-27T21:30:00Z") });
    let captured: { sql: string; params: unknown[] } | undefined;
    const tx = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        captured = new PgDialect().sqlToQuery(query);
        return { rows: [] };
      },
    };
    const storage = new DatabaseStorage();
    await storage.fetchAndLockNextDueRecurringInvoice(tx as never);
    expect(captured?.sql).toContain("next_run_date::date <=");
    expect(captured?.params).toEqual(["2026-11-28"]);
  });
});
