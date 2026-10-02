import { describe, it, expect } from "vitest";
import { actorRank, canSignStep, matchRule, rankOfRole, roleForStep, ruleInputProblem, unstaffedRoles } from "../../server/services/approval-rules";

const rule = (o: any) => ({ id: "r", documentType: "bill", name: "Rule", thresholdAed: 5000, approverRoles: ["accountant", "owner"], isActive: true, ...o });

describe("matchRule", () => {
  it("applies strictly above the threshold", () => {
    expect(matchRule([rule({})], "bill", 5000)).toBeNull();
    expect(matchRule([rule({})], "bill", 5000.01)?.id).toBe("r");
    expect(matchRule([rule({})], "bill", 4000)).toBeNull();
  });

  it("the highest matching threshold wins", () => {
    const low = rule({ id: "low", thresholdAed: 1000, approverRoles: ["accountant"] });
    const high = rule({ id: "high", thresholdAed: 20000, approverRoles: ["cfo", "owner"] });
    expect(matchRule([low, high], "bill", 25000)?.id).toBe("high");
    expect(matchRule([low, high], "bill", 5000)?.id).toBe("low");
  });

  it("ignores inactive rules and other document types", () => {
    expect(matchRule([rule({ isActive: false })], "bill", 9999)).toBeNull();
    expect(matchRule([rule({ documentType: "expense_claim" })], "bill", 9999)).toBeNull();
  });
});

describe("ranking", () => {
  it("ranks owner > cfo > accountant > employee", () => {
    expect([rankOfRole("owner"), rankOfRole("cfo"), rankOfRole("accountant"), rankOfRole("employee")]).toEqual([3, 2, 1, 0]);
    expect(rankOfRole("bookkeeper")).toBe(0);
    expect(rankOfRole(null)).toBe(0);
  });

  it("firm staff and platform admins rank as accountant when they have no membership", () => {
    expect(actorRank({ companyRole: null, firmRole: "firm_admin" })).toBe(1);
    expect(actorRank({ companyRole: null, isAdmin: true })).toBe(1);
    expect(actorRank({ companyRole: null })).toBe(0);
    expect(actorRank({ companyRole: "cfo", firmRole: "firm_owner" })).toBe(2);
  });

  it("a step needs a rank at or above its role", () => {
    expect(canSignStep(rankOfRole("owner"), "accountant")).toBe(true);
    expect(canSignStep(rankOfRole("accountant"), "owner")).toBe(false);
    expect(canSignStep(rankOfRole("employee"), "accountant")).toBe(false);
  });

  it("looks up the role of a 1-based step", () => {
    expect(roleForStep(["accountant", "owner"], 1)).toBe("accountant");
    expect(roleForStep(["accountant", "owner"], 2)).toBe("owner");
    expect(roleForStep(["accountant"], 2)).toBeNull();
  });
});

describe("ruleInputProblem", () => {
  it("accepts one or two known roles and a non-negative threshold", () => {
    expect(ruleInputProblem({ thresholdAed: 0, approverRoles: ["owner"] })).toBeNull();
    expect(ruleInputProblem({ thresholdAed: "5000", approverRoles: ["accountant", "cfo"] })).toBeNull();
  });
  it("rejects zero, three or unknown roles and a negative threshold", () => {
    expect(ruleInputProblem({ approverRoles: [] })?.code).toBe("INVALID_APPROVER_ROLES");
    expect(ruleInputProblem({ approverRoles: ["accountant", "cfo", "owner"] })?.code).toBe("INVALID_APPROVER_ROLES");
    expect(ruleInputProblem({ approverRoles: ["bookkeeper"] })?.code).toBe("INVALID_APPROVER_ROLES");
    expect(ruleInputProblem({ thresholdAed: -1 })?.code).toBe("INVALID_THRESHOLD");
  });
});

describe("unstaffedRoles", () => {
  it("a role is staffed by any active member of that rank or higher", () => {
    expect(unstaffedRoles(["accountant", "owner"], ["owner"])).toEqual([]);
    expect(unstaffedRoles(["cfo"], ["accountant", "employee"])).toEqual(["cfo"]);
    expect(unstaffedRoles(["accountant", "owner"], ["accountant"])).toEqual(["owner"]);
    expect(unstaffedRoles(["accountant"], [])).toEqual(["accountant"]);
  });
});
