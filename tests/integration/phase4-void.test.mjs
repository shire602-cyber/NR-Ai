// Integration tests for the Phase 4 void / manual-journal / manual-edit review defects: live requests
// against a running server + Postgres.
//   J   a user cannot choose the `source` of a manual journal (POST and PUT)
//   V   a void is reported in the period of the void (VAT 201, autopilot, firm workpaper, FAF, ledger)
//   A   manual journals to the VAT accounts are VAT adjustments, not a mismatch
//   E   a hand edit needs a reason and can never declare less tax than the ledger supports
//   N   opening-balance invoice numbering gap warning
//   H   historical voids: a sale an old-rule return left out is never deducted a second time
//   S   system journal entries cannot be reversed, edited or deleted through the journal routes
//   BASE_URL=http://localhost:5056 DATABASE_URL=... node tests/integration/phase4-void.test.mjs
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
    method,
    headers,
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
const today = ymd(now);
// month M-1 (last month) and M-2 (two months ago), in UTC calendar terms like the rest of the suite
const monthEnd = (back) => ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0)));
const lastEnd = monthEnd(1), lastStart = lastEnd.slice(0, 8) + "01", lastMid = lastEnd.slice(0, 8) + "15";
const twoEnd = monthEnd(2), twoStart = twoEnd.slice(0, 8) + "01", twoMid = twoEnd.slice(0, 8) + "15";
const curStart = today.slice(0, 8) + "01";
const curEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

let db;

async function newCompany(label, { vat = true, exempt = 0 } = {}) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  const patch = vat ? { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } : { emirate: "dubai" };
  if (exempt) patch.exemptSupplyRatio = exempt;
  await api("PATCH", `/api/companies/${cid}`, { token, body: patch });
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
      token, body: { customerName: "Void Co", date, dueDate: date, lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 0.05 }], ...extra },
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
  const journal = async (date, lines, extra = {}) =>
    api("POST", `/api/companies/${cid}/journal`, { token, body: { date, status: "posted", confirmBackdated: true, lines, ...extra } });
  const generate = (start, end) =>
    api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: start, periodEnd: end } });
  const file = (rid, body = {}) =>
    api("POST", `/api/vat-returns/${rid}/file`, { token, body: { ftaReferenceNumber: `RV-${rnd}-${Math.random().toString(36).slice(2, 6)}`, filedAt: today, ...body } });
  const pnl = (start, end) =>
    api("GET", `/api/companies/${cid}/financial-statements/profit-loss?startDate=${start}&endDate=${end}`, { token });
  return { token, cid, userId, account, accounts, balances, invoice, bill, journal, generate, file, pnl };
}


// ── shared helpers for the void scenarios ───────────────────────────────────
const dayStart = (d) => `${d}T00:00:00.000Z`;
const dayEnd = (d) => `${d}T23:59:59.999Z`;

/** Output / input VAT of the LEDGER for a period, read the way the filing gate reads it (date::date, no clearing entries). */
async function ledgerVat(C, start, end) {
  const rows = (await db.query(
    `SELECT a.code, COALESCE(SUM(jl.credit - jl.debit), 0) AS net_credit
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.date::date >= $2::date AND je.date::date <= $3::date
        AND je.source NOT IN ('vat_filing', 'opening_balance', 'opening_balance_reversal') AND a.code IN ('2020', '1050')
      GROUP BY a.code`, [C.cid, start, end])).rows;
  const get = (code) => n(rows.find((r) => r.code === code)?.net_credit);
  return { output: Math.round(get("2020") * 100) / 100, input: Math.round(-get("1050") * 100) / 100 };
}

