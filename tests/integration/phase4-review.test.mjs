// Integration tests for the Phase 4 review defects: live requests against a running server + Postgres.
//   D4  a document cannot slip into a month after it is filed and locked (per-month advisory lock)
//   D3  VAT accounts clear to exactly zero at filing; irrecoverable input VAT is expensed
//   D5  filing recomputes the return from the books (stale draft / hand-edited draft)
//   D1  opening-balance invoice numbers can never block the invoice sequence
//   D2  corporate tax for a closed year: accrual dated in the tax year, no period-lock block
//   +   legacy filed VAT returns get a snapshot; tax_filings rows cannot be deleted
//   BASE_URL=http://localhost:5056 DATABASE_URL=... node tests/integration/phase4-review.test.mjs
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
  const started = Date.now();
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ms: Date.now() - started };
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;

const ymd = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const today = ymd(now);
const curYear = now.getUTCFullYear();
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevStart = prevEnd.slice(0, 8) + "01";
const prevMid = prevEnd.slice(0, 8) + "15";

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
  const draft = async (date, unitPrice, extra = {}) => {
    const r1 = await api("POST", `/api/companies/${cid}/invoices`, {
      token, body: { customerName: "Review Co", date, dueDate: date, lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 0.05 }], ...extra },
    });
    if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 200));
    return r1.json;
  };
  const invoice = async (date, unitPrice, extra = {}) => {
    const inv = await draft(date, unitPrice, extra);
    const r2 = await api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "sent" } });
    if (r2.status !== 200) throw new Error("issue failed " + r2.status + " " + r2.text.slice(0, 200));
    return inv;
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
  const generate = (start = prevStart, end = prevEnd) =>
    api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: start, periodEnd: end } });
  const file = (rid, body = {}) =>
    api("POST", `/api/vat-returns/${rid}/file`, { token, body: { ftaReferenceNumber: `RV-${rnd}-${Math.random().toString(36).slice(2, 6)}`, filedAt: today, ...body } });
  return { token, cid, userId, account, accounts, balances, draft, invoice, bill, generate, file };
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const only = process.env.ONLY;
    const want = (name) => !only || only.split(",").includes(name);
    if (want("D4")) await sectionD4();
    if (want("D3")) await sectionD3();
    if (want("D5")) await sectionD5();
    if (want("D1")) await sectionD1();
    if (want("D2")) await sectionD2();
    if (want("legacy")) await sectionLegacy();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ═════════════════════════════════════════════════════════════════════════════
// D4: lock this month  vs  post into this month
// ═════════════════════════════════════════════════════════════════════════════
async function sectionD4() {
  for (let it = 1; it <= 3; it++) {
    const C = await newCompany(`race${it}`);
    await C.invoice(prevMid, 1000);
    const drafts = [];
    for (let i = 0; i < 20; i++) drafts.push((await C.draft(prevMid, 100 + i)).id);
    const gen = await C.generate();
    const rid = gen.json?.id;
    const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token: C.token, body: { status: "sent" } });
    // 10 issues, the filing, 10 more issues: all started together
    const started = Date.now();
    // the filing starts a few milliseconds into the burst (a different offset each run), so some
    // issues are already in flight when it asks for the lock and some arrive after it holds it
    const offset = [6, 14, 28][it - 1];
    const later = (ms, fn) => new Promise((resolve, reject) => setTimeout(() => fn().then(resolve, reject), ms));
    const calls = [
      ...drafts.slice(0, 10).map((id) => issue(id)),
      later(offset, () => C.file(rid)),
      ...drafts.slice(10).map((id) => later(offset - 4, () => issue(id))),
    ];
    const results = await Promise.all(calls);
    const filing = results[10];
    const issues = [...results.slice(0, 10), ...results.slice(11)];
    const total = Date.now() - started;
    const okCount = issues.filter((r) => r.status === 200).length;
    const refused = issues.filter((r) => r.status === 403 && /locked period/i.test(r.text));
    console.log(`INFO  D4 run ${it}: ${okCount} issues succeeded before the lock, ${refused.length} were refused as locked, max wait ${Math.max(...results.map((r) => r.ms))} ms`);
    ok(`D4 run ${it}: the filing itself succeeds (201)`, filing.status === 201, { s: filing.status, t: filing.text.slice(0, 300) });
    ok(`D4 run ${it}: every issue got success-before-lock (200) or a clean period-locked refusal (403)`,
      okCount + refused.length === 20, issues.filter((r) => r.status !== 200 && !(r.status === 403 && /locked period/i.test(r.text))).map((r) => ({ s: r.status, t: r.text.slice(0, 120) })));
    ok(`D4 run ${it}: no request returned a 5xx or timed out; none waited near the 10 s pool timeout`,
      results.every((r) => r.status < 500) && results.every((r) => r.ms < 8000), { maxMs: Math.max(...results.map((r) => r.ms)), statuses: results.map((r) => r.status) });
    const bal = await C.balances();
    ok(`D4 run ${it}: the VAT accounts are exactly zero after filing (nothing slipped in after the clearing entry)`,
      close(bal["2020"] ?? 0, 0) && close(bal["1050"] ?? 0, 0), { b2020: bal["2020"], b1050: bal["1050"] });
    const order = (await db.query(
      `SELECT count(*)::int AS late FROM journal_entries je
        WHERE je.company_id = $1 AND je.date::date BETWEEN $2::date AND $3::date AND je.source <> 'vat_filing'
          AND je.created_at > (SELECT created_at FROM journal_entries WHERE company_id = $1 AND source = 'vat_filing' AND source_id = $4)`,
      [C.cid, prevStart, prevEnd, rid])).rows[0];
    ok(`D4 run ${it}: no journal entry dated in the month was created after the filing's clearing entry`, order.late === 0, order);
    const inMonth = (await db.query(
      `SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND date::date BETWEEN $2::date AND $3::date AND source <> 'vat_filing' AND status = 'posted'`,
      [C.cid, prevStart, prevEnd])).rows[0].c;
    ok(`D4 run ${it}: the entries in the month are exactly the issues that returned 200 (+1 for the first invoice)`, inMonth === okCount + 1, { inMonth, okCount });
    const health = await fetch(BASE + "/health/ready");
    ok(`D4 run ${it}: /health/ready still answers 200 (${total} ms for the whole race)`, health.status === 200, health.status);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// D3: VAT accounts clear to exactly zero from the ledger
