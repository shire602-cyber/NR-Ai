/**
 * Exact VAT return attribution on the bad-debt relief list: each claim and each add-back names the
 * return it lands in, read from the recorded returns (never from today's filing settings), with
 * group membership as at the filing, a return under amendment shown as such, receipt recoveries
 * dated as the ledger dates them, and agreement with computeVat201's own period assignment.
 */
import { describe, expect, it, vi } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

const WRITTEN_OFF = "2026-08-18";
const CLAIMED = "2026-08-20";
const GROUP_TRN = "100000000000003";

async function setup(name: string) {
  const t = await h.createTenant({ name, planId: "professional" });
  const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Acme LLC",
    email: "ap@acme.example",
  });
  expect(c.status, c.text).toBeLessThan(300);
  const i = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId: c.body.id,
    placeOfSupplyEmirate: "dubai",
    date: "2026-01-10",
    lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(i.status, i.text).toBe(200);
  expect((await t.as.patch(`/api/invoices/${i.body.id}/status`, { status: "sent" })).status).toBe(
    200
  );
  const w = await t.as.post(`/api/companies/${t.company.id}/invoices/${i.body.id}/write-off`, {
    date: WRITTEN_OFF,
    reason: "Insolvency",
  });
  expect(w.status, w.text).toBe(201);
  return { t, invoiceId: i.body.id as string };
}

