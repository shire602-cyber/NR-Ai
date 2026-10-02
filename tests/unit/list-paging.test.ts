import { describe, expect, it } from "vitest";
import { pageView } from "../../client/src/lib/list-paging";

describe("pageView", () => {
  it("shows 25 of 60 on the first page", () => {
    expect(pageView(60, 0, 25)).toMatchObject({ from: 1, to: 25, start: 0, end: 25, pageCount: 3, hasPrev: false, hasNext: true });
  });
  it("shows the remainder on the last page", () => {
    expect(pageView(60, 2, 25)).toMatchObject({ from: 51, to: 60, hasNext: false, hasPrev: true });
  });
  it("clamps a page past the end and handles an empty list", () => {
    expect(pageView(10, 5, 25).page).toBe(0);
    expect(pageView(60, 9, 25).page).toBe(2);
    expect(pageView(0, 0, 25)).toMatchObject({ from: 0, to: 0, pageCount: 1, hasNext: false });
  });
});