// ═════════════════════════════════════════════════════════════════════════════
async function sectionD3() {
  const fresh = await newCompany("d3chart");
  ok("D3: the default chart contains the irrecoverable VAT expense, corporate tax expense and payable accounts",
    !!(await fresh.account("5160")) && !!(await fresh.account("5150")) && !!(await fresh.account("2060")), null);

  const P = await newCompany("d3pe", { exempt: 0.2 });
  await P.invoice(prevMid, 1000);                 // output VAT 50
  await P.bill(prevMid, 4000);                    // input VAT 200 in the ledger
  // an existing company whose chart lacks the account: it is created on demand
  await db.query("DELETE FROM accounts WHERE company_id = $1 AND code = '5160'", [P.cid]);
  const gen = await P.generate();
  ok("D3: partial exemption 20%: box 12 = 50, box 13 = 160, box 14 = -110",
    close(gen.json?.box12TotalDueTax, 50) && close(gen.json?.box13RecoverableTax, 160) && close(gen.json?.box14PayableTax, -110), gen.json);
  const filed = await P.file(gen.json?.id);
  ok("D3: the return is recorded as filed (201)", filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
  let bal = await P.balances();
  ok("D3: after filing, output VAT (2020) and input VAT (1050) are exactly zero", close(bal["2020"] ?? 0, 0) && close(bal["1050"] ?? 0, 0), bal);
  ok("D3: the irrecoverable 40 is expensed on the Irrecoverable VAT account (5160), created on demand", close(bal["5160"], 40), bal);
  ok("D3: the FTA control account holds the refund per the return (110 debit)", close(bal["2025"], 110), bal);
  const pay = await api("POST", `/api/vat-returns/${gen.json?.id}/payments`, {
    token: P.token, body: { amount: 110, date: today, accountId: (await P.account("1020")).id, reference: "REFUND" },
  });
  ok("D3: the FTA refund of 110 is received in full", pay.status === 201 && pay.json?.settlement?.status === "paid", { s: pay.status, j: pay.json });
  bal = await P.balances();
  ok("D3: after filing + full settlement 1050 = 2020 = 2025 = 0 and the expense shows 40",
    close(bal["1050"] ?? 0, 0) && close(bal["2020"] ?? 0, 0) && close(bal["2025"] ?? 0, 0) && close(bal["5160"], 40), bal);
  const clearing = (await db.query(
    `SELECT a.code, jl.debit, jl.credit, jl.description FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'vat_filing'`, [P.cid])).rows;
  ok("D3: the clearing entry balances to the fils", close(clearing.reduce((s, l) => s + n(l.debit), 0), clearing.reduce((s, l) => s + n(l.credit), 0), 0.0001), clearing);

  // a large gap between the books and the return is investigated, not written off
  const M = await newCompany("d3mis");
  await M.invoice(prevMid, 1000);
  await M.bill(prevMid, 4000);
  const je = await api("POST", `/api/companies/${M.cid}/journal`, {
    token: M.token, body: { date: prevMid, memo: "stray VAT", status: "posted", confirmBackdated: true, lines: [{ accountId: (await M.account("1050")).id, debit: 45, credit: 0 }, { accountId: (await M.account("5000")).id, debit: 0, credit: 45 }] },
  });
  ok("D3: (setup) a manual journal put 45 of extra VAT into the input VAT account", je.status === 200, { s: je.status, t: je.text.slice(0, 200) });
  const genM = await M.generate();
  const refused = await M.file(genM.json?.id);
  ok("D3: a 45 gap between ledger and return is refused with 422 VAT_LEDGER_MISMATCH",
    refused.status === 422 && refused.json?.code === "VAT_LEDGER_MISMATCH", { s: refused.status, j: refused.json });
  ok("D3: the refusal returns both figures and the per-account differences",
    refused.json?.details?.ledger && refused.json?.details?.returned && close(refused.json?.details?.differences?.inputVat, 45), refused.json?.details);
  const nothing = (await db.query("SELECT (SELECT count(*) FROM tax_filings WHERE return_id = $1)::int AS f, (SELECT count(*) FROM journal_entries WHERE company_id = $2 AND source = 'vat_filing')::int AS j", [genM.json?.id, M.cid])).rows[0];
  ok("D3: the refused filing left no filing record and no journal", nothing.f === 0 && nothing.j === 0, nothing);
}

// ═════════════════════════════════════════════════════════════════════════════
// D5: filing recomputes from the books
// ═════════════════════════════════════════════════════════════════════════════
async function sectionD5() {
  // stale draft
  const S = await newCompany("d5stale");
  await S.invoice(prevMid, 1000);                                    // VAT 50
  const gen = await S.generate();
  await S.invoice(prevMid, 500);                                     // posted AFTER the draft was generated: VAT 25
  const filed = await S.file(gen.json?.id);
  ok("D5 stale draft: filing succeeds (201) and says it recomputed at filing",
    filed.status === 201 && filed.json?.recomputedAtFiling === true, { s: filed.status, r: filed.json?.recomputedAtFiling, t: filed.text.slice(0, 200) });
  const diff = filed.json?.differences ?? [];
  ok("D5 stale draft: the response lists the per-box differences (box 12: 50 -> 75)",
    diff.some((d) => d.box === "box12TotalDueTax" && close(d.filed, 50) && close(d.current, 75)), diff);
  const snap = (await db.query("SELECT snapshot FROM tax_filings WHERE return_id = $1", [gen.json?.id])).rows[0]?.snapshot;
  ok("D5 stale draft: the snapshot stores the recomputed figures (box 12 = 75)", close(snap?.boxes?.box12TotalDueTax, 75), snap?.boxes?.box12TotalDueTax);
  let bal = await S.balances();
  ok("D5 stale draft: output VAT is cleared to zero and the control account holds 75", close(bal["2020"] ?? 0, 0) && close(bal["2025"], -75), bal);

  // an unchanged draft is not flagged
  const U = await newCompany("d5same");
  await U.invoice(prevMid, 1000);
  const genU = await U.generate();
  const fu = await U.file(genU.json?.id);
  ok("D5 fresh draft: no recompute is reported when nothing changed", fu.status === 201 && !fu.json?.recomputedAtFiling, { s: fu.status, r: fu.json?.recomputedAtFiling });

  // hand-edited draft: box 12 PATCHed from 50 to 5
  const editDraft = async (label) => {
    const H = await newCompany(label);
    await H.invoice(prevMid, 1000);
    const g = await H.generate();
    const rid = g.json?.id;
    const p = await api("PATCH", `/api/vat-returns/${rid}`, { token: H.token, body: { box12TotalDueTax: 5, box14PayableTax: 5, adjustmentReason: "Client-agreed correction" } });
    if (p.status !== 200) throw new Error("patch failed " + p.status + " " + p.text.slice(0, 200));
    return { H, rid };
  };
  const { H, rid } = await editDraft("d5edit");
  let r = await H.file(rid);
  ok("D5 hand-edited draft: filing is refused with 409 VAT_RETURN_STALE", r.status === 409 && r.json?.code === "VAT_RETURN_STALE", { s: r.status, j: r.json });
  ok("D5 hand-edited draft: the refusal shows stored vs recomputed per box",
    r.json?.details?.differences?.some((d) => d.box === "box12TotalDueTax" && close(d.filed, 5) && close(d.current, 50)), r.json?.details);
  const untouched = (await db.query("SELECT (SELECT count(*) FROM tax_filings WHERE return_id = $1)::int AS f, (SELECT count(*) FROM journal_entries WHERE company_id = $2 AND source = 'vat_filing')::int AS j", [rid, H.cid])).rows[0];
  ok("D5 hand-edited draft: nothing was filed or posted by the refused attempt", untouched.f === 0 && untouched.j === 0, untouched);
  r = await H.file(rid, { acceptFigures: "bogus" });
  ok("D5: an invalid acceptFigures value is a 400", r.status === 400, { s: r.status, j: r.json });
  r = await H.file(rid, { acceptFigures: "recomputed" });
  ok("D5 hand-edited draft: acceptFigures=recomputed files the books' figures (201)", r.status === 201 && r.json?.recomputedAtFiling === true, { s: r.status, t: r.text.slice(0, 200) });
  const s2 = (await db.query("SELECT snapshot FROM tax_filings WHERE return_id = $1", [rid])).rows[0]?.snapshot;
  bal = await H.balances();
  ok("D5 hand-edited draft: with recomputed figures box 12 = 50 and the VAT accounts are cleared", close(s2?.boxes?.box12TotalDueTax, 50) && close(bal["2020"] ?? 0, 0) && close(bal["2025"], -50), { box12: s2?.boxes?.box12TotalDueTax, bal });

  // the user insists on the stored (edited) figures
  const E2 = await editDraft("d5keep");
  r = await E2.H.file(E2.rid, { acceptFigures: "stored" });
  ok("D5 hand-edited draft: acceptFigures=stored files the user's figures (201) because the gap is explained by the recorded edit",
    r.status === 201 && !r.json?.recomputedAtFiling, { s: r.status, t: r.text.slice(0, 300) });
  bal = await E2.H.balances();
  ok("D5 stored figures: output VAT clears to zero, control holds the 5 filed, the 45 gap is posted to the adjustment expense line",
    close(bal["2020"] ?? 0, 0) && close(bal["2025"], -5) && close(bal["5160"], -45), bal);
  const memo = (await db.query(`SELECT jl.description FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.source = 'vat_filing' AND a.code = '5160'`, [E2.H.cid])).rows;
  ok("D5 stored figures: the adjustment line carries the user's reason", memo.some((m) => /Client-agreed correction/.test(m.description ?? "")), memo);

  // stored figures with an UNEXPLAINED gap (books changed, not the edit) are still refused
  const E3 = await editDraft("d5gap");
  await api("POST", `/api/companies/${E3.H.cid}/journal`, {
    token: E3.H.token, body: { date: prevMid, memo: "stray VAT", status: "posted", confirmBackdated: true, lines: [{ accountId: (await E3.H.account("2020")).id, debit: 0, credit: 70 }, { accountId: (await E3.H.account("5000")).id, debit: 70, credit: 0 }] },
  });
  r = await E3.H.file(E3.rid, { acceptFigures: "stored" });
  ok("D5 stored figures: a gap NOT explained by the recorded edits is refused (422 VAT_LEDGER_MISMATCH)", r.status === 422 && r.json?.code === "VAT_LEDGER_MISMATCH", { s: r.status, j: r.json });
}

// ═════════════════════════════════════════════════════════════════════════════
// D1: opening numbers can never block the invoice sequence
// ═════════════════════════════════════════════════════════════════════════════
async function sectionD1() {
  const O = await newCompany("d1open");
  const num = (k) => `INV-${curYear}-${String(k).padStart(5, "0")}`;
  const asOf = `${curYear}-01-01`;
  const r = await api("POST", `/api/companies/${O.cid}/opening-balances`, {
    token: O.token,
    body: {
      asOfDate: asOf,
      rows: [{ accountCode: "1040", debit: 1000, credit: 0 }],
      invoices: [
        { party: "Old A", number: num(1), date: `${curYear - 1}-11-20`, amount: 400, currency: "AED" },
        { party: "Old B", number: num(3), date: `${curYear - 1}-12-10`, amount: 600, currency: "AED" },
      ],
    },
  });
  ok("D1: opening invoices numbered INV-<year>-00001 and -00003 are accepted", r.status === 201, { s: r.status, t: r.text.slice(0, 300) });
  const created = [];
  for (let i = 0; i < 3; i++) {
    const res = await api("POST", `/api/companies/${O.cid}/invoices`, {
      token: O.token, body: { customerName: "Normal Co", date: today, dueDate: today, lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 0.05 }] },
    });
    created.push(res);
  }
  ok("D1: three normal invoices after the opening ones all succeed", created.every((c) => c.status === 200 && c.json?.number), created.map((c) => ({ s: c.status, t: c.text.slice(0, 120) })));
  const numbers = created.map((c) => c.json?.number);
  ok("D1: their numbers are unique and none equals an opening number", new Set(numbers).size === 3 && !numbers.includes(num(1)) && !numbers.includes(num(3)), numbers);
  ok("D1: numbering continues after the highest imported number (00004, 00005, 00006)", JSON.stringify(numbers) === JSON.stringify([num(4), num(5), num(6)]), numbers);

  // a number taken by ANY document is skipped inside the same transaction
  const K = await newCompany("d1skip");
  for (const k of [1, 2]) {
    await db.query(
      `INSERT INTO invoices (company_id, number, customer_name, date, subtotal, vat_amount, total, status) VALUES ($1, $2, 'Imported', now(), 10, 0.5, 10.5, 'draft')`,
      [K.cid, num(k)]);
  }
  const mk = () => api("POST", `/api/companies/${K.cid}/invoices`, { token: K.token, body: { customerName: "Skip Co", date: today, dueDate: today, lines: [{ description: "Work", quantity: 1, unitPrice: 10, vatRate: 0.05 }] } });
  const s1 = await mk();
  const s2 = await mk();
  ok("D1: with 00001 and 00002 already taken the next invoice is 00003, then 00004 (no 409, no retry loop)",
    s1.status === 200 && s1.json?.number === num(3) && s2.status === 200 && s2.json?.number === num(4), { a: [s1.status, s1.json?.number], b: [s2.status, s2.json?.number] });
  const seq = (await db.query("SELECT last_value FROM invoice_number_sequences WHERE company_id = $1 AND doc_type = 'invoice' AND year = $2", [K.cid, curYear])).rows[0];
  ok("D1: the sequence recorded the number actually used", n(seq?.last_value) === 4, seq);

  // credit notes share the pattern
  const L = await newCompany("d1cn");
  const inv = await L.invoice(prevMid, 1000);
  await db.query(
    `INSERT INTO invoices (company_id, number, customer_name, date, subtotal, vat_amount, total, status) VALUES ($1, $2, 'Imported', now(), 10, 0.5, 10.5, 'draft')`,
    [L.cid, `CN-${curYear}-00001`]);
  const cn = await api("POST", `/api/companies/${L.cid}/invoices/${inv.id}/credit-note`, { token: L.token, body: {} });
  ok("D1: a credit note skips a taken CN number (CN-<year>-00002)", cn.status === 201 || cn.status === 200 ? (cn.json?.number ?? cn.json?.creditNote?.number) === `CN-${curYear}-00002` : false, { s: cn.status, t: cn.text.slice(0, 200) });

  // quotes: an imported number does not break server-side allocation
  const Q = await newCompany("d1quote");
  const qb = (extra = {}) => ({ customerName: "Q Co", date: now.toISOString(), lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.05 }], ...extra });
  const q1 = await api("POST", `/api/companies/${Q.cid}/quotes`, { token: Q.token, body: qb({ number: `QT-${curYear}-00001` }) });
  const q2 = await api("POST", `/api/companies/${Q.cid}/quotes`, { token: Q.token, body: qb() });
  ok("D1: a quote created after an imported QT-<year>-00001 gets 00002", q1.status === 201 && q2.status === 201 && q2.json?.number === `QT-${curYear}-00002`, { a: [q1.status, q1.json?.number], b: [q2.status, q2.text.slice(0, 160)] });
}

