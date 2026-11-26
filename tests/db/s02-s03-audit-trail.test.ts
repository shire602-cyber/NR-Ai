// S02+S03 — audit trail rows are physically written to audit_logs for critical operations.
//
// Source-inspection tests (tests/unit/audit-trail-coverage.test.ts) confirm that recordAudit()
// is called in the right routes, but they cannot prove the rows reach the database. This file
// queries audit_logs directly after each operation to prove they do.
//
// Critical surfaces:
//   1. invoice.create     — POST /api/companies/:id/invoices
//   2. invoice.status_change — PATCH /api/invoices/:id/status (issue)
//   3. journal.create     — POST /api/companies/:id/journal
//   4. journal.post       — POST /api/journal/:id/post
//
// All four must produce a row with the right action, resource_type, resource_id, user_id,
// company_id, and non-null details (JSON with before/after).
import { expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = "2026-02-15";

function base(t: Tenant) {
  return `/api/companies/${t.company.id}`;
}

/** Query audit_logs for all rows matching a given action and resourceId. */
async function auditRows(action: string, resourceId: string) {
  return h.sql<{
    action: string;
    resource_type: string;
    resource_id: string;
    user_id: string | null;
    company_id: string | null;
    details: string | null;
  }>(
    `SELECT action, resource_type, resource_id, user_id, company_id, details
       FROM audit_logs WHERE action = $1 AND resource_id = $2
       ORDER BY created_at DESC`,
    [action, resourceId]
  );
}

it("invoice.create audit row is written to audit_logs", async () => {
  const t = await h.createTenant();
  const r = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Audit Trail Client",
    date: today,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Service", quantity: 1, unitPrice: 500, vatRate: 5 }],
  });
  expect(r.status, r.text).toBe(200);
  const invoiceId: string = r.body.id;

  const rows = await auditRows("invoice.create", invoiceId);
  expect(rows.length, "expected invoice.create audit row").toBeGreaterThanOrEqual(1);
  const row = rows[0];
  expect(row.resource_type).toBe("invoice");
  expect(row.resource_id).toBe(invoiceId);
  expect(row.user_id).toBe(t.user.id);
  expect(row.company_id).toBe(t.company.id);
  // details is JSON with at least an "after" field containing the invoice state
  expect(row.details).toBeTruthy();
  const details = JSON.parse(row.details!);
  expect(details.after).toBeTruthy();
  expect(details.after.status).toBe("draft");
});

it("invoice.status_change audit row is written when invoice is issued", async () => {
  const t = await h.createTenant();
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Audit Issue Client",
    date: today,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 2, unitPrice: 750, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);
  const invoiceId: string = draft.body.id;

  const issued = await t.as.patch(`/api/invoices/${invoiceId}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  const rows = await auditRows("invoice.status_change", invoiceId);
  expect(rows.length, "expected invoice.status_change audit row").toBeGreaterThanOrEqual(1);
  const row = rows[0];
  expect(row.resource_type).toBe("invoice");
  expect(row.user_id).toBe(t.user.id);
  const details = JSON.parse(row.details!);
  expect(details.before?.status).toBe("draft");
  expect(details.after?.status).toBe("sent");
});

it("journal.create_draft audit row is written when a draft entry is created", async () => {
  const t = await h.createTenant();
  const cashAcc = await accountByCode(t, "1010");
  const revenueAcc = await accountByCode(t, "4010");

  const r = await t.as.post(`${base(t)}/journal`, {
    date: today,
    description: "Audit trail journal test",
    lines: [
      { accountId: cashAcc.id, debit: 2000, credit: 0, description: "Dr Cash" },
      { accountId: revenueAcc.id, debit: 0, credit: 2000, description: "Cr Revenue" },
    ],
  });
  expect(r.status, r.text).toBe(200);
  const entryId: string = r.body.id;

  const rows = await auditRows("journal.create_draft", entryId);
  expect(rows.length, "expected journal.create_draft audit row").toBeGreaterThanOrEqual(1);
  const row = rows[0];
  expect(row.resource_type).toBe("journal_entry");
  expect(row.user_id).toBe(t.user.id);
  expect(row.company_id).toBe(t.company.id);
});

it("journal.post audit row is written when a draft entry is posted", async () => {
  const t = await h.createTenant();
  const cashAcc = await accountByCode(t, "1010");
  const revenueAcc = await accountByCode(t, "4010");

  // Create a draft first.
  const draft = await t.as.post(`${base(t)}/journal`, {
    date: today,
    description: "To-be-posted entry",
    lines: [
      { accountId: cashAcc.id, debit: 1500, credit: 0, description: "Dr Cash" },
      { accountId: revenueAcc.id, debit: 0, credit: 1500, description: "Cr Revenue" },
    ],
  });
  expect(draft.status, draft.text).toBe(200);
  const entryId: string = draft.body.id;

  // Post it.
  const posted = await t.as.post(`/api/journal/${entryId}/post`, {});
  expect(posted.status, posted.text).toBe(200);

  const rows = await auditRows("journal.post", entryId);
  expect(rows.length, "expected journal.post audit row").toBeGreaterThanOrEqual(1);
  const row = rows[0];
  expect(row.resource_type).toBe("journal_entry");
  expect(row.user_id).toBe(t.user.id);
  const details = JSON.parse(row.details!);
  expect(details.before?.status).toBe("draft");
  expect(details.after?.status).toBe("posted");
});