/** Output VAT the VAT 201, the autopilot, the firm workpaper and the FAF supply listing report for a period. */
async function engines(C, start, end) {
  const gen = await C.generate(start, end);
  const auto = await api("GET", `/api/vat/autopilot/calculate/${C.cid}?periodStart=${dayStart(start)}&periodEnd=${dayEnd(end)}&frequency=monthly&persist=false`, { token: C.token });
  const wp = await api("POST", `/api/companies/${C.cid}/vat-workpapers`, { token: C.token, body: { periodStart: start, periodEnd: end } });
  const pull = await api("POST", `/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}/pull-from-books`, { token: C.token, body: {} });
  await api("POST", `/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}/rows/bulk-status`, { token: C.token, body: { to: "approved" } });
  const detail = await api("GET", `/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}`, { token: C.token });
  const faf = await api("GET", `/api/companies/${C.cid}/reports/fta-audit-file?from=${start}&to=${end}`, { token: C.token });
  const supplies = [];
  if (faf.status === 200) {
    let inBlock = false;
    for (const line of faf.text.split(/\r?\n/)) {
      if (line === "SuppDataStart") { inBlock = true; continue; }
      if (line === "SuppDataEnd") break;
      if (!inBlock || line.startsWith("CustomerName") || line.startsWith("SupplyTotalAED")) continue;
      const c = line.split(",");
      if (c.length >= 9 && /^\d{4}-\d{2}-\d{2}$/.test(c[2])) supplies.push({ date: c[2], number: c[3], value: n(c[6]), vat: n(c[7]) });
    }
  }
  return {
    gen, auto, pull, detail, supplies,
    box12: {
      vat201: n(gen.json?.box12TotalDueTax),
      autopilot: n(auto.json?.vat201?.box12TotalDueTax),
      firm: n(detail.json?.totals?.box12TotalDueTax),
      faf: Math.round(supplies.reduce((sum, r) => sum + r.vat, 0) * 100) / 100,
    },
  };
}
const allEqual = (b, want) => Object.values(b).every((v) => close(v, want));
// a FILED period cannot be generated again (the filed return is final): its figures are read by the other engines and from the filed snapshot
const allEqualFiled = (b, want) => Object.entries(b).filter(([k]) => k !== "vat201").every(([, v]) => close(v, want));
const voidInvoice = (C, id) => api("PATCH", `/api/invoices/${id}/status`, { token: C.token, body: { status: "void" } });
/** Test-only: move the reversal entry of a void to the day the scenario needs (the endpoint always dates it today). */
async function dateVoidOn(C, invoiceId, day) {
  const r = await db.query(
    `UPDATE journal_entries SET date = $3::timestamp WHERE company_id = $1 AND source = 'invoice' AND source_id = $2 AND reversed_entry_id IS NOT NULL RETURNING id`,
    [C.cid, invoiceId, `${day}T00:00:00`]);
  return r.rows.length;
}
/** Net balance (debit - credit) of an account over entries dated in [start, end] plus the clearing entries of a filing. */
async function vatAccountForPeriod(C, code, start, end, returnId) {
  const r = await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2
        AND ((je.date::date >= $3::date AND je.date::date <= $4::date AND je.source NOT IN ('vat_filing')) OR (je.source = 'vat_filing' AND je.source_id = $5))`,
    [C.cid, code, start, end, returnId]);
  return Math.round(n(r.rows[0].net) * 100) / 100;
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const only = process.env.ONLY;
    const want = (name) => !only || only.split(",").includes(name);
    if (want("J")) await sectionJ();
    if (want("V")) await sectionV();
    if (want("A")) await sectionA();
    if (want("E")) await sectionE();
    if (want("N")) await sectionN();
    if (want("H")) await sectionH();
    if (want("S")) await sectionS();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ═════════════════════════════════════════════════════════════════════════════
// J: the source of a manual journal is never chosen by the client
// ═════════════════════════════════════════════════════════════════════════════
async function sectionJ() {
  const C = await newCompany("jsrc");
  const bank = (await C.account("1020")).id, rev = (await C.account("4010")).id, vatOut = (await C.account("2020")).id, exp = (await C.account("5000")).id;
  const rowOf = async (id) => (await db.query("SELECT source, source_id, reversed_entry_id, created_by, posted_by, entry_number, company_id FROM journal_entries WHERE id = $1", [id])).rows[0];

  // forged year_end_close crediting revenue: still counted in the P&L
  const forged = await C.journal(lastMid, [{ accountId: bank, debit: 100, credit: 0 }, { accountId: rev, debit: 0, credit: 100 }], {
    memo: "forged closing", source: "year_end_close", sourceId: "11111111-1111-1111-1111-111111111111", sourceType: "year_end_close",
    reversedEntryId: "22222222-2222-2222-2222-222222222222", postedBy: "33333333-3333-3333-3333-333333333333",
    createdBy: "44444444-4444-4444-4444-444444444444", entryNumber: "JE-FORGED", companyId: "55555555-5555-5555-5555-555555555555",
  });
  ok("J: a manual journal that names source 'year_end_close' is accepted (200) but stored as manual", forged.status === 200, { s: forged.status, t: forged.text.slice(0, 200) });
  const row = forged.json?.id ? await rowOf(forged.json.id) : null;
  ok("J: stored source is 'manual'", row?.source === "manual", row);
  ok("J: sourceId and reversedEntryId were not taken from the request", row && row.source_id === null && row.reversed_entry_id === null, row);
  ok("J: createdBy / postedBy are the session user, entry number and company are the server's own",
    row && row.created_by === C.userId && row.posted_by === C.userId && row.entry_number !== "JE-FORGED" && row.company_id === C.cid, row);
  const pl = await C.pnl(lastStart, lastEnd);
  ok("J: the P&L for that month includes the 100 (not dropped as a closing entry)", pl.status === 200 && close(pl.json?.revenue, 100), { s: pl.status, j: pl.json });

  // forged vat_filing / opening_balance sources on a VAT posting
  for (const source of ["vat_filing", "opening_balance"]) {
    const v = await C.journal(lastMid, [{ accountId: vatOut, debit: 50, credit: 0 }, { accountId: exp, debit: 0, credit: 50 }], { memo: `Correct output VAT (${source})`, source });
    const r = v.json?.id ? await rowOf(v.json.id) : null;
    ok(`J: a VAT-account journal that names source '${source}' is stored as manual`, v.status === 200 && r?.source === "manual", { s: v.status, r });
  }

  // draft, then PUT cannot change source (or anything else that is the system's)
  const draft = await C.journal(lastMid, [{ accountId: bank, debit: 10, credit: 0 }, { accountId: rev, debit: 0, credit: 10 }], { status: "draft", memo: "draft" });
  const put = await api("PUT", `/api/journal/${draft.json?.id}`, {
    token: C.token,
    body: { date: lastMid, memo: "edited", status: "draft", confirmBackdated: true, source: "year_end_close", sourceId: "11111111-1111-1111-1111-111111111111",
      reversedEntryId: "22222222-2222-2222-2222-222222222222", entryNumber: "JE-FORGED", companyId: "55555555-5555-5555-5555-555555555555", postedBy: "33333333-3333-3333-3333-333333333333",
      lines: [{ accountId: bank, debit: 10, credit: 0 }, { accountId: rev, debit: 0, credit: 10 }] },
  });
  const after = draft.json?.id ? await rowOf(draft.json.id) : null;
  ok("J: PUT with a forged source is accepted but source stays manual, no system field changed",
    put.status === 200 && after?.source === "manual" && after.source_id === null && after.reversed_entry_id === null && after.entry_number !== "JE-FORGED" && after.company_id === C.cid && after.posted_by === null,
    { s: put.status, after });
  const badStatus = await api("PUT", `/api/journal/${draft.json?.id}`, {
    token: C.token, body: { date: lastMid, status: "void", lines: [{ accountId: bank, debit: 10, credit: 0 }, { accountId: rev, debit: 0, credit: 10 }] },
  });
  ok("J: PUT with status 'void' is refused (400)", badStatus.status === 400, { s: badStatus.status });
}

// ═════════════════════════════════════════════════════════════════════════════
// V: a void is reported in the period of the void
// ═════════════════════════════════════════════════════════════════════════════
async function sectionV() {
  // ── V1: the real endpoint, UNFILED period (Teardown 8 / CTO rule) ───────────────────────────
  // A document voided while its period has no filed return is dropped from that period: the void reverses on the document's own
  // date (S1), so the ledger holds nothing for it, and the return, workpaper, audit rows and every engine agree.
  {
    const X = await newCompany("v1real");
    const a = await X.invoice(lastMid, 1000);
    const b = await X.invoice(lastMid, 1000);
    const v = await voidInvoice(X, b.id);
    ok("V1: (setup) the second August invoice is voided today", v.status === 200, { s: v.status, t: v.text.slice(0, 200) });
    const rev = (await db.query("SELECT date::date::text AS d FROM journal_entries WHERE company_id = $1 AND source = 'invoice' AND reversed_entry_id IS NOT NULL", [X.cid])).rows[0];
    ok("V1: the reversal is dated the document's own day (its period is open and unfiled)", rev && rev.d === lastMid, { rev, lastMid });

    const led = await ledgerVat(X, lastStart, lastEnd);
    ok("V1: the LEDGER for August holds 50 of output VAT (the voided invoice and its reversal net to zero)", close(led.output, 50), led);
    const aug = await engines(X, lastStart, lastEnd);
    ok("V1: August: VAT 201, autopilot, firm workpaper and FAF all report box 12 = 50 (the voided invoice is out)", allEqual(aug.box12, 50), aug.box12);
    ok("V1: August FAF supply listing has the surviving invoice only", aug.supplies.length === 1 && close(aug.supplies[0].value, 1000), aug.supplies);
    {
      // The reports module's VAT summary must read the same calculation.
      const rep = await api("GET", `/api/companies/${X.cid}/reports/vat-return?from=${lastStart}&to=${lastEnd}`, { token: X.token });
      ok("V1: the reports VAT summary agrees with the VAT 201 for the month of the voided invoice (supplies 1,000, VAT 50)",
        rep.status === 200 && close(rep.json?.box1_standardRatedSupplies, 1000) && close(rep.json?.box5_outputVat, 50) && close(rep.json?.box8_netVatDue, 50),
        { s: rep.status, j: rep.json });
      const repCur = await api("GET", `/api/companies/${X.cid}/reports/vat-return?from=${curStart}&to=${curEnd}`, { token: X.token });
      ok("V1: and the month of the void shows no reversal (nothing was declared to reverse)",
        repCur.status === 200 && close(repCur.json?.box5_outputVat, 0) && close(repCur.json?.box1_standardRatedSupplies, 0),
        { s: repCur.status, j: repCur.json });
    }
    const filed = await X.file(aug.gen.json?.id);
    ok("V1: filing August succeeds (no VAT_LEDGER_MISMATCH)", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
    ok("V1: after filing, the August VAT accounts are zero (2020 and 1050)",
      close(await vatAccountForPeriod(X, "2020", lastStart, lastEnd, aug.gen.json?.id), 0) && close(await vatAccountForPeriod(X, "1050", lastStart, lastEnd, aug.gen.json?.id), 0), null);

    const cur = await engines(X, curStart, curEnd);
    const curLedger = await ledgerVat(X, curStart, curEnd);
    ok("V1: the ledger of the current month holds nothing for it", close(curLedger.output, 0), curLedger);
    ok("V1: the current month's draft preview shows no reversal in any engine", allEqual(cur.box12, 0), cur.box12);
    ok("V1: the FAF supply listing of the current month is empty", cur.supplies.length === 0, cur.supplies);
    ok("V1: the preview is labelled a draft preview", cur.gen.json?.isDraftPreview === true && cur.gen.json?.id === null, { p: cur.gen.json?.isDraftPreview });
    const list = await api("GET", `/api/companies/${X.cid}/vat-returns`, { token: X.token });
    const augRow = (list.json ?? []).find((r) => String(r.periodStart).slice(0, 10) === lastStart);
    ok("V1: the filed August return displays its snapshot (box 12 = 50)", close(augRow?.box12TotalDueTax, 50), augRow?.box12TotalDueTax);
  }

  // ── V1F: the same void AFTER the period is filed: an adjustment in the period of the void ──────
  {
    const X = await newCompany("v1filed");
    await X.invoice(lastMid, 1000);
    const b = await X.invoice(lastMid, 1000);
    const aug = await engines(X, lastStart, lastEnd);
    ok("V1F: (setup) August holds both invoices: box 12 = 100 in every engine", allEqual(aug.box12, 100), aug.box12);
    const filed = await X.file(aug.gen.json?.id);
    ok("V1F: (setup) August is filed (100)", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
    const v = await voidInvoice(X, b.id);
    ok("V1F: (setup) the invoice is voided after the filing", v.status === 200, { s: v.status, t: v.text.slice(0, 200) });
    const rev = (await db.query("SELECT date::date::text AS d FROM journal_entries WHERE company_id = $1 AND source = 'invoice' AND reversed_entry_id IS NOT NULL", [X.cid])).rows[0];
    ok("V1F: the reversal falls after the filed period (first open day), not inside it", rev && rev.d > lastEnd, { rev, lastEnd });
    ok("V1F: the LEDGER for the filed August still holds 100 of output VAT", close((await ledgerVat(X, lastStart, lastEnd)).output, 100), await ledgerVat(X, lastStart, lastEnd));
    const augAgain = await engines(X, lastStart, lastEnd);
    ok("V1F: August (filed) still reports box 12 = 100 in the other engines (the filed return is final)", allEqualFiled(augAgain.box12, 100), augAgain.box12);
    const cur = await engines(X, curStart, curEnd);
    ok("V1F: the month of the reversal carries the -50 adjustment in every engine and in the ledger", allEqual(cur.box12, -50) && close((await ledgerVat(X, curStart, curEnd)).output, -50), { b: cur.box12 });
    ok("V1F: the FAF supply listing and the VAT audit rows of that month show the negative line of the voided invoice",
      cur.supplies.length === 1 && close(cur.supplies[0].value, -1000) && close(cur.supplies[0].vat, -50) && cur.supplies[0].number === b.number, cur.supplies);
    const audit = await api("GET", `/api/companies/${X.cid}/reports/run/vat-audit-sales?from=${curStart}&to=${curEnd}`, { token: X.token });
    ok("V1F: ... in the VAT Audit sales report too (one row, -1,000 / -50)", (audit.json?.rows ?? []).filter((r) => r.kind === "detail").length === 1 && close(audit.json?.totals?.vat, -50), audit.json?.totals);
    const wp = await api("POST", `/api/companies/${X.cid}/vat-workpapers`, { token: X.token, body: { periodStart: curStart, periodEnd: curEnd } });
    await api("POST", `/api/companies/${X.cid}/vat-workpapers/${wp.json?.id}/pull-from-books`, { token: X.token, body: {} });
    const wpRows = ((await api("GET", `/api/companies/${X.cid}/vat-workpapers/${wp.json?.id}`, { token: X.token })).json?.rows ?? []).filter((r) => /standard/i.test(String(r.rowCategory)));
    ok("V1F: ... and in the workpaper of that month (one standard row, -1,000 / -50)", wpRows.length === 1 && close(wpRows[0]?.taxableAmount, -1000) && close(wpRows[0]?.vatAmount, -50), wpRows.map((r) => [r.rowCategory, r.taxableAmount, r.vatAmount]));
    const list = await api("GET", `/api/companies/${X.cid}/vat-returns`, { token: X.token });
    const augRow = (list.json ?? []).find((r) => String(r.periodStart).slice(0, 10) === lastStart);
    ok("V1F: the filed August return keeps its snapshot (box 12 = 100)", close(augRow?.box12TotalDueTax, 100), augRow?.box12TotalDueTax);
  }

  // ── V2: a filed month M, then a void dated in month M+1 (the first open month after it) ──────────
  {
    const Y = await newCompany("v2cross");
    const a = await Y.invoice(twoMid, 1000);
    const b = await Y.invoice(twoMid, 1000);
    const jul = await engines(Y, twoStart, twoEnd);
    const fJul = await Y.file(jul.gen.json?.id);
    ok("V2: filing July succeeds (100)", fJul.status === 201 && allEqual(jul.box12, 100), { s: fJul.status, t: fJul.text.slice(0, 300), b: jul.box12 });
    ok("V2: after filing July the July VAT accounts are zero", close(await vatAccountForPeriod(Y, "2020", twoStart, twoEnd, jul.gen.json?.id), 0), null);
    await voidInvoice(Y, b.id);
    const moved = await dateVoidOn(Y, b.id, lastEnd.slice(0, 8) + "20");
    ok("V2: (setup) the void is dated 20 August, invoices are in the filed July", moved === 1, moved);

    const julAgain = await engines(Y, twoStart, twoEnd);
    ok("V2: July (filed): the other engines still report box 12 = 100", allEqualFiled(julAgain.box12, 100), { b: julAgain.box12 });
    ok("V2: July FAF supply listing includes both invoices", julAgain.supplies.length === 2, julAgain.supplies);
    const auga = await engines(Y, lastStart, lastEnd);
    ok("V2: August: the void is a -50 reversal in every engine and in the ledger", allEqual(auga.box12, -50) && close((await ledgerVat(Y, lastStart, lastEnd)).output, -50), { b: auga.box12 });
    ok("V2: August FAF supply listing has the negative line dated the day of the void",
      auga.supplies.length === 1 && close(auga.supplies[0].value, -1000) && auga.supplies[0].date === lastEnd.slice(0, 8) + "20", auga.supplies);

    const fAug = await Y.file(auga.gen.json?.id);
    ok("V2: filing August succeeds (return -50 = ledger -50)", fAug.status === 201, { s: fAug.status, t: fAug.text.slice(0, 300) });
    ok("V2: after filing August the August VAT accounts are zero", close(await vatAccountForPeriod(Y, "2020", lastStart, lastEnd, auga.gen.json?.id), 0), null);
    const bal = await Y.balances();
    ok("V2: in total the books carry 50 of output VAT payable-to-FTA net (100 - 50) on the control account", close(bal["2020"] ?? 0, 0) && close(bal["2025"], -50), bal);
    const snap = (await db.query("SELECT snapshot FROM tax_filings WHERE return_id = $1", [jul.gen.json?.id])).rows[0]?.snapshot;
    ok("V2: the filed July snapshot keeps box 12 = 100", close(snap?.boxes?.box12TotalDueTax, 100), snap?.boxes?.box12TotalDueTax);
  }

  // ── V3: voided in the SAME month: net zero, as before; a never-posted draft never counts ────────
  {
    const Z = await newCompany("v3same");
    await Z.invoice(lastMid, 1000);
    const b = await Z.invoice(lastMid, 1000);
    await voidInvoice(Z, b.id);
    await dateVoidOn(Z, b.id, lastEnd.slice(0, 8) + "20");
    const draft = await api("POST", `/api/companies/${Z.cid}/invoices`, { token: Z.token, body: { customerName: "Draft Co", date: lastMid, dueDate: lastMid, lines: [{ description: "Draft", quantity: 1, unitPrice: 400, vatRate: 0.05 }] } });
    const dv = await voidInvoice(Z, draft.json?.id);
    ok("V3: (setup) a draft that was never posted is voided", dv.status === 200, { s: dv.status, t: dv.text.slice(0, 200) });
    const aug = await engines(Z, lastStart, lastEnd);
    ok("V3: voided inside the same month: box 12 = 50 in every engine, the never-posted draft does not count", allEqual(aug.box12, 50) && close((await ledgerVat(Z, lastStart, lastEnd)).output, 50), aug.box12);
    ok("V3: the FAF supply listing shows only the surviving invoice", aug.supplies.length === 1, aug.supplies);
    const filed = await Z.file(aug.gen.json?.id);
    ok("V3: filing succeeds", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
  }

  // ── V5: corporate tax pulls the same revenue as the ledger, even for an entry posted late on the last day ──
  {
    const T = await newCompany("v5ct");
    await T.invoice(lastMid, 1000);
    const b = await T.invoice(lastMid, 1000);
    await voidInvoice(T, b.id);
    // a void made at 15:30 on the last day of August (older reversals carry a time of day)
    await db.query(
      `UPDATE journal_entries SET date = $3::timestamp WHERE company_id = $1 AND source = 'invoice' AND source_id = $2 AND reversed_entry_id IS NOT NULL`,
      [T.cid, b.id, `${lastEnd}T15:30:00`]);
    const ledgerRevenue = n((await db.query(
      `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) AS r FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND a.type = 'income' AND je.date::date >= $2::date AND je.date::date <= $3::date`, [T.cid, lastStart, lastEnd])).rows[0].r);
    const calc = await api("GET", `/api/companies/${T.cid}/corporate-tax/calculate?periodStart=${lastStart}&periodEnd=${lastEnd}`, { token: T.token });
    ok("V5: the ledger's revenue for August is 1,000 (2,000 invoiced, 1,000 voided)", close(ledgerRevenue, 1000), ledgerRevenue);
    ok("V5: corporate tax /calculate reports the ledger's revenue for that period", calc.status === 200 && close(calc.json?.totalRevenue, ledgerRevenue), { s: calc.status, r: calc.json?.totalRevenue });
    const ret = await api("POST", `/api/companies/${T.cid}/corporate-tax/returns`, {
      token: T.token, body: { taxPeriodStart: lastStart, taxPeriodEnd: lastEnd, totalRevenue: 0, totalExpenses: 0 },
    });
    const pull = ret.json?.id ? await api("POST", `/api/corporate-tax/returns/${ret.json.id}/pull-from-books`, { token: T.token, body: {} }) : ret;
    ok("V5: corporate tax pull-from-books puts the ledger's revenue in the return", pull.status === 200 && close(pull.json?.totalRevenue, ledgerRevenue), { s: pull.status, t: pull.text.slice(0, 250) });
  }

  // ── V4: a credit note of a FILED period voided later comes back as a positive line in the month of the void ──
  {
    const K = await newCompany("v4cn");
    const inv = await K.invoice(twoMid, 1000);
    const cn = await api("POST", `/api/companies/${K.cid}/invoices/${inv.id}/credit-note`, { token: K.token, body: { reason: "Goods returned" } });
    const cnId = cn.json?.creditNote?.id ?? cn.json?.id;
    ok("V4: (setup) a full credit note is issued", cn.status === 201 || cn.status === 200, { s: cn.status, t: cn.text.slice(0, 300) });
    // test-only: the credit note was issued "today"; move it (and its journal entry) to 10 August
    const augDay = lastEnd.slice(0, 8) + "10";
    await db.query("UPDATE invoices SET date = $2::timestamp WHERE id = $1", [cnId, `${augDay}T00:00:00`]);
    await db.query("UPDATE journal_entries SET date = $3::timestamp WHERE company_id = $1 AND source = 'invoice' AND source_id = $2", [K.cid, cnId, `${augDay}T00:00:00`]);
    const augBefore = await engines(K, lastStart, lastEnd);
    ok("V4: (setup) August holds the credit note (-50)", allEqual(augBefore.box12, -50), augBefore.box12);
    const fAug = await K.file(augBefore.gen.json?.id);
    ok("V4: (setup) August is filed", fAug.status === 201, { s: fAug.status, t: fAug.text.slice(0, 300) });
    const v = await voidInvoice(K, cnId);
    ok("V4: (setup) the credit note is voided after the filing", v.status === 200, { s: v.status, t: v.text.slice(0, 300) });
    const aug = await engines(K, lastStart, lastEnd);
    ok("V4: August (filed): the credit note is still a credit of August (-50) in every engine and in the ledger",
      allEqualFiled(aug.box12, -50) && close((await ledgerVat(K, lastStart, lastEnd)).output, -50), { b: aug.box12, l: await ledgerVat(K, lastStart, lastEnd) });
    const cur = await engines(K, curStart, curEnd);
    ok("V4: the month of the void: the voided credit note is a POSITIVE +50 line in every engine and in the ledger",
      allEqual(cur.box12, 50) && close((await ledgerVat(K, curStart, curEnd)).output, 50), { b: cur.box12 });
  }

  // ── V4U: the same credit note voided while its period is UNFILED: out of the return, no line anywhere else ──
  {
    const K = await newCompany("v4cnu");
    const inv = await K.invoice(twoMid, 1000);
    const cn = await api("POST", `/api/companies/${K.cid}/invoices/${inv.id}/credit-note`, { token: K.token, body: { reason: "Goods returned" } });
    const cnId = cn.json?.creditNote?.id ?? cn.json?.id;
    const augDay = lastEnd.slice(0, 8) + "10";
    await db.query("UPDATE invoices SET date = $2::timestamp WHERE id = $1", [cnId, `${augDay}T00:00:00`]);
    await db.query("UPDATE journal_entries SET date = $3::timestamp WHERE company_id = $1 AND source = 'invoice' AND source_id = $2", [K.cid, cnId, `${augDay}T00:00:00`]);
    const v = await voidInvoice(K, cnId);
    ok("V4U: (setup) the credit note is voided while August is unfiled", v.status === 200, { s: v.status, t: v.text.slice(0, 300) });
    const aug = await engines(K, lastStart, lastEnd);
    ok("V4U: August: the voided credit note is out of every engine (box 12 = 0)", allEqual(aug.box12, 0), aug.box12);
    const cur = await engines(K, curStart, curEnd);
    ok("V4U: the month of the void shows no positive line either", allEqual(cur.box12, 0), cur.box12);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// H: historical voids. The deciding fact is whether the document was ever DECLARED in a filed
// return. A return recorded before the date rule took effect (the "cutover", system_settings key
// vat_date_based_voids_from) was computed by the OLD rule: a void invoice never counted. History is
// simulated in SQL (the API dates a void today), with times relative to the REAL stored cutover.
// ═════════════════════════════════════════════════════════════════════════════
const DAY_MS = 24 * 3600 * 1000;
const utcDigits = (ms) => new Date(ms).toISOString().slice(0, 23); // timestamp-without-tz digits, UTC
async function cutoverMs() {
  const r = await db.query("SELECT value FROM system_settings WHERE key = 'vat_date_based_voids_from'");
  return r.rows[0] ? Date.parse(r.rows[0].value) : 0;
}
/** Test-only: the moment the void really happened (created_at of the reversal entry). */
async function setVoidInstant(C, invoiceId, ms) {
  await db.query(
    `UPDATE journal_entries SET created_at = $3::timestamp, posted_at = $3::timestamp WHERE company_id = $1 AND source = 'invoice' AND source_id = $2 AND reversed_entry_id IS NOT NULL`,
    [C.cid, invoiceId, utcDigits(ms)]);
}
/** Test-only: a return filed before "filed with evidence" existed: status filed, no filing record, recorded at `ms`. */
async function insertLegacyFiledReturn(C, start, end, ms, { amount = 0, vat = 0 } = {}) {
  const r = await db.query(
    `INSERT INTO vat_returns (company_id, created_by, period_start, period_end, due_date, status, submitted_at, created_at, updated_at,
        box1b_dubai_amount, box1b_dubai_vat, box8_total_amount, box8_total_vat, box11_total_amount, box11_total_vat, box12_total_due_tax, box14_payable_tax)
     VALUES ($1, $7, $2::timestamp, $3::timestamp, $3::timestamp, 'filed', $4::timestamp, $4::timestamp, $4::timestamp, $5, $6, $5, $6, $5, $6, $6, $6) RETURNING id`,
    [C.cid, `${start}T00:00:00`, `${end}T00:00:00`, utcDigits(ms), amount, vat, C.userId]).catch(async (e) => {
    throw new Error("legacy return insert failed: " + e.message);
  });
  return r.rows[0].id;
}
const repVat = (C, from, to) => api("GET", `/api/companies/${C.cid}/reports/vat-return?from=${from}&to=${to}`, { token: C.token });

async function sectionH() {
  const cut = await cutoverMs();
  ok("H: (setup) the cutover is stored in system_settings", cut > 0, cut);

  // ── H1 (case a): July filed by the OLD rule AFTER the void: the invoice was never declared ────
  {
    const C = await newCompany("h1never");
    const x = await C.invoice(twoMid, 1000);
    await voidInvoice(C, x.id);
    await dateVoidOn(C, x.id, lastMid);
    await setVoidInstant(C, x.id, cut - 2 * DAY_MS);
    await insertLegacyFiledReturn(C, twoStart, twoEnd, cut - 1 * DAY_MS);   // recorded after the void, before the cutover: X was left out

    const aug = await engines(C, lastStart, lastEnd);
    ok("H1: the return after the void reports NO negative line: VAT 201, autopilot, firm workpaper and FAF all report box 12 = 0", allEqual(aug.box12, 0), aug.box12);
    ok("H1: box 1 = 0, box 8 VAT = 0, box 14 = 0 on the generated return",
      close(aug.gen.json?.box1bDubaiAmount, 0) && close(aug.gen.json?.box8TotalVat, 0) && close(aug.gen.json?.box14PayableTax, 0),
      { b1: aug.gen.json?.box1bDubaiAmount, v: aug.gen.json?.box8TotalVat, b14: aug.gen.json?.box14PayableTax });
    ok("H1: the FAF supply listing has no line for the invoice", aug.supplies.length === 0, aug.supplies);
    const rep = await repVat(C, lastStart, lastEnd);
    ok("H1: the reports VAT summary agrees (supplies 0, VAT 0)", rep.status === 200 && close(rep.json?.box1_standardRatedSupplies, 0) && close(rep.json?.box5_outputVat, 0), { s: rep.status, j: rep.json });
    const repJul = await repVat(C, twoStart, twoEnd);
    ok("H1: the earlier month leaves the never-declared invoice out too (its filed return declared 0)", repJul.status === 200 && close(repJul.json?.box5_outputVat, 0), { s: repJul.status, j: repJul.json });

    const filed = await C.file(aug.gen.json?.id);
    ok("H1: filing the month of the void succeeds (no VAT_LEDGER_MISMATCH)", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
    const bal = await C.balances();
    ok("H1: across ALL dates the output and input VAT accounts net to zero (+50 in July, -50 in August)", close(bal["2020"] ?? 0, 0) && close(bal["1050"] ?? 0, 0), bal);
    // reading the returns list gives the legacy return its snapshot (a filing record created TODAY): the decision must still use the return's own time
    const list = await api("GET", `/api/companies/${C.cid}/vat-returns`, { token: C.token });
    const legacyRows = (await db.query("SELECT 1 FROM tax_filings f JOIN vat_returns r ON r.id = f.return_id WHERE r.company_id = $1 AND f.snapshot->>'legacy' = 'true'", [C.cid])).rows.length;
    const repAgain = await repVat(C, lastStart, lastEnd);
    ok("H1: once the legacy return has its snapshot the decision is unchanged (still no line)", list.status === 200 && legacyRows === 1 && close(repAgain.json?.box5_outputVat, 0), { s: list.status, legacyRows, j: repAgain.json });
    const f = (await db.query("SELECT settlement_net FROM tax_filings WHERE return_id = $1", [aug.gen.json?.id])).rows[0];
    ok("H1: nothing is owed or refunded for that month", f && close(f.settlement_net, 0), f);
    const snapJul = (await db.query("SELECT box12_total_due_tax FROM vat_returns WHERE company_id = $1 AND period_start = $2::timestamp", [C.cid, `${twoStart}T00:00:00`])).rows[0];
    ok("H1: the already-filed return's figures are untouched", close(snapJul?.box12_total_due_tax, 0), snapJul);
  }

  // ── H2 (case b): July filed BEFORE the void: the invoice WAS declared, the void is a real -50 ─────
  {
    const C = await newCompany("h2declared");
    const x = await C.invoice(twoMid, 1000);
    await voidInvoice(C, x.id);
    await dateVoidOn(C, x.id, lastMid);
    await setVoidInstant(C, x.id, cut - 2 * DAY_MS);
    await insertLegacyFiledReturn(C, twoStart, twoEnd, cut - 3 * DAY_MS, { amount: 1000, vat: 50 });   // recorded before the void

    const aug = await engines(C, lastStart, lastEnd);
    ok("H2: the void is a -50 reversal in every engine", allEqual(aug.box12, -50), aug.box12);
    ok("H2: box 1 = -1000, VAT -50", close(aug.gen.json?.box1bDubaiAmount, -1000) && close(aug.gen.json?.box8TotalVat, -50), { b1: aug.gen.json?.box1bDubaiAmount, v: aug.gen.json?.box8TotalVat });
    ok("H2: the FAF supply listing has the negative line", aug.supplies.length === 1 && close(aug.supplies[0].value, -1000) && close(aug.supplies[0].vat, -50), aug.supplies);
    const filed = await C.file(aug.gen.json?.id);
    ok("H2: filing the month of the void succeeds", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
  }

  // ── H3 (case c): July filed through the real flow (after the cutover), the invoice voided afterwards ──
  {
    const C = await newCompany("h3newrule");
    const x = await C.invoice(twoMid, 1000);
    const jul = await C.generate(twoStart, twoEnd);
    const fJul = await C.file(jul.json?.id);
    ok("H3: (setup) July is filed through the real flow", fJul.status === 201, { s: fJul.status, t: fJul.text.slice(0, 300) });
    await voidInvoice(C, x.id);
    await dateVoidOn(C, x.id, lastMid);
    const aug = await engines(C, lastStart, lastEnd);
    ok("H3: the void of a document a new-rule return declared is a -50 reversal in every engine", allEqual(aug.box12, -50), aug.box12);
    const filed = await C.file(aug.gen.json?.id);
    ok("H3: filing the month of the void succeeds", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
    const cur = await engines(C, curStart, curEnd);
    ok("H3: nothing is reported twice: the current month has no line for it", allEqual(cur.box12, 0) && cur.supplies.length === 0, { b: cur.box12, s: cur.supplies });
  }

  // ── H4: issued and voided in the same month, that month filed: nothing in any later month ──────
  {
    const C = await newCompany("h4same");
    await C.invoice(lastMid, 400);
    const x = await C.invoice(lastMid, 1000);
    await voidInvoice(C, x.id);
    await dateVoidOn(C, x.id, lastEnd.slice(0, 8) + "20");
    const aug = await engines(C, lastStart, lastEnd);
    ok("H4: the month itself reports only the surviving invoice (box 12 = 20)", allEqual(aug.box12, 20), aug.box12);
    const filed = await C.file(aug.gen.json?.id);
    ok("H4: filing succeeds", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
    const cur = await engines(C, curStart, curEnd);
    ok("H4: the current month shows nothing for it in any engine", allEqual(cur.box12, 0) && cur.supplies.length === 0, { b: cur.box12, s: cur.supplies });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// S: system journal entries (source other than manual) are not reversed, edited or deleted through the journal routes
// ═════════════════════════════════════════════════════════════════════════════
async function sectionS() {
  const y1 = now.getUTCFullYear() - 1;
  const C = await newCompany("ssys");
  const inv = await C.invoice(lastMid, 1000);
  const bank = (await C.account("1020")).id;
  const pay = await api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/payments`, { token: C.token, body: { amount: 1050, date: lastMid, method: "bank_transfer", paymentAccountId: bank } });
  ok("S: (setup) the invoice is paid", pay.status === 200 || pay.status === 201, { s: pay.status, t: pay.text.slice(0, 200) });
  const gen = await C.generate(lastStart, lastEnd);
  const filed = await C.file(gen.json?.id);
  ok("S: (setup) the month is filed (a clearing journal is posted)", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });

  const entryOf = async (where, args) => (await db.query(`SELECT id, source, status FROM journal_entries WHERE company_id = $1 AND ${where} ORDER BY created_at LIMIT 1`, [C.cid, ...args])).rows[0];
  const snapshotLedger = async () => JSON.stringify({ bal: await C.balances(), n: (await db.query("SELECT count(*) FROM journal_entries WHERE company_id = $1", [C.cid])).rows[0].count });
  const reverse = (id) => api("POST", `/api/journal/${id}/reverse`, { token: C.token, body: { reason: "should not work" } });

  const clearing = await entryOf("source = 'vat_filing'", []);
  const revenue = await entryOf("source = 'invoice' AND reversed_entry_id IS NULL", []);
  const payment = await entryOf("source = 'payment'", []);
  ok("S: (setup) the clearing, invoice and payment entries exist", !!clearing && !!revenue && !!payment, { clearing, revenue, payment });

  const before = await snapshotLedger();
  const rClear = await reverse(clearing?.id);
  ok("S: reversing the VAT clearing entry of a filed return -> 409 SYSTEM_ENTRY_NOT_REVERSIBLE naming the amendment", rClear.status === 409 && rClear.json?.code === "SYSTEM_ENTRY_NOT_REVERSIBLE" && /amendment/i.test(rClear.json?.message ?? ""), { s: rClear.status, j: rClear.json });
  const rInv = await reverse(revenue?.id);
  ok("S: reversing an invoice revenue entry -> 409 (void the invoice / credit note)", rInv.status === 409 && rInv.json?.code === "SYSTEM_ENTRY_NOT_REVERSIBLE" && /void the invoice|credit note/i.test(rInv.json?.message ?? ""), { s: rInv.status, j: rInv.json });
  const rPay = await reverse(payment?.id);
  ok("S: reversing a payment entry -> 409", rPay.status === 409 && rPay.json?.code === "SYSTEM_ENTRY_NOT_REVERSIBLE", { s: rPay.status, j: rPay.json });
  ok("S: the ledger is unchanged by the refused reversals (balances and entry count)", (await snapshotLedger()) === before, { before, after: await snapshotLedger() });

  // year-end close entry
  const Y = await newCompany("ssysy");
  await Y.invoice(`${y1}-03-15`, 500);
  const close1 = await api("POST", `/api/companies/${Y.cid}/year-end/close`, { token: Y.token, body: { yearStart: `${y1}-01-01` } });
  const ye = (await db.query("SELECT id FROM journal_entries WHERE company_id = $1 AND source = 'year_end_close'", [Y.cid])).rows[0];
  ok("S: (setup) a year is closed", close1.status === 201 && !!ye, { s: close1.status, t: close1.text.slice(0, 200) });
  const yeBefore = (await db.query("SELECT count(*) FROM journal_entries WHERE company_id = $1", [Y.cid])).rows[0].count;
  const rYe = await api("POST", `/api/journal/${ye?.id}/reverse`, { token: Y.token, body: { reason: "no" } });
  ok("S: reversing a year-end close entry -> 409 (reopen the year-end close)", rYe.status === 409 && rYe.json?.code === "SYSTEM_ENTRY_NOT_REVERSIBLE" && /reopen/i.test(rYe.json?.message ?? ""), { s: rYe.status, j: rYe.json });
  ok("S: and posted nothing", (await db.query("SELECT count(*) FROM journal_entries WHERE company_id = $1", [Y.cid])).rows[0].count === yeBefore, null);

  // PUT and DELETE on system entries are refused (posted ones by immutability, system drafts by the source rule)
  const lines = [{ accountId: bank, debit: 5, credit: 0 }, { accountId: (await C.account("4010")).id, debit: 0, credit: 5 }];
  const putPosted = await api("PUT", `/api/journal/${revenue?.id}`, { token: C.token, body: { date: lastMid, lines } });
  const delPosted = await api("DELETE", `/api/journal/${revenue?.id}`, { token: C.token });
  const putClear = await api("PUT", `/api/journal/${clearing?.id}`, { token: C.token, body: { date: lastMid, lines } });
  const delClear = await api("DELETE", `/api/journal/${clearing?.id}`, { token: C.token });
  ok("S: PUT and DELETE on posted system entries are refused (4xx)", [putPosted, delPosted, putClear, delClear].every((r) => r.status >= 400 && r.status < 500), [putPosted.status, delPosted.status, putClear.status, delClear.status]);
  const sysDraft = await C.journal(curStart, lines, { status: "draft", memo: "will become a system draft" });
  await db.query("UPDATE journal_entries SET source = 'fx_revaluation' WHERE id = $1", [sysDraft.json?.id]);
  const putDraft = await api("PUT", `/api/journal/${sysDraft.json?.id}`, { token: C.token, body: { date: curStart, memo: "edited", status: "draft", confirmBackdated: true, lines } });
  const delDraft = await api("DELETE", `/api/journal/${sysDraft.json?.id}`, { token: C.token });
  ok("S: PUT and DELETE on a system DRAFT are refused (409 SYSTEM_ENTRY_READ_ONLY)", putDraft.status === 409 && putDraft.json?.code === "SYSTEM_ENTRY_READ_ONLY" && delDraft.status === 409 && delDraft.json?.code === "SYSTEM_ENTRY_READ_ONLY", { p: [putDraft.status, putDraft.json], d: [delDraft.status, delDraft.json] });
  ok("S: the system draft is still there and unedited", (await db.query("SELECT memo FROM journal_entries WHERE id = $1", [sysDraft.json?.id])).rows[0]?.memo === "will become a system draft", null);

  // a manual journal reverses as before, and so does the reversal of a manual journal
  const man = await C.journal(curStart, lines, { memo: "manual, to be reversed" });
  const rMan = await reverse(man.json?.id);
  ok("S: reversing a MANUAL journal -> 200 as before", man.status === 200 && rMan.status === 200 && !!rMan.json?.reversalId, { m: man.status, s: rMan.status, j: rMan.json });
  const reRev = await reverse(rMan.json?.reversalId);
  // Teardown 8: a reversal is not reversed again (that posted a second reversal, a third leg); it is voided, which re-opens the original.
  ok("S: the reversal of a manual journal cannot be reversed again (409 REVERSAL_NOT_REVERSIBLE)", reRev.status === 409 && reRev.json?.code === "REVERSAL_NOT_REVERSIBLE", { s: reRev.status, j: reRev.json });
  const delMan = await C.journal(curStart, lines, { status: "draft", memo: "manual draft" });
  const delOk = await api("DELETE", `/api/journal/${delMan.json?.id}`, { token: C.token });
  // (the 5-year FTA retention rule refuses every delete, manual or not; what matters is that the manual draft is not treated as a system entry)
  ok("S: a manual draft is not refused as a system entry (its delete is decided by the retention rule, as before)", delOk.json?.code !== "SYSTEM_ENTRY_READ_ONLY", { s: delOk.status, j: delOk.json });
}

