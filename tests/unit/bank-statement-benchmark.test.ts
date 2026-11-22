import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BANK_STATEMENT_PROBE,
  bankStatementEvidence,
  bankStatementReportRow,
  verifiedStatementMatchCount,
} from "../e2e/lib/bank-statement-evidence.mjs";

const route = { href: "/bank-reconciliation", ok: true };

describe("benchmark evidence for CSV statement reconciliation", () => {
  it("distinguishes a page visit from a functional run", () => {
    const evidence = bankStatementEvidence([route], [{ name: "Unrelated probe", passed: true }]);
    expect(evidence).toEqual({ reconciliationPageVisit: "pass", uploadAndReconcile: "not-run" });
    expect(bankStatementReportRow(evidence)).toEqual([
      "Bank statements and rules",
      "Visit only",
      "The crawl opened Bank reconciliation. CSV upload and reconciliation require a functional run.",
    ]);
  });

  it("requires the explicit upload and reconciliation probe to pass", () => {
    const failed = bankStatementEvidence([route], [{ name: BANK_STATEMENT_PROBE, passed: false }]);
    expect(bankStatementReportRow(failed)[1]).toBe("Fail");
    const passed = bankStatementEvidence([], [{ name: BANK_STATEMENT_PROBE, passed: true }]);
    expect(passed).toEqual({ reconciliationPageVisit: "not-run", uploadAndReconcile: "pass" });
    expect(bankStatementReportRow(passed)[1]).toBe("Pass");
  });

  it("verifies the seeded references against the exact invoice and receipt IDs", () => {
    const targets = [
      { reference: "BANK-001", type: "invoice", targetId: "invoice-1" },
      { reference: "BANK-002", type: "receipt", targetId: "receipt-1" },
    ];
    const wrong = [
      { reference: "BANK-004", isReconciled: true, matchedInvoiceId: "invoice-1" },
      { reference: "BANK-001", isReconciled: true, matchedInvoiceId: "invoice-2" },
      { reference: "BANK-002", isReconciled: false, matchedReceiptId: "receipt-1" },
    ];
    expect(verifiedStatementMatchCount(wrong, targets)).toBe(0);
    expect(
      verifiedStatementMatchCount(
        [
          ...wrong,
          { reference: "BANK-001", isReconciled: true, matchedInvoiceId: "invoice-1" },
          { reference: "BANK-002", isReconciled: true, matchedReceiptId: "receipt-1" },
        ],
        targets
      )
    ).toBe(2);
  });

  it("records the historical read-only run as a page visit", () => {
    const dir = "docs/qa/2026-06-21-benchmark-audit";
    const run = JSON.parse(readFileSync(`${dir}/benchmark-run.json`, "utf8"));
    expect(run.bankStatementEvidence).toEqual(
      bankStatementEvidence(run.routeChecks, run.fixtureProbes)
    );
    expect(run.bankStatementEvidence.uploadAndReconcile).toBe("not-run");
    const row = bankStatementReportRow(run.bankStatementEvidence);
    expect(readFileSync(`${dir}/03-cfo-audit-report.md`, "utf8")).toContain(
      `| ${row.join(" | ")} |`
    );
  });
});
