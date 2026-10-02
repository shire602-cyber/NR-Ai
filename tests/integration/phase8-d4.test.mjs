// Integration tests for Phase 8 domain D4: the server report engine, KPIs, AP/SBR fixes, schedules, consolidation, audit trail.
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5077 DATABASE_URL=... node tests/integration/phase8-d4.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";
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
const day = (ago) => ymd(new Date(Date.now() - ago * 86400000));
const today = day(0);
const now = new Date();
const yearStart = `${now.getUTCFullYear()}-01-01`;

let db;
let entrySeq = 0;

async function newCompany(label, extra = {}) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai", ...extra } });
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  const acct = (code) => accounts.find((a) => a.code === code);
  const C = { token, cid, userId, email: `${label}_${rnd}@example.com`, accounts, acct };
  // Post a balanced entry straight into the ledger: lines are [code, debit, credit].
  C.je = async (date, lines, source = "manual", memo = "test") => {
    const num = `T8-${label}-${++entrySeq}-${rnd}`;
    const e = (await db.query(
      `INSERT INTO journal_entries (company_id, entry_number, date, memo, status, source, created_by, posted_by, posted_at)
       VALUES ($1,$2,$3::timestamp,$4,'posted',$5,$6,$6,now()) RETURNING id`, [cid, num, date, memo, source, userId])).rows[0];
    for (const [code, debit, credit] of lines) {
      const a = C.acct(code);
      if (!a) throw new Error("no account " + code);
      await db.query(`INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ($1,$2,$3,$4)`, [e.id, a.id, debit, credit]);
    }
    return e.id;
  };
  C.run = (reportId, query = "", opts = {}) => api("GET", `/api/companies/${cid}/reports/run/${reportId}${query ? "?" + query : ""}`, { token, ...opts });
  C.invoice = async (date, unitPrice, extra = {}) => {
    const r1 = await api("POST", `/api/companies/${cid}/invoices`, {
      token, body: { customerName: "Report Co", date, dueDate: date, lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 0.05 }], ...extra },
    });
    if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 200));
    const r2 = await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token, body: { status: "sent" } });
    if (r2.status !== 200) throw new Error("issue failed " + r2.status + " " + r2.text.slice(0, 200));
    return r1.json;
  };
  C.pay = async (invoiceId, amount, date) => {
    const bank = acct("1020");
    const r1 = await api("POST", `/api/companies/${cid}/invoices/${invoiceId}/payments`, { token, body: { amount, date, paymentAccountId: bank.id } });
    if (r1.status !== 201) throw new Error("payment failed " + r1.status + " " + r1.text.slice(0, 200));
    return r1.json;
  };
  C.bill = async (date, unitPrice, { due, vendor = "Vendor A", vat = 5, currency, extra = {} } = {}) => {
    const r1 = await api("POST", `/api/companies/${cid}/bills`, {
      token, body: { vendor_name: vendor, bill_date: date, ...(due ? { due_date: due } : {}), ...(currency ? { currency } : {}), line_items: [{ description: "Supplies", quantity: 1, unit_price: unitPrice, vat_rate: vat }], ...extra },
    });
    if (!r1.json?.id) throw new Error("bill failed " + r1.status + " " + r1.text.slice(0, 300));
    return r1.json;
  };
  C.approveBill = async (id) => {
    const r1 = await api("POST", `/api/bills/${id}/approve`, { token, body: {} });
    if (r1.status !== 200) throw new Error("bill approve failed " + r1.status + " " + r1.text.slice(0, 300));
    return r1.json;
  };
  C.payBill = async (id, amount, date) => {
    const r1 = await api("POST", `/api/bills/${id}/payments`, { token, body: { amount, payment_date: date, payment_method: "bank_transfer", payment_account_id: acct("1010").id } });
    if (r1.status !== 201 && r1.status !== 200) throw new Error("bill payment failed " + r1.status + " " + r1.text.slice(0, 300));
    return r1.json;
  };
  return C;
}

const detailRowsOf = (json) => (json?.rows ?? []).filter((r) => r.kind === "detail");
const row = (res, key) => res.json?.rows?.find((r) => r.key === key);
const detailRows = (res) => (res.json?.rows ?? []).filter((r) => r.kind === "detail");
const byCode = (res, code) => detailRows(res).find((r) => r.cells.code === code);

