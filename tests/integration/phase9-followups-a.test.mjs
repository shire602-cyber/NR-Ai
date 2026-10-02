// Integration tests for the Phase 9 follow-ups (set A): live requests against a running server + Postgres.
//   1  vendor credits in the dashboard payables figure and the client portal payables (both equal account 2010)
//   2  firm VAT workspace books-pull reads vendor bills and vendor credits like the VAT return does
//   3  the VAT return carries the journal lines behind its boxes (adjustments and taxable journal sales) for the screen
//   4  share a document with the client portal from the firm side (and take it back)
//   5  taxable sales recorded by manual journal: box 1 amount and VAT once, VAT Audit row, no double count, same in
//      the autopilot, the firm workpaper and the FAF; reversal negative; filing works
//   6  taxable purchases recorded by manual journal (box 9 amount and VAT once, audit, FAF, blocked category), the van
//      disposal (40,000 in box 1), and boxes 12-14 of the stored return including the adjustment column
//   BASE_URL=http://localhost:5098 DATABASE_URL=... node tests/integration/phase9-followups-a.test.mjs
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
async function api(method, p, { body, token, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
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
const curStart = today.slice(0, 8) + "01";
const curEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
const dayStart = (d) => `${d}T00:00:00.000Z`;
const dayEnd = (d) => `${d}T23:59:59.999Z`;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n" + "x".repeat(2000));
const PDF_B64 = PDF.toString("base64");

let db;

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const account = async (code) => ((await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? []).find((a) => a.code === code);
  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = Math.round(n(row.net) * 100) / 100;
    return out;
  };
  const invoice = async (date, unitPrice) => {
    const r1 = await api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "Sales Co", date, dueDate: date, lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 0.05 }] } });
    if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 200));
    const r2 = await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token, body: { status: "sent" } });
    if (r2.status !== 200) throw new Error("issue failed " + r2.status + " " + r2.text.slice(0, 200));
    return r1.json;
  };
  const bill = async (date, price, extra = {}) => {
    const r1 = await api("POST", `/api/companies/${cid}/bills`, { token, body: { vendor_name: "Acme Supplies", bill_date: date, due_date: date, currency: "AED", line_items: [{ description: "Goods", quantity: 1, unit_price: price, vat_rate: 5 }], ...extra } });
    if (!r1.json?.id) throw new Error("bill failed " + r1.status + " " + r1.text.slice(0, 200));
    const r2 = await api("POST", `/api/bills/${r1.json.id}/approve`, { token, body: {} });
    if (![200, 201].includes(r2.status)) throw new Error("bill approve failed " + r2.status + " " + r2.text.slice(0, 200));
    return r1.json.id;
  };
  const payBill = async (id, amount, date) => api("POST", `/api/bills/${id}/payments`, { token, body: { amount, payment_date: date, payment_method: "bank_transfer", payment_account_id: (await account("1010")).id } });
  const credit = async (billId, date, price) => {
    const r1 = await api("POST", `/api/companies/${cid}/vendor-credits`, { token, body: { bill_id: billId, date, line_items: [{ description: "Returned goods", quantity: 1, unit_price: price, vat_rate: 5 }] } });
    if (r1.status !== 201) throw new Error("credit failed " + r1.status + " " + r1.text.slice(0, 200));
    const r2 = await api("POST", `/api/companies/${cid}/vendor-credits/${r1.json.id}/approve`, { token, body: {} });
    if (r2.status !== 200) throw new Error("credit approve failed " + r2.status + " " + r2.text.slice(0, 200));
    return r1.json.id;
  };
  const apply = (creditId, billId, amount) => api("POST", `/api/companies/${cid}/vendor-credits/${creditId}/apply`, { token, body: { bill_id: billId, amount } });
  const journal = (date, lines, extra = {}) => api("POST", `/api/companies/${cid}/journal`, { token, body: { date, status: "posted", confirmBackdated: true, lines, ...extra } });
  const generate = (start, end) => api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: start, periodEnd: end } });
  const file = (rid) => api("POST", `/api/vat-returns/${rid}/file`, { token, body: { ftaReferenceNumber: `P9-${rnd}-${Math.random().toString(36).slice(2, 6)}`, filedAt: today } });
  const run = (reportId, query) => api("GET", `/api/companies/${cid}/reports/run/${reportId}?${query}`, { token });
  return { token, cid, userId, account, balances, invoice, bill, payBill, credit, apply, journal, generate, file, run };
}

