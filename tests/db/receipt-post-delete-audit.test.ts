/**
 * Receipt follow-ups: delete cannot remove a posted receipt (even on a stale read), a delete that
 * removes nothing writes no audit row, /post writes its audit row in the same transaction, and
 * /review-decision uses the strict shared validator and fails when its (only) audit write fails.
 */
import { afterEach, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function createReceipt(t: Tenant) {
  const r = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
    merchant: "Stationery LLC",
    date: "2026-01-15",
    amount: 100,
    vatAmount: 5,
    currency: "AED",
    category: "Office",
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body.id as string;
}

/** Past the FTA retention window so deletion is allowed. */
async function pastRetention(id: string) {
  await h.sql("UPDATE receipts SET created_at = now() - interval '7 years' WHERE id = $1", [id]);
}

async function postBody(t: Tenant) {
  return {
    accountId: (await accountByCode(t, "5000")).id,
    paymentAccountId: (await accountByCode(t, "1020")).id,
  };
}

async function auditCount(action: string, id: string) {
  const rows = await h.sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND resource_id = $2",
    [action, id]
  );
  return rows[0].n;
}

async function receiptCount(id: string) {
  const rows = await h.sql<{ n: number }>("SELECT count(*)::int AS n FROM receipts WHERE id = $1", [
    id,
  ]);
  return rows[0].n;
}

async function entryCount(t: Tenant) {
  const rows = await h.sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1",
    [t.company.id]
  );
  return rows[0].n;
}

async function failAuditWrites(action: string) {
  await h.sql(`CREATE OR REPLACE FUNCTION rpd_fail_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = '${action}' THEN RAISE EXCEPTION 'injected audit failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await h.sql(
    "CREATE TRIGGER rpd_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION rpd_fail_audit()"
  );
}

afterEach(async () => {
  await h.sql("DROP TRIGGER IF EXISTS rpd_fail_audit ON audit_logs");
});

describe("receipt delete vs post", () => {
  it("deleting a posted receipt is a 409 that keeps the receipt, journal and audit state", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    const posted = await t.as.post(`/api/receipts/${id}/post`, await postBody(t));
    expect(posted.status, posted.text).toBe(200);
    const entries = await entryCount(t);
    const del = await t.as.delete(`/api/receipts/${id}`);
    expect(del.status).toBe(409);
    expect(await receiptCount(id)).toBe(1);
    expect(await entryCount(t)).toBe(entries);
    expect(await auditCount("receipt.delete", id)).toBe(0);
  });

  it("storage delete is conditional on posted = false (stale-read race)", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    const posted = await t.as.post(`/api/receipts/${id}/post`, await postBody(t));
    expect(posted.status, posted.text).toBe(200);
    // The route read the receipt as unposted, then /post committed: the delete must remove nothing.
    const { storage } = await import("../../server/storage");
    expect(await storage.deleteReceipt(id, t.company.id)).toBe(false);
    expect(await receiptCount(id)).toBe(1);
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "concurrent delete and post never leave a posted journal without its receipt",
    async () => {
      for (let i = 0; i < 4; i++) {
        const t = await h.createTenant();
        const id = await createReceipt(t);
        await pastRetention(id);
        const body = await postBody(t);
        const [post, del] = await Promise.all([
          t.as.post(`/api/receipts/${id}/post`, body),
          t.as.delete(`/api/receipts/${id}`),
        ]);
        const exists = (await receiptCount(id)) === 1;
        const entries = await entryCount(t);
        if (exists) {
          expect(post.status, post.text).toBe(200);
          expect(del.status).toBe(409);
          expect(entries).toBe(1);
          expect(await auditCount("receipt.delete", id)).toBe(0);
        } else {
          expect(del.status, del.text).toBe(200);
          expect(post.status).toBeGreaterThanOrEqual(400);
          expect(entries).toBe(0);
          expect(await auditCount("receipt.delete", id)).toBe(1);
          expect(await auditCount("receipt.post", id)).toBe(0);
        }
      }
    }
  );

  it("deleting a missing or already-deleted receipt writes no audit row", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    await pastRetention(id);
    expect((await t.as.delete(`/api/receipts/${id}`)).status).toBe(200);
    expect(await auditCount("receipt.delete", id)).toBe(1);
    const again = await t.as.delete(`/api/receipts/${id}`);
    expect(again.status).toBe(404);
    expect(await auditCount("receipt.delete", id)).toBe(1);
  });
});

describe("receipt post audit", () => {
  it("writes exactly one receipt.post audit row with the post", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    const r = await t.as.post(`/api/receipts/${id}/post`, await postBody(t));
    expect(r.status, r.text).toBe(200);
    expect(await auditCount("receipt.post", id)).toBe(1);
  });

  it("a failing audit write rolls the post back", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    const entries = await entryCount(t);
    await failAuditWrites("receipt.post");
    const r = await t.as.post(`/api/receipts/${id}/post`, await postBody(t));
    expect(r.status).toBeGreaterThanOrEqual(500);
    const rows = await h.sql<{ posted: boolean }>("SELECT posted FROM receipts WHERE id = $1", [
      id,
    ]);
    expect(rows[0].posted).toBe(false);
    expect(await entryCount(t)).toBe(entries);
    expect(await auditCount("receipt.post", id)).toBe(0);
  });
});

describe("receipt review-decision", () => {
  const ok = { decision: "accepted", band: "high" };

  it("records the decision and rejects unknown keys", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    const url = `/api/companies/${t.company.id}/receipts/${id}/review-decision`;
    const good = await t.as.post(url, ok);
    expect(good.status, good.text).toBe(200);
    expect(await auditCount("receipt.ai_review", id)).toBe(1);
    const bad = await t.as.post(url, { ...ok, reviewerId: "someone-else" });
    expect(bad.status).toBe(400);
    expect(await auditCount("receipt.ai_review", id)).toBe(1);
  });

  it("returns an error when the audit write fails", async () => {
    const t = await h.createTenant();
    const id = await createReceipt(t);
    await failAuditWrites("receipt.ai_review");
    const r = await t.as.post(`/api/companies/${t.company.id}/receipts/${id}/review-decision`, ok);
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.body?.ok).not.toBe(true);
    expect(await auditCount("receipt.ai_review", id)).toBe(0);
  });
});
