// Integration tests for Phase 6 stream A: vendor credit notes (supplier credits).
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5061 DATABASE_URL=... node tests/integration/phase6-vendor-credits.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:5000";
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
  const res = await fetch(BASE + p, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevStart = prevEnd.slice(0, 8) + "01";
const prevMid = prevEnd.slice(0, 8) + "15";

let db;

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = Math.round(n(row.net) * 100) / 100;
    return out;
  };
  const bill = async (date, unitPrice, extra = {}) => {
    const r1 = await api("POST", `/api/companies/${cid}/bills`, {
      token, body: { vendor_name: "Acme Supplies", bill_date: date, due_date: date, currency: "AED", line_items: [{ description: "Goods", quantity: 1, unit_price: unitPrice, vat_rate: 5 }], ...extra },
    });
    if (!r1.json?.id) throw new Error("bill failed " + r1.status + " " + r1.text.slice(0, 200));
    const r2 = await api("POST", `/api/bills/${r1.json.id}/approve`, { token, body: {} });
    if (![200, 201].includes(r2.status)) throw new Error("bill approve failed " + r2.status + " " + r2.text.slice(0, 200));
    return r1.json.id;
  };
  const credit = (body) => api("POST", `/api/companies/${cid}/vendor-credits`, { token, body });
  const approve = (id) => api("POST", `/api/companies/${cid}/vendor-credits/${id}/approve`, { token, body: {} });
  const apply = (id, billId, amount) => api("POST", `/api/companies/${cid}/vendor-credits/${id}/apply`, { token, body: { bill_id: billId, amount } });
  const voidIt = (id) => api("POST", `/api/companies/${cid}/vendor-credits/${id}/void`, { token, body: {} });
  const get = (id) => api("GET", `/api/companies/${cid}/vendor-credits/${id}`, { token });
  const getBill = async (id) => (await api("GET", `/api/bills/${id}`, { token })).json;
  const journal = async (creditId) => (await db.query(
    `SELECT je.id, je.source, je.status, je.reversed_entry_id, a.code, jl.debit, jl.credit
       FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'vendor_credit_note' AND je.source_id = $2
      ORDER BY je.created_at, a.code`, [cid, creditId])).rows;
  return { token, cid, balances, bill, credit, approve, apply, voidIt, get, getBill, journal };
}

const line = (unit_price, extra = {}) => ({ description: "Returned goods", quantity: 1, unit_price, vat_rate: 5, ...extra });

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await mainFlow();
    await lockedPeriod();
    await reverseCharge();
    await validation();
    await fxRevaluationCountsCredits();
    await creditAtDifferentRate();
    await billEditGuard();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