/** Output VAT of the ledger for a period, read the way the filing gate reads it. */
async function ledgerOutput(C, start, end) {
  const r = await db.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.date::date >= $2::date AND je.date::date <= $3::date
        AND je.source NOT IN ('vat_filing', 'opening_balance', 'opening_balance_reversal') AND a.code = '2020'`, [C.cid, start, end]);
  return Math.round(n(r.rows[0].v) * 100) / 100;
}

/** The firm workpaper for a period: pull from the books, approve every row, read the totals. */
async function workspace(C, start, end) {
  const wp = await api("POST", `/api/companies/${C.cid}/vat-workpapers`, { token: C.token, body: { periodStart: start, periodEnd: end } });
  const pull = await api("POST", `/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}/pull-from-books`, { token: C.token, body: {} });
  await api("POST", `/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}/rows/bulk-status`, { token: C.token, body: { to: "approved" } });
  const detail = await api("GET", `/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}`, { token: C.token });
  return { pull, detail, totals: detail.json?.totals ?? {}, rows: detail.json?.rows ?? [] };
}

const autopilot = (C, start, end) =>
  api("GET", `/api/vat/autopilot/calculate/${C.cid}?periodStart=${dayStart(start)}&periodEnd=${dayEnd(end)}&frequency=monthly&persist=false`, { token: C.token });

async function fafSupplies(C, start, end) {
  const faf = await api("GET", `/api/companies/${C.cid}/reports/fta-audit-file?from=${start}&to=${end}`, { token: C.token });
  const supplies = [];
  let inBlock = false;
  for (const line of faf.text.split(/\r?\n/)) {
    if (line === "SuppDataStart") { inBlock = true; continue; }
    if (line === "SuppDataEnd") break;
    if (!inBlock || line.startsWith("CustomerName") || line.startsWith("SupplyTotalAED")) continue;
    const c = line.split(",");
    if (c.length >= 9 && /^\d{4}-\d{2}-\d{2}$/.test(c[2])) supplies.push({ number: c[3], value: n(c[6]), vat: n(c[7]) });
  }
  return supplies;
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const only = process.env.ONLY;
    const want = (k) => !only || only.split(",").includes(k);
    if (want("1")) await part1Payables();
    if (want("2")) await part2Workspace();
    if (want("5")) await part5JournalSales();
    if (want("6")) await part6Purchases();
    if (want("4")) await part4Sharing();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1: payables = posted bills - payments - applied credits - unapplied approved credits = account 2010
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function part1Payables() {
  const A = await newCompany("p9pay");
  const billId = await A.bill(prevMid, 1000);                        // owes 1,050
  const paid = await A.payBill(billId, 200, prevMid);
  ok("1: (setup) a 200 payment is recorded", [200, 201].includes(paid.status), { s: paid.status, t: paid.text.slice(0, 200) });
  const c1 = await A.credit(billId, prevMid, 200);                   // 210 credit
  const c2 = await A.credit(billId, prevMid, 40);                    // 42 credit, never applied
  const ap = await A.apply(c1, billId, 105);                         // half of credit 1 applied to the bill
  ok("1: (setup) half of the first credit is applied to the bill", ap.status === 200, { s: ap.status, j: ap.json });
  const ledger2010 = -(await A.balances())["2010"];
  ok("1: ledger account 2010 owes 1,050 - 200 - 210 - 42 = 598", close(ledger2010, 598), ledger2010);

  const stats = await api("GET", `/api/companies/${A.cid}/dashboard/stats`, { token: A.token });
  ok("1: the dashboard payables figure equals account 2010 (598), credits included", stats.status === 200 && close(stats.json?.payablesOutstanding, 598), { s: stats.status, p: stats.json?.payablesOutstanding });
  ok("1: dashboard payables ageing buckets add up to the same figure", close(Object.values(stats.json?.apAging ?? {}).reduce((s, v) => s + n(v), 0), 598), stats.json?.apAging);

  // the client portal: a portal user sees the same payables
  await db.query("UPDATE users SET user_type = 'client_portal' WHERE id = $1", [A.userId]);
  const portal = await api("GET", "/api/client-portal/dashboard", { token: A.token });
  const p = portal.json?.payables;
  ok("1: the portal dashboard payables equal account 2010 (598)", portal.status === 200 && close(p?.outstandingTotal, 598), { s: portal.status, p });
  ok("1: the portal splits open bills (1,050 - 200 - 105 = 745) from unapplied credits (105 + 42 = 147)", close(p?.billsOutstanding, 745) && close(p?.unappliedCredits, 147), p);
  ok("1: payables are stated as of today", p?.asOf === today, p?.asOf);

  // no credits: the same figure is simply the open bills
  const B = await newCompany("p9pay0");
  await B.bill(prevMid, 400);
  const sB = await api("GET", `/api/companies/${B.cid}/dashboard/stats`, { token: B.token });
  ok("1: with no credit the dashboard payables are the bill (420)", close(sB.json?.payablesOutstanding, 420), sB.json?.payablesOutstanding);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2: the firm workspace books-pull reads vendor bills and vendor credits, equal to the return
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function part2Workspace() {
  const W = await newCompany("p9wp");
  const b1 = await W.bill(prevMid, 1000);                            // box 9: 1,000 / 50
  await W.bill(prevMid, 400, { reverse_charge: true, vendor_trn: null });   // box 3 and 10: 400 / 20
  await W.credit(b1, prevMid, 200);                                  // box 9: -200 / -10
  await W.invoice(prevMid, 3000);                                    // box 1: 3,000 / 150
  const gen = await W.generate(prevStart, prevEnd);
  const g = gen.json;
  ok("2: (setup) the return has box 9 = 800 / 40 and reverse charge 400 / 20", close(g?.box9ExpensesAmount, 800) && close(g?.box9ExpensesVat, 40) && close(g?.box10ReverseChargeAmount, 400) && close(g?.box3ReverseChargeVat, 20), g && { a: g.box9ExpensesAmount, v: g.box9ExpensesVat });
  const w = await workspace(W, prevStart, prevEnd);
  ok("2: the pull created rows", w.pull.status === 200 && n(w.pull.json?.created) === 5, { s: w.pull.status, j: w.pull.json });
  const keys = ["box1bDubaiAmount", "box1bDubaiVat", "box3ReverseChargeAmount", "box3ReverseChargeVat", "box9ExpensesAmount", "box9ExpensesVat", "box10ReverseChargeAmount", "box10ReverseChargeVat", "box12TotalDueTax", "box13RecoverableTax", "box14PayableTax"];
  const diff = keys.filter((k) => !close(w.totals[k], g?.[k]));
  ok("2: the workspace totals equal the VAT return box for box (bills, credit, reverse charge, sales)", diff.length === 0, diff.map((k) => ({ k, workspace: w.totals[k], ret: g?.[k] })));
  ok("2: the bill and credit rows carry their source and are negative for the credit",
    w.rows.some((r) => r.sourceDocumentType === "vendor_bill" && close(r.taxableAmount, 1000)) && w.rows.some((r) => r.sourceDocumentType === "vendor_credit_note" && close(r.taxableAmount, -200) && close(r.vatAmount, -10)),
    w.rows.map((r) => [r.sourceDocumentType, r.rowCategory, r.taxableAmount]));
  const again = await api("POST", `/api/companies/${W.cid}/vat-workpapers/${(await db.query("SELECT id FROM vat_workpapers WHERE company_id = $1", [W.cid])).rows[0].id}/pull-from-books`, { token: W.token, body: {} });
  ok("2: pulling again adds nothing (every document already pulled)", again.status === 200 && again.json?.created === 0, again.json);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5 (and 3): taxable sales recorded by manual journal
// ─────────────────────────────────────────────────────────────────────────────────────────────
const saleLines = async (C) => [
  { accountId: (await C.account("1040")).id, debit: 1050, credit: 0 },
  { accountId: (await C.account("4010")).id, debit: 0, credit: 1000 },
  { accountId: (await C.account("2020")).id, debit: 0, credit: 50 },
];

async function part5JournalSales() {
  // J1: the Phase 4 accountant's case on its own
  const J = await newCompany("p9j1");
  const posted = await J.journal(prevMid, await saleLines(J), { memo: "Consulting invoiced outside the system" });
  ok("5: (setup) Dr 1040 1,050 / Cr 4010 1,000 / Cr 2020 50 posts", posted.status === 200, { s: posted.status, t: posted.text.slice(0, 200) });
  const entryNumber = posted.json?.entryNumber;
  const gen = await J.generate(prevStart, prevEnd);
  const g = gen.json;
  ok("5: box 1 amount +1,000 and box 1 VAT +50", close(g?.box1bDubaiAmount, 1000) && close(g?.box1bDubaiVat, 50), g && { a: g.box1bDubaiAmount, v: g.box1bDubaiVat });
  ok("5: the VAT is NOT also an adjustment (box 1 adjustment 0, box 8 adjustment 0): counted once", close(g?.box1bDubaiAdj, 0) && close(g?.box8TotalAdj, 0), g && { adj: g.box1bDubaiAdj, b8: g.box8TotalAdj });
  ok("5: box 8 = 1,000 / 50, box 12 = 50, box 14 = 50", close(g?.box8TotalAmount, 1000) && close(g?.box8TotalVat, 50) && close(g?.box12TotalDueTax, 50) && close(g?.box14PayableTax, 50), g && { b8: g.box8TotalAmount, b12: g.box12TotalDueTax });
  const ledger = await ledgerOutput(J, prevStart, prevEnd);
  ok("5: ledger 2020 = the return (50)", close(ledger, 50) && close(ledger, g?.box12TotalDueTax), { ledger, b12: g?.box12TotalDueTax });

  // 3: the screen gets the journal behind box 1
  const list = await api("GET", `/api/companies/${J.cid}/vat-returns`, { token: J.token });
  const stored = (list.json ?? []).find((r) => r.id === g?.id);
  const saleLine = (stored?.vatAdjustments ?? []).find((l) => l.kind === "journal_sale");
  ok("3: the stored return lists the journal sale under box 1 (box1bDubaiAmount, 1,000, VAT 50, journal number, description)",
    !!saleLine && saleLine.box === "box1bDubaiAmount" && close(saleLine.amount, 1000) && close(saleLine.vat, 50) && saleLine.entryNumber === entryNumber && /Consulting/.test(saleLine.description), stored?.vatAdjustments);
  ok("3: the generate response carries the same line in its metadata", (g?._metadata?.vatAdjustments ?? []).some((l) => l.kind === "journal_sale" && l.entryNumber === entryNumber), g?._metadata?.vatAdjustments);

  // the other engines agree
  const auto = await autopilot(J, prevStart, prevEnd);
  ok("5: the autopilot reports box 1 = 1,000 / 50 and box 12 = 50", close(auto.json?.vat201?.box1bDubaiAmount, 1000) && close(auto.json?.vat201?.box1bDubaiVat, 50) && close(auto.json?.vat201?.box12TotalDueTax, 50) && close(auto.json?.reconciliation?.outputVatDelta, 0), auto.json && { v: auto.json.vat201, r: auto.json.reconciliation });
  const w = await workspace(J, prevStart, prevEnd);
  ok("5: the firm workpaper pull reports box 1 = 1,000 / 50, box 12 = 50", close(w.totals.box1bDubaiAmount, 1000) && close(w.totals.box1bDubaiVat, 50) && close(w.totals.box12TotalDueTax, 50) && close(w.totals.box1bDubaiAdj, 0), w.totals);
  const faf = await fafSupplies(J, prevStart, prevEnd);
  ok("5: the FTA audit file lists the sale as 'Journal JE-...' (1,000 / 50)", faf.length === 1 && /^Journal JE-/.test(faf[0].number) && close(faf[0].value, 1000) && close(faf[0].vat, 50), faf);

  // the VAT Audit sales report
  const rep = await J.run("vat-audit-sales", `from=${prevStart}&to=${prevEnd}`);
  const rows = (rep.json?.rows ?? []).filter((r) => r.kind === "detail" || r.cells?.number);
  const jr = rows.find((r) => /^Journal JE-/.test(String(r.cells?.number)));
  ok("5: VAT Audit sales has a 'Journal JE-...' row with amount 1,000 and VAT 50, drilling to the journal entry",
    rep.status === 200 && !!jr && close(jr.cells.amount, 1000) && close(jr.cells.vat, 50) && jr.drill?.target === "journal_entry" && jr.cells.number.endsWith(String(entryNumber)), { s: rep.status, jr, rows: rows.length });
  ok("5: the audit total (1,000 / 50) equals box 1 of the return", close(rep.json?.totals?.amount, g?.box1bDubaiAmount) && close(rep.json?.totals?.vat, g?.box1bDubaiVat), rep.json?.totals);
  const vr = await J.run("vat-return", `from=${prevStart}&to=${prevEnd}`);
  ok("5: the VAT Return report agrees (box 14 = 50)", vr.status === 200 && close(vr.json?.totals?.vat, 50), vr.json?.totals);

  // filing: no ledger mismatch, the snapshot keeps the journal sale
  const filed = await J.file(g?.id);
  ok("5: filing succeeds (no VAT_LEDGER_MISMATCH)", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
  const snap = (await db.query("SELECT snapshot FROM tax_filings WHERE return_id = $1", [g?.id])).rows[0]?.snapshot;
  ok("5: the filed snapshot holds box 1 = 1,000 / 50 and the journal sale line",
    close(snap?.boxes?.box1bDubaiAmount, 1000) && close(snap?.boxes?.box1bDubaiVat, 50) && (snap?.vatAdjustments ?? []).some((l) => l.kind === "journal_sale"), { b: snap?.boxes?.box1bDubaiAmount, a: snap?.vatAdjustments });
  const bal = await J.balances();
  ok("5: after filing the output VAT account is cleared (2020 = 0)", close(bal["2020"] ?? 0, 0), bal);

  // J2: with an invoice, a correction and an input line in the same period
  const K = await newCompany("p9j2");
  await K.invoice(prevMid, 1000);                                    // 1,000 / 50
  await K.journal(prevMid, await saleLines(K), { memo: "Off-system sale" });
  const fix = await K.journal(prevMid, [{ accountId: (await K.account("2020")).id, debit: 20, credit: 0 }, { accountId: (await K.account("1020")).id, debit: 0, credit: 20 }], { memo: "Correct over-declared output VAT" });
  ok("5: (setup) a pure VAT correction posts too", fix.status === 200, { s: fix.status, t: fix.text.slice(0, 200) });
  const gk = (await K.generate(prevStart, prevEnd)).json;
  ok("5: invoice and journal sale add up in box 1 (2,000 / 100); the correction stays an adjustment (-20)", close(gk?.box1bDubaiAmount, 2000) && close(gk?.box1bDubaiVat, 100) && close(gk?.box1bDubaiAdj, -20), gk && { a: gk.box1bDubaiAmount, v: gk.box1bDubaiVat, adj: gk.box1bDubaiAdj });
  const lk = await ledgerOutput(K, prevStart, prevEnd);
  const ak = await autopilot(K, prevStart, prevEnd);
  const wk = await workspace(K, prevStart, prevEnd);
  ok("5: box 12 = 100 - 20 = 80 in the return, the autopilot, the firm workpaper and the ledger",
    close(gk?.box12TotalDueTax, 80) && close(ak.json?.vat201?.box12TotalDueTax, 80) && close(wk.totals.box12TotalDueTax, 80) && close(lk, 80), { ret: gk?.box12TotalDueTax, auto: ak.json?.vat201?.box12TotalDueTax, firm: wk.totals.box12TotalDueTax, ledger: lk });
  const rk = await K.run("vat-audit-sales", `from=${prevStart}&to=${prevEnd}`);
  ok("5: the audit sales total equals box 1 (2,000 / 100): the invoice row and the journal row", close(rk.json?.totals?.amount, 2000) && close(rk.json?.totals?.vat, 100), rk.json?.totals);
  const listK = await api("GET", `/api/companies/${K.cid}/vat-returns`, { token: K.token });
  const lines = (listK.json ?? []).find((r) => r.id === gk?.id)?.vatAdjustments ?? [];
  ok("3: the return lists both journals: the sale under box 1 amount, the correction under box 1 adjustment",
    lines.some((l) => l.kind === "journal_sale" && l.box === "box1bDubaiAmount") && lines.some((l) => !l.kind && l.box === "box1bDubaiAdj" && close(l.amount, -20)), lines);

  // J3: the reversal of the sale (dated today) is a negative sale in the month it is posted
  const R = await newCompany("p9j3");
  const rj = await R.journal(prevMid, await saleLines(R), { memo: "Off-system sale, later cancelled" });
  const rev = await api("POST", `/api/journal/${rj.json?.id}/reverse`, { token: R.token, body: { reason: "Customer cancelled" } });
  ok("5: (setup) the sale journal is reversed", [200, 201].includes(rev.status), { s: rev.status, t: rev.text.slice(0, 200) });
  const earlier = (await R.generate(prevStart, prevEnd)).json;
  ok("5: the month of the sale still reports +1,000 / +50 (the original stays declared there)", close(earlier?.box1bDubaiAmount, 1000) && close(earlier?.box1bDubaiVat, 50), earlier && { a: earlier.box1bDubaiAmount });
  const later = (await R.generate(curStart, curEnd)).json;
  ok("5: the month of the reversal reports -1,000 / -50 in box 1, no adjustment", close(later?.box1bDubaiAmount, -1000) && close(later?.box1bDubaiVat, -50) && close(later?.box1bDubaiAdj, 0), later && { a: later.box1bDubaiAmount, v: later.box1bDubaiVat, adj: later.box1bDubaiAdj });
  const rl = await ledgerOutput(R, curStart, curEnd);
  ok("5: the ledger agrees in both months (+50, then -50)", close(rl, -50) && close(rl, later?.box12TotalDueTax) && close(await ledgerOutput(R, prevStart, prevEnd), earlier?.box12TotalDueTax), { rl, b12: later?.box12TotalDueTax });

  // J4: a journal that credits revenue but debits VAT is not a sale; an invoice entry is never read as one
  const X = await newCompany("p9j4");
  await X.invoice(prevMid, 1000);
  const odd = await X.journal(prevMid, [
    { accountId: (await X.account("1020")).id, debit: 950, credit: 0 },
    { accountId: (await X.account("2020")).id, debit: 50, credit: 0 },
    { accountId: (await X.account("4010")).id, debit: 0, credit: 1000 },
  ], { memo: "Odd entry: revenue up, output VAT down" });
  ok("5: (setup) the odd entry posts", odd.status === 200, { s: odd.status, t: odd.text.slice(0, 200) });
  const gx = (await X.generate(prevStart, prevEnd)).json;
  ok("5: it stays an adjustment (-50) and adds nothing to box 1 beyond the invoice (1,000 / 50)", close(gx?.box1bDubaiAmount, 1000) && close(gx?.box1bDubaiVat, 50) && close(gx?.box1bDubaiAdj, -50) && close(gx?.box12TotalDueTax, 0) && close(await ledgerOutput(X, prevStart, prevEnd), 0), gx && { a: gx.box1bDubaiAmount, adj: gx.box1bDubaiAdj, b12: gx.box12TotalDueTax });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4: share a document with the client portal from the firm screen, and take it back
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function part4Sharing() {
  const D = await newCompany("p9doc");
  const O = await newCompany("p9docother");
  const upload = async (name) => {
    const r = await api("POST", `/api/companies/${D.cid}/documents`, { token: D.token, body: { name, fileName: `${name}.pdf`, mimeType: "application/pdf", fileData: PDF_B64 } });
    if (r.status !== 201) throw new Error("upload failed " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const shared = await upload("For the client");
  const secret = await upload("Internal only");
  ok("4: a document is private to the firm by default", shared.sharedWithPortal === false && secret.sharedWithPortal === false, [shared.sharedWithPortal, secret.sharedWithPortal]);

  // the firm upload dialog uses the Document Vault path: base64 file, magic-byte validation, private company-scoped key
  ok("4: the firm upload is stored under a private company-scoped key (never a client-supplied URL)", String(shared.fileUrl).startsWith(`${D.cid}/documents/`) && !/^https?:|^\/uploads\//.test(String(shared.fileUrl)), shared.fileUrl);
  const noFile = await api("POST", `/api/companies/${D.cid}/documents`, { token: D.token, body: { name: "No bytes", fileName: "x.pdf", mimeType: "application/pdf", fileUrl: "/uploads/x.pdf" } });
  ok("4: a request with no file data is refused (400): the old dialog sent exactly this", noFile.status === 400, { s: noFile.status, j: noFile.json });
  const fake = await api("POST", `/api/companies/${D.cid}/documents`, { token: D.token, body: { name: "Fake", fileName: "fake.pdf", mimeType: "application/pdf", fileData: Buffer.from("this is not a pdf at all").toString("base64") } });
  ok("4: a file whose bytes are not a PDF is refused (magic-byte check, 400)", fake.status === 400, { s: fake.status, j: fake.json });
  const firmDl = await fetch(`${BASE}/api/documents/${shared.id}/download`, { headers: { Authorization: "Bearer " + D.token } });
  ok("4: the firm downloads the file byte-identical", firmDl.status === 200 && Buffer.from(await firmDl.arrayBuffer()).equals(PDF), firmDl.status);

  const bad = await api("PATCH", `/api/documents/${shared.id}/portal-sharing`, { token: D.token, body: { sharedWithPortal: "yes" } });
  ok("4: a non-boolean body is refused (400)", bad.status === 400, { s: bad.status, j: bad.json });
  const cross = await api("PATCH", `/api/documents/${shared.id}/portal-sharing`, { token: O.token, body: { sharedWithPortal: true } });
  ok("4: another company's user cannot change the sharing (403)", cross.status === 403, { s: cross.status, j: cross.json });
  const missing = await api("PATCH", `/api/documents/00000000-0000-4000-8000-000000000000/portal-sharing`, { token: D.token, body: { sharedWithPortal: true } });
  ok("4: an unknown document is 404", missing.status === 404, missing.status);

  const on = await api("PATCH", `/api/documents/${shared.id}/portal-sharing`, { token: D.token, body: { sharedWithPortal: true } });
  ok("4: the firm shares a document with the portal (200, sharedWithPortal true)", on.status === 200 && on.json?.sharedWithPortal === true, { s: on.status, j: on.json });
  const firmList = await api("GET", `/api/companies/${D.cid}/documents`, { token: D.token });
  ok("4: the firm list shows the flag on that document only", (firmList.json ?? []).find((d) => d.id === shared.id)?.sharedWithPortal === true && (firmList.json ?? []).find((d) => d.id === secret.id)?.sharedWithPortal === false, firmList.json?.map((d) => [d.name, d.sharedWithPortal]));
  const audit = (await db.query("SELECT count(*)::int AS c FROM audit_logs WHERE resource_id = $1 AND action = 'document.share_portal'", [shared.id])).rows[0].c;
  ok("4: the change is audited", audit === 1, audit);

  const prevType = (await db.query("SELECT user_type FROM users WHERE id = $1", [D.userId])).rows[0].user_type;
  await db.query("UPDATE users SET user_type = 'client_portal' WHERE id = $1", [D.userId]);
  let portal = await api("GET", "/api/client-portal/documents", { token: D.token });
  ok("4: the portal lists only the shared document", portal.status === 200 && portal.json?.length === 1 && portal.json[0].id === shared.id, portal.json?.map((d) => d.name));
  const dl = await api("GET", `/api/client-portal/documents/${shared.id}/download`, { token: D.token });
  const portalBytes = await fetch(`${BASE}/api/client-portal/documents/${shared.id}/download`, { headers: { Authorization: "Bearer " + D.token } });
  ok("4: the portal user downloads the shared PDF byte-identical", portalBytes.status === 200 && Buffer.from(await portalBytes.arrayBuffer()).equals(PDF), portalBytes.status);
  const dlSecret = await api("GET", `/api/client-portal/documents/${secret.id}/download`, { token: D.token });
  ok("4: the portal can download the shared one and not the private one", dl.status === 200 && dlSecret.status === 404, { shared: dl.status, secret: dlSecret.status });
  const selfShare = await api("PATCH", `/api/documents/${secret.id}/portal-sharing`, { token: D.token, body: { sharedWithPortal: true } });
  ok("4: a portal user cannot share a document themselves (403)", selfShare.status === 403, { s: selfShare.status, j: selfShare.json });

  await db.query("UPDATE users SET user_type = $2 WHERE id = $1", [D.userId, prevType]);
  const off = await api("PATCH", `/api/documents/${shared.id}/portal-sharing`, { token: D.token, body: { sharedWithPortal: false } });
  ok("4: the firm takes it back (200, sharedWithPortal false)", off.status === 200 && off.json?.sharedWithPortal === false, { s: off.status, j: off.json });
  await db.query("UPDATE users SET user_type = 'client_portal' WHERE id = $1", [D.userId]);
  portal = await api("GET", "/api/client-portal/documents", { token: D.token });
  ok("4: the portal list is empty again", portal.status === 200 && portal.json?.length === 0, portal.json?.map((d) => d.name));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6: purchases recorded by manual journal; t4's van disposal; boxes 12-14 with the adjustment column
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function ledgerInput(C, start, end) {
  const r = await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.date::date >= $2::date AND je.date::date <= $3::date
        AND je.source NOT IN ('vat_filing', 'opening_balance', 'opening_balance_reversal') AND a.code = '1050'`, [C.cid, start, end]);
  return Math.round(n(r.rows[0].v) * 100) / 100;
}