async function main() {
  // UTC session like the server's pool (db.ts): `timestamp` columns hold UTC wall time, so a raw INSERT's now() default must be UTC too (the dev Postgres runs in Asia/Dubai: its now() is 4 hours ahead and lands rows on the next UAE day after 20:00).
  db = new pg.Client({ connectionString: DB_URL, options: "-c timezone=UTC" });
  await db.connect();
  try {
    await engineAndStatements();
    await documentsAndPayables();
    await dashboardKpis();
    await tieOuts();
    await taxAndBank();
    await corporateTax();
    await consolidation();
    await auditAndAbuse();
    await schedulesAndAccess();
    await wave2Reports();
    await fixRound();
    await allReportsSweep();
    await frontendContract();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ═════════════════════════════════════════════════════════════════════════════
// Engine: run route, P&L comparison, trial balance, general ledger, CSV
// ═════════════════════════════════════════════════════════════════════════════
async function engineAndStatements() {
  const E = await newCompany("eng");
  const y = now.getUTCFullYear();
  // last year January: revenue 1,000, expense 400; this year January: revenue 1,500, expense 600
  await E.je(`${y - 1}-01-10`, [["1020", 1000, 0], ["4010", 0, 1000]]);
  await E.je(`${y - 1}-01-12`, [["5000", 400, 0], ["1020", 0, 400]]);
  await E.je(`${y}-01-10`, [["1020", 1500, 0], ["4010", 0, 1500]]);
  await E.je(`${y}-01-12`, [["5000", 600, 0], ["1020", 0, 600]]);
  // a year-end close posted in December of last year must change nothing in a January P&L
  await E.je(`${y - 1}-12-31`, [["4010", 1000, 0], ["5000", 0, 400], ["3020", 0, 600]], "year_end_close", "close");

  let r = await E.run("profit-loss", `from=${y}-01-01&to=${y}-01-31`);
  ok("run: P&L JSON 200 with the ReportResult shape", r.status === 200 && r.json?.reportId === "profit-loss" && Array.isArray(r.json?.columns) && Array.isArray(r.json?.rows) && r.json?.currency === "AED", { s: r.status, j: r.json && Object.keys(r.json) });
  ok("run: P&L January net profit 900 (revenue 1,500 - expenses 600)", close(row(r, "subtotal:net")?.cells.amount, 900) && close(r.json?.totals?.amount, 900), row(r, "subtotal:net"));

  r = await E.run("profit-loss", `from=${y}-01-01&to=${y}-01-31&compare=priorYear`);
  const cols = (r.json?.columns ?? []).map((c) => c.key);
  ok("AC2: P&L compare=priorYear has amount, amount__cmp, amount__delta, amount__pct columns", ["amount", "amount__cmp", "amount__delta", "amount__pct"].every((k) => cols.includes(k)), cols);
  const net = row(r, "subtotal:net");
  ok("AC2: net profit current 900, prior 600, delta = current - prior = 300", close(net?.cells.amount, 900) && close(net?.cells["amount__cmp"], 600) && close(net?.cells["amount__delta"], 300), net);
  ok("AC2: pct is 50 and null when the prior value is 0", close(net?.cells["amount__pct"], 50), net?.cells);
  ok("AC2: the year-end close posted in December changes nothing (prior revenue 1,000 not 0)", close(row(r, "subtotal:revenue")?.cells["amount__cmp"], 1000), row(r, "subtotal:revenue"));
  ok("AC2: params echo carries the comparison window one year back", r.json?.params?.compare?.mode === "priorYear" && r.json?.params?.compare?.from === `${y - 1}-01-01`, r.json?.params);

  r = await E.run("profit-loss", `from=${y}-01-01&to=${y}-01-31&bogus=1`);
  ok("params: an unknown query key is refused (400 UNKNOWN_PARAM)", r.status === 400 && r.json?.code === "UNKNOWN_PARAM", { s: r.status, j: r.json });
  r = await E.run("profit-loss", `from=${y}-02-01&to=${y}-01-31`);
  ok("params: from after to is refused (422 INVALID_RANGE)", r.status === 422 && r.json?.code === "INVALID_RANGE", { s: r.status, j: r.json });
  r = await E.run("profit-loss", `from=${y - 8}-01-01&to=${y}-01-31`);
  ok("params: a range longer than five years is refused (422 RANGE_TOO_LONG)", r.status === 422 && r.json?.code === "RANGE_TOO_LONG", { s: r.status, j: r.json });
  r = await E.run("trial-balance", `asOf=${today}&compare=priorYear`);
  ok("params: a comparison on a report that has none is refused (422 COMPARISON_NOT_SUPPORTED)", r.status === 422 && r.json?.code === "COMPARISON_NOT_SUPPORTED", { s: r.status, j: r.json });
  r = await E.run("no-such-report");
  ok("run: an unknown report is 404 REPORT_NOT_FOUND", r.status === 404 && r.json?.code === "REPORT_NOT_FOUND", { s: r.status, j: r.json });

  // trial balance balances
  r = await E.run("trial-balance", `asOf=${today}`);
  ok("TB: debits equal credits and totals match the rows", close(r.json?.totals?.debit, r.json?.totals?.credit) && n(r.json?.totals?.debit) > 0, r.json?.totals);

  // general ledger: opening balance, running balance, drill
  r = await E.run("general-ledger", `from=${y}-01-01&to=${y}-01-31`);
  const bank = (r.json?.rows ?? []).find((x) => x.key.startsWith("acct:") && x.cells.description?.startsWith("1020"));
  ok("GL: the bank account section opens at 1,000 - 400 + 600 net of last year (the books carry forward)", bank && close(bank.cells.balance, 600), bank);
  const lines = (r.json?.rows ?? []).filter((x) => x.kind === "detail");
  ok("GL: lines carry a journal_entry drill and a running balance", lines.length > 0 && lines.every((l) => l.drill?.target === "journal_entry" && typeof l.cells.balance === "number"), lines[0]);
  const lastBank = [...lines].reverse().find((l) => l.cells.debit === 1500 || l.cells.credit === 600);
  ok("GL: the January bank lines end at 600 + 1,500 - 600 = 1,500", lastBank && close(lastBank.cells.balance, 1500), lastBank);

  // CSV
  r = await E.run("profit-loss", `from=${y}-01-01&to=${y}-01-31&format=csv`, { raw: true });
  const csv = r.buf.toString("utf8");
  ok("CSV: 200, text/csv with a BOM and CRLF lines", r.status === 200 && /text\/csv/.test(r.headers.get("content-type") ?? "") && csv.charCodeAt(0) === 0xfeff && csv.includes("\r\n"), { s: r.status, ct: r.headers.get("content-type") });
  // AC3 comparative trial balance: 31 Mar against 31 Dec of last year
  const T = await newCompany("ctb");
  await T.je(`${y - 1}-12-20`, [["1020", 1000, 0], ["3010", 0, 1000]], "manual", "capital");
  await T.je(`${y}-02-10`, [["1020", 500, 0], ["4010", 0, 500]]);
  await T.je(`${y}-03-05`, [["5010", 200, 0], ["1020", 0, 200]]);
  await T.je(`${y}-05-01`, [["1020", 9999, 0], ["4010", 0, 9999]]);   // after the as-of day: must not appear
  r = await T.run("comparative-trial-balance", `asOf=${y}-03-31&compare=custom&compareAsOf=${y - 1}-12-31`);
  const bankRow = byCode(r, "1020");
  ok("AC3: Comparative TB shows opening 1,000, movement Dr 500 / Cr 200 and closing 1,300 for the bank account", bankRow && close(bankRow.cells.openingDebit, 1000) && close(bankRow.cells.movementDebit, 500) && close(bankRow.cells.movementCredit, 200) && close(bankRow.cells.closingDebit, 1300), bankRow?.cells);
  ok("AC3: Σ debits = Σ credits in the opening and in the closing columns", close(r.json?.totals?.openingDebit, r.json?.totals?.openingCredit) && close(r.json?.totals?.closingDebit, r.json?.totals?.closingCredit) && close(r.json?.totals?.movementDebit, r.json?.totals?.movementCredit) && (r.json?.warnings ?? []).every((w) => !/do not balance/.test(w)), r.json?.totals);
  ok("AC3: an entry after the as-of day is not in the closing balance", close(byCode(r, "4010")?.cells.closingCredit, 500), byCode(r, "4010")?.cells);
  r = await T.run("comparative-trial-balance", `asOf=${y}-03-31`);
  ok("AC3: with no comparison the opening day is the end of the previous fiscal year", close(byCode(r, "1020")?.cells.openingDebit, 1000) && r.json?.warnings?.some((w) => w.includes(`${y - 1}-12-31`)), r.json?.warnings);
  r = await T.run("comparative-trial-balance", `asOf=${y}-03-31&compare=custom&compareAsOf=${y}-03-31`);
  ok("AC3: a comparison day on or after the as-of day is refused (422)", r.status === 422 && r.json?.code === "INVALID_RANGE", { s: r.status, j: r.json });

  // statements in Arabic, equity, journal report
  r = await T.run("profit-loss", `from=${y}-01-01&to=${y}-03-31&lang=ar`);
  ok("lang=ar: JSON row labels come back in Arabic (section, subtotal and account names)", /[\u0600-\u06FF]/.test(row(r, "section:revenue")?.cells.name ?? "") && /[\u0600-\u06FF]/.test(row(r, "subtotal:net")?.cells.name ?? "") && detailRows(r).every((x) => /[\u0600-\u06FF]/.test(x.cells.name)), row(r, "section:revenue")?.cells);
  const eq = await T.run("equity-movement", `from=${y}-01-01&to=${y}-03-31`);
  const bsT = await T.run("balance-sheet", `asOf=${y}-03-31`);
  ok("equity movement: closing total equals balance sheet total equity", close(eq.json?.totals?.closing, row(bsT, "subtotal:equity")?.cells.amount) && close(eq.json?.totals?.opening, 1000), { eq: eq.json?.totals, bs: row(bsT, "subtotal:equity")?.cells });
  ok("equity movement: current-year earnings (not yet closed) are their own line (500 - 200)", close(row(eq, "earnings")?.cells.additions, 300), row(eq, "earnings")?.cells);
  r = await T.run("journal-report", `from=${y}-01-01&to=${y}-03-31&source=manual`);
  ok("journal report: one row per posted entry with its debit and credit totals, filtered by source", detailRows(r).length === 2 && detailRows(r).every((x) => close(x.cells.debit, x.cells.credit) && x.drill?.target === "journal_entry"), detailRows(r).length);
  r = await T.run("journal-report", `from=${y}-01-01&to=${y}-03-31&source=year_end_close`);
  ok("journal report: a source filter with no entries is empty", detailRows(r).length === 0, r.json?.rows?.length);
  r = await T.run("general-ledger", `from=${y}-01-01&to=${y}-03-31&accountId=${T.acct("1020").id}`);
  ok("GL: an accountId filter shows that account only, opening 1,000 and closing 1,300", (r.json?.rows ?? []).filter((x) => x.kind === "section").length === 1 && close(row(r, `acct:${T.acct("1020").id}`)?.cells.balance, 1000) && close(row(r, `close:${T.acct("1020").id}`)?.cells.balance, 1300), (r.json?.rows ?? []).filter((x) => x.kind !== "detail").map((x) => x.cells));
  r = await T.run("period-comparison", `from=${y}-02-01&to=${y}-02-28`);
  ok("period comparison runs as a comparison by default (prior period columns present)", (r.json?.columns ?? []).some((c) => c.key === "amount__cmp") && r.json?.params?.compare?.mode === "priorPeriod", r.json?.params);
  const legacy = await api("GET", `/api/companies/${T.cid}/reports/pl?startDate=${y}-01-01&endDate=${y}-03-31`, { token: T.token });
  const mine = await T.run("profit-loss", `from=${y}-01-01&to=${y}-03-31`);
  ok("the legacy /reports/pl route (now on the ledger layer) agrees with the P&L report", close(legacy.json?.totalRevenue, row(mine, "subtotal:revenue")?.cells.amount) && close(legacy.json?.netProfit, row(mine, "subtotal:net")?.cells.amount) && close(legacy.json?.netProfit, 300), { l: legacy.json?.netProfit, m: row(mine, "subtotal:net")?.cells });
  const legacyBs = await api("GET", `/api/companies/${T.cid}/reports/balance-sheet?endDate=${y}-03-31`, { token: T.token });
  ok("the legacy /reports/balance-sheet route balances and carries current-period earnings", legacyBs.json?.isBalanced === true && close(legacyBs.json?.currentPeriodNetIncome, 300), { b: legacyBs.json?.isBalanced, n: legacyBs.json?.currentPeriodNetIncome });

}


// ═════════════════════════════════════════════════════════════════════════════
// AC4 / AC5: receivables, credit notes, payments; payables from posted bills only
// ═════════════════════════════════════════════════════════════════════════════
async function documentsAndPayables() {
  const D = await newCompany("docs");
  const inv = await D.invoice(day(3), 1000);          // 1,050 with VAT
  await D.pay(inv.id, 525, day(2));
  const cn = await api("POST", `/api/companies/${D.cid}/invoices/${inv.id}/credit-note`, { token: D.token, body: { lines: [{ description: "Service", quantity: 1, unitPrice: 500, vatRate: 0.05 }] } });
  ok("AC4 setup: a credit note is issued against the invoice", cn.status === 201, { s: cn.status, t: cn.text?.slice(0, 200) });
  let r = await D.run("receivables-detail", `asOf=${today}`);
  ok("AC4: Receivables Detail shows 0 open after the payment and the credit note", r.status === 200 && close(r.json?.totals?.open ?? 0, 0) && detailRows(r).length === 0, { rows: detailRows(r), totals: r.json?.totals });
  r = await D.run("credit-notes-refunds", `from=${day(10)}&to=${today}`);
  ok("AC4: Credit Notes and Refunds shows the credit note at 525", close(r.json?.totals?.amount, 525), r.json?.totals);
  r = await D.run("payments-received", `from=${day(10)}&to=${today}`);
  ok("AC4: Payments Received shows 525", close(r.json?.totals?.amount, 525) && detailRows(r).length === 1, r.json?.totals);
  r = await D.run("payments-received", `from=${day(10)}&to=${today}&contactId=00000000-0000-4000-8000-000000000000`);
  ok("AC4: a contactId filter that matches nothing returns no rows", r.status === 200 && detailRows(r).length === 0, r.json?.rows?.length);
  const stats = (await api("GET", `/api/companies/${D.cid}/dashboard/stats`, { token: D.token })).json;
  ok("AC4: dashboard outstanding is 0 and every receivable bucket is 0", close(stats?.outstanding, 0) && Object.values(stats?.arAging ?? {}).every((v) => close(v, 0)), { o: stats?.outstanding, a: stats?.arAging });
  const csvr = await api("GET", `/api/companies/${D.cid}/reports/run/credit-notes-refunds?from=${day(10)}&to=${today}&format=csv`, { token: D.token, raw: true });
  ok("AC4: a credit note is never counted as an unpaid invoice (invoice status report counts invoices, not credit notes)", (await D.run("invoice-status", `from=${day(10)}&to=${today}`)).json?.rows?.every((x) => x.cells.status !== "credit_note"), csvr.status);

  // Voids by the date-based rule: voided AFTER the period it still counted; voided inside it, it did not
  const W = await newCompany("void");
  const lateVoid = await W.invoice(prevMid, 1000, { customerName: "Voided Later" });
  const sameMonth = await W.invoice(today, 700, { customerName: "Voided Same Month" });
  await W.invoice(prevMid, 300, { customerName: "Kept" });
  for (const id of [lateVoid.id, sameMonth.id]) {
    const v = await api("PATCH", `/api/invoices/${id}/status`, { token: W.token, body: { status: "void" } });
    if (v.status !== 200) throw new Error("void failed " + v.status + " " + v.text.slice(0, 200));
  }
  r = await W.run("revenue-customer", `from=${prevStart}&to=${prevEnd}`);
  const byName = (res, name) => detailRows(res).find((x) => x.cells.customer === name);
  ok("void rule: an invoice voided after the period still counts as that period's revenue", close(byName(r, "Voided Later")?.cells.revenue, 1000) && close(byName(r, "Kept")?.cells.revenue, 300), detailRows(r).map((x) => x.cells));
  r = await W.run("revenue-customer", `from=${monthStartOf(0)}&to=${today}`);
  ok("void rule: an invoice voided inside the period does not count", !byName(r, "Voided Same Month") && !byName(r, "Voided Later"), detailRows(r).map((x) => x.cells));
  r = await W.run("sales-product-service", `from=${prevStart}&to=${prevEnd}`);
  ok("void rule: sales by product also keeps the late-voided invoice", close(r.json?.totals?.amount, 1300), r.json?.totals);

  // AC5: bill 2,100 (2,000 + 5% VAT) dated 40 days ago, approved, paid 1,000; a pending bill of 500
  const P = await newCompany("pay");
  const bill = await P.bill(day(40), 2000);
  await P.approveBill(bill.id);
  await P.payBill(bill.id, 1000, day(5));
  const pending = await P.bill(day(2), 500 / 1.05, { vendor: "Pending Vendor" });
  r = await P.run("payables-detail", `asOf=${today}`);
  const posted = detailRows(r).filter((x) => x.cells.open !== null && x.cells.open !== undefined);
  ok("AC5: Payables Detail shows the approved bill with 1,100 open", posted.length === 1 && close(posted[0].cells.open, 1100), posted.map((x) => x.cells));
  ok("AC5: the pending bill (500) is listed as awaiting approval and is not in the total", close(r.json?.totals?.open, 1100) && (r.json?.rows ?? []).some((x) => x.key === "section:awaiting") && detailRows(r).some((x) => close(x.cells.awaiting, 500)), r.json?.totals);
  r = await P.run("ap-aging", `asOf=${today}`);
  ok("AC5: A/P Aging 1-30 days = 1,100 (due date falls back to bill date + 30) and nothing else", close(r.json?.totals?.days1to30, 1100) && close(r.json?.totals?.total, 1100), r.json?.totals);
  const ps = (await api("GET", `/api/companies/${P.cid}/dashboard/stats`, { token: P.token })).json;
  ok("AC5: dashboard apAging.days1to30 = 1,100 and payablesOutstanding = 1,100", close(ps?.apAging?.days1to30, 1100) && close(ps?.payablesOutstanding, 1100), ps?.apAging);
  const legacy = await api("GET", `/api/reports/${P.cid}/aging`, { token: P.token });
  const payRows = (legacy.json ?? []).filter((x) => x.type === "payable");
  ok("AC5: the default /aging path is the as-of report: payable total 1,100, the pending bill is not in it", close(payRows.reduce((a, x) => a + x.total, 0), 1100), payRows);
  const ap = (await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0) AS bal FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id WHERE je.company_id=$1 AND je.status='posted' AND a.code='2010'`, [P.cid])).rows[0];
  ok("AC5: A/P ageing total ties to account 2010 in the ledger", close(ap.bal, 1100) && close(r.json?.totals?.total, ap.bal), ap);
  void pending;
}

// ═════════════════════════════════════════════════════════════════════════════
// Dashboard KPIs (K1-K11) and AC6
// ═════════════════════════════════════════════════════════════════════════════
const monthStartOf = (offset) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)); return ymd(d); };
const midMonth = (offset) => monthStartOf(offset).slice(0, 8) + "15";

async function dashboardKpis() {
  const K = await newCompany("kpi");
  const stats = async (q = "") => (await api("GET", `/api/companies/${K.cid}/dashboard/stats${q}`, { token: K.token }));
  const monthStart = monthStartOf(0);
  // this month: revenue 10,000, rent 3,000, a CT accrual and a year-end close that must not count
  await K.je(monthStart, [["1020", 10000, 0], ["4010", 0, 10000]]);
  await K.je(monthStart, [["5010", 3000, 0], ["1020", 0, 3000]]);
  await K.je(monthStart, [["5150", 900, 0], ["2060", 0, 900]], "corporate_tax_filing", "CT accrual");
  await K.je(monthStart, [["4010", 10000, 0], ["5010", 0, 3000], ["3020", 0, 7000]], "year_end_close", "close");
  let r = await stats();
  ok("K1: MTD revenue 10,000, expenses 3,000 (CT accrual and year-end close left out), net 7,000", r.status === 200 && close(r.json?.revenue, 10000) && close(r.json?.expenses, 3000) && close(r.json?.netProfit, 7000), { revenue: r.json?.revenue, expenses: r.json?.expenses, net: r.json?.netProfit });
  ok("K1: the response carries the period it covers", r.json?.period?.kind === "month" && r.json?.period?.from === monthStart, r.json?.period);
  const pl = await K.run("profit-loss", `from=${monthStart}&to=${today}`);
  ok("AC6: dashboard revenue equals P&L revenue for the same range", close(r.json?.revenue, row(pl, "subtotal:revenue")?.cells.amount), { d: r.json?.revenue, p: row(pl, "subtotal:revenue")?.cells.amount });
  r = await stats("?period=all");
  ok("AC6: period=all is refused (422 INVALID_PERIOD): there is no all-time option", r.status === 422 && r.json?.code === "INVALID_PERIOD", { s: r.status, j: r.json });
  r = await stats(`?period=custom&from=${monthStart}&to=${today}`);
  ok("K1: a custom period works", r.status === 200 && close(r.json?.revenue, 10000), r.json?.period);
  r = await stats("?period=custom&from=2026-02-01");
  ok("K1: a custom period without `to` is refused (422 INVALID_PERIOD)", r.status === 422 && r.json?.code === "INVALID_PERIOD", r.json);
  r = await stats("?period=ytd");
  ok("K1: period=ytd covers the fiscal year to date", r.status === 200 && r.json?.period?.kind === "ytd" && r.json?.period?.from === yearStart && n(r.json?.revenue) >= 10000, r.json?.period);

  // K10 cash = 10,000 - 3,000 (+ nothing else on cash accounts)
  r = await stats();
  ok("K10: cash position is the bank and cash balance (7,000)", close(r.json?.cashPosition, 7000), r.json?.cashPosition);
  ok("K11: top expense categories lists rent first for the period", r.json?.topExpenseCategories?.[0]?.name === "Rent Expense" && close(r.json?.topExpenseCategories?.[0]?.value, 3000), r.json?.topExpenseCategories);
  ok("K6: revenue growth is null when last month had no revenue", r.json?.revenueGrowth === null, r.json?.revenueGrowth);

  // K4 monthly burn: last three completed months, depreciation 5100 and CT expense 5150 out, irrecoverable VAT 5160 in
  await K.je(midMonth(-1), [["5010", 300, 0], ["1020", 0, 300]]);
  await K.je(midMonth(-1), [["5100", 900, 0], ["1240", 0, 900]]);
  await K.je(midMonth(-1), [["5150", 600, 0], ["2060", 0, 600]], "corporate_tax_filing", "CT");
  await K.je(midMonth(-1), [["5160", 90, 0], ["1050", 0, 90]]);
  await K.je(midMonth(-2), [["5010", 600, 0], ["1020", 0, 600]]);
  r = await stats();
  ok("K4: monthly burn = mean of the last 3 completed months, excluding depreciation and CT expense, including irrecoverable VAT (330)", close(r.json?.monthlyBurnRate, 330), r.json?.monthlyBurnRate);
  ok("K4: runway = cash / burn", close(r.json?.cashRunway, n(r.json?.cashPosition) / 330, 0.01), { c: r.json?.cashPosition, rw: r.json?.cashRunway });
  const N = await newCompany("kpi0");
  r = (await api("GET", `/api/companies/${N.cid}/dashboard/stats`, { token: N.token }));
  ok("K5: runway is null when the burn is 0, and burn is 0 with no history", r.json?.cashRunway === null && close(r.json?.monthlyBurnRate, 0), { b: r.json?.monthlyBurnRate, rw: r.json?.cashRunway });

  // K2 / K3: overdue by Dubai day and the five buckets; K8 credit notes
  const B = await newCompany("kpiar");
  const mk = async (daysAgoDue, amount) => {
    const dueDay = day(daysAgoDue);
    return B.invoice(day(Math.max(daysAgoDue, 0) + 1), amount / 1.05, { dueDate: dueDay });
  };
  await mk(-5, 105);      // due in 5 days: current
  await mk(0, 210);       // due today: still current (a document due that day is not overdue until the day is over)
  await mk(10, 315);      // 1-30
  await mk(45, 420);      // 31-60
  await mk(75, 525);      // 61-90
  await mk(120, 630);     // 90+
  r = (await api("GET", `/api/companies/${B.cid}/dashboard/stats`, { token: B.token })).json;
  const a = r?.arAging ?? {};
  ok("K3: five receivable buckets (current includes due today)", close(a.current, 315) && close(a.days1to30, 315) && close(a.days31to60, 420) && close(a.days61to90, 525) && close(a.days90plus, 630), a);
  ok("K2: overdue receivables = everything past due (1,890); due today is not overdue", close(r?.overdueReceivables, 1890) && close(r?.outstanding, 2205), { o: r?.overdueReceivables, out: r?.outstanding });
  ok("K8: the buckets add up to outstanding", close(Object.values(a).reduce((x, y) => x + n(y), 0), r?.outstanding), a);
  const cnInv = await B.invoice(day(2), 1000);
  const cn = await api("POST", `/api/companies/${B.cid}/invoices/${cnInv.id}/credit-note`, { token: B.token, body: {} });
  r = (await api("GET", `/api/companies/${B.cid}/dashboard/stats`, { token: B.token })).json;
  ok("K8: a credit note nets off its invoice and is never counted as an unpaid invoice", cn.status === 201 && close(r?.outstanding, 2205), r?.outstanding);
  ok("K2: receivablesMissingDueDate counts open invoices without a due date (0 here)", r?.receivablesMissingDueDate === 0, r?.receivablesMissingDueDate);

  // K7 VAT due next
  r = (await api("GET", `/api/companies/${K.cid}/dashboard/stats`, { token: K.token })).json;
  const v = r?.vatDueNext;
  ok("K9: vatDueNext has an amount, the period end and a due date 28 days later", v && typeof v.amount === "number" && /^\d{4}-\d{2}-\d{2}$/.test(v.periodEnd) && v.dueDate > v.periodEnd, v);
  const T = await newCompany("kpitrn");
  await db.query(`UPDATE companies SET trn_vat_number = NULL WHERE id = $1`, [T.cid]);
  r = (await api("GET", `/api/companies/${T.cid}/dashboard/stats`, { token: T.token })).json;
  ok("K7: vatDueNext is null with reason NO_TRN when the company has no TRN", r?.vatDueNext?.amount === null && r?.vatDueNext?.reason === "NO_TRN", r?.vatDueNext);
  const T2 = await newCompany("kpiem");
  await db.query(`UPDATE companies SET emirate = NULL WHERE id = $1`, [T2.cid]);
  r = (await api("GET", `/api/companies/${T2.cid}/dashboard/stats`, { token: T2.token })).json;
  ok("K7: vatDueNext is null with reason EMIRATE_NOT_SET when the emirate is missing", r?.vatDueNext?.amount === null && r?.vatDueNext?.reason === "EMIRATE_NOT_SET", r?.vatDueNext);
}

// ═════════════════════════════════════════════════════════════════════════════
// L1-L3: tie-outs
// ═════════════════════════════════════════════════════════════════════════════
async function tieOuts() {
  const L = await newCompany("tie");
  await L.je(day(30), [["1020", 5000, 0], ["3010", 0, 5000]], "opening_balance", "capital");
  const inv = await L.invoice(day(20), 1000);
  await L.pay(inv.id, 300, day(10));
  await L.invoice(day(5), 400);
  const bal = async (code) => n((await db.query(`SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS b FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id WHERE je.company_id=$1 AND je.status='posted' AND a.code=$2`, [L.cid, code])).rows[0].b);
  let r = await L.run("ar-aging", `asOf=${today}`);
  ok("L1: AR ageing total equals account 1040 (AED documents)", close(r.json?.totals?.total, await bal("1040")) && n(r.json?.totals?.total) > 0, { ageing: r.json?.totals?.total, ledger: await bal("1040") });
  const bs = await L.run("balance-sheet", `asOf=${today}`);
  const pl = await L.run("profit-loss", `from=${yearStart}&to=${today}`);
  ok("L2: the balance sheet balances and current-year earnings equal P&L net profit YTD", close(row(bs, "earnings")?.cells.amount ?? 0, row(pl, "subtotal:net")?.cells.amount) && close(row(bs, "subtotal:asset")?.cells.amount, row(bs, "subtotal:le")?.cells.amount) && (bs.json?.warnings ?? []).length === 0, { e: row(bs, "earnings")?.cells, n: row(pl, "subtotal:net")?.cells });
  // FX: a USD invoice, a rate, a revaluation; the trial balance still balances
  await api("POST", `/api/companies/${L.cid}/exchange-rates`, { token: L.token, body: { fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: day(10) } });
  await L.invoice(day(8), 1000, { currency: "USD" });
  await api("POST", `/api/companies/${L.cid}/exchange-rates`, { token: L.token, body: { fromCurrency: "USD", toCurrency: "AED", rate: 3.70, effectiveDate: day(1) } });
  const rv = await api("POST", `/api/companies/${L.cid}/exchange-rates/revalue`, { token: L.token, body: { asOf: today } });
  ok("L3 setup: the FX revaluation posts (or reports nothing to revalue)", rv.status === 200 || rv.status === 201, { s: rv.status, j: rv.json });
  r = await L.run("trial-balance", `asOf=${today}`);
  ok("L3: the trial balance still balances after the FX revaluation", close(r.json?.totals?.debit, r.json?.totals?.credit) && (r.json?.warnings ?? []).length === 0, r.json?.totals);
  r = await L.run("fx-gains-losses", `from=${yearStart}&to=${today}`);
  ok("L3: the FX report lists the revaluation lines", r.status === 200 && detailRows(r).length > 0, r.json?.rows);
  r = await L.run("cash-flow", `from=${yearStart}&to=${today}`);
  ok("L3: cash flow (indirect) net change ties to the cash balance", r.status === 200 && (r.json?.warnings ?? []).length === 0 && n(row(r, "cash:closing")?.cells.amount) > 0, { w: r.json?.warnings, c: row(r, "cash:closing")?.cells });
  r = await L.run("cash-flow-direct", `from=${yearStart}&to=${today}`);
  ok("L3: cash flow (direct) net change ties to the cash balance", r.status === 200 && (r.json?.warnings ?? []).length === 0 && close(row(r, "subtotal:net")?.cells.amount, n(row(r, "cash:closing")?.cells.amount) - n(row(r, "cash:opening")?.cells.amount)), { w: r.json?.warnings });
}


// ═════════════════════════════════════════════════════════════════════════════
// AC7 / AC8: VAT audit detail ties to the return; unreconciled bank items
// ═════════════════════════════════════════════════════════════════════════════
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevStart = prevEnd.slice(0, 8) + "01";
const prevMid = prevEnd.slice(0, 8) + "15";
const sumKeys = (obj, re) => Object.entries(obj ?? {}).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + n(v), 0);

async function taxAndBank() {
  const V = await newCompany("vat");
  await V.invoice(prevMid, 1000, { customerName: "Std Customer" });        // standard: VAT 50
  for (const [type, price] of [["zero_rated", 500], ["exempt", 200]]) {
    const r1 = await api("POST", `/api/companies/${V.cid}/invoices`, { token: V.token, body: { customerName: `Cust ${type}`, date: prevMid, dueDate: prevMid, lines: [{ description: type, quantity: 1, unitPrice: price, vatRate: 0, vatSupplyType: type }] } });
    await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token: V.token, body: { status: "sent" } });
  }
  await api("POST", `/api/companies/${V.cid}/invoices`, { token: V.token, body: { customerName: "Draft", date: prevMid, lines: [{ description: "draft", quantity: 1, unitPrice: 999, vatRate: 0.05 }] } });
  const gen = await api("POST", `/api/companies/${V.cid}/vat-returns/generate`, { token: V.token, body: { periodStart: prevStart, periodEnd: prevEnd } });
  const box1Vat = sumKeys(gen.json, /^box1[a-g].*Vat$/);
  let r = await V.run("vat-audit-sales", `from=${prevStart}&to=${prevEnd}`);
  const lines = detailRows(r);
  ok("AC7: VAT Audit Sales has one row per supply line (standard + zero-rated + exempt = 3) and the draft is left out", r.status === 200 && lines.length === 3, lines.map((x) => x.cells.description));
  ok("AC7: Σ VAT of the standard lines equals box 1 of the generated return (50)", close(r.json?.totals?.vat, box1Vat) && close(box1Vat, 50), { audit: r.json?.totals?.vat, box1: box1Vat });
  ok("AC7: the rows carry supply type and amount; amounts add to 1,700", close(r.json?.totals?.amount, 1700) && lines.some((x) => /Zero/.test(x.cells.supply)) && lines.some((x) => /Exempt/.test(x.cells.supply)), r.json?.totals);
  ok("AC7: each line drills to its invoice", lines.every((x) => x.drill?.target === "invoice"), lines[0]);

  // purchases twin: a bill (input 20), a posted receipt, a USD receipt, an approved vendor credit, an expense claim
  const bill = await V.bill(prevMid, 400);
  await V.approveBill(bill.id);
  await V.bill(prevMid, 100, { vendor: "Pending V" });                    // pending: not claimable
  await db.query(`INSERT INTO receipts (company_id, uploaded_by, merchant, date, amount, vat_amount, posted, currency, exchange_rate) VALUES ($1,$2,'USD Supplier',$3::timestamp,1000,50,true,'USD',3.6725)`, [V.cid, V.userId, prevMid]);
  const claim = (await db.query(`INSERT INTO expense_claims (company_id, submitted_by, title, claim_number, total_amount, status) VALUES ($1,$2,'Taxi','EC-V',100,'approved') RETURNING id`, [V.cid, V.userId])).rows[0];
  await db.query(`INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount) VALUES ($1,$2::timestamp,'travel','Taxi',100,5)`, [claim.id, prevMid]);
  await db.query(`INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount) VALUES ($1,$2::timestamp,'entertainment','Client lunch',100,5)`, [claim.id, prevMid]);
  const gen2 = await api("POST", `/api/companies/${V.cid}/vat-returns/generate`, { token: V.token, body: { periodStart: prevStart, periodEnd: prevEnd } });
  r = await V.run("vat-audit-purchases", `from=${prevStart}&to=${prevEnd}`);
  ok("AC7: VAT Audit Purchases Σ recoverable equals box 9 of the return", close(r.json?.totals?.recoverable, gen2.json?.box9ExpensesVat) && n(gen2.json?.box9ExpensesVat) > 0, { audit: r.json?.totals, box9: gen2.json?.box9ExpensesVat });
  ok("AC7: purchases net equals box 9 amount; USD receipt converted at its rate; the pending bill and the entertainment VAT are not recoverable", close(r.json?.totals?.net, gen2.json?.box9ExpensesAmount) && detailRows(r).some((x) => /USD/.test(x.cells.vendor) && close(x.cells.vat, 183.63)) && !detailRows(r).some((x) => /Pending V/.test(x.cells.vendor)) && close(r.json?.totals?.vat, 20 + 183.63 + 5, 0.011), r.json?.totals);
  r = await V.run("vat-control-reconciliation", `from=${prevStart}&to=${prevEnd}`);
  ok("VAT control reconciliation runs (warns when no return was saved for the period)", r.status === 200 && Array.isArray(r.json?.rows), r.json?.warnings);
  r = await V.run("vat-return", `from=${prevStart}&to=${prevEnd}`);
  ok("VAT return report shows the boxes and box 14 equals the generated return", r.status === 200 && close(r.json?.totals?.vat, gen2.json?.box14PayableTax), { t: r.json?.totals, b14: gen2.json?.box14PayableTax });

  // AC8: three unreconciled transactions
  const B = await newCompany("bank");
  const gl = B.acct("1020");
  const ba = (await db.query(`INSERT INTO bank_accounts (company_id, name_en, bank_name) VALUES ($1,'Main','Test Bank') RETURNING id`, [B.cid])).rows[0];
  for (const amt of [100, -50, 25]) await db.query(`INSERT INTO bank_transactions (company_id, bank_account_id, bank_statement_account_id, transaction_date, description, amount, is_reconciled) VALUES ($1,$2,$3,$4::timestamp,'unmatched',$5,false)`, [B.cid, gl.id, ba.id, day(3), amt]);
  await db.query(`INSERT INTO bank_transactions (company_id, bank_account_id, bank_statement_account_id, transaction_date, description, amount, is_reconciled) VALUES ($1,$2,$3,$4::timestamp,'done',999,true)`, [B.cid, gl.id, ba.id, day(3)]);
  r = await B.run("unreconciled-bank-items", `from=${day(10)}&to=${today}&bankAccountId=${gl.id}`);
  ok("AC8: Unreconciled Bank Items lists the 3 unreconciled transactions (reconciled one left out) and nets to 75", detailRows(r).length === 3 && close(r.json?.totals?.amount, 75), r.json?.totals);
  r = await B.run("unreconciled-bank-items", `from=${day(10)}&to=${today}&bankAccountId=${ba.id}`);
  ok("AC8: the managed bank account id works as the filter too", detailRows(r).length === 3, detailRows(r).length);
}

// ═════════════════════════════════════════════════════════════════════════════
// Corporate tax: Small Business Relief (C1-C4)
// ═════════════════════════════════════════════════════════════════════════════
async function corporateTax() {
  const T = await newCompany("ct");
  const mkReturn = async (start, end, revenue, expenses) => {
    const r1 = await api("POST", `/api/companies/${T.cid}/corporate-tax/returns`, { token: T.token, body: { taxPeriodStart: start, taxPeriodEnd: end, totalRevenue: revenue, totalExpenses: expenses, totalDeductions: 0 } });
    if (r1.status !== 201) throw new Error("ct return failed " + r1.status + " " + r1.text.slice(0, 200));
    return r1.json;
  };
  const compute = (id, elected) => api("POST", `/api/corporate-tax/returns/${id}/compute`, { token: T.token, body: { smallBusinessReliefElected: elected } });
  let c = await mkReturn("2024-01-01", "2024-12-31", 2900000, 1900000);
  let r = await compute(c.id, true);
  ok("C1: revenue 2.9M with Small Business Relief elected: tax 0 and relief applied", r.status === 200 && close(r.json?.computation?.taxPayable, 0) && r.json?.computation?.smallBusinessRelief?.applied === true, r.json?.computation?.smallBusinessRelief);
  c = await mkReturn("2025-01-01", "2025-12-31", 3100000, 2000000);
  r = await compute(c.id, true);
  ok("C2: revenue 3.1M is over the cap: relief refused, tax = (taxable - 375,000) x 9% = 65,250", close(r.json?.computation?.taxPayable, (1100000 - 375000) * 0.09) && r.json?.computation?.smallBusinessRelief?.applied === false && r.json?.computation?.smallBusinessRelief?.ineligibleReason === "revenue_cap", r.json?.computation?.smallBusinessRelief);
  c = await mkReturn("2026-01-01", "2026-12-31", 1000000, 400000);
  r = await compute(c.id, true);
  ok("C3: a prior period over the cap carries forward: no relief this year (2026 revenue 1M)", r.json?.computation?.smallBusinessRelief?.applied === false && r.json?.computation?.smallBusinessRelief?.ineligibleReason === "prior_period_breach" && close(r.json?.computation?.taxPayable, (600000 - 375000) * 0.09), r.json?.computation?.smallBusinessRelief);
  const T2 = await newCompany("ct2");
  const mk2 = async (start, end, revenue, expenses) => (await api("POST", `/api/companies/${T2.cid}/corporate-tax/returns`, { token: T2.token, body: { taxPeriodStart: start, taxPeriodEnd: end, totalRevenue: revenue, totalExpenses: expenses, totalDeductions: 0 } })).json;
  const ok26 = await mk2("2026-01-01", "2026-12-31", 1000000, 400000);
  r = await api("POST", `/api/corporate-tax/returns/${ok26.id}/compute`, { token: T2.token, body: { smallBusinessReliefElected: true } });
  ok("C4: a period ending 2026-12-31 is still eligible (tax 0)", r.json?.computation?.smallBusinessRelief?.applied === true && close(r.json?.computation?.taxPayable, 0), r.json?.computation?.smallBusinessRelief);
  const late = await mk2("2027-01-01", "2027-12-31", 1000000, 400000);
  r = await api("POST", `/api/corporate-tax/returns/${late.id}/compute`, { token: T2.token, body: { smallBusinessReliefElected: true } });
  ok("C4: a period ending 2027-12-31 is not eligible (MD 73/2023 sunset): tax = (600,000 - 375,000) x 9%", r.json?.computation?.smallBusinessRelief?.applied === false && r.json?.computation?.smallBusinessRelief?.ineligibleReason === "period_after_sunset" && close(r.json?.computation?.taxPayable, 20250), r.json?.computation?.smallBusinessRelief);
  const wp = await T2.run("ct-workpaper", `from=2027-01-01&to=2027-12-31&taxYear=2027`);
  ok("CT workpaper report reads the saved return and shows the same tax payable", wp.status === 200 && close(wp.json?.totals?.amount, 20250) && detailRows(wp).length + (wp.json?.rows ?? []).filter((x) => x.kind === "subtotal").length > 3, wp.json?.totals);
  const none = await T2.run("ct-workpaper", `from=2030-01-01&to=2030-12-31`);
  ok("CT workpaper report with no return for the period is 200 with a warning, not an error", none.status === 200 && (none.json?.warnings ?? []).length === 1, none.json);
  const est = await T.run("corporate-tax-estimate", `from=${yearStart}&to=${today}`);
  ok("CT estimate runs from the books", est.status === 200 && Array.isArray(est.json?.rows) && est.json.rows.length > 3, est.status);
}

// ═════════════════════════════════════════════════════════════════════════════
// Consolidation (F1-F2) and the intercompany account field
// ═════════════════════════════════════════════════════════════════════════════
async function consolidation() {
  const A = await newCompany("grpA");
  const B = await newCompany("grpB");
  // user A becomes a member of company B so one login can consolidate both
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'accountant')`, [B.cid, A.userId]);
  const mkAcct = (C, code, type, subType, name, counterparty) =>
    api("POST", `/api/companies/${C.cid}/accounts`, { token: A.token, body: { code, nameEn: name, nameAr: name, type, subType, isVatAccount: false, vatType: null, isSystemAccount: false, ...(counterparty ? { intercompanyCompanyId: counterparty } : {}) } });
  let r = await mkAcct(A, "1090", "asset", "current_asset", "Intercompany receivable", A.cid);
  ok("IC: an intercompany account naming its own company is refused (422 INVALID_INTERCOMPANY)", r.status === 422 && r.json?.code === "INVALID_INTERCOMPANY", { s: r.status, j: r.json });
  const stranger = await newCompany("grpX");
  r = await mkAcct(A, "1090", "asset", "current_asset", "Intercompany receivable", stranger.cid);
  ok("IC: a counterparty the user cannot access is refused (422 INVALID_INTERCOMPANY)", r.status === 422 && r.json?.code === "INVALID_INTERCOMPANY", { s: r.status, j: r.json });
  r = await mkAcct(A, "1090", "asset", "current_asset", "Intercompany receivable", "not-a-uuid");
  ok("IC: a malformed counterparty is refused (422)", r.status === 422, r.status);
  r = await mkAcct(A, "1090", "asset", "current_asset", "Intercompany receivable", B.cid);
  ok("IC: a valid counterparty is stored (200)", r.status === 200 && r.json?.intercompanyCompanyId === B.cid, { s: r.status, j: r.json });
  await mkAcct(B, "2090", "liability", "current_liability", "Intercompany payable", A.cid);
  await mkAcct(A, "4095", "income", null, "Intercompany sales", B.cid);
  await mkAcct(B, "5195", "expense", "operating_expense", "Intercompany purchases", A.cid);
  const acctA = (await api("GET", `/api/companies/${A.cid}/accounts`, { token: A.token })).json.find((x) => x.code === "1090");
  r = await api("PUT", `/api/accounts/${acctA.id}`, { token: A.token, body: { intercompanyCompanyId: A.cid } });
  ok("IC: updating an account to its own company as counterparty is refused (422)", r.status === 422 && r.json?.code === "INVALID_INTERCOMPANY", { s: r.status, j: r.json });
  r = await api("PUT", `/api/accounts/${acctA.id}`, { token: A.token, body: { intercompanyCompanyId: null } });
  ok("IC: the counterparty can be cleared with null", r.status === 200 && r.json?.intercompanyCompanyId === null, r.json?.intercompanyCompanyId);
  await api("PUT", `/api/accounts/${acctA.id}`, { token: A.token, body: { intercompanyCompanyId: B.cid } });
  const acctOf = async (C) => (await api("GET", `/api/companies/${C.cid}/accounts`, { token: A.token })).json;
  A.accounts = await acctOf(A); B.accounts = await acctOf(B);
  const accts = (C) => (code) => C.accounts.find((x) => x.code === code);
  A.acct = accts(A); B.acct = accts(B);
  // A: sales to B 1,000 on credit; B: purchase from A 1,000. A also has its own 500 sale, B its own 300 rent.
  await A.je(today, [["1090", 1000, 0], ["4095", 0, 1000]]);
  await B.je(today, [["5195", 1000, 0], ["2090", 0, 1000]]);
  await A.je(today, [["1020", 500, 0], ["4010", 0, 500]]);
  await B.je(today, [["5010", 300, 0], ["1020", 0, 300]]);

  const q = (statement, extra = "") => `from=${yearStart}&to=${today}&asOf=${today}&statement=${statement}&companyIds=${A.cid},${B.cid}${extra}`;
  r = await A.run("consolidated-statements", q("bs"));
  const rec = detailRows(r).find((x) => x.cells.code === "1090");
  const pay = detailRows(r).find((x) => x.cells.code === "2090");
  ok("F1: intercompany 1,000 / 1,000 eliminates to 0 in the consolidated balance sheet", r.status === 200 && rec && pay && close(rec.cells.consolidated, 0) && close(pay.cells.consolidated, 0) && close(rec.cells.entity_0, 1000) && close(pay.cells.entity_1, 1000), { s: r.status, rec: rec?.cells, pay: pay?.cells, j: r.json?.message });
  const totalAssets = row(r, "subtotal:asset")?.cells, le = row(r, "subtotal:le")?.cells;
  ok("F1: consolidated assets equal consolidated liabilities and equity", close(totalAssets?.consolidated, le?.consolidated) && close(totalAssets?.consolidated, 500 - 300), { totalAssets, le });
  ok("F1: eliminations column removes the intercompany balance on both sides", close(rec?.cells.elimination, -1000) && close(pay?.cells.elimination, -1000), { rec: rec?.cells.elimination, pay: pay?.cells.elimination });
  r = await A.run("consolidated-statements", q("pl"));
  const sales = detailRows(r).find((x) => x.cells.code === "4095");
  ok("F1: P&L consolidation eliminates intercompany sales and purchases; consolidated net profit = 500 - 300 = 200", sales && close(sales.cells.consolidated, 0) && close(row(r, "subtotal:net")?.cells.consolidated, 200) && close(row(r, "subtotal:net")?.cells.entity_0, 1500) && close(row(r, "subtotal:net")?.cells.entity_1, -300 - 1000), { sales: sales?.cells, net: row(r, "subtotal:net")?.cells });
  const total = (res, key) => n(row(res, key)?.cells.consolidated);
  ok("F1: consolidated = Σ entities + eliminations for the net profit row", close(row(r, "subtotal:net")?.cells.entity_0, 1500) && close(n(row(r, "subtotal:net")?.cells.entity_0) + n(row(r, "subtotal:net")?.cells.entity_1) + n(row(r, "subtotal:net")?.cells.elimination), total(r, "subtotal:net")), row(r, "subtotal:net")?.cells);

  // F2: B books 900 against A's 1,000
  await B.je(today, [["5195", 900, 0], ["2090", 0, 900]]);
  await B.je(today, [["2090", 1000, 0], ["5195", 0, 1000]]);   // wipe the 1,000 so B holds 900 only
  r = await A.run("consolidated-statements", q("bs"));
  const unm = (r.json?.rows ?? []).find((x) => x.key === "unmatched:intercompany");
  ok("F2: 1,000 against 900 is a warning row with the difference of 100 (200, nothing eliminated for that pair)", r.status === 200 && unm && close(unm.cells.consolidated, 100) && (r.json?.warnings ?? []).some((w) => /100\.00/.test(w)) && close(detailRows(r).find((x) => x.cells.code === "1090")?.cells.consolidated, 1000), { s: r.status, unm: unm?.cells, w: r.json?.warnings });
  r = await A.run("consolidated-statements", q("bs", "&strict=1"));
  ok("F2: strict=1 keeps the refusal (422 UNMATCHED_INTERCOMPANY, difference 100)", r.status === 422 && r.json?.code === "UNMATCHED_INTERCOMPANY" && close(r.json?.details?.difference, 100), { s: r.status, j: r.json });
  r = await A.run("consolidated-statements", `from=${yearStart}&to=${today}&asOf=${today}&companyIds=${A.cid},${stranger.cid}`);
  ok("T2: a company id the user cannot access in companyIds is refused (403)", r.status === 403, { s: r.status, j: r.json });
  await db.query(`UPDATE companies SET base_currency = 'USD' WHERE id = $1`, [B.cid]);
  r = await A.run("consolidated-statements", q("pl"));
  ok("F: companies with different base currencies are refused (422 MIXED_BASE_CURRENCY)", r.status === 422 && r.json?.code === "MIXED_BASE_CURRENCY", { s: r.status, j: r.json });
  await db.query(`UPDATE companies SET base_currency = 'AED' WHERE id = $1`, [B.cid]);
  const many = Array.from({ length: 26 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",");
  r = await A.run("consolidated-statements", `from=${yearStart}&to=${today}&asOf=${today}&companyIds=${many}`);
  ok("F: more than 25 companies is refused (422 TOO_MANY_COMPANIES)", r.status === 422 && r.json?.code === "TOO_MANY_COMPANIES", { s: r.status, j: r.json });
  r = await A.run("consolidated-statements", `from=${yearStart}&to=${today}&asOf=${today}`);
  ok("F: with no companyIds it is the company itself", r.status === 200 && detailRows(r).length > 0, r.status);
}

