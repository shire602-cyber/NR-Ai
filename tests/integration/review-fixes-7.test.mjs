// Integration tests for the seventh round of review fixes (live requests against a running server + Postgres):
//   B1  FX report / revaluation as of a past date includes documents paid LATER
//   B3  a credited invoice cannot be moved by hand (only the credit-note void reopens it)
//   B4  recurring run: failing/skipped templates at the head do not starve the rest; none deactivated
//   B5  draft / void / cancelled invoices report outstandingAmount 0
//   BASE_URL=http://127.0.0.1:5056 DATABASE_URL=... node tests/integration/review-fixes-7.test.mjs

import pg from "pg";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, p, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const today = ymd(0);
const n = (v) => Number(v ?? 0);
const close = (a, b, t = 0.005) => Math.abs(n(a) - n(b)) <= t;
const here = path.dirname(fileURLToPath(import.meta.url));

async function freshCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  const bank = accounts.find((a) => a.code === "1020");
  const mk = (extra) => api("POST", `/api/companies/${cid}/invoices`, {
    token,
    body: { customerName: "Seven Co", date: ymd(-45), dueDate: ymd(-15), lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }], ...extra },
  });
  const setStatus = (id, status, extra = {}) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status, ...extra } });
  const issue = (id) => setStatus(id, "sent");
  const get = async (id) => (await api("GET", `/api/invoices/${id}`, { token })).json;
  const list = async () => (await api("GET", `/api/companies/${cid}/invoices`, { token })).json ?? [];
  const creditNote = (invId, body = {}) => api("POST", `/api/companies/${cid}/invoices/${invId}/credit-note`, { token, body });
  const pay = (invId, amount, extra = {}) => api("POST", `/api/companies/${cid}/invoices/${invId}/payments`, { token, body: { amount, date: today, method: "cash", paymentAccountId: bank.id, ...extra } });
  const addRate = (body) => api("POST", `/api/companies/${cid}/exchange-rates`, { token, body });
  const fxReport = async (asOf) => (await api("GET", `/api/companies/${cid}/reports/fx-gains-losses${asOf ? `?asOf=${asOf}` : ""}`, { token })).json;
  const revalue = (asOf) => api("POST", `/api/companies/${cid}/exchange-rates/revalue`, { token, body: { asOf } });
  return { token, cid, bank, mk, setStatus, issue, get, list, creditNote, pay, addRate, fxReport, revalue };
}

