// S01 — FTA 5-year retention guard blocks DELETE of issued financial records.
//
// Source-inspection tests (tests/unit/retention-model-review.test.ts) confirm
// assertRetentionExpired is called in the right routes, but they cannot prove
// the guard fires on a live HTTP request. This file does the live check.
//
// Three cases:
//   1. DELETE /api/invoices/:id on an issued invoice → 409 RETENTION_NOT_EXPIRED
//   2. DELETE /api/journal/:id on a recent draft journal entry → 409 RETENTION_NOT_EXPIRED
//   3. DELETE /api/invoices/:id on a never-issued draft → 200 and the draft is removed
import { expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = "2026-02-10";

function base(t: Tenant) {
  return `/api/companies/${t.company.id}`;
}

async function createIssuedInvoice(t: Tenant): Promise<string> {
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Retention Test Customer",
    date: today,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Service", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  return draft.body.id;
}

it("DELETE issued invoice returns 409 RETENTION_NOT_EXPIRED", async () => {
  const t = await h.createTenant();
  const invoiceId = await createIssuedInvoice(t);

  const r = await t.as.delete(`/api/invoices/${invoiceId}`);
  expect(r.status).toBe(409);
  expect(r.body.code).toBe("RETENTION_NOT_EXPIRED");
  expect(r.body.message).toMatch(/5-year retention/i);

  // The invoice record must still exist — it was not deleted.
  const get = await t.as.get(`/api/invoices/${invoiceId}`);
  expect(get.status).toBe(200);
  expect(get.body.id).toBe(invoiceId);
});

it("DELETE draft journal entry returns 409 RETENTION_NOT_EXPIRED (recent draft protected)", async () => {
  const t = await h.createTenant();

  // accountByCode resolves from the harness-seeded chart of accounts.
  const cashAcc = await accountByCode(t, "1010");
  const revenueAcc = await accountByCode(t, "4010");

  const entry = await t.as.post(`${base(t)}/journal`, {
    date: today,
    description: "Retention test entry",
    lines: [
      { accountId: cashAcc.id, debit: 1000, credit: 0, description: "Dr Cash" },
      { accountId: revenueAcc.id, debit: 0, credit: 1000, description: "Cr Revenue" },
    ],
  });
  expect(entry.status, entry.text).toBe(200);
  const entryId = entry.body.id as string;

  const r = await t.as.delete(`/api/journal/${entryId}`);
  expect(r.status).toBe(409);
  expect(r.body.code).toBe("RETENTION_NOT_EXPIRED");

  // The entry must still exist.
  const get = await t.as.get(`/api/journal/${entryId}`);
  expect(get.status).toBe(200);
});

it("DELETE draft invoice (never issued) succeeds — no retention block on drafts", async () => {
  // Drafts are pre-financial-record: the invoice route skips the retention
  // guard for status === 'draft'. Only after issuance does retention apply.
  const t = await h.createTenant();
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Draft Customer",
    date: today,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Service", quantity: 1, unitPrice: 500, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);

  const invoiceId: string = draft.body.id;
  const r = await t.as.delete(`/api/invoices/${invoiceId}`);
  expect(r.status, r.text).toBe(200);
  expect(["deleted", "cancelled"]).toContain(r.body.outcome);

  const rows = await h.sql<{ status: string }>("SELECT status FROM invoices WHERE id = $1", [
    invoiceId,
  ]);
  expect(rows).toEqual(r.body.outcome === "deleted" ? [] : [{ status: "cancelled" }]);
});
