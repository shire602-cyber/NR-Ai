// Phase 8 D2: projects and approvals are Professional features (owner decision, 2026-10-02).
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/storage", () => ({ storage: {} }));

import { getTierFeatures } from "../../server/middleware/featureGate";

describe("D2 plan gating", () => {
  it("projects and approvals are off for free and starter, on for professional and enterprise", () => {
    for (const feature of ["projects", "approvals"]) {
      expect(getTierFeatures("free")[feature]).toBe(false);
      expect(getTierFeatures("starter")[feature]).toBe(false);
      expect(getTierFeatures("professional")[feature]).toBe(true);
      expect(getTierFeatures("enterprise")[feature]).toBe(true);
    }
  });

  it("leave, loans and settlements ride on the payroll feature (Professional and above)", () => {
    expect(getTierFeatures("starter").payroll).toBe(false);
    expect(getTierFeatures("professional").payroll).toBe(true);
  });
});
