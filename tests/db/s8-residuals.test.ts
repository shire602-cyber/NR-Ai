/**
 * S8 final sweep, against the real app + Postgres:
 *   - S1 follow-up: a VAT group with a non-AED member reconciles in AED (member VAT GL converted
 *     with fx.toVatFilingCurrency, same basis as its boxes); a missing rate is 422 NO_EXCHANGE_RATE.
 *   - S5 follow-up (W5-A): deleting a report-delivery artifact row (directly or by cascade) deletes
 *     its object-storage copy through a retried queue, never blocking the delete.
 */
import { afterEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
const Q3 = { from: "2026-07-01", to: "2026-09-30" };

afterEach(async () => {
  const { __setObjectStoreForTests } = await import("../../server/services/fileStorage");
  __setObjectStoreForTests(null);
});

async function vatTenant(columns: Record<string, unknown> = {}) {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      ...columns,
    },
  });
}

async function issued(t: Tenant, unitPrice: number) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Outside Co",
    date: "2026-08-10",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Work", quantity: 1, unitPrice, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
}

async function groupWithMember(memberColumns: Record<string, unknown>) {
  const rep = await vatTenant();
  const member = await vatTenant({ trn_vat_number: "100000000000011", ...memberColumns });
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    member.company.id,
    rep.user.id,
  ]);
  const g = await rep.as.put(`/api/companies/${rep.company.id}/vat/group`, {
    name: "Mixed Currency Group",
    groupTrn: "100000000000029",
    memberCompanyIds: [member.company.id],
  });
  expect(g.status, g.text).toBe(200);
  return { rep, member };
}

describe("S8 VAT group reconciliation with a non-AED member", () => {
  it("[S8-1] converts the USD member's VAT GL to AED before the group VAT-to-GL reconciliation", async () => {
    const { rep, member } = await groupWithMember({ base_currency: "USD" });
    const r = await member.as.post(`/api/companies/${member.company.id}/exchange-rates`, {
      fromCurrency: "USD",
      toCurrency: "AED",
      rate: 3.6725,
      effectiveDate: "2026-07-01",
    });
    expect(r.status, r.text).toBeLessThan(300);
    await issued(rep, 1000); // AED 50.00 VAT
    await issued(member, 1000); // USD 50.00 VAT = AED 183.63
    await issued(member, 333.33); // USD 16.67 VAT = AED 61.22

    const c = await rep.as.get(
      `/api/companies/${rep.company.id}/vat/compute?from=${Q3.from}&to=${Q3.to}`
    );
    expect(c.status, c.text).toBe(200);
    expect(c.body.issues).toEqual([]);
    expect(c.body.boxes.box1bDubaiVat).toBe(50 + 183.63 + 61.22);
    // Like with like: boxes and ledger are both AED, so nothing is unexplained.
    expect(c.body.reconciliation.hasUnexplainedDifference).toBe(false);
    const invoiceRow = c.body.reconciliation.byCategory.find(
      (row: { category: string }) => row.category === "sales"
    );
    expect(invoiceRow?.ledgerOutputFils).toBe(5000 + 18363 + 6122);

    // The return itself can be generated (the reconciliation gate passes).
    const gen = await rep.as.post(`/api/companies/${rep.company.id}/vat-returns/generate`, {
      periodStart: Q3.from,
      periodEnd: Q3.to,
    });
    expect(gen.status, gen.text).toBe(201);
    expect(gen.body.box1bDubaiVat).toBe(294.85);
  });

  it("[S8-1] a non-AED member without a rate blocks the group return with 422 NO_EXCHANGE_RATE", async () => {
    const { rep, member } = await groupWithMember({ base_currency: "EUR" });
    await issued(member, 1000);
    const gen = await rep.as.post(`/api/companies/${rep.company.id}/vat-returns/generate`, {
      periodStart: Q3.from,
      periodEnd: Q3.to,
    });
    expect(gen.status, gen.text).toBe(422);
    expect(gen.body.code).toBe("NO_EXCHANGE_RATE");

    const { computeVat201 } = await import("../../server/tax/vat-engine");
    const preview = await computeVat201({
      companyId: rep.company.id,
      from: Q3.from,
      to: Q3.to,
      allowIncomplete: true,
    });
    expect(preview.issues.map((i) => i.code)).toContain("NO_EXCHANGE_RATE");
    expect(
      preview.issues.some(
        (i) => i.documentType === "vat_group_member" && i.documentId === member.company.id
      )
    ).toBe(true);
  });
});

