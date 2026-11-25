// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fragmentId } from "../../client/src/components/marketing/phase/fragment";

describe("URL fragment ids", () => {
  it("decodes a valid fragment", () => {
    expect(fragmentId("#compare")).toBe("compare");
    expect(fragmentId("#%D9%85")).toBe("م");
    expect(fragmentId("")).toBe("");
  });

  it("ignores a malformed fragment instead of throwing (/en#%)", () => {
    expect(() => fragmentId("#%")).not.toThrow();
    expect(fragmentId("#%")).toBe("");
    expect(fragmentId("#%E0%A4%A")).toBe("");
  });
});
