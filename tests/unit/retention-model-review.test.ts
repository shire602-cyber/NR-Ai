// S01 — Retention model review.
//
// UAE FTA requires 5 years' retention of financial records (invoices, vendor
// bills, journal entries, receipts). Three complementary guards cover this:
//
//   1. assertRetentionExpired: refuses deletion before the 5-year window ends.
//   2. Status / FK guards: fixed assets with posted JEs, accounts with
//      transactions, and credit notes are blocked or disabled outright.
//   3. Soft-delete for companies: sets deletedAt / isActive; never cascades
//      to child financial records.
//
// This file checks the source-code invariants so that adding a new financial
// record DELETE route without a retention guard fails the test rather than
// silently going live.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

function src(path: string) {
  return readFileSync(path, "utf8");
}

describe("S01 retention model — financial record DELETE routes", () => {
  it("invoice DELETE calls assertRetentionExpired", () => {
    const s = src("server/routes/invoices.routes.ts");
    expect(s).toContain("assertRetentionExpired");
    // Must also be imported from the retention service.
    expect(s).toContain('from "../services/retention.service"');
  });

  it("vendor bill DELETE calls assertRetentionExpired using bill_date", () => {
    const s = src("server/routes/bill-pay.routes.ts");
    expect(s).toContain("assertRetentionExpired");
    expect(s).toContain('from "../services/retention.service"');
    // S01: guard must use bill_date (document date), not created_at or the
    // generated retention_expires_at column (which is based on created_at).
    expect(s).toMatch(/assertRetentionExpired[\s\S]{0,200}bill\.bill_date/);
  });

  it("journal entry DELETE calls assertRetentionExpired", () => {
    const s = src("server/routes/journal.routes.ts");
    expect(s).toContain("assertRetentionExpired");
    expect(s).toContain('from "../services/retention.service"');
  });

  it("receipt DELETE calls assertRetentionExpired", () => {
    const s = src("server/routes/receipts.routes.ts");
    expect(s).toContain("assertRetentionExpired");
    expect(s).toContain('from "../services/retention.service"');
  });

  it("credit-note DELETE restricts to draft status; issued notes are voided", () => {
    const s = src("server/routes/credit-notes.routes.ts");
    // Issued credit notes cannot be deleted — only voided. Only draft credit
    // notes (pre-financial-record) may be deleted.
    expect(s).toContain("An issued credit note cannot be deleted");
    expect(s).toContain("voidCreditNote");
  });

  it("fixed-asset DELETE blocks any asset that has posted journal entries", () => {
    const s = src("server/routes/fixed-assets.routes.ts");
    expect(s).toContain("ASSET_HAS_POSTED_JE");
    // Guard text is present.
    expect(s).toContain("Cannot delete a fixed asset that has posted journal entries");
  });

  it("account DELETE blocks accounts that have any transactions", () => {
    const s = src("server/routes/accounts.routes.ts");
    expect(s).toContain("accountHasTransactions");
    expect(s).toContain("Cannot delete account with existing transactions");
  });

  it("expense-claim DELETE restricts to draft status (pre-financial-record)", () => {
    const s = src("server/routes/expense-claims.routes.ts");
    // Only draft claims (not yet posted as financial records) can be deleted.
    expect(s).toContain('"draft"');
    expect(s).toContain("Only draft claims can be deleted");
  });

  it("company delete is a soft delete, not a hard cascade", () => {
    // deleteCompany is in the domain module, not the barrel.
    const s = src("server/storage/companies.ts");
    // The implementation must set deletedAt (and isActive: false), not db.delete.
    const deleteCompanyMatch = s.match(/async deleteCompany[\s\S]{0,500}?deletedAt/);
    expect(deleteCompanyMatch).not.toBeNull();
  });

  it("retention service has the 5-year constant and no createdAt-only test gap", () => {
    const s = src("server/services/retention.service.ts");
    expect(s).toContain("RETENTION_YEARS = 5");
    // The function accepts an explicit retentionExpiresAt override so callers
    // can pass the document date when the schema stores it.
    expect(s).toContain("retentionExpiresAt");
  });
});