async function mainFlow() {
  const A = await newCompany("vcnA");
  const billId = await A.bill(prevMid, 1000); // total 1050 (VAT 50)
  const before = await A.balances();
  ok("bill approval put 1,050 on A/P (2010) and 50 on input VAT (1050)", close(before["2010"], -1050) && close(before["1050"], 50), before);

  // create (draft)
  let r = await A.credit({ bill_id: billId, date: prevMid, line_items: [line(200)] });
  ok("create: 201 draft with VCN- number and totals 200 + 10 = 210", r.status === 201 && r.json?.status === "draft" && /^VCN-\d{4}$/.test(r.json?.number) && close(r.json?.total, 210) && close(r.json?.vat_amount, 10), { s: r.status, j: r.json });
  const creditId = r.json?.id;
  ok("create: inherited vendor, currency and reverse-charge flag from the bill", r.json?.vendor_name === "Acme Supplies" && r.json?.currency === "AED" && r.json?.reverse_charge === false, r.json);
  ok("create: a draft posts nothing to the ledger", (await A.journal(creditId)).length === 0 && close((await A.balances())["2010"], -1050), await A.balances());

  const r2 = await A.credit({ bill_id: billId, date: prevMid, line_items: [line(10)] });
  ok("numbering: the second credit is the next number in the sequence", r2.status === 201 && r2.json?.number !== r.json?.number && /^VCN-0002$/.test(r2.json?.number), r2.json?.number);

  // update draft
  r = await api("PATCH", `/api/companies/${A.cid}/vendor-credits/${r2.json.id}`, { token: A.token, body: { line_items: [line(40), line(60, { vat_rate: 0 })] } });
  ok("update draft: lines replaced and totals recomputed (100 net, 2 VAT, 102 total)", r.status === 200 && close(r.json?.subtotal, 100) && close(r.json?.vat_amount, 2) && close(r.json?.total, 102) && r.json?.lines?.length === 2, { s: r.status, j: r.json });
  r = await A.voidIt(r2.json.id);
  ok("void a draft: status void, no journal", r.status === 200 && r.json?.status === "void" && (await A.journal(r2.json.id)).length === 0, { s: r.status, j: r.json?.status });

  // approve
  r = await A.approve(creditId);
  ok("approve: status approved with remaining = total", r.status === 200 && r.json?.status === "approved" && close(r.json?.remaining_amount, 210) && !!r.json?.journal_entry_id, { s: r.status, j: r.json });
  const jl = await A.journal(creditId);
  const get = (code) => jl.find((x) => x.code === code);
  ok("journal: Dr A/P 2010 210, Cr input VAT 1050 10, Cr expense 5000 200",
    close(get("2010")?.debit, 210) && close(get("1050")?.credit, 10) && close(get("5000")?.credit, 200) && jl.length === 3, jl);
  ok("journal: balanced, posted, system source", close(jl.reduce((s, x) => s + n(x.debit), 0), jl.reduce((s, x) => s + n(x.credit), 0)) && jl.every((x) => x.status === "posted" && x.source === "vendor_credit_note"), jl);
  const after = await A.balances();
  ok("A/P balance reduced by the credit (1,050 -> 840) and input VAT by 10", close(after["2010"], -840) && close(after["1050"], 40), after);

  // the generic journal routes refuse to touch the system entry
  r = await api("POST", `/api/journal/${jl[0].id}/reverse`, { token: A.token, body: { reason: "try" } });
  ok("the credit's journal cannot be reversed from the journal screen (409 SYSTEM_ENTRY_NOT_REVERSIBLE)", r.status === 409 && r.json?.code === "SYSTEM_ENTRY_NOT_REVERSIBLE", { s: r.status, j: r.json });

  r = await A.approve(creditId);
  ok("approve twice: refused (409), no second journal", r.status === 409 && (await A.journal(creditId)).length === 3, { s: r.status, j: r.json });

  // VAT return: Box 9 drops by the credit's net and VAT
  const gen = await api("POST", `/api/companies/${A.cid}/vat-returns/generate`, { token: A.token, body: { periodStart: prevStart, periodEnd: prevEnd } });
  ok("VAT return Box 9: expenses 1,000 - 200 = 800 and input VAT 50 - 10 = 40", gen.status === 201 && close(gen.json?.box9ExpensesAmount, 800) && close(gen.json?.box9ExpensesVat, 40), { s: gen.status, a: gen.json?.box9ExpensesAmount, v: gen.json?.box9ExpensesVat });

  // FTA Audit File purchases block carries the credit as a negative line and still ties to Box 9
  const faf = await fetch(`${BASE}/api/companies/${A.cid}/reports/fta-audit-file?from=${prevStart}&to=${prevEnd}`, { headers: { Authorization: "Bearer " + A.token } });
  const fafLines = (await faf.text()).split(/\r?\n/);
  const pStart = fafLines.indexOf("PurcDataStart"), pEnd = fafLines.indexOf("PurcDataEnd");
  const purchaseBody = fafLines.slice(pStart + 1, pEnd).filter(Boolean);
  const footer = (purchaseBody[purchaseBody.length - 1] || "").split(",");
  ok("FAF purchases: footer ties to Box 9 (800 / 40) and lists the credit as a negative line",
    faf.status === 200 && close(footer[0], 800, 0.02) && close(footer[1], 40, 0.02) && purchaseBody.some((l) => l.includes(",-200.00,") || l.includes(",-200,")),
    { s: faf.status, footer, body: purchaseBody.slice(0, 5) });

  // apply
  r = await A.apply(creditId, billId, 100);
  ok("apply 100: bill 1,050 -> due 950 (partial), credit remaining 110", r.status === 200 && close(r.json?.bill_due, 950) && r.json?.bill_status === "partial" && close(r.json?.credit_remaining, 110), { s: r.status, j: r.json });
  const bill = await A.getBill(billId);
  ok("apply: the bill shows amount_paid 100 and status partial", close(bill?.amount_paid, 100) && bill?.status === "partial", { p: bill?.amount_paid, s: bill?.status });
  r = await A.apply(creditId, billId, 500);
  ok("over-apply (500 > credit remaining 110): 422 OVER_APPLIED", r.status === 422 && r.json?.code === "OVER_APPLIED", { s: r.status, j: r.json });
  r = await A.apply(creditId, billId, 0);
  ok("apply 0: refused (400/422)", [400, 422].includes(r.status), { s: r.status });

  // the payment guard counts the applied credit
  r = await api("POST", `/api/bills/${billId}/payments`, { token: A.token, body: { amount: 951 } });
  ok("payment guard: paying 951 of a 950 balance (after the credit) is refused", r.status === 400, { s: r.status, j: r.json });

  r = await A.voidIt(creditId);
  ok("void with an application: 409 HAS_APPLICATIONS, still approved", r.status === 409 && r.json?.code === "HAS_APPLICATIONS" && (await A.get(creditId)).json?.status === "approved", { s: r.status, j: r.json });

  r = await api("DELETE", `/api/bills/${billId}`, { token: A.token });
  ok("a bill with an applied credit cannot be deleted (409)", r.status === 409, { s: r.status, j: r.json });

  // apply the rest, bill due 840, then pay it off with cash
  r = await A.apply(creditId, billId, 110);
  ok("apply the remaining 110: credit fully used", r.status === 200 && close(r.json?.credit_remaining, 0), r.json);
  r = await A.apply(creditId, billId, 1);
  ok("apply from a fully used credit: 422", r.status === 422, { s: r.status, j: r.json });
  r = await api("POST", `/api/bills/${billId}/payments`, { token: A.token, body: { amount: 840 } });
  ok("payment of the exact remaining 840 settles the bill (paid)", r.status === 200 && r.json?.bill_status === "paid", { s: r.status, j: r.json });

  // void an approved, unapplied credit reverses the journal
  const c3 = await A.credit({ vendor_name: "Acme Supplies", date: prevMid, line_items: [line(300)] });
  await A.approve(c3.json.id);
  const mid = await A.balances();
  r = await A.voidIt(c3.json.id);
  const j3 = await A.journal(c3.json.id);
  const end = await A.balances();
  ok("void an unapplied credit: status void and the A/P effect is reversed", r.status === 200 && r.json?.status === "void" && close(end["2010"], mid["2010"] - 315) && j3.length === 6, { s: r.status, mid: mid["2010"], end: end["2010"], n: j3.length });

  // cross-vendor / pending-bill / wrong company
  const otherBill = await A.bill(prevMid, 100, { vendor_name: "Other Vendor" });
  const c4 = await A.credit({ vendor_name: "Acme Supplies", date: prevMid, line_items: [line(50)] });
  await A.approve(c4.json.id);
  r = await A.apply(c4.json.id, otherBill, 10);
  ok("apply to another vendor's bill: 422 VENDOR_MISMATCH", r.status === 422 && r.json?.code === "VENDOR_MISMATCH", { s: r.status, j: r.json });
  const B = await newCompany("vcnB");
  r = await api("GET", `/api/companies/${A.cid}/vendor-credits`, { token: B.token });
  ok("another company's user cannot list this company's credits (403)", r.status === 403, { s: r.status });
  r = await api("GET", `/api/companies/${A.cid}/vendor-credits?status=approved`, { token: A.token });
  ok("list: filters by status", r.status === 200 && Array.isArray(r.json) && r.json.length >= 1 && r.json.every((x) => x.status === "approved"), { s: r.status, n: r.json?.length });
  r = await api("GET", `/api/companies/${B.cid}/vendor-credits/${c4.json.id}`, { token: B.token });
  ok("another company cannot read the credit by id (404)", r.status === 404, { s: r.status });
}

