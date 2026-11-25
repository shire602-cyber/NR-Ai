import { describe, expect, it } from "vitest";
import {
  isEmptyCalculation,
  returnsListState,
} from "../../client/src/pages/corporateTax/screenState";

describe("corporate tax screen state", () => {
  it("a failed fetch is an error, not an empty list", () => {
    expect(returnsListState({ isLoading: false, isError: true, data: undefined })).toBe("error");
    expect(returnsListState({ isLoading: false, isError: false, data: [] })).toBe("empty");
    expect(returnsListState({ isLoading: false, isError: false, data: [{}] })).toBe("ready");
    expect(returnsListState({ isLoading: true, isError: false, data: undefined })).toBe("loading");
  });
  it("a calculation with no entries and no manual rows is an empty period", () => {
    expect(isEmptyCalculation({ journalEntriesProcessed: 0 }, false)).toBe(true);
    expect(isEmptyCalculation({ journalEntriesProcessed: 0 }, true)).toBe(false);
    expect(isEmptyCalculation({ journalEntriesProcessed: 5 }, false)).toBe(false);
    expect(isEmptyCalculation(null, false)).toBe(false);
  });
});