// ═════════════════════════════════════════════════════════════════════════════
// A: manual journals to the VAT accounts are VAT adjustments on the return
// ═════════════════════════════════════════════════════════════════════════════
async function sectionA() {
  // ── A1: a correction of over-declared output VAT ────────────────────────────────────────────
  {
    const C = await newCompany("a1out");
    await C.invoice(lastMid, 1000);
    await C.invoice(lastMid, 1000);                                 // output VAT 100
    const vatOut = (await C.account("2020")).id, bank = (await C.account("1020")).id;
    const lines = [{ accountId: vatOut, debit: 50, credit: 0 }, { accountId: bank, debit: 0, credit: 50 }];

    const bare = await C.journal(lastMid, lines);
    ok("A1: a posted journal to a VAT account with no description is refused (400 VAT_JOURNAL_DESCRIPTION_REQUIRED)",
      bare.status === 400 && bare.json?.code === "VAT_JOURNAL_DESCRIPTION_REQUIRED", { s: bare.status, j: bare.json });
    const blank = await C.journal(lastMid, lines, { description: "   " });
    ok("A1: a blank description is refused too", blank.status === 400 && blank.json?.code === "VAT_JOURNAL_DESCRIPTION_REQUIRED", { s: blank.status });
    // (the request also tries to name the system source "vat_filing": it is ignored, see section J)
    const draft = await C.journal(lastMid, lines, { status: "draft", source: "vat_filing" });
    ok("A1: the same journal saved as a DRAFT without a description is accepted", draft.status === 200, { s: draft.status, t: draft.text.slice(0, 200) });
    const post = await api("POST", `/api/journal/${draft.json?.id}/post`, { token: C.token });
    ok("A1: posting that draft without a description is refused", post.status === 400 && post.json?.code === "VAT_JOURNAL_DESCRIPTION_REQUIRED", { s: post.status, j: post.json });
    // Posting by editing is refused outright (C1, Phase 8 D2): a draft is posted only with the post action.
    const put = await api("PUT", `/api/journal/${draft.json?.id}`, { token: C.token, body: { date: lastMid, status: "posted", confirmBackdated: true, lines } });
    ok("A1: posting it through PUT is refused (409 USE_POST_ROUTE)", put.status === 409 && put.json?.code === "USE_POST_ROUTE", { s: put.status, j: put.json });
    const putMemo = await api("PUT", `/api/journal/${draft.json?.id}`, { token: C.token, body: { date: lastMid, memo: "Correct over-declared output VAT (client credit)", confirmBackdated: true, lines } });
    const putOk = putMemo.status === 200 ? await api("POST", `/api/journal/${draft.json?.id}/post`, { token: C.token }) : putMemo;
    ok("A1: with a description the draft posts (200)", putOk.status === 200, { s: putOk.status, t: putOk.text.slice(0, 200) });
    const other = await C.journal(lastMid, [{ accountId: bank, debit: 5, credit: 0 }, { accountId: (await C.account("4010")).id, debit: 0, credit: 5 }]);
    ok("A1: a journal that does not touch VAT needs no description", other.status === 200, { s: other.status });

    const src = (await db.query("SELECT source FROM journal_entries WHERE id = $1", [draft.json?.id])).rows[0]?.source;
    ok("A1/J: the correction that named source 'vat_filing' is stored as manual and is inside the VAT ledger reading (output 100 - 50)",
      src === "manual" && close((await ledgerVat(C, lastStart, lastEnd)).output, 50), { src, l: await ledgerVat(C, lastStart, lastEnd) });

    const e = await engines(C, lastStart, lastEnd);
    const g = e.gen.json;
    ok("A1: the return shows a -50 output adjustment in the company's emirate box (Dubai)", close(g?.box1bDubaiAdj, -50), g && { adj: g.box1bDubaiAdj });
    ok("A1: box 8 adjustment = -50, box 12 = 100 - 50 = 50, box 14 = 50", close(g?.box8TotalAdj, -50) && close(g?.box12TotalDueTax, 50) && close(g?.box14PayableTax, 50), g && { a: g.box8TotalAdj, b12: g.box12TotalDueTax, b14: g.box14PayableTax });
    const list = g?._metadata?.vatAdjustments ?? [];
    ok("A1: the adjustment carries the journal number and its description",
      list.length === 1 && /^JE-/.test(list[0].entryNumber) && /Correct over-declared output VAT/.test(list[0].description) && close(list[0].amount, -50) && list[0].box === "box1bDubaiAdj", list);
    ok("A1: the stored draft return keeps the adjustment lines", (g?.vatAdjustments ?? []).length === 1, g?.vatAdjustments);
    ok("A1: VAT 201, autopilot and firm workpaper agree on box 12 = 50 (and the ledger holds 50)",
      close(e.box12.vat201, 50) && close(e.box12.autopilot, 50) && close(e.box12.firm, 50) && close((await ledgerVat(C, lastStart, lastEnd)).output, 50), { b: e.box12 });
    const filed = await C.file(g?.id);
    ok("A1: filing succeeds with no hand edit and no VAT_LEDGER_MISMATCH", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
    const snap = (await db.query("SELECT snapshot FROM tax_filings WHERE return_id = $1", [g?.id])).rows[0]?.snapshot;
    ok("A1: the filed snapshot records the adjustment (boxes and journal lines)", close(snap?.boxes?.box1bDubaiAdj, -50) && Array.isArray(snap?.vatAdjustments) && snap.vatAdjustments.length === 1, { b: snap?.boxes?.box1bDubaiAdj, a: snap?.vatAdjustments });
    const pay = await api("POST", `/api/vat-returns/${g?.id}/payments`, { token: C.token, body: { amount: 50, date: today, accountId: bank, reference: "VAT-A1" } });
    ok("A1: paying the 50 settles the return", pay.status === 201 && pay.json?.settlement?.status === "paid", { s: pay.status, j: pay.json });
    const bal = await C.balances();
    ok("A1: after payment the VAT accounts and the FTA control account are zero", close(bal["2020"] ?? 0, 0) && close(bal["1050"] ?? 0, 0) && close(bal["2025"] ?? 0, 0), bal);
  }

  // ── A2: an input-side correction lands in box 9 adjustment ──────────────────────────────────
  {
    const D = await newCompany("a2in");
    await D.invoice(lastMid, 1000);                                 // output 50
    const j = await D.journal(lastMid, [{ accountId: (await D.account("1050")).id, debit: 30, credit: 0 }, { accountId: (await D.account("5000")).id, debit: 0, credit: 30 }], { memo: "Recover input VAT missed on supplier invoice 77" });
    ok("A2: (setup) a Dr input VAT 30 correction is posted", j.status === 200, { s: j.status, t: j.text.slice(0, 200) });
    const e = await engines(D, lastStart, lastEnd);
    const g = e.gen.json;
    ok("A2: box 9 adjustment = 30, box 11 adjustment = 30, box 13 = 30, box 14 = 50 - 30 = 20",
      close(g?.box9ExpensesAdj, 30) && close(g?.box11TotalAdj, 30) && close(g?.box13RecoverableTax, 30) && close(g?.box14PayableTax, 20), g && { a: g.box9ExpensesAdj, b13: g.box13RecoverableTax, b14: g.box14PayableTax });
    const auto13 = n(e.auto.json?.vat201?.box13RecoverableTax);
    const firm13 = n(e.detail.json?.totals?.box13RecoverableTax);
    ok("A2: autopilot and firm workpaper agree on box 13 = 30", close(auto13, 30) && close(firm13, 30), { auto13, firm13 });
    const filed = await D.file(g?.id);
    ok("A2: filing succeeds", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
    const bal = await D.balances();
    ok("A2: after filing the VAT accounts are zero", close(bal["2020"] ?? 0, 0) && close(bal["1050"] ?? 0, 0), bal);
  }

  // ── A3: reversing a manual VAT journal is an adjustment too (a correction of a correction) ───────
  {
    const R = await newCompany("a3rev");
    await R.invoice(lastMid, 1000);
    const j = await R.journal(lastMid, [{ accountId: (await R.account("2020")).id, debit: 20, credit: 0 }, { accountId: (await R.account("1020")).id, debit: 0, credit: 20 }], { memo: "Correct output VAT, later found wrong" });
    const rev = await api("POST", `/api/journal/${j.json?.id}/reverse`, { token: R.token, body: { reason: "Correction was wrong" } });
    ok("A3: (setup) the manual VAT journal is reversed (dated today)", j.status === 200 && (rev.status === 200 || rev.status === 201), { s: rev.status, t: rev.text.slice(0, 200) });
    const cur = await engines(R, curStart, curEnd);
    const adj = cur.gen.json?._metadata?.vatAdjustments ?? [];
    ok("A3: the reversal shows as a +20 output adjustment in the month it was posted, and the ledger agrees",
      adj.length === 1 && close(adj[0].amount, 20) && close(cur.gen.json?.box1bDubaiAdj, 20) && close(cur.box12.vat201, 20 + 0) && close((await ledgerVat(R, curStart, curEnd)).output, 20), { adj, b12: cur.box12 });
    ok("A3: autopilot and firm workpaper agree (box 12 = 20)", close(cur.box12.autopilot, 20) && close(cur.box12.firm, 20), cur.box12);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// E: a hand edit needs a reason and can never declare less tax than the ledger supports
// ═════════════════════════════════════════════════════════════════════════════
async function sectionE() {
  const patchReturn = (C, rid, body) => api("PATCH", `/api/vat-returns/${rid}`, { token: C.token, body });
  const draftWith = async (label, price = 10000) => {
    const C = await newCompany(label);
    await C.invoice(lastMid, price);                                // output VAT 500 at 10,000
    const g = await C.generate(lastStart, lastEnd);
    return { C, rid: g.json?.id, gen: g.json };
  };
  const nothingFiled = async (C, rid) => (await db.query("SELECT (SELECT count(*) FROM tax_filings WHERE return_id = $1)::int AS f, (SELECT count(*) FROM journal_entries WHERE company_id = $2 AND source = 'vat_filing')::int AS j", [rid, C.cid])).rows[0];

  // ── E1: the reported scenario: box 12 hand-edited from 500 to 0 ─────────────────────────────
  {
    const { C, rid, gen } = await draftWith("e1zero");
    ok("E1: (setup) the draft says box 12 = 500", close(gen?.box12TotalDueTax, 500), gen?.box12TotalDueTax);
    let p = await patchReturn(C, rid, { box12TotalDueTax: 0, box14PayableTax: 0 });
    ok("E1: editing a figure with NO reason is refused (422 MANUAL_EDIT_REASON_REQUIRED)", p.status === 422 && p.json?.code === "MANUAL_EDIT_REASON_REQUIRED", { s: p.status, j: p.json });
    p = await patchReturn(C, rid, { box12TotalDueTax: 0, box14PayableTax: 0, adjustmentReason: "too short" });
    ok("E1: a reason under 10 characters is refused too", p.status === 422 && p.json?.code === "MANUAL_EDIT_REASON_REQUIRED", { s: p.status });
    const untouched = (await db.query("SELECT box12_total_due_tax AS b12, manual_edits FROM vat_returns WHERE id = $1", [rid])).rows[0];
    ok("E1: the refused edits changed nothing", close(untouched.b12, 500) && untouched.manual_edits === null, untouched);
    p = await patchReturn(C, rid, { notes: "resaving the draft", box12TotalDueTax: 500 });
    ok("E1: saving a draft WITHOUT changing a figure needs no reason", p.status === 200, { s: p.status, t: p.text.slice(0, 200) });
    p = await patchReturn(C, rid, { box12TotalDueTax: 0, box14PayableTax: 0, adjustmentReason: "Customer disputes the tax charged" });
    ok("E1: with a written reason (10+ characters) the edit is saved (200)", p.status === 200, { s: p.status, t: p.text.slice(0, 200) });
    const edits = (await db.query("SELECT manual_edits FROM vat_returns WHERE id = $1", [rid])).rows[0].manual_edits;
    ok("E1: manual_edits stores the reason, the user id and the time",
      edits?.log?.length === 1 && edits.log[0].reason === "Customer disputes the tax charged" && edits.log[0].by === C.userId && !Number.isNaN(Date.parse(edits.log[0].at)) && edits.log[0].boxes.includes("box12TotalDueTax"), edits);
    const r = await C.file(rid, { acceptFigures: "stored" });
    ok("E1: filing on the edited figures is refused: 422 VAT_UNDER_DECLARED (VAT charged to customers is not income)", r.status === 422 && r.json?.code === "VAT_UNDER_DECLARED", { s: r.status, j: r.json });
    ok("E1: the refusal shows ledger vs return (500 vs 0)", close(r.json?.details?.ledger?.outputVat, 500) && close(r.json?.details?.returned?.outputVat, 0), r.json?.details);
    const nf = await nothingFiled(C, rid);
    const bal = await C.balances();
    ok("E1: nothing was filed or posted; no gain was booked", nf.f === 0 && nf.j === 0 && close(bal["2020"], -500) && !("5165" in bal) && !("5160" in bal), { nf, bal });
    const back = await C.file(rid, { acceptFigures: "recomputed" });
    ok("E1: the way out is filing the books' figures (201)", back.status === 201, { s: back.status });
  }

  // ── E2: DECLARING MORE tax than the ledger is allowed with a reason, posted to VAT adjustments ─────
  {
    const { C, rid } = await draftWith("e2more");
    await db.query("DELETE FROM accounts WHERE company_id = $1 AND code = '5165'", [C.cid]);   // an older chart: created on demand
    const p = await patchReturn(C, rid, { box12TotalDueTax: 520, box14PayableTax: 520, adjustmentReason: "Omitted supply disclosed voluntarily" });
    ok("E2: (setup) box 12 raised from 500 to 520 with a reason", p.status === 200, { s: p.status, t: p.text.slice(0, 200) });
    const r = await C.file(rid, { acceptFigures: "stored" });
    ok("E2: filing is accepted (201)", r.status === 201, { s: r.status, t: r.text.slice(0, 300) });
    const bal = await C.balances();
    ok("E2: the 20 difference is posted to VAT adjustments (5165), NOT to irrecoverable VAT (5160)", close(bal["5165"], 20) && !("5160" in bal && Math.abs(bal["5160"]) > 0), bal);
    ok("E2: the VAT account is cleared and the control account holds the 520 filed", close(bal["2020"] ?? 0, 0) && close(bal["2025"], -520), bal);
    const memo = (await db.query(`SELECT jl.description FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.source = 'vat_filing' AND a.code = '5165'`, [C.cid])).rows;
    ok("E2: the journal line carries the reason in its description", memo.length === 1 && /Omitted supply disclosed voluntarily/.test(memo[0].description), memo);
    const acct = (await db.query("SELECT type, name_en FROM accounts WHERE company_id = $1 AND code = '5165'", [C.cid])).rows[0];
    ok("E2: the account was created on demand as an expense account named VAT Adjustments", acct?.type === "expense" && /VAT Adjustments/.test(acct?.name_en), acct);
    const fresh = await newCompany("e2chart");
    ok("E2: the default chart of a new company contains 5165 and 5160 as separate accounts", !!(await fresh.account("5165")) && !!(await fresh.account("5160")), null);
  }

  // ── E3: edits recorded before reasons were required ────────────────────────────────────────
  {
    const { C, rid } = await draftWith("e3legacy");
    await db.query(
      `UPDATE vat_returns SET box12_total_due_tax = 520, box14_payable_tax = 520,
              manual_edits = $2::jsonb WHERE id = $1`,
      [rid, JSON.stringify({ boxes: { box12TotalDueTax: { from: 500, to: 520 }, box14PayableTax: { from: 500, to: 520 } }, at: "2026-09-01T00:00:00.000Z", by: C.userId })]);
    let r = await C.file(rid, { acceptFigures: "stored" });
    ok("E3: filing with a recorded edit that has no reason is refused (422 MANUAL_EDIT_REASON_REQUIRED)", r.status === 422 && r.json?.code === "MANUAL_EDIT_REASON_REQUIRED", { s: r.status, j: r.json });
    ok("E3: the refusal names the boxes that lack a reason", (r.json?.details?.boxes ?? []).includes("box12TotalDueTax"), r.json?.details);
    const p = await patchReturn(C, rid, { adjustmentReason: "Reason added after the fact for both figures" });
    ok("E3: a PATCH that only brings a reason covers the earlier edits", p.status === 200, { s: p.status, t: p.text.slice(0, 200) });
    r = await C.file(rid, { acceptFigures: "stored" });
    ok("E3: filing is then accepted", r.status === 201, { s: r.status, t: r.text.slice(0, 300) });
  }

  // ── E4: the input side ─────────────────────────────────────────────────────────────────────
  {
    const C = await newCompany("e4input");
    await C.invoice(lastMid, 1000);                                  // output 50
    await C.bill(lastMid, 400);                                      // input 20 in the ledger
    const g = await C.generate(lastStart, lastEnd);
    const rid = g.json?.id;
    let p = await patchReturn(C, rid, { box13RecoverableTax: 35, box14PayableTax: 15, adjustmentReason: "Supplier invoice found later" });
    ok("E4: (setup) recoverable input VAT raised from 20 to 35", p.status === 200, { s: p.status });
    let r = await C.file(rid, { acceptFigures: "stored" });
    ok("E4: recoverable input VAT above the ledger's 20 is refused (422 VAT_UNDER_DECLARED)", r.status === 422 && r.json?.code === "VAT_UNDER_DECLARED", { s: r.status, j: r.json });
    ok("E4: the refusal shows the ledger's input VAT (20) against the return (35)", close(r.json?.details?.ledger?.inputVat, 20) && close(r.json?.details?.returned?.inputVat, 35), r.json?.details);

    p = await patchReturn(C, rid, { box13RecoverableTax: 10, box14PayableTax: 40, adjustmentReason: "Entertainment: input tax blocked (Art. 53)" });
    ok("E4: (setup) recoverable input VAT lowered from 20 to 10 (declares MORE tax)", p.status === 200, { s: p.status });
    r = await C.file(rid, { acceptFigures: "stored" });
    ok("E4: lowering the recoverable input VAT is accepted (201)", r.status === 201, { s: r.status, t: r.text.slice(0, 300) });
    const bal = await C.balances();
    ok("E4: the 10 not recovered is posted to VAT adjustments; the VAT accounts clear", close(bal["5165"], 10) && close(bal["1050"] ?? 0, 0) && close(bal["2020"] ?? 0, 0) && close(bal["2025"], -40), bal);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// N: an opening invoice number that jumps the sequence is warned about and recorded
// ═════════════════════════════════════════════════════════════════════════════
async function sectionN() {
  const yr = now.getUTCFullYear();
  const numb = (k) => `INV-${yr}-${String(k).padStart(5, "0")}`;
  const O = await newCompany("nseq");
  const first = await api("POST", `/api/companies/${O.cid}/invoices`, {
    token: O.token, body: { customerName: "First Co", date: today, dueDate: today, lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 0.05 }] },
  });
  ok("N: (setup) the company has issued INV-<year>-00001", first.json?.number === numb(1), { s: first.status, n: first.json?.number });
  const body = (extra) => ({
    asOfDate: `${yr}-01-01`,
    rows: [{ accountCode: "1040", debit: 1000, credit: 0 }],
    invoices: [{ party: "Old Customer", number: numb(500), date: `${yr - 1}-12-15`, amount: 1000, currency: "AED" }],
    ...extra,
  });
  const preview = await api("POST", `/api/companies/${O.cid}/opening-balances/preview`, { token: O.token, body: body() });
  ok("N: the preview is still ok (a warning does not block)", preview.status === 200 && preview.json?.ok === true, { s: preview.status, j: preview.json?.errors });
  const w = preview.json?.warnings ?? [];
  ok("N: the preview has a warnings array with the numbering jump", Array.isArray(preview.json?.warnings) && w.length === 1 && w[0].code === "INVOICE_NUMBER_GAP", preview.json?.warnings);
  ok("N: the warning states the next number (00501) and the size of the gap (498)",
    w[0]?.details?.nextNumber === numb(501) && w[0]?.details?.gap === 498 && w[0]?.message.includes(numb(501)) && w[0]?.message.includes("498") && w[0]?.message.includes(numb(2)) && w[0]?.message.includes(numb(499)), w[0]);

  const consecutive = await api("POST", `/api/companies/${O.cid}/opening-balances/preview`, {
    token: O.token, body: body({ invoices: [{ party: "Old Customer", number: numb(2), date: `${yr - 1}-12-15`, amount: 1000, currency: "AED" }] }),
  });
  ok("N: an imported number that simply continues the sequence gives no warning", consecutive.status === 200 && Array.isArray(consecutive.json?.warnings) && consecutive.json.warnings.length === 0, consecutive.json?.warnings);
  const foreign = await api("POST", `/api/companies/${O.cid}/opening-balances/preview`, {
    token: O.token, body: body({ invoices: [{ party: "Old Customer", number: "OLD-500", date: `${yr - 1}-12-15`, amount: 1000, currency: "AED" }] }),
  });
  ok("N: a number in another format (the sequence is untouched) gives no warning", foreign.status === 200 && foreign.json?.warnings?.length === 0, foreign.json?.warnings);

  const posted = await api("POST", `/api/companies/${O.cid}/opening-balances`, { token: O.token, body: body() });
  ok("N: posting works as before (201)", posted.status === 201, { s: posted.status, t: posted.text.slice(0, 300) });
  const audit = (await db.query("SELECT details FROM audit_logs WHERE action = 'invoice_sequence.jump' AND resource_id = $1", [posted.json?.id])).rows;
  const det = audit[0] ? JSON.parse(audit[0].details) : null;
  ok("N: the jump is recorded in the audit log (numbers, gap, next number)", audit.length === 1 && det?.after?.gap === 498 && det?.after?.nextNumber === numb(501), audit);
  const nxt = await api("POST", `/api/companies/${O.cid}/invoices`, {
    token: O.token, body: { customerName: "Next Co", date: today, dueDate: today, lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 0.05 }] },
  });
  ok("N: the numbering behaviour is unchanged: the next invoice is INV-<year>-00501", nxt.json?.number === numb(501), { s: nxt.status, n: nxt.json?.number });
}

main().catch((e) => { console.error(e); process.exit(1); });
