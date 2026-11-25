import { describe, expect, it } from "vitest";
import {
  isEmptyCalculation,
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
    expect(returnsListState({ status: "error", fetchStatus: "idle", data: [] })).toBe("error");
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
