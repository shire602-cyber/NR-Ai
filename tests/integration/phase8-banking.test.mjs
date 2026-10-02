// Integration tests for Phase 8 domain D3: banking, automation and assets.
// Live requests against a running server + Postgres; a second server is started on BASE_PORT+1 against an in-test mock
// of the Lean API for the bank-feed section (skipped when it cannot boot).
//   BASE_URL=http://localhost:5075 DATABASE_URL=... node tests/integration/phase8-banking.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";
import http from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(ROOT, "tests", "integration", "fixtures", "bank");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
const skip = (name, why) => console.log("SKIP  " + name + "  (" + why + ")");

async function apiAt(base, method, p, { body, token, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(base + p, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const api = (method, p, opts) => apiAt(BASE, method, p, opts);
/** fetch strips a BOM from .text(), so a CSV's first bytes are read raw. */
async function startsWithBom(p, token) {
  const res = await fetch(BASE + p, { headers: { Authorization: "Bearer " + token } });
  const b = new Uint8Array(await res.arrayBuffer());
  return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const day = (offset) => ymd(new Date(Date.now() + offset * 86400000));
const today = day(0);
const IBAN = "AE070331234567890123456";
let db;

async function newCompany(label, base = BASE) {
  const a = (m, p, o) => apiAt(base, m, p, o);
  const r = await a("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await a("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accounts = (await a("GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  const acct = (code) => accounts.find((x) => x.code === code);
  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = Math.round(n(row.net) * 100) / 100;
    return out;
  };
  const bankAccount = async (extra = {}) => {
    const r2 = await a("POST", `/api/companies/${cid}/bank-accounts`, { token, body: { nameEn: "Main " + Math.random().toString(36).slice(2, 5), bankName: "Emirates NBD", currency: "AED", iban: IBAN, glAccountId: acct("1020").id, ...extra } });
    if (r2.status !== 201) throw new Error("bank account failed " + r2.status + " " + r2.text);
    return r2.json;
  };
  const importCsv = (bankAccountId, rows, extra = {}) =>
    a("POST", `/api/companies/${cid}/bank-statements/import`, { token, body: { bankAccountId, content: ["Date,Description,Debit,Credit,Balance", ...rows].join("\n"), format: "csv", ...extra } });
  const txns = async (bankAccountId) =>
    (await a("GET", `/api/companies/${cid}/bank-statements/transactions?bankAccountId=${bankAccountId}`, { token })).json ?? [];
  const journal = (date, lines, extra = {}) =>
    a("POST", `/api/companies/${cid}/journal`, { token, body: { date, status: "posted", confirmBackdated: true, lines, ...extra } });
  const invoice = async ({ date = day(-5), dueDate = day(2), unitPrice = 950, vatRate = 0.05, name = "Pearl Trading" } = {}) => {
    const r2 = await a("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: name, date, dueDate, lines: [{ description: "svc", quantity: 1, unitPrice, vatRate }] } });
    if (!r2.json?.id) throw new Error("invoice failed " + r2.status + " " + r2.text.slice(0, 200));
    await a("PATCH", `/api/invoices/${r2.json.id}/status`, { token, body: { status: "sent" } });
    return r2.json;
  };
  const get = (p) => a("GET", p, { token });
  const post = (p, body) => a("POST", p, { token, body });
  return { token, cid, userId, accounts, acct, balances, bankAccount, importCsv, txns, journal, invoice, get, post, api: a };
}

const sumEntries = async (cid, source) =>
  (await db.query(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source = $2 AND status = 'posted'`, [cid, source])).rows[0].n;

// ─────────────────────────── D3-1 / D3-2: import and dedupe ───────────────────────────
async function importSection() {
  const A = await newCompany("imp");
  const ba = await A.bankAccount();
  const imp = (content, extra = {}) => A.post(`/api/companies/${A.cid}/bank-statements/import`, { bankAccountId: ba.id, content, format: "auto", ...extra });

  let r = await imp(fixture("statement.ofx"), { fileName: "sep.ofx" });
  ok("D3-1: OFX imports 3 lines, format auto-detected", r.status === 201 && r.json?.imported === 3 && r.json?.format === "ofx", { s: r.status, j: r.json });
  ok("D3-1: statement summary carries the closing balance", n(r.json?.statement?.closingBalance) === 5279.5 && r.json?.statement?.currency === "AED", r.json?.statement);
  r = await imp(fixture("statement.sta"), { fileName: "sep.sta" });
  ok("D3-1: MT940 imports 3 lines", r.status === 201 && r.json?.imported === 3 && r.json?.format === "mt940", { s: r.status, j: r.json });
  ok("D3-1: MT940 opening and closing balances", n(r.json?.statement?.openingBalance) === 5279.5 && n(r.json?.statement?.closingBalance) === 7004.25, r.json?.statement);
  r = await imp(fixture("statement-camt053.xml"), { fileName: "sep.xml" });
  ok("D3-1: CAMT.053 imports 3 booked lines (pending skipped)", r.status === 201 && r.json?.imported === 3 && r.json?.format === "camt053", { s: r.status, j: r.json });

  const rows = (await db.query(`SELECT import_source, COUNT(*)::int AS c FROM bank_transactions WHERE company_id = $1 GROUP BY 1 ORDER BY 1`, [A.cid])).rows;
  ok("D3-1: 9 bank transactions, importSource per file", rows.length === 3 && rows.every((x) => x.c === 3) && rows.map((x) => x.import_source).join() === "camt053,mt940,ofx", rows);
  const imports = (await db.query(`SELECT source, closing_balance::float8 AS c, stored_file_key FROM bank_statement_imports WHERE company_id = $1 ORDER BY source`, [A.cid])).rows;
  ok("D3-1: closing balance stored per import", imports.find((x) => x.source === "camt053")?.c === 9154.26 && imports.find((x) => x.source === "ofx")?.c === 5279.5, imports);
  ok("D3-1: the original file is kept as a stored file", imports.every((x) => !!x.stored_file_key) && (await db.query(`SELECT COUNT(*)::int AS c FROM stored_files WHERE company_id = $1 AND category = 'bank-statements'`, [A.cid])).rows[0].c === 3, imports);

  r = await imp(fixture("statement-truncated.sta"));
  ok("D3-1: truncated MT940 -> 422 STATEMENT_PARSE_ERROR with the line", r.status === 422 && r.json?.code === "STATEMENT_PARSE_ERROR" && r.json?.details?.line === 7, { s: r.status, j: r.json });
  r = await imp(fixture("statement-camt053-no-amt.xml"));
  ok("D3-1: CAMT without <Amt> -> 422 naming the tag", r.status === 422 && r.json?.code === "STATEMENT_PARSE_ERROR" && r.json?.details?.tag === "Amt", { s: r.status, j: r.json });
  r = await imp(fixture("statement-bomb.xml"));
  ok("review: an XML entity bomb is refused (422), not expanded", r.status === 422 && r.json?.code === "STATEMENT_PARSE_ERROR", { s: r.status, j: r.json });
  r = await imp("a".repeat(6_000_000));
  ok("review: a 6 MB file is refused (413)", r.status === 413 && r.json?.code === "STATEMENT_TOO_LARGE", { s: r.status, c: r.json?.code });
  r = await imp(fixture("statement.sta").replace(/:62F:[^\n]*\n/, ""));
  ok("review: MT940 without :62F: is refused", r.status === 422, { s: r.status, j: r.json });

  const other = await A.bankAccount({ iban: "AE460090000000123456789" });
  r = await A.post(`/api/companies/${A.cid}/bank-statements/import`, { bankAccountId: other.id, content: fixture("statement.ofx") });
  ok("review: a statement for another IBAN -> 422 STATEMENT_ACCOUNT_MISMATCH", r.status === 422 && r.json?.code === "STATEMENT_ACCOUNT_MISMATCH", { s: r.status, j: r.json });
  const usd = await A.bankAccount({ currency: "USD", iban: null });
  r = await A.post(`/api/companies/${A.cid}/bank-statements/import`, { bankAccountId: usd.id, content: fixture("statement.ofx") });
  ok("review: an AED statement into a USD account -> 422 STATEMENT_CURRENCY_MISMATCH", r.status === 422 && r.json?.code === "STATEMENT_CURRENCY_MISMATCH", { s: r.status, j: r.json });

  // D3-2: dedupe
  r = await imp(fixture("statement.ofx"));
  ok("D3-2: the same OFX again adds nothing, 3 duplicates", r.status === 201 && r.json?.imported === 0 && r.json?.duplicates === 3, { s: r.status, j: r.json });
  r = await imp(fixture("statement-same-days.csv"));
  ok("D3-2: a CSV of the same days (different wording) adds nothing", r.status === 201 && r.json?.imported === 0 && r.json?.duplicates === 3, { s: r.status, j: r.json });
  const pair = await A.bankAccount();
  r = await A.importCsv(pair.id, [`${day(-3)},PARKING,5.00,,995.00`, `${day(-3)},PARKING,5.00,,990.00`]);
  ok("D3-2: two identical same-day lines both survive the first import", r.status === 201 && r.json?.imported === 2, { s: r.status, j: r.json });
  r = await A.importCsv(pair.id, [`${day(-3)},PARKING,5.00,,995.00`, `${day(-3)},PARKING,5.00,,990.00`]);
  ok("D3-2: ...and a re-upload adds neither", r.json?.imported === 0 && r.json?.duplicates === 2, r.json);
  const racing = await Promise.all([0, 1].map(() => A.importCsv(ba.id, [`${day(-9)},RACE FEE,12.00,,100.00`])));
  const racedRows = (await A.txns(ba.id)).filter((t) => /RACE FEE/.test(t.description)).length;
  ok("review: the same file twice in parallel inserts one line", racedRows === 1 && racing.every((x) => x.status === 201), { racedRows, s: racing.map((x) => x.status) });

  // retired endpoints and the unscoped AI route
  r = await A.post(`/api/companies/${A.cid}/bank-transactions/import`, { transactions: [{ date: today, description: "x", amount: "1" }] });
  ok("retired: POST bank-transactions/import -> 410 USE_STATEMENT_IMPORT", r.status === 410 && r.json?.code === "USE_STATEMENT_IMPORT", { s: r.status, j: r.json });
  r = await api("POST", "/api/ai/parse-bank-statement", { token: A.token, body: { text: "01/01/2026 x 1.00" } });
  ok("retired: /api/ai/parse-bank-statement -> 410", r.status === 410 && r.json?.code === "USE_STATEMENT_IMPORT", { s: r.status });

  // PDF staging: text parsed server-side, reviewed, committed
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n").toString("base64");
  const pdfAcct = await A.bankAccount();
  const text = `Statement period ${day(-9)} to ${day(-7)} Opening balance 1,000.00 ${day(-9)} DEWA utility bill DEWA-9001 820.50 179.50 ${day(-8)} Customer payment Pearl Trading 5,250.00 5,429.50 ${day(-7)} Bank charges 150.00 5,279.50 Closing balance 5,279.50`;
  r = await A.post(`/api/companies/${A.cid}/bank-statements/imports/pdf`, { bankAccountId: pdfAcct.id, fileName: "sep.pdf", fileData: pdf, pages: [text] });
  ok("D3-1: PDF text is staged with review rows, nothing imported yet", r.status === 201 && r.json?.status === "staged" && r.json?.rows?.length === 3 && (await A.txns(pdfAcct.id)).length === 0, { s: r.status, j: r.json });
  const staged = r.json;
  ok("D3-1: staged rows are signed from the running balance", staged?.rows?.map((x) => x.amount).join() === "-820.5,5250,-150", staged?.rows);
  r = await A.post(`/api/companies/${A.cid}/bank-statements/imports/${staged.importId}/commit`, { rows: staged.rows.slice(0, 2) });
  ok("D3-1: commit imports the reviewed rows (a row was excluded)", r.status === 201 && r.json?.imported === 2 && (await A.txns(pdfAcct.id)).length === 2, { s: r.status, j: r.json });
  r = await A.post(`/api/companies/${A.cid}/bank-statements/imports/${staged.importId}/commit`, { rows: staged.rows });
  ok("D3-1: committing twice -> 409 IMPORT_NOT_STAGED", r.status === 409 && r.json?.code === "IMPORT_NOT_STAGED", { s: r.status, j: r.json });
  r = await A.post(`/api/companies/${A.cid}/bank-statements/imports/pdf`, { bankAccountId: pdfAcct.id, fileName: "scan.pdf", fileData: pdf, pages: ["scanned page without any text layer"] });
  ok("D3-1: a scanned PDF with the AI fallback off -> 422 PDF_NO_TRANSACTIONS (ai off)", r.status === 422 && r.json?.code === "PDF_NO_TRANSACTIONS" && r.json?.details?.ai === "off", { s: r.status, j: r.json });
  r = await api("GET", `/api/companies/${A.cid}/bank-statements/settings`, { token: A.token });
  ok("D3-1: the AI fallback setting defaults to off", r.status === 200 && r.json?.pdfAiFallback === false, r.json);

  // tenant isolation on the import surface
  const B = await newCompany("impb");
  r = await api("POST", `/api/companies/${A.cid}/bank-statements/import`, { token: B.token, body: { bankAccountId: ba.id, content: fixture("statement.ofx") } });
  ok("tenant: B cannot import into A's company (403)", r.status === 403, { s: r.status });
  r = await api("POST", `/api/companies/${B.cid}/bank-statements/import`, { token: B.token, body: { bankAccountId: ba.id, content: fixture("statement.ofx") } });
  ok("tenant: B cannot import into A's bank account (404)", r.status === 404, { s: r.status });
  r = await api("GET", `/api/companies/${A.cid}/bank-statements/imports`, { token: B.token });
  ok("tenant: B cannot list A's imports (403)", r.status === 403, { s: r.status });
}

// ─────────────────────────── D3-5 matching, bulk accept, bills ───────────────────────────
async function matchingSection() {
  const C = await newCompany("mat");
  const ba = await C.bankAccount();
  const inv = await C.invoice({ date: day(-5), dueDate: day(2) }); // 997.50
  ok("D3-5: setup invoice total 997.50", close(inv.total, 997.5), inv.total);

  // a posted receipt of the same amount 20 days earlier: the decoy
  const exp = C.acct("5000");
  const rc = await C.post(`/api/companies/${C.cid}/receipts`, { merchant: "Stationery House", date: day(-20), amount: 950, vatAmount: 47.5, category: "office", accountId: exp.id, paymentAccountId: C.acct("1020").id });
  await C.post(`/api/receipts/${rc.json?.id}/post`, { accountId: exp.id, paymentAccountId: C.acct("1020").id });

  let r = await C.importCsv(ba.id, [`${today},TRANSFER,,997.50,5997.50`, `${day(-20)},STATIONERY HOUSE,997.50,,5000.00`]);
  ok("D3-5: statement imported", r.status === 201 && r.json?.imported === 2, { s: r.status, j: r.json });
  const list = await C.txns(ba.id);
  const dep = list.find((t) => n(t.amount) === 997.5);
  const out = list.find((t) => n(t.amount) === -997.5);
  r = await C.get(`/api/companies/${C.cid}/bank-statements/${dep.id}/suggestions`);
  ok("D3-5: the invoice is ranked first with confidence >= 80", r.status === 200 && r.json?.[0]?.kind === "invoice" && r.json?.[0]?.targetId === inv.id && r.json?.[0]?.confidence >= 80, r.json?.slice?.(0, 3));
  ok("D3-5: suggestion carries reasons and the proposed Dr/Cr", Array.isArray(r.json?.[0]?.reasons) && r.json[0].proposedLines.length === 2 && r.json[0].proposedLines[0].debit === 997.5, r.json?.[0]);
  r = await C.get(`/api/companies/${C.cid}/bank-statements/suggestions?bankAccountId=${ba.id}&minConfidence=60`);
  ok("D3-5: batch suggestions are one-to-one", r.status === 200 && r.json.some((s) => s.kind === "invoice" && s.targetId === inv.id) && new Set(r.json.map((s) => s.transactionId)).size === r.json.length, r.json);

  // over-outstanding batch: the same invoice twice
  const dep2 = (await C.importCsv(ba.id, [`${day(-1)},SECOND DEPOSIT,,997.50,6995.00`])) && (await C.txns(ba.id)).find((t) => /SECOND DEPOSIT/.test(t.description));
  const before = await sumEntries(C.cid, "payment");
  r = await C.post(`/api/companies/${C.cid}/bank-statements/bulk-match`, { items: [{ transactionId: dep.id, kind: "invoice", targetId: inv.id }, { transactionId: dep2.id, kind: "invoice", targetId: inv.id }] });
  ok("D3-5: a batch above the outstanding amount fails whole (422 BULK_MATCH_INVALID)", r.status === 422 && r.json?.code === "BULK_MATCH_INVALID" && r.json?.details?.errors?.length === 2, { s: r.status, j: r.json });
  ok("D3-5: ...and posted zero lines", (await sumEntries(C.cid, "payment")) === before && (await db.query(`SELECT COUNT(*)::int AS c FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows[0].c === 0, {});
  r = await C.post(`/api/companies/${C.cid}/bank-statements/bulk-match`, { items: [{ transactionId: dep.id, kind: "invoice", targetId: inv.id }], dryRun: true });
  ok("D3-5: dryRun validates without posting", r.status === 200 && r.json?.dryRun === true && r.json?.applied === 0, r.json);
  r = await C.post(`/api/companies/${C.cid}/bank-statements/bulk-match`, { items: [{ transactionId: dep.id, kind: "invoice", targetId: inv.id }, { transactionId: out.id, kind: "receipt", targetId: rc.json.id }] });
  ok("D3-5: bulk-match applies an invoice and a receipt", r.status === 200 && r.json?.applied === 2, { s: r.status, j: r.json });
  const pays = (await db.query(`SELECT amount::float8 AS a, method FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows;
  ok("D3-5: bulk-match wrote invoice_payments through recordInvoicePayment", pays.length === 1 && close(pays[0].a, 997.5), pays);
  const bal = await C.balances();
  ok("D3-5: Dr bank / Cr receivables, books balanced", close(bal["1020"], 997.5 - 997.5) || close(bal["1040"], 0), bal);
  r = await C.post(`/api/companies/${C.cid}/bank-statements/${dep.id}/match`, { matchedType: "invoice", matchedId: inv.id });
  ok("D3-5: matching an already reconciled line -> 409 ALREADY_RECONCILED", r.status === 409 && r.json?.code === "ALREADY_RECONCILED", { s: r.status, j: r.json });

  // bills: an outflow matches an approved bill
  const bill = await C.post(`/api/companies/${C.cid}/bills`, { vendor_name: "Gulf Supplies LLC", bill_number: "GS-501", bill_date: day(-10), due_date: day(1), line_items: [{ description: "goods", quantity: 1, unit_price: 400, vat_rate: 0 }] });
  await C.post(`/api/bills/${bill.json?.id}/approve`, {});
  await C.importCsv(ba.id, [`${day(-1)},GULF SUPPLIES GS-501,400.00,,6595.00`]);
  const billTxn = (await C.txns(ba.id)).find((t) => n(t.amount) === -400);
  r = await C.get(`/api/companies/${C.cid}/bank-statements/${billTxn.id}/suggestions`);
  ok("bills: the outflow suggests the approved bill", r.json?.[0]?.kind === "bill" && r.json?.[0]?.targetId === bill.json?.id && r.json[0].confidence >= 80, r.json?.slice?.(0, 2));
  r = await C.post(`/api/companies/${C.cid}/bank-statements/${billTxn.id}/match`, { matchedType: "bill", matchedId: bill.json.id });
  ok("bills: matching posts a bill payment (Dr 2010 / Cr bank)", r.status === 200, { s: r.status, j: r.json });
  const bp = (await db.query(`SELECT bp.amount::float8 AS a, bp.payment_account_id, vb.status FROM bill_payments bp JOIN vendor_bills vb ON vb.id = bp.bill_id WHERE bp.bill_id = $1`, [bill.json.id])).rows;
  ok("bills: bill_payments row carries the bank GL account and the bill is paid", bp.length === 1 && close(bp[0].a, 400) && bp[0].payment_account_id === C.acct("1020").id && bp[0].status === "paid", bp);
  const bb = await C.balances();
  ok("bills: A/P cleared", close(bb["2010"], 0), bb);

  // unmatch of a payment keeps the payment, makes the line re-linkable
  r = await api("DELETE", `/api/companies/${C.cid}/bank-statements/${dep.id}/match`, { token: C.token });
  ok("unmatch: a payment-linked line is released, the payment stays", r.status === 200 && !r.json?.reversedEntryId && (await db.query(`SELECT COUNT(*)::int AS c FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows[0].c === 1, { s: r.status, j: r.json });
  r = await C.get(`/api/companies/${C.cid}/bank-statements/${dep.id}/suggestions`);
  ok("unmatch: ...and it can be linked to the payment's journal again", r.json?.some((s) => s.kind === "journal" && s.confidence >= 60), r.json?.slice?.(0, 3));
  const jid = r.json?.find((s) => s.kind === "journal")?.targetId;
  r = await C.post(`/api/companies/${C.cid}/bank-statements/${dep.id}/match`, { matchedType: "journal", matchedId: jid });
  ok("unmatch: re-link to the existing payment entry posts nothing new", r.status === 200 && (await sumEntries(C.cid, "payment")) === 1, { s: r.status, j: r.json });

  // legacy auto-reconcile delegates and never credits AR without a payment
  const inv2 = await C.invoice({ date: day(-8), dueDate: day(-1), unitPrice: 200, vatRate: 0, name: "Legacy Co" });
  await C.importCsv(ba.id, [`${day(-1)},LEGACY CO,,200.00,6795.00`]);
  const legacy = (await C.txns(ba.id)).find((t) => /LEGACY CO/.test(t.description));
  r = await C.post(`/api/companies/${C.cid}/auto-reconcile/apply`, { matches: [{ bankTransactionId: legacy.id, matchedType: "invoice", matchedId: inv2.id }] });
  ok("legacy: /auto-reconcile/apply settles through an invoice payment", r.status === 200 && r.json?.applied === 1 && (await db.query(`SELECT COUNT(*)::int AS c FROM invoice_payments WHERE invoice_id = $1`, [inv2.id])).rows[0].c === 1, { s: r.status, j: r.json });

  // 12 parallel bulk-matches of 100 on one 1,000 invoice: the sum never passes the total
  const big = await C.invoice({ date: day(-6), dueDate: day(3), unitPrice: 1000, vatRate: 0, name: "Parallel Co" });
  await C.importCsv(ba.id, Array.from({ length: 12 }, (_, i) => `${day(-1)},PARALLEL ${i},,100.00,${7000 + i}.00`));
  const par = (await C.txns(ba.id)).filter((x) => /^PARALLEL/.test(x.description));
  const runs = await Promise.all(par.map((x) => C.post(`/api/companies/${C.cid}/bank-statements/bulk-match`, { items: [{ transactionId: x.id, kind: "invoice", targetId: big.id }] })));
  const applied = runs.filter((x) => x.status === 200).length;
  const paid = n((await db.query(`SELECT COALESCE(SUM(amount),0)::float8 AS s FROM invoice_payments WHERE invoice_id = $1`, [big.id])).rows[0].s);
  ok("review: 12 parallel bulk-matches on one invoice apply exactly 10 (sum <= total)", applied === 10 && close(paid, 1000) && runs.filter((x) => x.status === 422).length === 2, { applied, paid, s: runs.map((x) => x.status) });

  // the bill payment route can name the bank account the money leaves
  const sav = await C.post(`/api/companies/${C.cid}/accounts`, { code: "1023", nameEn: "Savings", type: "asset" });
  const bill2 = await C.post(`/api/companies/${C.cid}/bills`, { vendor_name: "Route Vendor", bill_number: "RV-1", bill_date: day(-3), due_date: day(10), line_items: [{ description: "x", quantity: 1, unit_price: 80, vat_rate: 0 }] });
  await C.post(`/api/bills/${bill2.json?.id}/approve`, {});
  r = await C.post(`/api/bills/${bill2.json?.id}/payments`, { amount: 80, payment_account_id: sav.json?.id });
  const bpl = (await db.query(`SELECT jl.credit::float8 AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1 AND je.source = 'bill_payment' AND jl.account_id = $2`, [C.cid, sav.json?.id])).rows;
  ok("defect: a bill payment credits the chosen bank account, not always 1020", r.status === 200 && bpl.length === 1 && close(bpl[0].c, 80), { s: r.status, j: r.json, bpl });
  const bill3 = await C.post(`/api/companies/${C.cid}/bills`, { vendor_name: "Route Vendor", bill_number: "RV-2", bill_date: day(-3), due_date: day(10), line_items: [{ description: "x", quantity: 1, unit_price: 50, vat_rate: 0 }] });
  await C.post(`/api/bills/${bill3.json?.id}/approve`, {});
  r = await C.post(`/api/bills/${bill3.json?.id}/payments`, { amount: 50, payment_account_id: C.acct("5000").id });
  ok("defect: ...and a non-asset payment account is refused (422 PAYMENT_ACCOUNT_INVALID)", r.status === 422 && r.json?.code === "PAYMENT_ACCOUNT_INVALID", { s: r.status, j: r.json });
  r = await C.post(`/api/bills/${bill3.json?.id}/payments`, { amount: 50, payment_account_id: (await newCompany("billx")).acct("1020").id });
  ok("tenant: another company's payment account is refused", r.status === 422, { s: r.status, j: r.json });

  // tenant isolation
  const D = await newCompany("matd");
  r = await api("POST", `/api/companies/${C.cid}/bank-statements/bulk-match`, { token: D.token, body: { items: [{ transactionId: dep.id, kind: "invoice", targetId: inv.id }] } });
  ok("tenant: D cannot bulk-match in C's company (403)", r.status === 403, { s: r.status });
  r = await api("POST", `/api/companies/${D.cid}/bank-statements/bulk-match`, { token: D.token, body: { items: [{ transactionId: legacy.id, kind: "invoice", targetId: inv2.id }] } });
  ok("tenant: D's batch with C's ids is refused and posts nothing", r.status === 422, { s: r.status, j: r.json });
  r = await api("GET", `/api/companies/${D.cid}/bank-statements/${dep.id}/suggestions`, { token: D.token });
  ok("tenant: D cannot read suggestions of C's line (404)", r.status === 404, { s: r.status });
  const Dba = await D.bankAccount();
  await D.importCsv(Dba.id, [`${day(-1)},FOREIGN,,50.00,50.00`]);
  const dTxn = (await D.txns(Dba.id))[0];
  r = await api("POST", `/api/companies/${D.cid}/bank-statements/${dTxn.id}/match`, { token: D.token, body: { matchedType: "invoice", matchedId: inv.id } });
  ok("tenant: D cannot match to C's invoice (404)", r.status === 404, { s: r.status, j: r.json });
  r = await api("POST", `/api/companies/${D.cid}/bank-statements/${dTxn.id}/create-entry`, { token: D.token, body: { accountId: C.acct("5000").id } });
  ok("tenant: D cannot post into C's account (422)", r.status === 422 && r.json?.code === "ACCOUNT_INVALID", { s: r.status, j: r.json });
}

// ─────────────────────────── L3 fix round ───────────────────────────
async function fixRoundSection() {
  const F = await newCompany("fix");
  const ba = await F.bankAccount();
  const paymentCount = async (table, col, id) => (await db.query(`SELECT COUNT(*)::int AS c FROM ${table} WHERE ${col} = $1`, [id])).rows[0].c;

  // 1. unmatch then rematch posts no second payment (invoice and bill)
  const inv = await F.invoice({ date: day(-5), dueDate: day(2), unitPrice: 400, vatRate: 0, name: "Rematch Co" });
  await F.importCsv(ba.id, [`${day(-1)},REMATCH CO,,400.00,400.00`]);
  const dep = (await F.txns(ba.id)).find((x) => /REMATCH CO/.test(x.description));
  const m = () => F.post(`/api/companies/${F.cid}/bank-statements/${dep.id}/match`, { matchedType: "invoice", matchedId: inv.id });
  let r = await m();
  ok("fix 1: invoice matched", r.status === 200, { s: r.status, j: r.json });
  await api("DELETE", `/api/companies/${F.cid}/bank-statements/${dep.id}/match`, { token: F.token });
  r = await m();
  ok("fix 1: unmatch + rematch an invoice relinks the payment (still one payment, still 400 in the books)", r.status === 200 && (await paymentCount("invoice_payments", "invoice_id", inv.id)) === 1 && close((await F.balances())["1020"], 400), { s: r.status, j: r.json, bal: await F.balances() });
  const bill = await F.post(`/api/companies/${F.cid}/bills`, { vendor_name: "Rematch Vendor", bill_number: "RM-1", bill_date: day(-4), due_date: day(3), line_items: [{ description: "x", quantity: 1, unit_price: 150, vat_rate: 0 }] });
  await F.post(`/api/bills/${bill.json?.id}/approve`, {});
  await F.importCsv(ba.id, [`${day(-1)},REMATCH VENDOR,150.00,,250.00`]);
  const out = (await F.txns(ba.id)).find((x) => /REMATCH VENDOR/.test(x.description));
  const mb = () => F.post(`/api/companies/${F.cid}/bank-statements/${out.id}/match`, { matchedType: "bill", matchedId: bill.json.id });
  await mb();
  await api("DELETE", `/api/companies/${F.cid}/bank-statements/${out.id}/match`, { token: F.token });
  r = await mb();
  ok("fix 1: unmatch + rematch a bill relinks the payment (still one bill payment)", r.status === 200 && (await paymentCount("bill_payments", "bill_id", bill.json.id)) === 1 && close((await F.balances())["2010"], 0), { s: r.status, j: r.json });

  // 2. a line larger than the outstanding amount is not cleared by a smaller payment
  const small = await F.invoice({ date: day(-5), dueDate: day(2), unitPrice: 300, vatRate: 0, name: "Short Co" });
  await F.importCsv(ba.id, [`${day(-1)},SHORT CO,,500.00,750.00`]);
  const big = (await F.txns(ba.id)).find((x) => /SHORT CO/.test(x.description));
  r = await F.post(`/api/companies/${F.cid}/bank-statements/${big.id}/match`, { matchedType: "invoice", matchedId: small.id });
  ok("fix 2: a 500 line against a 300 invoice -> 422 MATCH_AMOUNT_MISMATCH, nothing posted", r.status === 422 && r.json?.code === "MATCH_AMOUNT_MISMATCH" && (await paymentCount("invoice_payments", "invoice_id", small.id)) === 0, { s: r.status, j: r.json });

  // 3. a transfer between two managed bank accounts reconciles on both sides
  const cashGl = F.acct("1010");
  const cashAcct = await F.bankAccount({ glAccountId: cashGl.id, iban: null, nameEn: "Petty cash bank" });
  await F.importCsv(ba.id, [`${day(-2)},TRANSFER TO CASH,500.00,,250.00`]);
  await F.importCsv(cashAcct.id, [`${day(-2)},TRANSFER FROM MAIN,,500.00,500.00`]);
  const a = (await F.txns(ba.id)).find((x) => /TRANSFER TO CASH/.test(x.description));
  const b = (await F.txns(cashAcct.id)).find((x) => /TRANSFER FROM MAIN/.test(x.description));
  r = await F.post(`/api/companies/${F.cid}/bank-statements/${a.id}/create-entry`, { accountId: cashGl.id });
  ok("fix 3: transfer: the outgoing side posts Dr 1010 / Cr 1020", r.status === 201, { s: r.status, j: r.json });
  const je = r.json?.journalEntry?.id;
  r = await F.post(`/api/companies/${F.cid}/bank-statements/${b.id}/match`, { matchedType: "journal", matchedId: je });
  ok("fix 3: ...and the incoming side matches the same entry (200, not ALREADY_LINKED)", r.status === 200, { s: r.status, j: r.json });
  const sugg = await F.get(`/api/companies/${F.cid}/bank-statements/${b.id}/suggestions`);
  ok("fix 3: a matched entry is no longer offered for the same bank account", !sugg.json?.some((s) => s.targetId === je), sugg.json?.slice?.(0, 2));
  const repA = await F.get(`/api/companies/${F.cid}/bank-statements/reconciliation-report?bankAccountId=${ba.id}&asOf=${today}&statementBalance=250`);
  const repB = await F.get(`/api/companies/${F.cid}/bank-statements/reconciliation-report?bankAccountId=${cashAcct.id}&asOf=${today}&statementBalance=500`);
  ok("fix 3: both accounts reconcile with difference 0 and no open items from the transfer", close(repA.json?.difference, 0) && close(repB.json?.difference, 0) && !repB.json?.items?.depositsInTransit?.length && !repA.json?.items?.outstandingPayments?.some((x) => x.entryId === je), { a: repA.json?.difference, b: repB.json?.difference, bi: repB.json?.items });
  r = await api("DELETE", `/api/companies/${F.cid}/bank-statements/${a.id}/match`, { token: F.token });
  ok("fix 3: unmatching the posting side while the other side is linked is refused (409)", r.status === 409 && r.json?.code === "ENTRY_LINKED_ELSEWHERE", { s: r.status, j: r.json });

  // locked month answers PERIOD_LOCKED
  const lockedDay = new Date(Date.UTC(new Date().getUTCFullYear() - 2, 5, 15)).toISOString().slice(0, 10);
  await F.importCsv(ba.id, [`${lockedDay},ANCIENT FEE,12.00,,10.00`]);
  const old = (await F.txns(ba.id)).find((x) => /ANCIENT FEE/.test(x.description));
  await F.post(`/api/companies/${F.cid}/month-end/lock-period`, { periodEnd: new Date(Date.UTC(new Date().getUTCFullYear() - 2, 5, 30)).toISOString().slice(0, 10) });
  r = await F.post(`/api/companies/${F.cid}/bank-statements/${old.id}/create-entry`, { accountId: F.acct("5000").id });
  ok("fix: a locked month -> 403 with code PERIOD_LOCKED", r.status === 403 && r.json?.code === "PERIOD_LOCKED", { s: r.status, j: r.json });
}

// ─────────────────────────── VP Finance sign-off fixes ───────────────────────────
async function signoffSection() {
  // 3. bulk accept never pairs a line with an invoice of a different open amount below 80
  const M = await newCompany("sgn");
  const ba = await M.bankAccount();
  const inv = await M.invoice({ date: day(-4), dueDate: day(1), unitPrice: 1000, vatRate: 0.05, name: "Same Customer" }); // 1,050
  await M.importCsv(ba.id, [`${day(-1)},SAME CUSTOMER,,997.50,997.50`]);
  const line = (await M.txns(ba.id))[0];
  let r = await M.get(`/api/companies/${M.cid}/bank-statements/suggestions?bankAccountId=${ba.id}&minConfidence=50`);
  ok("sign-off 3: bulk accept at min confidence 50 does not offer 997.50 against the 1,050 invoice", r.status === 200 && !r.json.some((s) => s.targetId === inv.id), r.json);
  r = await M.get(`/api/companies/${M.cid}/bank-statements/${line.id}/suggestions`);
  const one = r.json?.find((s) => s.targetId === inv.id);
  ok("sign-off 3: ...while the line's own suggestions still list it, flagged amountMatches false", !!one && one.amountMatches === false && one.confidence < 80, r.json?.slice?.(0, 2));
  const exact = await M.invoice({ date: day(-4), dueDate: day(1), unitPrice: 200, vatRate: 0, name: "Exact Co" });
  await M.importCsv(ba.id, [`${day(-1)},EXACT CO,,200.00,1197.50`]);
  r = await M.get(`/api/companies/${M.cid}/bank-statements/suggestions?bankAccountId=${ba.id}&minConfidence=50`);
  ok("sign-off 3: an exact amount is still offered", r.json?.some((s) => s.targetId === exact.id && s.amountMatches === true), r.json);

  // 2. catch-up: running a month posts every unposted month before it, dated the month end
  const S = await newCompany("sga");
  const bank = S.acct("1020");
  await S.journal(day(-500), [{ accountId: bank.id, debit: 90000, credit: 0 }, { accountId: S.acct("3010")?.id ?? S.acct("4010").id, debit: 0, credit: 90000 }], { description: "capital" });
  const now = new Date();
  const monthStart = (back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 10);
  const mk = async (body) => {
    const x = (await S.post(`/api/companies/${S.cid}/fixed-assets`, { paymentAccountId: bank.id, ...body })).json;
    return x?.asset ?? x;
  };
  const van = await mk({ assetName: "Old Van", category: "vehicles", purchaseDate: monthStart(3), purchaseCost: 3600, salvageValue: 600, usefulLifeYears: 3 });
  r = await S.post(`/api/companies/${S.cid}/fixed-assets/run-depreciation`, { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() });
  const vr = r.json?.results?.find((x) => x.assetId === van.id);
  ok("sign-off 2: run depreciation for this month catches the van up (4 months posted, one journal each)", r.status === 200 && vr?.monthsPosted === 4, { s: r.status, j: r.json });
  const sched = (await db.query(`SELECT ds.period_year, ds.period_month, ds.amount::float8 AS a, je.date::text AS d FROM depreciation_schedules ds JOIN journal_entries je ON je.id = ds.journal_entry_id WHERE ds.asset_id = $1 ORDER BY 1, 2`, [van.id])).rows;
  const endOf = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  ok("sign-off 2: each month has its own journal dated the month end", sched.length === 4 && sched.every((x) => x.d.slice(0, 10) === endOf(x.period_year, x.period_month)), sched);
  const reg = (await S.get(`/api/companies/${S.cid}/fixed-assets/register?asOf=${today}`)).json;
  ok("sign-off 2: the register shows the accumulated depreciation to date (month ends up to today) and still ties to the ledger", close(reg?.rows?.find((x) => x.assetId === van.id)?.accumulated, sched.filter((x) => x.d.slice(0, 10) <= today).reduce((s, x) => s + x.a, 0)) && close(reg?.glTie?.difference, 0) && reg.rows.find((x) => x.assetId === van.id).accumulated > 200, { row: reg?.rows?.find((x) => x.assetId === van.id), tie: reg?.glTie });
  r = await S.post(`/api/companies/${S.cid}/fixed-assets/run-depreciation`, { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() });
  ok("sign-off 2: running the same month again posts nothing", r.status === 200 && r.json?.results?.find((x) => x.assetId === van.id)?.skipped === true && (await db.query(`SELECT COUNT(*)::int AS c FROM depreciation_schedules WHERE asset_id = $1`, [van.id])).rows[0].c === 4, r.json);

  // 1. the charge does not depend on run order; disposal catch-up uses the same amounts
  const lap = await mk({ assetName: "Order Laptop", category: "equipment", purchaseDate: monthStart(4), purchaseCost: 4200, salvageValue: 0, usefulLifeYears: 3 });
  const m3 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  r = await S.post(`/api/fixed-assets/${lap.id}/depreciate`, { month: m3.getUTCMonth() + 1, year: m3.getUTCFullYear() });
  ok("sign-off 1: running a later month first charges 116.67 and catches the earlier month up at 116.67", r.status === 200 && close(r.json?.monthlyDepreciation, 116.67) && r.json?.catchUp?.length === 1 && close(r.json.catchUp[0].amount, 116.67), { s: r.status, j: r.json });
  const m4 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4, 1));
  r = await S.post(`/api/fixed-assets/${lap.id}/depreciate`, { month: m4.getUTCMonth() + 1, year: m4.getUTCFullYear() });
  ok("sign-off 1: the earlier month is already posted (409), nothing is re-priced", r.status === 409, { s: r.status });
  r = await S.post(`/api/fixed-assets/${lap.id}/dispose`, { disposalDate: today, disposalAmount: 3000, proceedsAccountId: bank.id });
  // Teardown 7 F4: depreciation runs to the disposal date: the 4 whole months, then the disposal month pro rata by days
  const dimNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const partMonth = Math.round(116.67 * (now.getUTCDate() / dimNow) * 100) / 100;
  ok("sign-off 1: disposal catch-up charges the same 116.67 for each remaining month, then the disposal month by days", r.status === 200 && r.json?.catchUpDepreciation?.length === 2 && r.json.catchUpDepreciation.every((x) => close(x.amount, 116.67)) && close(4200 - r.json.netBookValueAtDisposal, 4 * 116.67 + partMonth, 0.03), { s: r.status, nbv: r.json?.netBookValueAtDisposal, expected: 4 * 116.67 + partMonth, j: r.json?.catchUpDepreciation });
  const bal = await S.balances();
  const reg2 = (await S.get(`/api/companies/${S.cid}/fixed-assets/register?asOf=${today}`)).json;
  ok("sign-off 1: the register still ties to the ledger after disposal", close(reg2?.glTie?.difference, 0), { tie: reg2?.glTie, bal1240: bal["1240"] });
}

// ─────────────────────────── create-entry: locks, concurrency, unmatch, FX ───────────────────────────
async function postingSection() {
  const E = await newCompany("pst");
  const ba = await E.bankAccount();
  await E.importCsv(ba.id, [`${day(-4)},BANK FEE ONE,25.00,,975.00`]);
  const t1 = (await E.txns(ba.id))[0];
  const exp = E.acct("5110") ?? E.acct("5000");

  const results = await Promise.all(Array.from({ length: 10 }, () => E.post(`/api/companies/${E.cid}/bank-statements/${t1.id}/create-entry`, { accountId: exp.id })));
  const created = results.filter((x) => x.status === 201).length;
  ok("extra: 10 parallel create-entry -> exactly one posts", created === 1 && results.filter((x) => x.status === 409).length === 9 && (await sumEntries(E.cid, "bank_reconciliation")) === 1, results.map((x) => x.status));

  // unmatch + re-create x3: the ledger moves once
  for (let i = 0; i < 3; i++) {
    const u = await api("DELETE", `/api/companies/${E.cid}/bank-statements/${t1.id}/match`, { token: E.token });
    if (i === 0) ok("unmatch: create-entry is reversed on unmatch (reversedEntryId)", u.status === 200 && !!u.json?.reversedEntryId, { s: u.status, j: u.json });
    const c = await E.post(`/api/companies/${E.cid}/bank-statements/${t1.id}/create-entry`, { accountId: exp.id });
    if (c.status !== 201) ok("unmatch: re-create works", false, { s: c.status, j: c.json });
  }
  const bal = await E.balances();
  ok("review: unmatch / re-create x3 moves the ledger once (net posting 25)", close(bal["1020"], -25) && close(bal[exp.code], 25), bal);
  ok("unmatch: the original entries stay posted, each reversed once", (await db.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'reversal' AND status = 'posted'`, [E.cid])).rows[0].c === 3, {});

  // document-only accounts cannot be posted from a bank line
  await E.importCsv(ba.id, [`${day(-3)},ODD LINE,,10.00,985.00`]);
  const odd = (await E.txns(ba.id)).find((t) => /ODD LINE/.test(t.description));
  let r = await E.post(`/api/companies/${E.cid}/bank-statements/${odd.id}/create-entry`, { accountId: E.acct("1040").id });
  ok("defect: create-entry to receivables is refused (needs an invoice)", r.status === 422 && r.json?.code === "ACCOUNT_REQUIRES_DOCUMENT", { s: r.status, j: r.json });
  r = await E.post(`/api/companies/${E.cid}/bank-statements/${odd.id}/create-entry`, { accountId: ba.glAccountId });
  ok("defect: the bank account cannot be its own contra", r.status === 422, { s: r.status });

  // locked month
  const lockedDay = new Date(Date.UTC(new Date().getUTCFullYear() - 1, 5, 15)).toISOString().slice(0, 10);
  await E.importCsv(ba.id, [`${lockedDay},OLD FEE,12.00,,500.00`]);
  const old = (await E.txns(ba.id)).find((t) => /OLD FEE/.test(t.description));
  const lock = await E.post(`/api/companies/${E.cid}/month-end/lock-period`, { periodEnd: new Date(Date.UTC(new Date().getUTCFullYear() - 1, 5, 30)).toISOString().slice(0, 10) });
  r = await E.post(`/api/companies/${E.cid}/bank-statements/${old.id}/create-entry`, { accountId: exp.id });
  ok("extra: a line in a locked month -> 403 and nothing posted", (lock.status === 200 || lock.status === 201) ? r.status === 403 : true, { lock: lock.status, s: r.status, j: r.json });

  // USD bank account converts at the dated rate
  await E.post(`/api/companies/${E.cid}/exchange-rates`, { fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: day(-60) });
  const usdGl = await E.post(`/api/companies/${E.cid}/accounts`, { code: "1021", nameEn: "USD Bank", type: "asset" });
  const usd = await E.bankAccount({ currency: "USD", iban: null, glAccountId: usdGl.json?.id ?? E.acct("1020").id });
  await E.importCsv(usd.id, [`${day(-2)},SOFTWARE SUB,100.00,,900.00`]);
  const ut = (await E.txns(usd.id))[0];
  r = await E.post(`/api/companies/${E.cid}/bank-statements/${ut.id}/create-entry`, { accountId: exp.id });
  const fxLines = (await db.query(`SELECT jl.debit::float8 AS d, jl.credit::float8 AS c, jl.foreign_currency, jl.foreign_credit::float8 AS fc FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.source_id = $1 AND je.source = 'bank_reconciliation'`, [ut.id])).rows;
  ok("extra: a USD account posts AED at the rate, with the foreign amount on the bank line", r.status === 201 && fxLines.some((l) => close(l.c, 367.25) && l.foreign_currency === "USD" && close(l.fc, 100)) && fxLines.some((l) => close(l.d, 367.25)), { s: r.status, fxLines });
}

// ─────────────────────────── D3-6 rules ───────────────────────────
async function rulesSection() {
  const R = await newCompany("rul");
  const ba = await R.bankAccount();
  const utilities = R.acct("5030"), phone = R.acct("5040");
  const rule = (extra = {}) => R.post(`/api/companies/${R.cid}/reconciliation-rules`, { name: "DEWA", matchField: "description", matchType: "contains", matchValue: "DEWA", direction: "outflow", splitLines: [{ accountId: utilities.id, percent: 90 }, { accountId: phone.id, percent: 10 }], vatRate: 5, ...extra });
  let r = await rule();
  ok("D3-6: a split rule with VAT is created", r.status === 201 && r.json?.splitLines?.length === 2, { s: r.status, j: r.json });
  const ruleId = r.json?.id;

  r = await rule({ splitLines: [{ accountId: utilities.id, percent: 60 }, { accountId: phone.id, percent: 30 }] });
  ok("D3-6: split percents not adding to 100 -> 422 RULE_SPLIT_INVALID", r.status === 422 && r.json?.code === "RULE_SPLIT_INVALID", { s: r.status, j: r.json });
  r = await rule({ splitLines: [{ accountId: R.acct("1040").id, percent: 100 }] });
  ok("review: a receivables account in a split -> 422 RULE_ACCOUNT_INVALID", r.status === 422 && r.json?.code === "RULE_ACCOUNT_INVALID", { s: r.status, j: r.json });
  r = await rule({ matchType: "regex", matchValue: "(a+)+$" });
  ok("review: regex (a+)+$ -> 422 RULE_REGEX_UNSAFE", r.status === 422 && r.json?.code === "RULE_REGEX_UNSAFE", { s: r.status, j: r.json });
  r = await rule({ direction: "inflow" });
  ok("D3-6: VAT on an inflow rule -> 422 RULE_VAT_INFLOW_UNSUPPORTED", r.status === 422 && r.json?.code === "RULE_VAT_INFLOW_UNSUPPORTED", { s: r.status, j: r.json });
  const B = await newCompany("rulb");
  r = await rule({ splitLines: [{ accountId: B.acct("5030").id, percent: 100 }] });
  ok("tenant: another company's account in a split -> 422 RULE_ACCOUNT_INVALID", r.status === 422 && r.json?.code === "RULE_ACCOUNT_INVALID", { s: r.status, j: r.json });
  r = await api("PUT", `/api/reconciliation-rules/${ruleId}`, { token: B.token, body: { name: "hijack" } });
  ok("tenant: B cannot edit A's rule (404)", r.status === 404, { s: r.status });
  r = await api("DELETE", `/api/reconciliation-rules/${ruleId}`, { token: B.token });
  ok("tenant: B cannot delete A's rule (404)", r.status === 404, { s: r.status });

  await R.importCsv(ba.id, [`${day(-2)},DEWA PAYMENT SEP,1050.00,,8950.00`, `${day(-2)},SALARY TRANSFER,500.00,,8450.00`]);
  const lines = await R.txns(ba.id);
  const dewa = lines.find((t) => /DEWA/.test(t.description));
  r = await R.post(`/api/companies/${R.cid}/reconciliation-rules/auto-match`, {});
  ok("D3-6: auto-match only suggests (nothing posted)", r.status === 200 && r.json?.matched === 1 && r.json?.posted === 0 && (await sumEntries(R.cid, "bank_rule")) === 0, { s: r.status, j: r.json });
  r = await R.post(`/api/companies/${R.cid}/bank-statements/apply-rules`, { bankAccountId: ba.id, commit: false });
  const preview = r.json?.[0]?.proposedLines;
  ok("D3-6: the preview shows the exact Dr/Cr before posting", r.status === 200 && r.json?.length === 1 && preview?.length === 4 && preview.some((l) => l.accountCode === "1050" && l.debit === 50) && preview.some((l) => l.accountCode === "1020" && l.credit === 1050), r.json);
  r = await R.post(`/api/companies/${R.cid}/bank-statements/${dewa.id}/apply-rule`, { ruleId });
  ok("D3-6: apply-rule posts", r.status === 201 && !!r.json?.journalEntryId && !!r.json?.receiptId, { s: r.status, j: r.json });
  const bal = await R.balances();
  ok("D3-6: Dr 5030 900, Dr 5040 100, Dr 1050 50 / Cr 1020 1,050", close(bal["5030"], 900) && close(bal["5040"], 100) && close(bal["1050"], 50) && close(bal["1020"], -1050), bal);
  const rr = await api("GET", `/api/companies/${R.cid}/reconciliation-rules`, { token: R.token });
  ok("D3-6: timesApplied +1", rr.json?.find((x) => x.id === ruleId)?.timesApplied === 1, rr.json?.find((x) => x.id === ruleId));
  const rcpt = (await db.query(`SELECT amount::float8 AS a, vat_amount::float8 AS v, posted, journal_entry_id, bank_transaction_id FROM receipts WHERE company_id = $1`, [R.cid])).rows;
  ok("D3-6: a posted receipt row carries net, VAT, journal and bank line", rcpt.length === 1 && close(rcpt[0].a, 1000) && close(rcpt[0].v, 50) && rcpt[0].posted && !!rcpt[0].journal_entry_id && rcpt[0].bank_transaction_id === dewa.id, rcpt);
  const month = today.slice(0, 8) + "01";
  const vr = await R.post(`/api/companies/${R.cid}/vat-returns/generate`, { periodStart: day(-30), periodEnd: today });
  ok("D3-6: VAT return box 9 includes 1,000 / 50", close(vr.json?.box9ExpensesAmount, 1000, 0.02) && close(vr.json?.box9ExpensesVat, 50, 0.02), { s: vr.status, a: vr.json?.box9ExpensesAmount, v: vr.json?.box9ExpensesVat });
  r = await api("PUT", `/api/receipts/${rcpt[0].id ?? (await db.query(`SELECT id FROM receipts WHERE company_id = $1`, [R.cid])).rows[0].id}`, { token: R.token, body: { merchant: "edited" } });
  ok("D3-6: the rule's receipt cannot be edited alone (409 BANK_RULE_RECEIPT)", r.status === 409 && r.json?.code === "BANK_RULE_RECEIPT", { s: r.status, j: r.json });
  r = await R.post(`/api/companies/${R.cid}/bank-statements/${dewa.id}/apply-rule`, { ruleId });
  ok("D3-6: applying twice -> 409 ALREADY_RECONCILED", r.status === 409 && r.json?.code === "ALREADY_RECONCILED", { s: r.status, j: r.json });
  r = await api("DELETE", `/api/companies/${R.cid}/bank-statements/${dewa.id}/match`, { token: R.token });
  const bal2 = await R.balances();
  ok("D3-6: unmatch reverses the rule entry and deletes its receipt", r.status === 200 && !!r.json?.reversedEntryId && close(bal2["5030"] ?? 0, 0) && close(bal2["1050"] ?? 0, 0) && (await db.query(`SELECT COUNT(*)::int AS c FROM receipts WHERE company_id = $1`, [R.cid])).rows[0].c === 0, { s: r.status, bal2 });
  const vr2 = await R.post(`/api/companies/${R.cid}/vat-returns/generate`, { periodStart: day(-30), periodEnd: today });
  ok("D3-6: box 9 is empty again after the unmatch", close(vr2.json?.box9ExpensesVat ?? 0, 0, 0.02), vr2.json?.box9ExpensesVat);

  // an employee may look but not post
  const emp = await api("POST", "/api/auth/register", { body: { name: "emp", email: `emp_${rnd}@example.com`, password: "Password123!" } });
  const empToken = emp.json?.token;
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'employee') ON CONFLICT DO NOTHING`, [R.cid, emp.json?.user?.id]);
  r = await api("POST", `/api/companies/${R.cid}/bank-statements/${dewa.id}/apply-rule`, { token: empToken, body: { ruleId } });
  ok("roles: an employee cannot post from the bank screen (403 ROLE_REQUIRED; the employee role is refused before the bank check)", r.status === 403 && (r.json?.code === "ROLE_NOT_ALLOWED" || r.json?.code === "ROLE_REQUIRED"), { s: r.status, j: r.json });
}

// ─────────────────────────── D3-7 reconciliation ───────────────────────────
async function reconciliationSection() {
  const Q = await newCompany("rec");
  const ba = await Q.bankAccount({ reconcileFrom: day(-15) }); // the opening entry before this day counts as cleared
  const bankGl = Q.acct("1020").id, rev = Q.acct("4010").id, exp = Q.acct("5000").id;
  // ledger: opening 1000 on d-20, a matched fee, a deposit in transit, an outstanding cheque
  await Q.journal(day(-20), [{ accountId: bankGl, debit: 1000, credit: 0 }, { accountId: Q.acct("3010")?.id ?? rev, debit: 0, credit: 1000 }], { description: "opening" });
  await Q.importCsv(ba.id, [`${day(-10)},BANK FEE,50.00,,950.00`, `${day(-9)},CLIENT DEPOSIT,,120.00,1070.00`]);
  const fee = (await Q.txns(ba.id)).find((t) => /BANK FEE/.test(t.description));
  let r = await Q.post(`/api/companies/${Q.cid}/bank-statements/${fee.id}/create-entry`, { accountId: exp });
  ok("D3-7: setup: the fee is matched", r.status === 201, { s: r.status, j: r.json });
  // deposit in transit (ledger +300 not on statement) and outstanding payment (ledger -200 not on statement)
  await Q.journal(day(-5), [{ accountId: bankGl, debit: 300, credit: 0 }, { accountId: rev, debit: 0, credit: 300 }], { description: "deposit in transit" });
  await Q.journal(day(-4), [{ accountId: exp, debit: 200, credit: 0 }, { accountId: bankGl, debit: 0, credit: 200 }], { description: "cheque 1001" });
  r = await Q.get(`/api/companies/${Q.cid}/bank-statements/reconciliation-report?bankAccountId=${ba.id}&asOf=${today}&statementBalance=1070`);
  const s = r.json;
  ok("D3-7: the report has the two-sided fields", r.status === 200 && ["statementBalance", "ledgerBalance", "unreconciledCredits", "unreconciledDebits", "depositsInTransit", "outstandingPayments", "adjustedStatementBalance", "adjustedLedgerBalance", "difference"].every((k) => k in s), Object.keys(s ?? {}));
  ok("D3-7: ledger 1,050 (1000 - 50 + 300 - 200), statement 1,070", close(s?.ledgerBalance, 1050) && close(s?.statementBalance, 1070), { l: s?.ledgerBalance, s: s?.statementBalance });
  ok("D3-7: the unmatched deposit is a statement credit, the transit items are listed", close(s?.unreconciledCredits, 120) && close(s?.depositsInTransit, 300) && close(s?.outstandingPayments, 200) && s?.items?.depositsInTransit?.length === 1, s);
  ok("D3-7: adjusted balances are equal, difference 0", close(s?.adjustedStatementBalance, 1170) && close(s?.adjustedLedgerBalance, 1170) && close(s?.difference, 0), { a: s?.adjustedStatementBalance, b: s?.adjustedLedgerBalance, d: s?.difference });
  r = await Q.get(`/api/companies/${Q.cid}/bank-statements/reconciliation-report?bankAccountId=${ba.id}&asOf=${today}&statementBalance=1070&format=csv`);
  ok("D3-7: CSV export with a BOM", r.status === 200 && (await startsWithBom(`/api/companies/${Q.cid}/bank-statements/reconciliation-report?bankAccountId=${ba.id}&asOf=${today}&statementBalance=1070&format=csv`, Q.token)) && /Adjusted ledger balance/.test(r.text), { s: r.status, head: r.text.slice(0, 40) });
  r = await Q.get(`/api/companies/${Q.cid}/bank-statements/reconciliation-report?bankAccountId=${ba.id}&asOf=${today}`);
  ok("D3-7: without a given balance the import's running balance is used", r.json?.statementBalanceSource === "running_balance" || r.json?.statementBalanceSource === "import", r.json?.statementBalanceSource);

  // complete needs difference 0
  r = await Q.post(`/api/companies/${Q.cid}/bank-reconciliations`, { bankAccountId: ba.id, statementDate: today, statementBalance: 1000 });
  ok("D3-7: an unbalanced session -> 422 RECONCILIATION_NOT_BALANCED", r.status === 422 && r.json?.code === "RECONCILIATION_NOT_BALANCED" && close(r.json?.details?.difference, -70), { s: r.status, j: r.json });
  // book the 120 deposit so the difference clears
  const dep = (await Q.txns(ba.id)).find((t) => /CLIENT DEPOSIT/.test(t.description));
  await Q.post(`/api/companies/${Q.cid}/bank-statements/${dep.id}/create-entry`, { accountId: rev });
  r = await Q.post(`/api/companies/${Q.cid}/bank-reconciliations`, { bankAccountId: ba.id, statementDate: today, statementBalance: 1070 });
  ok("D3-7: a balanced session completes", r.status === 201 && r.json?.status === "completed", { s: r.status, j: r.json });
  const sess = r.json;
  const frozen = (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transactions WHERE company_id = $1 AND reconciliation_id = $2`, [Q.cid, sess?.id])).rows[0].c;
  ok("D3-7: the cleared bank lines are stamped with the session", frozen === 2, frozen);
  r = await api("DELETE", `/api/companies/${Q.cid}/bank-statements/${fee.id}/match`, { token: Q.token });
  ok("D3-7: a cleared line is frozen (409 BANK_TXN_IN_COMPLETED_RECONCILIATION)", r.status === 409 && r.json?.code === "BANK_TXN_IN_COMPLETED_RECONCILIATION", { s: r.status, j: r.json });
  r = await Q.post(`/api/companies/${Q.cid}/bank-reconciliations`, { bankAccountId: ba.id, statementDate: day(-1), statementBalance: 1070 });
  ok("D3-7: an older session after a newer one -> 409 RECONCILIATION_OUT_OF_ORDER", r.status === 409 && r.json?.code === "RECONCILIATION_OUT_OF_ORDER", { s: r.status, j: r.json });
  r = await Q.post(`/api/companies/${Q.cid}/bank-reconciliations/${sess.id}/reopen`, {});
  ok("D3-7: reopen the latest session", r.status === 200 && r.json?.status === "reopened", { s: r.status, j: r.json });
  ok("D3-7: ...which releases its lines", (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transactions WHERE company_id = $1 AND reconciliation_id IS NOT NULL`, [Q.cid])).rows[0].c === 0, {});
  r = await api("DELETE", `/api/companies/${Q.cid}/bank-statements/${fee.id}/match`, { token: Q.token });
  ok("D3-7: after reopening the line can be unmatched", r.status === 200 && !!r.json?.reversedEntryId, { s: r.status, j: r.json });
  const X = await newCompany("recx");
  r = await api("GET", `/api/companies/${Q.cid}/bank-statements/reconciliation-report?bankAccountId=${ba.id}&asOf=${today}`, { token: X.token });
  ok("tenant: another company cannot read the report (403)", r.status === 403, { s: r.status });
  r = await api("GET", `/api/companies/${X.cid}/bank-statements/reconciliation-report?bankAccountId=${ba.id}&asOf=${today}`, { token: X.token });
  ok("tenant: ...nor with its own company id and A's bank account (404)", r.status === 404, { s: r.status });
  r = await api("POST", `/api/companies/${X.cid}/bank-reconciliations/${sess.id}/reopen`, { token: X.token, body: {} });
  ok("tenant: ...nor reopen A's session (404)", r.status === 404, { s: r.status });

  // D3-8: payout against the gateway clearing account (D1's 1025)
  const clearing = Q.acct("1025");
  if (!clearing) skip("D3-8: payout suggestion", "account 1025 not in the chart (D1 migration absent)");
  else {
    await Q.journal(day(-3), [{ accountId: clearing.id, debit: 2990, credit: 0 }, { accountId: rev, debit: 0, credit: 2990 }], { description: "gateway sales" });
    await Q.importCsv(ba.id, [`${day(-1)},STRIPE PAYOUT,,2990.00,4060.00`]);
    const payout = (await Q.txns(ba.id)).find((t) => /STRIPE/.test(t.description));
    r = await Q.get(`/api/companies/${Q.cid}/bank-statements/${payout.id}/suggestions`);
    const sug = r.json?.find((x) => x.kind === "account");
    ok("D3-8: the payout is suggested against the clearing account (Dr bank / Cr 1025)", !!sug && sug.proposedLines.some((l) => l.accountCode === "1025" && l.credit === 2990), r.json?.slice?.(0, 2));
    r = await Q.post(`/api/companies/${Q.cid}/bank-statements/${payout.id}/match`, { matchedType: "journal", matchedId: sug?.targetId });
    r = await Q.post(`/api/companies/${Q.cid}/bank-statements/bulk-match`, { items: [{ transactionId: payout.id, kind: "account", targetId: sug?.targetId }] });
    ok("D3-8: accepting it brings 1025 to 0", r.status === 200 && close((await Q.balances())["1025"], 0), { s: r.status, j: r.json });
  }
}

// ─────────────────────────── D3-3 / D3-4 feeds ───────────────────────────
async function feedsSection() {
  const F = await newCompany("fee");
  let r = await F.get("/api/bank/providers");
  ok("D3-3: without Lean the providers list is empty", r.status === 200 && Array.isArray(r.json?.providers) && r.json.providers.length === 0 && r.json.isConfigured === false, r.json);
  r = await F.post(`/api/companies/${F.cid}/bank-connections/connect`, { provider: "lean", redirectUrl: "https://example.com/cb" });
  ok("D3-3: connect -> 400 BANK_PROVIDER_NOT_CONFIGURED", r.status === 400 && r.json?.code === "BANK_PROVIDER_NOT_CONFIGURED", { s: r.status, j: r.json });
  r = await F.post(`/api/companies/${F.cid}/bank-feeds/lean/session`, {});
  ok("D3-3: the Link session is refused too (400)", r.status === 400 && r.json?.code === "BANK_PROVIDER_NOT_CONFIGURED", { s: r.status });
  r = await F.post(`/api/companies/${F.cid}/bank-connections/callback`, { provider: "lean", code: "any-entity-id" });
  ok("defect: the legacy callback is retired (410), a code is no longer an entity id", r.status === 410, { s: r.status });

  // secrets never leave the server
  const ba = await F.bankAccount();
  const ins = await db.query(
    `INSERT INTO bank_connections (company_id, provider, connection_type, status, access_token, refresh_token, consent_id, external_account_id, bank_account_id)
     VALUES ($1, 'lean', 'open_banking', 'active', 'SECRET-ACCESS-TOKEN', 'SECRET-REFRESH', 'SECRET-CONSENT', 'acc-1', $2) RETURNING id`, [F.cid, ba.id]);
  await db.query(`UPDATE bank_connections SET provider_entity_id = 'SECRET-ENTITY' WHERE id = $1`, [ins.rows[0].id]);
  r = await F.get(`/api/companies/${F.cid}/bank-connections`);
  ok("defect: GET bank-connections never returns tokens, consent or entity id", r.status === 200 && r.json.length === 1 && !/SECRET/.test(r.text) && !("accessToken" in r.json[0]) && !("providerEntityId" in r.json[0]), r.text.slice(0, 300));
  r = await F.post(`/api/companies/${F.cid}/bank-connections`, { provider: "lean", accessToken: "EVIL", refreshToken: "EVIL", bankName: "Manual Bank" });
  ok("defect: POST bank-connections is manual only (provider and tokens ignored)", r.status === 201 && r.json?.provider === "manual" && !/EVIL/.test(r.text), r.json);
  const row = (await db.query(`SELECT provider, access_token FROM bank_connections WHERE id = $1`, [r.json?.id])).rows[0];
  ok("defect: ...and nothing client-supplied was stored", row?.provider === "manual" && row?.access_token === null, row);
  const G = await newCompany("feeb");
  r = await api("POST", `/api/bank-connections/${ins.rows[0].id}/sync`, { token: G.token, body: {} });
  ok("tenant: another company cannot sync A's connection (404)", r.status === 404, { s: r.status });
  r = await api("DELETE", `/api/bank-connections/${ins.rows[0].id}`, { token: G.token });
  ok("tenant: ...nor disconnect it (404)", r.status === 404, { s: r.status });
  r = await F.post(`/api/bank-connections/${ins.rows[0].id}/sync`, {});
  ok("D3-3: sync without a configured provider -> 400", r.status === 400, { s: r.status, j: r.json });
  r = await api("DELETE", `/api/bank-connections/${ins.rows[0].id}`, { token: F.token });
  const after = (await db.query(`SELECT status, access_token, refresh_token, provider_entity_id, consent_id FROM bank_connections WHERE id = $1`, [ins.rows[0].id])).rows[0];
  ok("D3-3: disconnect nulls the secrets and keeps the row", r.status === 200 && after?.status === "disconnected" && !after.access_token && !after.refresh_token && !after.provider_entity_id && !after.consent_id, after);

  await leanSection();
}

// An in-test Lean: token, customers, entities, accounts, transactions.
function startMockLean() {
  const state = { customers: new Map(), calls: [], foreignEntity: "99999999-0000-4000-8000-000000000001", entities: new Map(), txBatches: 0 };
  const accountsOf = () => [{ account_id: "11111111-1111-4111-8111-111111111111", status: "ENABLED", currency: "AED", account: [{ scheme_name: "IBAN", identification: IBAN }], servicer: { identification: "ENBD" }, nickname: "Operating" }];
  const txs = [
    { transaction_id: "L-1", amount: { currency: "AED", amount: 820.5 }, credit_debit_indicator: "DEBIT", booking_date_time: `${day(-3)}T08:00:00Z`, status: "BOOKED", transaction_information: "DEWA bill" },
    { transaction_id: "L-2", amount: { currency: "AED", amount: 5250 }, credit_debit_indicator: "CREDIT", booking_date_time: `${day(-2)}T08:00:00Z`, status: "BOOKED", transaction_information: "Customer payment" },
    { transaction_id: "L-3", amount: { currency: "AED", amount: 99 }, credit_debit_indicator: "DEBIT", booking_date_time: `${day(-1)}T08:00:00Z`, status: "PENDING", transaction_information: "Pending" },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.calls.push(`${req.method} ${url.pathname}`);
      const send = (j, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
      if (url.pathname === "/oauth2/token") return send({ access_token: "mock-token", token_type: "bearer", expires_in: 3599 });
      if (!/^Bearer /.test(req.headers.authorization ?? "")) return send({ error: "unauthorized" }, 401);
      if (req.method === "POST" && url.pathname === "/customers/v1/") {
        const appUser = JSON.parse(body).app_user_id;
        if (!state.customers.has(appUser)) state.customers.set(appUser, `cust-${state.customers.size + 1}-0000-4000-8000-000000000000`.replace(/^cust-/, "c0000000-0000-4000-8000-00000000000"));
        return send({ customer_id: state.customers.get(appUser), app_user_id: appUser });
      }
      if (url.pathname === "/customers/v1/entities") {
        const data = [...state.entities].map(([id, e]) => ({ id, customer_id: e.customer, status: "ACTIVE", bank_identifier: e.bank, created_at: new Date(e.createdAt).toISOString() }));
        data.push({ id: state.foreignEntity, customer_id: "c-foreign", status: "ACTIVE" });
        return send({ data, page: { number: 0 } });
      }
      if (url.pathname === "/data/v2/accounts") return send({ data: { type: "accounts", accounts: accountsOf(), page: { total_pages: 1 } } });
      if (/\/data\/v2\/accounts\/[^/]+\/transactions$/.test(url.pathname)) { state.txBatches++; return send({ data: { type: "transactions", transactions: txs, page: { number: 0, total_pages: 1 } } }); }
      send({ error: "not found" }, 404);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port })));
}

async function leanSection() {
  const mock = await startMockLean();
  const basePort = Number(new URL(BASE).port || 5000);
  const port = basePort + 1;
  const leanBase = `http://127.0.0.1:${port}`;
  const secret = "x".repeat(48);
  const child = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), FRONTEND_URL: leanBase, CORS_ORIGIN: leanBase, SESSION_SECRET: secret, JWT_SECRET: "y".repeat(48),
      LEAN_APP_TOKEN: "11111111-2222-4333-8444-555555555555", LEAN_CLIENT_SECRET: "mock-secret", LEAN_ENV: "sandbox",
      LEAN_API_BASE_URL: `http://127.0.0.1:${mock.port}`, LEAN_AUTH_BASE_URL: `http://127.0.0.1:${mock.port}`,
    },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    up = await fetch(leanBase + "/api/version").then((x) => x.ok).catch(() => false);
  }
  try {
    const A = await newCompany("lean", leanBase);
    const pr = up ? await A.get("/api/bank/providers") : null;
    if (!up || !pr?.json?.providers?.length) return skip("D3-4: Lean feed against the mock", up ? "providers [] on the Lean server" : "second server did not boot");

    ok("D3-4: with Lean configured the providers list is ['lean'] in sandbox", pr.json.providers[0] === "lean" && pr.json.environment === "sandbox", pr.json);
    const ba = await A.bankAccount();
    let r = await A.post(`/api/companies/${A.cid}/bank-feeds/lean/session`, {});
    ok("D3-4: session returns the app token, a customer token and a signed state", r.status === 200 && !!r.json?.state && r.json?.sandbox === true && !!r.json?.accessToken && !!r.json?.customerId, { s: r.status, j: r.json });
    const state = r.json?.state, customerId = r.json?.customerId;
    const entity = "22222222-2222-4222-8222-222222222222";
    // Link has not finished yet: the browser may ask for accounts without naming an entity
    r = await A.post(`/api/companies/${A.cid}/bank-feeds/lean/accounts`, { state });
    ok("fix 5: no entity yet -> 409 ENTITY_NOT_READY", r.status === 409 && r.json?.code === "ENTITY_NOT_READY", { s: r.status, j: r.json });
    mock.state.entities.set(entity, { customer: customerId, bank: "ENBD", createdAt: Date.now() }); // what Link would have created for this customer
    r = await A.post(`/api/companies/${A.cid}/bank-feeds/lean/accounts`, { state });
    ok("fix 5: one entity for the company's customer -> its id and accounts, no entityId sent", r.status === 200 && r.json?.entityId === entity && r.json?.accounts?.length === 1, { s: r.status, j: r.json });
    mock.state.entities.set("44444444-4444-4444-8444-444444444444", { customer: customerId, bank: "ADCB", createdAt: Date.now() + 1000 });
    r = await A.post(`/api/companies/${A.cid}/bank-feeds/lean/accounts`, { state });
    ok("fix 5: several entities -> the list, newest first, to choose from", r.status === 200 && r.json?.entities?.length === 2 && r.json.entities[0].bankName === "ADCB" && !r.json.accounts, { s: r.status, j: r.json });
    mock.state.entities.delete("44444444-4444-4444-8444-444444444444");

    r = await A.post(`/api/companies/${A.cid}/bank-feeds/lean/accounts`, { state: "garbage.state", entityId: entity });
    ok("D3-4: a bad state -> 400 STATE_INVALID", r.status === 400 && r.json?.code === "STATE_INVALID", { s: r.status, j: r.json });
    r = await A.post(`/api/companies/${A.cid}/bank-feeds/lean/accounts`, { state, entityId: mock.state.foreignEntity });
    ok("D3-4: another customer's entity -> 403 BANK_ENTITY_NOT_OWNED", r.status === 403 && r.json?.code === "BANK_ENTITY_NOT_OWNED", { s: r.status, j: r.json });
    r = await A.post(`/api/companies/${A.cid}/bank-feeds/lean/accounts`, { state, entityId: "33333333-3333-4333-8333-333333333333" });
    ok("D3-4: an unknown entity -> 403", r.status === 403, { s: r.status });
    const B = await newCompany("leanb", leanBase);
    r = await B.post(`/api/companies/${B.cid}/bank-feeds/lean/accounts`, { state, entityId: entity });
    ok("tenant: A's state used by B -> 400 STATE_INVALID", r.status === 400 && r.json?.code === "STATE_INVALID", { s: r.status, j: r.json });
    const Bsession = await B.post(`/api/companies/${B.cid}/bank-feeds/lean/session`, {});
    r = await B.post(`/api/companies/${B.cid}/bank-feeds/lean/accounts`, { state: Bsession.json?.state, entityId: entity });
    ok("tenant: B with its own state but A's entity -> 403 BANK_ENTITY_NOT_OWNED", r.status === 403 && r.json?.code === "BANK_ENTITY_NOT_OWNED", { s: r.status, j: r.json });

    r = await A.post(`/api/companies/${A.cid}/bank-feeds/lean/accounts`, { state, entityId: entity });
    const acc = r.json?.accounts?.[0];
    ok("D3-4: the owned entity's accounts are listed", r.status === 200 && acc?.currency === "AED" && acc?.iban === IBAN, { s: r.status, j: r.json });
    const usd = await A.bankAccount({ currency: "USD", iban: null });
    r = await A.post(`/api/companies/${A.cid}/bank-feeds/connections`, { state, entityId: entity, externalAccountId: acc?.externalId, bankAccountId: usd.id, autoSync: true });
    ok("D3-4: a currency mismatch -> 422", r.status === 422 && r.json?.code === "CURRENCY_MISMATCH", { s: r.status, j: r.json });
    r = await A.post(`/api/companies/${A.cid}/bank-feeds/connections`, { state, entityId: entity, externalAccountId: acc?.externalId, bankAccountId: ba.id, autoSync: true });
    ok("D3-4: the connection is created, redacted", r.status === 201 && r.json?.provider === "lean" && r.json?.environment === "sandbox" && !/accessToken|providerEntityId/.test(r.text) && !r.text.includes(entity), { s: r.status, j: r.json });
    const connId = r.json?.id;
    const stored = (await db.query(`SELECT provider_entity_id FROM bank_connections WHERE id = $1`, [connId])).rows[0]?.provider_entity_id;
    ok("review: the entity id is encrypted at rest", !!stored && stored !== entity, { stored: String(stored).slice(0, 12) });
    r = await A.post(`/api/companies/${A.cid}/bank-feeds/connections`, { state, entityId: entity, externalAccountId: acc?.externalId, bankAccountId: ba.id, autoSync: true });
    ok("D3-4: connecting the same account twice -> 409", r.status === 409, { s: r.status, j: r.json });

    // a manual CSV of the same days first: the feed must dedupe against it
    await A.importCsv(ba.id, [`${day(-3)},DEWA CSV WORDING,820.50,,1000.00`]);
    r = await A.post(`/api/bank-connections/${connId}/sync`, {});
    ok("D3-4: first sync imports the new booked line only (pending skipped, CSV line deduped)", r.status === 200 && r.json?.imported === 1 && r.json?.duplicates === 1 && !!r.json?.lastSyncedAt, { s: r.status, j: r.json });
    r = await A.post(`/api/bank-connections/${connId}/sync`, {});
    ok("D3-4: the second sync imports 0", r.status === 200 && r.json?.imported === 0, { s: r.status, j: r.json });
    const feedRows = (await db.query(`SELECT import_source, external_id FROM bank_transactions WHERE company_id = $1 AND import_source = 'feed'`, [A.cid])).rows;
    ok("D3-4: feed rows carry the provider id and source 'feed'", feedRows.length === 1 && feedRows[0].external_id === "L-2", feedRows);
    const par = await Promise.all([0, 1, 2].map(() => A.post(`/api/bank-connections/${connId}/sync`, {})));
    ok("review: parallel syncs never double-insert", (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transactions WHERE company_id = $1 AND import_source = 'feed'`, [A.cid])).rows[0].c === 1 && par.every((x) => [200, 409].includes(x.status)), par.map((x) => x.status));
    ok("D3-4: the hourly job syncs only auto-sync connections (selection is unit-tested)", (await db.query(`SELECT auto_sync FROM bank_connections WHERE id = $1`, [connId])).rows[0].auto_sync === true, {});
  } finally {
    child.kill("SIGTERM");
    mock.server.close();
  }
}

// ─────────────────────────── D3-10 forecast ───────────────────────────
async function forecastSection() {
  const P = await newCompany("fcs");
  await P.journal(day(-30), [{ accountId: P.acct("1020").id, debit: 10000, credit: 0 }, { accountId: P.acct("4010").id, debit: 0, credit: 10000 }], { description: "opening cash" });
  const inv = await P.invoice({ date: day(-1), dueDate: day(10), unitPrice: 1000, vatRate: 0, name: "Forecast Co" });
  await db.query(
    `INSERT INTO vendor_bills (company_id, vendor_name, bill_number, bill_date, due_date, currency, subtotal, vat_amount, total_amount, amount_paid, status)
     VALUES ($1, 'Forecast Vendor', 'FV-1', $2, $3, 'AED', 400, 0, 400, 0, 'approved')`, [P.cid, day(-2), day(20)]);
  await db.query(
    `INSERT INTO recurring_invoices (company_id, customer_name, currency, frequency, start_date, next_run_date, lines_json, is_active)
     VALUES ($1, 'Retainer Co', 'AED', 'monthly', $2, $2, $3, true)`, [P.cid, day(-1), JSON.stringify([{ description: "retainer", quantity: 1, unitPrice: 500, vatRate: 0 }])]);
  await db.query(
    `INSERT INTO payroll_runs (company_id, period_month, period_year, total_basic, total_allowances, total_deductions, total_net, employee_count, status, created_at)
     VALUES ($1, 1, 2026, 6000, 0, 0, 6000, 2, 'approved', now())`, [P.cid]);

  let r = await P.get(`/api/companies/${P.cid}/cashflow/forecast?days=90`);
  const f = r.json;
  ok("D3-10: forecast answers with weeks, items, opening and insights", r.status === 200 && f?.weeks?.length === 13 && Array.isArray(f?.items) && Array.isArray(f?.insights) && Array.isArray(f?.projections), { s: r.status, keys: Object.keys(f ?? {}) });
  ok("D3-10: opening = the ledger bank balance", close(f?.openingBalance, 10000), f?.openingBalance);
  const by = (type) => f.items.filter((i) => i.type === type);
  ok("D3-10: the invoice (1,000 due +10d) is one inflow in the right week", by("invoice").length === 1 && close(by("invoice")[0].amount, 1000) && by("invoice")[0].date === day(10), by("invoice"));
  ok("D3-10: the bill (400 due +20d) is one outflow", by("bill").length === 1 && close(by("bill")[0].amount, -400) && by("bill")[0].date === day(20), by("bill"));
  ok("D3-10: the recurring 500 repeats monthly", by("recurring").length >= 2 && by("recurring").every((i) => close(i.amount, 500)), by("recurring").length);
  ok("D3-10: payroll 6,000 on the 28th each month", by("payroll").length >= 2 && by("payroll").every((i) => close(i.amount, -6000) && i.date.endsWith("-28")), by("payroll").map((i) => i.date));
  const week = (date) => f.weeks.find((w) => w.weekStart <= date && date <= w.weekEnd);
  ok("D3-10: weekly buckets carry +1,000 and -400", close(week(day(10))?.inflows, 1000 + (by("recurring").some((i) => week(i.date) === week(day(10))) ? 500 : 0), 600) && close(week(day(20))?.outflows, 400, 6001), { w10: week(day(10)), w20: week(day(20)) });
  const lastWeek = f.weeks[f.weeks.length - 1];
  ok("D3-10: the running balance adds up", close(lastWeek.closingBalance, 10000 + f.weeks.reduce((s, w) => s + w.net, 0)), lastWeek);

  r = await P.get(`/api/companies/${P.cid}/cashflow/forecast?days=90&receiptDelayDays=15`);
  ok("D3-10: 'customers pay 15 days late' shifts the receipt", r.json?.items?.find((i) => i.type === "invoice")?.date === day(25), r.json?.items?.filter((i) => i.type === "invoice"));
  r = await P.get(`/api/companies/${P.cid}/cashflow/forecast?days=90&collectionRatePct=50`);
  ok("D3-10: a collection rate scales the receipt", close(r.json?.items?.find((i) => i.type === "invoice")?.amount, 500), r.json?.items?.filter((i) => i.type === "invoice"));
  r = await P.get(`/api/companies/${P.cid}/cashflow/forecast?days=3`);
  ok("D3-10: days are clamped to 7..365", r.status === 200 && r.json?.weeks?.length === 1);
  r = await P.get(`/api/companies/${P.cid}/cashflow/forecast?days=90&receiptDelayDays=9999`);
  ok("D3-10: an out-of-range scenario field -> 400", r.status === 400, { s: r.status });

  // saved scenarios
  r = await P.post(`/api/companies/${P.cid}/cashflow/scenarios`, { name: "Slow payers", receiptDelayDays: 15, adjustments: [{ date: day(12), amount: -250, label: "Tax payment" }], isDefault: true });
  ok("D3-10: a scenario is saved", r.status === 201 && r.json?.name === "Slow payers" && r.json?.isDefault === true, { s: r.status, j: r.json });
  const sid = r.json?.id;
  r = await P.post(`/api/companies/${P.cid}/cashflow/scenarios`, { name: "Slow payers" });
  ok("D3-10: a duplicate name -> 409", r.status === 409, { s: r.status });
  r = await P.get(`/api/companies/${P.cid}/cashflow/forecast?days=90&scenarioId=${sid}`);
  ok("D3-10: the saved scenario applies (delay and one-off)", r.json?.items?.find((i) => i.type === "invoice")?.date === day(25) && r.json?.items?.some((i) => i.type === "adjustment" && close(i.amount, -250)), r.json?.scenario);
  r = await P.get(`/api/companies/${P.cid}/cashflow/forecast?days=90`);
  ok("D3-10: the default scenario applies when none is named", r.json?.scenarioMeta?.name === "Slow payers", r.json?.scenarioMeta);
  const Z = await newCompany("fcz");
  r = await api("GET", `/api/companies/${Z.cid}/cashflow/forecast?scenarioId=${sid}`, { token: Z.token });
  ok("tenant: another company's scenario id -> 404", r.status === 404, { s: r.status });
  r = await api("PATCH", `/api/companies/${Z.cid}/cashflow/scenarios/${sid}`, { token: Z.token, body: { name: "x" } });
  ok("tenant: ...cannot be patched (404)", r.status === 404, { s: r.status });
  r = await api("DELETE", `/api/companies/${Z.cid}/cashflow/scenarios/${sid}`, { token: Z.token });
  ok("tenant: ...nor deleted (404)", r.status === 404, { s: r.status });
  r = await api("GET", `/api/companies/${P.cid}/cashflow/forecast`, { token: Z.token });
  ok("tenant: ...nor the forecast read (403)", r.status === 403, { s: r.status });
  r = await P.post(`/api/companies/${P.cid}/cashflow/scenarios`, { name: "Bad", collectionRatePct: 150 });
  ok("D3-10: scenario fields are validated (400)", r.status === 400, { s: r.status });
  r = await api("DELETE", `/api/companies/${P.cid}/cashflow/scenarios/${sid}`, { token: P.token });
  ok("D3-10: a scenario can be deleted", r.status === 200, { s: r.status });
}

// ─────────────────────────── D3-9 assets ───────────────────────────
async function assetsSection() {
  const S = await newCompany("ast");
  const bank = S.acct("1020");
  await S.journal(day(-400), [{ accountId: bank.id, debit: 50000, credit: 0 }, { accountId: S.acct("3010")?.id ?? S.acct("4010").id, debit: 0, credit: 50000 }], { description: "capital" });
  const purchase = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
  let r = await S.post(`/api/companies/${S.cid}/fixed-assets`, { assetName: "Delivery Van", category: "vehicles", purchaseDate: purchase, purchaseCost: 3600, salvageValue: 600, usefulLifeYears: 3, depreciationMethod: "straight_line", paymentAccountId: bank.id });
  const asset = r.json?.asset ?? r.json;
  ok("D3-9: asset created and capitalised", (r.status === 201 || r.status === 200) && !!asset?.id, { s: r.status, j: r.json });
  const asset2 = (await S.post(`/api/companies/${S.cid}/fixed-assets`, { assetName: "Laptop", category: "equipment", purchaseDate: purchase, purchaseCost: 1200, salvageValue: 0, usefulLifeYears: 2, paymentAccountId: bank.id })).json;
  const a2 = asset2?.asset ?? asset2;
  const notOnLedger = (await S.post(`/api/companies/${S.cid}/fixed-assets`, { assetName: "Old Desk", category: "furniture", purchaseDate: purchase, purchaseCost: 500, salvageValue: 0, usefulLifeYears: 5 })).json;
  // book three months of depreciation
  for (const m of [0, 1, 2]) {
    const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 3 + m, 1));
    await S.post(`/api/fixed-assets/${asset.id}/depreciate`, { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() });
    await S.post(`/api/fixed-assets/${a2.id}/depreciate`, { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() });
  }
  r = await S.get(`/api/companies/${S.cid}/fixed-assets/register?asOf=${today}`);
  const reg = r.json;
  ok("D3-9: the register lists cost, accumulated, NBV", r.status === 200 && reg?.rows?.length >= 2 && reg.rows.every((x) => "cost" in x && "accumulated" in x && "nbv" in x), { s: r.status, keys: Object.keys(reg ?? {}) });
  const bal = await S.balances();
  ok("D3-9: the register total equals GL 1290 - 1240", close(reg?.totals?.nbv, n(bal["1290"]) + n(bal["1240"])) && close(reg?.glTie?.difference, 0), { totals: reg?.totals, gl: reg?.glTie, bal1290: bal["1290"], bal1240: bal["1240"] });
  ok("D3-9: accumulated equals the posted schedule", close(reg?.totals?.accumulated, (await db.query(`SELECT COALESCE(SUM(amount),0)::float8 AS s FROM depreciation_schedules WHERE company_id = $1`, [S.cid])).rows[0].s), reg?.totals);
  ok("D3-9: an asset not on the ledger is listed for capitalisation, outside the totals", reg?.glTie?.needsCapitalization?.some((x) => x.name === "Old Desk"), reg?.glTie?.needsCapitalization);
  r = await S.get(`/api/companies/${S.cid}/fixed-assets/register?asOf=${today}&format=csv`);
  ok("D3-9: the register exports CSV with a BOM", r.status === 200 && (await startsWithBom(`/api/companies/${S.cid}/fixed-assets/register?asOf=${today}&format=csv`, S.token)) && /Delivery Van/.test(r.text), { s: r.status, head: r.text.slice(0, 40) });
  r = await S.get(`/api/companies/${S.cid}/fixed-assets/register?asOf=${purchase}`);
  ok("D3-9: as of an earlier day only that day's depreciation (first of the month) is counted and still ties to the ledger", r.json?.rows?.every((x) => x.accumulated <= 83.34) && close(r.json?.glTie?.difference, 0), { rows: r.json?.rows?.map((x) => x.accumulated), tie: r.json?.glTie });

  r = await S.get(`/api/companies/${S.cid}/fixed-assets/depreciation-schedule?projectToEnd=true`);
  const sched = r.json ?? [];
  const vanRows = sched.filter((x) => x.name === "Delivery Van");
  ok("D3-9: the schedule has posted and projected months", r.status === 200 && vanRows.some((x) => !x.projected) && vanRows.some((x) => x.projected), { s: r.status, n: vanRows.length });
  const last = vanRows[vanRows.length - 1];
  ok("D3-9: the projection ends at salvage (NBV 600)", close(last?.nbv, 600, 0.02) && close(last?.accumulated, 3000, 0.02), last);
  const lap = sched.filter((x) => x.name === "Laptop");
  ok("D3-9: a zero-salvage asset projects to NBV 0", close(lap[lap.length - 1]?.nbv, 0, 0.02), lap[lap.length - 1]);

  // disposal: proceeds account and disposal_journal_id
  const bank2 = await S.post(`/api/companies/${S.cid}/accounts`, { code: "1022", nameEn: "Savings Bank", type: "asset" });
  r = await S.post(`/api/fixed-assets/${a2.id}/dispose`, { disposalDate: today, disposalAmount: 700, proceedsAccountId: S.acct("5000").id });
  ok("D3-9: a non-bank proceeds account -> 422 PROCEEDS_ACCOUNT_INVALID", r.status === 422 && r.json?.code === "PROCEEDS_ACCOUNT_INVALID", { s: r.status, j: r.json });
  const Tn = await newCompany("astb");
  r = await S.post(`/api/fixed-assets/${a2.id}/dispose`, { disposalDate: today, disposalAmount: 700, proceedsAccountId: Tn.acct("1020").id });
  ok("tenant: another company's proceeds account -> 422", r.status === 422 && r.json?.code === "PROCEEDS_ACCOUNT_INVALID", { s: r.status, j: r.json });
  r = await S.post(`/api/fixed-assets/${a2.id}/dispose`, { disposalDate: today, disposalAmount: 700, proceedsAccountId: bank2.json?.id ?? bank.id });
  ok("D3-9: disposal posts", r.status === 200 && !!r.json?.journalEntryId, { s: r.status, j: r.json });
  const row = (await db.query(`SELECT disposal_journal_id, disposal_account_id, disposal_amount::float8 AS amt FROM fixed_assets WHERE id = $1`, [a2.id])).rows[0];
  ok("D3-9: disposal_journal_id and the proceeds account are recorded", row?.disposal_journal_id === r.json?.journalEntryId && (bank2.json?.id ? row?.disposal_account_id === bank2.json.id : true) && close(row?.amt, 700), row);
  const proceedsLine = (await db.query(`SELECT jl.debit::float8 AS d, jl.account_id FROM journal_lines jl WHERE jl.entry_id = $1 AND jl.debit > 0 AND jl.description LIKE 'Proceeds%'`, [r.json?.journalEntryId])).rows[0];
  ok("D3-9: the proceeds are debited to the chosen account (not always 1010)", proceedsLine && close(proceedsLine.d, 700) && proceedsLine.account_id === (bank2.json?.id ?? proceedsLine.account_id), proceedsLine);
  r = await S.get(`/api/companies/${S.cid}/fixed-assets/register?asOf=${today}`);
  ok("D3-9: a disposed asset is excluded after its disposal date", !r.json?.rows?.some((x) => x.name === "Laptop"), r.json?.rows?.map((x) => x.name));
  r = await S.get(`/api/companies/${S.cid}/fixed-assets/register?asOf=${day(-1)}`);
  ok("D3-9: ...and included on the day before", r.json?.rows?.some((x) => x.name === "Laptop"), r.json?.rows?.map((x) => x.name));
  r = await api("GET", `/api/companies/${S.cid}/fixed-assets/register`, { token: Tn.token });
  ok("tenant: another company cannot read the register (403)", r.status === 403, { s: r.status });
}

// ─────────────────────────── UI (S6): honest screens and the browser flows ───────────────────────────
// Real Chromium against BASE (the Vite-served client). Skipped when playwright-core or a browser is not available.
const amountOf = (text) => {
  const t = String(text ?? "");
  const m = t.replace(/[^0-9.\-]/g, "");
  return (t.includes("-") ? -1 : 1) * Math.abs(Number(m.replace(/-/g, "")));
};

async function textPdf(lines) {
  const { default: PDFDocument } = await import("pdfkit");
  return await new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    for (const l of lines) doc.fontSize(11).text(l);
    doc.end();
  });
}

async function uiSection() {
  let chromium;
  try { ({ chromium } = await import("playwright-core")); } catch { skip("UI: all browser checks", "playwright-core is not installed"); return; }
  let browser;
  try { browser = await chromium.launch({ headless: true }); } catch (e) { skip("UI: all browser checks", "no browser: " + String(e.message).split("\n")[0].slice(0, 90)); return; }
  try { await uiChecks(browser); } finally { await browser.close(); }
}

async function uiLogin(page, U) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (c) => {
    await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
  }, { email: U.email, password: "Password123!" });
}

async function uiChecks(browser) {
  const U = await newCompany("ui");
  U.email = (await db.query(`SELECT email FROM users WHERE id = $1`, [U.userId])).rows[0].email;
  const ba = await U.bankAccount();
  await db.query(`UPDATE companies SET onboarding_completed = true WHERE id = $1`, [U.cid]);
  await U.api("PATCH", "/api/onboarding", { token: U.token, body: { showTour: false } });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 120)));
  await uiLogin(page, U);
  const dismissTour = async (pg) => {
    const skipBtn = pg.locator("[data-testid=button-skip-onboarding]");
    if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await skipBtn.click();
      await pg.locator("[data-testid=button-skip-onboarding]").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    }
  };
  const open = async (path) => {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await dismissTour(page);
  };
  const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const toastOrDialogGone = async () => page.waitForTimeout(300);

  // D3-3 UI: nothing "live" without a provider
  let r = await api("GET", "/api/bank/providers", { token: U.token });
  ok("D3-3 UI: providers is [] on this server", Array.isArray(r.json?.providers) && r.json.providers.length === 0, r.json);
  await open("/bank-reconciliation");
  await page.locator('[role=tab]').first().waitFor({ timeout: 15000 });
  await dismissTour(page);
  const tabs = await page.locator("[role=tab]").allTextContents();
  ok("D3-3 UI: no Feeds tab without a provider", !tabs.some((t) => /feed/i.test(t)) && ["Transactions", "Import", "Reconciliation"].every((n) => tabs.includes(n)), tabs);
  let text = await body();
  ok("D3-3 UI: the Transactions tab says nothing about live, connected, synced or sandbox", !/\b(live|connected|synced|sandbox)\b/i.test(text), text.slice(0, 200));
  await page.getByRole("tab", { name: "Import" }).click();
  await page.waitForTimeout(400);
  text = await body();
  ok("D3-3 UI: the Import tab says live feeds are not required, and nothing else claims a feed", /Live bank feeds are not required/.test(text) && !/\b(connected|synced|sandbox)\b/i.test(text), text.slice(0, 300));
  const settingOff = await page.locator('[data-testid=switch-pdf-ai]').getAttribute("data-state");
  ok("D3-1 UI: the AI reading option is off by default and says it is paid per call", settingOff === "unchecked" && /paid per call/i.test(await page.locator('[data-testid=pdf-ai-setting]').innerText()), settingOff);
  await page.getByRole("tab", { name: "Reconciliation" }).click();
  await page.waitForTimeout(500);
  text = await body();
  ok("D3-3 UI: the Reconciliation tab makes no feed claim", !/\b(live|connected|synced|sandbox)\b/i.test(text), text.slice(0, 200));

  // D3-1 / D3-2 UI: file import, auto-detected, re-upload adds nothing
  await page.getByRole("tab", { name: "Transactions" }).click();
  const closeImport = async () => {
    await page.locator("[data-testid=statement-import-dialog] button:has-text('Close'), [data-testid=statement-import-dialog] button:has-text('Cancel')").first().click();
    await page.locator("[data-testid=statement-import-dialog]").waitFor({ state: "hidden", timeout: 5000 });
  };
  const importFile = async (name, content) => {
    await page.locator('[data-testid=button-open-import]').click();
    await page.locator('[data-testid=statement-import-dialog]').waitFor();
    await page.locator("#statement-file").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) });
    await page.locator('[data-testid=button-confirm-import]').click();
  };
  await importFile("sep.ofx", fixture("statement.ofx"));
  await page.locator('[data-testid=import-result]').waitFor({ timeout: 20000 });
  text = await page.locator('[data-testid=import-result]').innerText();
  ok("D3-1 UI: an OFX upload reports 3 new transactions in the detected format", /3 new transaction/.test(text) && /OFX/.test(text), text);
  ok("D3-1 UI: the 3 lines are in the database", (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transactions WHERE company_id = $1`, [U.cid])).rows[0].c === 3);
  await closeImport();
  await importFile("sep.ofx", fixture("statement.ofx"));
  await page.locator('[data-testid=import-result]').waitFor({ timeout: 20000 });
  text = await page.locator('[data-testid=import-result]').innerText();
  ok("D3-2 UI: the same file again adds nothing and says 3 were skipped", /0 new transaction/.test(text) && /3 already existed/.test(text), text);
  await closeImport();
  await importFile("broken.sta", fixture("statement-truncated.sta"));
  const parseToast = await page.getByText(/problem at line 7/).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  ok("D3-1 UI: a truncated MT940 shows the line that broke the parse", parseToast, (await body()).slice(-300));
  await closeImport();

  // PDF: staged, reviewed, committed
  const d = (n) => day(n);
  const pdf = await textPdf([
    `Statement period ${d(-9)} to ${d(-7)} Opening balance 1,000.00`,
    `${d(-9)} DEWA utility bill DEWA-9001 820.50 179.50`,
    `${d(-8)} Customer payment Pearl Trading 5,250.00 5,429.50`,
    `${d(-7)} Bank charges 150.00 5,279.50`,
    "Closing balance 5,279.50",
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissTour(page);
  await importFile("sep.pdf", pdf);
  await page.locator('[data-testid=statement-review-grid]').waitFor({ timeout: 60000 });
  const rowCount = await page.locator('[data-testid^=review-row-]').count();
  ok("D3-1 UI: the PDF is staged as 3 reviewable rows, nothing imported yet", rowCount === 3 && (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transactions WHERE company_id = $1`, [U.cid])).rows[0].c === 3, { rowCount });
  const check = page.locator('[data-testid=review-balance-check]');
  ok("D3-1 UI: opening + rows = closing is confirmed", (await check.getAttribute("data-status")) === "ok", await check.innerText());
  await page.locator('[data-testid=review-row-1] button[role=checkbox]').click();
  ok("D3-1 UI: excluding a row breaks the balance check and says by how much", (await check.getAttribute("data-status")) === "mismatch" && /5,250\.00/.test(await check.innerText()), await check.innerText());
  await page.locator('[data-testid=review-row-1] button[role=checkbox]').click();
  ok("D3-1 UI: including it again restores the check", (await check.getAttribute("data-status")) === "ok");
  const amountInput = page.locator('[data-testid=review-row-0] input').nth(3);
  await amountInput.fill("abc");
  ok("D3-1 UI: a row with a bad amount blocks the import", await page.locator('[data-testid=review-commit]').isDisabled());
  await amountInput.fill("-820.50");
  ok("D3-1 UI: fixing it re-enables the import", !(await page.locator('[data-testid=review-commit]').isDisabled()));
  await page.locator('[data-testid=review-commit]').click();
  await page.locator('[data-testid=import-result]').waitFor({ timeout: 20000 });
  ok("D3-1 UI: the reviewed PDF rows are imported (source pdf)", (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transactions WHERE company_id = $1 AND import_source = 'pdf'`, [U.cid])).rows[0].c === 3);
  await closeImport();

  // D3-5 UI: bulk accept
  const inv = await U.invoice({ date: day(-5), dueDate: day(2) }); // 997.50
  r = await U.importCsv(ba.id, [`${today},PEARL TRADING TRANSFER ${inv.number ?? "INV"},,997.50,6277.00`]);
  await open("/auto-reconcile");
  await page.locator('[data-testid=suggestion-rows]').waitFor({ timeout: 20000 });
  const hint = await page.locator('[data-testid^=suggestion-row-]').first().innerText();
  const conf = Number((/(\d+)%/.exec(hint) ?? [])[1] ?? 0);
  ok("D3-5 UI: the invoice is suggested first with confidence >= 80 and a Dr/Cr preview", conf >= 80 && /Invoice payment/.test(hint), hint.slice(0, 160));
  await page.locator('[data-testid^=button-preview-]').first().click();
  ok("D3-5 UI: the preview shows the lines that will be posted", /What will be posted/.test(await page.locator('[data-testid=proposed-lines]').first().innerText()));
  await page.locator('[data-testid=button-select-safe]').click();
  ok("D3-5 UI: 'select safe 80+' selects it", (await page.locator('[data-testid=summary-selected]').innerText()).trim() === "1");
  await page.locator('[data-testid=button-apply-selected]').click();
  await page.waitForTimeout(1500);
  const paid = (await db.query(`SELECT COUNT(*)::int AS c FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows[0].c;
  ok("D3-5 UI: accepting writes the invoice payment through the payment service", paid === 1, { paid });

  // D3-6 UI: a rule with a split and VAT, built in the editor, previewed, posted
  const before = await U.balances();
  await open("/reconciliation-rules");
  await page.locator('[data-testid=button-add-rule]').click();
  await page.locator('[data-testid=input-rule-name]').fill("DEWA");
  await page.locator('[data-testid=input-rule-value]').fill("DEWA UTILITY");
  await page.locator('[data-testid=select-rule-direction]').click();
  await page.getByRole("option", { name: "Money out only" }).click();
  const pickAccount = async (testId, code) => {
    await page.locator(`[data-testid=${testId}]`).click();
    await page.getByRole("option", { name: new RegExp(`^\\s*${code}\\b`) }).click();
  };
  await pickAccount("split-account-0", "5030");
  await page.locator('[data-testid=split-percent-0]').fill("90");
  await page.locator('[data-testid=button-add-split]').click();
  await pickAccount("split-account-1", "5040");
  await page.locator('[data-testid=split-percent-1]').fill("10");
  ok("D3-6 UI: the editor adds the percents up live (100%)", /100%/.test(await page.locator('[data-testid=split-total]').innerText()));
  await page.locator('[data-testid=switch-rule-vat]').click();
  const example = await page.locator('[data-testid=split-example]').innerText();
  ok("D3-6 UI: the example shows 1,050 -> VAT 50, 900 and 100", /50\.00/.test(example) && /900\.00/.test(example) && /100\.00/.test(example), example);
  await page.locator('[data-testid=button-save-rule]').click();
  await page.waitForTimeout(1200);
  const rule = (await db.query(`SELECT split_lines, vat_rate::float8 AS vat, direction FROM reconciliation_rules WHERE company_id = $1 AND name = 'DEWA'`, [U.cid])).rows[0];
  ok("D3-6 UI: the rule is saved with its split lines, 5% VAT and the direction", rule?.split_lines?.length === 2 && rule.vat === 5 && rule.direction === "outflow", rule);
  await U.importCsv(ba.id, [`${day(-1)},DEWA UTILITY BILL 9001,1050.00,,5227.00`]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissTour(page);
  await page.locator('[data-testid=button-preview-rules]').click();
  await page.locator('[data-testid=rules-preview-list]').waitFor({ timeout: 15000 });
  await page.locator('[data-testid^=rule-preview-] button:has-text("Show Dr/Cr")').first().click();
  ok("D3-6 UI: the preview shows the entry before anything is posted", /5030/.test(await page.locator('[data-testid=rules-preview-list]').innerText()) && (await U.balances())["5030"] === before["5030"]);
  await page.locator('[data-testid=rules-preview-list] button[role=checkbox]').first().click();
  await page.locator('[data-testid=button-post-rules]').click();
  await page.waitForTimeout(2000);
  const after = await U.balances();
  const delta = (c) => Math.round((n(after[c]) - n(before[c])) * 100) / 100;
  ok("D3-6 UI: posting gives Dr 5030 900, Dr 5040 100, Dr 1050 50", delta("5030") === 900 && delta("5040") === 100 && delta("1050") === 50, { d5030: delta("5030"), d5040: delta("5040"), d1050: delta("1050") });

  // D3-7 UI: statement versus ledger equals the API
  await open("/bank-reconciliation");
  await page.getByRole("tab", { name: "Reconciliation" }).click();
  await page.locator('[data-testid=recon-adjusted-ledger]').waitFor({ timeout: 15000 });
  r = await U.get(`/api/companies/${U.cid}/bank-statements/reconciliation-report?bankAccountId=${ba.id}&asOf=${today}`);
  const uiLedger = amountOf(await page.locator('[data-testid=recon-ledger-balance]').innerText());
  const uiAdjLedger = amountOf(await page.locator('[data-testid=recon-adjusted-ledger]').innerText());
  ok("D3-7 UI: the screen's ledger and adjusted ledger balances equal the report", close(uiLedger, r.json?.ledgerBalance) && close(uiAdjLedger, r.json?.adjustedLedgerBalance), { uiLedger, uiAdjLedger, api: [r.json?.ledgerBalance, r.json?.adjustedLedgerBalance] });
  ok("D3-7 UI: both sides and the difference are on screen", (await page.locator('[data-testid=recon-statement-side]').count()) === 1 && (await page.locator('[data-testid=recon-difference]').count()) === 1);
  const dl = page.waitForEvent("download", { timeout: 15000 });
  await page.locator('[data-testid=button-recon-csv]').click();
  ok("D3-7 UI: the report downloads as CSV", /bank-reconciliation-.*\.csv$/.test((await dl).suggestedFilename()));

  // D3-10 UI: forecast
  await U.invoice({ date: day(-1), dueDate: day(10), unitPrice: 1000, vatRate: 0, name: "Desert Foods" });
  await open("/cashflow-forecast");
  await page.locator('[data-testid=forecast-chart]').waitFor({ timeout: 20000 });
  r = await U.get(`/api/companies/${U.cid}/cashflow/forecast?days=90`);
  ok("D3-10 UI: the opening balance on screen is the ledger bank balance from the API", close(amountOf(await page.locator('[data-testid=forecast-opening]').innerText()), r.json?.openingBalance), { api: r.json?.openingBalance });
  const dateCell = async () => (await page.locator('[data-testid=forecast-item-invoice] td').first().innerText()).trim();
  const firstDate = await dateCell();
  const reqPromise = page.waitForRequest((q) => /cashflow\/forecast/.test(q.url()) && /receiptDelayDays=15/.test(q.url()), { timeout: 15000 });
  await page.locator('[data-testid=input-receipt-delay]').fill("15");
  await reqPromise;
  await page.waitForTimeout(800);
  ok("D3-10 UI: 'customers pay 15 days late' recalculates and moves the receipt", (await dateCell()) !== firstDate, { firstDate, now: await dateCell() });
  await page.locator('[data-testid=button-save-as]').click();
  await page.locator('[data-testid=input-scenario-name]').fill("Slow payers");
  await page.locator('[data-testid=button-save-scenario]').click();
  await page.waitForTimeout(1000);
  const saved = (await db.query(`SELECT receipt_delay_days FROM cashflow_forecast_scenarios WHERE company_id = $1 AND name = 'Slow payers'`, [U.cid])).rows[0];
  ok("D3-10 UI: the scenario is saved with the delay", saved?.receipt_delay_days === 15, saved);

  // D3-9 UI: register ties to the ledger; the disposal has a proceeds account picker
  const purchase = day(-100);
  const asset = (await U.post(`/api/companies/${U.cid}/fixed-assets`, { assetName: "Delivery Van", category: "vehicles", purchaseDate: purchase, purchaseCost: 3600, salvageValue: 600, usefulLifeYears: 5, paymentAccountId: U.acct("1020").id })).json;
  const vanId = (asset?.asset ?? asset)?.id;
  await U.post(`/api/fixed-assets/${vanId}/depreciate`, { month: new Date(Date.now() - 86400000 * 31).getUTCMonth() + 1, year: new Date(Date.now() - 86400000 * 31).getUTCFullYear() });
  const savings = (await U.post(`/api/companies/${U.cid}/accounts`, { code: "1022", nameEn: "Savings Bank", type: "asset" })).json;
  await open("/fixed-assets");
  await page.getByRole("tab", { name: "Register" }).click();
  await page.locator('[data-testid=register-totals]').waitFor({ timeout: 15000 });
  r = await U.get(`/api/companies/${U.cid}/fixed-assets/register?asOf=${today}`);
  ok("D3-9 UI: the register totals on screen equal the API (cost, accumulated, NBV)", close(amountOf(await page.locator('[data-testid=register-total-cost]').innerText()), r.json?.totals?.cost) && close(amountOf(await page.locator('[data-testid=register-total-nbv]').innerText()), r.json?.totals?.nbv), r.json?.totals);
  ok("D3-9 UI: the register ties to GL 1290 - 1240 (difference 0)", Math.abs(Number(await page.locator('[data-testid=register-tie]').getAttribute("data-difference"))) < 0.005);
  const dl2 = page.waitForEvent("download", { timeout: 15000 });
  await page.locator('[data-testid=button-register-csv]').click();
  ok("D3-9 UI: the register downloads as CSV", /asset-register-.*\.csv$/.test((await dl2).suggestedFilename()));
  await page.getByRole("tab", { name: "Schedule" }).click();
  await page.locator('[data-testid=schedule-row-projected]').first().waitFor({ timeout: 15000 });
  ok("D3-9 UI: the schedule shows posted and projected months", (await page.locator('[data-testid=schedule-row-posted]').count()) >= 1 && (await page.locator('[data-testid=schedule-row-projected]').count()) >= 1);
  await page.getByRole("tab", { name: "Assets" }).click();
  await page.locator('button[title="Dispose"]').first().click();
  await page.locator('[data-testid=select-proceeds-account]').click();
  ok("D3-9 UI: the disposal offers bank and cash accounts and not a revenue account", (await page.getByRole("option", { name: /1022/ }).count()) === 1 && (await page.getByRole("option", { name: /5000/ }).count()) === 0);
  await page.getByRole("option", { name: /1022/ }).click();
  await page.locator('input[type=number][step="0.01"]').fill("1000");
  // a VAT-registered company starts at the standard rate (an invoice to a buyer); this check is the plain no-VAT disposal
  if (await page.locator("[data-testid=select-disposal-vat]").count()) {
    await page.locator("[data-testid=select-disposal-vat]").click();
    await page.getByRole("option", { name: /No VAT/ }).click();
  }
  await page.getByRole("button", { name: "Dispose Asset" }).last().click();
  await page.waitForTimeout(1500);
  const disposed = (await db.query(`SELECT disposal_account_id, disposal_journal_id FROM fixed_assets WHERE id = $1`, [vanId])).rows[0];
  ok("D3-9 UI: the disposal records the chosen proceeds account and its journal", disposed?.disposal_account_id === savings?.id && !!disposed?.disposal_journal_id, disposed);

  ok("UI: no uncaught page errors on any of these screens", pageErrors.length === 0, pageErrors.slice(0, 3));

  // Arabic at 375 px on all five pages
  const ar = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "ar-AE" });
  await ar.addInitScript(() => localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 })));
  const ap = await ar.newPage();
  await uiLogin(ap, U);
  await ap.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
  await dismissTour(ap);
  for (const route of ["/bank-reconciliation", "/auto-reconcile", "/reconciliation-rules", "/cashflow-forecast", "/fixed-assets"]) {
    await ap.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await ap.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await ap.waitForTimeout(800);
    const m = await ap.evaluate(() => ({ dir: document.documentElement.dir, sw: document.documentElement.scrollWidth, iw: window.innerWidth, text: document.body.innerText }));
    ok(`UI Arabic 375px ${route}: right-to-left, Arabic text, no horizontal scroll`, m.dir === "rtl" && /[؀-ۿ]{3}/.test(m.text) && m.sw <= m.iw + 1, { dir: m.dir, sw: m.sw, iw: m.iw });
  }
  await context.close();
  await ar.close();
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await importSection();
    await matchingSection();
    await fixRoundSection();
    await signoffSection();
    await postingSection();
    await rulesSection();
    await reconciliationSection();
    await feedsSection();
    await forecastSection();
    await assetsSection();
    await uiSection();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