describe("S8 report artifacts are deleted from object storage with their rows", () => {
  async function queuedRun(bucket: Map<string, Buffer>) {
    const { __setObjectStoreForTests } = await import("../../server/services/fileStorage");
    let failDeletes = false;
    const deleted: string[] = [];
    __setObjectStoreForTests({
      put: async (key, buffer) => {
        bucket.set(key, buffer);
        return key;
      },
      get: async (key) => (bucket.has(key) ? { buffer: bucket.get(key)! } : null),
      del: async (key) => {
        if (failDeletes) throw new Error("bucket unavailable");
        bucket.delete(key);
        deleted.push(key);
      },
    });
    const t = await h.createTenant();
    const r = await t.as.post(
      `/api/companies/${t.company.id}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`,
      {}
    );
    expect(r.status, r.text).toBe(201);
    const keys = (
      await h.sql<{ storage_key: string }>(
        `SELECT storage_key FROM company_report_delivery_artifacts WHERE run_id = $1`,
        [r.body.run.id]
      )
    ).map((x) => x.storage_key);
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(bucket.has(k)).toBe(true);
    return {
      t,
      runId: r.body.run.id as string,
      keys,
      deleted,
      setFail: (v: boolean) => (failDeletes = v),
    };
  }

  it("[S8-3] a run deleted by cascade queues its objects; the sweep deletes them", async () => {
    const bucket = new Map<string, Buffer>();
    const run = await queuedRun(bucket);
    // The database delete does not touch (or wait for) the object store.
    await h.sql(`DELETE FROM company_report_delivery_runs WHERE id = $1`, [run.runId]);
    for (const k of run.keys) expect(bucket.has(k)).toBe(true);
    const queued = await h.sql<{ storage_key: string; status: string }>(
      `SELECT storage_key, status FROM object_storage_deletions WHERE storage_key = ANY($1::text[])`,
      [run.keys]
    );
    expect(queued.map((q) => q.storage_key).sort()).toEqual([...run.keys].sort());

    const { processObjectDeletionQueue } =
      await import("../../server/services/object-deletion-queue");
    const res = await processObjectDeletionQueue();
    expect(res.deleted).toBeGreaterThanOrEqual(2);
    for (const k of run.keys) expect(bucket.has(k)).toBe(false);
    const left = await h.sql(
      `SELECT 1 FROM object_storage_deletions WHERE storage_key = ANY($1::text[])`,
      [run.keys]
    );
    expect(left).toHaveLength(0);
  });

  it("[S8-3] a failing bucket never blocks the delete; the failure is retried with backoff", async () => {
    const bucket = new Map<string, Buffer>();
    const run = await queuedRun(bucket);
    run.setFail(true);
    await h.sql(`DELETE FROM company_report_delivery_artifacts WHERE run_id = $1`, [run.runId]);
    const rows = await h.sql(`SELECT 1 FROM company_report_delivery_artifacts WHERE run_id = $1`, [
      run.runId,
    ]);
    expect(rows).toHaveLength(0);

    const { processObjectDeletionQueue } =
      await import("../../server/services/object-deletion-queue");
    const first = await processObjectDeletionQueue();
    expect(first.failed).toBe(2);
    const pending = await h.sql<{ attempts: number; last_error: string; status: string }>(
      `SELECT attempts, last_error, status FROM object_storage_deletions
        WHERE storage_key = ANY($1::text[])`,
      [run.keys]
    );
    expect(pending).toHaveLength(2);
    expect(pending.every((p) => p.attempts === 1 && p.status === "pending")).toBe(true);
    expect(pending[0].last_error).toContain("bucket unavailable");
    // Not due yet: a second tick inside the backoff window does nothing.
    expect((await processObjectDeletionQueue()).failed).toBe(0);

    // Once due again and the bucket recovers, the retry deletes the objects.
    run.setFail(false);
    await h.sql(
      `UPDATE object_storage_deletions SET next_attempt_at = now() - interval '1 minute'
        WHERE storage_key = ANY($1::text[])`,
      [run.keys]
    );
    const retry = await processObjectDeletionQueue();
    expect(retry.deleted).toBe(2);
    for (const k of run.keys) expect(bucket.has(k)).toBe(false);
  });

  it("[S8-3] a key still referenced by a live row (restore re-insert) is kept", async () => {
    const bucket = new Map<string, Buffer>();
    const run = await queuedRun(bucket);
    await h.sql(`INSERT INTO object_storage_deletions (storage_key, source) VALUES ($1, 'test')`, [
      run.keys[0],
    ]);
    const { processObjectDeletionQueue } =
      await import("../../server/services/object-deletion-queue");
    const res = await processObjectDeletionQueue();
    expect(res.stillReferenced).toBe(1);
    expect(bucket.has(run.keys[0])).toBe(true);
  });

  it("[S8-3] the sweep is registered as a scheduled job", async () => {
    const { registerObjectDeletionJob } =
      await import("../../server/services/object-deletion-queue");
    const { listJobs } = await import("../../server/platform/job-registry");
    registerObjectDeletionJob();
    registerObjectDeletionJob();
    expect(listJobs().filter((j) => j.name === "storage.objectDeletionSweep")).toHaveLength(1);
  });
});
