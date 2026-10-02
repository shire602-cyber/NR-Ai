import { describe, it, expect } from "vitest";
import { planHasFeature } from "../../server/middleware/featureGate";

describe("API access plan gate (CTO decision: Professional and above)", () => {
  it.each([
    ["free", false],
    ["starter", false],
    ["professional", true],
    ["enterprise", true],
  ])("%s -> %s", (plan, expected) => {
    expect(planHasFeature(plan, "apiAccess")).toBe(expected);
  });
});
