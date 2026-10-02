import { describe, expect, it } from "vitest";
import { nextAccountCode } from "../../client/src/components/banking/gl-account-code";

describe("nextAccountCode", () => {
  it("starts a bank account at 1021 instead of after the fixed assets", () => {
    expect(nextAccountCode(["1010", "1020", "1240", "1290"], "asset", 1021)).toBe("1021");
    expect(nextAccountCode(["1020", "1021", "1022"], "asset", 1021)).toBe("1023");
  });
  it("continues after the highest code in the kind's range", () => {
    expect(nextAccountCode(["1010", "1020", "1290", "2010"], "asset")).toBe("1291");
    expect(nextAccountCode(["1010", "2010", "2210"], "liability")).toBe("2211");
  });
  it("starts the range when the kind has no account yet", () => {
    expect(nextAccountCode(["1010"], "equity")).toBe("3001");
    expect(nextAccountCode([], "asset")).toBe("1001");
  });
  it("ignores codes that are not plain numbers and never repeats a used code", () => {
    expect(nextAccountCode(["1010", "ABC", "1010.5"], "asset")).toBe("1011");
    expect(nextAccountCode(["1998", "1999"], "asset")).toBe("");
  });
});
