/**
 * F02 (staging): POST /api/vat-returns/:id/amend answered 409 DUPLICATE_VALUE on staging while the
 * same flow passes here. The repo declares no UNIQUE index on vat_returns, so the staging database
 * carries an out-of-repo one (an amendment shares company and period with its original).
 * Migration 0160 drops any such unique index/constraint; a failing insert now reports the
 * constraint name as VAT_AMENDMENT_CONFLICT.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const period = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, "../../migrations/0160_vat_returns_drop_unique_drift.sql"),
  "utf8"
);

const uniqueNames = async () =>
  (
    await h.sql<{ indexname: string }>(
      `SELECT i.relname AS indexname FROM pg_index x
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_class i ON i.oid = x.indexrelid
        WHERE t.relname = 'vat_returns' AND x.indisunique AND NOT x.indisprimary
        ORDER BY 1`
    )
  ).map((r) => r.indexname);

async function filedReturn(t: Tenant): Promise<string> {
  const invoice = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date: "2026-02-10",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Job", quantity: 1, unitPrice: 10000, vatRate: 5 }],
  });
  expect(invoice.status, invoice.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${invoice.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, period);
  expect(gen.status, gen.text).toBe(201);
  const filed = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
    ftaReferenceNumber: "TEST-REF-0001",
  });
  expect(filed.status, filed.text).toBe(200);
  return gen.body.id as string;
}

it("F02: 0160 is a no-op on a clean database and can run twice", async () => {
  expect(await uniqueNames()).toEqual([]);
  await h.sql(migrationSql);
  await h.sql(migrationSql);
  expect(await uniqueNames()).toEqual([]);
  const idx = await h.sql(
    `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vat_returns_company_period'`
  );
  expect(idx).toHaveLength(1);
});

it("F02: a rogue unique index blocks amendment with VAT_AMENDMENT_CONFLICT; 0160 repairs it", async () => {
  const t = await h.createTenant({
    companyColumns: {
      trn_vat_number: "100000000000003",
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const originalId = await filedReturn(t);

  // The staging drift: a unique index the repo never declared (replaces the plain one).
  await h.sql(`DROP INDEX IF EXISTS idx_vat_returns_company_period`);
  await h.sql(
    `CREATE UNIQUE INDEX rogue_vat_returns_company_period ON vat_returns (company_id, period_start)`
  );

  const blocked = await t.as.post(`/api/vat-returns/${originalId}/amend`, { reason: "Correction" });
  expect(blocked.status, blocked.text).toBe(409);
  expect(blocked.body.code).toBe("VAT_AMENDMENT_CONFLICT");
  expect(blocked.body.details?.constraint).toBe("rogue_vat_returns_company_period");

  await h.sql(migrationSql);
  expect(await uniqueNames()).toEqual([]);

  const amend = await t.as.post(`/api/vat-returns/${originalId}/amend`, { reason: "Correction" });
  expect(amend.status, amend.text).toBe(201);
  const amendmentId = (amend.body.vatReturn?.id ?? amend.body.id) as string;
  expect(amendmentId).not.toBe(originalId);

  const rows = (await t.as.get(`${base(t)}/vat-returns`)).body as Array<{
    id: string;
    status: string;
    amendsReturnId: string | null;
  }>;
  expect(rows.find((r) => r.id === amendmentId)).toMatchObject({
    status: "draft",
    amendsReturnId: originalId,
  });
  expect(rows.find((r) => r.id === originalId)?.status).toBe("amended");
});