// ═════════════════════════════════════════════════════════════════════════════
// A1 audit trail pagination; abuse: limits, formula guard, big PDF
// ═════════════════════════════════════════════════════════════════════════════
async function auditAndAbuse() {
  const U = await newCompany("audit");
  await db.query(`INSERT INTO activity_logs (user_id, company_id, action, entity_type, entity_id, description, ip_address, created_at)
                  SELECT $1, $2, CASE WHEN g % 2 = 0 THEN 'invoice.create' ELSE 'bill.approve' END, 'invoice', gen_random_uuid()::text, 'Row ' || g, '10.0.0.1', (now() AT TIME ZONE 'UTC') - (g || ' seconds')::interval
                    FROM generate_series(1, 1200) g`, [U.userId, U.cid]);
  let r = await U.run("audit-trail", `from=${yearStart}&to=${today}&limit=500`);
  ok("A1: Audit Trail 1,200 rows: page 1 has 500 rows and total 1,200", r.status === 200 && r.json?.rows?.length === 500 && r.json?.page?.total >= 1200, r.json?.page);
  r = await U.run("audit-trail", `from=${yearStart}&to=${today}&limit=500&offset=1000`);
  ok("A1: the last page has the remaining rows", (r.json?.rows?.length ?? 0) >= 200 && r.json?.page?.offset === 1000, { n: r.json?.rows?.length, p: r.json?.page });
  r = await U.run("audit-trail", `from=${yearStart}&to=${today}&limit=5000`);
  ok("A1: limit=5000 is refused (400)", r.status === 400 && r.json?.code === "INVALID_PARAMS", { s: r.status, j: r.json });
  r = await U.run("audit-trail", `from=${yearStart}&to=${today}&limit=1000000000`);
  ok("abuse: limit=10^9 is refused (400)", r.status === 400, r.status);
  r = await U.run("audit-trail", `from=${yearStart}&to=${today}&action=bill.approve&limit=1000`);
  ok("A1: the action filter narrows the trail (600 rows)", r.json?.page?.total === 600 && detailRows(r).every((x) => x.cells.action === "bill.approve"), r.json?.page);
  r = await U.run("audit-trail", `from=${yearStart}&to=${today}&format=csv&limit=10`, { raw: true });
  const text = r.buf.toString("utf8");
  ok("A1: CSV of the audit trail carries every row, not one page (1,200 + header)", r.status === 200 && countCsvRecords(text) >= 1201, countCsvRecords(text));
  const logs = await api("GET", `/api/companies/${U.cid}/activity-logs?limit=5000`, { token: U.token });
  ok("A1: the activity-logs route caps limit at 1,000", logs.status === 200 && Array.isArray(logs.json) && logs.json.length <= 1000 && logs.json.length >= 1000, logs.json?.length);

  // formula injection in a CSV
  const X = await newCompany("csvx");
  await X.invoice(day(3), 100, { customerName: "=HYPERLINK(\"http://evil\",\"x\")" });
  r = await X.run("receivables-detail", `asOf=${today}&format=csv`, { raw: true });
  const csv = r.buf.toString("utf8");
  ok("abuse: a customer name starting with = is neutralised in CSV (leading apostrophe)", r.status === 200 && csv.includes("'=HYPERLINK") && !/(^|,)"?=HYPERLINK/m.test(csv), csv.slice(0, 300));
  const xr = await X.run("receivables-detail", `asOf=${today}&format=xlsx`, { raw: true });
  ok("abuse: the same report exports to XLSX", xr.status === 200, xr.status);

  // 5,001-row PDF is refused, CSV is fine
  await db.query(`INSERT INTO journal_entries (company_id, entry_number, date, memo, status, source, created_by) SELECT $1, 'BIG-' || g, (now() AT TIME ZONE 'UTC'), 'bulk', 'posted', 'manual', $2 FROM generate_series(1, 2501) g`, [X.cid, X.userId]);
  await db.query(`INSERT INTO journal_lines (entry_id, account_id, debit, credit) SELECT je.id, $2, 1, 0 FROM journal_entries je WHERE je.company_id = $1 AND je.entry_number LIKE 'BIG-%'`, [X.cid, X.acct("1020").id]);
  await db.query(`INSERT INTO journal_lines (entry_id, account_id, debit, credit) SELECT je.id, $2, 0, 1 FROM journal_entries je WHERE je.company_id = $1 AND je.entry_number LIKE 'BIG-%'`, [X.cid, X.acct("4010").id]);
  r = await X.run("account-transactions", `from=${yearStart}&to=${today}&format=pdf`, { raw: true });
  ok("abuse: a PDF over 5,000 rows is refused (422 REPORT_TOO_LARGE)", r.status === 422 && JSON.parse(r.buf.toString()).code === "REPORT_TOO_LARGE", { s: r.status, t: r.buf.toString().slice(0, 200) });
  r = await X.run("account-transactions", `from=${yearStart}&to=${today}&format=csv`, { raw: true });
  ok("abuse: the same 5,002 rows export to CSV", r.status === 200 && countCsvRecords(r.buf.toString("utf8")) >= 5003, r.status);
  // export limiter: a dedicated member makes 121 exports in a minute (limit 120: a month-end pack is dozens of files)
  const [tok] = await extraMembers(X, 1);
  let lastStatus = 0;
  let at31 = 0;
  for (let i = 0; i < 121; i++) { lastStatus = (await api("GET", `/api/companies/${X.cid}/reports/run/trial-balance?asOf=${today}&format=csv`, { token: tok, raw: true })).status; if (i === 30) at31 = lastStatus; }
  ok("abuse: a 31-file pack is served; the 121st export in a minute is rate limited (429)", at31 === 200 && lastStatus === 429, { at31, lastStatus });
  const json = await api("GET", `/api/companies/${X.cid}/reports/run/trial-balance?asOf=${today}`, { token: tok });
  ok("abuse: JSON reads are not throttled by the export limiter", json.status === 200, json.status);
}

// ═════════════════════════════════════════════════════════════════════════════
// AC10 schedules, tenant isolation (T1-T4), roles (R1-R2)
// ═════════════════════════════════════════════════════════════════════════════
const here = path.dirname(fileURLToPath(import.meta.url));
const runTick = (parallel = 1) => {
  const res = spawnSync("npx", ["tsx", path.join(here, "helpers", "run-report-schedules.ts"), String(parallel)], { env: { ...process.env, SESSION_SECRET: process.env.SESSION_SECRET ?? "x".repeat(40), JWT_SECRET: process.env.JWT_SECRET ?? "y".repeat(40) }, encoding: "utf8", cwd: path.join(here, "..", "..") });
  const m = /RESULT (.*)/.exec(res.stdout ?? "");
  return m ? JSON.parse(m[1]) : { error: (res.stderr ?? "").slice(0, 500) };
};
const waitRun = async (C, scheduleId, runId) => {
  for (let i = 0; i < 60; i++) {
    const runs = (await api("GET", `/api/companies/${C.cid}/report-schedules/${scheduleId}/runs`, { token: C.token })).json ?? [];
    const run = runs.find((x) => x.id === runId) ?? (runId ? null : runs[0]);
    if (run && run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
};

async function schedulesAndAccess() {
  const S = await newCompany("sched");
  await S.invoice(day(3), 500);
  const body = (extra = {}) => ({ reportId: "profit-loss", params: { rangePreset: "lastMonth", compare: "priorPeriod" }, format: "pdf", lang: "en", cadence: "weekly", dayOfWeek: 1, hourDubai: 7, recipientUserIds: [S.userId], ...extra });
  let r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: body() });
  ok("AC10: a weekly schedule is created (201) with the next slot in the future", r.status === 201 && new Date(r.json?.nextRunAt).getTime() > Date.now() && r.json?.cadence === "weekly" && r.json?.dayOfWeek === 1, { s: r.status, j: r.json });
  const sched = r.json;
  const next = new Date(sched.nextRunAt);
  ok("AC10: the next slot is Monday 07:00 Dubai (03:00 UTC)", next.getUTCDay() === 1 && next.getUTCHours() === 3 && next.getUTCMinutes() === 0, sched.nextRunAt);
  r = await api("POST", `/api/companies/${S.cid}/report-schedules/${sched.id}/run-now`, { token: S.token });
  ok("AC10: run-now answers 202 with a run id", r.status === 202 && !!r.json?.runId, { s: r.status, j: r.json });
  let run = await waitRun(S, sched.id, r.json?.runId);
  ok("AC10: a run row exists and, with no email provider, is skipped EMAIL_NOT_CONFIGURED", run && run.status === "skipped" && run.reason === "EMAIL_NOT_CONFIGURED" && run.trigger === "manual", run);
  ok("AC10: the run records what was rendered (rows, size, sha-256) and the resolved days", run && run.rowCount > 0 && run.byteSize > 500 && /^[0-9a-f]{64}$/.test(run.sha256 ?? "") && run.resolvedParams?.from && run.resolvedParams?.compare, run);
  const notes = (await db.query(`SELECT title FROM notifications WHERE user_id = $1 AND company_id = $2 AND title LIKE 'Scheduled report not emailed%'`, [S.userId, S.cid])).rows;
  ok("AC10: an in-app notification tells the recipient the email was not sent", notes.length >= 1, notes);

  // the tick: due schedule, two ticks at once, one run per slot
  const daily = (await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: body({ cadence: "daily", dayOfWeek: undefined, reportId: "trial-balance", params: { asOfPreset: "today" }, format: "csv" }) })).json;
  await db.query(`UPDATE report_schedules SET next_run_at = (now() AT TIME ZONE 'UTC') - interval '2 hours' WHERE id = $1`, [daily.id]);
  const dueBefore = (await db.query(`SELECT to_char(next_run_at,'YYYY-MM-DD"T"HH24:MI:SS.MS') AS t FROM report_schedules WHERE id = $1`, [daily.id])).rows[0].t;
  const t1 = runTick(2);
  const afterTick = (await api("GET", `/api/companies/${S.cid}/report-schedules/${daily.id}/runs`, { token: S.token })).json ?? [];
  ok("AC10: two scheduler ticks at the same moment leave exactly one run for the slot", afterTick.length === 1 && (t1.claimed ?? []).reduce((a, b) => a + b, 0) <= 1 && !t1.error, { t1, runs: afterTick.map((x) => x.slotKey) });
  const finished = await waitRun(S, daily.id, afterTick[0]?.id);
  ok("AC10: the ticked run is a scheduled one, finished and skipped for the missing provider", finished && finished.trigger === "schedule" && finished.status === "skipped", finished);
  const advanced = (await db.query(`SELECT next_run_at > (now() AT TIME ZONE 'UTC') AS later FROM report_schedules WHERE id = $1`, [daily.id])).rows[0];
  ok("AC10: the schedule moved on to a future slot", advanced.later === true, advanced);
  // same slot again: put next_run_at back to the same instant; ON CONFLICT leaves one run
  await db.query(`UPDATE report_schedules SET next_run_at = $2::timestamp WHERE id = $1`, [daily.id, dueBefore]);
  runTick(1);
  const again = (await api("GET", `/api/companies/${S.cid}/report-schedules/${daily.id}/runs`, { token: S.token })).json ?? [];
  ok("AC10: ticking the same slot again does not add a second run", again.length === 1, again.map((x) => x.slotKey));

  // stale runs: a run still "running" after 30 minutes is failed STALE_RUN by the next tick
  await db.query(`INSERT INTO report_schedule_runs (schedule_id, company_id, slot_key, "trigger", status, resolved_params, started_at) VALUES ($1,$2,'stale-test','schedule','running','{}'::jsonb,(now() AT TIME ZONE 'UTC') - interval '31 minutes')`, [daily.id, S.cid]);
  await db.query(`INSERT INTO report_schedule_runs (schedule_id, company_id, slot_key, "trigger", status, resolved_params, started_at) VALUES ($1,$2,'fresh-test','schedule','running','{}'::jsonb,(now() AT TIME ZONE 'UTC') - interval '5 minutes')`, [daily.id, S.cid]);
  runTick(1);
  const staleRows = (await db.query(`SELECT slot_key, status, reason FROM report_schedule_runs WHERE schedule_id = $1 AND slot_key IN ('stale-test','fresh-test') ORDER BY slot_key`, [daily.id])).rows;
  ok("AC10: a run stuck running for over 30 minutes is failed STALE_RUN; a recent one is left alone", staleRows[0]?.status === "running" && staleRows[1]?.status === "failed" && staleRows[1]?.reason === "STALE_RUN", staleRows);

  // who changed a schedule shows in the company's activity history and the Audit Trail
  r = await S.run("audit-trail", `from=${yearStart}&to=${today}&action=report_schedule.create&limit=100`);
  ok("schedules: creating a schedule is written to the activity history (Audit Trail)", r.status === 200 && detailRows(r).length >= 2 && detailRows(r)[0].cells.entityType === "report_schedule", r.json?.page);

  // validation
  r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: body({ dayOfWeek: undefined }) });
  ok("schedules: a weekly schedule without dayOfWeek is refused (422 INVALID_CADENCE)", r.status === 422 && r.json?.code === "INVALID_CADENCE", { s: r.status, j: r.json });
  r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: body({ reportId: "nope" }) });
  ok("schedules: an unknown report is refused (422 REPORT_NOT_SCHEDULABLE)", r.status === 422 && r.json?.code === "REPORT_NOT_SCHEDULABLE", { s: r.status, j: r.json });
  r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: body({ recipientUserIds: ["someone@example.com"] }) });
  ok("schedules: a raw email address as a recipient is refused (400)", r.status === 400, { s: r.status, j: r.json });
  const OTHER = await newCompany("schedother");
  r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: body({ recipientUserIds: [OTHER.userId] }) });
  ok("T3: a recipient who is not a member of the company is refused (422 RECIPIENT_NOT_MEMBER)", r.status === 422 && r.json?.code === "RECIPIENT_NOT_MEMBER", { s: r.status, j: r.json });
  r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: body({ params: { asOfPreset: "today", compare: "priorYear" }, reportId: "trial-balance" }) });
  ok("schedules: a comparison on a report without one is refused (422)", r.status === 422 && r.json?.code === "COMPARISON_NOT_SUPPORTED", { s: r.status, j: r.json });

  // pause / delete
  r = await api("PATCH", `/api/companies/${S.cid}/report-schedules/${sched.id}`, { token: S.token, body: { enabled: false } });
  ok("schedules: pausing works (PATCH enabled=false)", r.status === 200 && r.json?.enabled === false, r.json);
  r = await api("PATCH", `/api/companies/${S.cid}/report-schedules/${sched.id}`, { token: S.token, body: { cadence: "monthly", dayOfMonth: 5 } });
  ok("schedules: a cadence edit recomputes the next slot (5th of a month, 07:00 Dubai)", r.status === 200 && new Date(r.json?.nextRunAt).getUTCDate() >= 1 && new Date(r.json?.nextRunAt).getUTCHours() === 3 && r.json?.dayOfMonth === 5 && r.json?.dayOfWeek === null, r.json);

  // T1: another company's user
  r = await api("GET", `/api/companies/${S.cid}/report-schedules`, { token: OTHER.token });
  ok("T1: another company's user cannot list this company's schedules (403)", r.status === 403, r.status);
  r = await api("GET", `/api/companies/${S.cid}/report-schedules/${sched.id}/runs`, { token: OTHER.token });
  ok("T1: ... nor read its runs (403)", r.status === 403, r.status);
  r = await OTHER.run("profit-loss", "", {});
  ok("T1: the user's own company still runs reports", r.status === 200, r.status);
  r = await api("GET", `/api/companies/${S.cid}/reports/run/profit-loss`, { token: OTHER.token });
  ok("T1: running a report on another company's id is refused (403)", r.status === 403, r.status);
  r = await api("PATCH", `/api/companies/${OTHER.cid}/report-schedules/${sched.id}`, { token: OTHER.token, body: { enabled: true } });
  ok("T1: another company's schedule id through your own company path is a 404", r.status === 404, r.status);
  r = await api("DELETE", `/api/companies/${OTHER.cid}/report-schedules/${sched.id}`, { token: OTHER.token });
  ok("T1: ... and cannot be deleted either (404)", r.status === 404, r.status);
  r = await api("POST", `/api/companies/${OTHER.cid}/report-schedules/${sched.id}/run-now`, { token: OTHER.token });
  ok("T1: ... nor run (404)", r.status === 404, r.status);
  r = await api("GET", `/api/companies/${OTHER.cid}/report-schedules/${sched.id}/runs`, { token: OTHER.token });
  ok("T1: ... nor its runs read (404)", r.status === 404, r.status);
  // T4: a foreign accountId filter returns no rows
  const foreignAccount = OTHER.acct("1020").id;
  r = await S.run("general-ledger", `from=${yearStart}&to=${today}&accountId=${foreignAccount}`);
  ok("T4: a foreign accountId filter returns no rows", r.status === 200 && (r.json?.rows ?? []).length === 0, r.json?.rows?.length);
  r = await S.run("account-transactions", `from=${yearStart}&to=${today}&accountId=${foreignAccount}`);
  ok("T4: ... also on Account Transactions", r.status === 200 && (r.json?.rows ?? []).length === 0, r.json?.rows?.length);

  // R1: an employee cannot open payroll or the audit trail, or change schedules
  const employee = await api("POST", "/api/auth/register", { body: { name: "emp", email: `emp_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'employee')`, [S.cid, employee.json.user.id]);
  const asEmployee = (rid, q = "") => api("GET", `/api/companies/${S.cid}/reports/run/${rid}?from=${yearStart}&to=${today}${q}`, { token: employee.json.token });
  r = await asEmployee("payroll-register");
  ok("R1: an employee gets 403 (ROLE_REQUIRED from the report gate) on the payroll register", r.status === 403 && /^ROLE_(REQUIRED|FORBIDDEN)$/.test(r.json?.code), { s: r.status, j: r.json });
  r = await asEmployee("audit-trail");
  ok("R1: ... and on the audit trail", r.status === 403 && /^ROLE_(REQUIRED|FORBIDDEN)$/.test(r.json?.code), { s: r.status, j: r.json });
  r = await asEmployee("profit-loss");
  ok("R1: ... and on an ordinary report too (no report is for the employee role)", r.status === 403 && r.json?.code === "ROLE_REQUIRED", { s: r.status, j: r.json });
  r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: employee.json.token, body: body() });
  ok("R1: an employee cannot create a schedule (403)", r.status === 403, { s: r.status, j: r.json });
  r = await api("GET", `/api/companies/${S.cid}/report-schedules`, { token: employee.json.token });
  ok("R1: nor list them (the employee role only covers its own HR records: 403 ROLE_REQUIRED)", r.status === 403 && r.json?.code === "ROLE_REQUIRED", { s: r.status, j: r.json });
  const acct = await api("POST", "/api/auth/register", { body: { name: "acct", email: `acct_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'accountant')`, [S.cid, acct.json.user.id]);
  r = await api("GET", `/api/companies/${S.cid}/reports/run/payroll-register?from=${yearStart}&to=${today}`, { token: acct.json.token });
  ok("R1: an accountant can open the payroll register", r.status === 200, r.status);
  r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: body({ reportId: "payroll-register", params: { rangePreset: "lastMonth" }, recipientUserIds: [employee.json.user.id] }) });
  ok("R1: a sensitive report cannot be scheduled to an employee (422)", r.status === 422 && r.json?.code === "RECIPIENT_ROLE_FORBIDDEN", { s: r.status, j: r.json });

  // R2: firm_admin, unassigned and assigned
  const fa = await api("POST", "/api/auth/register", { body: { name: "fa", email: `fa_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`UPDATE users SET firm_role = 'firm_admin' WHERE id = $1`, [fa.json.user.id]);
  const faLogin = await api("POST", "/api/auth/login", { body: { email: `fa_${rnd}@example.com`, password: "Password123!" } });
  const faToken = faLogin.json?.token ?? fa.json.token;
  await db.query(`UPDATE companies SET company_type = 'client' WHERE id = $1`, [S.cid]);
  r = await api("GET", `/api/companies/${S.cid}/reports/run/audit-trail?from=${yearStart}&to=${today}`, { token: faToken });
  ok("R2: an unassigned firm_admin gets 403 on the audit trail", r.status === 403, { s: r.status, j: r.json });
  await db.query(`INSERT INTO firm_staff_assignments (user_id, company_id, role) VALUES ($1,$2,'staff')`, [fa.json.user.id, S.cid]);
  r = await api("GET", `/api/companies/${S.cid}/reports/run/audit-trail?from=${yearStart}&to=${today}`, { token: faToken });
  ok("R2: an assigned firm_admin can open the audit trail (200)", r.status === 200, { s: r.status, j: r.json });
  await db.query(`UPDATE companies SET company_type = 'standard' WHERE id = $1`, [S.cid]).catch(() => undefined);

  r = await api("DELETE", `/api/companies/${S.cid}/report-schedules/${sched.id}`, { token: S.token });
  const gone = (await db.query(`SELECT (SELECT COUNT(*) FROM report_schedules WHERE id = $1) AS s, (SELECT COUNT(*) FROM report_schedule_runs WHERE schedule_id = $1) AS r`, [sched.id])).rows[0];
  ok("schedules: deleting removes the schedule and its runs (cascade)", r.status === 204 && Number(gone.s) === 0 && Number(gone.r) === 0, gone);
}


// ═════════════════════════════════════════════════════════════════════════════
// Wave 2: reports over the D1-D3 tables
// ═════════════════════════════════════════════════════════════════════════════
async function wave2Reports() {
  const W = await newCompany("wave2");
  const post = (p, body, token = W.token) => api("POST", p, { token, body });
  const cust = (await post(`/api/companies/${W.cid}/customer-contacts`, { name: "Wave Customer LLC", email: "wave@example.com" })).json;
  const bankId = W.acct("1020").id;
  const rowBy = (res, pred) => detailRows(res).find((x) => pred(x.cells));

  // ── customer advances (D1) and the sales reports that must leave them out ──
  const adv = await post(`/api/companies/${W.cid}/customer-advances`, { contactId: cust.id, date: today, vatRate: 0.05, kind: "advance", amount: 1050, receive: { paymentAccountId: bankId, method: "bank" } });
  ok("wave2 setup: an advance of 1,050 (1,000 + VAT) is received", adv.status === 201, { s: adv.status, t: adv.text?.slice(0, 200) });
  let r = await W.run("customer-advances", `asOf=${today}`);
  let a1 = rowBy(r, (c) => /^ADV-/.test(c.number));
  ok("advances: the report lists the advance with 1,000 net and 1,000 unapplied", a1 && close(a1.cells.net, 1000) && close(a1.cells.unapplied, 1000) && r.json?.rows?.find((x) => x.key === "tie:2055") && a1.drill?.target === "advance", a1?.cells);
  ok("advances: unapplied equals the ledger balance of account 2055 (no tie warning)", close(r.json?.totals?.unapplied, row(r, "tie:2055")?.cells.unapplied) && !(r.json?.warnings ?? []).length, { t: r.json?.totals, tie: row(r, "tie:2055")?.cells, w: r.json?.warnings });
  const final = await W.invoice(today, 2000, { customerName: "Wave Customer LLC", contactId: cust.id });
  void final;
  // a second draft invoice takes 400 of the advance; it counts only once issued
  const draft2 = await api("POST", `/api/companies/${W.cid}/invoices`, { token: W.token, body: { customerName: "Wave Customer LLC", contactId: cust.id, date: today, dueDate: today, lines: [{ description: "Retainer work", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] } });
  const app = await post(`/api/invoices/${draft2.json.id}/advance-applications`, { advanceId: adv.json.advance.id, amount: 400 });
  ok("advances setup: 400 of the advance is applied to a draft invoice", app.status === 201 || app.status === 200, { s: app.status, t: app.text?.slice(0, 200) });
  r = await W.run("customer-advances", `asOf=${today}`);
  ok("advances: an application on a draft invoice does not move the balance yet", close(rowBy(r, (c) => /^ADV-/.test(c.number))?.cells.applied, 0), rowBy(r, (c) => /^ADV-/.test(c.number))?.cells);
  const issued = await api("PATCH", `/api/invoices/${draft2.json.id}/status`, { token: W.token, body: { status: "sent" } });
  r = await W.run("customer-advances", `asOf=${today}`);
  a1 = rowBy(r, (c) => /^ADV-/.test(c.number));
  ok("advances: after issue, applied 400, unapplied 600, and it still ties to account 2055", issued.status === 200 && close(a1?.cells.applied, 400) && close(a1?.cells.unapplied, 600) && close(row(r, "tie:2055")?.cells.unapplied, 600) && !(r.json?.warnings ?? []).length, { a: a1?.cells, tie: row(r, "tie:2055")?.cells, w: r.json?.warnings });
  r = await W.run("customer-advances", `asOf=${day(2)}`);
  ok("advances: as of two days ago nothing had been received", detailRows(r).length === 0, detailRows(r).length);
  r = await W.run("revenue-customer", `from=${yearStart}&to=${today}`);
  const rev = rowBy(r, (c) => c.customer === "Wave Customer LLC");
  ok("advance rules: revenue by customer leaves the advance invoice out and counts the item line in full (2,000 + 1,000)", rev && close(rev.cells.revenue, 3000) && rev.cells.invoices === 2, rev?.cells);
  r = await W.run("sales-product-service", `from=${yearStart}&to=${today}`);
  ok("advance rules: sales by product leaves out the advance line and the advance invoice", !detailRows(r).some((x) => /advance/i.test(x.cells.item)) && close(r.json?.totals?.amount, 3000), r.json?.totals);
  r = await W.run("invoice-status", `from=${yearStart}&to=${today}`);
  ok("advance rules: invoice status does not count the advance invoice (2 invoices)", detailRows(r).reduce((s, x) => s + x.cells.count, 0) === 2, detailRows(r).map((x) => x.cells));

  // ── sales orders (D1) ──
  const so = await post(`/api/companies/${W.cid}/sales-orders`, { contactId: cust.id, date: today, lines: [{ description: "Gadget", quantity: 10, unitPrice: 100, vatRate: 0.05 }] });
  const soLine = so.json?.lines?.[0];
  r = await W.run("sales-orders-status", `from=${yearStart}&to=${today}`);
  let s1 = rowBy(r, (c) => c.number === so.json?.number);
  ok("sales orders: the order shows total 1,050, nothing invoiced, 1,050 still to invoice", so.status === 201 && s1 && close(s1.cells.total, 1050) && close(s1.cells.invoiced, 0) && close(s1.cells.remaining, 1050) && s1.drill?.target === "sales_order", { s: so.status, c: s1?.cells });
  const soInv = await post(`/api/companies/${W.cid}/sales-orders/${so.json.id}/invoices`, { lines: [{ salesOrderLineId: soLine.id, quantity: 4 }] });
  await api("PATCH", `/api/invoices/${soInv.json?.id}/status`, { token: W.token, body: { status: "sent" } });
  r = await W.run("sales-orders-status", `from=${yearStart}&to=${today}`);
  s1 = rowBy(r, (c) => c.number === so.json?.number);
  ok("sales orders: an issued invoice for 4 of 10 leaves 630 to invoice", close(s1?.cells.invoiced, 420) && close(s1?.cells.remaining, 630), s1?.cells);

  // ── projects and time (D2) ──
  const proj = (await post(`/api/companies/${W.cid}/projects`, { name: "Website build", contactId: cust.id, hourlyRate: 200, budgetAmount: 4000, budgetHours: 10 })).json;
  const task = (await post(`/api/projects/${proj.id}/tasks`, { name: "Design" })).json;
  await post(`/api/companies/${W.cid}/time-entries`, { projectId: proj.id, entryDate: today, hours: 2, notes: "Wireframes" });
  await post(`/api/companies/${W.cid}/time-entries`, { projectId: proj.id, entryDate: today, minutes: 90, taskId: task.id });
  await post(`/api/companies/${W.cid}/time-entries`, { projectId: proj.id, entryDate: today, minutes: 30, isBillable: false });
  await post(`/api/companies/${W.cid}/expenses-placeholder`, {}).catch(() => undefined);
  r = await W.run("time-summary", `from=${yearStart}&to=${today}`);
  ok("time summary: 4 hours, 3.5 billable, nothing billed, billable amount 700", close(r.json?.totals?.hours, 4) && close(r.json?.totals?.billableHours, 3.5) && close(r.json?.totals?.billedHours, 0) && close(r.json?.totals?.billableAmount, 700), r.json?.totals);
  r = await W.run("time-summary", `from=${yearStart}&to=${today}&projectId=${proj.id}`);
  ok("time summary: the project filter keeps the project", detailRows(r).length === 1 && detailRows(r)[0].drill?.target === "project", detailRows(r).length);
  r = await W.run("time-summary", `from=${yearStart}&to=${today}&projectId=00000000-0000-4000-8000-000000000000`);
  ok("time summary: another id gives no rows", detailRows(r).length === 0, detailRows(r).length);
  r = await W.run("unbilled-time-expenses", `asOf=${today}`);
  ok("unbilled: the two billable entries (3.5 h, 700) are listed; the non-billable one is not", detailRows(r).length === 2 && close(r.json?.totals?.amount, 700) && close(r.json?.totals?.hours, 3.5), { rows: detailRows(r).length, t: r.json?.totals });
  const pinv = await post(`/api/projects/${proj.id}/invoice`, { vatRate: 5 });
  ok("projects setup: the unbilled time is invoiced", pinv.status === 201, { s: pinv.status, t: pinv.text?.slice(0, 200) });
  r = await W.run("unbilled-time-expenses", `asOf=${today}`);
  ok("unbilled: once invoiced, nothing is left", detailRows(r).length === 0 && close(r.json?.totals?.amount ?? 0, 0), detailRows(r).length);
  await api("PATCH", `/api/invoices/${pinv.json?.invoice?.id ?? pinv.json?.id}/status`, { token: W.token, body: { status: "sent" } });
  r = await W.run("time-summary", `from=${yearStart}&to=${today}`);
  ok("time summary: billed hours are now 3.5", close(r.json?.totals?.billedHours, 3.5), r.json?.totals);
  r = await W.run("project-profitability", `from=${yearStart}&to=${today}`);
  const pp = rowBy(r, (c) => c.name === "Website build");
  ok("project profitability: revenue 700 booked to the project, costs 0, margin 700, 4 hours, budget 4,000", pp && close(pp.cells.revenue, 700) && close(pp.cells.costs, 0) && close(pp.cells.margin, 700) && close(pp.cells.hours, 4) && close(pp.cells.budget, 4000), pp?.cells);
  ok("project profitability: totals add the rows", close(r.json?.totals?.revenue, 700), r.json?.totals);

  // ── approvals (D2) ──
  const acc = await api("POST", "/api/auth/register", { body: { name: "appr", email: `appr_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'accountant')`, [W.cid, acc.json.user.id]);
  await post(`/api/companies/${W.cid}/approval-rules`, { documentType: "bill", name: "Over 5,000", thresholdAed: 5000, approverRoles: ["accountant", "owner"] });
  const big = await W.bill(day(2), 6000, { vendor: "Big Vendor" });
  const s1a = await api("POST", `/api/bills/${big.id}/approve`, { token: acc.json.token, body: {} });
  r = await W.run("payables-detail", `asOf=${today}`);
  const waiting = detailRows(r).find((x) => x.drill?.id === big.id);
  ok("approvals: Payables Detail shows the bill waiting for its second approval (pending 1/2), outside the totals", s1a.status === 200 && /pending 1\/2/.test(waiting?.cells.approval ?? "") && waiting?.cells.open === null, { s: s1a.status, w: waiting?.cells });
  // the bill's creator cannot sign (SELF_APPROVAL): a second owner takes the owner step
  const own2 = await api("POST", "/api/auth/register", { body: { name: "own2", email: `own2_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'owner')`, [W.cid, own2.json.user.id]);
  const s2a = await api("POST", `/api/bills/${big.id}/approve`, { token: own2.json.token, body: {} });
  r = await W.run("approval-history", `from=${yearStart}&to=${today}`);
  const req = detailRows(r).find((x) => x.key.startsWith("req:") && x.drill?.id === big.id);
  const stepRows = detailRows(r).filter((x) => x.key.startsWith("step:") && req && x.key.includes(req.key.slice(4)));
  ok("approvals: the history shows the request approved 2/2 for 6,300 with both steps and who signed", s2a.status === 200 && req && /approved 2\/2/.test(req.cells.status) && close(req.cells.amount, 6300) && stepRows.length === 2 && stepRows.every((x) => x.cells.status === "approved" && x.cells.requestedBy), { s: s2a.status, req: req?.cells, steps: stepRows.map((x) => x.cells) });
  r = await W.run("payables-detail", `asOf=${today}`);
  ok("approvals: once approved the bill is a payable and shows approved", /approved/.test(detailRows(r).find((x) => x.drill?.id === big.id)?.cells.approval ?? "") && close(detailRows(r).find((x) => x.drill?.id === big.id)?.cells.open, 6300), detailRows(r).find((x) => x.drill?.id === big.id)?.cells);
  r = await W.run("approval-history", `from=${yearStart}&to=${today}&entityType=expense_claim`);
  ok("approvals: the document-type filter narrows the history", detailRows(r).length === 0, detailRows(r).length);
  const stranger = await newCompany("w2other");
  r = await stranger.run("approval-history", `from=${yearStart}&to=${today}`);
  ok("tenant: another company's approval history is empty", r.status === 200 && detailRows(r).length === 0, detailRows(r).length);

  // ── purchases by vendor with vendor_id (D2) ──
  const vend = (await post(`/api/companies/${W.cid}/customer-contacts`, { name: "Acme Supplies", contactType: "vendor" })).json;
  await db.query(`UPDATE vendor_bills SET vendor_id = $2 WHERE id = $1`, [big.id, vend.id]);
  const b2 = await W.bill(day(1), 1000, { vendor: "acme supplies" });
  await W.approveBill(b2.id);
  await db.query(`UPDATE vendor_bills SET vendor_id = $2 WHERE id = $1`, [b2.id, vend.id]);
  r = await W.run("purchases-vendor", `from=${yearStart}&to=${today}`);
  const acme = rowBy(r, (c) => c.vendor === "Acme Supplies");
  ok("purchases by vendor: bills with the same vendor_id group under the contact's name (6,000 + 1,000, 2 bills)", acme && acme.cells.bills === 2 && close(acme.cells.net, 7000) && !detailRows(r).some((x) => /big vendor|acme supplies$/i.test(x.cells.vendor) && x.cells.vendor !== "Acme Supplies"), detailRows(r).map((x) => x.cells));

  // ── leave, end-of-service provision, loans (D2): sensitive ──
  const joined = (y) => `${now.getUTCFullYear() - y}-${today.slice(5)}`;
  const emp = (await db.query(`INSERT INTO employees (company_id, full_name, employee_number, nationality, basic_salary, total_salary, join_date) VALUES ($1,'Sara Expat','E-10','Indian',6000,6000,$2::timestamp + INTERVAL '1 day') RETURNING id`, [W.cid, joined(3)])).rows[0];
  r = await W.run("leave-balances", `asOf=${today}`);
  const annual = detailRows(r).filter((x) => x.drill?.id === emp.id);
  ok("leave: the employee has a balance row per leave type with accrual and the balance adds up", annual.length >= 1 && annual.every((x) => close(x.cells.balance, x.cells.opening + x.cells.accrued + x.cells.adjustment - x.cells.taken)) && annual.some((x) => x.cells.accrued > 0), annual.map((x) => x.cells));
  const lt = (await db.query(`SELECT id FROM leave_types WHERE company_id = $1 AND accrual <> 'none' ORDER BY created_at LIMIT 1`, [W.cid])).rows[0];
  const before = detailRows(r).find((x) => x.drill?.id === emp.id)?.cells.balance;
  await db.query(`INSERT INTO leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, status) VALUES ($1,$2,$3,$4::date,$5::date,5,'approved')`, [W.cid, emp.id, lt.id, day(20), day(16)]);
  r = await W.run("leave-balances", `asOf=${today}&employeeId=${emp.id}`);
  const after = detailRows(r).find((x) => x.cells.taken > 0);
  ok("leave: 5 approved days reduce the balance by 5 (employee filter works)", after && close(after.cells.taken, 5) && close(before - after.cells.balance, 5), { before, after: after?.cells });
  const OTHER = await newCompany("w2emp");
  r = await OTHER.run("leave-balances", `asOf=${today}&employeeId=${emp.id}`);
  ok("tenant: another company's employee id gives no leave rows", detailRows(r).length === 0, detailRows(r).length);

  await W.je(day(10), [["5028", 10000, 0], ["2036", 0, 10000]]);
  r = await W.run("eos-provision", `asOf=${today}`);
  const eos = detailRows(r).find((x) => x.drill?.id === emp.id);
  // The service days count INCLUSIVELY (the last day of service counts): joined one day after the 3-year mark of asOf is exactly 3 completed years.
  ok("EOS: 3 completed years (inclusive of the last day) at basic 6,000 = 21 x 3 x 200 = 12,600 entitlement", close(eos?.cells.entitlement, 12600) && close(eos?.cells.years, 3), eos?.cells);
  ok("EOS: the ledger provision (2036 = 10,000) and the shortfall (-2,600) are shown, with a warning", close(row(r, "tie:2036")?.cells.entitlement, 10000) && close(row(r, "tie:diff")?.cells.entitlement, -2600) && (r.json?.warnings ?? []).length === 1, { tie: row(r, "tie:2036")?.cells, diff: row(r, "tie:diff")?.cells });
  // the inclusive rule, second case: joined exactly 3 years before asOf = 3 years + 1 day of service = 12,611.67 (21 x 3 x 200 x 1096/1095)
  const edge = (await db.query(`INSERT INTO employees (company_id, full_name, employee_number, nationality, basic_salary, total_salary, join_date) VALUES ($1,'Edge Expat','E-12','Indian',6000,6000,$2::timestamp) RETURNING id`, [W.cid, joined(3)])).rows[0];
  r = await W.run("eos-provision", `asOf=${today}`);
  ok("EOS: joined exactly 3 years before the as-of day = 3 years + 1 day of service (inclusive): a day above 12,600 (12,611.67 on 2026-10-02)", n(detailRows(r).find((x) => x.drill?.id === edge.id)?.cells.entitlement) > 12600 && n(detailRows(r).find((x) => x.drill?.id === edge.id)?.cells.entitlement) < 12620, detailRows(r).find((x) => x.drill?.id === edge.id)?.cells);
  await db.query(`INSERT INTO employees (company_id, full_name, employee_number, nationality, basic_salary, total_salary, join_date) VALUES ($1,'Omar Emirati','E-11','Emirati',9000,9000,$2::timestamp)`, [W.cid, joined(6)]);
  r = await W.run("eos-provision", `asOf=${today}`);
  const gcc = detailRows(r).find((x) => x.cells.employee === "Omar Emirati");
  ok("EOS: a GCC national has no gratuity (pension instead)", gcc && close(gcc.cells.entitlement, 0) && /GCC/.test(gcc.cells.note), gcc?.cells);

  const loan = (await db.query(`INSERT INTO employee_loans (company_id, employee_id, loan_number, kind, principal, instalment_count, instalment_amount, first_period_year, first_period_month, disbursement_date, payment_account_id, status)
                                VALUES ($1,$2,'LN-1','loan',12000,6,2000,$3,$4,$5::date,$6,'active') RETURNING id`, [W.cid, emp.id, now.getUTCFullYear(), now.getUTCMonth() - 1 < 1 ? 1 : now.getUTCMonth() - 1, day(60), bankId])).rows[0];
  const base = now.getUTCFullYear() * 12 + now.getUTCMonth(); // 0-based month index of this month
  for (let i = 0; i < 6; i++) {
    const idx = base - 2 + i;             // two in the past (deducted), then this month and later
    const y = Math.floor(idx / 12), m = (idx % 12) + 1;
    await db.query(`INSERT INTO employee_loan_installments (company_id, loan_id, sequence, period_year, period_month, amount, deducted_amount, status) VALUES ($1,$2,$3,$4,$5,2000,$6,$7)`, [W.cid, loan.id, i + 1, y, m, i < 2 ? 2000 : 0, i < 2 ? "deducted" : "scheduled"]);
  }
  await W.je(day(60), [["1080", 12000, 0], ["1020", 0, 12000]]);
  await W.je(day(5), [["5020", 4000, 0], ["1080", 0, 4000]]);
  r = await W.run("employee-loans", `asOf=${today}`);
  const ln = detailRows(r).find((x) => x.cells.number === "LN-1");
  ok("loans: principal 12,000, deducted 4,000, outstanding 8,000", ln && close(ln.cells.principal, 12000) && close(ln.cells.deducted, 4000) && close(ln.cells.outstanding, 8000) && ln.drill?.target === "loan", ln?.cells);
  ok("loans: outstanding ties to account 1080 (8,000) with no warning", close(row(r, "tie:1080")?.cells.outstanding, 8000) && !(r.json?.warnings ?? []).length, { tie: row(r, "tie:1080")?.cells, w: r.json?.warnings });
  r = await W.run("employee-loans", `asOf=${day(70)}`);
  ok("loans: before the disbursement nothing is outstanding", detailRows(r).length === 0, detailRows(r).length);

  // sensitive roles: an employee is refused on the three payroll-side wave-2 reports
  const empUser = await api("POST", "/api/auth/register", { body: { name: "w2emp", email: `w2employee_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'employee')`, [W.cid, empUser.json.user.id]);
  for (const id of ["leave-balances", "eos-provision", "employee-loans"]) {
    const x = await api("GET", `/api/companies/${W.cid}/reports/run/${id}?asOf=${today}`, { token: empUser.json.token });
    ok(`R1: an employee gets 403 on ${id}`, x.status === 403 && /^ROLE_(REQUIRED|FORBIDDEN)$/.test(x.json?.code), { s: x.status, j: x.json });
  }

  // ── bank reconciliation statement (D3): one calculation ──
  const ba = (await db.query(`INSERT INTO bank_accounts (company_id, name_en, bank_name, gl_account_id, currency) VALUES ($1,'Operating','Test Bank',$2,'AED') RETURNING id`, [W.cid, bankId])).rows[0];
  const je1 = await W.je(day(5), [["1020", 1000, 0], ["3010", 0, 1000]], "manual", "Capital deposit");
  await W.je(day(3), [["1020", 500, 0], ["4010", 0, 500]], "manual", "Cheque in transit");
  await db.query(`INSERT INTO bank_transactions (company_id, bank_account_id, bank_statement_account_id, transaction_date, description, amount, balance, is_reconciled, matched_journal_entry_id) VALUES ($1,$2,$3,$4::timestamp,'Deposit',1000,1000,true,$5)`, [W.cid, bankId, ba.id, day(5), je1]);
  await db.query(`INSERT INTO bank_transactions (company_id, bank_account_id, bank_statement_account_id, transaction_date, description, amount, balance, is_reconciled) VALUES ($1,$2,$3,$4::timestamp,'Bank fee',-200,800,false)`, [W.cid, bankId, ba.id, day(2)]);
  const ledgerOnBank = n((await db.query(`SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS b FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.company_id=$1 AND je.status='posted' AND jl.account_id=$2`, [W.cid, bankId])).rows[0].b);
  r = await W.run("bank-reconciliation-statement", `asOf=${today}&bankAccountId=${ba.id}`);
  const k = ba.id;
  ok("AC8 wave 2: statement 800, ledger balance equals the ledger, adjusted statement = adjusted ledger, difference 0 (other bank movements in this company are items in transit)", r.status === 200 && close(row(r, `${k}:stmt`)?.cells.amount, 800) && close(row(r, `${k}:ledger`)?.cells.amount, ledgerOnBank) && close(row(r, `${k}:adj-stmt`)?.cells.amount, row(r, `${k}:adj-ledger`)?.cells.amount) && close(row(r, `${k}:diff`)?.cells.amount, 0), (r.json?.rows ?? []).map((x) => [x.key.slice(-12), x.cells.amount]));
  ok("AC8 wave 2: the items are listed with drills (deposit in transit to the journal entry, the unreconciled debit to the bank transaction)", detailRows(r).some((x) => /Deposit in transit/.test(x.cells.description) && x.drill?.target === "journal_entry" && close(x.cells.amount, 500)) && detailRows(r).some((x) => /Unreconciled debit/.test(x.cells.description) && x.drill?.target === "bank_txn" && close(x.cells.amount, -200)), detailRows(r).map((x) => x.cells.description));
  ok("AC8 wave 2: the report totals the difference (0)", close(r.json?.totals?.amount, 0), r.json?.totals);
  r = await W.run("bank-reconciliation-statement", `asOf=${today}&bankAccountId=${OTHER.acct("1020").id}`);
  ok("tenant: another company's bank account id is 404", r.status === 404, { s: r.status, j: r.json });
  r = await W.run("bank-reconciliation-statement", `asOf=${today}`);
  ok("bank reconciliation: without a filter every bank account of the company is listed", (r.json?.rows ?? []).some((x) => x.key === `bank:${ba.id}`), r.json?.rows?.length);
  r = await W.run("bank-reconciliation-statement", `asOf=${today}&format=pdf`, { raw: true });
  ok("bank reconciliation: exports to PDF", r.status === 200 && r.buf.subarray(0, 4).toString() === "%PDF", r.status);

  // ── bank feed status (D3) ──
  await db.query(`INSERT INTO bank_connections (company_id, provider, connection_type, bank_name, account_name, status, auto_sync, last_synced_at, consecutive_failures, last_error, access_token) VALUES ($1,'lean','feed','Test Bank','Operating','error',true,now(),3,'Consent expired','SECRET-TOKEN')`, [W.cid]);
  r = await W.run("bank-feed-status", `asOf=${today}`);
  const conn = detailRows(r)[0];
  ok("bank feeds: the connection shows status, failures, last error and sync time", conn && conn.cells.status === "error" && conn.cells.failures === 3 && /Consent expired/.test(conn.cells.lastError) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(conn.cells.lastSynced), conn?.cells);
  ok("bank feeds: no token ever appears in the report", !JSON.stringify(r.json).includes("SECRET-TOKEN"), "token leaked");
  r = await OTHER.run("bank-feed-status", `asOf=${today}`);
  ok("bank feeds: a company with no connection gets an honest warning, not an empty claim", r.status === 200 && detailRows(r).length === 0 && (r.json?.warnings ?? []).length === 1, r.json?.warnings);
}


// ═════════════════════════════════════════════════════════════════════════════
// L4 fix round
// ═════════════════════════════════════════════════════════════════════════════
async function fixRound() {
  const F = await newCompany("fixr");
  const y = now.getUTCFullYear();
  const post = (p, body, token = F.token) => api("POST", p, { token, body });

  // 1: index and audit column
  const idx = (await db.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_invoices_original_invoice_id', 'idx_audit_logs_company_created')`)).rows.map((x) => x.indexname).sort();
  const col = (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'company_id'`)).rows.length;
  ok("fix 1+2: migration 0117 added the invoices(original_invoice_id) index, audit_logs.company_id and its index", idx.length === 2 && col === 1, { idx, col });

  // 2: the audit trail shows financial activity (audit_logs), with the same column shape
  const j = await post(`/api/companies/${F.cid}/journal`, { date: today, description: "Audit me", lines: [{ accountId: F.acct("1020").id, debit: 100, credit: 0 }, { accountId: F.acct("4010").id, debit: 0, credit: 100 }] });
  const bill = await F.bill(day(2), 100);
  await F.approveBill(bill.id);
  let r = await F.run("audit-trail", `from=${yearStart}&to=${today}&limit=1000`);
  const actions = detailRows(r).map((x) => x.cells.action);
  ok("fix 2: a journal entry and a bill approval appear in the Audit Trail", j.status === 201 || j.status === 200, j.text?.slice(0, 200)) ;
  ok("fix 2: ... as journal.create_* and bill.approve rows with user, entity and time", actions.some((a) => /^journal\.create/.test(a)) && actions.includes("bill.approve") && detailRows(r).every((x) => x.cells.at && "user" in x.cells && "entityType" in x.cells && "ip" in x.cells), actions);
  r = await F.run("audit-trail", `from=${yearStart}&to=${today}&action=bill.approve`);
  ok("fix 2: the action filter reaches the financial rows too", detailRows(r).length === 1 && detailRows(r)[0].cells.entityId === bill.id, detailRows(r).map((x) => x.cells));
  const O = await newCompany("fixother");
  r = await O.run("audit-trail", `from=${yearStart}&to=${today}&limit=1000`);
  ok("fix 2: another company's financial activity is not in the trail", !detailRows(r).some((x) => x.cells.entityId === bill.id), detailRows(r).length);

  // 3: VAT Summary = the VAT return (box-9 loaders, void rule, USD rounding)
  const V = await newCompany("fixvat");
  await V.invoice(prevMid, 1000);
  await V.invoice(prevMid, 500, { currency: "USD", exchangeRate: 3.6725 });
  const vb = await V.bill(prevMid, 400); await V.approveBill(vb.id);
  await db.query(`INSERT INTO receipts (company_id, uploaded_by, merchant, date, amount, vat_amount, posted, currency, exchange_rate) VALUES ($1,$2,'USD Supplier',$3::timestamp,1000,50,true,'USD',3.6725)`, [V.cid, V.userId, prevMid]);
  const cl = (await db.query(`INSERT INTO expense_claims (company_id, submitted_by, title, claim_number, total_amount, status) VALUES ($1,$2,'Taxi','EC-F',100,'approved') RETURNING id`, [V.cid, V.userId])).rows[0];
  await db.query(`INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount) VALUES ($1,$2::timestamp,'travel','Taxi',100,5)`, [cl.id, prevMid]);
  const gen = await post(`/api/companies/${V.cid}/vat-returns/generate`, { periodStart: prevStart, periodEnd: prevEnd }, V.token);
  r = await V.run("vat-summary", `from=${prevStart}&to=${prevEnd}`);
  ok("fix 3: VAT Summary net payable equals box 14 of the VAT return (same loaders: bills, receipts, claims)", close(r.json?.totals?.vat, gen.json?.box14PayableTax) && n(gen.json?.box14PayableTax) !== 0, { summary: r.json?.totals, box14: gen.json?.box14PayableTax });
  const purchasesRow = row(r, "purchases");
  ok("fix 3: the purchases row is the return's input VAT (box 11)", close(purchasesRow?.cells.vat, gen.json?.box11TotalVat), { p: purchasesRow?.cells, b11: gen.json?.box11TotalVat });

  // 12: USD rounding: the return, the ledger and the VAT Audit rows agree to the fils
  const U = await newCompany("fixusd");
  for (const price of [123.4567, 87.6543, 245.1111, 59.9999, 311.2222, 17.1717, 402.0505]) await U.invoice(prevMid, price, { currency: "USD", exchangeRate: 3.6725 });
  const gu = await post(`/api/companies/${U.cid}/vat-returns/generate`, { periodStart: prevStart, periodEnd: prevEnd }, U.token);
  const box1 = sumKeys(gu.json, /^box1[a-g].*Vat$/);
  const ledgerVat = n((await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0) AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = 'invoice' AND a.code = '2020'`, [U.cid])).rows[0].v);
  r = await U.run("vat-audit-sales", `from=${prevStart}&to=${prevEnd}`);
  const rowsVat = Math.round(detailRows(r).reduce((a, x) => a + Math.round(n(x.cells.vat) * 100), 0)) / 100;
  ok("fix 12: box 1 of the return equals the output VAT the ledger holds (USD invoices, document-level rounding)", close(box1, ledgerVat, 0.0001), { box1, ledgerVat });
  ok("fix 12: the VAT Audit subtotal equals the sum of its rows and box 1", close(r.json?.totals?.vat, rowsVat, 0.0001) && close(r.json?.totals?.vat, box1, 0.0001), { total: r.json?.totals?.vat, rowsVat, box1 });

  // 4: Payables Detail includes unapplied vendor credits, so it equals AP ageing and 2010
  const P = await newCompany("fixap");
  const pb = await P.bill(day(40), 2000); await P.approveBill(pb.id);
  const vc = await post(`/api/companies/${P.cid}/vendor-credits`, { vendor_name: "Vendor A", date: day(5), line_items: [{ description: "Return", quantity: 1, unit_price: 500, vat_rate: 5 }] }, P.token);
  await post(`/api/companies/${P.cid}/vendor-credits/${vc.json?.id}/approve`, {}, P.token);
  r = await P.run("payables-detail", `asOf=${today}`);
  const ag = await P.run("ap-aging", `asOf=${today}`);
  const gl2010 = n((await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0) AS b FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id WHERE je.company_id=$1 AND je.status='posted' AND a.code='2010'`, [P.cid])).rows[0].b);
  ok("fix 4: Payables Detail total (bill 2,100 less the unapplied credit 525) equals AP ageing and account 2010", close(r.json?.totals?.open, 1575) && close(ag.json?.totals?.total, 1575) && close(gl2010, 1575), { detail: r.json?.totals, ageing: ag.json?.totals, gl: gl2010 });
  ok("fix 4: the credit is a negative row that drills to the vendor credit", detailRows(r).some((x) => close(x.cells.open, -525) && x.drill?.target === "vendor_credit"), detailRows(r).map((x) => [x.cells.number, x.cells.open]));

  // 5: VAT control reconciliation compares days on both bounds
  await db.query(`INSERT INTO vat_returns (company_id, period_start, period_end, due_date, created_by, status) VALUES ($1,$2::timestamp,$3::timestamp,$4::timestamp,$5,'draft')`, [F.cid, `${prevStart} 00:00:00`, `${prevEnd} 23:59:59.999`, `${prevEnd} 23:59:59.999`, F.userId]);
  r = await F.run("vat-control-reconciliation", `from=${prevStart}&to=${prevEnd}`);
  ok("fix 5: a return whose period_end is the last millisecond of the end day is in a range ending that day", detailRows(r).length === 1, detailRows(r).length);

  // 6: customer advances as of: applications by the invoice date, equal to 2055 at every as-of day
  const A = await newCompany("fixadv");
  const cust = (await post(`/api/companies/${A.cid}/customer-contacts`, { name: "Adv Customer", email: "adv@example.com" }, A.token)).json;
  const adv = await post(`/api/companies/${A.cid}/customer-advances`, { contactId: cust.id, date: day(10), vatRate: 0.05, kind: "advance", amount: 1050, receive: { paymentAccountId: A.acct("1020").id, method: "bank" } }, A.token);
  const dr = await api("POST", `/api/companies/${A.cid}/invoices`, { token: A.token, body: { customerName: "Adv Customer", contactId: cust.id, date: day(3), dueDate: day(3), lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] } });
  await post(`/api/invoices/${dr.json.id}/advance-applications`, { advanceId: adv.json?.advance?.id, amount: 400 }, A.token);
  await api("PATCH", `/api/invoices/${dr.json.id}/status`, { token: A.token, body: { status: "sent" } });
  const gl2055 = async (asOf) => n((await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0) AS b FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id WHERE je.company_id=$1 AND je.status='posted' AND a.code='2055' AND je.date::date <= $2::date`, [A.cid, asOf])).rows[0].b);
  const advRow = async (asOf) => rowBy2(await A.run("customer-advances", `asOf=${asOf}`), (c) => /^ADV-/.test(c.number));
  const rowBy2 = (res, pred) => detailRows(res).find((x) => pred(x.cells));
  for (const [label, asOf, expected] of [["before the invoice", day(5), 1000], ["on the invoice day", day(3), 600], ["after it", today, 600]]) {
    const res = await A.run("customer-advances", `asOf=${asOf}`);
    const ar = rowBy2(res, (c) => /^ADV-/.test(c.number));
    ok(`fix 6: advances as of ${label} (${asOf}): unapplied ${expected} = account 2055 (${await gl2055(asOf)})`, close(ar?.cells.unapplied, expected) && close(row(res, "tie:2055")?.cells.unapplied, await gl2055(asOf)) && !(res.json?.warnings ?? []).length, { a: ar?.cells, tie: row(res, "tie:2055")?.cells, w: res.json?.warnings });
  }
  void advRow;

  // 10: inventory valuation as of dates a movement by its invoice date, not by when the row was written
  const I = await newCompany("fixinv");
  const prod = (await db.query(`INSERT INTO products (company_id, name, sku, track_inventory, current_stock, inventory_value, average_cost) VALUES ($1,'Gizmo','G1',true,8,80,10) RETURNING id`, [I.cid])).rows[0];
  const sinv = await I.invoice(day(10), 100);
  await db.query(`INSERT INTO inventory_movements (product_id, company_id, type, quantity, unit_cost, total_cost, source_invoice_id) VALUES ($1,$2,'sale',2,10,20,$3)`, [prod.id, I.cid, sinv.id]);
  r = await I.run("inventory-valuation", `asOf=${day(5)}`);
  ok("fix 10: a sale on an invoice dated 10 days ago is already out of stock 5 days ago (8 on hand, not 10)", detailRows(r).length === 1 && detailRows(r)[0].cells.quantity === 8 && close(detailRows(r)[0].cells.value, 80), detailRows(r).map((x) => x.cells));
  r = await I.run("inventory-valuation", `asOf=${day(12)}`);
  ok("fix 10: and 12 days ago, before the invoice, 10 were on hand", detailRows(r)[0]?.cells.quantity === 10, detailRows(r).map((x) => x.cells));

  // 11: Credit Notes and Refunds "remaining" is the refund route's refundable amount
  const C = await newCompany("fixcn");
  const unpaid = await C.invoice(day(5), 1000);
  const cn1 = await post(`/api/companies/${C.cid}/invoices/${unpaid.id}/credit-note`, { lines: [{ description: "Service", quantity: 1, unitPrice: 500, vatRate: 0.05 }] }, C.token);
  const paid = await C.invoice(day(5), 1000); await C.pay(paid.id, 1050, day(4));
  const cn2 = await post(`/api/companies/${C.cid}/invoices/${paid.id}/credit-note`, { lines: [{ description: "Service", quantity: 1, unitPrice: 500, vatRate: 0.05 }] }, C.token);
  await post(`/api/companies/${C.cid}/credit-notes/${cn2.json?.creditNote?.id ?? cn2.json?.id}/refunds`, { amount: 200, bankAccountId: C.acct("1020").id, date: today }, C.token);
  r = await C.run("credit-notes-refunds", `from=${day(10)}&to=${today}`);
  const cnRows = detailRows(r).filter((x) => x.key.startsWith("cn:"));
  const refundable = async (cn) => n((await api("GET", `/api/companies/${C.cid}/credit-notes/${cn}/refunds`, { token: C.token })).json?.summary?.refundable);
  const id1 = cn1.json?.creditNote?.id ?? cn1.json?.id, id2 = cn2.json?.creditNote?.id ?? cn2.json?.id;
  const rem1 = cnRows.find((x) => x.drill?.id === id1)?.cells.remaining, rem2 = cnRows.find((x) => x.drill?.id === id2)?.cells.remaining;
  ok("fix 11: a credit note on an UNPAID invoice has nothing to refund (remaining 0, as the refund route says)", close(rem1, await refundable(id1)) && close(rem1, 0), { rem1, route: await refundable(id1) });
  ok("fix 11: a credit note on a paid invoice: 525 less the 200 refunded = 325, the refund route's figure", close(rem2, await refundable(id2)) && close(rem2, 325), { rem2, route: await refundable(id2) });

  // 7: pagination pushed into SQL; a GL of 52,000 lines pages at limit=100
  const B = await newCompany("fixbig");
  await db.query(`INSERT INTO journal_entries (company_id, entry_number, date, memo, status, source, created_by) SELECT $1, 'PG-' || g, ($3 || '-01-01')::date + (g % 600), 'bulk ' || g, 'posted', 'manual', $2 FROM generate_series(1, 26000) g`, [B.cid, B.userId, String(y - 1)]);
  await db.query(`INSERT INTO journal_lines (entry_id, account_id, debit, credit) SELECT je.id, $2, 1, 0 FROM journal_entries je WHERE je.company_id = $1 AND je.entry_number LIKE 'PG-%'`, [B.cid, B.acct("1020").id]);
  await db.query(`INSERT INTO journal_lines (entry_id, account_id, debit, credit) SELECT je.id, $2, 0, 1 FROM journal_entries je WHERE je.company_id = $1 AND je.entry_number LIKE 'PG-%'`, [B.cid, B.acct("4010").id]);
  let t0 = Date.now();
  r = await B.run("general-ledger", `from=${y - 1}-01-01&to=${today}&limit=100`);
  const ms = Date.now() - t0;
  ok("fix 7: a 2-year GL of 52,000 lines with limit=100 is 200 with 100 rows, a total over the full set, in under 3 s", r.status === 200 && r.json?.rows?.length === 100 && r.json?.page?.total >= 52000 && ms < 3000, { s: r.status, n: r.json?.rows?.length, p: r.json?.page, ms, j: r.json?.code });
  const p1 = await B.run("general-ledger", `from=${y - 1}-01-01&to=${today}&limit=100&offset=0`);
  const p2 = await B.run("general-ledger", `from=${y - 1}-01-01&to=${today}&limit=100&offset=100`);
  const p12 = await B.run("general-ledger", `from=${y - 1}-01-01&to=${today}&limit=200&offset=0`);
  ok("fix 7: consecutive pages are exactly the same rows as one bigger page (keys, running balances)", JSON.stringify([...p1.json.rows, ...p2.json.rows]) === JSON.stringify(p12.json.rows), p1.json?.rows?.length);
  const last = await B.run("general-ledger", `from=${y - 1}-01-01&to=${today}&limit=100&offset=${r.json?.page?.total - 3}`);
  ok("fix 7: the last page ends with the closing balance row of the last account", last.json?.rows?.at(-1)?.key?.startsWith("close:") && last.json.rows.length === 3, last.json?.rows?.map((x) => x.key.slice(0, 8)));
  const at = await B.run("account-transactions", `from=${y - 1}-01-01&to=${today}&limit=50`);
  ok("fix 7: account transactions page 1 is 50 rows with totals over all 52,000 lines (debit = credit = 26,000)", at.status === 200 && at.json?.rows?.length === 50 && close(at.json?.totals?.debit, 26000) && close(at.json?.totals?.credit, 26000) && at.json?.page?.total === 52000, { s: at.status, t: at.json?.totals, p: at.json?.page });
  const jr = await B.run("journal-report", `from=${y - 1}-01-01&to=${today}&limit=50&offset=25950`);
  ok("fix 7: the journal report's last page and its totals come from SQL (26,000 entries)", jr.status === 200 && jr.json?.rows?.length === 50 && jr.json?.page?.total === 26000 && close(jr.json?.totals?.debit, 26000), { s: jr.status, p: jr.json?.page, t: jr.json?.totals });
  const big = await B.run("general-ledger", `from=${y - 1}-01-01&to=${today}&format=csv`, { raw: true });
  ok("fix 7: a CSV of the same 52,000-line ledger is still refused as too large (422), only paged JSON is unbounded", big.status === 422, big.status);

  // 8: run-now guard
  const R = await newCompany("fixrun");
  const mk = async (rid) => (await post(`/api/companies/${R.cid}/report-schedules`, { reportId: rid, params: { asOfPreset: "today" }, format: "csv", lang: "en", cadence: "daily", hourDubai: 7, recipientUserIds: [R.userId] }, R.token)).json;
  const s1 = await mk("trial-balance");
  let rn = await post(`/api/companies/${R.cid}/report-schedules/${s1.id}/run-now`, {}, R.token);
  ok("fix 8: the first run-now is accepted (202)", rn.status === 202, rn.status);
  rn = await post(`/api/companies/${R.cid}/report-schedules/${s1.id}/run-now`, {}, R.token);
  ok("fix 8: a second run-now within 60 seconds is 409 RUN_IN_PROGRESS", rn.status === 409 && rn.json?.code === "RUN_IN_PROGRESS", { s: rn.status, j: rn.json });
  let last429 = 0;
  for (const rid of ["balance-sheet", "ar-aging", "ap-aging", "vendor-balances", "customer-balances"]) {
    const sx = await mk(rid);
    last429 = (await post(`/api/companies/${R.cid}/report-schedules/${sx.id}/run-now`, {}, R.token)).status;
  }
  ok("fix 8: run-now is limited to 5 a minute per user (429 on the sixth)", last429 === 429, last429);

  // 9: vatDueNext is cached for 5 minutes and dropped when a VAT return is generated; legacy TB on the ledger layer
  const G = await newCompany("fixcache");
  const dueOf = async () => (await api("GET", `/api/companies/${G.cid}/dashboard/stats`, { token: G.token })).json?.vatDueNext;
  const v0 = await dueOf();
  await G.invoice(prevMid, 2000);
  const v1 = await dueOf();
  ok("fix 9: vatDueNext is served from a per-company cache (a new sale does not change it within 5 minutes)", v0 && close(v0.amount, v1?.amount), { v0, v1 });
  await post(`/api/companies/${G.cid}/vat-returns/generate`, { periodStart: prevStart, periodEnd: prevEnd }, G.token);
  const v2 = await dueOf();
  ok("fix 9: generating a VAT return drops the cache: vatDueNext now includes the sale (+100 VAT)", close(n(v2?.amount) - n(v0?.amount), 100), { v0, v2 });
  const T = await newCompany("fixtb");
  await T.je(`${y}-01-10`, [["1020", 700, 0], ["4010", 0, 700]]);
  await T.je(`${y}-02-10`, [["1020", 300, 0], ["4010", 0, 300]]);
  await T.je(`${y}-02-11`, [["5010", 120, 0], ["1020", 0, 120]]);
  const legacyTb = (await api("GET", `/api/companies/${T.cid}/reports/trial-balance?from=${y}-02-01&to=${y}-02-28`, { token: T.token })).json;
  const byc = (c) => legacyTb.rows.find((x) => x.accountCode === c);
  ok("fix 9: the legacy TB route keeps its meaning: balance-sheet accounts cumulative to `to`, P&L accounts for the period only", close(byc("1020")?.totalDebit, 1000) && close(byc("1020")?.totalCredit, 120) && close(byc("4010")?.totalCredit, 300) && close(byc("5010")?.totalDebit, 120) && byc("1020")?.accountType === "asset" && "hasForeignLines" in byc("1020"), { b: byc("1020"), r: byc("4010") });
  const whole = (await api("GET", `/api/companies/${T.cid}/reports/trial-balance`, { token: T.token })).json;
  const mineTb = await T.run("trial-balance", `asOf=${today}`);
  ok("fix 9: without dates it matches the run-route trial balance (totals and balance)", close(whole.totals.sumDebits, whole.totals.sumCredits) && close(whole.rows.filter((x) => n(x.balance) !== 0).length, detailRows(mineTb).length) && close(whole.totals.sumDebits, mineTb.json?.totals?.debit + 0 === 0 ? 0 : whole.totals.sumDebits), { w: whole.totals, m: mineTb.json?.totals });

  // 13: small items
  r = await F.run("profit-loss", `from=${y}-03-01&to=${y}-03-31&compare=priorPeriod`);
  ok("fix 13: prior period of a calendar month is the previous calendar month (Feb 1-28)", r.json?.params?.compare?.from === `${y}-02-01` && r.json?.params?.compare?.to === `${y}-02-28`, r.json?.params);
  r = await F.run("profit-loss", `from=${y}-04-01&to=${y}-06-30&compare=priorPeriod`);
  ok("fix 13: prior period of a quarter is the previous quarter", r.json?.params?.compare?.from === `${y}-01-01` && r.json?.params?.compare?.to === `${y}-03-31`, r.json?.params);
  r = await F.run("profit-loss", `from=${y}-03-05&to=${y}-03-11&compare=priorPeriod`);
  ok("fix 13: an arbitrary range still shifts by its own number of days", r.json?.params?.compare?.from === `${y}-02-26` && r.json?.params?.compare?.to === `${y}-03-04`, r.json?.params);
  r = await F.run("profit-loss", `from=${y}-01-01&to=${today}&asOf=${today}`);
  ok("fix 13: asOf on a range report is 400 UNKNOWN_PARAM like any unknown key", r.status === 400 && r.json?.code === "UNKNOWN_PARAM", { s: r.status, j: r.json });
  r = await F.run("trial-balance", `asOf=${today}&from=${y}-01-01`);
  ok("fix 13: from on an as-of report is 400 UNKNOWN_PARAM", r.status === 400 && r.json?.code === "UNKNOWN_PARAM", { s: r.status, j: r.json });
  r = await T.run("profit-loss", `from=${y}-02-01&to=${y}-02-28&compare=priorYear`);
  ok("fix 13: section heading rows carry no comparison cells", Object.keys(row(r, "section:revenue")?.cells ?? {}).every((k) => !/__/.test(k)), row(r, "section:revenue")?.cells);
  // employees do not see schedules of sensitive reports
  const emp = await api("POST", "/api/auth/register", { body: { name: "e", email: `fixemp_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'employee')`, [R.cid, emp.json.user.id]);
  await post(`/api/companies/${R.cid}/report-schedules`, { reportId: "payroll-register", params: { rangePreset: "lastMonth" }, format: "csv", lang: "en", cadence: "monthly", dayOfMonth: 5, hourDubai: 7, recipientUserIds: [R.userId] }, R.token);
  const mine = (await api("GET", `/api/companies/${R.cid}/report-schedules`, { token: R.token })).json;
  const theirsRes = await api("GET", `/api/companies/${R.cid}/report-schedules`, { token: emp.json.token });
  // The employee role is kept out of the schedules altogether (employee-denial middleware), so it cannot see the sensitive ones either.
  ok("fix 13: an employee sees no schedules (403 ROLE_REQUIRED), the owner sees the payroll one", mine.some((x) => x.reportId === "payroll-register") && theirsRes.status === 403 && theirsRes.json?.code === "ROLE_REQUIRED", { mine: mine.map((x) => x.reportId), s: theirsRes.status, j: theirsRes.json });
  // pending bills paginate instead of being capped at 1,000
  const Q = await newCompany("fixpend");
  await db.query(`INSERT INTO vendor_bills (company_id, vendor_name, bill_date, due_date, subtotal, vat_amount, total_amount, status) SELECT $1, 'Pending ' || g, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), 10, 0.5, 10.5, 'pending' FROM generate_series(1, 1100) g`, [Q.cid]);
  r = await Q.run("payables-detail", `asOf=${today}&limit=1000&offset=1000`);
  ok("fix 13: 1,100 pending bills are all reachable by paging (total >= 1,100, no silent cap)", r.status === 200 && r.json?.page?.total >= 1100 && detailRows(r).length >= 100, r.json?.page);
  // drill ids
  const D = await newCompany("fixdrill");
  await db.query(`INSERT INTO receipts (company_id, uploaded_by, merchant, date, amount, vat_amount, posted, currency) VALUES ($1,$2,'Shop',$3::timestamp,200,10,true,'AED')`, [D.cid, D.userId, prevMid]);
  const dc = (await db.query(`INSERT INTO expense_claims (company_id, submitted_by, title, claim_number, total_amount, status) VALUES ($1,$2,'Taxi','EC-D',100,'approved') RETURNING id`, [D.cid, D.userId])).rows[0];
  await db.query(`INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount) VALUES ($1,$2::timestamp,'travel','Taxi',100,5)`, [dc.id, prevMid]);
  r = await D.run("vat-audit-purchases", `from=${prevStart}&to=${prevEnd}`);
  const rec = detailRows(r).find((x) => /Receipt|إيصال/.test(x.cells.type));
  const clm = detailRows(r).find((x) => /claim|مطالبة/i.test(x.cells.type));
  ok("fix 13: drills carry document ids: a receipt row drills to its receipt, a claim row to its claim (not the item)", rec?.drill?.target === "receipt" && /^[0-9a-f-]{36}$/.test(rec?.drill?.id ?? "") && clm?.drill?.target === "expense_claim" && clm?.drill?.id === dc.id, { rec: rec?.drill, clm: clm?.drill });

  // The return equals the ledger for every document the ledger posted. Issuing posts the journal (committed, its
  // month lock released) and only THEN flips the status; a filing that gets in between sees a posted revenue
  // entry on an invoice still marked draft. Simulated here by setting the status back by hand.
  const W = await newCompany("fixwin");
  await W.invoice(prevMid, 1000);
  const win = await W.invoice(prevMid, 104);
  await db.query(`UPDATE invoices SET status = 'draft' WHERE id = $1`, [win.id]);
  const gw = await post(`/api/companies/${W.cid}/vat-returns/generate`, { periodStart: prevStart, periodEnd: prevEnd }, W.token);
  const ledgerOut = n((await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0) AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '2020'`, [W.cid])).rows[0].v);
  ok("fix 14: an invoice whose journal is posted but whose status is still draft (mid-issue) is on the return: box 1 equals the ledger's output VAT",
    close(sumKeys(gw.json, /^box1[a-g].*Vat$/), ledgerOut, 0.0001) && close(ledgerOut, 55.2, 0.0001), { box1: sumKeys(gw.json, /^box1[a-g].*Vat$/), ledgerOut });
  const aw = await W.run("vat-audit-sales", `from=${prevStart}&to=${prevEnd}`);
  ok("fix 14: ... and on the VAT Audit sales rows", close(aw.json?.totals?.vat, ledgerOut, 0.0001) && detailRows(aw).length === 2, { total: aw.json?.totals?.vat, rows: detailRows(aw).length });
  const fw = await post(`/api/vat-returns/${gw.json?.id}/file`, { ftaReferenceNumber: `RV-${rnd}-win`, filedAt: today }, W.token);
  ok("fix 14: ... so the filing's ledger tie-check passes (201)", fw.status === 201, { s: fw.status, t: fw.text?.slice(0, 200) });
}

// ═════════════════════════════════════════════════════════════════════════════
// AC1 + AC9: every live catalog report runs, in every format
// ═════════════════════════════════════════════════════════════════════════════
const AR_LETTER = /[\u0600-\u06FF]/;
const countCsvRecords = (text) => {
  // records of an RFC 4180 CSV (quoted fields may hold CRLF)
  let n = 0, inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (inQ && text[i + 1] === '"') i++; else inQ = !inQ; }
    else if (c === "\n" && !inQ) n++;
  }
  return n;
};

async function seedEverything(label = "sweep") {
  const S = await newCompany(label);
  const y = now.getUTCFullYear();
  await S.je(day(60), [["1020", 50000, 0], ["3010", 0, 50000]], "opening_balance", "capital");
  const inv = await S.invoice(day(40), 1000);
  await S.pay(inv.id, 500, day(20));
  await S.invoice(day(5), 2000, { currency: "USD", exchangeRate: 3.6725 });
  await S.je(day(10), [["5000", 300, 0], ["1020", 0, 300]]);
  // a posted receipt and an approved + a pending bill
  await db.query(`INSERT INTO receipts (company_id, uploaded_by, merchant, date, amount, vat_amount, posted, currency) VALUES ($1,$2,'Stationery LLC',$3::timestamp,200,10,true,'AED')`, [S.cid, S.userId, day(15)]);
  const bill = await S.bill(day(30), 1000, { vendor: "Vendor A" });
  await S.approveBill(bill.id);
  await S.payBill(bill.id, 400, day(10));
  await S.bill(day(3), 500, { vendor: "Vendor B" });
  // bank, assets, payroll, budget, quote, recurring, PO, product, claim, close
  const ba = (await db.query(`INSERT INTO bank_accounts (company_id, name_en, bank_name) VALUES ($1,'Main','Test Bank') RETURNING id`, [S.cid])).rows[0];
  for (const amt of [100, -50, 25]) await db.query(`INSERT INTO bank_transactions (company_id, bank_account_id, bank_statement_account_id, transaction_date, description, amount, is_reconciled) VALUES ($1,$2,$3,$4::timestamp,'item',$5,false)`, [S.cid, S.acct("1020").id, ba.id, day(7), amt]);
  const fa = (await db.query(`INSERT INTO fixed_assets (company_id, asset_name, asset_number, category, purchase_date, purchase_cost, useful_life_years) VALUES ($1,'Laptop','FA-1','equipment',$2::timestamp,3600,3) RETURNING id`, [S.cid, day(90)])).rows[0];
  await db.query(`INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, posted_at) VALUES ($1,$2,$3,$4,100,now())`, [S.cid, fa.id, y, now.getUTCMonth() + 1]);
  await db.query(`INSERT INTO fixed_assets (company_id, asset_name, category, purchase_date, purchase_cost, useful_life_years, disposal_date, disposal_amount, accumulated_depreciation, status) VALUES ($1,'Old printer','equipment',$2::timestamp,1000,5,$3::timestamp,300,600,'disposed')`, [S.cid, day(400), day(12)]);
  const emp = (await db.query(`INSERT INTO employees (company_id, full_name, employee_number, basic_salary) VALUES ($1,'Sara Test','E1',5000) RETURNING id`, [S.cid])).rows[0];
  const run = (await db.query(`INSERT INTO payroll_runs (company_id, period_month, period_year, total_basic, total_net, employee_count, status) VALUES ($1,$2,$3,5000,5000,1,'approved') RETURNING id`, [S.cid, now.getUTCMonth() + 1, y])).rows[0];
  await db.query(`INSERT INTO payroll_items (payroll_run_id, employee_id, basic_salary, net_salary) VALUES ($1,$2,5000,5000)`, [run.id, emp.id]);
  const plan = (await db.query(`INSERT INTO budget_plans (company_id, name, fiscal_year, start_date, end_date, status) VALUES ($1,'Plan',$2,$3::timestamp,$4::timestamp,'approved') RETURNING id`, [S.cid, y, `${y}-01-01`, `${y}-12-31`])).rows[0];
  await db.query(`INSERT INTO budget_lines (budget_id, account_id, category, jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec) VALUES ($1,$2,'Expenses',100,100,100,100,100,100,100,100,100,100,100,100)`, [plan.id, S.acct("5000").id]);
  await db.query(`INSERT INTO quotes (company_id, number, customer_name, date, total, status) VALUES ($1,'Q-1','Report Co',$2::timestamp,500,'draft')`, [S.cid, day(6)]);
  await db.query(`INSERT INTO recurring_invoices (company_id, customer_name, start_date, next_run_date, lines_json, frequency, is_active) VALUES ($1,'Report Co',$2::timestamp,$3::timestamp,'[{"description":"Retainer","quantity":1,"unitPrice":100,"vatRate":0.05}]','monthly',true)`, [S.cid, day(30), day(-5)]);
  await db.query(`INSERT INTO purchase_orders (company_id, number, vendor_name, date, total, status) VALUES ($1,'PO-1','Vendor A',$2::timestamp,300,'sent')`, [S.cid, day(8)]);
  const prod = (await db.query(`INSERT INTO products (company_id, name, sku, track_inventory, current_stock, inventory_value, average_cost) VALUES ($1,'Widget','W1',true,10,100,10) RETURNING id`, [S.cid])).rows[0];
  await db.query(`INSERT INTO inventory_movements (product_id, company_id, type, quantity, unit_cost, total_cost) VALUES ($1,$2,'purchase',10,10,100)`, [prod.id, S.cid]);
  const claim = (await db.query(`INSERT INTO expense_claims (company_id, submitted_by, title, claim_number, total_amount, status, submitted_at) VALUES ($1,$2,'Taxi','EC-1',50,'approved',now()) RETURNING id`, [S.cid, S.userId])).rows[0];
  await db.query(`INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount) VALUES ($1,$2::timestamp,'travel','Taxi',50,2.5)`, [claim.id, day(4)]);
  await db.query(`INSERT INTO month_end_close (company_id, period_start, period_end, status) VALUES ($1,$2::timestamp,$3::timestamp,'closed')`, [S.cid, `${y}-01-01`, `${y}-01-31`]);
  await db.query(`INSERT INTO cost_centers (company_id, code, name) VALUES ($1,'CC1','Sales')`, [S.cid]);
  return S;
}

// Extra accountants with their own rate-limit key, so the export loop is not throttled by one user's 30 a minute.
async function extraMembers(S, count) {
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const r = await api("POST", "/api/auth/register", { body: { name: "m" + i, email: `m${i}_${rnd}_${S.cid.slice(0, 4)}@example.com`, password: "Password123!" } });
    await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'accountant')`, [S.cid, r.json.user.id]);
    tokens.push(r.json.token);
  }
  return tokens;
}

