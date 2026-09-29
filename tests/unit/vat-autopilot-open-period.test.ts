import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../server/db", () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

import {
  persistCalculation,
  updatePeriodStatus,
  markStoredPeriodPreview,
  type VatAutopilotCalculation,
} from "../../server/services/vat-autopilot.service";

// 2026-09-29 12:00 UTC == 16:00 UAE
const NOW = new Date("2026-09-29T12:00:00Z");

function calc(start: string, end: string): VatAutopilotCalculation {
  return {
    companyId: "c1",
    period: {
      start: new Date(`${start}T00:00:00Z`),
      end: new Date(`${end}T00:00:00Z`),
      dueDate: new Date("2026-10-28T00:00:00Z"),
      frequency: "quarterly",
    },
    boxes: { totalOutputVat: 1, totalInputVat: 1, netVatPayable: 0 },
  } as unknown as VatAutopilotCalculation;
}

beforeEach(() => query.mockReset());

describe("persistCalculation", () => {
  it("does not write anything for an open period and returns no periodId", async () => {
    const r = await persistCalculation(calc("2026-07-01", "2026-09-30"), { persist: true, now: NOW });
    expect(query).not.toHaveBeenCalled();
    expect(r.periodId).toBeNull();
    expect(r.isDraftPreview).toBe(true);
    expect(r.previewAsOf).toBe("2026-09-29");
  });

  it("persists a closed period and returns its id", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "p1" }] });
    const r = await persistCalculation(calc("2026-04-01", "2026-06-30"), { persist: true, now: NOW });
    expect(query).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ periodId: "p1", isDraftPreview: false, previewAsOf: null });
  });

  it("does not persist a closed period when persist=false", async () => {
    const r = await persistCalculation(calc("2026-04-01", "2026-06-30"), { persist: false, now: NOW });
    expect(query).not.toHaveBeenCalled();
    expect(r.periodId).toBeNull();
  });

  it("rejects a period that has not started with a 422 and writes nothing", async () => {
    await expect(
      persistCalculation(calc("2026-10-01", "2026-12-31"), { persist: true, now: NOW })
    ).rejects.toMatchObject({ statusCode: 422, code: "PERIOD_IN_FUTURE" });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("updatePeriodStatus", () => {
  const base = { periodId: "p1", companyId: "c1", userId: "u1" };

  it("returns null and issues no UPDATE when the period is not found for that company", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = await updatePeriodStatus({ ...base, newStatus: "ready" });
    expect(r).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toMatch(/^\s*SELECT/i);
    expect(query.mock.calls[0][1]).toEqual(["p1", "c1"]);
  });

  it.each(["ready", "submitted", "accepted"] as const)(
    "refuses to move an open period to %s and issues no UPDATE",
    async (target) => {
      const openRow = {
        id: "p1",
        company_id: "c1",
        status: target === "ready" ? "draft" : target === "submitted" ? "ready" : "submitted",
        period_start: "2020-01-01",
        period_end: "2999-12-31",
      };
      query.mockResolvedValueOnce({ rows: [openRow] });
      await expect(updatePeriodStatus({ ...base, newStatus: target })).rejects.toMatchObject({
        code: "PERIOD_NOT_ENDED",
      });
      expect(query).toHaveBeenCalledTimes(1);
    }
  );
});

describe("markStoredPeriodPreview", () => {
  it("flags an open stored period as a draft preview and hides its stale state", () => {
    const row = { id: "p1", status: "ready", period_start: "2026-07-01", period_end: "2026-09-30" };
    expect(markStoredPeriodPreview(row, NOW)).toMatchObject({ isDraftPreview: true, status: "draft" });
  });

  it("leaves a closed stored period untouched apart from isDraftPreview=false", () => {
    const row = { id: "p1", status: "submitted", period_start: "2026-04-01", period_end: "2026-06-30" };
    expect(markStoredPeriodPreview(row, NOW)).toMatchObject({ isDraftPreview: false, status: "submitted" });
  });
});
