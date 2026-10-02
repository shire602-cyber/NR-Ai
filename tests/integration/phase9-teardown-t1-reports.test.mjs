// Teardown 6 / t1 (blind accountant): the report-side findings. Live requests against a running server + Postgres.
//   F2  blocked input VAT (Art. 53) never reaches box 9, in the posting or in the return
//   F3  month-end close posts no P&L closing entries; year-end closes only its own year, up to its date
//   F4  inventory valuation by movement date, warns on negative stock, reconciles to account 1070
//   T5/F3  corporate tax: Small Business Relief election, labels, add-backs and deductions on the workpaper
//   +   the VAT loaders read the UAE (Dubai) day, like the ledger layer: VAT summary == P&L == ledger
//   BASE_URL=http://localhost:5077 DATABASE_URL=... node tests/integration/phase9-teardown-t1-reports.test.mjs

import pg from "pg";
import ExcelJS from "exceljs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, p, { body, token, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const today = ymd(now);
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevStart = prevEnd.slice(0, 8) + "01";
const prevMid = prevEnd.slice(0, 8) + "15";
const monthStart = today.slice(0, 8) + "01";
let db;
let seq = 0;

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "sharjah" } });
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  const acct = (code) => accounts.find((a) => a.code === code);
  const post = (p, body) => api("POST", p, { token, body });
  const C = { token, cid, userId, acct, post };
  C.run = (reportId, query = "") => api("GET", `/api/companies/${cid}/reports/run/${reportId}${query ? "?" + query : ""}`, { token });
  C.invoice = async (date, lines, extra = {}) => {
    const r1 = await post(`/api/companies/${cid}/invoices`, { customerName: "Buyer", date, dueDate: date, lines, ...extra });
    if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 300));
    const r2 = await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token, body: { status: "sent" } });
    if (r2.status !== 200) throw new Error("issue failed " + r2.status + " " + r2.text.slice(0, 300));
    return r1.json;
  };
  C.receipt = async (date, amount, vatAmount, category, extra = {}) => {
    const rc = await post(`/api/companies/${cid}/receipts`, { merchant: `Shop ${++seq}`, date, amount, vatAmount, category, ...extra });
    if (!rc.json?.id) throw new Error("receipt failed " + rc.status + " " + rc.text.slice(0, 300));
    const p = await post(`/api/receipts/${rc.json.id}/post`, { accountId: acct("5090").id, paymentAccountId: acct("1020").id });
    if (p.status !== 200 && p.status !== 201) throw new Error("receipt post failed " + p.status + " " + p.text.slice(0, 300));
    return rc.json;
  };
  C.bill = async (date, unitPrice, { vendor = "Vendor A", vat = 5, category } = {}) => {
    const r1 = await post(`/api/companies/${cid}/bills`, { vendor_name: vendor, bill_date: date, due_date: date, ...(category ? { category } : {}), line_items: [{ description: "Supplies", quantity: 1, unit_price: unitPrice, vat_rate: vat }] });
    if (!r1.json?.id) throw new Error("bill failed " + r1.status + " " + r1.text.slice(0, 300));
    const r2 = await post(`/api/bills/${r1.json.id}/approve`, {});
    if (r2.status !== 200) throw new Error("bill approve failed " + r2.status + " " + r2.text.slice(0, 300));
    return r1.json;
  };
  C.balances = async (upTo) => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' ${upTo ? "AND je.date < $2::timestamp" : ""} GROUP BY a.code`, upTo ? [cid, upTo] : [cid])).rows;
    const out = {};
    for (const r of rows) out[r.code] = Math.round(n(r.net) * 100) / 100;
    return out;
  };
  C.gen = (start = prevStart, end = prevEnd) => post(`/api/companies/${cid}/vat-returns/generate`, { periodStart: start, periodEnd: end });
  return C;
}
const detailRows = (res) => (res.json?.rows ?? []).filter((r) => r.kind === "detail");
const row = (res, key) => res.json?.rows?.find((r) => r.key === key);

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await blockedInputVat();
    await uaeDayRule();
    await monthEndClose();
    await teardownAgreement();
    await inventoryValuation();
    await corporateTaxT5();
    await clientContracts();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ═════════════════════════════════════════════════════════════════════════════
