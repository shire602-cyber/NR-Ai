// Integration tests for the third round of review fixes:
//   1  voiding an invoice that has credit notes is refused (no double reversal)
//   2  quote -> invoice conversion carries currency + a dated exchange rate
//   3  AI bank reconciliation goes through the settlement date guard
//   4  payroll allowances are strictly parsed (400 naming the field)
//   7  legacy lines stored as taxed-but-exempt still land in the standard-rated box
// Drives real HTTP against a running server + Postgres.
//   BASE_URL=http://127.0.0.1:5056 node tests/integration/review-fixes-3.test.mjs

import pg from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const today = ymd(0);
const n = (v) => Number(v ?? 0);
const close = (a, b, t = 0.005) => Math.abs(n(a) - n(b)) <= t;

// A fresh company (own user) with the default chart.
async function freshCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const balances = async () => {
    const j = (await api("GET", `/api/companies/${cid}/journal`, { token })).json ?? [];
    const out = {};
    for (const e of j) {
      if (e.status && e.status !== "posted") continue;
      for (const l of e.lines ?? []) {
        const code = l.account?.code;
        out[code] = Math.round(((out[code] ?? 0) + n(l.debit) - n(l.credit)) * 100) / 100;
      }
    }
    return out;
  };
  const mk = (extra) => api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "Review Co", date: today, ...extra } });
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });
  return { token, cid, balances, mk, issue };
}

