/** FAF one-year cap: buildFaf bounds the range before any query loads the general ledger. */
import { describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const url = (id: string, from: string, to: string) =>
  `/api/companies/${id}/reports/faf?from=${from}&to=${to}&format=json`;

describe("FAF range cap", () => {
  it("rejects a 2-year range with FAF_RANGE_TOO_LONG before any ledger query", async () => {
    const t = await h.createTenant();
    const { pool } = await import("../../server/db");
    const spy = vi.spyOn(pool, "query");
    try {
      const r = await t.as.get(url(t.company.id, "2024-01-01", "2025-12-31"));
      expect(r.status, r.text).toBe(400);
      expect(r.body.code).toBe("FAF_RANGE_TOO_LONG");
      expect(r.body.details).toMatchObject({ maxDays: 366 });
      const sql = spy.mock.calls.map((c) => String((c[0] as { text?: string })?.text ?? c[0]));
      expect(sql.filter((q) => /journal_(lines|entries)|companies/i.test(q))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("buildFaf rejects from > to with INVALID_RANGE (400)", async () => {
    const t = await h.createTenant();
    const { buildFaf } = await import("../../server/services/faf-export.service");
    await expect(
      buildFaf({ companyId: t.company.id, from: "2026-03-01", to: "2026-02-01" })
    ).rejects.toMatchObject({ code: "INVALID_RANGE", statusCode: 400 });
  });

  it("accepts exactly 366 days and rejects 367", async () => {
    const t = await h.createTenant();
    const ok = await t.as.get(url(t.company.id, "2024-01-01", "2024-12-31"));
    expect(ok.status, ok.text).toBe(200);
    const bad = await t.as.get(url(t.company.id, "2024-01-01", "2025-01-01"));
    expect(bad.status, bad.text).toBe(400);
    expect(bad.body.code).toBe("FAF_RANGE_TOO_LONG");
  });
});