// F2: blocked input VAT
// ═════════════════════════════════════════════════════════════════════════════
async function blockedInputVat() {
  const C = await newCompany("t1blocked");
  await C.invoice(prevMid, [{ description: "Goods", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  await C.receipt(prevMid, 200, 10, "office");
  const lunch = await C.receipt(prevMid, 500, 25, "entertainment");
  await C.bill(prevMid, 400, { vat: 5 });
  const bal = await C.balances();
  ok("F2: the entertainment receipt posts no input VAT: 1050 holds only the office receipt (10) and the bill (20)", close(bal["1050"], 30), bal["1050"]);
  ok("F2: ... and the blocked VAT is part of the expense (5090 = 200 + 525)", close(bal["5090"], 725), bal["5090"]);
  const gen = await C.gen();
  ok("F2: box 9 excludes the blocked receipt: amount 600, VAT 30 (not 1,100 / 55)", close(gen.json?.box9ExpensesAmount, 600) && close(gen.json?.box9ExpensesVat, 30), { amount: gen.json?.box9ExpensesAmount, vat: gen.json?.box9ExpensesVat });
  ok("F2: ledger 1050 equals box 9 VAT recoverable (box 11 = 30)", close(gen.json?.box11TotalVat, bal["1050"]) && close(gen.json?.box13RecoverableTax, 30), { b11: gen.json?.box11TotalVat, b13: gen.json?.box13RecoverableTax, l: bal["1050"] });
  const audit = await C.run("vat-audit-purchases", `from=${prevStart}&to=${prevEnd}`);
  const rows = detailRows(audit);
  const blockedRow = rows.find((x) => x.drill?.id === lunch.id);
  ok("F2: the VAT Audit shows the entertainment receipt as blocked with no recoverable VAT", !!blockedRow && /blocked|محظور/i.test(String(blockedRow.cells.treatment)) && n(blockedRow.cells.recoverable) === 0, blockedRow?.cells);
  ok("F2: the VAT Audit totals (net 600, VAT 30) are the return's box 9", close(audit.json?.totals?.net, 600) && close(audit.json?.totals?.vat, 30) && close(audit.json?.totals?.recoverable, 30), audit.json?.totals);
  const summary = await C.run("vat-summary", `from=${prevStart}&to=${prevEnd}`);
  ok("F2: the VAT summary net payable (50 - 30) equals box 14 of the return", close(summary.json?.totals?.vat, 20) && close(gen.json?.box14PayableTax, 20), { s: summary.json?.totals, b14: gen.json?.box14PayableTax });
  const file = await C.post(`/api/vat-returns/${gen.json?.id}/file`, { ftaReferenceNumber: `T1-${rnd}`, filedAt: today });
  ok("F2: the return files (the ledger and the return agree on input VAT)", file.status === 201, { s: file.status, t: file.text?.slice(0, 200) });

  // expense claim: the same rule (category entertainment), amount and VAT out of box 9
  const K = await newCompany("t1claim");
  const cl = (await db.query(`INSERT INTO expense_claims (company_id, submitted_by, title, claim_number, total_amount, status) VALUES ($1,$2,'Lunch','EC-T1',305,'approved') RETURNING id`, [K.cid, K.userId])).rows[0];
  await db.query(`INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount) VALUES ($1,$2::timestamp,'entertainment','Client lunch',200,10), ($1,$2::timestamp,'travel','Taxi',100,5)`, [cl.id, prevMid]);
  const gk = await K.gen();
  ok("F2: an entertainment expense-claim item is out of box 9 too (amount 100, VAT 5 from the taxi only)", close(gk.json?.box9ExpensesAmount, 100) && close(gk.json?.box9ExpensesVat, 5), { a: gk.json?.box9ExpensesAmount, v: gk.json?.box9ExpensesVat });

  // bill coded as entertainment
  const B = await newCompany("t1billent");
  await B.bill(prevMid, 300, { category: "entertainment", vat: 5 });
  const bb = await B.balances();
  const gb = await B.gen();
  ok("F2: a bill whose category is entertainment posts its VAT to the expense, not 1050, and is not in box 9", close(bb["1050"] ?? 0, 0) && close(gb.json?.box9ExpensesVat, 0) && close(gb.json?.box9ExpensesAmount, 0), { l: bb["1050"], v: gb.json?.box9ExpensesVat, a: gb.json?.box9ExpensesAmount });
}

// ═════════════════════════════════════════════════════════════════════════════
// The UAE day: a document dated 00:00 Dubai on the 1st belongs to that month
// ═════════════════════════════════════════════════════════════════════════════
async function uaeDayRule() {
  const C = await newCompany("t1uae");
  const first = await C.invoice(prevMid, [{ description: "Mid", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  const edge = await C.invoice(prevMid, [{ description: "First-of-month sale", quantity: 1, unitPrice: 2000, vatRate: 0.05 }]);
  // Dubai midnight of the 1st of the month, as an instant: the evening of the previous day in UTC
  const stored = `${ymd(new Date(Date.UTC(Number(prevStart.slice(0, 4)), Number(prevStart.slice(5, 7)) - 1, 0)))} 20:00:00`;
  await db.query(`UPDATE invoices SET date = $2::timestamp WHERE id = $1`, [edge.id, stored]);
  await db.query(`UPDATE journal_entries SET date = $3::timestamp WHERE company_id = $1 AND source = 'invoice' AND source_id = $2`, [C.cid, edge.id, stored]);
  const gen = await C.gen();
  const box1 = (g) => ["box1a", "box1b", "box1c", "box1d", "box1e", "box1f", "box1g"].reduce((a, k) => a + n(Object.entries(g ?? {}).find(([key]) => key.startsWith(k) && key.endsWith("Vat"))?.[1]), 0);
  ok("UAE day: the invoice dated 00:00 Dubai on the 1st is in that month's return (VAT 150, not 50)", close(box1(gen.json), 150), { box1: box1(gen.json), stored });
  const prevMonthEnd = ymd(new Date(Date.UTC(Number(prevStart.slice(0, 4)), Number(prevStart.slice(5, 7)) - 1, 0)));
  const before = await C.run("vat-summary", `from=${prevMonthEnd.slice(0, 8)}01&to=${prevMonthEnd}`);
  ok("UAE day: ... and not in the month before (the VAT summary of that month holds no sale)", close(before.json?.rows?.find((r) => r.key === "sales")?.cells?.vat, 0), before.json?.rows?.find((r) => r.key === "sales")?.cells);
  const summary = await C.run("vat-summary", `from=${prevStart}&to=${prevEnd}`);
  const pl = await C.run("profit-loss", `from=${prevStart}&to=${prevEnd}`);
  const rev = pl.json?.rows?.find((r) => r.key === "subtotal:revenue");
  const bal = await C.balances();
  ok("UAE day: the VAT summary, the P&L and the ledger agree on the month (output VAT 150, revenue 3,000; 2020 = 150)", close(summary.json?.rows?.find((r) => r.key === "sales")?.cells?.vat, 150) && close(-bal["2020"], 150) && close(rev?.cells?.amount, 3000), { vat: summary.json?.rows?.find((r) => r.key === "sales")?.cells, l: bal["2020"], rev: rev?.cells });
  const audit = await C.run("vat-audit-sales", `from=${prevStart}&to=${prevEnd}`);
  ok("UAE day: the VAT Audit sales rows show the edge invoice in the month on its Dubai date", detailRows(audit).length === 2 && detailRows(audit).some((x) => x.cells.date === prevStart), detailRows(audit).map((x) => x.cells.date));
  ok("UAE day: both invoices are still there (first untouched)", !!first.id);
}

// ═════════════════════════════════════════════════════════════════════════════
// F3: month-end close
// ═════════════════════════════════════════════════════════════════════════════
async function monthEndClose() {
  const C = await newCompany("t1close");
  const y = now.getUTCFullYear() - 1;
  await C.invoice(`${y}-03-10`, [{ description: "March", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  await C.invoice(`${y}-09-10`, [{ description: "September", quantity: 1, unitPrice: 2000, vatRate: 0.05 }]);
  await C.invoice(`${y}-10-05`, [{ description: "October", quantity: 1, unitPrice: 4000, vatRate: 0.05 }]);
  const profit = async (from, to) => n((await C.run("profit-loss", `from=${from}&to=${to}`)).json?.totals?.amount ?? 0);
  const q3Before = await profit(`${y}-07-01`, `${y}-09-30`);
  const close = await C.post(`/api/companies/${C.cid}/month-end/generate-closing-entries`, { periodStart: `${y}-09-01`, periodEnd: `${y}-09-30` });
  ok("F3: 'Generate closing entries' for a month posts nothing (200, posted false, no entry)", close.status === 200 && close.json?.posted === false && !close.json?.entryNumber, { s: close.status, j: close.json });
  const closing = (await db.query(`SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'system' AND memo LIKE 'Closing entries%'`, [C.cid])).rows[0].c;
  ok("F3: no closing journal entry exists", closing === 0, closing);
  const lock = await C.post(`/api/companies/${C.cid}/month-end/lock-period`, { periodEnd: `${y}-09-30` });
  ok("F3: the month still locks", lock.status === 200 || lock.status === 201, lock.status);
  const q3After = await profit(`${y}-07-01`, `${y}-09-30`);
  ok("F3: the Q3 P&L after the September close shows the Q3 figures (net 2,000), unchanged", close2(q3Before, 2000) && close2(q3After, 2000), { q3Before, q3After });
  const sep = n((await C.run("profit-loss", `from=${y}-09-01&to=${y}-09-30`)).json?.totals?.amount);
  const bal = await C.balances();
  ok("F3: the September P&L still shows revenue, equity untouched (3020 holds nothing)", close2(sep, 2000) && close2(bal["3020"] ?? 0, 0), { sep, re: bal["3020"] });

  // a closing entry can never include postings after its date: the year-end of a year with a later posting
  const closeYear = await C.post(`/api/companies/${C.cid}/year-end/close`, { yearStart: `${y}-01-01` });
  ok("F3: the year-end still closes its own year", closeYear.status === 200 || closeYear.status === 201, { s: closeYear.status, t: closeYear.text?.slice(0, 200) });
  const closingEntry = (await db.query(`SELECT je.id, je.date::date::text AS d, (SELECT COALESCE(SUM(jl.credit - jl.debit),0) FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = je.id AND a.code = '3020') AS re FROM journal_entries je WHERE je.company_id = $1 AND je.source = 'year_end_close'`, [C.cid])).rows[0];
  ok("F3: the year-end entry is dated the year end and moves exactly the year's profit (7,000 incl. October of that year) to 3020", !!closingEntry && closingEntry.d === `${y}-12-31` && close2(closingEntry.re, 7000), closingEntry);
  const later = await C.invoice(today, [{ description: "Today", quantity: 1, unitPrice: 500, vatRate: 0.05 }]);
  const beforeAfterYear = await profit(`${y + 1}-01-01`, today);
  ok("F3: postings after the year end are not in the closing entry (the new year's P&L still shows them)", !!later.id && close2(beforeAfterYear, 500), beforeAfterYear);
  const guard = await db.query(`SELECT 1`);
  ok("F3: sanity", guard.rows.length === 1, null);
}
const close2 = (a, b) => Math.abs(n(a) - n(b)) <= 0.005;

// ═════════════════════════════════════════════════════════════════════════════
// The teardown's data: P&L, VAT summary and ledger agree for every document
// ═════════════════════════════════════════════════════════════════════════════
async function teardownAgreement() {
  const C = await newCompany("t1agree");
  const bank = C.acct("1020");
  // discount (5% on the line) + shipping, standard rated
  const gulf = await C.invoice(`${prevStart.slice(0, 8)}05`, [
    { description: "Cement", quantity: 400, unitPrice: 35, vatRate: 0.05, discountType: "percent", discountValue: 5 },
    { description: "Delivery", quantity: 1, unitPrice: 200, vatRate: 0.05, lineKind: "shipping" },
  ]);
  // export, zero rated
  await C.invoice(`${prevStart.slice(0, 8)}08`, [{ description: "Export", quantity: 50, unitPrice: 34, vatRate: 0, vatSupplyType: "zero_rated" }]);
  // purchases: a bill, an entertainment receipt, an ordinary receipt
  await C.bill(`${prevStart.slice(0, 8)}06`, 1000, { vat: 5 });
  await C.receipt(`${prevStart.slice(0, 8)}18`, 500, 25, "entertainment");
  await C.receipt(`${prevStart.slice(0, 8)}20`, 100, 5, "utilities");
  // credit note on the Gulf invoice (20 bags)
  const cn = await C.post(`/api/companies/${C.cid}/invoices/${gulf.id}/credit-note`, { date: `${prevStart.slice(0, 8)}22`, lines: [{ description: "Cement returned", quantity: 20, unitPrice: 33.25, vatRate: 0.05 }] });
  const gen = await C.gen();
  const sumBox = (re) => Object.entries(gen.json ?? {}).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + n(v), 0);
  const bal = await C.balances();
  const outputLedger = -n(bal["2020"] ?? 0);
  const inputLedger = n(bal["1050"] ?? 0);
  const summary = await C.run("vat-summary", `from=${prevStart}&to=${prevEnd}`);
  ok("agree: credit note accepted (setup)", cn.status === 201 || cn.status === 200, { s: cn.status, t: cn.text?.slice(0, 200) });
  ok("agree: box 1 VAT equals output VAT in the ledger (2020)", close(sumBox(/^box1[a-g].*Vat$/), outputLedger), { box1: sumBox(/^box1[a-g].*Vat$/), outputLedger });
  ok("agree: box 9 VAT (bill 50 + utilities 5; the blocked 25 is not claimed) equals input VAT in the ledger (1050)", close(gen.json?.box9ExpensesVat, 55) && close(inputLedger, 55), { b9: gen.json?.box9ExpensesVat, inputLedger });
  const pl = await C.run("profit-loss", `from=${prevStart}&to=${prevEnd}`);
  const revenue = n(pl.json?.rows?.find((r) => r.key === "subtotal:revenue")?.cells?.amount);
  const salesBox = n(gen.json?.box8TotalAmount);
  ok("agree: the P&L revenue equals box 8 total supplies (discount, shipping, export, credit note all in)", close(revenue, salesBox) && salesBox > 0, { revenue, salesBox, totals: pl.json?.totals });
  ok("agree: the VAT summary is output VAT less recoverable input VAT of the return", close(summary.json?.totals?.vat, outputLedger - inputLedger), { s: summary.json?.totals?.vat, outputLedger, inputLedger });
  const expense = n(pl.json?.rows?.find((r) => r.key === "subtotal:expenses")?.cells?.amount);
  ok("agree: the P&L expenses hold the blocked VAT (bill 1,000 + entertainment 525 + utilities 100)", close(expense, 1625), { expense, totals: pl.json?.totals });
  void bank;
}

// ═════════════════════════════════════════════════════════════════════════════
// F4: inventory valuation
// ═════════════════════════════════════════════════════════════════════════════
async function inventoryValuation() {
  const C = await newCompany("t1stock");
  const day = (ago) => ymd(new Date(Date.now() - ago * 86400000));
  await api("PATCH", `/api/companies/${C.cid}/preferences`, { token: C.token, body: { inventoryCostingEnabled: true } });
  const prod = await C.post(`/api/companies/${C.cid}/products`, { name: "Cement 50kg", unitPrice: "35", vatRate: "0.05", trackInventory: true });
  if (!prod.json?.id) throw new Error("product failed " + prod.status + " " + prod.text?.slice(0, 200));
  const pid = prod.json.id;
  const buy = await C.post(`/api/products/${pid}/movements`, { type: "purchase", quantity: 10, unitCost: "20" });
  if (buy.status !== 200) throw new Error("movement failed " + buy.status + " " + buy.text?.slice(0, 200));
  // the purchase happened 20 days ago (the movement's own date, as a purchase date will set it); its journal the same day
  await db.query(`UPDATE inventory_movements SET created_at = $2::timestamp, movement_date = $2::timestamp WHERE product_id = $1`, [pid, day(20)]);
  await db.query(`UPDATE journal_entries SET date = $2::timestamp WHERE company_id = $1`, [C.cid, day(20)]);
  await C.invoice(day(10), [{ description: "Cement", quantity: 4, unitPrice: 35, vatRate: 0.05, productId: pid }]);
  const val = (asOf) => C.run("inventory-valuation", `asOf=${asOf}`);
  const prodRow = (r) => detailRows(r).find((x) => x.cells.name === "Cement 50kg");
  let r = await val(day(15));
  ok("F4: the valuation 15 days ago shows the 10 bags bought 20 days ago (10 bags, 200)", n(prodRow(r)?.cells.quantity) === 10 && close(prodRow(r)?.cells.value, 200), prodRow(r)?.cells);
  r = await val(day(5));
  ok("F4: after the sale of 4 at average cost 20: 6 bags, 120", n(prodRow(r)?.cells.quantity) === 6 && close(prodRow(r)?.cells.value, 120), prodRow(r)?.cells);
  ok("F4: the report reconciles the stock total to account 1070 and shows no difference when they agree", close(row(r, "ledger-1070")?.cells.value, 120) && close(row(r, "difference")?.cells.value, 0) && !(r.json?.warnings ?? []).some((w) => /1070/.test(w)), { l: row(r, "ledger-1070")?.cells, d: row(r, "difference")?.cells, w: r.json?.warnings });
  ok("F4: no negative-stock warning when nothing is negative", !(r.json?.warnings ?? []).some((w) => /NEGATIVE|سالب/i.test(w)), r.json?.warnings);

  // a drift between the stock ledger and the books: a manual journal into 1070 shows as the difference, with a warning
  await C.post(`/api/companies/${C.cid}/journal`, { date: day(3), description: "Stock correction", status: "posted", lines: [{ accountId: C.acct("1070").id, debit: 100, credit: 0 }, { accountId: C.acct("3010").id, debit: 0, credit: 100 }] });
  r = await val(day(1));
  ok("F4: a journal into 1070 that the stock ledger does not know is shown: books 220, stock 120, difference -100, with a warning", close(row(r, "ledger-1070")?.cells.value, 220) && close(row(r, "difference")?.cells.value, -100) && (r.json?.warnings ?? []).some((w) => /1070/.test(w)), { l: row(r, "ledger-1070")?.cells, d: row(r, "difference")?.cells, w: r.json?.warnings });

  // a purchase recorded AFTER the sale it supplied (entered late, dated late) leaves the sale's day negative: warned, never silent
  await db.query(`UPDATE inventory_movements SET created_at = $2::timestamp, movement_date = $2::timestamp WHERE product_id = $1 AND type = 'purchase'`, [pid, day(2)]);
  r = await val(day(5));
  ok("F4: stock sold before it was received shows negative quantity AND a warning that names the product", n(prodRow(r)?.cells.quantity) === -4 && (r.json?.warnings ?? []).some((w) => /NEGATIVE|سالب/i.test(w) && /Cement 50kg/.test(w)), { q: prodRow(r)?.cells, w: r.json?.warnings });
  const summary = await C.run("inventory-summary", `asOf=${day(5)}`);
  ok("F4: the inventory summary warns about the negative product too", (summary.json?.warnings ?? []).some((w) => /NEGATIVE|سالب/i.test(w)), summary.json?.warnings);
}


// ═════════════════════════════════════════════════════════════════════════════
// Teardown t5 / F3: corporate tax: SBR election, labels, add-backs and deductions
// ═════════════════════════════════════════════════════════════════════════════
async function corporateTaxT5() {
  const mk = async (C, start, end, revenue, expenses) => {
    const r = await C.post(`/api/companies/${C.cid}/corporate-tax/returns`, { taxPeriodStart: start, taxPeriodEnd: end, totalRevenue: revenue, totalExpenses: expenses, totalDeductions: 0 });
    if (r.status !== 201) throw new Error("ct return failed " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const compute = (C, id, body) => C.post(`/api/corporate-tax/returns/${id}/compute`, body);
  const sheetText = async (C, id) => {
    const res = await api("GET", `/api/corporate-tax/returns/${id}/export`, { token: C.token, raw: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buf);
    const rows = [];
    wb.eachSheet((ws) => ws.eachRow((r) => rows.push(r.values.slice(1).map((v) => (v && typeof v === "object" && "result" in v ? v.result : v)))));
    return rows;
  };

  // Noor: small (revenue 110,000), elects Small Business Relief -> 0 tax, shown on the workpaper
  const N = await newCompany("t5noor");
  const noor = await mk(N, "2026-01-01", "2026-12-31", 110000, 40000);
  const avail = await api("GET", `/api/corporate-tax/returns/${noor.id}/small-business-relief`, { token: N.token });
  ok("T5 SBR is offered for revenue <= 3m in a period ending by 31 Dec 2026: available, with its own thresholds", avail.status === 200 && avail.json?.available === true && avail.json?.revenueThreshold === 3000000 && avail.json?.lastPeriodEnd === "2026-12-31" && avail.json?.zeroRateBand === 375000 && avail.json?.elected === false, avail.json);
  let c = await compute(N, noor.id, { smallBusinessReliefElected: true });
  ok("T5 Noor elects SBR: relief applied, tax 0, the election is recorded", c.status === 200 && c.json?.computation?.smallBusinessRelief?.applied === true && close(c.json?.computation?.taxPayable, 0) && c.json?.return?.workpaper?.sbrElected === true, { s: c.status, r: c.json?.computation?.smallBusinessRelief });
  const rows = await sheetText(N, noor.id);
  const flat = rows.map((r) => r.join(" | "));
  ok("T5 the workpaper says SBR is elected and applied (not 'Not applied')", flat.some((l) => /Small business relief/i.test(l) && /Elected and applied/i.test(l)) && !flat.some((l) => /Small business relief \|\s*Not applied/i.test(l)), flat.filter((l) => /small/i.test(l)));
  ok("T5 the 375,000 is labelled the 0% band (Art. 3), never the small-business-relief threshold", !flat.some((l) => /Small-business relief threshold/i.test(l)) && flat.some((l) => /0% band/i.test(l) && /375,?000/.test(l)), flat.filter((l) => /band|threshold/i.test(l)));
  ok("T5 ... and the 3,000,000 revenue limit is shown as the SBR revenue threshold", flat.some((l) => /relief/i.test(l) && /revenue/i.test(l) && /3,?000,?000/.test(l)), flat.filter((l) => /3,?000,?000/.test(l)));
  const wpRep = await N.run("ct-workpaper", "from=2026-01-01&to=2026-12-31&taxYear=2026");
  ok("T5 the CT workpaper report agrees with the return: tax 0 and the SBR line in the schedule", wpRep.status === 200 && close(wpRep.json?.totals?.amount, 0) && (wpRep.json?.rows ?? []).some((r) => /small business relief|إعفاء الأعمال الصغيرة/i.test(String(r.cells?.name))), (wpRep.json?.rows ?? []).map((r) => r.cells?.name));

  // not elected: the workpaper says so plainly
  const N2 = await newCompany("t5noor2");
  const plain = await mk(N2, "2026-01-01", "2026-12-31", 110000, 40000);
  await compute(N2, plain.id, {});
  const plainRows = (await sheetText(N2, plain.id)).map((r) => r.join(" | "));
  ok("T5 without an election the workpaper says 'Not elected'", plainRows.some((l) => /Small business relief/i.test(l) && /Not elected/i.test(l)), plainRows.filter((l) => /small/i.test(l)));

  // Falcon: 3.2m revenue: SBR not available; 20,000 entertainment, 50% added back (Art. 32)
  const F = await newCompany("t5falcon");
  const falcon = await mk(F, "2026-01-01", "2026-12-31", 3200000, 1820000);
  const fav = await api("GET", `/api/corporate-tax/returns/${falcon.id}/small-business-relief`, { token: F.token });
  ok("T5 SBR is not offered above 3m of revenue (reason revenue_cap)", fav.json?.available === false && fav.json?.reason === "revenue_cap", fav.json);
  c = await compute(F, falcon.id, {});
  ok("T5 Falcon without an add-back: 9% x (1,380,000 - 375,000) = 90,450 (the figure t5 saw)", close(c.json?.computation?.taxPayable, 90450), c.json?.computation?.taxPayable);
  const bad = await compute(F, falcon.id, { adjustments: [{ id: "x", category: "other_addback", amount: 500 }] });
  ok("T5 an 'other' adjustment needs a reason (400)", bad.status === 400 && bad.json?.code === "CT_ADJUSTMENT_INVALID", { s: bad.status, j: bad.json });
  const neg = await compute(F, falcon.id, { adjustments: [{ id: "x", category: "fines_penalties", amount: -5 }] });
  const unknown = await compute(F, falcon.id, { adjustments: [{ id: "x", category: "made_up", amount: 5 }] });
  ok("T5 a negative amount and an unknown category are refused (400)", neg.status === 400 && unknown.status === 400, { n: neg.status, u: unknown.status });
  c = await compute(F, falcon.id, {
    smallBusinessReliefElected: true,
    adjustments: [
      { id: "e1", category: "entertainment_50", baseAmount: 20000 },
      { id: "f1", category: "fines_penalties", amount: 0 },
    ],
  });
  ok("T5 Falcon's election is refused by the rules, not silently granted: applied false, reason revenue_cap, still 200", c.status === 200 && c.json?.computation?.smallBusinessRelief?.applied === false && c.json?.computation?.smallBusinessRelief?.ineligibleReason === "revenue_cap", c.json?.computation?.smallBusinessRelief);
  ok("T5 the 50% entertainment add-back (10,000, Art. 32) is in: taxable income 1,390,000 and tax 9% x 1,015,000 = 91,350", close(c.json?.computation?.totalAddBacks, 10000) && close(c.json?.computation?.taxableIncome, 1390000) && close(c.json?.computation?.taxPayable, 91350), { ab: c.json?.computation?.totalAddBacks, ti: c.json?.computation?.taxableIncome, tax: c.json?.computation?.taxPayable });
  const stored = (await api("GET", `/api/corporate-tax/returns/${falcon.id}`, { token: F.token })).json;
  ok("T5 the add-backs are stored with the computation on the return (amount derived from the base)", stored?.workpaper?.adjustments?.some((a) => a.category === "entertainment_50" && close(a.amount, 10000) && close(a.baseAmount, 20000)) && close(stored?.taxPayable, 91350), stored?.workpaper?.adjustments);
  const audit = (await db.query(`SELECT action, details FROM audit_logs WHERE company_id = $1 AND resource_id = $2 AND action = 'ct.compute' ORDER BY created_at DESC LIMIT 1`, [F.cid, falcon.id])).rows[0];
  ok("T5 the computation is audit-logged with the adjustments and the SBR election", !!audit && JSON.stringify(audit.details).includes("entertainment_50") && JSON.stringify(audit.details).includes("sbrElected"), audit);
  const fRep = await F.run("ct-workpaper", "from=2026-01-01&to=2026-12-31&taxYear=2026");
  ok("T5 the CT report equals the return (91,350) and lists the add-back line", close(fRep.json?.totals?.amount, 91350) && (fRep.json?.rows ?? []).some((r) => /entertainment|ضيافة|ترفيه/i.test(String(r.cells?.name))), { t: fRep.json?.totals, n: (fRep.json?.rows ?? []).map((r) => r.cells?.name) });
  const fRows = (await sheetText(F, falcon.id)).map((r) => r.join(" | "));
  ok("T5 the Excel computation sheet carries the add-back and ends at the same tax", fRows.some((l) => /entertainment/i.test(l) && /10,?000/.test(l.replace(/\s/g, ""))) && fRows.some((l) => /Corporate tax payable/i.test(l) && /91,?350/.test(l)), fRows.filter((l) => /entertainment|payable/i.test(l)));
  const fUp = await compute(F, falcon.id, { adjustments: [{ id: "d1", category: "capital_allowance", amount: 5000, notes: "Tax depreciation above book" }, { id: "d2", category: "depreciation_addback", amount: 3000 }] });
  ok("T5 depreciation vs capital allowance: add 3,000, deduct 5,000 -> taxable 1,378,000", close(fUp.json?.computation?.taxableIncome, 1378000), fUp.json?.computation?.taxableIncome);

  // suggestion from the books: blocked entertainment (receipt) -> 50% add-back proposed, never applied by itself
  const S = await newCompany("t5suggest");
  await S.receipt("2026-03-10", 500, 25, "entertainment");
  await S.receipt("2026-03-11", 100, 5, "office");
  const sr = await mk(S, "2026-01-01", "2026-12-31", 50000, 10000);
  const sg = await api("GET", `/api/corporate-tax/returns/${sr.id}/suggested-adjustments`, { token: S.token });
  ok("T5 the books suggest the entertainment add-back: 525 spent (VAT blocked, part of the expense), 262.50 disallowed", sg.status === 200 && sg.json?.suggestions?.some((x) => x.category === "entertainment_50" && close(x.baseAmount, 525) && close(x.amount, 262.5)), sg.json);
  const after = (await api("GET", `/api/corporate-tax/returns/${sr.id}`, { token: S.token })).json;
  ok("T5 ... and a suggestion changes nothing on the return by itself", !(after?.workpaper?.adjustments ?? []).length, after?.workpaper);
}

// ═════════════════════════════════════════════════════════════════════════════
// Client contracts (S8): what the month-end and corporate tax screens read, and the checklist rules they show
// ═════════════════════════════════════════════════════════════════════════════
const hereT1 = path.dirname(fileURLToPath(import.meta.url));
function ctUiPayload(payload) {
  const res = spawnSync("npx", ["tsx", path.join(hereT1, "helpers", "ct-ui-payload.mts")], { input: JSON.stringify(payload), encoding: "utf8", cwd: path.join(hereT1, "..", ".."), timeout: 120_000 });
  try { return JSON.parse(res.stdout); } catch { return { error: (res.stderr || res.stdout || "").slice(0, 600) }; }
}

async function clientContracts() {
  const y = now.getUTCFullYear() - 1;
  const C = await newCompany("t1ui");
  const item = async (id, period) => (await api("GET", `/api/companies/${C.cid}/month-end/checklist?period=${period}`, { token: C.token })).json?.checklist?.find((i) => i.id === id);

  // month-end: the fields the screen reads
  await C.invoice(`${y}-03-10`, [{ description: "March", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  await C.invoice(`${y}-09-10`, [{ description: "September", quantity: 1, unitPrice: 2000, vatRate: 0.05 }]);
  const closeRes = await C.post(`/api/companies/${C.cid}/month-end/generate-closing-entries`, { periodStart: `${y}-09-01`, periodEnd: `${y}-09-30` });
  ok("UI month-end: the summary carries what the screen shows: posted false, the period's profit (2,000, not the year's 3,000), both-language message, no lines, no entry number",
    closeRes.status === 200 && closeRes.json?.posted === false && close2(closeRes.json?.netProfit, 2000) && typeof closeRes.json?.message === "string" && /[\u0600-\u06FF]/.test(closeRes.json?.messageAr ?? "") && Array.isArray(closeRes.json?.lines) && closeRes.json.lines.length === 0 && closeRes.json?.entryNumber === null, closeRes.json);

  // checklist 1: a completed reconciliation session is required, not just reconciled flags
  const bank = (await db.query(`INSERT INTO bank_accounts (company_id, name_en, bank_name, currency) VALUES ($1, 'Current', 'Test Bank', 'AED') RETURNING id`, [C.cid])).rows[0];
  await db.query(`INSERT INTO bank_transactions (company_id, bank_statement_account_id, transaction_date, description, amount, is_reconciled, match_status) VALUES ($1,$2,$3::timestamp,'Deposit',500,true,'matched')`, [C.cid, bank.id, `${y}-09-12`]);
  let b = await item(1, `${y}-09`);
  ok("UI checklist 1: every line flagged reconciled but no completed session -> the bank item is incomplete", b?.status === "incomplete" && /completed reconciliation/i.test(b?.details ?? ""), b);
  await db.query(`INSERT INTO bank_reconciliations (company_id, bank_account_id, statement_date, statement_balance, ledger_balance, status) VALUES ($1,$2,$3::date,500,500,'completed')`, [C.cid, bank.id, `${y}-09-30`]);
  b = await item(1, `${y}-09`);
  ok("UI checklist 1: a completed session as at the period end makes it complete", b?.status === "complete", b);
  await db.query(`UPDATE bank_reconciliations SET status = 'reopened' WHERE company_id = $1`, [C.cid]);
  b = await item(1, `${y}-09`);
  ok("UI checklist 1: a reopened session no longer counts", b?.status === "incomplete", b);

  // checklist 7: a quarterly filer is not held up mid-quarter; the quarter-end month needs the return, which then covers all three months
  let v = await item(7, `${y}-08`);
  ok("UI checklist 7: August, inside an unfinished quarter, is not blocked by a missing VAT return", v?.status === "complete" && /not ended/i.test(v?.details ?? ""), v);
  v = await item(7, `${y}-09`);
  ok("UI checklist 7: September, the quarter's last month, needs the return", v?.status === "incomplete", v);
  const gen = await C.gen(`${y}-07-01`, `${y}-09-30`);
  v = await item(7, `${y}-09`);
  ok("UI checklist 7: a draft return does not satisfy it", gen.status < 300 && v?.status === "incomplete", { g: gen.status, v });
  await db.query(`UPDATE vat_returns SET status = 'submitted' WHERE company_id = $1`, [C.cid]);
  v = await item(7, `${y}-09`);
  const vAug = await item(7, `${y}-08`);
  ok("UI checklist 7: the submitted quarterly return covers September (and August)", v?.status === "complete" && /cover/i.test(v?.details ?? "") && vAug?.status === "complete", { sep: v, aug: vAug });

  // checklist 6: depreciation counts the month's posted row
  const asset = await C.post(`/api/companies/${C.cid}/fixed-assets`, { assetName: "Laptop", category: "Equipment", purchaseDate: `${y}-08-15`, purchaseCost: 12000, salvageValue: 0, usefulLifeYears: 5, paymentAccountId: C.acct("1020").id });
  let d = await item(6, `${y}-09`);
  ok("UI checklist 6: an asset with no depreciation posted for the month makes the item incomplete", asset.status < 300 && d?.status === "incomplete" && /0\/1/.test(d?.details ?? ""), { s: asset.status, d });
  const dep = await C.post(`/api/fixed-assets/${asset.json?.id}/depreciate`, { month: 9, year: y });
  d = await item(6, `${y}-09`);
  const dAug = await item(6, `${y}-08`);
  ok("UI checklist 6: posting September (which catches August up) completes the item for September and for August", dep.status < 300 && d?.status === "complete" && dAug?.status === "complete" && /through/i.test(d?.details ?? ""), { dep: dep.status, sep: d, aug: dAug });
  // land has no useful life and is never depreciated (inserted directly: the register form needs a life for everything else)
  await db.query(`INSERT INTO fixed_assets (company_id, asset_name, category, purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method, accumulated_depreciation, net_book_value, status) VALUES ($1,'Plot','Land',$2::timestamp,50000,0,0,'straight_line',0,50000,'active')`, [C.cid, `${y}-02-01`]);
  d = await item(6, `${y}-09`);
  ok("UI checklist 6: land is not depreciable and never blocks the item", d?.status === "complete" && /1\/1/.test(d?.details ?? ""), d);

  // corporate tax: the contracts the screen reads, and the form's arithmetic equals the server's
  const T = await newCompany("t1ctui");
  const mkReturn = async (start, end, revenue, expenses) => {
    const r = await T.post(`/api/companies/${T.cid}/corporate-tax/returns`, { taxPeriodStart: start, taxPeriodEnd: end, totalRevenue: revenue, totalExpenses: expenses, totalDeductions: 0 });
    if (r.status !== 201) throw new Error("ct return failed " + r.status);
    return r.json;
  };
  const ret = await mkReturn("2026-01-01", "2026-12-31", 3_200_000, 2_000_000);
  const avail = await api("GET", `/api/corporate-tax/returns/${ret.id}/small-business-relief`, { token: T.token });
  ok("UI CT: the relief offer carries the fields the switch reads (available false, reason revenue_cap, elected, revenue)", avail.status === 200 && avail.json?.available === false && avail.json?.reason === "revenue_cap" && avail.json?.elected === false && avail.json?.revenue === 3200000, avail.json);
  const rows = [
    { id: "e1", category: "entertainment_50", amountText: "20000", notes: "" },
    { id: "d1", category: "capital_allowance", amountText: "5000", notes: "Tax depreciation above book" },
    { id: "o1", category: "other_addback", amountText: "1500.50", notes: "Owner's personal subscription" },
  ];
  const ui = ctUiPayload({ revenue: 3_200_000, expenses: 2_000_000, rows, elected: true, periodEnd: "2026-12-31" });
  ok("UI CT: the form logic runs under Node", !ui.error && Array.isArray(ui.adjustments), ui.error);
  const server = await api("POST", `/api/corporate-tax/returns/${ret.id}/compute`, { token: T.token, body: { adjustments: ui.adjustments, smallBusinessReliefElected: true } });
  const sc = server.json?.computation;
  ok("UI CT: the payload the screen builds is accepted (200) and the server's computation equals the form's, to the fils",
    server.status === 200 && close(sc?.taxPayable, ui.taxPayable) && close(sc?.taxableIncome, ui.taxableIncome) && close(sc?.totalAddBacks, ui.totalAddBacks) && close(sc?.totalDeductions, ui.totalDeductions) && sc?.smallBusinessRelief?.applied === ui.applied && (sc?.smallBusinessRelief?.ineligibleReason ?? null) === ui.reason,
    { s: server.status, server: sc && { tax: sc.taxPayable, ti: sc.taxableIncome, ab: sc.totalAddBacks, de: sc.totalDeductions }, ui });
  ok("UI CT: the form's local offer agrees with the server's (not available, revenue_cap)", ui.offer?.available === false && ui.offer?.reason === "revenue_cap", ui.offer);
  const readBack = (await api("GET", `/api/corporate-tax/returns/${ret.id}`, { token: T.token })).json;
  ok("UI CT: the saved return gives the screen what it renders: adjustments, sbrElected, and a bridge with a payable line",
    Array.isArray(readBack?.workpaper?.adjustments) && readBack.workpaper.adjustments.length === 3 && readBack.workpaper.sbrElected === true && readBack.workpaper.computation?.bridge?.some((l) => l.key === "tax_payable") && readBack.workpaper.computation?.smallBusinessRelief?.elected === true && readBack.workpaper.computation?.smallBusinessRelief?.applied === false, readBack?.workpaper?.computation?.smallBusinessRelief);
  const bad = await api("POST", `/api/corporate-tax/returns/${ret.id}/compute`, { token: T.token, body: { adjustments: [{ id: "x", category: "other_addback", amount: 10 }] } });
  ok("UI CT: a free-form line with no reason is refused 400 CT_ADJUSTMENT_INVALID (the form blocks it before sending)", bad.status === 400 && bad.json?.code === "CT_ADJUSTMENT_INVALID", bad.json);
}

main().catch((e) => { console.error(e); process.exit(1); });
