// Integration tests for Phase 4 (compliance): live requests against a running server + Postgres.
//   4.1  VAT filing with evidence (snapshot, drift, evidence, period lock, payments, amendment)
//   4.2  corporate tax filing evidence
//   4.3  FTA Audit File export
//   4.4  opening balances and year-end close
//   4.5  e-invoice XML endpoints are covered by unit tests; only the validation gate is exercised here
//   BASE_URL=http://localhost:5056 DATABASE_URL=... node tests/integration/phase4.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";
import { createHash } from "node:crypto";

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
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;

// ── calendar helpers (UTC, the way the server stores period bounds) ───────────
const ymd = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const today = ymd(now);
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevStart = prevEnd.slice(0, 8) + "01";
const prevMid = prevEnd.slice(0, 8) + "15";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n" + "ack".repeat(400));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

let db;

async function newCompany(label, { vat = true } = {}) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  if (vat) await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accounts = async () => (await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  const account = async (code) => (await accounts()).find((a) => a.code === code);
  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = Math.round(n(row.net) * 100) / 100;
    return out;
  };
  const invoice = async (date, unitPrice, extra = {}) => {
    const r1 = await api("POST", `/api/companies/${cid}/invoices`, {
      token, body: { customerName: "Filing Co", date, dueDate: date, lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 0.05 }], ...extra },
    });
    if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 200));
    const r2 = await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token, body: { status: "sent" } });
    if (r2.status !== 200) throw new Error("issue failed " + r2.status + " " + r2.text.slice(0, 200));
    return r1.json;
  };
  const bill = async (date, unitPrice) => {
    const r1 = await api("POST", `/api/companies/${cid}/bills`, {
      token, body: { vendor_name: "Supplier", bill_date: date, due_date: date, currency: "AED", line_items: [{ description: "Goods", quantity: 1, unit_price: unitPrice, vat_rate: 0.05 }] },
    });
    const id = r1.json?.id;
    if (!id) throw new Error("bill failed " + r1.status + " " + r1.text.slice(0, 200));
    const r2 = await api("POST", `/api/bills/${id}/approve`, { token, body: {} });
    if (![200, 201].includes(r2.status)) throw new Error("bill approve failed " + r2.status + " " + r2.text.slice(0, 200));
    return id;
  };
  const generate = async (start = prevStart, end = prevEnd) => {
    const g = await api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: start, periodEnd: end } });
    return g;
  };
  return { token, cid, userId, account, accounts, balances, invoice, bill, generate };
}

const upload = (buf, name, type) => ({ fileName: name, mimeType: type, fileData: buf.toString("base64") });

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await section41();
    await section42();
    await section43();
    await section44();
    await section45();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4.1 VAT filing with evidence