async function main() {
  const AR = "1040", VAT = "2020", REV = "4010";
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    // ───────── Item 1: void with credit notes is refused ─────────
    {
      const c = await freshCompany("i1");
      let r = await c.mk({ lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
      const inv = r.json;
      r = await c.issue(inv.id);
      ok("I1: invoice 1000 + 5% issued", r.status === 200, { s: r.status, m: r.json?.message });
      r = await api("POST", `/api/companies/${c.cid}/invoices/${inv.id}/credit-note`, { token: c.token, body: { lines: [{ description: "partial", quantity: 1, unitPrice: 400, vatRate: 0.05 }] } });
      ok("I1: partial credit note 400 issued", r.status === 201, { s: r.status, m: r.json?.message });
      const cn = r.json;
      const before = await c.balances();
      r = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: c.token, body: { status: "void" } });
      ok("I1: void with a credit note -> 409 INVOICE_HAS_CREDIT_NOTES", r.status === 409 && r.json?.code === "INVOICE_HAS_CREDIT_NOTES", { s: r.status, j: r.json });
      ok("I1: message tells the user what to do", /void the credit notes first/i.test(r.json?.message ?? "") && /final credit note/i.test(r.json?.message ?? ""), r.json);
      const after = await c.balances();
      ok("I1: AR, revenue and VAT balances unchanged by the attempt", close(after[AR], before[AR]) && close(after[REV], before[REV]) && close(after[VAT], before[VAT]), { before, after });
      r = await api("GET", `/api/invoices/${inv.id}`, { token: c.token });
      ok("I1: invoice status is unchanged", r.json?.status === "sent", { st: r.json?.status });

      // the remaining balance gets a final credit note; the invoice is then fully credited and still cannot be voided
      r = await api("POST", `/api/companies/${c.cid}/invoices/${inv.id}/credit-note`, { token: c.token, body: {} });
      ok("I1: final credit note for the remaining balance issued", r.status === 201, { s: r.status, m: r.json?.message });
      r = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: c.token, body: { status: "void" } });
      ok("I1: a fully credited invoice cannot be voided either", r.status === 409 && r.json?.code === "INVOICE_HAS_CREDIT_NOTES", { s: r.status, j: r.json });
      const fully = await c.balances();
      ok("I1: fully credited books land on 0.00", close(fully[AR], 0) && close(fully[REV], 0) && close(fully[VAT], 0), fully);
      ok("I1: the earlier credit note is untouched", cn?.id !== undefined, cn);
    }

    // ───────── Item 2: quote -> invoice keeps currency and takes a dated rate ─────────
    {
      const c = await freshCompany("i2");
      const rate = 3.6725;
      // The company enters "1 USD = 3.6725 AED" (rates are per company; direction is from -> to).
      let r = await api("POST", `/api/companies/${c.cid}/exchange-rates`, { token: c.token, body: { fromCurrency: "USD", toCurrency: "AED", rate, effectiveDate: today } });
      ok("I2: USD->AED rate recorded", r.status === 201, { s: r.status, j: r.json });
      r = await api("POST", `/api/companies/${c.cid}/quotes`, { token: c.token, body: { customerName: "USD Customer", date: today, currency: "USD", lines: [{ description: "consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] } });
      ok("I2: USD quote created", r.status === 200 || r.status === 201, { s: r.status, j: r.json });
      const quote = r.json;
      r = await api("POST", `/api/quotes/${quote.id}/convert-to-invoice`, { token: c.token });
      ok("I2: conversion succeeds", r.status === 200, { s: r.status, j: r.json });
      const inv = r.json?.invoice;
      ok("I2: converted invoice is USD", inv?.currency === "USD", { cur: inv?.currency });
      ok("I2: converted invoice has a positive rate (the dated one)", n(inv?.exchangeRate) > 0 && close(inv?.exchangeRate, rate, 0.00001), { rate: inv?.exchangeRate });
      ok("I2: AED total is computed from that rate", close(inv?.baseCurrencyAmount, Math.round(1050 * rate * 100) / 100) && close(inv?.total, 1050), { base: inv?.baseCurrencyAmount, total: inv?.total });

      // no rate at all for the currency -> refused, quote stays convertible
      r = await api("POST", `/api/companies/${c.cid}/quotes`, { token: c.token, body: { customerName: "No Rate", date: today, currency: "QQZ", lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
      const q2 = r.json;
      r = await api("POST", `/api/quotes/${q2?.id}/convert-to-invoice`, { token: c.token });
      ok("I2: a currency with no stored rate is refused (422 NO_EXCHANGE_RATE)", r.status === 422 && r.json?.code === "NO_EXCHANGE_RATE", { s: r.status, j: r.json });
      r = await api("GET", `/api/quotes/${q2?.id}`, { token: c.token });
      ok("I2: the refused quote is not marked converted", r.json?.status !== "converted", { st: r.json?.status });

      // AED quote is unaffected
      r = await api("POST", `/api/companies/${c.cid}/quotes`, { token: c.token, body: { customerName: "AED", date: today, lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
      r = await api("POST", `/api/quotes/${r.json?.id}/convert-to-invoice`, { token: c.token });
      ok("I2: AED quote converts to an AED invoice at rate 1", r.status === 200 && r.json?.invoice?.currency === "AED" && close(r.json?.invoice?.exchangeRate, 1), { s: r.status, inv: r.json?.invoice });
    }

    // ───────── Item 3: AI bank reconciliation honours the settlement date guard ─────────
    {
      const c = await freshCompany("i3");
      // Inserted directly: the create route needs a Date object, not the ISO string HTTP carries.
      const mkTxn = async (date) => ({
        json: (await db.query(
          "INSERT INTO bank_transactions (company_id, transaction_date, description, amount) VALUES ($1, $2, $3, 100) RETURNING id",
          [c.cid, date, "AI recon " + date]
        )).rows[0],
      });
      let r = await mkTxn(ymd(30));
      const future = r.json;
      ok("I3: future-dated bank transaction created", !!future?.id, future);
      const inv = (await c.mk({ lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] })).json;
      r = await api("POST", `/api/bank-transactions/${future?.id}/reconcile`, { token: c.token, body: { matchId: inv.id, matchType: "invoice" } });
      ok("I3: a future bank date is refused (422)", r.status === 422 && /future/i.test(r.json?.message ?? ""), { s: r.status, j: r.json });
      r = await api("GET", `/api/companies/${c.cid}/bank-transactions`, { token: c.token });
      ok("I3: the refused transaction stays unreconciled", (r.json ?? []).find((t) => t.id === future?.id)?.isReconciled === false, r.json?.find?.((t) => t.id === future?.id));

      r = await api("POST", `/api/companies/${c.cid}/month-end/lock-period`, { token: c.token, body: { periodEnd: "2020-06-30" } });
      ok("I3: June 2020 locked", r.status === 200 || r.status === 201, { s: r.status, j: r.json });
      r = await mkTxn("2020-06-15");
      const locked = r.json;
      r = await api("POST", `/api/bank-transactions/${locked?.id}/reconcile`, { token: c.token, body: { matchId: inv.id, matchType: "invoice" } });
      ok("I3: a bank date inside a locked period is refused (403)", r.status === 403, { s: r.status, j: r.json });

      r = await mkTxn(ymd(-1));
      r = await api("POST", `/api/bank-transactions/${r.json?.id}/reconcile`, { token: c.token, body: { matchId: inv.id, matchType: "invoice" } });
      ok("I3: an ordinary past bank date still reconciles", r.status === 200 && r.json?.isReconciled === true, { s: r.status, j: r.json });
    }

    // ───────── Item 4: payroll allowances are strictly parsed ─────────
    {
      const c = await freshCompany("i4");
      const emp = (body) => api("POST", `/api/companies/${c.cid}/employees`, { token: c.token, body: { fullName: "Allow " + rnd, basicSalary: 4000, ...body } });
      let r = await emp({ housingAllowance: "5,000" });
      ok("I4: create housingAllowance \"5,000\" -> 400 naming the field", r.status === 400 && r.json?.field === "housingAllowance" && /housingAllowance/.test(r.json?.message ?? ""), { s: r.status, j: r.json });
      r = await emp({ transportAllowance: "abc" });
      ok("I4: create transportAllowance \"abc\" -> 400", r.status === 400 && r.json?.field === "transportAllowance", { s: r.status, j: r.json });
      r = await emp({ otherAllowance: -5 });
      ok("I4: create negative otherAllowance -> 400", r.status === 400 && r.json?.field === "otherAllowance", { s: r.status, j: r.json });
      r = await emp({ basicSalary: "0x10" });
      ok("I4: create basicSalary \"0x10\" -> 400", r.status === 400, { s: r.status, j: r.json });
      r = await emp({ housingAllowance: "1500", transportAllowance: 200 });
      ok("I4: strict numeric allowances are accepted", r.status === 201, { s: r.status, j: r.json });
      const id = r.json?.id;
      ok("I4: totals use the parsed numbers (4000+1500+200+0)", close(r.json?.total_salary, 5700) && close(r.json?.other_allowance, 0), r.json);
      r = await emp({});
      ok("I4: omitted allowances default to 0", r.status === 201 && close(r.json?.housing_allowance, 0) && close(r.json?.total_salary, 4000), { s: r.status, j: r.json });

      r = await api("PATCH", `/api/employees/${id}`, { token: c.token, body: { housingAllowance: "5,000" } });
      ok("I4: update housingAllowance \"5,000\" -> 400 naming the field", r.status === 400 && r.json?.field === "housingAllowance", { s: r.status, j: r.json });
      r = await api("PATCH", `/api/employees/${id}`, { token: c.token, body: { otherAllowance: "-1" } });
      ok("I4: update negative allowance -> 400", r.status === 400 && r.json?.field === "otherAllowance", { s: r.status, j: r.json });
      let row = (await db.query("SELECT housing_allowance, total_salary FROM employees WHERE id = $1", [id])).rows[0];
      ok("I4: rejected updates changed nothing", close(row.housing_allowance, 1500) && close(row.total_salary, 5700), row);
      r = await api("PATCH", `/api/employees/${id}`, { token: c.token, body: { housingAllowance: "", otherAllowance: "300.50" } });
      row = (await db.query("SELECT housing_allowance, other_allowance, total_salary FROM employees WHERE id = $1", [id])).rows[0];
      ok("I4: blank leaves the field unchanged; a strict string is stored parsed", r.status === 200 && close(row.housing_allowance, 1500) && close(row.other_allowance, 300.5) && close(row.total_salary, 6000.5), { s: r.status, row });
    }

    // ───────── Item 7: legacy taxed-but-exempt lines still reach the standard-rated box ─────────
    {
      const c = await freshCompany("i7");
      const now = new Date();
      const pStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
      const pEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
      const midPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString().slice(0, 10);
      let r = await c.mk({ date: midPrev, lines: [{ description: "legacy", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
      const inv = r.json;
      await c.issue(inv.id);
      // Simulate a row saved before the rate decided the type.
      const upd = await db.query("UPDATE invoice_lines SET vat_supply_type = 'exempt' WHERE invoice_id = $1", [inv.id]);
      ok("I7: line rewritten as exempt @5% (legacy shape)", upd.rowCount === 1, { rows: upd.rowCount });

      r = await api("POST", `/api/companies/${c.cid}/vat-returns/generate`, { token: c.token, body: { periodStart: pStart, periodEnd: pEnd } });
      ok("I7: VAT 201 generates", r.status === 200 || r.status === 201, { s: r.status, m: r.json?.message });
      ok("I7: legacy line shows 1000 / 50 in the standard-rated box", close(r.json?.box1bDubaiAmount, 1000) && close(r.json?.box1bDubaiVat, 50), { amt: r.json?.box1bDubaiAmount, vat: r.json?.box1bDubaiVat });
      ok("I7: and nothing in the exempt box", close(r.json?.box5ExemptAmount ?? 0, 0), { exempt: r.json?.box5ExemptAmount });

      r = await api("GET", `/api/vat/autopilot/calculate/${c.cid}?periodStart=${pStart}&periodEnd=${pEnd}&frequency=monthly`, { token: c.token });
      const boxes = r.json?.boxes;
      ok("I7: autopilot agrees (1000 / 50, exempt 0)", r.status === 200 && close(boxes?.standardRatedSales, 1000) && close(boxes?.standardRatedVat, 50) && close(boxes?.exemptSales, 0), { s: r.status, body: JSON.stringify(r.json).slice(0, 400) });
    }
  } finally {
    await db.end().catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(fails.join("\n")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