async function lockedPeriod() {
  const L = await newCompany("vcnL");
  const billId = await L.bill(prevMid, 500);
  const c = await L.credit({ bill_id: billId, date: prevMid, line_items: [line(100)] });
  ok("locked period: the draft can be created while the month is open", c.status === 201, { s: c.status });
  let r = await api("POST", `/api/companies/${L.cid}/month-end/lock-period`, { token: L.token, body: { periodEnd: prevEnd, overrideVatCheck: true, overrideReason: "Test lock without a VAT return" } });
  ok("locked period: month locked", r.status === 200, { s: r.status, j: r.json });
  r = await L.approve(c.json.id);
  ok("approval dated in a locked month is refused (403 period locked)", r.status === 403 && (await L.journal(c.json.id)).length === 0 && (await L.get(c.json.id)).json?.status === "draft", { s: r.status, j: r.json });
  r = await L.credit({ bill_id: billId, date: prevMid, line_items: [line(5)] });
  ok("a new credit dated in a locked month cannot even be drafted (403)", r.status === 403, { s: r.status });
}

async function reverseCharge() {
  const R = await newCompany("vcnR");
  const billId = await R.bill(prevMid, 400, { reverse_charge: true, vendor_trn: null });
  const bj = await R.balances();
  ok("RC bill: A/P owes the net 400, output VAT 20 credited, input VAT 20 debited", close(bj["2010"], -400) && close(bj["2020"], -20) && close(bj["1050"], 20), bj);
  let r = await R.credit({ bill_id: billId, date: prevMid, line_items: [line(100)] });
  ok("RC credit inherits reverse_charge; total is the net only (100)", r.status === 201 && r.json?.reverse_charge === true && close(r.json?.total, 100) && close(r.json?.vat_amount, 5), r.json);
  const id = r.json?.id;
  await R.approve(id);
  const jl = await R.journal(id);
  const g = (code) => jl.find((x) => x.code === code);
  ok("RC journal mirrors the bill in reverse: Dr A/P 100, Dr output VAT 5, Cr input VAT 5, Cr expense 100",
    close(g("2010")?.debit, 100) && close(g("2020")?.debit, 5) && close(g("1050")?.credit, 5) && close(g("5000")?.credit, 100), jl);
  const nonRc = await R.bill(prevMid, 100, { vendor_name: "Acme Supplies" });
  r = await R.apply(id, nonRc, 10);
  ok("applying an RC credit to a non-RC bill is refused (422)", r.status === 422 && r.json?.code === "TAX_TREATMENT_MISMATCH", { s: r.status, j: r.json });
  r = await R.apply(id, billId, 100);
  ok("RC credit applies in full to the RC bill (due 300)", r.status === 200 && close(r.json?.bill_due, 300), { s: r.status, j: r.json });
  const gen = await api("POST", `/api/companies/${R.cid}/vat-returns/generate`, { token: R.token, body: { periodStart: prevStart, periodEnd: prevEnd } });
  ok("RC credit lowers Box 3 reverse charge by its net and VAT (400/20 -> 300/15); the plain bill stays in Box 9",
    gen.status === 201 && close(gen.json?.box3ReverseChargeAmount, 300) && close(gen.json?.box3ReverseChargeVat, 15) && close(gen.json?.box9ExpensesAmount, 100) && close(gen.json?.box9ExpensesVat, 5),
    { s: gen.status, b3: gen.json?.box3ReverseChargeAmount, b3v: gen.json?.box3ReverseChargeVat, b9: gen.json?.box9ExpensesAmount, b9v: gen.json?.box9ExpensesVat });
}