// ═════════════════════════════════════════════════════════════════════════════
async function section41() {
  // ── A: full cycle on a CLOSED period (last month) ──────────────────────────
  const A = await newCompany("vatA");
  await A.invoice(prevMid, 1000);            // VAT 50
  await A.invoice(prevMid, 500);             // VAT 25
  await A.bill(prevMid, 400);                // input VAT 20
  const gen = await A.generate();
  ok("4.1: generate a return for last month (201)", gen.status === 201 && !!gen.json?.id, { s: gen.status, t: gen.text.slice(0, 200) });
  const rid = gen.json?.id;
  ok("4.1: boxes: output VAT 75, input VAT 20, payable 55",
    close(gen.json?.box12TotalDueTax, 75) && close(gen.json?.box13RecoverableTax, 20) && close(gen.json?.box14PayableTax, 55),
    { b12: gen.json?.box12TotalDueTax, b13: gen.json?.box13RecoverableTax, b14: gen.json?.box14PayableTax });

  // status cannot be forged through PATCH
  let r = await api("PATCH", `/api/vat-returns/${rid}`, { token: A.token, body: { status: "filed" } });
  ok("4.1: PATCH status=filed is refused (409 VAT_FILING_REQUIRES_RECORD)", r.status === 409 && r.json?.code === "VAT_FILING_REQUIRES_RECORD", { s: r.status, j: r.json });
  r = await api("POST", `/api/vat-returns/${rid}/submit`, { token: A.token, body: { notes: "review" } });
  ok("4.1: submit without a reference finalises only (submitted)", r.status === 200 && r.json?.status === "submitted", { s: r.status, j: r.json?.status });

  // validation of the filing record
  const fileUrl = `/api/vat-returns/${rid}/file`;
  r = await api("POST", fileUrl, { token: A.token, body: { filedAt: today } });
  ok("4.1: filing without a reference -> 400 FTA_REFERENCE_REQUIRED", r.status === 400 && r.json?.code === "FTA_REFERENCE_REQUIRED", { s: r.status, j: r.json });
  r = await api("POST", fileUrl, { token: A.token, body: { ftaReferenceNumber: "R-1" } });
  ok("4.1: filing without a date -> 400 FILED_AT_REQUIRED", r.status === 400 && r.json?.code === "FILED_AT_REQUIRED", { s: r.status, j: r.json });
  const tomorrow = ymd(new Date(now.getTime() + 2 * 86400000));
  r = await api("POST", fileUrl, { token: A.token, body: { ftaReferenceNumber: "R-1", filedAt: tomorrow } });
  ok("4.1: a future filing date -> 422 FILED_AT_IN_FUTURE", r.status === 422 && r.json?.code === "FILED_AT_IN_FUTURE", { s: r.status, j: r.json });
  const beforeEnd = ymd(new Date(Date.parse(prevEnd) - 3 * 86400000));
  r = await api("POST", fileUrl, { token: A.token, body: { ftaReferenceNumber: "R-1", filedAt: beforeEnd } });
  ok("4.1: a date before the period end -> 422 FILED_AT_BEFORE_PERIOD_END", r.status === 422 && r.json?.code === "FILED_AT_BEFORE_PERIOD_END", { s: r.status, j: r.json });
  r = await api("POST", fileUrl, { token: A.token, body: { ftaReferenceNumber: "R-1", filedAt: today, evidence: upload(Buffer.from("<html>x</html>"), "ack.pdf", "application/pdf") } });
  ok("4.1: a fake PDF acknowledgement is refused and nothing is filed", r.status === 400, { s: r.status, j: r.json });
  const stillNotFiled = (await db.query("SELECT status FROM vat_returns WHERE id = $1", [rid])).rows[0];
  ok("4.1: the return is still not filed after the refused attempts", stillNotFiled.status === "submitted", stillNotFiled);

  // record the filing with an acknowledgement
  const ref = `FTA-${rnd}-2026`;
  r = await api("POST", fileUrl, { token: A.token, body: { ftaReferenceNumber: ref, filedAt: today, notes: "filed on EmaraTax", evidence: upload(PDF, "ack.pdf", "application/pdf") } });
  ok("4.1: record filing with reference + date + PDF acknowledgement -> 201", r.status === 201 && r.json?.filing?.referenceNumber === ref, { s: r.status, t: r.text.slice(0, 300) });
  ok("4.1: response states Muhasib did not transmit it", r.json?.transmittedByMuhasib === false, r.json?.transmittedByMuhasib);
  const hash = r.json?.filing?.snapshotHash;
  ok("4.1: a 64-char SHA-256 snapshot hash is returned", /^[0-9a-f]{64}$/.test(hash ?? ""), hash);

  const filingRow = (await db.query("SELECT * FROM tax_filings WHERE return_id = $1", [rid])).rows[0];
  ok("4.1: snapshot stored with every box and matches the hash", filingRow && filingRow.snapshot_hash === hash && n(filingRow.snapshot?.boxes?.box14PayableTax) === 55 && n(filingRow.snapshot?.boxes?.box1bDubaiAmount) === 1500, filingRow?.snapshot?.boxes);
  const canon = (v) => JSON.stringify(sortKeys(v));
  function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])); return v; }
  ok("4.1: the hash is the SHA-256 of the canonical snapshot JSON", sha256(canon(filingRow.snapshot)) === hash, { stored: hash, recomputed: sha256(canon(filingRow.snapshot)) });
  const filedMeta = (await db.query("SELECT to_char(f.filed_at,'YYYY-MM-DD') AS d, f.filed_by, r.status, r.fta_reference_number FROM tax_filings f JOIN vat_returns r ON r.id = f.return_id WHERE f.return_id = $1", [rid])).rows[0];
  ok("4.1: filed_by, filed date, reference and status recorded", filedMeta.filed_by === A.userId && filedMeta.d === today && filedMeta.status === "filed" && filedMeta.fta_reference_number === ref, filedMeta);

  let tampered = null;
  try { await db.query("UPDATE tax_filings SET snapshot = '{}'::jsonb WHERE return_id = $1", [rid]); } catch (e) { tampered = e.message; }
  ok("4.1: the stored snapshot cannot be rewritten (database refuses)", /immutable/i.test(tampered ?? ""), tampered);

  r = await api("POST", fileUrl, { token: A.token, body: { ftaReferenceNumber: "AGAIN", filedAt: today } });
  ok("4.1: filing the same return twice -> 409", r.status === 409 && r.json?.code === "VAT_RETURN_ALREADY_FILED", { s: r.status, j: r.json });
  r = await api("POST", `/api/vat-returns/${rid}/submit`, { token: A.token, body: { notes: "again" } });
  ok("4.1: re-submitting a filed return -> 409", r.status === 409, { s: r.status, j: r.json });

  // period lock: every month of the period, posting refused
  const locks = (await db.query("SELECT to_char(period_end,'YYYY-MM-DD') AS pe, status FROM month_end_close WHERE company_id = $1", [A.cid])).rows;
  ok("4.1: the month of the period is locked by the filing", locks.some((l) => l.pe === prevEnd && l.status === "locked"), locks);
  const bank = await A.account("1020");
  const rev = await A.account("4010");
  r = await api("POST", `/api/companies/${A.cid}/journal`, {
    token: A.token, body: { date: prevMid, memo: "backdated", status: "posted", confirmBackdated: true, lines: [{ accountId: bank.id, debit: 10, credit: 0 }, { accountId: rev.id, debit: 0, credit: 10 }] },
  });
  ok("4.1: posting a journal into the filed period is refused (403)", r.status === 403, { s: r.status, j: r.json });

  // clearing journal
  const clearing = (await db.query(
    `SELECT je.id, to_char(je.date,'YYYY-MM-DD') AS d, je.status FROM journal_entries je WHERE je.company_id = $1 AND je.source = 'vat_filing' AND je.source_id = $2`, [A.cid, rid])).rows;
  ok("4.1: exactly one clearing entry linked to the return (source vat_filing)", clearing.length === 1 && clearing[0].status === "posted" && clearing[0].d === today, clearing);
  const clearLines = (await db.query(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`, [clearing[0]?.id])).rows;
  const lineNet = (code) => clearLines.filter((l) => l.code === code).reduce((s, l) => s + n(l.debit) - n(l.credit), 0);
  ok("4.1: clearing entry: Dr output VAT 75, Cr input VAT 20, Cr FTA control 55",
    close(lineNet("2020"), 75) && close(lineNet("1050"), -20) && close(lineNet("2025"), -55), clearLines);
  ok("4.1: clearing entry balances to the fils", close(clearLines.reduce((s, l) => s + n(l.debit), 0), clearLines.reduce((s, l) => s + n(l.credit), 0), 0.0001), clearLines);

  // evidence: view, download, second file, tenant isolation
  const O = await newCompany("vatOther");
  let view = await api("GET", `/api/vat-returns/${rid}`, { token: A.token });
  ok("4.1: detail shows filed, reference, one evidence file and the period locked",
    view.status === 200 && view.json?.filed === true && view.json?.filing?.referenceNumber === ref && view.json?.evidence?.length === 1 && view.json?.period?.locked === true,
    { s: view.status, ev: view.json?.evidence?.length, locked: view.json?.period?.locked });
  const ev1 = view.json?.evidence?.[0];
  let dl = await api("GET", `/api/vat-returns/${rid}/evidence/${ev1?.id}/download`, { token: A.token, raw: true });
  ok("4.1: owner downloads the acknowledgement byte-identical", dl.status === 200 && dl.buf.equals(PDF), { s: dl.status, len: dl.buf.length });
  ok("4.1: download is an attachment, private, no-store", /attachment/.test(dl.headers.get("content-disposition") || "") && /no-store/.test(dl.headers.get("cache-control") || ""), [...dl.headers.entries()]);
  r = await api("POST", `/api/vat-returns/${rid}/evidence`, { token: A.token, body: upload(PNG, "screenshot.png", "image/png") });
  ok("4.1: a second evidence file (PNG) can be added", r.status === 201 && !!r.json?.id, { s: r.status, j: r.json });
  const ev2 = r.json;
  r = await api("POST", `/api/vat-returns/${rid}/evidence`, { token: A.token, body: upload(Buffer.from("a,b\n1,2\n"), "x.csv", "text/csv") });
  ok("4.1: a CSV is not accepted as an acknowledgement (400)", r.status === 400, { s: r.status, j: r.json });
  const dl2 = await api("GET", `/api/vat-returns/${rid}/evidence/${ev2?.id}/download`, { token: A.token, raw: true });
  ok("4.1: the second file downloads byte-identical", dl2.status === 200 && dl2.buf.equals(PNG), { s: dl2.status });

  // another company's user: cannot read the return, its evidence, download, file, pay, amend
  const iso = [
    ["read the return", await api("GET", `/api/vat-returns/${rid}`, { token: O.token })],
    ["download evidence", await api("GET", `/api/vat-returns/${rid}/evidence/${ev1?.id}/download`, { token: O.token })],
    ["add evidence", await api("POST", `/api/vat-returns/${rid}/evidence`, { token: O.token, body: upload(PDF, "x.pdf", "application/pdf") })],
    ["record a payment", await api("POST", `/api/vat-returns/${rid}/payments`, { token: O.token, body: { amount: 1, accountId: (await O.account("1020")).id } })],
    ["amend", await api("POST", `/api/vat-returns/${rid}/amend`, { token: O.token })],
    ["remove evidence", await api("DELETE", `/api/vat-returns/${rid}/evidence/${ev1?.id}`, { token: O.token, body: { reason: "not yours" } })],
  ];
  for (const [what, res] of iso) ok(`4.1: another company's user cannot ${what} (403)`, res.status === 403, { s: res.status });
  const anonDl = await api("GET", `/api/vat-returns/${rid}/evidence/${ev1?.id}/download`);
  ok("4.1: anonymous download is refused (401)", anonDl.status === 401, anonDl.status);
  const listO = await api("GET", `/api/companies/${A.cid}/vat-returns`, { token: O.token });
  ok("4.1: another company's user cannot list this company's returns (403)", listO.status === 403, listO.status);

  // removal: only owner/accountant, reason mandatory, audit-logged, row retained
  const emp = await newCompany("vatEmp", { vat: false });
  await db.query("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'employee')", [A.cid, emp.userId]);
  const empLogin = { json: { token: emp.token } };
  if (empLogin.json?.token) {
    r = await api("DELETE", `/api/vat-returns/${rid}/evidence/${ev2?.id}`, { token: empLogin.json.token, body: { reason: "employee tries to remove" } });
    ok("4.1: an employee cannot remove evidence (403)", r.status === 403, { s: r.status, j: r.json });
    r = await api("POST", `/api/vat-returns/${rid}/payments`, { token: empLogin.json.token, body: { amount: 1, accountId: bank.id } });
    ok("4.1: an employee cannot record a payment (403)", r.status === 403, { s: r.status, j: r.json });
  } else {
    ok("4.1: employee login (test setup)", false, { s: empLogin.status, t: empLogin.text?.slice(0, 120) });
  }
  r = await api("DELETE", `/api/vat-returns/${rid}/evidence/${ev2?.id}`, { token: A.token, body: {} });
  ok("4.1: removal without a reason -> 400 REASON_REQUIRED", r.status === 400 && r.json?.code === "REASON_REQUIRED", { s: r.status, j: r.json });
  r = await api("DELETE", `/api/vat-returns/${rid}/evidence/${ev2?.id}`, { token: A.token, body: { reason: "duplicate screenshot" } });
  ok("4.1: the owner removes an evidence file with a reason", r.status === 200 && r.json?.retained === true, { s: r.status, j: r.json });
  const kept = (await db.query("SELECT removed_at, removed_by, removed_reason, storage_key FROM tax_filing_evidence WHERE id = $1", [ev2?.id])).rows[0];
  ok("4.1: the evidence row is retained (soft removal: who, when, why)", kept && kept.removed_at && kept.removed_by === A.userId && kept.removed_reason === "duplicate screenshot", kept);
  const storedStill = (await db.query("SELECT 1 FROM stored_files WHERE storage_key = $1", [kept?.storage_key])).rowCount;
  ok("4.1: the stored file itself is kept (5-year retention)", storedStill === 1, storedStill);
  const gone = await api("GET", `/api/vat-returns/${rid}/evidence/${ev2?.id}/download`, { token: A.token });
  ok("4.1: a removed file no longer downloads (404)", gone.status === 404, gone.status);
  const audit = (await db.query("SELECT details FROM audit_logs WHERE resource_type = 'tax_filing' AND action = 'tax_filing.evidence_remove' AND details LIKE $1", [`%${ev2?.id}%`])).rows;
  ok("4.1: the removal is audit-logged with the reason", audit.length === 1 && /duplicate screenshot/.test(audit[0].details), audit);

  // ── payments on the filed return: partial, over, wrong account, settled, 409 ─
  const payUrl = `/api/vat-returns/${rid}/payments`;
  r = await api("POST", payUrl, { token: A.token, body: { amount: 20, date: today, accountId: bank.id, reference: "TRF-1" } });
  ok("4.1: partial payment of 20 recorded (201, partial, 35 remaining)", r.status === 201 && r.json?.settlement?.status === "partial" && close(r.json?.settlement?.remaining, 35), { s: r.status, j: r.json });
  r = await api("POST", payUrl, { token: A.token, body: { amount: 40, date: today, accountId: bank.id } });
  ok("4.1: paying more than the balance -> 422 PAYMENT_EXCEEDS_BALANCE", r.status === 422 && r.json?.code === "PAYMENT_EXCEEDS_BALANCE", { s: r.status, j: r.json });
  r = await api("POST", payUrl, { token: A.token, body: { amount: 5, date: today, accountId: rev.id } });
  ok("4.1: a non-asset account is refused (422 ACCOUNT_NOT_ASSET)", r.status === 422 && r.json?.code === "ACCOUNT_NOT_ASSET", { s: r.status, j: r.json });
  r = await api("POST", payUrl, { token: A.token, body: { amount: 5, date: today, accountId: (await O.account("1020")).id } });
  ok("4.1: another company's account is refused (404)", r.status === 404, { s: r.status, j: r.json });
  r = await api("POST", payUrl, { token: A.token, body: { amount: 5, date: tomorrow, accountId: bank.id } });
  ok("4.1: a future payment date is refused (422)", r.status === 422, { s: r.status, j: r.json });
  r = await api("POST", payUrl, { token: A.token, body: { amount: 5, date: prevMid, accountId: bank.id } });
  ok("4.1: a payment dated inside the locked period is refused (403)", r.status === 403, { s: r.status, j: r.json });
  r = await api("POST", payUrl, { token: A.token, body: { amount: 0, date: today, accountId: bank.id } });
  ok("4.1: a zero amount is refused (400)", r.status === 400, { s: r.status, j: r.json });
  r = await api("POST", payUrl, { token: A.token, body: { amount: 35, date: today, accountId: bank.id, reference: "TRF-2" } });
  ok("4.1: the remaining 35 settles the return (status paid)", r.status === 201 && r.json?.settlement?.status === "paid" && close(r.json?.settlement?.remaining, 0), { s: r.status, j: r.json });
  r = await api("POST", payUrl, { token: A.token, body: { amount: 1, date: today, accountId: bank.id } });
  ok("4.1: a payment after full settlement -> 409 ALREADY_SETTLED", r.status === 409 && r.json?.code === "ALREADY_SETTLED", { s: r.status, j: r.json });
  const pays = (await db.query(`SELECT p.amount, p.journal_entry_id, je.source, je.source_id FROM tax_filing_payments p JOIN journal_entries je ON je.id = p.journal_entry_id WHERE p.company_id = $1`, [A.cid])).rows;
  ok("4.1: two payments, each with a journal linked to the return (source vat_payment)", pays.length === 2 && pays.every((p) => p.source === "vat_payment" && p.source_id === rid), pays);
  const unbalanced = (await db.query(
    `SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id WHERE je.company_id = $1 GROUP BY je.id HAVING ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.0001`, [A.cid])).rows;
  ok("4.1: every journal of the company balances to the fils", unbalanced.length === 0, unbalanced);
  const balA = await A.balances();
  ok("4.1: VAT output, input and FTA control accounts net to zero after filing + full payment",
    close(balA["2020"] ?? 0, 0) && close(balA["1050"] ?? 0, 0) && close(balA["2025"] ?? 0, 0), { out: balA["2020"], in: balA["1050"], ctl: balA["2025"] });
  ok("4.1: the bank shows the 55 paid", close(balA["1020"], -55), balA["1020"]);
  const legacy = (await db.query("SELECT payment_status, payment_amount FROM vat_returns WHERE id = $1", [rid])).rows[0];
  ok("4.1: legacy payment columns mirror the payments (paid, 55)", legacy.payment_status === "paid" && close(legacy.payment_amount, 55), legacy);

  // ── B: drift after an authorised unlock, then the amendment ─────────────────
  const B = await newCompany("vatB");
  await B.invoice(prevMid, 1000);
  await B.invoice(prevMid, 500);
  await B.bill(prevMid, 400);
  const genB = await B.generate();
  const ridB = genB.json?.id;
  r = await api("POST", `/api/vat-returns/${ridB}/file`, { token: B.token, body: { ftaReferenceNumber: `FTA-B-${rnd}`, filedAt: today, evidence: upload(PDF, "ack.pdf", "application/pdf") } });
  ok("4.1 drift: return B filed", r.status === 201, { s: r.status, t: r.text.slice(0, 200) });
  const noDrift = await api("GET", `/api/vat-returns/${ridB}`, { token: B.token });
  ok("4.1 drift: right after filing there is no drift", noDrift.json?.driftDetected === false && noDrift.json?.driftDifferences?.length === 0, { d: noDrift.json?.driftDetected, diffs: noDrift.json?.driftDifferences });
  r = await api("POST", `/api/vat-returns/${ridB}/amend`, { token: B.token });
  ok("4.1 amend: nothing to amend while the books equal the filing -> 422 NO_DIFFERENCE", r.status === 422 && r.json?.code === "NO_DIFFERENCE", { s: r.status, j: r.json });

  // unlock needs the firm-owner permission AND a reason
  r = await api("POST", "/api/period-lock/unlock", { token: B.token, body: { companyId: B.cid, period: prevEnd.slice(0, 7), reason: "customer sent a missed invoice" } });
  ok("4.1 unlock: a plain company owner cannot unlock (403 existing permission)", r.status === 403, { s: r.status, j: r.json });
  await db.query("UPDATE users SET firm_role = 'firm_owner' WHERE id = $1", [B.userId]);
  r = await api("POST", "/api/period-lock/unlock", { token: B.token, body: { companyId: B.cid, period: prevEnd.slice(0, 7) } });
  ok("4.1 unlock: unlocking a filed period without a reason -> 400 UNLOCK_REASON_REQUIRED", r.status === 400 && r.json?.code === "UNLOCK_REASON_REQUIRED", { s: r.status, j: r.json });
  r = await api("POST", "/api/period-lock/unlock", { token: B.token, body: { companyId: B.cid, period: prevEnd.slice(0, 7), reason: "short" } });
  ok("4.1 unlock: a token reason is refused too", r.status === 400 && r.json?.code === "UNLOCK_REASON_REQUIRED", { s: r.status, j: r.json });
  r = await api("POST", "/api/period-lock/unlock", { token: B.token, body: { companyId: B.cid, period: prevEnd.slice(0, 7), reason: "customer sent a missed invoice for August" } });
  ok("4.1 unlock: with the permission and a reason the month unlocks", r.status === 200, { s: r.status, j: r.json });
  const unlockAudit = (await db.query("SELECT details FROM audit_logs WHERE action = 'period.unlock' AND details LIKE $1", [`%${B.cid}%`])).rows;
  ok("4.1 unlock: the audit log carries the reason and the filed return", unlockAudit.length === 1 && /missed invoice for August/.test(unlockAudit[0].details) && new RegExp(`FTA-B-${rnd}`).test(unlockAudit[0].details), unlockAudit);

  await B.invoice(prevMid, 500);              // +25 output VAT after filing
  const drift = await api("GET", `/api/vat-returns/${ridB}`, { token: B.token });
  ok("4.1 drift: the filed return still shows the ORIGINAL figures (output 75, payable 55)",
    close(drift.json?.return?.box12TotalDueTax, 75) && close(drift.json?.return?.box14PayableTax, 55) && close(drift.json?.return?.box1bDubaiAmount, 1500), drift.json?.return && { b12: drift.json.return.box12TotalDueTax, b14: drift.json.return.box14PayableTax });
  const diffBoxes = (drift.json?.driftDifferences ?? []).map((d) => d.box).sort();
  ok("4.1 drift: driftDetected is true with per-box differences (+25 VAT, +500 net)",
    drift.json?.driftDetected === true && (drift.json?.driftDifferences ?? []).find((d) => d.box === "box14PayableTax" && close(d.difference, 25) && close(d.filed, 55) && close(d.current, 80)) && diffBoxes.includes("box1bDubaiAmount"),
    { d: drift.json?.driftDetected, diffs: drift.json?.driftDifferences });
  const listB = await api("GET", `/api/companies/${B.cid}/vat-returns`, { token: B.token });
  const listedB = (listB.json ?? []).find((x) => x.id === ridB);
  ok("4.1 drift: the list also serves the snapshot figures, not the live ones", listedB && close(listedB.box14PayableTax, 55) && listedB.filing?.referenceNumber === `FTA-B-${rnd}`, listedB && { b14: listedB.box14PayableTax });
  const regen = await B.generate();
  ok("4.1 drift: regenerating over a filed return is refused (409)", regen.status === 409, { s: regen.status, j: regen.json });

  // amendment
  r = await api("POST", `/api/vat-returns/${ridB}/amend`, { token: B.token });
  ok("4.1 amend: creates a linked amendment (201)", r.status === 201 && r.json?.amendment?.isAmendment === true && r.json?.amendment?.amendsReturnId === ridB, { s: r.status, j: r.json && Object.keys(r.json) });
  const amendId = r.json?.amendment?.id;
  const amendDiffBoxes = (r.json?.differences ?? []).map((d) => d.box).sort();
  ok("4.1 amend: it shows only the difference (output side +25, no input-side box)",
    amendDiffBoxes.length > 0 && amendDiffBoxes.every((b) => !/^box(9|10|11|13)/.test(b) || false) && (r.json?.differences ?? []).find((d) => d.box === "box12TotalDueTax" && close(d.difference, 25)),
    r.json?.differences);
  const dup = await api("POST", `/api/vat-returns/${ridB}/amend`, { token: B.token });
  ok("4.1 amend: a second amendment while one is open -> 409 AMENDMENT_IN_PROGRESS", dup.status === 409 && dup.json?.code === "AMENDMENT_IN_PROGRESS", { s: dup.status, j: dup.json });
  const origView = await api("GET", `/api/vat-returns/${ridB}`, { token: B.token });
  ok("4.1 amend: the original stays filed and immutable and shows 'amended by'", origView.json?.return?.status === "filed" && origView.json?.amendedBy?.some((a) => a.id === amendId) && close(origView.json?.return?.box14PayableTax, 55), { st: origView.json?.return?.status, by: origView.json?.amendedBy });
  const patchFiled = await api("PATCH", `/api/vat-returns/${ridB}`, { token: B.token, body: { box8TotalVat: 1 } });
  ok("4.1 amend: a filed return cannot be edited (409 VAT_RETURN_LOCKED)", patchFiled.status === 409 && patchFiled.json?.code === "VAT_RETURN_LOCKED", { s: patchFiled.status, j: patchFiled.json });
  const amendView = await api("GET", `/api/vat-returns/${amendId}`, { token: B.token });
  ok("4.1 amend: the amendment view lists the differences against the original", amendView.json?.amendsReference === `FTA-B-${rnd}` && amendView.json?.amendmentDifferences?.length > 0, { ref: amendView.json?.amendsReference, n: amendView.json?.amendmentDifferences?.length });
  r = await api("POST", `/api/vat-returns/${amendId}/file`, { token: B.token, body: { ftaReferenceNumber: `FTA-B-AMD-${rnd}`, filedAt: today, evidence: upload(PDF, "amend-ack.pdf", "application/pdf") } });
  ok("4.1 amend: the amendment has its own filing record + evidence", r.status === 201 && r.json?.view?.evidence?.length === 1, { s: r.status, t: r.text.slice(0, 200) });
  const amFiling = (await db.query("SELECT settlement_net, settlement_output, settlement_input, base_filing_id, snapshot FROM tax_filings WHERE return_id = $1", [amendId])).rows[0];
  ok("4.1 amend: it settles only the DIFFERENCE (net 25, output 25, input 0)", amFiling && close(amFiling.settlement_net, 25) && close(amFiling.settlement_output, 25) && close(amFiling.settlement_input, 0) && !!amFiling.base_filing_id, amFiling);
  ok("4.1 amend: the amendment snapshot carries the frozen differences", Array.isArray(amFiling?.snapshot?.amendment?.differences) && amFiling.snapshot.amendment.differences.length > 0, amFiling?.snapshot?.amendment);
  const relocked = (await db.query("SELECT status FROM month_end_close WHERE company_id = $1 AND period_end = $2::date", [B.cid, prevEnd])).rows[0];
  ok("4.1 amend: filing the amendment re-locks the period", relocked?.status === "locked", relocked);
  const bank2 = await B.account("1020");
  r = await api("POST", `/api/vat-returns/${amendId}/payments`, { token: B.token, body: { amount: 25, date: today, accountId: bank2.id } });
  ok("4.1 amend: the difference (25) is paid against the amendment", r.status === 201 && r.json?.settlement?.status === "paid", { s: r.status, j: r.json });
  r = await api("POST", `/api/vat-returns/${amendId}/payments`, { token: B.token, body: { amount: 1, date: today, accountId: bank2.id } });
  ok("4.1 amend: a further payment -> 409", r.status === 409, { s: r.status, j: r.json });
  r = await api("POST", `/api/vat-returns/${ridB}/payments`, { token: B.token, body: { amount: 55, date: today, accountId: bank2.id } });
  ok("4.1 amend: the original's own 55 is still payable separately", r.status === 201 && r.json?.settlement?.status === "paid", { s: r.status, j: r.json });
  const balB = await B.balances();
  ok("4.1 amend: VAT accounts net to zero after original + amendment are filed and paid",
    close(balB["2020"] ?? 0, 0) && close(balB["1050"] ?? 0, 0) && close(balB["2025"] ?? 0, 0), { out: balB["2020"], in: balB["1050"], ctl: balB["2025"] });
  const afterAmend = await api("GET", `/api/vat-returns/${amendId}`, { token: B.token });
  ok("4.1 amend: after the amendment is filed there is no drift left on it", afterAmend.json?.driftDetected === false, afterAmend.json?.driftDifferences);

  // ── D: refundable return (input VAT only) and payment before filing ─────────
  const D = await newCompany("vatD");
  await D.bill(prevMid, 400);                 // input 20, no sales
  const genD = await D.generate();
  const ridD = genD.json?.id;
  const bankD = await D.account("1020");
  r = await api("POST", `/api/vat-returns/${ridD}/payments`, { token: D.token, body: { amount: 20, date: today, accountId: bankD.id } });
  ok("4.1 refund: a payment before the return is filed -> 409 VAT_RETURN_NOT_FILED", r.status === 409 && r.json?.code === "VAT_RETURN_NOT_FILED", { s: r.status, j: r.json });
  ok("4.1 refund: the return is refundable (box 14 = -20)", close(genD.json?.box14PayableTax, -20), genD.json?.box14PayableTax);
  r = await api("POST", `/api/vat-returns/${ridD}/file`, { token: D.token, body: { ftaReferenceNumber: `FTA-D-${rnd}`, filedAt: today } });
  ok("4.1 refund: filing without an acknowledgement is allowed (attach later)", r.status === 201 && r.json?.view?.evidence?.length === 0, { s: r.status });
  r = await api("POST", `/api/vat-returns/${ridD}/evidence`, { token: D.token, body: upload(PDF, "late.pdf", "application/pdf") });
  ok("4.1 refund: the acknowledgement can be attached afterwards", r.status === 201, { s: r.status, j: r.json });
  r = await api("POST", `/api/vat-returns/${ridD}/payments`, { token: D.token, body: { amount: 20, date: today, accountId: bankD.id, reference: "REFUND" } });
  ok("4.1 refund: receiving the refund settles the return", r.status === 201 && r.json?.settlement?.direction === "receive" && r.json?.settlement?.status === "paid", { s: r.status, j: r.json });
  const balD = await D.balances();
  ok("4.1 refund: input VAT and FTA control are 0, bank shows +20", close(balD["1050"] ?? 0, 0) && close(balD["2025"] ?? 0, 0) && close(balD["1020"], 20), balD);

  // ── legacy /submit with a reference goes through the same filing record ─────
  const L = await newCompany("vatL");
  await L.invoice(prevMid, 200);
  const genL = await L.generate();
  r = await api("POST", `/api/vat-returns/${genL.json?.id}/submit`, { token: L.token, body: { ftaReferenceNumber: "LEGACY-1" } });
  ok("4.1 legacy: /submit with a reference but no filing date -> 400 FILED_AT_REQUIRED", r.status === 400 && r.json?.code === "FILED_AT_REQUIRED", { s: r.status, j: r.json });
  r = await api("POST", `/api/vat-returns/${genL.json?.id}/submit`, { token: L.token, body: { ftaReferenceNumber: "LEGACY-1", filedAt: today } });
  ok("4.1 legacy: /submit with reference + date records a real filing (filed, snapshot, locked)",
    r.status === 200 && r.json?.status === "filed" && !!r.json?.filing?.snapshotHash && (await db.query("SELECT 1 FROM month_end_close WHERE company_id = $1 AND status = 'locked'", [L.cid])).rowCount === 1, { s: r.status, j: r.json?.status });
}

// ═════════════════════════════════════════════════════════════════════════════
// 4.2 Corporate tax filing evidence
// ═════════════════════════════════════════════════════════════════════════════
async function section42() {
  const yr = now.getUTCFullYear() - 1;
  const period = { taxPeriodStart: `${yr}-01-01`, taxPeriodEnd: `${yr}-12-31` };
  const C = await newCompany("ctC", { vat: false });
  const ctBase = `/api/corporate-tax/returns`;

  let r = await api("POST", `/api/companies/${C.cid}/corporate-tax/returns`, {
    token: C.token, body: { ...period, totalRevenue: 900000, totalExpenses: 400000, totalDeductions: 0, status: "filed", filedAt: new Date().toISOString(), isAmendment: true },
  });
  const ctId = r.json?.id;
  ok("4.2: create a corporate tax return; a client cannot create it already filed or as an amendment",
    r.status === 201 && r.json?.status === "draft" && !r.json?.filedAt && r.json?.isAmendment === false, { s: r.status, j: r.json });
  r = await api("POST", `${ctBase}/${ctId}/compute`, { token: C.token, body: {} });
  const tax = n(r.json?.return?.taxPayable);
  ok("4.2: compute gives 9% above the AED 375,000 band (11,250)", r.status === 200 && close(tax, 11250), { s: r.status, tax });

  r = await api("PATCH", `${ctBase}/${ctId}`, { token: C.token, body: { status: "filed" } });
  ok("4.2: PATCH status=filed is refused (409 CT_FILING_REQUIRES_RECORD)", r.status === 409 && r.json?.code === "CT_FILING_REQUIRES_RECORD", { s: r.status, j: r.json });

  // the accounts are in the default chart; a company whose chart lacks them (an older one) gets them
  // created from the default template at filing time instead of a 422 (phase 4 review, defect 2)
  const fileUrl = `${ctBase}/${ctId}/file`;
  r = await api("POST", fileUrl, { token: C.token, body: { ftaReferenceNumber: "CT-1" } });
  ok("4.2: filing without a date -> 400 FILED_AT_REQUIRED", r.status === 400 && r.json?.code === "FILED_AT_REQUIRED", { s: r.status, j: r.json });
  await db.query("DELETE FROM accounts WHERE company_id = $1 AND code IN ('5150', '2060')", [C.cid]);

  r = await api("POST", fileUrl, { token: C.token, body: { ftaReferenceNumber: `CT-${rnd}`, filedAt: today, notes: "filed on EmaraTax", evidence: upload(PDF, "ct-ack.pdf", "application/pdf") } });
  ok("4.2: record the corporate tax filing (reference + date + acknowledgement) -> 201", r.status === 201 && /^[0-9a-f]{64}$/.test(r.json?.filing?.snapshotHash ?? ""), { s: r.status, t: r.text.slice(0, 300) });
  const made = (await db.query("SELECT code, type FROM accounts WHERE company_id = $1 AND code IN ('5150', '2060') ORDER BY code", [C.cid])).rows;
  ok("4.2: the missing Corporate Tax accounts were created on demand (2060 liability, 5150 expense)", made.length === 2 && made[0].type === "liability" && made[1].type === "expense", made);
  const cf = (await db.query("SELECT * FROM tax_filings WHERE return_id = $1", [ctId])).rows[0];
  ok("4.2: snapshot stored (tax payable 11,250, revenue 900,000) with the workpaper hash", cf && close(cf.snapshot?.boxes?.taxPayable, 11250) && close(cf.snapshot?.boxes?.totalRevenue, 900000) && /^[0-9a-f]{64}$/.test(cf.snapshot?.workpaperHash ?? ""), cf?.snapshot);
  const acc = (await db.query(`SELECT a.code, jl.debit, jl.credit, je.source, je.source_id FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.source = 'corporate_tax_filing'`, [C.cid])).rows;
  ok("4.2: filing accrued Dr Corporate Tax Expense / Cr Corporate Tax Payable 11,250, linked to the return",
    acc.length === 2 && close(acc.find((l) => l.code === "5150")?.debit, 11250) && close(acc.find((l) => l.code === "2060")?.credit, 11250) && acc.every((l) => l.source_id === ctId), acc);
  r = await api("POST", fileUrl, { token: C.token, body: { ftaReferenceNumber: "AGAIN", filedAt: today } });
  ok("4.2: filing twice -> 409", r.status === 409 && r.json?.code === "CT_RETURN_ALREADY_FILED", { s: r.status, j: r.json });

  // immutability
  r = await api("PATCH", `${ctBase}/${ctId}`, { token: C.token, body: { totalRevenue: 1 } });
  ok("4.2: a filed return cannot be edited (409 CT_RETURN_LOCKED)", r.status === 409 && r.json?.code === "CT_RETURN_LOCKED", { s: r.status, j: r.json });
  r = await api("PATCH", `${ctBase}/${ctId}`, { token: C.token, body: { notes: "note only" } });
  ok("4.2: notes on a filed return still save", r.status === 200, { s: r.status, j: r.json });
  r = await api("POST", `${ctBase}/${ctId}/compute`, { token: C.token, body: {} });
  ok("4.2: a filed return cannot be recomputed (400)", r.status === 400, { s: r.status });
  const detail = await api("GET", `${ctBase}/${ctId}/filing`, { token: C.token });
  ok("4.2: detail view: filed, one evidence file, snapshot figures", detail.status === 200 && detail.json?.filed === true && detail.json?.evidence?.length === 1 && close(detail.json?.return?.taxPayable, 11250), { s: detail.status, j: detail.json && Object.keys(detail.json) });
  const list = await api("GET", `/api/companies/${C.cid}/corporate-tax/returns`, { token: C.token });
  ok("4.2: the list shows the filing reference on the filed return", (list.json ?? []).find((x) => x.id === ctId)?.filing?.referenceNumber === `CT-${rnd}`, list.json?.[0]);

  // evidence + isolation
  const ev = detail.json?.evidence?.[0];
  const dl = await api("GET", `${ctBase}/${ctId}/evidence/${ev?.id}/download`, { token: C.token, raw: true });
  ok("4.2: evidence downloads byte-identical", dl.status === 200 && dl.buf.equals(PDF), { s: dl.status });
  const X = await newCompany("ctX", { vat: false });
  const iso = [
    ["read the filing", await api("GET", `${ctBase}/${ctId}/filing`, { token: X.token })],
    ["download evidence", await api("GET", `${ctBase}/${ctId}/evidence/${ev?.id}/download`, { token: X.token })],
    ["add evidence", await api("POST", `${ctBase}/${ctId}/evidence`, { token: X.token, body: upload(PDF, "a.pdf", "application/pdf") })],
    ["record payment", await api("POST", `${ctBase}/${ctId}/payments`, { token: X.token, body: { amount: 1, accountId: (await X.account("1020")).id } })],
    ["amend", await api("POST", `${ctBase}/${ctId}/amend`, { token: X.token })],
  ];
  for (const [what, res] of iso) ok(`4.2: another company's user cannot ${what} (403)`, res.status === 403, { s: res.status });
  r = await api("POST", `${ctBase}/${ctId}/evidence`, { token: C.token, body: upload(PNG, "shot.png", "image/png") });
  ok("4.2: a second evidence file can be added", r.status === 201, { s: r.status, j: r.json });
  const ev2 = r.json;
  r = await api("DELETE", `${ctBase}/${ctId}/evidence/${ev2?.id}`, { token: C.token, body: { reason: "wrong screenshot" } });
  ok("4.2: evidence removal is a reasoned, audit-logged soft removal", r.status === 200 && (await db.query("SELECT 1 FROM tax_filing_evidence WHERE id = $1 AND removed_at IS NOT NULL", [ev2?.id])).rowCount === 1, { s: r.status, j: r.json });

  // payments: Dr CT payable / Cr bank
  const bank = await C.account("1020");
  const pay = `${ctBase}/${ctId}/payments`;
  r = await api("POST", pay, { token: C.token, body: { amount: 5000, date: today, accountId: bank.id, reference: "CT-TRF-1" } });
  ok("4.2: partial payment 5,000 (partial, 6,250 remaining)", r.status === 201 && r.json?.settlement?.status === "partial" && close(r.json?.settlement?.remaining, 6250), { s: r.status, j: r.json });
  r = await api("POST", pay, { token: C.token, body: { amount: 7000, date: today, accountId: bank.id } });
  ok("4.2: overpaying -> 422", r.status === 422 && r.json?.code === "PAYMENT_EXCEEDS_BALANCE", { s: r.status, j: r.json });
  r = await api("POST", pay, { token: C.token, body: { amount: 6250, date: today, accountId: bank.id } });
  ok("4.2: the rest settles it", r.status === 201 && r.json?.settlement?.status === "paid", { s: r.status, j: r.json });
  r = await api("POST", pay, { token: C.token, body: { amount: 1, date: today, accountId: bank.id } });
  ok("4.2: a further payment -> 409 ALREADY_SETTLED", r.status === 409 && r.json?.code === "ALREADY_SETTLED", { s: r.status, j: r.json });
  const balC = await C.balances();
  ok("4.2: Corporate Tax Payable nets to 0, expense 11,250, bank -11,250", close(balC["2060"] ?? 0, 0) && close(balC["5150"], 11250) && close(balC["1020"], -11250), balC);
  ok("4.2: the return is marked paid", (await db.query("SELECT status FROM corporate_tax_returns WHERE id = $1", [ctId])).rows[0].status === "paid", null);

  // amendment: a linked new record that accrues only the difference
  r = await api("POST", `${ctBase}/${ctId}/amend`, { token: C.token });
  ok("4.2: amendment creates a linked draft copy", r.status === 201 && r.json?.amendment?.isAmendment === true && r.json?.amendment?.amendsReturnId === ctId && r.json?.amendment?.status === "draft", { s: r.status, j: r.json });
  const amdId = r.json?.amendment?.id;
  r = await api("POST", `${ctBase}/${amdId}/file`, { token: C.token, body: { ftaReferenceNumber: "CT-AMD-0", filedAt: today } });
  ok("4.2: an unchanged amendment cannot be filed (422 NO_DIFFERENCE) and posts nothing", r.status === 422 && r.json?.code === "NO_DIFFERENCE", { s: r.status, j: r.json });
  r = await api("PATCH", `${ctBase}/${amdId}`, { token: C.token, body: { totalExpenses: 300000 } });
  ok("4.2: the amendment draft can be edited", r.status === 200, { s: r.status, j: r.json });
  r = await api("POST", `${ctBase}/${amdId}/compute`, { token: C.token, body: {} });
  ok("4.2: the amendment recomputes to 20,250", r.status === 200 && close(r.json?.return?.taxPayable, 20250), { s: r.status, tax: r.json?.return?.taxPayable });
  r = await api("POST", `${ctBase}/${amdId}/file`, { token: C.token, body: { ftaReferenceNumber: `CT-AMD-${rnd}`, filedAt: today, evidence: upload(PDF, "amd.pdf", "application/pdf") } });
  ok("4.2: the amendment is filed with its own reference and evidence", r.status === 201 && r.json?.view?.evidence?.length === 1, { s: r.status, t: r.text.slice(0, 200) });
  const amf = (await db.query("SELECT settlement_net, base_filing_id FROM tax_filings WHERE return_id = $1", [amdId])).rows[0];
  ok("4.2: it settles only the difference (9,000)", close(amf?.settlement_net, 9000) && !!amf?.base_filing_id, amf);
  r = await api("POST", `${ctBase}/${amdId}/payments`, { token: C.token, body: { amount: 9000, date: today, accountId: bank.id } });
  ok("4.2: the 9,000 difference is paid", r.status === 201 && r.json?.settlement?.status === "paid", { s: r.status, j: r.json });
  const origAfter = await api("GET", `${ctBase}/${ctId}/filing`, { token: C.token });
  ok("4.2: the original keeps its figures and shows 'amended by'", close(origAfter.json?.return?.taxPayable, 11250) && origAfter.json?.amendedBy?.some((a) => a.id === amdId), origAfter.json?.amendedBy);
  const balC2 = await C.balances();
  ok("4.2: Corporate Tax Payable still nets to 0 and expense totals 20,250", close(balC2["2060"] ?? 0, 0) && close(balC2["5150"], 20250), balC2);

  // drift: only meaningful for a return derived from the books
  const E = await newCompany("ctE", { vat: false });
  await E.invoice(`${yr}-06-15`, 1000);
  r = await api("POST", `/api/companies/${E.cid}/corporate-tax/returns`, { token: E.token, body: { ...period } });
  const eId = r.json?.id;
  r = await api("POST", `${ctBase}/${eId}/pull-from-books`, { token: E.token, body: {} });
  ok("4.2 drift: pull from the books (revenue 1,000)", r.status === 200 && close(r.json?.totalRevenue, 1000), { s: r.status, j: r.json?.totalRevenue });
  r = await api("POST", `${ctBase}/${eId}/file`, { token: E.token, body: { ftaReferenceNumber: `CT-E-${rnd}`, filedAt: today } });
  ok("4.2 drift: a nil-tax return files without any journal (no accounts needed)", r.status === 201 && (await db.query("SELECT count(*) FROM journal_entries WHERE company_id = $1 AND source = 'corporate_tax_filing'", [E.cid])).rows[0].count === "0", { s: r.status, t: r.text.slice(0, 200) });
  await E.invoice(`${yr}-07-01`, 500);
  const de = await api("GET", `${ctBase}/${eId}/filing`, { token: E.token });
  ok("4.2 drift: books changed after filing -> driftDetected with the revenue difference; the filed return still shows 1,000",
    de.json?.driftDetected === true && de.json?.driftDifferences?.some((d) => d.box === "totalRevenue" && close(d.difference, 500)) && close(de.json?.return?.totalRevenue, 1000), { d: de.json?.driftDetected, diffs: de.json?.driftDifferences, rev: de.json?.return?.totalRevenue });
}
// ═════════════════════════════════════════════════════════════════════════════
// 4.3 FTA Audit File
// ═════════════════════════════════════════════════════════════════════════════

/** Minimal RFC-4180 parser for the FAF text (quoted cells, doubled quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; }
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Split the parsed FAF into { blockName: { header, rows, footerHeader, footer } }. */
function fafBlocks(rows) {
  const out = {};
  const starts = { CompInfoStart: "company", PurcDataStart: "purchases", SuppDataStart: "supplies", GLDataStart: "ledger" };
  const ends = { CompInfoEnd: "company", PurcDataEnd: "purchases", SuppDataEnd: "supplies", GLDataEnd: "ledger" };
  let current = null;
  const order = [];
  for (const r of rows) {
    const key = r.length === 1 ? r[0] : null;
    if (key && starts[key]) { current = starts[key]; out[current] = { body: [] }; order.push(current); continue; }
    if (key && ends[key]) { out[current].closed = true; current = null; continue; }
    if (current) out[current].body.push(r);
  }
  for (const [name, b] of Object.entries(out)) {
    b.header = b.body[0];
    if (name === "company") { b.rows = b.body.slice(1); continue; }
    b.footer = b.body[b.body.length - 1];
    b.footerHeader = b.body[b.body.length - 2];
    b.rows = b.body.slice(1, b.body.length - 2);
  }
  out.order = order;
  return out;
}

async function section43() {
  const F = await newCompany("faf");
  const inv = await F.invoice(prevMid, 1000, { customerName: "Al Noor, Trading \"LLC\"" });        // standard, VAT 50
  await F.invoice(prevMid, 500, { customerName: "=1+1 Formula Co" });                                 // formula injection attempt
  await F.invoice(prevMid, 40, { customerName: "شركة النور للتجارة" });
  // zero-rated, exempt and out-of-scope lines
  for (const [type, price] of [["zero_rated", 300], ["exempt", 200], ["out_of_scope", 50]]) {
    const r1 = await api("POST", `/api/companies/${F.cid}/invoices`, { token: F.token, body: { customerName: `Cust ${type}`, date: prevMid, dueDate: prevMid, lines: [{ description: type, quantity: 1, unitPrice: price, vatRate: 0, vatSupplyType: type }] } });
    await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token: F.token, body: { status: "sent" } });
  }
  // a draft and an out-of-period invoice must not appear
  await api("POST", `/api/companies/${F.cid}/invoices`, { token: F.token, body: { customerName: "Draft Only", date: prevMid, lines: [{ description: "draft", quantity: 1, unitPrice: 999, vatRate: 0.05 }] } });
  await F.invoice(today, 777);
  // credit note (negative lines)
  const cn = await api("POST", `/api/companies/${F.cid}/invoices/${inv.id}/credit-note`, { token: F.token, body: { date: prevMid, lines: [{ description: "returned goods", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("4.3: setup: credit note created", cn.status === 201, { s: cn.status, j: cn.json });
  await F.bill(prevMid, 400);                                                                          // input 20
  // USD receipt: 1000 + 50 VAT at 3.6725
  const accs = await F.accounts();
  const exp = accs.find((a) => a.code === "5000"), bank = accs.find((a) => a.code === "1020");
  const rc = await api("POST", `/api/companies/${F.cid}/receipts`, { token: F.token, body: { merchant: "US Supplier", date: prevMid, amount: 1000, vatAmount: 50, currency: "USD", exchangeRate: 3.6725, baseCurrencyAmount: 3672.5, category: "software", accountId: exp.id, paymentAccountId: bank.id } });
  await api("POST", `/api/receipts/${rc.json?.id}/post`, { token: F.token, body: { accountId: exp.id, paymentAccountId: bank.id } });

  // ── access, range and refusal cases ──
  const url = (from, to, cid = F.cid) => `/api/companies/${cid}/reports/fta-audit-file?from=${from}&to=${to}`;
  const other = await newCompany("fafOther");
  let r = await api("GET", url(prevStart, prevEnd), { token: other.token });
  ok("4.3: another company's user is refused (403)", r.status === 403, r.status);
  r = await api("GET", url(prevStart, prevEnd));
  ok("4.3: anonymous request is refused (401)", r.status === 401, r.status);
  r = await api("GET", `/api/companies/${F.cid}/reports/fta-audit-file`, { token: F.token });
  ok("4.3: missing dates -> 400 FAF_RANGE_REQUIRED", r.status === 400 && r.json?.code === "FAF_RANGE_REQUIRED", { s: r.status, j: r.json });
  r = await api("GET", url("2026-13-01", prevEnd), { token: F.token });
  ok("4.3: an impossible date -> 400 FAF_RANGE_INVALID", r.status === 400 && r.json?.code === "FAF_RANGE_INVALID", { s: r.status, j: r.json });
  r = await api("GET", url(prevEnd, prevStart), { token: F.token });
  ok("4.3: from after to -> 400", r.status === 400, r.status);
  r = await api("GET", url("2024-01-01", "2025-12-31"), { token: F.token });
  ok("4.3: more than one financial year -> 400 FAF_RANGE_TOO_LARGE with a clear message", r.status === 400 && r.json?.code === "FAF_RANGE_TOO_LARGE" && /financial year/.test(r.json?.message ?? ""), { s: r.status, j: r.json });
  const noTrn = await newCompany("fafNoTrn", { vat: false });
  r = await api("GET", url(prevStart, prevEnd, noTrn.cid), { token: noTrn.token });
  ok("4.3: a company without a TRN -> 422 NO_TRN", r.status === 422 && r.json?.code === "NO_TRN", { s: r.status, j: r.json });

  // ── the file ──
  const res = await api("GET", url(prevStart, prevEnd), { token: F.token, raw: true });
  ok("4.3: 200 text/csv attachment, never cached", res.status === 200 && /text\/csv/.test(res.headers.get("content-type") || "") && /attachment; filename="FAF_100123456700003_/.test(res.headers.get("content-disposition") || "") && /no-store/.test(res.headers.get("cache-control") || ""), { s: res.status, h: [...res.headers.entries()] });
  const text = res.buf.toString("utf8");
  const blocks = fafBlocks(parseCsv(text));
  ok("4.3: the four blocks appear in order and are all closed", JSON.stringify(blocks.order) === JSON.stringify(["company", "purchases", "supplies", "ledger"]) && ["company", "purchases", "supplies", "ledger"].every((k) => blocks[k]?.closed), blocks.order);
  ok("4.3: company block: name, TRN, period, creation date, product", blocks.company.rows[0]?.[1] === "100123456700003" && blocks.company.rows[0]?.[2] === prevStart && blocks.company.rows[0]?.[3] === prevEnd && blocks.company.rows[0]?.[4] === today && /Muhasib/.test(blocks.company.rows[0]?.[5] ?? ""), blocks.company.rows[0]);
  ok("4.3: headers match the constants module", blocks.supplies.header.join(",") === "CustomerName,CustomerTRN,InvoiceDate,InvoiceNo,LineNo,ProductDescription,SupplyValueAED,VATValueAED,TaxCode,Country,FCYCode,SupplyFCY,VATFCY" && blocks.purchases.header.length === 13 && blocks.ledger.header.length === 11, blocks.supplies.header);

  // supply listing: posted documents only, tax codes, credit note negative, injection-safe
  const supplyRows = blocks.supplies.rows;
  const names = supplyRows.map((x) => x[0]);
  ok("4.3: drafts and other periods are excluded, posted invoices are included", !names.includes("Draft Only") && supplyRows.every((x) => x[2] >= prevStart && x[2] <= prevEnd) && names.includes("Cust zero_rated"), names);
  ok("4.3: a comma-and-quote customer name survives quoting", names.includes('Al Noor, Trading "LLC"'), names);
  ok("4.3: a leading = is neutralised with a single quote (CSV injection)", names.includes("'=1+1 Formula Co") && !names.includes("=1+1 Formula Co"), names);
  ok("4.3: Arabic text is preserved as UTF-8", names.includes("شركة النور للتجارة"), names);
  const codeOf = (custPart) => supplyRows.find((x) => x[0].includes(custPart))?.[8];
  ok("4.3: tax codes SR / ZR / ES / OS", codeOf("Al Noor") === "SR" && codeOf("zero_rated") === "ZR" && codeOf("exempt") === "ES" && codeOf("out_of_scope") === "OS", [codeOf("Al Noor"), codeOf("zero_rated"), codeOf("exempt"), codeOf("out_of_scope")]);
  const creditRows = supplyRows.filter((x) => n(x[6]) < 0);
  ok("4.3: the credit note is a negative line (-100.00 net, -5.00 VAT)", creditRows.length === 1 && close(creditRows[0][6], -100) && close(creditRows[0][7], -5), creditRows);
  ok("4.3: amounts are 2dp", supplyRows.every((x) => /^-?\d+\.\d{2}$/.test(x[6]) && /^-?\d+\.\d{2}$/.test(x[7])), supplyRows.slice(0, 2));

  // purchases: foreign currency shows AED at the booked rate and the foreign amounts
  const usd = blocks.purchases.rows.find((x) => x[10] === "USD");
  ok("4.3: the USD receipt shows AED 3,672.50 / 183.63 and USD 1,000.00 / 50.00", usd && close(usd[7], 3672.5) && close(usd[8], 183.63) && close(usd[11], 1000) && close(usd[12], 50), usd);

  // ties to the VAT 201 for the same period
  const gen = await F.generate();
  const box = gen.json;
  const sfoot = blocks.supplies.footer, pfoot = blocks.purchases.footer, gfoot = blocks.ledger.footer;
  const osTotal = supplyRows.filter((x) => x[8] === "OS").reduce((sum, x) => sum + n(x[6]), 0);
  const stdBoxes = n(box.box1aAbuDhabiAmount) + n(box.box1bDubaiAmount) + n(box.box1cSharjahAmount) + n(box.box1dAjmanAmount) + n(box.box1eUmmAlQuwainAmount) + n(box.box1fRasAlKhaimahAmount) + n(box.box1gFujairahAmount);
  const stdVatBoxes = n(box.box1aAbuDhabiVat) + n(box.box1bDubaiVat) + n(box.box1cSharjahVat) + n(box.box1dAjmanVat) + n(box.box1eUmmAlQuwainVat) + n(box.box1fRasAlKhaimahVat) + n(box.box1gFujairahVat);
  ok("4.3: supply value total ties to VAT 201 boxes 1 + 4 + 5 (plus the out-of-scope line no box takes)", close(n(sfoot[0]) - osTotal, stdBoxes + n(box.box4ZeroRatedAmount) + n(box.box5ExemptAmount), 0.02), { faf: sfoot[0], os: osTotal, boxes: stdBoxes + n(box.box4ZeroRatedAmount) + n(box.box5ExemptAmount) });
  ok("4.3: supply VAT total ties to the standard-rated output VAT in Box 1", close(sfoot[1], stdVatBoxes, 0.02), { faf: sfoot[1], box: stdVatBoxes });
  ok("4.3: purchase value total ties to Box 9 expenses (bill + USD receipt at AED)", close(pfoot[0], n(box.box9ExpensesAmount), 0.02) && close(pfoot[0], 400 + 3672.5, 0.02), { faf: pfoot[0], box9: box.box9ExpensesAmount });
  ok("4.3: purchase VAT total ties to Box 9 input VAT", close(pfoot[1], n(box.box9ExpensesVat), 0.02) && close(pfoot[1], 20 + 183.63, 0.02), { faf: pfoot[1], box9: box.box9ExpensesVat });
  ok("4.3: footers carry the line counts", n(sfoot[2]) === supplyRows.length && n(pfoot[2]) === blocks.purchases.rows.length, { s: sfoot, p: pfoot });

  // general ledger
  const glRows = blocks.ledger.rows;
  ok("4.3: general ledger totals balance (debit = credit)", close(gfoot[0], gfoot[1], 0.005) && gfoot[3] === "AED", gfoot);
  const dbCount = (await db.query(`SELECT count(*) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1 AND je.status = 'posted' AND je.date >= $2::date AND je.date < ($3::date + 1)`, [F.cid, prevStart, prevEnd])).rows[0].count;
  ok("4.3: GL line count equals the posted journal lines of the period", n(gfoot[2]) === glRows.length && glRows.length === n(dbCount) && glRows.length > 0, { footer: gfoot[2], rows: glRows.length, db: dbCount });
  ok("4.3: GL footer debit total equals the sum of the rows", close(glRows.reduce((sum, x) => sum + n(x[8]), 0), gfoot[0], 0.02), { sum: glRows.reduce((sum, x) => sum + n(x[8]), 0), footer: gfoot[0] });
  const ar = glRows.filter((x) => x[1] === "1040");
  let running = 0, runningOk = ar.length > 0;
  for (const x of ar) { running += n(x[8]) - n(x[9]); if (!close(running, x[10], 0.02)) runningOk = false; }
  ok("4.3: running balance per account is correct (accounts receivable)", runningOk, ar.slice(0, 3));
  const audit = (await db.query("SELECT details FROM audit_logs WHERE action = 'report.faf_export' AND details LIKE $1", [`%${F.cid}%`])).rows;
  ok("4.3: the export is audit-logged with the period and line counts", audit.length >= 1 && new RegExp(`"supplyLines":${supplyRows.length}`).test(audit[0].details), audit[0]);

  // a second period with no data still yields a complete file with zero footers
  const empty = await api("GET", url("2020-01-01", "2020-01-31"), { token: F.token, raw: true });
  const eb = fafBlocks(parseCsv(empty.buf.toString("utf8")));
  ok("4.3: an empty period gives all four blocks with zero footers", eb.ledger?.closed && eb.supplies.footer[2] === "0" && eb.purchases.footer[2] === "0" && eb.ledger.footer[2] === "0", eb.ledger?.footer);
}
// ═════════════════════════════════════════════════════════════════════════════
// 4.4 Opening balances and year-end close
// ═════════════════════════════════════════════════════════════════════════════
const dayMinus1 = (d) => ymd(new Date(Date.parse(d + "T00:00:00Z") - 86400000));

async function section44() {
  const yr = now.getUTCFullYear() - 1;                 // a fully ended calendar year
  const firstTx = `${yr}-01-15`;
  const suggested = `${yr}-01-14`;
  const ob = (cid) => `/api/companies/${cid}/opening-balances`;
  const glRows = async (cid) => (await db.query(
    `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows.reduce((o, r) => ({ ...o, [r.code]: Math.round(n(r.net) * 100) / 100 }), {});

  // ── opening balances ──
  const O = await newCompany("open");
  await O.invoice(firstTx, 1000);                      // the first real transaction: 1000 + VAT 50
  let r = await api("GET", ob(O.cid), { token: O.token });
  ok("4.4a: overview shows no opening balances, the first transaction and the suggested date (the day before)",
    r.status === 200 && r.json?.active === null && r.json?.firstTransactionDate === firstTx && r.json?.suggestedDate === suggested && r.json?.accounts?.some((a) => a.code === "1040"),
    { s: r.status, first: r.json?.firstTransactionDate, sug: r.json?.suggestedDate });

  const pre = (body) => api("POST", ob(O.cid) + "/preview", { token: O.token, body });
  r = await pre({ asOfDate: firstTx, rows: [{ accountCode: "1020", debit: 100, credit: 0 }] });
  ok("4.4a: the opening date must be before the first transaction", !r.json?.ok && r.json?.errors?.some((e) => e.code === "OPENING_DATE_NOT_BEFORE_FIRST_TRANSACTION"), r.json?.errors);
  r = await pre({ asOfDate: "2999-01-01", rows: [{ accountCode: "1020", debit: 100, credit: 0 }] });
  ok("4.4a: a future opening date is refused", r.json?.errors?.some((e) => e.code === "OPENING_DATE_IN_FUTURE"), r.json?.errors);
  r = await pre({ asOfDate: suggested, rows: [{ accountCode: "9999", debit: 1, credit: 0 }, { accountCode: "4010", debit: 5, credit: 0 }, { accountCode: "1020", debit: 5, credit: 5 }] });
  ok("4.4a: unknown account, income account and both-sides rows are each reported with their row",
    ["ACCOUNT_UNKNOWN", "ACCOUNT_NOT_BALANCE_SHEET", "BOTH_SIDES"].every((c) => r.json?.errors?.some((e) => e.code === c && e.row >= 1)), r.json?.errors);
  r = await pre({ asOfDate: suggested, csv: "account code,debit,credit\n1020,5000,0\n1040,abc,0\n2010,0,400\n" });
  ok("4.4a: CSV import reports the bad line (line 3) and still parses the good rows for the preview", r.json?.errors?.some((e) => e.code === "CSV_INVALID" && e.row === 3) && r.json?.parsedRows?.length === 2, r.json);

  const grid = [{ accountCode: "1020", debit: 5000, credit: 0 }, { accountCode: "1040", debit: 1000, credit: 0 }, { accountCode: "2010", debit: 0, credit: 400 }];
  const docs = {
    invoices: [
      { party: "Old Customer A", number: "OB-INV-1", date: `${yr - 1}-11-20`, dueDate: `${yr - 1}-12-20`, amount: 600, currency: "AED" },
      { party: "Old Customer B", number: "OB-INV-2", date: `${yr - 1}-12-10`, amount: 100, currency: "USD", exchangeRate: 4 },
    ],
    bills: [{ party: "Old Vendor", number: "OB-BILL-1", date: `${yr - 1}-12-01`, amount: 400, currency: "AED" }],
  };
  r = await pre({ asOfDate: suggested, rows: grid, invoices: [docs.invoices[0]], bills: docs.bills });
  const tieErr = r.json?.errors?.find((e) => e.code === "AR_DOES_NOT_TIE");
  ok("4.4a: open invoices that do not equal Accounts Receivable are refused, showing BOTH figures",
    !r.json?.ok && tieErr && /1000\.00/.test(tieErr.message) && /600\.00/.test(tieErr.message), r.json?.errors);
  r = await api("POST", ob(O.cid), { token: O.token, body: { asOfDate: suggested, rows: grid, invoices: [docs.invoices[0]], bills: docs.bills } });
  ok("4.4a: posting with a mismatch is refused (422) and posts nothing", r.status === 422 && r.json?.code === "OPENING_BALANCE_INVOICE_INVALID" || r.status === 422, { s: r.status, j: r.json?.code });
  ok("4.4a: nothing was posted by the refused request", (await db.query("SELECT count(*) FROM journal_entries WHERE company_id = $1 AND source = 'opening_balance'", [O.cid])).rows[0].count === "0", null);

  r = await pre({ asOfDate: suggested, rows: grid, ...docs });
  ok("4.4a: the preview of the valid input is ok and shows the balancing amount 5,600 to Opening Balance Equity (credit)",
    r.json?.ok === true && r.json?.totals?.balancingSide === "credit" && close(r.json?.totals?.balancingAmount, 5600) && close(r.json?.totals?.openInvoicesTotal, 1000) && close(r.json?.totals?.openBillsTotal, 400), r.json);

  const revBefore = await glRows(O.cid);
  r = await api("POST", ob(O.cid), { token: O.token, body: { asOfDate: suggested, rows: grid, ...docs } });
  ok("4.4a: post the opening balances -> 201", r.status === 201 && !!r.json?.journalEntryId, { s: r.status, j: r.json });
  const entries = (await db.query("SELECT id, status, to_char(date,'YYYY-MM-DD') AS d, source FROM journal_entries WHERE company_id = $1 AND source = 'opening_balance'", [O.cid])).rows;
  ok("4.4a: exactly ONE journal entry, source opening_balance, dated the opening date", entries.length === 1 && entries[0].d === suggested && entries[0].status === "posted", entries);
  const obLines = (await db.query(`SELECT a.code, a.type, a.name_en, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`, [entries[0].id])).rows;
  ok("4.4a: the entry balances to the fils", close(obLines.reduce((sum, l) => sum + n(l.debit), 0), obLines.reduce((sum, l) => sum + n(l.credit), 0), 0.0001), obLines);
  const eq = obLines.find((l) => l.name_en === "Opening Balance Equity");
  ok("4.4a: 'Opening Balance Equity' was created as an equity account and carries the 5,600 difference", eq && eq.type === "equity" && close(eq.credit, 5600), eq);
  const gl = await glRows(O.cid);
  ok("4.4a: receivables and payables in the ledger equal the entered balances (AR 1,000 + the real sale, AP 400)", close(gl["1040"], 1000 + 1050) && close(gl["2010"], -400), gl);
  ok("4.4a: NO revenue or VAT was posted for the opening documents (revenue 1,000 and VAT 50 are the real invoice only)", close(gl["4010"], -1000) && close(gl["2020"], -50) && !Object.keys(gl).includes("5000"), gl);
  ok("4.4a: the opening bank balance is in the ledger", close(gl["1020"], 5000), gl["1020"]);
  const docsDb = (await db.query("SELECT number, status, vat_amount, total, base_currency_amount, is_opening_balance FROM invoices WHERE company_id = $1 AND is_opening_balance = true ORDER BY number", [O.cid])).rows;
  ok("4.4a: the open invoices exist as posted (sent) documents with no VAT, USD converted at the entered rate",
    docsDb.length === 2 && docsDb.every((d) => d.status === "sent" && n(d.vat_amount) === 0) && close(docsDb[1].base_currency_amount, 400) && close(docsDb[0].total, 600), docsDb);
  const billDb = (await db.query("SELECT bill_number, status, vat_amount, total_amount FROM vendor_bills WHERE company_id = $1 AND is_opening_balance = true", [O.cid])).rows;
  ok("4.4a: the open bill exists as an approved bill with no VAT", billDb.length === 1 && billDb[0].status === "approved" && n(billDb[0].vat_amount) === 0 && close(billDb[0].total_amount, 400), billDb);
  ok("4.4a: the balances before posting had no opening effect (ledger diff is the entry only)", close((gl["1020"] ?? 0) - (revBefore["1020"] ?? 0), 5000), null);

  r = await api("POST", ob(O.cid), { token: O.token, body: { asOfDate: suggested, rows: grid, ...docs } });
  ok("4.4a: a second opening balance -> 409 OPENING_BALANCE_EXISTS", r.status === 409 && r.json?.code === "OPENING_BALANCE_EXISTS", { s: r.status, j: r.json });

  // the opening documents are excluded from VAT 201 and cannot be edited / voided / credited
  const vat = await O.generate(`${yr}-01-01`, `${yr}-01-31`);
  ok("4.4a: the VAT 201 of the opening period counts only the real invoice (net 1,000, VAT 50) and no opening bill",
    vat.status === 201 && close(vat.json?.box1bDubaiAmount, 1000) && close(vat.json?.box1bDubaiVat, 50) && close(vat.json?.box9ExpensesAmount, 0), { s: vat.status, b1: vat.json?.box1bDubaiAmount, b9: vat.json?.box9ExpensesAmount });
  {
    const ap = await api("GET", `/api/vat/autopilot/calculate/${O.cid}?periodStart=${yr}-01-01&periodEnd=${yr}-01-31&frequency=monthly`, { token: O.token });
    const b = ap.json?.boxes || {};
    ok("4.4a: VAT autopilot also ignores opening documents (sales 1,000, output VAT 50, one invoice)",
      ap.status === 200 && close(b.standardRatedSales, 1000) && close(b.totalOutputVat, 50) && close(b.totalExpenses, 0) &&
        ap.json?.invoicesProcessed === 1 && close(ap.json?.vat201?.box1bDubaiAmount, 1000),
      { s: ap.status, sales: b.standardRatedSales, out: b.totalOutputVat, expenses: b.totalExpenses, n: ap.json?.invoicesProcessed });
  }
  {
    // The opening documents are dated in the last quarter of the prior year.
    // A VAT period that CONTAINS those dates must still show nothing for them.
    const prior = await api("GET", `/api/vat/autopilot/calculate/${O.cid}?periodStart=${yr - 1}-10-01&periodEnd=${yr - 1}-12-31&frequency=quarterly`, { token: O.token });
    const pb = prior.json?.boxes || {};
    ok("4.4a: VAT autopilot shows no sales, expenses or VAT for the quarter holding the opening documents",
      prior.status === 200 && close(pb.standardRatedSales, 0) && close(pb.zeroRatedSales, 0) && close(pb.totalExpenses, 0) &&
        close(pb.totalOutputVat, 0) && close(pb.totalInputVat, 0) && prior.json?.invoicesProcessed === 0,
      { s: prior.status, sales: pb.standardRatedSales, zero: pb.zeroRatedSales, expenses: pb.totalExpenses, n: prior.json?.invoicesProcessed });
  }
  const opInv = (await db.query("SELECT id FROM invoices WHERE company_id = $1 AND number = 'OB-INV-1'", [O.cid])).rows[0].id;
  r = await api("PATCH", `/api/invoices/${opInv}/status`, { token: O.token, body: { status: "void" } });
  ok("4.4a: an opening invoice cannot be voided (409 OPENING_BALANCE_INVOICE)", r.status === 409 && r.json?.code === "OPENING_BALANCE_INVOICE", { s: r.status, j: r.json });
  r = await api("POST", `/api/companies/${O.cid}/invoices/${opInv}/credit-note`, { token: O.token, body: {} });
  ok("4.4a: an opening invoice cannot be credited", r.status === 409 && r.json?.code === "OPENING_BALANCE_INVOICE", { s: r.status, j: r.json });
  r = await api("PUT", `/api/invoices/${opInv}`, { token: O.token, body: { customerName: "Changed", lines: [{ description: "x", quantity: 1, unitPrice: 1, vatRate: 0.05 }] } });
  ok("4.4a: an opening invoice cannot be edited", r.status === 409 && r.json?.code === "OPENING_BALANCE_INVOICE", { s: r.status, j: r.json });
  const billId = (await db.query("SELECT id FROM vendor_bills WHERE company_id = $1 AND is_opening_balance = true", [O.cid])).rows[0].id;
  r = await api("PATCH", `/api/bills/${billId}`, { token: O.token, body: { vendor_name: "Changed" } });
  ok("4.4a: an opening bill cannot be edited", r.status === 409 && r.json?.code === "OPENING_BALANCE_BILL", { s: r.status, j: r.json });
  const forged = await api("POST", `/api/companies/${O.cid}/invoices`, { token: O.token, body: { customerName: "Forger", date: today, isOpeningBalance: true, lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.05 }] } });
  const forgedFlag = (await db.query("SELECT is_opening_balance FROM invoices WHERE id = $1", [forged.json?.id])).rows[0];
  ok("4.4a: a client cannot flag its own invoice as an opening balance", forgedFlag && forgedFlag.is_opening_balance === false, forgedFlag);

  // receivables work from day one: a customer pays an opening invoice
  const bank = await O.account("1020");
  r = await api("POST", `/api/companies/${O.cid}/invoices/${opInv}/payments`, { token: O.token, body: { amount: 600, date: today, method: "bank_transfer", paymentAccountId: bank.id } });
  ok("4.4a: an opening invoice can be paid (Dr bank / Cr receivable)", r.status === 201 || r.status === 200, { s: r.status, j: r.json });
  const gl2 = await glRows(O.cid);
  ok("4.4a: receivables fell by 600 and revenue is untouched", close(gl2["1040"], gl["1040"] - 600) && close(gl2["4010"], -1000), gl2);
  r = await api("POST", ob(O.cid) + "/reverse", { token: O.token, body: { reason: "entered in error" } });
  ok("4.4a: opening balances with payments against them cannot be reversed (409 OPENING_BALANCE_IN_USE)", r.status === 409 && r.json?.code === "OPENING_BALANCE_IN_USE", { s: r.status, j: r.json });

  // reverse and re-enter
  const P = await newCompany("openrev");
  await P.invoice(firstTx, 500);
  const gridP = [{ accountCode: "1020", debit: 300, credit: 0 }, { accountCode: "3010", debit: 0, credit: 100 }];
  r = await api("POST", ob(P.cid), { token: P.token, body: { asOfDate: suggested, rows: gridP } });
  ok("4.4a: reversible case: opening balances posted (balancing 200 to equity)", r.status === 201, { s: r.status, j: r.json });
  r = await api("POST", ob(P.cid) + "/reverse", { token: P.token, body: { reason: "x" } });
  ok("4.4a: reversal needs a reason (400)", r.status === 400 && r.json?.code === "REASON_REQUIRED", { s: r.status, j: r.json });
  r = await api("POST", ob(P.cid) + "/reverse", { token: P.token, body: { reason: "wrong bank figure" } });
  ok("4.4a: reversal succeeds while the period is open and nothing depends on it", r.status === 200 && r.json?.reversed === true, { s: r.status, j: r.json });
  const glP = await glRows(P.cid);
  ok("4.4a: after reversal the opening effect is gone (bank and equity back to nothing)", close(glP["1020"] ?? 0, 0) && close(glP["3010"] ?? 0, 0), glP);
  ok("4.4a: reversal is recorded (status reversed, reversing entry linked)", (await db.query("SELECT status FROM opening_balances WHERE company_id = $1", [P.cid])).rows[0].status === "reversed" && (await db.query("SELECT count(*) FROM journal_entries WHERE company_id = $1 AND source = 'opening_balance_reversal' AND reversed_entry_id IS NOT NULL", [P.cid])).rows[0].count === "1", null);
  r = await api("POST", ob(P.cid), { token: P.token, body: { asOfDate: suggested, rows: [{ accountCode: "1020", debit: 350, credit: 0 }] } });
  ok("4.4a: opening balances can be re-entered after a reversal", r.status === 201, { s: r.status, j: r.json });
  const activeCount = (await db.query("SELECT count(*) FROM opening_balances WHERE company_id = $1 AND status = 'active'", [P.cid])).rows[0].count;
  ok("4.4a: only one opening balance is ever active", activeCount === "1", activeCount);

  // blocked by a locked period / a filed VAT return
  const Q = await newCompany("openlock");
  await Q.invoice(firstTx, 100);
  await api("POST", ob(Q.cid), { token: Q.token, body: { asOfDate: suggested, rows: [{ accountCode: "1020", debit: 10, credit: 0 }] } });
  await api("POST", `/api/companies/${Q.cid}/month-end/lock-period`, { token: Q.token, body: { periodEnd: `${yr}-01-31` } });
  r = await api("POST", ob(Q.cid) + "/reverse", { token: Q.token, body: { reason: "period is locked now" } });
  ok("4.4a: reversal in a locked period is refused (403)", r.status === 403, { s: r.status, j: r.json });
  const lockedPost = await api("POST", ob(Q.cid), { token: Q.token, body: { asOfDate: suggested, rows: [{ accountCode: "1020", debit: 10, credit: 0 }] } });
  ok("4.4a: (and a second one is still 409, not silently allowed)", lockedPost.status === 409, lockedPost.status);
  const R = await newCompany("openvat");
  await R.invoice(firstTx, 100);
  const early = `${yr - 1}-12-31`;
  await api("POST", ob(R.cid), { token: R.token, body: { asOfDate: early, rows: [{ accountCode: "1020", debit: 10, credit: 0 }] } });
  const gr = await R.generate(`${yr}-01-01`, `${yr}-01-31`);
  await api("POST", `/api/vat-returns/${gr.json?.id}/file`, { token: R.token, body: { ftaReferenceNumber: `OB-${rnd}`, filedAt: today } });
  r = await api("POST", ob(R.cid) + "/reverse", { token: R.token, body: { reason: "after the VAT filing" } });
  ok("4.4a: reversal after a VAT return was filed for a period on or after the opening date -> 409 OPENING_BALANCE_VAT_FILED", r.status === 409 && r.json?.code === "OPENING_BALANCE_VAT_FILED", { s: r.status, j: r.json });
  const other = await newCompany("openother");
  r = await api("GET", ob(O.cid), { token: other.token });
  ok("4.4a: another company's user cannot read or post opening balances (403)", r.status === 403 && (await api("POST", ob(O.cid), { token: other.token, body: {} })).status === 403, r.status);

  // ── year-end close ──
  const y1 = yr - 1, y2 = yr;                          // two ended calendar years
  const Y = await newCompany("yend");
  await Y.invoice(`${y1}-03-15`, 1000);
  await Y.bill(`${y1}-04-10`, 300);
  await Y.invoice(`${y2}-03-15`, 2000);
  await Y.bill(`${y2}-04-10`, 500);
  const yeUrl = `/api/companies/${Y.cid}/year-end`;
  const pl = async (from, to) => (await api("GET", `/api/companies/${Y.cid}/financial-statements/profit-loss?startDate=${from}&endDate=${to}`, { token: Y.token })).json;
  const bs = async (asOf) => (await api("GET", `/api/companies/${Y.cid}/financial-statements/balance-sheet?asOfDate=${asOf}`, { token: Y.token })).json;
  const eqLine = (sheet, code) => (sheet?.equity?.breakdown ?? []).find((x) => x.accountCode === code);

  r = await api("GET", yeUrl, { token: Y.token });
  const rowOf = (yStart) => r.json?.years?.find((x) => x.yearStart === yStart);
  ok("4.4b: overview lists both ended years as open with their net income (700 and 1,500)", r.status === 200 && rowOf(`${y1}-01-01`)?.status === "open" && close(rowOf(`${y1}-01-01`)?.netIncome, 700) && close(rowOf(`${y2}-01-01`)?.netIncome, 1500) && rowOf(`${y1}-01-01`)?.ended === true, r.json?.years?.map((x) => [x.yearStart, x.status, x.netIncome]));
  const plBefore = await pl(`${y1}-01-01`, `${y1}-12-31`);
  ok("4.4b: before the close the year's P&L is revenue 1,000, expenses 300, profit 700", close(plBefore.revenue, 1000) && close(plBefore.expenses, 300) && close(plBefore.netIncome, 700), plBefore);
  const bsBefore = await bs(`${y1}-12-31`);
  ok("4.4b: before the close the balance sheet rolls the 700 up as accumulated earnings", close(eqLine(bsBefore, "3900")?.amount, 700) && bsBefore.isBalanced === true, bsBefore.equity);

  r = await api("POST", yeUrl + "/close", { token: Y.token, body: { yearStart: `${y1}-02-01` } });
  ok("4.4b: closing a date that is not a year start -> 400", r.status === 400, { s: r.status, j: r.json });
  r = await api("POST", yeUrl + "/close", { token: Y.token, body: { yearStart: `${now.getUTCFullYear()}-01-01` } });
  ok("4.4b: the current (unfinished) year cannot be closed -> 422 YEAR_NOT_ENDED", r.status === 422 && r.json?.code === "YEAR_NOT_ENDED", { s: r.status, j: r.json });
  r = await api("POST", yeUrl + "/close", { token: Y.token, body: { yearStart: `${y1}-01-01` } });
  ok("4.4b: close the first year -> 201", r.status === 201 && !!r.json?.closingEntryId && close(r.json?.netIncome, 700), { s: r.status, j: r.json });
  const closeEntry = (await db.query("SELECT id, to_char(date,'YYYY-MM-DD') AS d, status FROM journal_entries WHERE company_id = $1 AND source = 'year_end_close'", [Y.cid])).rows;
  ok("4.4b: ONE closing entry dated the last day of the year", closeEntry.length === 1 && closeEntry[0].d === `${y1}-12-31` && closeEntry[0].status === "posted", closeEntry);
  const closeLines = (await db.query(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`, [closeEntry[0].id])).rows;
  const cl = (code) => closeLines.filter((l) => l.code === code).reduce((sum, l) => sum + n(l.debit) - n(l.credit), 0);
  ok("4.4b: closing entry: Dr revenue 1,000, Cr expenses 300, Cr retained earnings 700, balanced", close(cl("4010"), 1000) && close(cl("5000"), -300) && close(cl("3020"), -700) && close(closeLines.reduce((sum, l) => sum + n(l.debit), 0), closeLines.reduce((sum, l) => sum + n(l.credit), 0), 0.0001), closeLines);
  const locks = (await db.query("SELECT count(*) FROM month_end_close WHERE company_id = $1 AND status = 'locked' AND period_end >= $2::date AND period_end <= $3::date", [Y.cid, `${y1}-01-01`, `${y1}-12-31`])).rows[0].count;
  ok("4.4b: every month of the closed year is locked (12)", locks === "12", locks);
  r = await api("POST", yeUrl + "/close", { token: Y.token, body: { yearStart: `${y1}-01-01` } });
  ok("4.4b: closing the same year again is idempotent -> 409 YEAR_ALREADY_CLOSED", r.status === 409 && r.json?.code === "YEAR_ALREADY_CLOSED", { s: r.status, j: r.json });
  ok("4.4b: still exactly one closing entry", (await db.query("SELECT count(*) FROM journal_entries WHERE company_id = $1 AND source = 'year_end_close'", [Y.cid])).rows[0].count === "1", null);
  const cash = await Y.account("1020"), rev = await Y.account("4010");
  r = await api("POST", `/api/companies/${Y.cid}/journal`, { token: Y.token, body: { date: `${y1}-06-01`, memo: "late", status: "posted", confirmBackdated: true, lines: [{ accountId: cash.id, debit: 5, credit: 0 }, { accountId: rev.id, debit: 0, credit: 5 }] } });
  ok("4.4b: posting into the closed year is refused (403)", r.status === 403, { s: r.status, j: r.json });

  const glY = await glRows(Y.cid);
  ok("4.4b: revenue and expense accounts are zeroed for the closed year (only the second year's activity remains)", close(glY["4010"], -2000) && close(glY["5000"], 500) && close(glY["3020"], -700), glY);
  const plAfter = await pl(`${y1}-01-01`, `${y1}-12-31`);
  ok("4.4b: the closed year's P&L report is unchanged (the closing entry is left out of it)", close(plAfter.revenue, 1000) && close(plAfter.expenses, 300) && close(plAfter.netIncome, 700), plAfter);
  const plNew = await pl(`${y2}-01-01`, `${y2}-12-31`);
  ok("4.4b: the new year's P&L starts from zero: only its own 2,000 / 500", close(plNew.revenue, 2000) && close(plNew.expenses, 500) && close(plNew.netIncome, 1500), plNew);
  const plOpening = await pl(`${y2}-01-01`, `${y2}-01-01`);
  ok("4.4b: on the first day of the new year the P&L is nil", close(plOpening.revenue, 0) && close(plOpening.expenses, 0), plOpening);
  const bsClosed = await bs(`${y1}-12-31`);
  ok("4.4b: the balance sheet at the year end carries retained earnings (3020 = 700), no roll-up line, and balances", close(eqLine(bsClosed, "3020")?.amount, 700) && !eqLine(bsClosed, "3900") && bsClosed.isBalanced === true && close(bsClosed.equity.total, 700), bsClosed.equity);
  const bsNext = await bs(`${y2}-12-31`);
  ok("4.4b: a year later retained earnings 700 carry forward and the second year's 1,500 accumulates on top (2,200)", close(eqLine(bsNext, "3020")?.amount, 700) && close(eqLine(bsNext, "3900")?.amount, 1500) && close(bsNext.equity.total, 2200) && bsNext.isBalanced === true, bsNext.equity);

  // close the second year too, then the reopen rules
  r = await api("POST", yeUrl + "/close", { token: Y.token, body: { yearStart: `${y2}-01-01` } });
  ok("4.4b: close the second year", r.status === 201, { s: r.status, j: r.json });
  const bsAll = await bs(`${y2}-12-31`);
  ok("4.4b: after both closes retained earnings show 2,200 in one account and the sheet balances", close(eqLine(bsAll, "3020")?.amount, 2200) && !eqLine(bsAll, "3900") && bsAll.isBalanced === true, bsAll.equity);
  const plY2 = await pl(`${y2}-01-01`, `${y2}-12-31`);
  ok("4.4b: the second closed year's P&L still reads 2,000 / 500", close(plY2.revenue, 2000) && close(plY2.expenses, 500), plY2);
  r = await api("POST", yeUrl + "/reopen", { token: Y.token, body: { yearStart: `${y1}-01-01`, reason: "customer needs a correction" } });
  ok("4.4b: reopening needs the unlock permission (403 for a plain owner)", r.status === 403, { s: r.status, j: r.json });
  await db.query("UPDATE users SET firm_role = 'firm_owner' WHERE id = $1", [Y.userId]);
  r = await api("POST", yeUrl + "/reopen", { token: Y.token, body: { yearStart: `${y1}-01-01`, reason: "customer needs a correction" } });
  ok("4.4b: an earlier year cannot be reopened while a later one is closed (409 LATER_YEAR_CLOSED)", r.status === 409 && r.json?.code === "LATER_YEAR_CLOSED", { s: r.status, j: r.json });
  r = await api("POST", yeUrl + "/reopen", { token: Y.token, body: { yearStart: `${y2}-01-01`, reason: "short" } });
  ok("4.4b: a reopen needs a proper reason (400)", r.status === 400 && r.json?.code === "REASON_REQUIRED", { s: r.status, j: r.json });
  r = await api("POST", yeUrl + "/reopen", { token: Y.token, body: { yearStart: `${y2}-01-01`, reason: "adjusting a late supplier invoice" } });
  ok("4.4b: the latest closed year is reopened by an authorised user with a reason", r.status === 200 && r.json?.reopened === true, { s: r.status, j: r.json });
  const rev2 = (await db.query("SELECT count(*) FROM journal_entries WHERE company_id = $1 AND source = 'year_end_close_reversal' AND reversed_entry_id IS NOT NULL", [Y.cid])).rows[0].count;
  ok("4.4b: a reversing entry was posted", rev2 === "1", rev2);
  const locks2 = (await db.query("SELECT count(*) FROM month_end_close WHERE company_id = $1 AND status = 'locked' AND period_end >= $2::date AND period_end <= $3::date", [Y.cid, `${y2}-01-01`, `${y2}-12-31`])).rows[0].count;
  ok("4.4b: the reopened year's months are unlocked", locks2 === "0", locks2);
  const reopenAudit = (await db.query("SELECT details FROM audit_logs WHERE action = 'year_end.reopen' AND details LIKE $1", [`%${Y.cid}%`])).rows;
  ok("4.4b: the reopen is audit-logged with the reason", reopenAudit.length === 1 && /late supplier invoice/.test(reopenAudit[0].details), reopenAudit);
  const bsReopened = await bs(`${y2}-12-31`);
  ok("4.4b: after the reopen the books are as before it (3020 = 700 carried, 1,500 accumulated)", close(eqLine(bsReopened, "3020")?.amount, 700) && close(eqLine(bsReopened, "3900")?.amount, 1500) && bsReopened.isBalanced === true, bsReopened.equity);
  r = await api("POST", yeUrl + "/close", { token: Y.token, body: { yearStart: `${y2}-01-01` } });
  ok("4.4b: the year can be closed again after a reopen", r.status === 201, { s: r.status, j: r.json });

  // blocked by a filed return in a later year; blocked by draft entries
  const Z = await newCompany("yendz");
  await Z.invoice(`${y1}-05-15`, 400);
  await Z.invoice(`${y2}-03-15`, 400);
  await api("POST", `/api/companies/${Z.cid}/year-end/close`, { token: Z.token, body: { yearStart: `${y1}-01-01` } });
  const gz = await Z.generate(`${y2}-03-01`, `${y2}-03-31`);
  await api("POST", `/api/vat-returns/${gz.json?.id}/file`, { token: Z.token, body: { ftaReferenceNumber: `YE-${rnd}`, filedAt: today } });
  await db.query("UPDATE users SET firm_role = 'firm_owner' WHERE id = $1", [Z.userId]);
  r = await api("POST", `/api/companies/${Z.cid}/year-end/reopen`, { token: Z.token, body: { yearStart: `${y1}-01-01`, reason: "we must change last year" } });
  ok("4.4b: a year cannot be reopened once a later year has a filed return (409)", r.status === 409 && r.json?.code === "YEAR_REOPEN_BLOCKED_BY_FILED_RETURN", { s: r.status, j: r.json });
  const W = await newCompany("yendw");
  await W.invoice(`${y1}-05-15`, 100);
  const wCash = await W.account("1020"), wRev = await W.account("4010");
  await api("POST", `/api/companies/${W.cid}/journal`, { token: W.token, body: { date: `${y1}-06-01`, memo: "draft", status: "draft", confirmBackdated: true, lines: [{ accountId: wCash.id, debit: 5, credit: 0 }, { accountId: wRev.id, debit: 0, credit: 5 }] } });
  r = await api("POST", `/api/companies/${W.cid}/year-end/close`, { token: W.token, body: { yearStart: `${y1}-01-01` } });
  ok("4.4b: a year with draft journal entries cannot be closed (409 DRAFT_ENTRIES_EXIST)", r.status === 409 && r.json?.code === "DRAFT_ENTRIES_EXIST", { s: r.status, j: r.json });
  const wo = await api("GET", `/api/companies/${W.cid}/year-end`, { token: W.token });
  ok("4.4b: the overview lists that blocker", wo.json?.years?.find((x) => x.yearStart === `${y1}-01-01`)?.blockers?.some((b) => b.code === "DRAFT_ENTRIES_EXIST"), wo.json?.years?.[1]);
  const foreign = await newCompany("yendother");
  ok("4.4b: another company's user cannot read or close the years (403)", (await api("GET", yeUrl, { token: foreign.token })).status === 403 && (await api("POST", yeUrl + "/close", { token: foreign.token, body: { yearStart: `${y1}-01-01` } })).status === 403, null);
}
// ═════════════════════════════════════════════════════════════════════════════
// 4.5 E-invoice hardening (XML structure is covered by unit tests + golden files;
// here: the validation gate and the generated documents through the real API)
// ═════════════════════════════════════════════════════════════════════════════
async function section45() {
  const E = await newCompany("einv");
  const inv = await E.invoice(prevMid, 1000, { customerName: "Acme Trading LLC", customerTrn: "100765432100003", customerAddress: "Business Bay Tower 3" });

  let r = await api("GET", `/api/invoices/${inv.id}/einvoice/validate`, { token: E.token });
  const issues = r.json?.issues ?? [];
  ok("4.5: the gate reports structured, bilingual issues (seller street and city, buyer city)",
    r.status === 200 && r.json?.valid === false
      && ["SELLER_STREET_MISSING", "SELLER_CITY_MISSING", "BUYER_CITY_MISSING"].every((c) => issues.some((i) => i.code === c))
      && issues.every((i) => i.field && i.entity && /[\u0600-\u06FF]/.test(i.messageAr || "") && i.message),
    { s: r.status, issues });
  r = await api("POST", `/api/invoices/${inv.id}/generate-einvoice`, { token: E.token });
  ok("4.5: generation is refused with the same issues (422 EINVOICE_VALIDATION_FAILED)", r.status === 422 && r.json?.code === "EINVOICE_VALIDATION_FAILED" && r.json?.issues?.length >= 3, { s: r.status, code: r.json?.code });

  // fix the seller profile and the buyer contact, add a bank account with an IBAN
  await api("PATCH", `/api/companies/${E.cid}`, { token: E.token, body: { addressStreet: "Office 12, Sheikh Zayed Road", addressCity: "Dubai", contactEmail: "billing@einv.example", contactPhone: "+97145550100" } });
  const contact = await api("POST", `/api/companies/${E.cid}/customer-contacts`, { token: E.token, body: { name: "Acme Trading LLC", trnNumber: "100765432100003", address: "Business Bay Tower 3", city: "Dubai", country: "UAE" } });
  const contactId = contact.json?.id;
  if (contactId) await db.query("UPDATE invoices SET contact_id = $1 WHERE id = $2", [contactId, inv.id]);
  await db.query("INSERT INTO bank_accounts (company_id, name_en, bank_name, iban, currency, is_active) VALUES ($1, 'Main current', 'Emirates NBD', 'AE070331234567890123456', 'AED', true)", [E.cid]);

  r = await api("GET", `/api/invoices/${inv.id}/einvoice/validate`, { token: E.token });
  ok("4.5: once the profile and buyer are complete the invoice is valid", r.status === 200 && r.json?.valid === true, { s: r.status, issues: r.json?.issues });
  r = await api("POST", `/api/invoices/${inv.id}/generate-einvoice`, { token: E.token });
  ok("4.5: generation succeeds", r.status === 200 && r.json?.status === "generated", { s: r.status, j: r.json });
  const xmlRes = await api("GET", `/api/invoices/${inv.id}/einvoice-xml`, { token: E.token, raw: true });
  const xml = xmlRes.buf.toString("utf8");
  ok("4.5: the invoice document is an <Invoice> with parties, endpoint ids, PaymentMeans (30 + IBAN) and terms",
    /<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/.test(xml)
      && /<cbc:EndpointID schemeID="0235">100123456700003<\/cbc:EndpointID>/.test(xml)
      && /<cbc:CountrySubentity>DXB<\/cbc:CountrySubentity>/.test(xml)
      && /<cbc:PaymentMeansCode>30<\/cbc:PaymentMeansCode>/.test(xml) && /AE070331234567890123456/.test(xml) && /<cac:PaymentTerms>/.test(xml),
    xml.slice(0, 400));

  // credit note -> true <CreditNote> root referencing the original invoice NUMBER
  const cn = await api("POST", `/api/companies/${E.cid}/invoices/${inv.id}/credit-note`, { token: E.token, body: { date: prevMid, lines: [{ description: "Service", quantity: 1, unitPrice: 200, vatRate: 0.05 }] } });
  ok("4.5: setup: partial credit note", cn.status === 201, { s: cn.status, j: cn.json });
  const cnId = cn.json?.id;
  if (cnId && contactId) await db.query("UPDATE invoices SET contact_id = $1 WHERE id = $2", [contactId, cnId]);
  r = await api("POST", `/api/invoices/${cnId}/generate-einvoice`, { token: E.token });
  ok("4.5: the credit note generates", r.status === 200, { s: r.status, j: r.json });
  const cnXml = (await api("GET", `/api/invoices/${cnId}/einvoice-xml`, { token: E.token, raw: true })).buf.toString("utf8");
  ok("4.5: credit note is a <CreditNote> (type 381, CreditNoteLine, CreditedQuantity, positive amounts)",
    /<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/.test(cnXml) && /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/.test(cnXml)
      && /<cac:CreditNoteLine>/.test(cnXml) && /<cbc:CreditedQuantity unitCode="C62">1<\/cbc:CreditedQuantity>/.test(cnXml) && !/InvoiceLine|InvoiceTypeCode/.test(cnXml)
      && /<cbc:PayableAmount currencyID="AED">210\.00<\/cbc:PayableAmount>/.test(cnXml),
    cnXml.slice(0, 500));
  ok("4.5: its BillingReference carries the original invoice number, not an internal id",
    new RegExp(`<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${inv.number}</cbc:ID>`).test(cnXml), cnXml.match(/<cac:BillingReference>.*?<\/cac:BillingReference>/)?.[0]);
  const orphan = await api("GET", `/api/invoices/${cnId}/einvoice/validate`, { token: E.token });
  ok("4.5: a credit note with its original resolves as valid", orphan.json?.valid === true, orphan.json?.issues);
  await db.query("UPDATE invoices SET original_invoice_id = NULL WHERE id = $1", [cnId]);
  const noOrig = await api("GET", `/api/invoices/${cnId}/einvoice/validate`, { token: E.token });
  ok("4.5: a credit note without its original reference is flagged (CREDIT_NOTE_ORIGINAL_MISSING)", (noOrig.json?.issues ?? []).some((i) => i.code === "CREDIT_NOTE_ORIGINAL_MISSING" && i.entity === "credit_note"), noOrig.json?.issues);
}

main().catch((e) => { console.error(e); process.exit(1); });