// ═════════════════════════════════════════════════════════════════════════════
// D2: corporate tax for a closed year
// ═════════════════════════════════════════════════════════════════════════════
async function ctCompany(label) {
  const yr = curYear - 1;
  const C = await newCompany(label, { vat: false });
  await C.invoice(`${yr}-06-15`, 500000);          // year 1 revenue
  await C.invoice(`${yr + 1}-01-01`, 100000);      // year 2 revenue
  return { C, yr };
}

async function createComputeFile(C, yr, tag) {
  const base = "/api/corporate-tax/returns";
  const created = await api("POST", `/api/companies/${C.cid}/corporate-tax/returns`, { token: C.token, body: { taxPeriodStart: `${yr}-01-01`, taxPeriodEnd: `${yr}-12-31` } });
  ok(`D2 ${tag}: creating the CT return for the year is not blocked by the period lock (201)`, created.status === 201, { s: created.status, t: created.text.slice(0, 200) });
  const id = created.json?.id;
  const pull = await api("POST", `${base}/${id}/pull-from-books`, { token: C.token, body: {} });
  ok(`D2 ${tag}: pulling from the books is not blocked (200)`, pull.status === 200, { s: pull.status, t: pull.text.slice(0, 200) });
  await api("PATCH", `${base}/${id}`, { token: C.token, body: { totalRevenue: 500000, totalExpenses: 0, totalDeductions: 0 } });
  const comp = await api("POST", `${base}/${id}/compute`, { token: C.token, body: {} });
  ok(`D2 ${tag}: computing is not blocked and gives 11,250`, comp.status === 200 && close(comp.json?.return?.taxPayable, 11250), { s: comp.status, tax: comp.json?.return?.taxPayable, t: comp.text.slice(0, 200) });
  const filed = await api("POST", `${base}/${id}/file`, { token: C.token, body: { ftaReferenceNumber: `CT-${rnd}-${tag}`, filedAt: today } });
  ok(`D2 ${tag}: filing succeeds for the closed/ended year (201)`, filed.status === 201, { s: filed.status, t: filed.text.slice(0, 300) });
  return { id, filed };
}