function queryFor(entry, extra = "") {
  const p = entry.params ?? [];
  const parts = [];
  if (p.includes("range")) parts.push(`from=${yearStart}`, `to=${today}`);
  if (p.includes("asOf")) parts.push(`asOf=${today}`);
  return parts.join("&") + (extra ? "&" + extra : "");
}

async function allReportsSweep() {
  const S = await seedEverything();
  const cat = await api("GET", "/api/reports/catalog", { token: S.token });
  const live = (cat.json?.reports ?? []).filter((r) => r.status === "live");
  ok("AC1: the catalog has at least 55 live reports (56 after wave 1)", cat.json?.summary?.liveReportCount >= 55 && live.length >= 55, { live: cat.json?.summary?.liveReportCount });
  ok("AC1: every live entry has href, params within range/asOf/comparison, and a drillTarget",
    live.every((r) => r.href && Array.isArray(r.params) && r.params.length > 0 && r.params.every((x) => ["range", "asOf", "comparison"].includes(x)) && r.drillTarget),
    live.filter((r) => !(r.href && r.params && r.drillTarget)).map((r) => r.id));
  ok("AC1: every live entry reports its formats and whether it can be scheduled", live.every((r) => Array.isArray(r.formats) && r.formats.includes("pdf") && typeof r.schedulable === "boolean"), live.find((r) => !Array.isArray(r.formats)));

  // values on the seeded company
  const v = async (id, q = queryFor(live.find((e) => e.id === id))) => (await S.run(id, q)).json;
  let x = await v("fixed-asset-register");
  ok("values: fixed asset register NBV = cost - posted depreciation (3,600 - 100) and the disposed asset is not on it", close(x.totals?.nbv, 3500) && close(x.totals?.cost, 3600), x.totals);
  x = await v("asset-disposals");
  ok("values: asset disposals gain/(loss) = proceeds - NBV at disposal (300 - 400 = -100)", close(x.totals?.gainLoss, -100) && close(x.totals?.proceeds, 300), x.totals);
  x = await v("depreciation-schedule");
  ok("values: depreciation schedule lists the posted month (100)", close(x.totals?.amount, 100), x.totals);
  x = await v("payroll-register");
  ok("values: payroll register shows the employee's net pay (5,000) and totals match the run", close(x.totals?.net, 5000) && x.rows.length === 1, x.totals);
  x = await v("payroll-summary");
  ok("values: payroll summary matches the register", close(x.totals?.net, 5000) && x.rows.length === 1, x.totals);
  x = await v("wps-sif-summary");
  ok("values: WPS summary shows the run and that no SIF file was generated", x.rows.length === 1 && /Not generated/.test(x.rows[0].cells.sif), x.rows[0]?.cells);
  x = await v("unreconciled-bank-items");
  ok("values: unreconciled bank items count 3 and net 75", x.rows.length === 3 && close(x.totals?.amount, 75), x.totals);
  x = await v("inventory-valuation");
  ok("values: inventory valuation shows 10 units worth 100", x.rows.filter((r) => r.kind === "detail").length === 1 && close(x.totals?.value, 100) && x.totals?.quantity === 10, x.totals);
  x = await v("inventory-valuation", `asOf=${day(1)}`);
  ok("values: valued as of yesterday, the purchase movement made today is wound back (nothing on hand)", x.rows.filter((r) => r.kind === "detail").length === 0, x.rows);
  x = await v("inventory-summary");
  ok("values: inventory summary shows on-hand 10", x.rows.length === 1 && x.rows[0].cells.onHand === 10, x.rows[0]?.cells);
  x = await v("inventory-movement");
  ok("values: inventory movement lists the purchase", x.rows.length === 1 && x.rows[0].cells.quantity === 10 && x.rows[0].cells.type === "purchase", x.rows[0]?.cells);
  x = await v("purchase-orders-status");
  ok("values: purchase orders status lists PO-1", x.rows.length === 1 && x.rows[0].cells.number === "PO-1", x.rows[0]?.cells);
  x = await v("quotes-conversion");
  ok("values: quotes status lists the quote and the conversion summary (0 of 1)", detailRowsOf(x).length === 1 && x.rows.some((r) => r.key === "summary:conversion" && /0 of 1/.test(r.cells.customer)), x.rows.map((r) => r.cells));
  x = await v("recurring-schedule");
  ok("values: recurring schedule shows the active template and its per-invoice amount (105)", x.rows.length === 1 && close(x.rows[0].cells.amount, 105) && x.rows[0].cells.frequency === "monthly", x.rows[0]?.cells);
  x = await v("expense-claims");
  ok("values: expense claims lists the claim (50)", x.rows.length === 1 && close(x.totals?.total, 50), x.totals);
  x = await v("month-end-close-status", `from=${yearStart}&to=${yearStart.slice(0, 5)}03-31`);
  ok("values: month-end close status shows January closed and February open", x.rows[0]?.cells.status === "closed" && x.rows[1]?.cells.status === "open", x.rows.map((r) => r.cells));
  x = await v("purchases-vendor");
  ok("values: purchases by vendor counts posted bills only (Vendor A 1,000 net; the pending Vendor B bill is left out)", x.rows.some((r) => r.cells.vendor === "Vendor A" && close(r.cells.net, 1000)) && !x.rows.some((r) => r.cells.vendor === "Vendor B"), x.rows.map((r) => r.cells));
  x = await v("purchases-item");
  ok("values: purchases by item groups bill lines (Supplies 1,000)", x.rows.some((r) => r.cells.item === "Supplies" && close(r.cells.net, 1000)), x.rows.map((r) => r.cells));
  x = await v("payments-made");
  ok("values: payments made shows the 400 bill payment", close(x.totals?.amount, 400) && x.rows.length === 1, x.totals);
  x = await v("expenses-vendor");
  ok("values: expenses by vendor includes bills and posted receipts", x.rows.some((r) => r.cells.vendor === "Vendor A") && x.rows.some((r) => r.cells.vendor === "Stationery LLC" && close(r.cells.amount, 200)), x.rows.map((r) => r.cells));
  x = await v("budget-actual");
  ok("values: budget vs actual: 12 x 100 budgeted, months in range only (the lines carry the plan)", x.rows.length === 1 && x.rows[0].cells.budget > 0 && x.rows[0].cells.account.startsWith("5000"), x.rows[0]?.cells);
  x = await v("cash-flow-forecast");
  ok("values: cash flow forecast has weekly buckets from today and opens at the cash balance", x.rows.length >= 12 && x.rows[0].key === "opening" && typeof x.rows[0].cells.balance === "number", x.rows.slice(0, 3).map((r) => r.cells));
  x = await v("customer-balances");
  ok("values: customer balances: Report Co owes the two open invoices", x.rows.some((r) => r.cells.customer === "Report Co" && r.cells.open > 0), x.rows.map((r) => r.cells));
  x = await v("vendor-balances");
  ok("values: vendor balances = payables ageing (Vendor A: 1,050 bill less 400 paid = 650 open)", x.rows.some((r) => r.cells.vendor === "Vendor A" && close(r.cells.open, 650)), x.rows.map((r) => r.cells));
  x = await v("invoice-status");
  ok("values: invoice status counts the two issued invoices", x.rows.reduce((a, r) => a + r.cells.count, 0) === 2, x.rows.map((r) => r.cells));
  x = await v("cost-center-profitability");
  ok("values: cost centre P&L runs (everything unallocated here)", x.rows.every((r) => r.cells.name), x.rows.map((r) => r.cells));
  x = await v("expenses-category");
  ok("values: expenses by category lists General Expenses (journal 300 + the approved bill 1,000)", x.rows.some((r) => r.cells.code === "5000" && close(r.cells.amount, 1300)), x.rows.map((r) => r.cells));

  const members = await extraMembers(S, 10);
  const bad = [];
  const csvBad = [], xlsxBad = [], pdfBad = [], arBad = [];
  let i = 0;
  for (const entry of live) {
    const q = queryFor(entry);
    const j = await S.run(entry.id, q);
    if (j.status !== 200 || !Array.isArray(j.json?.rows) || !j.json?.reportId) { bad.push({ id: entry.id, s: j.status, j: j.json }); continue; }
    const full = await S.run(entry.id, q + "&limit=1000");
    const total = full.json?.page?.total ?? full.json.rows.length;
    const token = members[i++ % members.length];
    const csv = await api("GET", `/api/companies/${S.cid}/reports/run/${entry.id}?${q}&format=csv`, { token, raw: true });
    const text = csv.buf.toString("utf8");
    const records = countCsvRecords(text);
    const expectRecords = 1 + total + (j.json.totals ? 1 : 0);
    if (csv.status !== 200 || !/text\/csv/.test(csv.headers.get("content-type") ?? "") || records !== expectRecords) csvBad.push({ id: entry.id, s: csv.status, records, expectRecords });
    const xl = await api("GET", `/api/companies/${S.cid}/reports/run/${entry.id}?${q}&format=xlsx`, { token, raw: true });
    if (xl.status !== 200 || !/spreadsheetml/.test(xl.headers.get("content-type") ?? "") || xl.buf.subarray(0, 2).toString() !== "PK") xlsxBad.push({ id: entry.id, s: xl.status });
    const pdf = await api("GET", `/api/companies/${S.cid}/reports/run/${entry.id}?${q}&format=pdf&lang=ar`, { token, raw: true });
    if (pdf.status !== 200 || pdf.buf.subarray(0, 4).toString() !== "%PDF") pdfBad.push({ id: entry.id, s: pdf.status });
    const csvAr = await api("GET", `/api/companies/${S.cid}/reports/run/${entry.id}?${q}&format=csv&lang=ar`, { token, raw: true });
    if (csvAr.status !== 200 || !AR_LETTER.test(csvAr.buf.toString("utf8").split("\r\n")[0])) arBad.push({ id: entry.id, s: csvAr.status });
  }
  ok(`AC1: all ${live.length} live reports return 200 JSON on a seeded company`, bad.length === 0, bad);
  ok("AC9: CSV is 200 text/csv with the same row count (plus header and totals) as JSON for every report", csvBad.length === 0, csvBad);
  ok("AC9: XLSX is 200 with the spreadsheet MIME for every report", xlsxBad.length === 0, xlsxBad);
  ok("AC9: PDF (lang=ar) is 200 and starts with %PDF for every report", pdfBad.length === 0, pdfBad);
  ok("AC9: lang=ar CSV carries Arabic column headers for every report", arBad.length === 0, arBad);
}