// FX revaluation values a foreign bill on what is still OPEN: total - payments - applied credits.
async function fxRevaluationCountsCredits() {
  const F = await newCompany("vcnF");
  const rate = await api("POST", `/api/companies/${F.cid}/exchange-rates`, { token: F.token, body: { fromCurrency: "USD", toCurrency: "AED", rate: 3.70, effectiveDate: prevStart } });
  ok("fx: company rate USD->AED added", [200, 201].includes(rate.status), { s: rate.status, j: rate.json });
  const billId = await F.bill(prevMid, 1000, { currency: "USD", exchange_rate: 3.6725 }); // 1,050 USD with VAT
  const report = async () => (await api("GET", `/api/companies/${F.cid}/reports/fx-gains-losses`, { token: F.token })).json;
  const full = await report();
  ok("fx: the open USD bill is revalued on its full 1,050", close(full?.payables?.[0]?.foreignAmount, 1050), full?.payables);

  const c = await F.credit({ bill_id: billId, date: prevMid, line_items: [line(200)] });
  await F.approve(c.json?.id);
  const applied = await F.apply(c.json?.id, billId, 100);
  ok("fx: 100 USD of the credit applied to the bill", applied.status === 200 && close(applied.json?.bill_due, 950), { s: applied.status, j: applied.json });
  const afterCredit = await report();
  ok("fx: revalued open amount is total - credits (950 USD)", close(afterCredit?.payables?.[0]?.foreignAmount, 950), afterCredit?.payables);

  const paid = await api("POST", `/api/bills/${billId}/payments`, { token: F.token, body: { amount: 50 } });
  const afterPay = await report();
  ok("fx: revalued open amount is total - payments - credits (900 USD)", paid.status === 200 && close(afterPay?.payables?.[0]?.foreignAmount, 900), { s: paid.status, p: afterPay?.payables });
}