async function assertCtEndState(C, yr, tag, retId) {
  const acc = (await db.query(
    `SELECT to_char(je.date,'YYYY-MM-DD') AS d, a.code, jl.debit, jl.credit FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'corporate_tax_filing' AND je.source_id = $2`, [C.cid, retId])).rows;
  ok(`D2 ${tag}: the accrual is dated the last day of the tax year (${yr}-12-31), Dr 5150 / Cr 2060 11,250`,
    acc.length === 2 && acc.every((l) => l.d === `${yr}-12-31`) && close(acc.find((l) => l.code === "5150")?.debit, 11250) && close(acc.find((l) => l.code === "2060")?.credit, 11250), acc);
  const pl1 = await api("GET", `/api/companies/${C.cid}/financial-statements/profit-loss?startDate=${yr}-01-01&endDate=${yr}-12-31`, { token: C.token });
  const pl2 = await api("GET", `/api/companies/${C.cid}/financial-statements/profit-loss?startDate=${yr + 1}-01-01&endDate=${yr + 1}-12-31`, { token: C.token });
  ok(`D2 ${tag}: the year-1 P&L includes the CT expense (expenses 11,250, revenue 500,000)`, close(pl1.json?.expenses, 11250) && close(pl1.json?.revenue, 500000), { e: pl1.json?.expenses, r: pl1.json?.revenue });
  ok(`D2 ${tag}: the year-2 P&L does NOT carry it (expenses 0, revenue 100,000)`, close(pl2.json?.expenses, 0) && close(pl2.json?.revenue, 100000), { e: pl2.json?.expenses, r: pl2.json?.revenue });
  const net1 = (await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.date::date BETWEEN $2::date AND $3::date AND a.type IN ('income', 'expense')`,
    [C.cid, `${yr}-01-01`, `${yr}-12-31`])).rows[0].net;
  ok(`D2 ${tag}: after the close, year-1 income and expense accounts net to zero`, close(net1, 0), net1);
  const exp2 = (await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.date::date >= $2::date AND a.code = '5150'`, [C.cid, `${yr + 1}-01-01`])).rows[0].net;
  ok(`D2 ${tag}: nothing was booked to 5150 in year 2`, close(exp2, 0), exp2);
  for (const asOf of [`${yr}-12-31`, today]) {
    const bs = await api("GET", `/api/companies/${C.cid}/financial-statements/balance-sheet?asOfDate=${asOf}`, { token: C.token });
    const payable = (bs.json?.liabilities?.breakdown ?? []).find((r) => r.accountCode === "2060");
    ok(`D2 ${tag}: the balance sheet at ${asOf} balances (A = L + E) with the tax payable as a liability`,
      bs.json?.isBalanced === true && close(payable?.amount, 11250), { balanced: bs.json?.isBalanced, payable, a: bs.json?.assets?.total, l: bs.json?.liabilities?.total, e: bs.json?.equity?.total });
  }
  const tb = await api("GET", `/api/companies/${C.cid}/reports/trial-balance?to=${today}`, { token: C.token });
  const sumD = (tb.json?.rows ?? []).reduce((s, r) => s + n(r.totalDebit), 0), sumC = (tb.json?.rows ?? []).reduce((s, r) => s + n(r.totalCredit), 0);
  ok(`D2 ${tag}: the trial balance balances`, tb.status === 200 && close(sumD, sumC, 0.01), { sumD, sumC });
  const all = (await db.query(`SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1 AND je.status = 'posted'`, [C.cid])).rows[0];
  ok(`D2 ${tag}: total debits equal total credits in the ledger`, close(all.d, all.c, 0.001), all);
}

