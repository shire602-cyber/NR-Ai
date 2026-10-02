import { describe, expect, it } from "vitest";
import { EMPLOYEE_HOME, employeeRedirectFor, isEmployeeAllowedPath, isEmployeeRole, payrollTabFromSearch } from "./employee-shell";
import { CUSTOMER_GROUPS, MORE_GROUP, destinationsOf } from "../components/layout/nav-config";

describe("employee shell paths", () => {
  it("allows the self-service screens", () => {
    for (const p of ["/dashboard", "/payroll", "/payroll?tab=leave", "/expense-claims", "/settings/security", "/notifications", "/help", "/help/payroll", "/developers/api"]) {
      expect(isEmployeeAllowedPath(p), p).toBe(true);
      expect(employeeRedirectFor(p), p).toBeNull();
    }
  });

  it("sends every finance screen to the employee home with a notice flag", () => {
    const finance = ["/invoices", "/journal", "/journal/abc", "/reports", "/reports/run/x", "/bill-pay", "/vat-filing", "/contacts", "/team", "/settings/company", "/accounts/1/ledger", "/import", "/settings/data", "/developer-settings"];
    for (const p of finance) expect(employeeRedirectFor(p), p).toBe(`${EMPLOYEE_HOME}?notice=role`);
  });

  it("does not let a lookalike prefix through", () => {
    expect(isEmployeeAllowedPath("/payroll-runs")).toBe(false);
    expect(isEmployeeAllowedPath("/helpdesk")).toBe(false);
    expect(isEmployeeAllowedPath("/dashboard/../invoices")).toBe(false);
  });

  it("treats only the exact role as an employee", () => {
    expect(isEmployeeRole("employee")).toBe(true);
    for (const r of ["owner", "accountant", "cfo", "", null, undefined]) expect(isEmployeeRole(r as string)).toBe(false);
  });

  it("redirects every customer menu entry except the payroll one", () => {
    const urls = [...CUSTOMER_GROUPS, MORE_GROUP].flatMap(destinationsOf).filter((u) => !isEmployeeAllowedPath(u));
    expect(urls).not.toContain("/payroll");
    expect(urls).toEqual(expect.arrayContaining(["/invoices", "/reports", "/vat-filing"]));
  });
});

describe("payrollTabFromSearch", () => {
  it("opens a known tab and ignores unknown ones", () => {
    expect(payrollTabFromSearch("?tab=leave")).toBe("leave");
    expect(payrollTabFromSearch("?tab=loans&x=1")).toBe("loans");
    expect(payrollTabFromSearch("?tab=bogus")).toBeNull();
    expect(payrollTabFromSearch("")).toBeNull();
  });
});