async function claim(t: Tenant, invoiceId: string) {
  const r = await t.as.post(`/api/companies/${t.company.id}/vat/bad-debt-relief`, {
    invoiceId,
    claimDate: CLAIMED,
    writtenOff: true,
    customerNotified: true,
    customerNotifiedAt: "2026-08-19",
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string };
}

const list = (t: Tenant) => t.as.get(`/api/companies/${t.company.id}/vat/bad-debt-relief`);
const reverse = (t: Tenant, id: string, date: string) =>
  t.as.post(`/api/companies/${t.company.id}/vat/bad-debt-relief/${id}/reverse`, {
    date,
    reason: "Customer paid",
  });

async function insertReturn(
  t: Tenant,
  from: string,
  to: string,
  opts: { status?: string; groupId?: string; memberIds?: string[]; amends?: string } = {}
): Promise<string> {
  const snapshot =
    opts.groupId && opts.memberIds
      ? {
          filingVatGroup: {
            groupId: opts.groupId,
            name: "Group",
            groupTrn: GROUP_TRN,
            memberIds: opts.memberIds,
            provenance: "recorded",
            memberAuthority: "settings.company",
          },
        }
      : null;
  const rows = await h.sql<{ id: string }>(
    `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, vat_group_id,
                              created_by, reconciliation_snapshot, amends_return_id)
     VALUES ($1, $2::date, $3::date, ($3::date + 28), $4, $5, $6, $7::jsonb, $8) RETURNING id`,
    [
      t.company.id,
      from,
      to,
      opts.status ?? "filed",
      opts.groupId ?? null,
      t.user.id,
      snapshot ? JSON.stringify(snapshot) : null,
      opts.amends ?? null,
    ]
  );
  return rows[0].id;
}

async function createGroup(rep: Tenant, members: Tenant[]) {
  const g = await h.sql<{ id: string }>(
    `INSERT INTO vat_groups (representative_company_id, name, group_trn)
     VALUES ($1, 'Group', $2) RETURNING id`,
    [rep.company.id, GROUP_TRN]
  );
  for (const m of members) {
    await h.sql(`INSERT INTO vat_group_members (group_id, company_id) VALUES ($1, $2)`, [
      g[0].id,
      m.company.id,
    ]);
  }
  return g[0].id;
}

/**
 * The periods (among the candidates) whose computeVat201 reports one of these ids: the claim id,
 * or the id of the ledger entry that carries the add-back (the engine reports recoveries by entry).
 */
async function enginePeriods(
  claimId: string | string[],
  sourceType: "bad_debt_relief" | "bad_debt_relief_reversal",
  periods: Array<[string, string]>,
  viaCompanyId: string
) {
  const { computeVat201 } = await import("../../server/tax/vat-engine");
  const hits: Array<[string, string]> = [];
  for (const [from, to] of periods) {
    const v = await computeVat201({ companyId: viaCompanyId, from, to, allowIncomplete: true });
    const ids = Array.isArray(claimId) ? claimId : [claimId];
    if (v.contributions.some((c) => c.sourceType === sourceType && ids.includes(c.sourceId))) {
      hits.push([from, to]);
    }
  }
  return hits;
}

describe("bad-debt relief list: exact VAT return attribution", () => {
  it("names a monthly filed return for a monthly filer", async () => {
    const { t, invoiceId } = await setup("BDRA-monthly");
    await h.sql(`UPDATE companies SET vat_filing_frequency = 'monthly' WHERE id = $1`, [
      t.company.id,
    ]);
    const c = await claim(t, invoiceId);
    await insertReturn(t, "2026-08-01", "2026-08-31");
    expect((await list(t)).body[0].claimReturn).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      status: "filed",
      source: "company",
    });
    expect(
      await enginePeriods(
        c.id,
        "bad_debt_relief",
        [
          ["2026-07-01", "2026-07-31"],
          ["2026-08-01", "2026-08-31"],
        ],
        t.company.id
      )
    ).toEqual([["2026-08-01", "2026-08-31"]]);
  });

  it("names a quarterly filed return for a quarterly filer", async () => {
    const { t, invoiceId } = await setup("BDRA-quarterly");
    await h.sql(`UPDATE companies SET vat_filing_frequency = 'quarterly' WHERE id = $1`, [
      t.company.id,
    ]);
    const c = await claim(t, invoiceId);
    await insertReturn(t, "2026-07-01", "2026-09-30");
    expect((await list(t)).body[0].claimReturn).toMatchObject({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "filed",
    });
    expect(
      await enginePeriods(c.id, "bad_debt_relief", [["2026-07-01", "2026-09-30"]], t.company.id)
    ).toEqual([["2026-07-01", "2026-09-30"]]);
  });

  it("keeps the period of a return filed under an old stagger after the settings changed", async () => {
    const { t, invoiceId } = await setup("BDRA-stagger");
    const c = await claim(t, invoiceId);
    // Filed as a quarter (Jul-Sep); the company has since switched to monthly filing.
    await insertReturn(t, "2026-07-01", "2026-09-30");
    await h.sql(
      `UPDATE companies SET vat_filing_frequency = 'monthly', vat_period_start_month = 2 WHERE id = $1`,
      [t.company.id]
    );
    expect((await list(t)).body[0].claimReturn).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "filed",
      source: "company",
    });
    // A reversal in the next, unfiled month has no recorded return: forecast from current settings.
    const rev = await reverse(t, c.id, "2026-10-14");
    expect(rev.status, rev.text).toBe(200);
    expect((await list(t)).body[0].reversalReturns).toEqual([
      { from: "2026-10-01", to: "2026-10-31", status: "forecast", source: "forecast" },
    ]);
  });

  it("labels a date with no recorded return as a forecast from the current stagger", async () => {
    const { t, invoiceId } = await setup("BDRA-forecast");
    await h.sql(`UPDATE companies SET vat_filing_frequency = 'quarterly' WHERE id = $1`, [
      t.company.id,
    ]);
    await claim(t, invoiceId);
    expect((await list(t)).body[0].claimReturn).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "forecast",
      source: "forecast",
    });
  });

  it("shows an open return as open", async () => {
    const { t, invoiceId } = await setup("BDRA-open");
    await claim(t, invoiceId);
    await insertReturn(t, "2026-07-01", "2026-09-30", { status: "draft" });
    expect((await list(t)).body[0].claimReturn).toMatchObject({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "open",
    });
  });

  it("uses group membership as at the filing for a member that left the group", async () => {
    const rep = await h.createTenant({ name: "BDRA-rep-left", planId: "professional" });
    const { t, invoiceId } = await setup("BDRA-left");
    const c = await claim(t, invoiceId);
    const gid = await createGroup(rep, [t]);
    await insertReturn(rep, "2026-07-01", "2026-09-30", {
      groupId: gid,
      memberIds: [rep.company.id, t.company.id],
    });
    await h.sql(`DELETE FROM vat_group_members WHERE group_id = $1 AND company_id = $2`, [
      gid,
      t.company.id,
    ]);
    expect((await list(t)).body[0].claimReturn).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "filed",
      source: "group",
    });
    // The group return's computation (frozen members) still reports the claim.
    const { computeVat201 } = await import("../../server/tax/vat-engine");
    const v = await computeVat201(
      { companyId: rep.company.id, from: "2026-07-01", to: "2026-09-30", allowIncomplete: true },
      undefined,
      {
        groupId: gid,
        name: "Group",
        groupTrn: GROUP_TRN,
        memberIds: [rep.company.id, t.company.id],
        memberAuthority: "settings.company",
      }
    );
    expect(
      v.contributions.some((x) => x.sourceType === "bad_debt_relief" && x.sourceId === c.id)
    ).toBe(true);
  });

  it("uses the member's own return when it joined the group after the group return was filed", async () => {
    const rep = await h.createTenant({ name: "BDRA-rep-join", planId: "professional" });
    const { t, invoiceId } = await setup("BDRA-join");
    await claim(t, invoiceId);
    const gid = await createGroup(rep, []);
    await insertReturn(rep, "2026-08-01", "2026-08-31", {
      groupId: gid,
      memberIds: [rep.company.id],
    });
    await insertReturn(t, "2026-07-01", "2026-09-30");
    await h.sql(`INSERT INTO vat_group_members (group_id, company_id) VALUES ($1, $2)`, [
      gid,
      t.company.id,
    ]);
    expect((await list(t)).body[0].claimReturn).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "filed",
      source: "company",
    });
  });

  it("shows a return under amendment as under amendment and still allows a reversal into it", async () => {
    const { t, invoiceId } = await setup("BDRA-amend");
    const c = await claim(t, invoiceId);
    const original = await insertReturn(t, "2026-07-01", "2026-09-30", { status: "amended" });
    await insertReturn(t, "2026-07-01", "2026-09-30", { status: "draft", amends: original });
    expect((await list(t)).body[0].claimReturn).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "amendment",
      source: "company",
    });
    // The amendment re-opens the period for corrections: the server accepts the reversal.
    const rev = await reverse(t, c.id, "2026-09-10");
    expect(rev.status, rev.text).toBe(200);
    expect((await list(t)).body[0].reversalReturns).toEqual([
      { from: "2026-07-01", to: "2026-09-30", status: "amendment", source: "company" },
    ]);
  });

  it("keeps the period of a group return that is under a pending amendment", async () => {
    const rep = await h.createTenant({ name: "BDRA-rep-amend", planId: "professional" });
    const { t, invoiceId } = await setup("BDRA-member-amend");
    await claim(t, invoiceId);
    const gid = await createGroup(rep, [t]);
    const memberIds = [rep.company.id, t.company.id];
    const original = await insertReturn(rep, "2026-07-01", "2026-09-30", {
      status: "amended",
      groupId: gid,
      memberIds,
    });
    await insertReturn(rep, "2026-07-01", "2026-09-30", {
      status: "draft",
      groupId: gid,
      memberIds,
      amends: original,
    });
    expect((await list(t)).body[0].claimReturn).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "amendment",
      source: "group",
    });
  });

  it("dates a receipt recovery in the next open period when the payment date is in a filed return", async () => {
    const { t, invoiceId } = await setup("BDRA-receipt");
    await h.sql(`UPDATE companies SET vat_filing_frequency = 'quarterly' WHERE id = $1`, [
      t.company.id,
    ]);
    const c = await claim(t, invoiceId);
    await insertReturn(t, "2026-07-01", "2026-09-30");
    const bank = await accountByCode(t, "1020");
    // The customer pays in full on a date inside the filed quarter.
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/payments`, {
      amount: 1050,
      date: "2026-09-05",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const row = (await list(t)).body[0];
    expect(row.status).toBe("reversed");
    expect(row.reversedAt).toBe("2026-10-01");
    // The add-back sits in the next open quarter, not the filed one the payment date is in.
    expect(row.reversalReturns).toEqual([
      { from: "2026-10-01", to: "2026-12-31", status: "forecast", source: "forecast" },
    ]);
    expect(row.claimReturn).toMatchObject({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "filed",
    });
    // computeVat201 agrees: the add-back is reported in Q4, not in the filed Q3.
    expect(
      await enginePeriods(
        [c.id, row.reversalEntryId],
        "bad_debt_relief_reversal",
        [
          ["2026-07-01", "2026-09-30"],
          ["2026-10-01", "2026-12-31"],
        ],
        t.company.id
      )
    ).toEqual([["2026-10-01", "2026-12-31"]]);
  });

  it("agrees with computeVat201 for a manual reversal dated before the claim", async () => {
    const { t, invoiceId } = await setup("BDRA-clamp");
    await h.sql(`UPDATE companies SET vat_filing_frequency = 'monthly' WHERE id = $1`, [
      t.company.id,
    ]);
    const c = await claim(t, invoiceId);
    // Dated before the claim: the ledger clamps it to the claim date.
    const rev = await reverse(t, c.id, "2026-08-01");
    expect(rev.status, rev.text).toBe(200);
    const row = (await list(t)).body[0];
    expect(row.reversedAt).toBe(CLAIMED);
    expect(row.reversalReturns).toEqual([
      { from: "2026-08-01", to: "2026-08-31", status: "forecast", source: "forecast" },
    ]);
    expect(
      await enginePeriods(
        [c.id, row.reversalEntryId],
        "bad_debt_relief_reversal",
        [
          ["2026-07-01", "2026-07-31"],
          ["2026-08-01", "2026-08-31"],
        ],
        t.company.id
      )
    ).toEqual([["2026-08-01", "2026-08-31"]]);
  });

  it("answers with a bounded number of queries however many claims there are", async () => {
    const { t, invoiceId } = await setup("BDRA-queries");
    const c = await claim(t, invoiceId);
    await insertReturn(t, "2026-01-01", "2026-03-31");
    await insertReturn(t, "2026-04-01", "2026-06-30");
    await insertReturn(t, "2026-07-01", "2026-09-30");
    const { pool } = await import("../../server/db");
    const { listBadDebtReliefClaimsDetailed } =
      await import("../../server/tax/vat-adjustments.service");
    const count = async () => {
      const spy = vi.spyOn(pool, "query");
      try {
        const rows = await listBadDebtReliefClaimsDetailed(t.company.id);
        return { n: spy.mock.calls.length, rows: rows.length };
      } finally {
        spy.mockRestore();
      }
    };
    // Dates spanning the same three returns in both runs, so only the claim count differs.
    const days = ["2026-02-10", "2026-05-12", "2026-08-14"];
    const addClaims = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await h.sql(
          `INSERT INTO bad_debt_relief_claims (company_id, invoice_id, claim_date, emirate,
                  outstanding_amount, taxable_amount, vat_amount, written_off, customer_notified,
                  status, reversed_at)
           SELECT company_id, invoice_id, $2::date, emirate, outstanding_amount, taxable_amount,
                  vat_amount, written_off, customer_notified, 'reversed', $3::date
             FROM bad_debt_relief_claims WHERE id = $1`,
          [c.id, days[i % 3], days[(i + 1) % 3]]
        );
      }
    };
    await addClaims(3);
    const few = await count();
    await addClaims(30);
    const many = await count();
    expect(few.rows).toBe(4);
    expect(many.rows).toBe(34);
    expect(many.n).toBe(few.n);
    expect(many.n).toBeLessThan(40);
  });
});