async function main() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    // ───────── B1: FX as of a past date includes documents paid later ─────────
    {
      const c = await freshCompany("b1");
      await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: ymd(-60) });
      let r = await c.mk({ currency: "USD", date: ymd(-30), dueDate: ymd(30), lines: [{ description: "consulting", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
      const inv = r.json;
      await c.issue(inv.id);
      await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.70, effectiveDate: ymd(-20) });
      const asOf = ymd(-10);
      // paid in full AFTER the as-of date
      r = await c.pay(inv.id, 105, { exchangeRate: 3.6725, date: ymd(-3) });
      ok("B1: full payment dated after the as-of date accepted", r.status === 201, { s: r.status, j: r.json });
      ok("B1: the invoice is paid today", (await c.get(inv.id))?.status === "paid", (await c.get(inv.id))?.status);

      const past = await c.fxReport(asOf);
      ok("B1: report as of the earlier date lists the invoice (open then)", past?.receivables?.length === 1 && past.receivables[0].entityId === inv.id, past);
      ok("B1: it is revalued on the full 105 USD: 105 x (3.70 - 3.6725) = 2.89", close(past?.receivables?.[0]?.foreignAmount, 105) && close(past?.receivables?.[0]?.unrealizedGainLoss, 2.89), past?.receivables?.[0]);
      const after = await c.fxReport(ymd(-2));
      ok("B1: report as of a date after the payment does not list it", (after?.receivables ?? []).length === 0, after?.receivables);
      const nowRep = await c.fxReport();
      ok("B1: report as of today does not list it", (nowRep?.receivables ?? []).length === 0, nowRep?.receivables);

      r = await c.revalue(asOf);
      ok("B1: revaluation as of the earlier date posts the 2.89 gain", r.status === 201 && r.json?.posted === true && close(r.json?.netGainLoss, 2.89), { s: r.status, j: r.json });
      r = await c.revalue(ymd(-2));
      ok("B1: revaluation as of a date after the payment posts nothing", r.status === 200 && r.json?.posted === false, { s: r.status, j: r.json });

      // a later credit note does not reduce the balance as of the earlier date either
      const c2 = await freshCompany("b1c");
      await c2.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: ymd(-60) });
      r = await c2.mk({ currency: "USD", date: ymd(-30), dueDate: ymd(30), lines: [{ description: "consulting", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
      await c2.issue(r.json.id);
      await c2.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.70, effectiveDate: ymd(-20) });
      r = await c2.creditNote(r.json.id);
      ok("B1: full credit note issued today", r.status === 201, { s: r.status, j: r.json });
      const pastCn = await c2.fxReport(ymd(-10));
      ok("B1: as of before the credit note the invoice is still revalued in full", close(pastCn?.receivables?.[0]?.foreignAmount, 105), pastCn?.receivables);
      const nowCn = await c2.fxReport();
      ok("B1: as of today the credited invoice is not listed", (nowCn?.receivables ?? []).length === 0, nowCn?.receivables);

      // bills: approved bill paid after the as-of date
      const c3 = await freshCompany("b1b");
      await c3.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: ymd(-60) });
      await c3.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.70, effectiveDate: ymd(-20) });
      const bill = (await db.query(
        `INSERT INTO vendor_bills (company_id, vendor_name, bill_number, bill_date, currency, exchange_rate, subtotal, vat_amount, total_amount, amount_paid, status)
         VALUES ($1, 'Vendor USD', 'B-7', $2, 'USD', 3.6725, 200, 0, 200, 200, 'paid') RETURNING id`, [c3.cid, ymd(-30)])).rows[0];
      await db.query(`INSERT INTO bill_payments (bill_id, payment_date, amount) VALUES ($1, $2, 200)`, [bill.id, ymd(-3)]);
      const billPast = await c3.fxReport(ymd(-10));
      ok("B1: a bill paid after the as-of date is a payable as of that date (200 USD)", billPast?.payables?.length === 1 && close(billPast.payables[0].foreignAmount, 200), billPast?.payables);
      const billNow = await c3.fxReport();
      ok("B1: the fully paid bill is not a payable today", (billNow?.payables ?? []).length === 0, billNow?.payables);
    }

    // ───────── B3: a credited invoice cannot be set back by hand ─────────
    {
      const c = await freshCompany("b3");
      let r = await c.mk();
      const inv = r.json;
      await c.issue(inv.id);
      r = await c.creditNote(inv.id);
      const cn = r.json;
      ok("B3: full credit note issued, invoice is credited", r.status === 201 && (await c.get(inv.id))?.status === "credited", { s: r.status });
      for (const target of ["sent", "posted", "partial", "paid", "draft", "cancelled"]) {
        r = await c.setStatus(inv.id, target, { paymentAccountId: c.bank.id });
        // "paid" and "partial" are derived from payments and refused earlier (400 STATUS_DERIVED,
        // Phase 9); every other manual status on a credited invoice is 422 INVOICE_CREDITED_LOCKED.
        const derived = target === "paid" || target === "partial";
        const refused = derived
          ? r.status === 400 && r.json?.code === "STATUS_DERIVED"
          : r.status === 422 && r.json?.code === "INVOICE_CREDITED_LOCKED";
        ok(`B3: manual credited -> ${target} is refused (${derived ? "400 STATUS_DERIVED" : "422 INVOICE_CREDITED_LOCKED"})`, refused, { s: r.status, j: r.json });
      }
      ok("B3: the invoice is still credited", (await c.get(inv.id))?.status === "credited", (await c.get(inv.id))?.status);
      r = await c.setStatus(cn.id, "void");
      const reopened = await c.get(inv.id);
      ok("B3: voiding the credit note still reopens it (internal sync)", r.status === 200 && reopened?.status === "sent", { s: r.status, st: reopened?.status });
    }

    // ───────── B4: a run with skipped templates at the head still generates the rest ─────────
    {
      const c = await freshCompany("b4");
      const tpl = (currency, name, days) => api("POST", `/api/companies/${c.cid}/recurring-invoices`, {
        token: c.token,
        body: { customerName: name, currency, frequency: "monthly", startDate: ymd(days), nextRunDate: ymd(days), lines: [{ description: "retainer", quantity: 1, unitPrice: 100, vatRate: 0.05 }] },
      });
      // four USD/CHF/EUR/GBP templates with no exchange rate come first (older due date), then two healthy AED ones
      const noRate = [];
      for (const [i, cur] of ["CHF", "JPY", "EUR", "GBP"].entries()) noRate.push((await tpl(cur, `No Rate ${cur}`, -10 - i)).json);
      const healthy = [(await tpl("AED", "Home A", -1)).json, (await tpl("AED", "Home B", -1)).json];
      ok("B4: six templates created", [...noRate, ...healthy].every((t) => t?.id), { noRate, healthy });
      const env = { ...process.env, SESSION_SECRET: crypto.randomBytes(24).toString("hex"), JWT_SECRET: crypto.randomBytes(24).toString("hex"), NODE_ENV: "development", LOG_LEVEL: "error" };
      const run = spawnSync("npx", ["tsx", path.join(here, "helpers", "run-recurring.ts"), c.cid], { env, encoding: "utf8", cwd: path.join(here, "..", "..") });
      ok("B4: the generator ran", run.status === 0 && /RESULT/.test(run.stdout), { status: run.status, err: run.stderr?.slice(-400) });
      const invs = (await db.query("SELECT currency FROM invoices WHERE company_id = $1", [c.cid])).rows;
      ok("B4: both healthy templates generated behind four skipped ones", invs.filter((i) => i.currency === "AED").length === 2, invs);
      const active = (await db.query("SELECT count(*)::int AS c FROM recurring_invoices WHERE company_id = $1 AND is_active = true", [c.cid])).rows[0].c;
      ok("B4: no template was deactivated", active === 6, active);
    }

    // ───────── B5: nothing is outstanding on a draft / void / cancelled invoice ─────────
    {
      const c = await freshCompany("b5");
      const draft = (await c.mk()).json;
      ok("B5: draft detail reports outstandingAmount 0", close((await c.get(draft.id))?.outstandingAmount, 0), (await c.get(draft.id))?.outstandingAmount);
      const listed = (await c.list()).find((x) => x.id === draft.id);
      ok("B5: draft in the list reports outstandingAmount 0", listed && close(listed.outstandingAmount, 0), listed?.outstandingAmount);
      const issued = (await c.mk()).json;
      await c.issue(issued.id);
      ok("B5: an issued invoice reports its real outstanding 1050", close((await c.get(issued.id))?.outstandingAmount, 1050), (await c.get(issued.id))?.outstandingAmount);
      let r = await c.setStatus(draft.id, "cancelled");
      ok("B5: draft cancelled", r.status === 200, { s: r.status, j: r.json });
      ok("B5: cancelled invoice reports 0", close((await c.get(draft.id))?.outstandingAmount, 0), (await c.get(draft.id))?.outstandingAmount);
      r = await c.setStatus(issued.id, "void");
      ok("B5: issued invoice voided", r.status === 200, { s: r.status, j: r.json });
      const v = await c.get(issued.id);
      ok("B5: void invoice reports 0", v?.status === "void" && close(v?.outstandingAmount, 0), { st: v?.status, o: v?.outstandingAmount });
      const vl = (await c.list()).find((x) => x.id === issued.id);
      ok("B5: void invoice in the list reports 0", vl && close(vl.outstandingAmount, 0), vl?.outstandingAmount);
    }
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.map((f) => " - " + f).join("\n")); process.exit(1); }
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
