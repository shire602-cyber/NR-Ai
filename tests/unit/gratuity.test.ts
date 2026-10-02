import { describe, it, expect } from "vitest";
import { calculateGratuityForEmployee } from "../../server/services/gratuity";

const at = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const run = (join: string, end: string, basic: number, wage = basic) =>
  calculateGratuityForEmployee({ joinDate: at(join), endDate: at(end), basicSalary: basic, totalWage: wage, isGccNational: false });

describe("gratuity counts the last day and 30-day months (teardown figures at 30 Sep 2026)", () => {
  it("Maria: 1 Apr 2023, basic 5,000 = 3.5 years = 12,250.00", () => {
    const r = run("2023-04-01", "2026-09-30", 5000, 7500);
    expect(r.totalGratuity).toBe(12250);
    expect(r.yearsOfService).toBeCloseTo(3.5, 10);
  });
  it("Ravi: 1 Apr 2019, basic 8,000 = 7.5 years (21 days x 5 + 30 days x 2.5) = 48,000.00", () => {
    expect(run("2019-04-01", "2026-09-30", 8000, 12000).totalGratuity).toBe(48000);
  });
  it("Sara: 1 Jun 2021, basic 7,000 = 5 years 4 months = 26,833.33", () => {
    expect(run("2021-06-01", "2026-09-30", 7000, 10000).totalGratuity).toBe(26833.33);
  });
  it("Fatima: 1 Jan 2025, basic 4,000 = 1.75 years = 4,900.00", () => {
    expect(run("2025-01-01", "2026-09-30", 4000, 6000).totalGratuity).toBe(4900);
  });
  it("under one year is not eligible; a GCC national gets none", () => {
    expect(run("2026-03-01", "2026-09-30", 6000).eligible).toBe(false);
    expect(calculateGratuityForEmployee({ joinDate: at("2020-01-01"), endDate: at("2026-09-30"), basicSalary: 6000, totalWage: 6000, isGccNational: true }).totalGratuity).toBe(0);
  });
  it("days after the last full month count at 1/30 of a month", () => {
    // 1 Jan 2025 to 15 Feb 2026 inclusive: 1 year + 1 month + 15 days = 1 + 1.5/12 years
    const r = run("2025-01-01", "2026-02-15", 3600);
    expect(r.yearsOfService).toBeCloseTo(1 + 1.5 / 12, 6);
  });
});