// A USD credit at another rate than its bill: the exchange difference is realised on apply.
async function creditAtDifferentRate() {
  const F = await newCompany("vcnFx");
  const billId = await F.bill(prevMid, 1000, { currency: "USD", exchange_rate: 3.6725, line_items: [line(1000, { vat_rate: 0 })] });
  const c = await F.credit({ vendor_name: "Acme Supplies", currency: "USD", exchange_rate: 3.70, date: prevMid, line_items: [line(1000, { vat_rate: 0 })] });
  ok("fx apply: unlinked USD credit at 3.70 created", c.status === 201, { s: c.status, j: c.json });
  await F.approve(c.json?.id);
  const before = await F.balances();
  ok("fx apply: before applying, the credit leaves 27.50 of A/P in debit (3,672.50 bill vs 3,700 credit)", close(before["2010"], 27.5), before);
  const applied = await F.apply(c.json?.id, billId, 1000);
  ok("fx apply: applied in full (200, bill paid)", applied.status === 200 && applied.json?.bill_status === "paid", { s: applied.status, j: applied.json });
  const bal = await F.balances();
  ok("fx apply: A/P (2010) ends at exactly 0.00", close(bal["2010"] ?? 0, 0, 0.0001), bal);
  ok("fx apply: realised FX loss (5140) of 27.50 posted", close(bal["5140"], 27.5, 0.0001) && !bal["4090"], bal);
  const reversed = await F.voidIt(c.json?.id);
  ok("fx apply: an applied credit still cannot be voided (409)", reversed.status === 409, { s: reversed.status });

  // the other direction: credit at a LOWER rate than the bill -> FX gain
  const G = await newCompany("vcnFx2");
  const b2 = await G.bill(prevMid, 1000, { currency: "USD", exchange_rate: 3.70, line_items: [line(1000, { vat_rate: 0 })] });
  const c2 = await G.credit({ vendor_name: "Acme Supplies", currency: "USD", exchange_rate: 3.6725, date: prevMid, line_items: [line(1000, { vat_rate: 0 })] });
  await G.approve(c2.json?.id);
  await G.apply(c2.json?.id, b2, 1000);
  const bal2 = await G.balances();
  ok("fx apply: credit at a lower rate -> A/P 0.00 and realised FX gain (4090) 27.50", close(bal2["2010"] ?? 0, 0, 0.0001) && close(bal2["4090"], -27.5, 0.0001), bal2);

  // a credit at the bill's own rate posts no exchange journal
  const H = await newCompany("vcnFx3");
  const b3 = await H.bill(prevMid, 1000, { currency: "USD", exchange_rate: 3.6725, line_items: [line(1000, { vat_rate: 0 })] });
  const c3 = await H.credit({ bill_id: b3, date: prevMid, line_items: [line(400, { vat_rate: 0 })] });
  await H.approve(c3.json?.id);
  await H.apply(c3.json?.id, b3, 400);
  const bal3 = await H.balances();
  ok("fx apply: same-rate credit posts no FX difference", !bal3["4090"] && !bal3["5140"], bal3);
}

