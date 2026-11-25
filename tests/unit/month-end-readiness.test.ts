// F04 — month-end progress comes only from a successful checklist response,
// and the lock transition is gated by server-side readiness.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  deriveChecklistProgress,
  evaluateCloseReadiness,
} from "../../shared/month-end-readiness";

const item = (id: number, done: boolean) => ({
  id,
  status: done ? ("complete" as const) : ("incomplete" as const),
});
const twoOfFive = [item(1, true), item(2, true), item(3, false), item(4, false), item(5, false)];

describe("F04 deriveChecklistProgress", () => {
  it("loading and read failure never fabricate counts", () => {
    expect(deriveChecklistProgress({ isLoading: true, isError: false, checklist: undefined })).toEqual({
      state: "loading",
    });
    expect(deriveChecklistProgress({ isLoading: false, isError: true, checklist: undefined })).toEqual({
      state: "error",
    });
    // No data but no error flag (e.g. disabled query) is still not "ready".
    expect(deriveChecklistProgress({ isLoading: false, isError: false, checklist: undefined }).state).toBe(
      "error"
    );
  });

  it("empty checklist is its own state, not All Clear", () => {
    expect(deriveChecklistProgress({ isLoading: false, isError: false, checklist: [] })).toEqual({
      state: "empty",
    });
  });

  it("two of five completed shows three remaining", () => {
    const p = deriveChecklistProgress({ isLoading: false, isError: false, checklist: twoOfFive });
    expect(p).toMatchObject({ state: "ready", total: 5, completed: 2, remaining: 3, allComplete: false });
  });

  it("all complete", () => {
    const p = deriveChecklistProgress({
      isLoading: false,
      isError: false,
      checklist: [item(1, true), item(2, true)],
    });
    expect(p).toMatchObject({ state: "ready", remaining: 0, allComplete: true });
  });
});

describe("F04 evaluateCloseReadiness (server lock gate)", () => {
  it("refuses an empty checklist", () => {
    expect(evaluateCloseReadiness({ checklist: [] })).toMatchObject({
      ok: false,
      code: "CLOSE_CHECKLIST_EMPTY",
    });
  });

  it("refuses unacknowledged open items and lists them", () => {
    expect(evaluateCloseReadiness({ checklist: twoOfFive })).toMatchObject({
      ok: false,
      status: 409,
      code: "CLOSE_NOT_READY",
      openItemIds: [3, 4, 5],
    });
  });

  it("stale acknowledgement forces revalidation", () => {
    // Client saw items 3,4 open; server now finds 3,4,5 open.
    expect(
      evaluateCloseReadiness({ checklist: twoOfFive, acknowledgedOpenItemIds: [3, 4] })
    ).toMatchObject({ ok: false, code: "CLOSE_STALE_CHECKLIST", openItemIds: [3, 4, 5] });
  });

  it("matching acknowledgement or all-complete passes", () => {
    expect(
      evaluateCloseReadiness({ checklist: twoOfFive, acknowledgedOpenItemIds: ["5", 4, 3] })
    ).toMatchObject({ ok: true, openItemIds: [3, 4, 5] });
    expect(evaluateCloseReadiness({ checklist: [item(1, true)] })).toEqual({ ok: true, openItemIds: [] });
  });
});

describe("F04 source invariants", () => {
  const page = readFileSync("client/src/pages/MonthEndClose.tsx", "utf8");
  const route = readFileSync("server/routes/month-end.routes.ts", "utf8");
  it("page has no seven-item fallback and handles history errors separately", () => {
    expect(page).not.toMatch(/checklist\.length \|\| 7/);
    expect(page).toContain("deriveChecklistProgress");
    expect(page).toContain("isHistoryError");
  });
  it("lock route recomputes readiness before locking", () => {
    const gate = route.indexOf("evaluateCloseReadiness({");
    const lock = route.indexOf("await lockPeriod(companyId, periodEnd, userId)");
    expect(gate).toBeGreaterThan(0);
    expect(lock).toBeGreaterThan(gate);
  });
});
