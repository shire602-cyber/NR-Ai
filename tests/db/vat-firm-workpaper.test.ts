/**
 * W4-E firm VAT workpaper controls: R15-01 (period / rate validation), R07-09 + R15-06 (no Dubai
 * default), R15-02 (maker-checker state machine), R07-03 (books pull reads the VAT engine).
 */
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";

async function setup() {
  const t = await h.createTenant({
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "sharjah",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const wp = await t.as.post(`/api/companies/${t.company.id}/vat-workpapers`, {
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
  });
  expect(wp.status, wp.text).toBe(201);
  const base = `/api/companies/${t.company.id}/vat-workpapers/${wp.body.id}`;
  return { t, wp: wp.body as { id: string }, base };
}

const row = (over: Record<string, unknown> = {}) => ({
  rowCategory: "standard_sale",
  invoiceNumber: "INV-1",
  documentDate: "2026-08-15",
  emirate: "dubai",
  taxableAmount: 1000,
  vatAmount: 50,
  ...over,
});

async function reviewer(owner: Tenant) {
  const r = await h.createSecondTenant();
  await h.sql(
    `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')`,
    [owner.company.id, r.user.id]
  );
  return r;
}

describe("W4-E firm VAT workpaper", () => {
  it("[R15-01] a row dated outside the workpaper period is 422 and never reaches the totals", async () => {
    const { t, base } = await setup();
    const out = await t.as.post(`${base}/rows`, row({ documentDate: "2026-12-15" }));
    expect(out.status, out.text).toBe(422);
    expect(out.body.code).toBe("ROW_OUTSIDE_PERIOD");
    const detail = await t.as.get(base);
    expect(detail.body.rows).toHaveLength(0);
    expect(detail.body.totals.box14PayableTax).toBe(0);
  });

  it("[R15-01] VAT 900 on 1,000 is 422 unless an override reason is given", async () => {
    const { t, base } = await setup();
    const bad = await t.as.post(`${base}/rows`, row({ vatAmount: 900 }));
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("VAT_RATE_MISMATCH");
    const fil = await t.as.post(`${base}/rows`, row({ taxableAmount: 333.33, vatAmount: 16.67 }));
    expect(fil.status, fil.text).toBe(201);
    const zero = await t.as.post(
      `${base}/rows`,
      row({ rowCategory: "zero_rated_sale", emirate: null, vatAmount: 5 })
    );
    expect(zero.status).toBe(422);
    const ok = await t.as.post(
      `${base}/rows`,
      row({ vatAmount: 900, vatOverrideReason: "Customs reassessment agreed with client" })
    );
    expect(ok.status, ok.text).toBe(201);
    const badTrn = await t.as.post(`${base}/rows`, row({ counterpartyTrn: "12345" }));
    expect(badTrn.status).toBe(400);
  });

  it("[R07-09][R15-06] a standard-rated row with no or an unknown emirate is 422, never Dubai", async () => {
    const { t, base } = await setup();
    const none = await t.as.post(`${base}/rows`, row({ emirate: null }));
    expect(none.status, none.text).toBe(422);
    expect(none.body.code).toBe("EMIRATE_REQUIRED");
    const unknown = await t.as.post(`${base}/rows`, row({ emirate: "atlantis" }));
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe("INVALID_EMIRATE");
  });

  it("[R15-02] rows are not auto-approved; the preparer cannot review; draft -> filed is 409", async () => {
    const { t, base } = await setup();
    const created = await t.as.post(`${base}/rows`, row({ status: "approved" }));
    expect(created.status, created.text).toBe(201);
    expect(created.body.status).toBe("draft");
    expect(created.body.reviewedBy).toBeNull();

    const jump = await t.as.patch(`${base}/status`, { status: "filed" });
    expect(jump.status).toBe(409);
    expect(jump.body.code).toBe("INVALID_TRANSITION");

    const prep = await t.as.patch(`${base}/status`, { status: "prepared" });
    expect(prep.status, prep.text).toBe(200);
    expect(prep.body.preparedBy).toBe(t.user.id);

    const self = await t.as.patch(`${base}/status`, { status: "reviewed" });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("SAME_ACTOR_APPROVAL");

    const rv = await reviewer(t);
    const pending = await rv.as.patch(`${base}/status`, { status: "reviewed" });
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe("DRAFT_ROWS_PENDING");

    expect((await t.as.post(`${base}/rows/bulk-status`, { to: "approved" })).status).toBe(200);
    const reviewed = await rv.as.patch(`${base}/status`, { status: "reviewed" });
    expect(reviewed.status, reviewed.text).toBe(200);
    expect(reviewed.body.reviewerUserId).toBe(rv.user.id);

    // Reviewed workpapers are frozen.
    const edit = await t.as.post(`${base}/rows`, row());
    expect(edit.status).toBe(409);

    const noReturn = await rv.as.patch(`${base}/status`, { status: "filed" });
    expect(noReturn.status).toBe(409);
    expect(noReturn.body.code).toBe("RETURN_NOT_GENERATED");
    const gen = await t.as.post(`${base}/generate-return`, {});
    expect(gen.status, gen.text).toBe(200);
    expect(gen.body.workpaper.status).toBe("reviewed");
    expect(gen.body.vatReturn.box1bDubaiVat).toBe(50);
    const replay = await t.as.post(`${base}/generate-return`, {});
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body.vatReturn.id).toBe(gen.body.vatReturn.id);
    const filed = await rv.as.patch(`${base}/status`, { status: "filed" });
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body.filedBy).toBe(rv.user.id);
    const audit = await h.sql(
      `SELECT action FROM audit_logs WHERE resource_id = $1 AND action LIKE 'vat_workpaper.status.%' ORDER BY created_at`,
      [filed.body.id]
    );
    expect(audit.map((a: { action: string }) => a.action)).toEqual([
      "vat_workpaper.status.prepared",
      "vat_workpaper.status.reviewed",
      "vat_workpaper.status.filed",
    ]);
  });

  it("refuses workpaper generation when a separate return draft already exists for the period", async () => {
    const { t, base } = await setup();
    const returns = `/api/companies/${t.company.id}/vat-returns`;
    const draft = await t.as.post(`${returns}/generate`, {
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    expect(draft.status, draft.text).toBe(201);
    const prepared = await t.as.patch(`${base}/status`, { status: "prepared" });
    expect(prepared.status, prepared.text).toBe(200);
    const generated = await t.as.post(`${base}/generate-return`, {});
    expect(generated.status, generated.text).toBe(409);
    expect(generated.body).toMatchObject({
      code: "VAT_RETURN_EXISTS",
      details: { vatReturnId: draft.body.id, status: "draft" },
    });
    const workpaper = await t.as.get(base);
    expect(workpaper.body.workpaper.generatedVatReturnId).toBeNull();
    const existing = await t.as.get(returns);
    expect(existing.body.map((r: { id: string }) => r.id)).toEqual([draft.body.id]);
  });

  it("keeps one active return when return generation races with the workpaper", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const { t, base } = await setup();
    const returns = `/api/companies/${t.company.id}/vat-returns`;
    const prepared = await t.as.patch(`${base}/status`, { status: "prepared" });
    expect(prepared.status, prepared.text).toBe(200);
    const [direct, workpaper] = await Promise.all([
      t.as.post(`${returns}/generate`, { periodStart: "2026-07-01", periodEnd: "2026-09-30" }),
      t.as.post(`${base}/generate-return`, {}),
    ]);
    expect(direct.status, direct.text).toBe(201);
    if (workpaper.status === 200) {
      expect(workpaper.body.vatReturn.id).toBe(direct.body.id);
    } else {
      expect(workpaper.status, workpaper.text).toBe(409);
      expect(workpaper.body).toMatchObject({
        code: "VAT_RETURN_EXISTS",
        details: { vatReturnId: direct.body.id },
      });
    }
    const existing = await t.as.get(returns);
    expect(existing.body.map((r: { id: string }) => r.id)).toEqual([direct.body.id]);
  });

  it("includes a row edit committed while workpaper generation waits for the VAT lock", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const { t, base } = await setup();
    const created = await t.as.post(`${base}/rows`, row());
    expect(created.status, created.text).toBe(201);
    const approved = await t.as.post(`${base}/rows/bulk-status`, { to: "approved" });
    expect(approved.status, approved.text).toBe(200);
    const prepared = await t.as.patch(`${base}/status`, { status: "prepared" });
    expect(prepared.status, prepared.text).toBe(200);

    const blocker = new pg.Client({ connectionString: h.databaseUrl });
    await blocker.connect();
    let generating: ReturnType<Tenant["as"]["post"]> | undefined;
    try {
      const [lock] = await h.sql<{ key: string }>(
        "SELECT hashtextextended('vat-returns:' || $1::uuid::text, 0)::text AS key",
        [t.company.id]
      );
      await blocker.query("SELECT pg_advisory_lock($1::bigint)", [lock.key]);
      generating = t.as.post(`${base}/generate-return`, {});
      await vi.waitFor(async () => {
        const waiting = await h.sql(
          `SELECT 1 FROM pg_locks
           WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
             AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
             AND classid::bigint = (($1::bigint >> 32) & 4294967295)
             AND objid::bigint = ($1::bigint & 4294967295)`,
          [lock.key]
        );
        expect(waiting).toHaveLength(1);
      });

      const edited = await t.as.patch(`${base}/rows/${created.body.id}`, {
        taxableAmount: 2000,
        vatAmount: 100,
      });
      expect(edited.status, edited.text).toBe(200);
    } finally {
      await blocker.end();
    }

    const generated = await generating!;
    expect(generated.status, generated.text).toBe(200);
    expect(Number(generated.body.vatReturn.box12TotalDueTax)).toBe(100);
    const detail = await t.as.get(base);
    expect(detail.body.workpaper.totalsSnapshot.box12TotalDueTax).toBe(100);
  });

  it("posts sales and expense workpaper rows with their document links", async () => {
    const { t, base } = await setup();
    const fixtures = [
      {
        input: row({ rowCategory: "exempt_sale", emirate: null, vatAmount: 0 }),
        documentType: "invoice",
        status: "posted",
      },
      {
        input: row({
          rowCategory: "standard_expense",
          counterpartyName: "Supplier",
          counterpartyTrn: "100000000000011",
        }),
        documentType: "bill",
        status: "pending_approval",
      },
    ];
    for (const { input, documentType, status } of fixtures) {
      const created = await t.as.post(`${base}/rows`, input);
      expect(created.status, created.text).toBe(201);
      const url = `${base}/rows/${created.body.id}/post`;
      const posted = await t.as.post(url, {});
      expect(posted.status, posted.text).toBe(200);
      expect(posted.body).toMatchObject({ documentType, status });
      const detail = await t.as.get(base);
      expect(detail.body.rows).toContainEqual(
        expect.objectContaining({
          id: created.body.id,
          sourceDocumentType: documentType,
          sourceDocumentId: posted.body.documentId,
        })
      );
      const repeated = await t.as.post(url, {});
      expect(repeated.status, repeated.text).toBe(409);
    }
  });

  it("[R07-03] pull-from-books reads the VAT engine: out-of-scope lines produce no row, rows carry the invoice emirate", async () => {
    const { t, base } = await setup();
    const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme LLC",
      date: "2026-08-10",
      placeOfSupplyEmirate: "dubai",
      lines: [
        { description: "Std", quantity: 1, unitPrice: 1000, vatRate: 5 },
        {
          description: "Abroad",
          quantity: 1,
          unitPrice: 100,
          vatRate: 0,
          vatSupplyType: "out_of_scope",
        },
        { description: "Ex", quantity: 1, unitPrice: 250, vatRate: 0, vatSupplyType: "exempt" },
      ],
    });
    expect(c.status, c.text).toBe(200);
    await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
    const pull = await t.as.post(`${base}/pull-from-books`, {});
    expect(pull.status, pull.text).toBe(200);
    expect(pull.body.created).toBe(2);
    const detail = await t.as.get(base);
    const std = detail.body.rows.find(
      (r: { rowCategory: string }) => r.rowCategory === "standard_sale"
    );
    expect(std.emirate).toBe("dubai");
    expect(Number(std.taxableAmount)).toBe(1000);
    expect(std.status).toBe("draft");
    expect(
      detail.body.rows.some((r: { rowCategory: string }) => r.rowCategory === "exempt_sale")
    ).toBe(true);
    // Repeat pull is idempotent.
    const again = await t.as.post(`${base}/pull-from-books`, {});
    expect(again.body.created).toBe(0);
  });
});
