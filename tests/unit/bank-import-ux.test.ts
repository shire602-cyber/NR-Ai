import { readSourceWithMessages } from "../helpers/read-source";
import { describe, expect, it } from "vitest";

const dialog = readSourceWithMessages(process.cwd(), "client/src/components/banking/StatementImportDialog.tsx");
const panel = readSourceWithMessages(process.cwd(), "client/src/components/banking/StatementImportsPanel.tsx");
const page = readSourceWithMessages(process.cwd(), "client/src/pages/BankReconciliation.tsx");

describe("Bank import launch UX", () => {
  it("keeps a sample CSV path for buyers without live bank feeds", () => {
    expect(dialog).toContain("muhasib-sample-bank-statement.csv");
    expect(dialog).toContain("CSV (comma, semicolon or tab separated; Debit/Credit or signed amount)");
    expect(dialog).toContain('data-testid="button-download-sample-bank-csv"');
    expect(panel).toContain("Live bank feeds are not required");
  });

  it("keeps duplicate import feedback visible to users", () => {
    expect(dialog).toContain("already existed and were skipped");
    expect(dialog).toContain("Nothing new: every line in this file was already imported.");
  });

  it("shows the bank feeds tab only when a provider is configured", () => {
    expect(page).toContain("feedsAvailable && <TabsTrigger");
    expect(page).toContain("providers?.providers.length");
  });
});