async function sectionD2() {
  // case 1: close the year, THEN prepare and file corporate tax
  const { C, yr } = await ctCompany("d2close");
  const closed = await api("POST", `/api/companies/${C.cid}/year-end/close`, { token: C.token, body: { yearStart: `${yr}-01-01` } });
  ok("D2 close-first: year 1 is closed (201)", closed.status === 201, { s: closed.status, t: closed.text.slice(0, 200) });
  const { id } = await createComputeFile(C, yr, "close-first");
  const closing = (await db.query(
    `SELECT to_char(je.date,'YYYY-MM-DD') AS d, a.code, jl.debit, jl.credit FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'year_end_close' AND je.source_id = $2`, [C.cid, id])).rows;
  ok("D2 close-first: an accompanying closing entry (Dr retained earnings / Cr 5150, same date, source year_end_close) is linked to the return",
    closing.length === 2 && closing.every((l) => l.d === `${yr}-12-31`) && close(closing.find((l) => l.code === "5150")?.credit, 11250) && close(closing.find((l) => l.code === "3020")?.debit, 11250), closing);
  const audit = (await db.query(`SELECT count(*)::int AS c FROM audit_logs WHERE resource_id = $1 AND action = 'tax_filing.locked_period_accrual'`, [id])).rows[0];
  ok("D2 close-first: the bypass of the locked period is audited", audit.c === 1, audit);
  await assertCtEndState(C, yr, "close-first", id);

  // case 2: file corporate tax BEFORE the year-end close, then close
  const B = await ctCompany("d2file");
  const second = await createComputeFile(B.C, B.yr, "file-first");
  const noClosingLine = (await db.query(`SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'year_end_close' AND source_id = $2`, [B.C.cid, second.id])).rows[0];
  ok("D2 file-first: an open year gets only the accrual (no closing line)", noClosingLine.c === 0, noClosingLine);
  const closedLater = await api("POST", `/api/companies/${B.C.cid}/year-end/close`, { token: B.C.token, body: { yearStart: `${B.yr}-01-01` } });
  ok("D2 file-first: closing the year afterwards succeeds (201)", closedLater.status === 201, { s: closedLater.status, t: closedLater.text.slice(0, 200) });
  await assertCtEndState(B.C, B.yr, "file-first", second.id);

  // existing company without the accounts: created on demand instead of a 422
  const W = await ctCompany("d2acct");
  await db.query("DELETE FROM accounts WHERE company_id = $1 AND code IN ('5150', '2060')", [W.C.cid]);
  const third = await createComputeFile(W.C, W.yr, "on-demand-accounts");
  const made = (await db.query("SELECT code, type FROM accounts WHERE company_id = $1 AND code IN ('5150', '2060') ORDER BY code", [W.C.cid])).rows;
  ok("D2: missing 5150 / 2060 are created at filing time (expense and liability)", made.length === 2 && made[0].type === "liability" && made[1].type === "expense", made);
  ok("D2: the on-demand filing posted the accrual", !!third.id, null);

  // the payment stays dated on the payment date
  const bank = await C.account("1020");
  const pay = await api("POST", `/api/corporate-tax/returns/${id}/payments`, { token: C.token, body: { amount: 11250, date: today, accountId: bank.id } });
  ok("D2: paying the tax is allowed and dated the payment day", pay.status === 201, { s: pay.status, j: pay.json });
  const payEntry = (await db.query(`SELECT to_char(je.date,'YYYY-MM-DD') AS d FROM journal_entries je WHERE je.company_id = $1 AND je.source = 'corporate_tax_payment'`, [C.cid])).rows[0];
  ok("D2: the payment entry is dated the payment date, not the tax year end", payEntry?.d === today, payEntry);
}

