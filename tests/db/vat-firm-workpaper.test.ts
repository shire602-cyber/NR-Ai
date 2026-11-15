/**
 * W4-E firm VAT workpaper controls: R15-01 (period / rate validation), R07-09 + R15-06 (no Dubai
 * default), R15-02 (maker-checker state machine), R07-03 (books pull reads the VAT engine).
 */
import { describe, expect, it } from "vitest";
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
