/**
 * Bad-debt reinstatement preserves A/R history. Reinstating a written-off invoice must ADD
 * dated entries (a negative settlement row and a reversal journal on the reinstatement date);
 * aging, open balance, the customer statement and GL 1040 as of any earlier date stay exactly as
 * they were, and the settlement rule keeps tying to GL 1040 at every date.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

const D1 = "2026-01-05"; // issued
const D2 = "2026-02-10"; // written off
const MID = "2026-03-01"; // between write-off and reinstatement
const D3 = "2026-03-15"; // reinstated
const LATER = "2026-04-20";
const DATES = [D1, "2026-01-31", D2, MID, "2026-03-14", D3, LATER];

const contacts = new Map<string, string>();

async function tenant(name: string): Promise<Tenant> {
  const t = await h.createTenant({ name, planId: "professional" });
  const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Acme LLC",
    email: "ap@acme.example",
  });
  expect(c.status, c.text).toBeLessThan(300);
  contacts.set(t.company.id, c.body.id as string);
  return t;
}

async function issue(t: Tenant, date: string, unitPrice = 1000) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId: contacts.get(t.company.id),
    placeOfSupplyEmirate: "dubai",
    date,
    lines: [{ description: "Work", quantity: 1, unitPrice, vatRate: 0, vatSupplyType: "exempt" }],
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string; number: string };
}

async function writeOff(t: Tenant, id: string, date: string, amount?: number) {
  const r = await t.as.post(`/api/companies/${t.company.id}/invoices/${id}/write-off`, {
    date,
    reason: "Insolvency",
    ...(amount ? { amount } : {}),
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
}

async function reinstate(t: Tenant, id: string, date: string) {
  return t.as.post(`/api/companies/${t.company.id}/invoices/${id}/write-off/reinstate`, {
    date,
    reason: "Wrong write-off",
  });
}

async function gl1040(t: Tenant, to: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '1040'
        AND ((je.date + interval '4 hours')::date) <= $2::date`,
    [t.company.id, to]
  );
  return Number(rows[0].n) / 100;
}

async function aging(t: Tenant, asOf: string) {
  const r = await t.as.get(`/api/companies/${t.company.id}/reports/aged-receivables?asOf=${asOf}`);
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function statementOf(t: Tenant, asOf: string) {
  const { buildCustomerStatement } =
    await import("../../server/services/customer-statement.service");
  const st = await buildCustomerStatement({
    companyId: t.company.id,
    contactId: contacts.get(t.company.id)!,
    asOf,
  });
  return st.sections.map((s) => ({
    currency: s.currency,
    closing: s.closingBalance,
    open: s.aging.total,
    lines: s.lines.map((l) => [l.date, l.type, l.debit, l.credit]),
  }));
}

/** Everything a report can say about A/R as of `asOf`. */
async function snapshot(t: Tenant, asOf: string) {
  const a = await aging(t, asOf);
  return {
    asOf,
    gl: await gl1040(t, asOf),
    agingTotal: a.totals.total,
    reconciled: a.reconciliation.isReconciled,
    agingTotals: JSON.stringify(a.totals),
    statement: await statementOf(t, asOf),
  };
}

async function snapshots(t: Tenant, dates: string[]) {
  const out = [];
  for (const d of dates) out.push(await snapshot(t, d));
  return out;
}

