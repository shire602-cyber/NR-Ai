import { describe, it, expect } from "vitest";
import { paginateList, parsePagination, MAX_PER_PAGE } from "../../server/lib/pagination";

const fakeRes = () => {
  const headers: Record<string, string> = {};
  const res: any = {
    headers,
    statusCode: 200,
    setHeader: (k: string, v: string) => (headers[k] = v),
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
};

describe("parsePagination", () => {
  it("is not requested without page or perPage", () => {
    expect(parsePagination({})).toEqual({ requested: false });
    expect(parsePagination({ other: "x" })).toEqual({ requested: false });
  });
  it("defaults the missing half and computes the offset", () => {
    expect(parsePagination({ page: "3" })).toMatchObject({ requested: true, ok: true, page: 3, perPage: 50, offset: 100 });
    expect(parsePagination({ perPage: "10" })).toMatchObject({ ok: true, page: 1, perPage: 10, offset: 0 });
  });
  it("caps perPage at 200", () => {
    expect(parsePagination({ page: "1", perPage: "5000" })).toMatchObject({ ok: true, perPage: MAX_PER_PAGE });
  });
  it.each([["0"], ["-1"], ["1.5"], ["abc"], [""]])("rejects page=%s", (v) => {
    expect(parsePagination({ page: v })).toMatchObject({ requested: true, ok: false });
  });
});

describe("paginateList", () => {
  const items = Array.from({ length: 125 }, (_, i) => i + 1);
  it("returns the list untouched when no page is asked for", () => {
    const res = fakeRes();
    expect(paginateList({ query: {} } as any, res, items)).toBe(items);
    expect(res.headers["X-Total-Count"]).toBeUndefined();
  });
  it("slices and sets the three headers", () => {
    const res = fakeRes();
    const page = paginateList({ query: { page: "2", perPage: "50" } } as any, res, items)!;
    expect(page[0]).toBe(51);
    expect(page).toHaveLength(50);
    expect(res.headers).toMatchObject({ "X-Total-Count": "125", "X-Page": "2", "X-Per-Page": "50" });
    expect(paginateList({ query: { page: "3", perPage: "50" } } as any, fakeRes(), items)).toHaveLength(25);
    expect(paginateList({ query: { page: "9", perPage: "50" } } as any, fakeRes(), items)).toEqual([]);
  });
  it("answers 400 for junk", () => {
    const res = fakeRes();
    expect(paginateList({ query: { page: "x" } } as any, res, items)).toBeNull();
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("INVALID_PAGINATION");
  });
});