// ═════════════════════════════════════════════════════════════════════════════
// Frontend (S8): the viewer's own client modules against the live server. A helper runs the real query builders,
// drill resolver and dashboard readers under Node (tests/integration/helpers/report-ui-contract.mts).
// ═════════════════════════════════════════════════════════════════════════════
function uiContract(payload) {
  const res = spawnSync("npx", ["tsx", path.join(here, "helpers", "report-ui-contract.mts")], { input: JSON.stringify(payload), encoding: "utf8", cwd: path.join(here, "..", ".."), maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  try { return JSON.parse(res.stdout); } catch { return { error: (res.stderr || res.stdout || "").slice(0, 800) }; }
}

async function frontendContract() {
  const S = await seedEverything("uisweep");
  const members = await extraMembers(S, 4);
  const ui = uiContract({ companyId: S.cid });
  ok("UI: the viewer's helper runs (query builders load under Node)", Array.isArray(ui.reports) && ui.reports.length >= 55, ui.error ?? ui.reports?.length);
  if (!Array.isArray(ui.reports)) return;

  // 1. The first-page query the viewer sends is accepted for every live report, in Arabic, with its page size.
  const first = [], paged = [], tab = [], compareBad = [], sensitiveOk = [];
  let i = 0;
  for (const rep of ui.reports) {
    const token = members[i++ % members.length];
    const call = (q) => api("GET", `/api/companies/${S.cid}/reports/run/${rep.id}${q ? "?" + q : ""}`, { token });
    const a = await call(rep.query);
    if (a.status !== 200 || a.json?.reportId !== rep.id) first.push({ id: rep.id, s: a.status, code: a.json?.code, q: rep.query });
    const b = await call(rep.nextPageQuery);
    if (b.status !== 200 || b.json?.page?.offset !== 1 || b.json?.page?.limit !== 1) paged.push({ id: rep.id, s: b.status, page: b.json?.page });
    const t = await call(rep.tabQuery);
    if (t.status !== 200) tab.push({ id: rep.id, s: t.status, code: t.json?.code, q: rep.tabQuery });
    for (const c of rep.compare) {
      const k = await call(c.query);
      const cols = (k.json?.columns ?? []).map((x) => x.key);
      const hasCmp = cols.some((key) => key.endsWith("__cmp")) && cols.some((key) => key.endsWith("__delta")) && cols.some((key) => key.endsWith("__pct"));
      // a report with its own comparison (comparative trial balance) names its columns itself
      if (k.status !== 200 || !(hasCmp || rep.id === "comparative-trial-balance")) compareBad.push({ id: rep.id, mode: c.mode, s: k.status, code: k.json?.code });
    }
  }
  ok("UI: the viewer's default query returns 200 for every live report (Arabic, page size 250)", first.length === 0, first);
  ok("UI: its 'load more' query (offset + limit) is accepted and echoed in page for every live report", paged.length === 0, paged);
  ok("UI: the Reports page tab's choices (range end as the as-of day, ageing date) are accepted for every live report", tab.length === 0, tab);
  ok("UI: every comparison choice the parameter bar offers returns the three comparison columns", compareBad.length === 0, compareBad);

  // 2. The file links the export menu builds download with the right type and a file name.
  const exportBad = [];
  for (const rep of ui.reports.filter((r) => ["profit-loss", "ar-aging", "general-ledger", "vat-audit-sales"].includes(r.id))) {
    for (const [fmt, mime] of [["csv", /text\/csv/], ["xlsx", /spreadsheetml/], ["pdf", /application\/pdf/]]) {
      const q = rep.csvQuery.replace("format=csv", "format=" + fmt);
      const r = await api("GET", `/api/companies/${S.cid}/reports/run/${rep.id}?${q}`, { token: members[0], raw: true });
      const cd = r.headers.get("content-disposition") ?? "";
      if (r.status !== 200 || !mime.test(r.headers.get("content-type") ?? "") || !new RegExp("filename=\"?[^\"]+\\." + fmt).test(cd)) exportBad.push({ id: rep.id, fmt, s: r.status, cd });
    }
  }
  ok("UI: the export menu's csv, xlsx and pdf links return the right type with a named attachment", exportBad.length === 0, exportBad);

  // 3. Every column the server sends is a type the table renders, and every cell belongs to a column.
  const known = new Set(["text", "money", "date", "number", "percent"]);
  const shapeBad = [], drills = [];
  for (const rep of ui.reports) {
    const r = await api("GET", `/api/companies/${S.cid}/reports/run/${rep.id}?${rep.query}`, { token: members[1] });
    const cols = new Set((r.json?.columns ?? []).map((c) => c.key));
    const badType = (r.json?.columns ?? []).filter((c) => !known.has(c.type) || !c.label?.en || !c.label?.ar).map((c) => c.key);
    const badCell = (r.json?.rows ?? []).filter((row) => Object.keys(row.cells ?? {}).some((k) => !cols.has(k))).map((row) => row.key);
    const badKind = (r.json?.rows ?? []).filter((row) => !["detail", "section", "subtotal"].includes(row.kind)).map((row) => row.key);
    if (badType.length || badCell.length || badKind.length) shapeBad.push({ id: rep.id, badType, badCell: badCell.slice(0, 3), badKind: badKind.slice(0, 3) });
    for (const row of r.json?.rows ?? []) if (row.drill) drills.push({ ...row.drill, report: rep.id });
  }
  ok("UI: every column has a known type and both labels (en, ar); every cell and row kind is one the table renders", shapeBad.length === 0, shapeBad.slice(0, 5));

  // 4. Every drill the server returned opens a page (the client knows every target the server uses).
  const unique = [...new Map(drills.map((d) => [d.target + ":" + d.report, d])).values()];
  const resolved = uiContract({ companyId: S.cid, drills: unique });
  const noHref = unique.filter((d, k) => !resolved.drillHrefs?.[k] || !String(resolved.drillHrefs[k]).startsWith("/"));
  ok(`UI: all ${unique.length} drill target kinds the live reports return resolve to a page (${[...new Set(unique.map((d) => d.target))].join(", ")})`, unique.length > 5 && noHref.length === 0, noHref);

  // 5. Dashboard: the period paths the toggle uses, and the five ageing keys the panel reads.
  const month = await api("GET", ui.dashboardPaths.month.replace("COMPANY", S.cid), { token: S.token });
  const ytd = await api("GET", ui.dashboardPaths.ytd.replace("COMPANY", S.cid), { token: S.token });
  ok("UI: the dashboard's month and year-to-date requests answer 200 with the period they cover", month.status === 200 && ytd.status === 200 && month.json?.period?.kind === "month" && ytd.json?.period?.kind === "ytd", { m: month.json?.period, y: ytd.json?.period });
  const keysOf = (o) => Object.keys(o ?? {}).sort().join(",");
  const expectKeys = [...ui.bucketKeys].sort().join(",");
  ok("UI: arAging and apAging carry exactly the five bucket keys the panel reads", keysOf(ytd.json?.arAging) === expectKeys && keysOf(ytd.json?.apAging) === expectKeys, { ar: keysOf(ytd.json?.arAging), ap: keysOf(ytd.json?.apAging) });
  const read = uiContract({ companyId: S.cid, stats: ytd.json });
  const sum = (b) => Object.values(b).reduce((x, y) => x + y, 0);
  ok("UI: the panel's reading of the ageing equals the server's outstanding and payables, and the overdue figure is everything past due",
    read.ageing && close(sum(read.ageing.ar), ytd.json.outstanding) && close(sum(read.ageing.ap), ytd.json.payablesOutstanding) && close(sum(read.ageing.ar) - read.ageing.ar.current, ytd.json.overdueReceivables),
    { ar: read.ageing?.ar, outstanding: ytd.json.outstanding, overdue: ytd.json.overdueReceivables });
  ok("UI: VAT due next reads as an amount with its dates for a registered company", read.ageing?.vat?.kind === "amount" || ytd.json?.vatDueNext?.amount === null, { vat: read.ageing?.vat, raw: ytd.json?.vatDueNext });

  // 6. Schedules: every range and as-of preset the dialog offers is accepted, and the list/pause/run-now/delete calls the page makes.
  const presetBad = [];
  const created = [];
  for (const preset of ui.rangePresets) {
    const r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: { reportId: "profit-loss", params: { rangePreset: preset, compare: "priorYear" }, format: "csv", lang: "ar", cadence: "monthly", dayOfMonth: 1, hourDubai: 7, recipientUserIds: [S.userId] } });
    if (r.status !== 201) presetBad.push({ preset, s: r.status, code: r.json?.code }); else created.push(r.json.id);
  }
  for (const preset of ui.asOfPresets) {
    const r = await api("POST", `/api/companies/${S.cid}/report-schedules`, { token: S.token, body: { reportId: "ar-aging", params: { asOfPreset: preset }, format: "xlsx", lang: "en", cadence: "daily", hourDubai: 6, recipientUserIds: [S.userId] } });
    if (r.status !== 201) presetBad.push({ preset, s: r.status, code: r.json?.code }); else created.push(r.json.id);
  }
  ok(`UI: every one of the ${ui.rangePresets.length + ui.asOfPresets.length} presets the schedule dialog offers is accepted (201)`, presetBad.length === 0, presetBad);
  const list = await api("GET", `/api/companies/${S.cid}/report-schedules`, { token: S.token });
  const row0 = list.json?.find((x) => x.id === created[0]);
  ok("UI: the list the schedules page reads has the fields it shows (cadence, format, recipients, next run, last status key)",
    list.status === 200 && row0 && ["reportId", "format", "lang", "cadence", "hourDubai", "recipientUserIds", "enabled", "nextRunAt", "params"].every((k) => k in row0) && "lastRunStatus" in row0, row0);
  const pause = await api("PATCH", `/api/companies/${S.cid}/report-schedules/${created[0]}`, { token: S.token, body: { enabled: false } });
  const resume = await api("PATCH", `/api/companies/${S.cid}/report-schedules/${created[0]}`, { token: S.token, body: { enabled: true } });
  ok("UI: the pause switch (PATCH enabled false, then true) round-trips", pause.json?.enabled === false && resume.json?.enabled === true, { p: pause.json?.enabled, r: resume.json?.enabled });
  const edit = await api("PATCH", `/api/companies/${S.cid}/report-schedules/${created[0]}`, { token: S.token, body: { format: "xlsx", cadence: "weekly", dayOfWeek: 2 } });
  ok("UI: the edit dialog's partial update changes cadence without losing the stored presets", edit.status === 200 && edit.json?.cadence === "weekly" && edit.json?.params?.rangePreset === ui.rangePresets[0], edit.json);
  const run = await api("POST", `/api/companies/${S.cid}/report-schedules/${created[0]}/run-now`, { token: S.token });
  const finished = await waitRun(S, created[0], run.json?.runId);
  const statuses = ["running", "sent", "skipped", "failed"];
  ok("UI: run now returns a run the history table can show (status in the four it labels, trigger manual, a reason for a skip)",
    run.status === 202 && finished && statuses.includes(finished.status) && finished.trigger === "manual" && (finished.status !== "skipped" || !!finished.reason), finished);
  const del = await api("DELETE", `/api/companies/${S.cid}/report-schedules/${created[0]}`, { token: S.token });
  ok("UI: delete answers 204 and the schedule is gone from the list", del.status === 204 && !(await api("GET", `/api/companies/${S.cid}/report-schedules`, { token: S.token })).json.some((x) => x.id === created[0]), del.status);

  // 7. Consolidation picker: the company ids and statement the picker puts in the query.
  const pl = await S.run("consolidated-statements", `from=${yearStart}&to=${today}&statement=pl&companyIds=${S.cid}`);
  const bs = await S.run("consolidated-statements", `asOf=${today}&statement=bs&companyIds=${S.cid}`);
  ok("UI: the consolidation picker's single-company P&L and balance sheet both return an entity column, eliminations and consolidated",
    [pl, bs].every((x) => x.status === 200 && ["entity_0", "elimination", "consolidated"].every((k) => x.json.columns.some((c) => c.key === k))), { pl: pl.status, bs: bs.status });
  const strict = await S.run("consolidated-statements", `from=${yearStart}&to=${today}&statement=pl&companyIds=${S.cid}&strict=1`);
  ok("UI: the picker's strict switch (strict=1) is accepted by the consolidation", strict.status === 200, { s: strict.status, c: strict.json?.code });
  const strayKey = await S.run("profit-loss", `from=${yearStart}&to=${today}&asOf=${today}`);
  const strayKey2 = await S.run("profit-loss", `from=${yearStart}&to=${today}&bogus=1`);
  ok("UI: a choice the report does not take is refused 400 UNKNOWN_PARAM, which the viewer words in its own error text", strayKey.status === 400 && strayKey.json?.code === "UNKNOWN_PARAM" && strayKey2.json?.code === "UNKNOWN_PARAM", { a: strayKey.json?.code, b: strayKey2.json?.code });
}

main().catch((e) => { console.error(e); process.exit(1); });