// A bill that has been paid, credited or approved/settled can no longer be edited underneath its postings.
async function billEditGuard() {
  const E = await newCompany("vcnEdit");
  const billId = await E.bill(prevMid, 1000);
  const edit = (id) => api("PATCH", `/api/bills/${id}`, { token: E.token, body: { line_items: [{ description: "Changed", quantity: 1, unit_price: 100, vat_rate: 5 }], vendor_name: "Other Vendor" } });
  let r = await edit(billId);
  ok("bill edit: an approved bill is not editable (409 BILL_NOT_EDITABLE)", r.status === 409 && r.json?.code === "BILL_NOT_EDITABLE", { s: r.status, j: r.json });

  const c = await E.credit({ bill_id: billId, date: prevMid, line_items: [line(500)] });
  await E.approve(c.json?.id);
  await E.apply(c.json?.id, billId, 525);
  r = await edit(billId);
  ok("bill edit: a bill with an applied credit is not editable (409 BILL_NOT_EDITABLE)", r.status === 409 && r.json?.code === "BILL_NOT_EDITABLE", { s: r.status, j: r.json });
  const bal = await E.balances();
  ok("bill edit: A/P untouched by the refused edit (1,050 bill - 525 credit... still 525 owed)", close(bal["2010"], -525), bal);

  const p = await E.bill(prevMid, 200);
  await api("POST", `/api/bills/${p}/payments`, { token: E.token, body: { amount: 10 } });
  r = await edit(p);
  ok("bill edit: a bill with a payment is not editable (409 BILL_NOT_EDITABLE)", r.status === 409 && r.json?.code === "BILL_NOT_EDITABLE", { s: r.status, j: r.json });

  // a pending bill (never approved) stays editable
  const pend = await api("POST", `/api/companies/${E.cid}/bills`, { token: E.token, body: { vendor_name: "Acme Supplies", bill_date: prevMid, due_date: prevMid, currency: "AED", line_items: [line(100)] } });
  r = await edit(pend.json?.id);
  ok("bill edit: a pending bill can still be edited (200)", r.status === 200, { s: r.status, j: r.json });
}

async function validation() {
  const V = await newCompany("vcnV");
  let r = await V.credit({ vendor_name: "X", date: prevMid, line_items: [] });
  ok("validation: no lines -> 400", r.status === 400, { s: r.status });
  r = await V.credit({ date: prevMid, line_items: [line(10)] });
  ok("validation: no vendor and no bill -> 422", r.status === 422, { s: r.status, j: r.json });
  r = await V.credit({ vendor_name: "X", date: prevMid, line_items: [line(10, { vat_rate: 7 })] });
  ok("validation: VAT rate other than 0/5 -> 400", r.status === 400, { s: r.status });
  r = await V.credit({ vendor_name: "X", date: prevMid, line_items: [line(1e13)] });
  ok("validation: unit price over the column limit -> 400, not a 500", r.status === 400, { s: r.status });
  r = await V.credit({ vendor_name: "X", date: prevMid, line_items: [line(10, { quantity: 1e11 })] });
  ok("validation: quantity over the column limit -> 400, not a 500", r.status === 400, { s: r.status });
  r = await V.credit({ vendor_name: "X", date: prevMid, currency: "USD", line_items: [line(10)] });
  ok("validation: foreign currency without a rate -> 422 NO_EXCHANGE_RATE", r.status === 422 && r.json?.code === "NO_EXCHANGE_RATE", { s: r.status, j: r.json });
  r = await V.credit({ vendor_name: "X", date: prevMid, line_items: [line(10, { account_id: "00000000-0000-4000-8000-000000000000" })] });
  ok("validation: an account from another company -> 422", r.status === 422, { s: r.status, j: r.json });
  r = await V.credit({ vendor_name: "X", bill_id: "00000000-0000-4000-8000-000000000000", date: prevMid, line_items: [line(10)] });
  ok("validation: unknown bill -> 404", r.status === 404, { s: r.status, j: r.json });
  r = await V.apply("00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000001", 5);
  ok("apply: unknown credit -> 404", r.status === 404, { s: r.status });
  const d = await V.credit({ vendor_name: "Acme Supplies", date: prevMid, line_items: [line(10)] });
  const bill = await V.bill(prevMid, 100);
  r = await V.apply(d.json.id, bill, 5);
  ok("apply: a draft credit cannot be applied (409)", r.status === 409, { s: r.status, j: r.json });
}

main().catch((e) => { console.error(e); process.exit(1); });