async function part6Purchases() {
  // P1: the purchase on its own (t4's card receipt: office supplies 500 + VAT 25 paid by card)
  const P = await newCompany("p9pj1");
  const purchase = async (C, date, net, vat, expenseCode, memo) => C.journal(date, [
    { accountId: (await C.account(expenseCode)).id, debit: net, credit: 0 },
    { accountId: (await C.account("1050")).id, debit: vat, credit: 0 },
    { accountId: (await C.account("1020")).id, debit: 0, credit: net + vat },
  ], { memo });
  const posted = await purchase(P, prevMid, 500, 25, "5000", "Card purchase: office supplies, tax invoice 123");
  ok("6: (setup) Dr expense 500 / Dr 1050 25 / Cr bank 525 posts", posted.status === 200, { s: posted.status, t: posted.text.slice(0, 200) });
  const num = posted.json?.entryNumber;
  const g = (await P.generate(prevStart, prevEnd)).json;
  ok("6: box 9 amount 500 and box 9 VAT 25", close(g?.box9ExpensesAmount, 500) && close(g?.box9ExpensesVat, 25), g && { a: g.box9ExpensesAmount, v: g.box9ExpensesVat });
  ok("6: the VAT is NOT also an adjustment (box 9 adjustment 0): counted once", close(g?.box9ExpensesAdj, 0) && close(g?.box11TotalAdj, 0), g && { adj: g.box9ExpensesAdj });
  ok("6: box 11 = 500 / 25, box 13 = 25, box 14 = -25 (a refund)", close(g?.box11TotalAmount, 500) && close(g?.box11TotalVat, 25) && close(g?.box13RecoverableTax, 25) && close(g?.box14PayableTax, -25), g && { b13: g.box13RecoverableTax, b14: g.box14PayableTax });
  ok("6: ledger 1050 = the return's recoverable tax (25)", close(await ledgerInput(P, prevStart, prevEnd), 25) && close(g?.box13RecoverableTax, 25), await ledgerInput(P, prevStart, prevEnd));
  const lines = ((await api("GET", `/api/companies/${P.cid}/vat-returns`, { token: P.token })).json ?? []).find((r) => r.id === g?.id)?.vatAdjustments ?? [];
  ok("6: the stored return lists the purchase under box 9 (journal_purchase, 500 / 25, journal number)", lines.some((l) => l.kind === "journal_purchase" && l.box === "box9ExpensesAmount" && close(l.amount, 500) && close(l.vat, 25) && l.entryNumber === num && l.blocked === false), lines);
  const auto = await autopilot(P, prevStart, prevEnd);
  ok("6: the autopilot reports box 9 = 500 / 25 and box 13 = 25, reconciled to the ledger", close(auto.json?.vat201?.box9ExpensesAmount, 500) && close(auto.json?.vat201?.box9ExpensesVat, 25) && close(auto.json?.vat201?.box13RecoverableTax, 25) && close(auto.json?.reconciliation?.inputVatDelta, 0), auto.json && { v: auto.json.vat201?.box9ExpensesAmount, r: auto.json.reconciliation });
  const w = await workspace(P, prevStart, prevEnd);
  ok("6: the firm workpaper pull reports box 9 = 500 / 25 and box 13 = 25", close(w.totals.box9ExpensesAmount, 500) && close(w.totals.box9ExpensesVat, 25) && close(w.totals.box13RecoverableTax, 25) && close(w.totals.box9ExpensesAdj, 0), w.totals);
  const rep = await P.run("vat-audit-purchases", `from=${prevStart}&to=${prevEnd}`);
  const jr = (rep.json?.rows ?? []).find((r) => String(r.cells?.number) === String(num));
  ok("6: VAT Audit purchases lists the journal (type Journal, net 500, VAT 25, recoverable 25) and drills to the entry",
    rep.status === 200 && !!jr && /Journal/.test(jr.cells.type) && close(jr.cells.net, 500) && close(jr.cells.vat, 25) && close(jr.cells.recoverable, 25) && jr.drill?.target === "journal_entry", { s: rep.status, jr });
  ok("6: the audit totals equal box 9 (500 / 25)", close(rep.json?.totals?.net, g?.box9ExpensesAmount) && close(rep.json?.totals?.recoverable, g?.box9ExpensesVat), rep.json?.totals);
  const faf = await api("GET", `/api/companies/${P.cid}/reports/fta-audit-file?from=${prevStart}&to=${prevEnd}`, { token: P.token });
  ok("6: the FTA audit file lists the purchase as 'Journal JE-...' (500 / 25)", faf.status === 200 && new RegExp(`Journal ${num}`).test(faf.text) && /\b500(\.00)?\b/.test(faf.text), faf.text.split("\n").filter((l) => /Journal/.test(l)));
  const filed = await P.file(g?.id);
  ok("6: filing succeeds (no VAT_LEDGER_MISMATCH) and clears 1050", filed.status === 201 && close((await P.balances())["1050"] ?? 0, 0), { s: filed.status, t: filed.text.slice(0, 300) });

  // P2: t4's whole quarter: the van sold for 40,000 (+2,000 VAT) and the two card purchases (800 net / 40 VAT) that never reached box 9
  const T = await newCompany("p9pjt4");
  const van = await T.journal(prevMid, [
    { accountId: (await T.account("1020")).id, debit: 42000, credit: 0 },
    { accountId: (await T.account("1240")).id, debit: 29000, credit: 0 },
    { accountId: (await T.account("1290")).id, debit: 0, credit: 60000 },
    { accountId: (await T.account("4080")).id, debit: 0, credit: 9000 },
    { accountId: (await T.account("2020")).id, debit: 0, credit: 2000 },
  ], { memo: "Disposal FA-001 Nissan Urvan to Bin Hamoodah Auto" });
  ok("6: (setup) the van disposal journal posts (Dr bank 42,000, Dr accumulated depreciation 29,000, Cr cost 60,000, Cr gain 9,000, Cr 2020 2,000)", van.status === 200, { s: van.status, t: van.text.slice(0, 200) });
  await purchase(T, prevMid, 500, 25, "5000", "FAB card - Amazon.ae office supplies");
  await purchase(T, prevMid, 300, 15, "5000", "FAB card - Sharaf DG printer cartridges");
  const gt = (await T.generate(prevStart, prevEnd)).json;
  ok("6: t4: the van sale is 40,000 in box 1 with VAT 2,000 (not the 9,000 gain)", close(gt?.box1bDubaiAmount, 40000) && close(gt?.box1bDubaiVat, 2000) && close(gt?.box1bDubaiAdj, 0), gt && { a: gt.box1bDubaiAmount, v: gt.box1bDubaiVat, adj: gt.box1bDubaiAdj });
  ok("6: t4: the 800 of card purchases is in box 9 amount with VAT 40, no adjustment", close(gt?.box9ExpensesAmount, 800) && close(gt?.box9ExpensesVat, 40) && close(gt?.box9ExpensesAdj, 0), gt && { a: gt.box9ExpensesAmount, v: gt.box9ExpensesVat });
  ok("6: t4: box 12 = 2,000, box 13 = 40, box 14 = 1,960 payable, equal to the ledger (2020 = 2,000, 1050 = 40)",
    close(gt?.box12TotalDueTax, 2000) && close(gt?.box13RecoverableTax, 40) && close(gt?.box14PayableTax, 1960) && close(await ledgerOutput(T, prevStart, prevEnd), 2000) && close(await ledgerInput(T, prevStart, prevEnd), 40), gt && { b12: gt.box12TotalDueTax, b13: gt.box13RecoverableTax, b14: gt.box14PayableTax });
  const at = await autopilot(T, prevStart, prevEnd);
  const wt = await workspace(T, prevStart, prevEnd);
  ok("6: t4: autopilot and firm workpaper agree (box 1 40,000 / 2,000, box 9 800 / 40, box 14 1,960)",
    close(at.json?.vat201?.box1bDubaiAmount, 40000) && close(at.json?.vat201?.box9ExpensesAmount, 800) && close(at.json?.vat201?.box14PayableTax, 1960) &&
    close(wt.totals.box1bDubaiAmount, 40000) && close(wt.totals.box9ExpensesAmount, 800) && close(wt.totals.box14PayableTax, 1960), { auto: at.json?.vat201, firm: wt.totals });

  // P3: a blocked category: listed, counts nowhere
  const B = await newCompany("p9pjblk");
  const acct = await api("POST", `/api/companies/${B.cid}/accounts`, { token: B.token, body: { code: "5995", nameEn: "Client Entertainment", nameAr: "ضيافة العملاء", type: "expense", isActive: true } });
  ok("6: (setup) a 'Client Entertainment' expense account exists", acct.status === 200, { s: acct.status, t: acct.text.slice(0, 200) });
  const ent = await purchase(B, prevMid, 100, 5, "5995", "Client dinner");
  await purchase(B, prevMid, 200, 10, "5000", "Stationery");
  const gb = (await B.generate(prevStart, prevEnd)).json;
  ok("6: the entertainment journal reaches neither box 9 amount nor VAT nor an adjustment (only the stationery: 200 / 10)", ent.status === 200 && close(gb?.box9ExpensesAmount, 200) && close(gb?.box9ExpensesVat, 10) && close(gb?.box9ExpensesAdj, 0), gb && { a: gb.box9ExpensesAmount, v: gb.box9ExpensesVat, adj: gb.box9ExpensesAdj });
  const rb = await B.run("vat-audit-purchases", `from=${prevStart}&to=${prevEnd}`);
  const br = (rb.json?.rows ?? []).find((r) => String(r.cells?.number) === String(ent.json?.entryNumber));
  ok("6: the audit lists it as blocked with recoverable 0, outside the totals (200 / 10)", !!br && /Blocked/.test(br.cells.treatment) && close(br.cells.net, 100) && close(br.cells.vat, 5) && close(br.cells.recoverable, 0) && close(rb.json?.totals?.net, 200) && close(rb.json?.totals?.recoverable, 10), { br, t: rb.json?.totals });
  const wb = await workspace(B, prevStart, prevEnd);
  ok("6: the firm workpaper agrees (box 9 = 200 / 10, no row for the blocked journal)", close(wb.totals.box9ExpensesAmount, 200) && close(wb.totals.box9ExpensesVat, 10) && !wb.rows.some((r) => r.invoiceNumber === ent.json?.entryNumber), wb.totals);

  // P4: the reversal of a purchase is negative in the month it is posted
  const R = await newCompany("p9pjrev");
  const pj = await purchase(R, prevMid, 500, 25, "5000", "Purchase later cancelled");
  const rev = await api("POST", `/api/journal/${pj.json?.id}/reverse`, { token: R.token, body: { reason: "Supplier cancelled" } });
  ok("6: (setup) the purchase journal is reversed", [200, 201].includes(rev.status), { s: rev.status });
  const e1 = (await R.generate(prevStart, prevEnd)).json;
  const e2 = (await R.generate(curStart, curEnd)).json;
  ok("6: the reversal is -500 / -25 in box 9 of its own month and the first month still holds +500 / +25", close(e1?.box9ExpensesAmount, 500) && close(e2?.box9ExpensesAmount, -500) && close(e2?.box9ExpensesVat, -25) && close(e2?.box9ExpensesAdj, 0), { e1: e1?.box9ExpensesAmount, e2: e2?.box9ExpensesAmount });

  // boxes 12-14 of the STORED return include the adjustment column (t4 finding 1): the figure the screen shows is the stored one
  const A = await newCompany("p9adj");
  await A.invoice(prevMid, 1000);                                    // output 50
  await A.journal(prevMid, [{ accountId: (await A.account("2020")).id, debit: 0, credit: 2000 }, { accountId: (await A.account("1020")).id, debit: 2000, credit: 0 }], { memo: "Output VAT on an off-system supply" });
  await A.journal(prevMid, [{ accountId: (await A.account("1050")).id, debit: 40, credit: 0 }, { accountId: (await A.account("5000")).id, debit: 0, credit: 40 }], { memo: "Recover input VAT missed on card receipts" });
  const ga = (await A.generate(prevStart, prevEnd)).json;
  const listed = ((await api("GET", `/api/companies/${A.cid}/vat-returns`, { token: A.token })).json ?? []).find((r) => r.id === ga?.id);
  ok("6: boxes 12-14 include the adjustment column (12 = 50 + 2,000, 13 = 0 + 40, 14 = 2,010)", close(listed?.box8TotalAdj, 2000) && close(listed?.box11TotalAdj, 40) && close(listed?.box12TotalDueTax, 2050) && close(listed?.box13RecoverableTax, 40) && close(listed?.box14PayableTax, 2010), listed && { a8: listed.box8TotalAdj, b12: listed.box12TotalDueTax, b13: listed.box13RecoverableTax, b14: listed.box14PayableTax });
  ok("6: the listed (screen) return equals the generated one in boxes 12-14 and the ledger", close(listed?.box14PayableTax, ga?.box14PayableTax) && close(listed?.box12TotalDueTax, await ledgerOutput(A, prevStart, prevEnd)) && close(listed?.box13RecoverableTax, await ledgerInput(A, prevStart, prevEnd)), { l: listed?.box14PayableTax, g: ga?.box14PayableTax });
}

main().catch((e) => { console.error(e); process.exit(1); });
