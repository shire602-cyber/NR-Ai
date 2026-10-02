import { describe, expect, it } from "vitest";
import { canSeeEmployee, narrowEmployeeFilter, readsOnlyOwnRecords } from "../../server/services/hr-scope";
import { actorRank } from "../../server/services/approval-rules";

const own = { all: false as const, employeeIds: ["e1"] };
const nobody = { all: false as const, employeeIds: [] as string[] };
const everyone = { all: true as const };

describe("HR read scope", () => {
  it("limits only the employee role to their own records", () => {
    expect(readsOnlyOwnRecords(actorRank({ companyRole: "employee" }))).toBe(true);
    expect(readsOnlyOwnRecords(actorRank({ companyRole: null }))).toBe(true);
    for (const role of ["accountant", "cfo", "owner"]) expect(readsOnlyOwnRecords(actorRank({ companyRole: role }))).toBe(false);
    expect(readsOnlyOwnRecords(actorRank({ companyRole: null, firmRole: "firm_admin" }))).toBe(false);
    expect(readsOnlyOwnRecords(actorRank({ companyRole: null, isAdmin: true }))).toBe(false);
  });

  it("canSeeEmployee: full access sees everyone, own scope only the linked record", () => {
    expect(canSeeEmployee(everyone, "e2")).toBe(true);
    expect(canSeeEmployee(own, "e1")).toBe(true);
    expect(canSeeEmployee(own, "e2")).toBe(false);
    expect(canSeeEmployee(own, null)).toBe(false);
    expect(canSeeEmployee(nobody, "e1")).toBe(false);
  });

  it("narrowEmployeeFilter: another employee's id is forbidden, no id narrows to the own record", () => {
    expect(narrowEmployeeFilter(everyone, undefined)).toEqual({ kind: "any" });
    expect(narrowEmployeeFilter(everyone, "e9")).toEqual({ kind: "one", id: "e9" });
    expect(narrowEmployeeFilter(own, "e1")).toEqual({ kind: "one", id: "e1" });
    expect(narrowEmployeeFilter(own, "e2")).toEqual({ kind: "forbidden" });
    expect(narrowEmployeeFilter(own, undefined)).toEqual({ kind: "own", ids: ["e1"] });
    expect(narrowEmployeeFilter(nobody, undefined)).toEqual({ kind: "own", ids: [] });
    expect(narrowEmployeeFilter(nobody, "e1")).toEqual({ kind: "forbidden" });
  });
});
