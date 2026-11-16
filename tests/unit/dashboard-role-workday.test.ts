import { readDashboardSource } from "./dashboardSource";
import { describe, expect, it } from "vitest";

describe("dashboard role workday path", () => {
  it("keeps a lightweight owner/solo path before the full report workspace", () => {
    const dashboardSource = readDashboardSource(process.cwd(), true);

    expect(dashboardSource).toContain("dashboard-report-role-workday-path");
    expect(dashboardSource).toContain("dashboard-report-role-workday-action-${action.id}");
    expect(dashboardSource).toContain("Owner / solo path");
    expect(dashboardSource).toContain("Start with sales, spend, cash, then the weekly pack.");

    for (const actionId of [
      "owner-solo-invoice",
      "owner-solo-receipts",
      "owner-solo-cash",
      "owner-solo-pack",
    ]) {
      expect(dashboardSource).toContain(actionId);
    }
  });

  it("keeps a smaller freelancer path focused on billing, receipts, tax, and automation", () => {
    const dashboardSource = readDashboardSource(process.cwd(), true);

    expect(dashboardSource).toContain("Freelancer path");
    expect(dashboardSource).toContain("Start with billing, receipts, tax, then automation.");

    for (const actionId of [
      "freelancer-invoice",
      "freelancer-receipts",
      "freelancer-tax-cash",
      "freelancer-admin-automation",
    ]) {
      expect(dashboardSource).toContain(actionId);
    }
  });
});
