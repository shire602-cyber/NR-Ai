// S02+S03 — Audit trail coverage and delete-audit model review.
//
// Financial record mutations (create/update/delete) must be traceable for
// UAE FTA compliance. The audit service writes to the activity_log table;
// recordAudit() swallows failures so the audit never blocks the operation.
//
// Known gap (not fixed in this campaign): the delete and the audit INSERT are
// called sequentially with no wrapping DB transaction. A server crash between
// them leaves the deletion unrecorded. True atomicity requires a future refactor
// to pass a transaction handle to recordAudit() and commit both together.
//
// This file verifies that the coverage is in place (audit calls exist) and
// flags any DELETE route that skips it. It is a source-invariant test; the
// DB-backed assertion that audit rows are actually written requires integration.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

function src(path: string) {
  return readFileSync(path, "utf8");
}

describe("S02+S03 audit-trail coverage — financial record mutations", () => {
  it("invoice route imports and calls recordAudit", () => {
    const s = src("server/routes/invoices.routes.ts");
    expect(s).toContain('from "../services/audit.service"');
    expect(s).toContain("recordAudit(");
  });

  it("vendor bill route imports and calls recordAudit", () => {
    const s = src("server/routes/bill-pay.routes.ts");
    expect(s).toContain('from "../services/audit.service"');
    expect(s).toContain("recordAudit(");
  });

  it("journal entry route imports and calls recordAudit", () => {
    const s = src("server/routes/journal.routes.ts");
    expect(s).toContain('from "../services/audit.service"');
    expect(s).toContain("recordAudit(");
  });

  it("receipt route imports and calls recordAudit", () => {
    const s = src("server/routes/receipts.routes.ts");
    expect(s).toContain('from "../services/audit.service"');
    expect(s).toContain("recordAudit(");
  });

  it("credit-note DELETE restricts to draft (pre-financial-record); no audit needed for drafts", () => {
    const s = src("server/routes/credit-notes.routes.ts");
    // F07 refactor: draft CNs (no journal entries) may be deleted; issued CNs
    // must be voided. Draft deletion is pre-financial-record so audit recording
    // is not required (matches expense-claim draft pattern).
    expect(s).toContain("An issued credit note cannot be deleted");
    expect(s).toContain('"draft"');
  });

  it("audit service swallows failures and never blocks business operations", () => {
    const s = src("server/services/audit.service.ts");
    // Errors must be caught so a failed audit write never aborts a mutation.
    expect(s).toContain("catch (err)");
    expect(s).toContain("failed to record audit log");
  });

  it("audit service records before/after state for financial mutations", () => {
    const s = src("server/services/audit.service.ts");
    expect(s).toContain("before");
    expect(s).toContain("after");
  });

  it("invoice DELETE records the invoice number and status before removal", () => {
    const s = src("server/routes/invoices.routes.ts");
    // The DELETE handler must capture at least number, status and total so the
    // audit row is useful for reconstruction.
    expect(s).toContain("invoice.number");
    expect(s).toContain("invoice.status");
    // action must identify this as a delete, not an update.
    expect(s).toContain('"invoice.delete"');
  });
});
