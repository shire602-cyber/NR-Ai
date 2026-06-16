import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "client/src/pages/BankReconciliation.tsx"), "utf8");

describe("Bank import launch UX", () => {
  it("keeps a sample CSV path for buyers without live bank feeds", () => {
    expect(source).toContain("muhasib-sample-bank-statement.csv");
    expect(source).toContain("Live bank feeds are not required");
    expect(source).toContain("Arabic/English generic");
    expect(source).toContain("Amount + Dr/Cr type columns are supported");
    expect(source).toContain('data-testid="button-download-sample-bank-csv"');
  });

  it("keeps duplicate import feedback visible to users", () => {
    expect(source).toContain("skippedDuplicates");
    expect(source).toContain("Matching suggestions are being prepared");
  });
});