// ═════════════════════════════════════════════════════════════════════════════
// Legacy filed returns + tax_filings delete guard
// ═════════════════════════════════════════════════════════════════════════════
async function sectionLegacy() {
  const L = await newCompany("legacy");
  await L.invoice(prevMid, 1000);
  const gen = await L.generate();
  const rid = gen.json?.id;
  // production state: filed by the old flow, no filing record
  await db.query(
    `UPDATE vat_returns SET status = 'filed', fta_reference_number = 'OLD-REF-1', submitted_at = now() - interval '3 days',
            box12_total_due_tax = 999, box13_recoverable_tax = 0, box14_payable_tax = 999 WHERE id = $1`, [rid]);
  const view = await api("GET", `/api/vat-returns/${rid}`, { token: L.token });
  const row = (await db.query("SELECT id, reference_number, snapshot, clearing_entry_id, to_char(filed_at,'YYYY-MM-DD') AS filed_at FROM tax_filings WHERE return_id = $1 AND kind = 'vat'", [rid])).rows[0];
  ok("Legacy: reading a filed return with no snapshot creates one from its stored boxes, flagged legacy",
    view.status === 200 && row?.snapshot?.legacy === true && close(row?.snapshot?.boxes?.box12TotalDueTax, 999) && row?.reference_number === "OLD-REF-1", { s: view.status, row });
  ok("Legacy: filedAt comes from the existing submitted timestamp and no clearing journal is posted",
    row?.filed_at === ymd(new Date(Date.now() - 3 * 86400000)) && row?.clearing_entry_id === null && (await db.query("SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'vat_filing'", [L.cid])).rows[0].c === 0, row);
  ok("Legacy: the read model shows the snapshot as filed, with drift against the books", view.json?.filed === true && view.json?.driftDetected === true, { filed: view.json?.filed, drift: view.json?.driftDetected });
  let tampered = null;
  try { await db.query("UPDATE tax_filings SET snapshot = '{}'::jsonb WHERE return_id = $1", [rid]); } catch (e) { tampered = e.message; }
  ok("Legacy: the snapshot is immutable like any other", /immutable/i.test(tampered ?? ""), tampered);
  const again = await api("GET", `/api/vat-returns/${rid}`, { token: L.token });
  const count = (await db.query("SELECT count(*)::int AS c FROM tax_filings WHERE return_id = $1", [rid])).rows[0].c;
  ok("Legacy: reading again creates no second record (idempotent)", again.status === 200 && count === 1, count);
  const list = await api("GET", `/api/companies/${L.cid}/vat-returns`, { token: L.token });
  ok("Legacy: the list shows the filing reference", (list.json ?? []).find((x) => x.id === rid)?.filing?.referenceNumber === "OLD-REF-1", (list.json ?? [])[0]?.filing);
  const patch = await api("PATCH", `/api/vat-returns/${rid}`, { token: L.token, body: { box12TotalDueTax: 1 } });
  ok("Legacy: the figures are immutable (409)", patch.status === 409, { s: patch.status, j: patch.json });
  const amend = await api("POST", `/api/vat-returns/${rid}/amend`, { token: L.token });
  ok("Legacy: it can be amended through the normal amendment flow (201, differences vs the books)", amend.status === 201 && amend.json?.differences?.length > 0, { s: amend.status, t: amend.text.slice(0, 200) });
  const amdId = amend.json?.amendment?.id;
  const amendFiled = amdId ? await api("POST", `/api/vat-returns/${amdId}/file`, { token: L.token, body: { ftaReferenceNumber: `LEG-AMD-${rnd}`, filedAt: today } }) : null;
  ok("Legacy: the amendment can be filed; it clears only the difference against the legacy figures (201)", amendFiled?.status === 201, { s: amendFiled?.status, t: amendFiled?.text?.slice(0, 300) });

  // DELETE guard
  let del = null;
  try { await db.query("DELETE FROM tax_filings WHERE return_id = $1", [rid]); } catch (e) { del = e.message; }
  ok("Guard: a filing record cannot be deleted", /cannot be deleted|immutable|filed/i.test(del ?? ""), del);
  // (a company that has posted journal lines cannot be deleted at all; use one with a nil return)
  const G = await newCompany("cascade");
  const gg = await G.generate();
  const fg = await G.file(gg.json?.id);
  let cascadeErr = null;
  try { await db.query("DELETE FROM companies WHERE id = $1", [G.cid]); } catch (e) { cascadeErr = e.message; }
  const left = (await db.query("SELECT count(*)::int AS c FROM tax_filings WHERE company_id = $1", [G.cid])).rows[0].c;
  ok("Guard: deleting the company still cascades its filings", fg.status === 201 && cascadeErr === null && left === 0, { filed: fg.status, cascadeErr, left });
}

main().catch((e) => { console.error(e); process.exit(1); });
