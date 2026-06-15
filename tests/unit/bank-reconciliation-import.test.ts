import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractedTransactionsToBankCsv, rowsToCsv } from "@/lib/bankImport";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("Bank reconciliation import polish", () => {
  it("converts PDF-extracted signed amounts into the managed bank CSV format", () => {
    const csv = extractedTransactionsToBankCsv([
      {
        date: "2026-01-03",
        description: 'Customer payment "INV-1001"',
        amount: 5250,
        reference: "FT260103001",
        balance: 25250,
      },
      {
        date: "2026-01-05",
        description: "Office supplies",
        amount: "-315",
        reference: null,
        balance: "24935.00",
      },
      {
        date: "2026-01-06",
        description: "Invalid amount",
        amount: "not-a-number",
      },
    ]);

    expect(csv).toBe(
      [
        '"Date","Description","Reference","Debit","Credit","Balance"',
        '"2026-01-03","Customer payment ""INV-1001""","FT260103001","","5250.00","25250"',
        '"2026-01-05","Office supplies","","315.00","","24935.00"',
      ].join("\n")
    );
  });

  it("creates the manual import template with the same CSV escaping rules", () => {
    const csv = rowsToCsv([
      ["Date", "Description", "Reference", "Debit", "Credit", "Balance"],
      ["2026-01-03", "Customer payment - INV-1001", "FT260103001", "", "5250.00", "25250.00"],
    ]);

    expect(csv).toBe(
      [
        '"Date","Description","Reference","Debit","Credit","Balance"',
        '"2026-01-03","Customer payment - INV-1001","FT260103001","","5250.00","25250.00"',
      ].join("\n")
    );
  });

  it("routes PDF-extracted transactions through the managed bank statement import path", () => {
    const source = readRepoFile("client/src/pages/BankReconciliation.tsx");

    expect(source).toContain("extractedTransactionsToBankCsv");
    expect(source).toContain(
      "await importMutation.mutateAsync({ bankAccountId: selectedBankAccount, csvContent })"
    );
    expect(source).toContain("/bank-statements/import");
    expect(source).not.toContain("/bank-transactions/import");
  });

  it("keeps the manual import experience buyer-ready without live bank feeds", () => {
    const source = readRepoFile("client/src/pages/BankReconciliation.tsx");

    expect(source).toContain("downloadBankCsvTemplate");
    expect(source).toContain("CSV template");
    expect(source).toContain("Duplicate statement lines are skipped where possible");
    expect(source).toContain("PDF — text extraction with OCR fallback");
  });
});
