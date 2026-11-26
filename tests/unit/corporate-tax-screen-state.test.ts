import { describe, expect, it } from "vitest";
import {
  buildDraftBody,
  isEmptyCalculation,
  loadFailure,
  returnsListState,
} from "../../client/src/pages/corporateTax/screenState";

describe("corporate tax screen state", () => {
  it("shows an empty list only after a successful empty response", () => {
    expect(returnsListState({ status: "success", fetchStatus: "idle", data: [] })).toBe("empty");
    expect(returnsListState({ status: "pending", fetchStatus: "idle", data: undefined })).toBe(
      "idle"
    );
    expect(returnsListState({ status: "error", fetchStatus: "idle", data: undefined })).toBe(
      "error"
    );
    // A failed refresh of a cached empty list is neither a load error nor a confirmed empty list.
    expect(returnsListState({ status: "error", fetchStatus: "idle", data: [] })).toBe("idle");
  });

  it("separates a failed first load from a failed refresh of cached data", () => {
    expect(loadFailure({ status: "error", data: undefined })).toBe("initial");
    expect(loadFailure({ status: "error", data: [] })).toBe("refresh");
    expect(loadFailure({ status: "error", data: [{}] })).toBe("refresh");
    expect(loadFailure({ status: "success", data: [] })).toBeNull();
    expect(loadFailure({ status: "pending", data: undefined })).toBeNull();
  });

  it("builds a draft only from a calculation or typed workpaper rows", () => {
    const base = {
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      calculation: null,
      manual: null,
      deductions: 0,
      rows: [],
      notes: "",
    };
    const totals = { totalRevenue: 100, totalExpenses: 40 };
    expect(buildDraftBody(base)).toBeNull();
    expect(buildDraftBody({ ...base, calculation: totals, periodEnd: "" })).toBeNull();
    expect(buildDraftBody({ ...base, calculation: totals })).toMatchObject({
      ...totals,
      workpaper: { source: "journal_calculation", rows: [] },
    });
    expect(
      buildDraftBody({ ...base, manual: totals, rows: [{ amount: 100 }, { amount: 0 }] })
    ).toMatchObject({
      ...totals,
      workpaper: { source: "manual_workpaper", rows: [{ amount: 100 }] },
    });
  });

  it("distinguishes an active initial fetch from a paused one", () => {
    expect(returnsListState({ status: "pending", fetchStatus: "fetching", data: undefined })).toBe(
      "loading"
    );
    expect(returnsListState({ status: "pending", fetchStatus: "paused", data: undefined })).toBe(
      "paused"
    );
    expect(returnsListState({ status: "success", fetchStatus: "paused", data: [] })).toBe("paused");
  });

  it("keeps cached rows visible when a refresh fails or pauses", () => {
    expect(returnsListState({ status: "success", fetchStatus: "idle", data: [{}] })).toBe("ready");
    expect(returnsListState({ status: "error", fetchStatus: "idle", data: [{}] })).toBe("ready");
    expect(returnsListState({ status: "success", fetchStatus: "paused", data: [{}] })).toBe(
      "ready"
    );
  });
  it("a calculation with no entries and no manual rows is an empty period", () => {
    expect(isEmptyCalculation({ journalEntriesProcessed: 0 }, false)).toBe(true);
    expect(isEmptyCalculation({ journalEntriesProcessed: 0 }, true)).toBe(false);
    expect(isEmptyCalculation({ journalEntriesProcessed: 5 }, false)).toBe(false);
    expect(isEmptyCalculation(null, false)).toBe(false);
  });
});
