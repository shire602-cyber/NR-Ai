import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetRoleBlocked, clearRoleBlocked, getRoleBlockedPath, isRoleRequiredError, isShellBackgroundKey, reportRoleRequired } from "./role-blocked";

const forbidden = Object.assign(new Error("no"), { status: 403, code: "ROLE_REQUIRED" });

afterEach(() => {
  __resetRoleBlocked();
  vi.unstubAllGlobals();
});

describe("role-required detection", () => {
  it("matches only a 403 with the ROLE_REQUIRED code", () => {
    expect(isRoleRequiredError(forbidden)).toBe(true);
    expect(isRoleRequiredError(Object.assign(new Error(), { status: 403, code: "OTHER" }))).toBe(false);
    expect(isRoleRequiredError(Object.assign(new Error(), { status: 401, code: "ROLE_REQUIRED" }))).toBe(false);
    expect(isRoleRequiredError(null)).toBe(false);
  });
  it("ignores the shell's own background requests", () => {
    expect(isShellBackgroundKey(["/api/notifications", "unread"])).toBe(true);
    expect(isShellBackgroundKey(["/api/onboarding"])).toBe(true);
    expect(isShellBackgroundKey(["/api/companies", "c1", "invoices"])).toBe(false);
  });
});

describe("reportRoleRequired", () => {
  it("records the page once however many queries fail, and clears", () => {
    vi.stubGlobal("window", { location: { pathname: "/invoices" } });
    reportRoleRequired(forbidden, ["/api/companies", "c1", "invoices"]);
    reportRoleRequired(forbidden, ["/api/companies", "c1", "customers"]);
    expect(getRoleBlockedPath()).toBe("/invoices");
    clearRoleBlocked();
    expect(getRoleBlockedPath()).toBeNull();
  });
  it("records nothing for a background key or another error", () => {
    vi.stubGlobal("window", { location: { pathname: "/invoices" } });
    reportRoleRequired(forbidden, ["/api/notifications"]);
    reportRoleRequired(new Error("x"), ["/api/x"]);
    expect(getRoleBlockedPath()).toBeNull();
  });
});