describe("bad-debt reinstatement preserves A/R history", () => {
  it("manual reinstatement adds dated rows and leaves every earlier date unchanged", async () => {
    const t = await tenant("RI-manual");
    const inv = await issue(t, D1);
    await writeOff(t, inv.id, D2);
    const before = await snapshots(
      t,
      DATES.filter((d) => d < D3)
    );
    expect(before.find((s) => s.asOf === D1)!.agingTotal).toBe(1000);
    expect(before.find((s) => s.asOf === MID)!.agingTotal).toBe(0);

    const re = await reinstate(t, inv.id, D3);
    expect(re.status, re.text).toBe(200);
    expect(re.body.reinstated).toBe(1000);

    const after = await snapshots(t, DATES);
    // History: every date before the reinstatement is identical.
    for (const b of before)
      expect(
        after.find((s) => s.asOf === b.asOf),
        b.asOf
      ).toEqual(b);
    // From D3 the invoice is open again, and the settlement still ties to GL 1040.
    for (const s of after.filter((x) => x.asOf >= D3)) {
      expect(s.agingTotal, s.asOf).toBe(1000);
      expect(s.gl, s.asOf).toBe(1000);
    }
    for (const s of after) {
      expect(s.reconciled, s.asOf).toBe(true);
      expect(s.agingTotal, s.asOf).toBe(s.gl);
    }
    // The write-off row is still there; the reinstatement is a new negative row on D3.
    const rows = await h.sql<{ method: string; amount: string; d: string }>(
      `SELECT method, amount::text, ((date + interval '4 hours')::date)::text AS d
         FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at`,
      [inv.id]
    );
    expect(rows.map((r) => [r.method, Number(r.amount), r.d])).toEqual([
      ["write_off", 1000, D2],
      ["write_off_reinstatement", -1000, D3],
    ]);
    // GL: the original write-off entry is untouched and a new reversal is dated D3.
    const je = await h.sql<{ d: string; reversed_by: string | null }>(
      `SELECT ((date + interval '4 hours')::date)::text AS d, reversed_by_entry_id AS reversed_by
         FROM journal_entries
        WHERE company_id = $1 AND source IN ('invoice_write_off', 'payment_reversal')
        ORDER BY date`,
      [t.company.id]
    );
    expect(je.map((r) => r.d)).toEqual([D2, D3]);
    // Statement shows the reinstatement as a debit on D3 only.
    const st = (await statementOf(t, LATER))[0];
    expect(st.lines.map((l) => l.slice(0, 2).join(" "))).toContain(`${D3} payment`);
    expect(st.closing).toBe(1000);
  });

  it("repeat reinstatement is idempotent and a second call changes nothing", async () => {
    const t = await tenant("RI-idem");
    const inv = await issue(t, D1);
    await writeOff(t, inv.id, D2);
    expect((await reinstate(t, inv.id, D3)).status).toBe(200);
    const snap = await snapshots(t, DATES);
    const again = await reinstate(t, inv.id, "2026-03-20");
    expect(again.status, again.text).toBe(409);
    expect(again.body.code).toBe("NO_WRITE_OFF");
    expect(await snapshots(t, DATES)).toEqual(snap);
    const n = await h.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM invoice_payments WHERE invoice_id = $1`,
      [inv.id]
    );
    expect(Number(n[0].n)).toBe(2);
  });

  it("rejects a reinstatement dated before the write-off", async () => {
    const t = await tenant("RI-early");
    const inv = await issue(t, D1);
    await writeOff(t, inv.id, D2);
    const r = await reinstate(t, inv.id, "2026-01-20");
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("REINSTATE_BEFORE_WRITE_OFF");
  });

  it("multiple write-offs reinstate together and can be written off again", async () => {
    const t = await tenant("RI-multi");
    const inv = await issue(t, D1);
    await writeOff(t, inv.id, D2, 400);
    await writeOff(t, inv.id, "2026-02-20", 600);
    const early = [D1, D2, "2026-02-15", "2026-02-20", MID];
    const before = await snapshots(t, early);
    expect(before.find((s) => s.asOf === "2026-02-15")!.agingTotal).toBe(600);
    expect(before.find((s) => s.asOf === MID)!.agingTotal).toBe(0);
    const re = await reinstate(t, inv.id, D3);
    expect(re.status, re.text).toBe(200);
    expect(re.body.reinstated).toBe(1000);
    const after = await snapshots(t, [...early, D3, LATER]);
    for (const b of before)
      expect(
        after.find((s) => s.asOf === b.asOf),
        b.asOf
      ).toEqual(b);
    expect(after.find((s) => s.asOf === D3)!.agingTotal).toBe(1000);
    for (const s of after) expect(s.agingTotal, s.asOf).toBe(s.gl);
    // Write off again after the reinstatement: only the new write-off stands.
    await writeOff(t, inv.id, "2026-04-01");
    const final = await snapshots(t, [D3, "2026-03-31", "2026-04-01", LATER]);
    expect(final.map((s) => s.agingTotal)).toEqual([1000, 1000, 0, 0]);
    for (const s of final) expect(s.agingTotal, s.asOf).toBe(s.gl);
  });

  it("receipt-triggered reinstatement (partial) keeps history and reinstates only what is needed", async () => {
    const t = await tenant("RI-receipt");
    const bank = await accountByCode(t, "1020");
    const inv = await issue(t, D1);
    await writeOff(t, inv.id, D2, 400);
    await writeOff(t, inv.id, "2026-02-20", 600);
    const early = [D1, D2, "2026-02-15", "2026-02-20", MID];
    const before = await snapshots(t, early);
    // A 300 receipt needs more open balance than there is: the newest write-off (600) is
    // reinstated, the older 400 stays written off.
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/payments`, {
      amount: 300,
      date: D3,
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const after = await snapshots(t, [...early, D3, LATER]);
    for (const b of before)
      expect(
        after.find((s) => s.asOf === b.asOf),
        b.asOf
      ).toEqual(b);
    // 600 reinstated on D3, 300 received the same day: 300 open.
    expect(after.find((s) => s.asOf === D3)!.agingTotal).toBe(300);
    expect(after.find((s) => s.asOf === LATER)!.agingTotal).toBe(300);
    for (const s of after) expect(s.agingTotal, s.asOf).toBe(s.gl);
    const rows = await h.sql<{ method: string; amount: string }>(
      `SELECT method, amount::text FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at`,
      [inv.id]
    );
    expect(rows.map((r) => [r.method, Number(r.amount)])).toEqual([
      ["write_off", 400],
      ["write_off", 600],
      ["write_off_reinstatement", -600],
      ["bank", 300],
    ]);
  });

  it("a receipt dated before the write-off reinstates on the write-off date", async () => {
    const t = await tenant("RI-backdated");
    const bank = await accountByCode(t, "1020");
    const inv = await issue(t, D1);
    await writeOff(t, inv.id, D2);
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/payments`, {
      amount: 1000,
      date: "2026-01-20",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const reinst = await h.sql<{ d: string }>(
      `SELECT ((date + interval '4 hours')::date)::text AS d FROM invoice_payments
        WHERE invoice_id = $1 AND method = 'write_off_reinstatement'`,
      [inv.id]
    );
    expect(reinst.map((r) => r.d)).toEqual([D2]);
  });
});
