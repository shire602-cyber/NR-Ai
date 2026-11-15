import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "client/src/pages/BankReconciliation.tsx"), "utf8");

describe("Bank import launch UX", () => {
  it("keeps a sample CSV path for buyers without live bank feeds", () => {
    expect(source).toContain("muhasib-sample-bank-statement.csv");
    expect(source).toContain("Live bank feeds are not required");
    expect(source).toContain("Arabic/English generic");
    expect(source).toContain("Comma, semicolon, and tab-delimited Excel exports are supported");
    expect(source).toContain("Amount + Dr/Cr type columns are supported");
    expect(source).toContain('data-testid="button-download-sample-bank-csv"');
  });

  it("keeps duplicate import feedback visible to users", () => {
    expect(source).toContain("skippedDuplicates");
    expect(source).toContain("Matching suggestions are being prepared");
  });
});

describe("Bank import column mapper (R06-23)", () => {
  it("R06-23 previews the statement and exposes a column mapper with en + ar strings", () => {
    expect(source).toContain("/bank-statements/preview");
    expect(source).toContain('data-testid="panel-statement-mapper"');
    expect(source).toContain("select-map-");
    expect(source).toContain('data-testid="select-statement-date-order"');
    expect(source).toContain('data-testid="checkbox-acknowledge-ambiguity"');
    expect(source).toContain("ربط الأعمدة");
    expect(source).toContain("Column mapping");
    expect(source).toContain(".xlsx");
  });

  it("R06-11 ambiguity must be confirmed before importing", () => {
    expect(source).toContain("acknowledgeAmbiguity");
    expect(source).toContain("statementPreview.requiresChoice");
  });
});
