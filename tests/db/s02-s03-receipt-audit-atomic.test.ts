/**
 * S02/S03: a receipt change and its audit row are one transaction (revise, update, split, delete).
 * A failing audit write must roll the receipt change back; a failing receipt write must leave no
 * audit row. Failures are injected with Postgres triggers so the real routes and storage run.
 */
import { afterEach, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function createReceipt(t: Tenant, over: Record<string, unknown> = {}) {
  const r = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
    merchant: "Stationery LLC",
    date: "2026-01-15",
    amount: 100,
    vatAmount: 5,
    currency: "AED",
    category: "Office",
    ...over,
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body.id as string;
}

async function postReceipt(t: Tenant, id: string) {
  const r = await t.as.post(`/api/receipts/${id}/post`, {
    accountId: (await accountByCode(t, "5000")).id,
    paymentAccountId: (await accountByCode(t, "1020")).id,
  });
  expect(r.status, r.text).toBe(200);
}

async function auditCount(action: string, id: string) {
  const rows = await h.sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND resource_id = $2",
    [action, id]
  );
  return rows[0].n;
}

async function receiptRow(id: string) {
  const rows = await h.sql<{ amount: string; merchant: string }>(
    "SELECT amount::text AS amount, merchant FROM receipts WHERE id = $1",
    [id]
  );
  return rows[0];
}

async function entryCount(t: Tenant) {
  const rows = await h.sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1",
    [t.company.id]
  );
  return rows[0].n;
}

/** Make inserts of this audit action fail. */
async function failAuditWrites(action: string) {
  await h.sql(`CREATE OR REPLACE FUNCTION s02_fail_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = '${action}' THEN RAISE EXCEPTION 'injected audit failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await h.sql(
    "CREATE TRIGGER s02_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION s02_fail_audit()"
  );
}

/** Make receipt updates that set this amount fail. */
async function failReceiptWrites(amount: number) {
  await h.sql(`CREATE OR REPLACE FUNCTION s02_fail_receipt() RETURNS trigger AS $$
    BEGIN
      IF NEW.amount = ${amount} THEN RAISE EXCEPTION 'injected receipt failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await h.sql(
    "CREATE TRIGGER s02_fail_receipt BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION s02_fail_receipt()"
  );
}

afterEach(async () => {
  await h.sql("DROP TRIGGER IF EXISTS s02_fail_audit ON audit_logs");
  await h.sql("DROP TRIGGER IF EXISTS s02_fail_receipt ON receipts");
});

describe("S02/S03 receipt audit is atomic with the change", () => {
  it("revise: happy path writes the revision and its audit row", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    await postReceipt(t, id);
    const r = await t.as.post(`/api/receipts/${id}/revise`, { amount: 200, vatAmount: 10 });
    expect(r.status, r.text).toBe(200);
    expect(Number((await receiptRow(id)).amount)).toBe(200);
    expect(await auditCount("receipt.revise", id)).toBe(1);
  });

  it("revise: a failing audit write rolls the whole revision back", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    await postReceipt(t, id);
    const entries = await entryCount(t);
    await failAuditWrites("receipt.revise");
    const r = await t.as.post(`/api/receipts/${id}/revise`, { amount: 200, vatAmount: 10 });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(Number((await receiptRow(id)).amount)).toBe(100);
    expect(await entryCount(t)).toBe(entries);
    expect(await auditCount("receipt.revise", id)).toBe(0);
  });

  it("revise: a failing receipt write leaves no audit row", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    await postReceipt(t, id);
    const entries = await entryCount(t);
    await failReceiptWrites(777);
    const r = await t.as.post(`/api/receipts/${id}/revise`, { amount: 777, vatAmount: 10 });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(Number((await receiptRow(id)).amount)).toBe(100);
    expect(await entryCount(t)).toBe(entries);
    expect(await auditCount("receipt.revise", id)).toBe(0);
  });

  it("update: happy path, then a failing audit write rolls the update back", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    const ok = await t.as.put(`/api/receipts/${id}`, { merchant: "Renamed LLC" });
    expect(ok.status, ok.text).toBe(200);
    expect(await auditCount("receipt.update", id)).toBe(1);

    await failAuditWrites("receipt.update");
    const bad = await t.as.put(`/api/receipts/${id}`, { merchant: "Should Not Stick" });
    expect(bad.status).toBeGreaterThanOrEqual(500);
    expect((await receiptRow(id)).merchant).toBe("Renamed LLC");
    expect(await auditCount("receipt.update", id)).toBe(1);
  });

  it("update: a failing receipt write leaves no audit row", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    await failReceiptWrites(555);
    const r = await t.as.put(`/api/receipts/${id}`, { amount: 555 });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(Number((await receiptRow(id)).amount)).toBe(100);
    expect(await auditCount("receipt.update", id)).toBe(0);
  });

  it("delete: a failing audit write keeps the receipt; happy path removes it with an audit row", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    // Past the FTA retention window so deletion is allowed.
    await h.sql("UPDATE receipts SET created_at = now() - interval '7 years' WHERE id = $1", [id]);
    await failAuditWrites("receipt.delete");
    const bad = await t.as.delete(`/api/receipts/${id}`);
    expect(bad.status).toBeGreaterThanOrEqual(500);
    expect(await receiptRow(id)).toBeTruthy();
    expect(await auditCount("receipt.delete", id)).toBe(0);

    await h.sql("DROP TRIGGER IF EXISTS s02_fail_audit ON audit_logs");
    const ok = await t.as.delete(`/api/receipts/${id}`);
    expect(ok.status, ok.text).toBe(200);
    expect(await receiptRow(id)).toBeUndefined();
    expect(await auditCount("receipt.delete", id)).toBe(1);
  });

  it("split: a failing audit write keeps the source receipt and creates no parts", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t, { amount: 100, vatAmount: 0 });
    const parts = [{ amount: 60 }, { amount: 40 }];
    await failAuditWrites("receipt.split");
    const bad = await t.as.post(`/api/receipts/${id}/split`, { parts });
    expect(bad.status).toBeGreaterThanOrEqual(500);
    expect(await receiptRow(id)).toBeTruthy();
    const n = await h.sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM receipts WHERE company_id = $1",
      [t.company.id]
    );
    expect(n[0].n).toBe(1);
    expect(await auditCount("receipt.split", id)).toBe(0);

    await h.sql("DROP TRIGGER IF EXISTS s02_fail_audit ON audit_logs");
    const ok = await t.as.post(`/api/receipts/${id}/split`, { parts });
    expect(ok.status, ok.text).toBe(201);
    expect(await auditCount("receipt.split", id)).toBe(1);
  });
});
