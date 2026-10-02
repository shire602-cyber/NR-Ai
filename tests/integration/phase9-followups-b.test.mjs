// Integration tests for the Phase 9 follow-ups (stream B): live requests against a running server + Postgres.
//   1  posting atomicity: issue / void / credit note commit journal and document status together
//   2  recurring templates carry discounts and a shipping line
//   4  employee-role users see only their own HR records
//   BASE_URL=http://localhost:5099 DATABASE_URL=... node tests/integration/phase9-followups-b.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

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
    signal: AbortSignal.timeout(90_000),
  });
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
const prevMid = prevEnd.slice(0, 8) + "15";
const prevStart = prevEnd.slice(0, 8) + "01";
let db;

// One cycle of a background job for a single company, in a separate process (see helpers/run-sales-jobs.ts).
function runJob(job, companyId) {
  const env = { ...process.env, SESSION_SECRET: crypto.randomBytes(24).toString("hex"), JWT_SECRET: crypto.randomBytes(24).toString("hex"), NODE_ENV: "development", LOG_LEVEL: "error" };
  const run = spawnSync("npx", ["tsx", path.join(here, "helpers", "run-sales-jobs.ts"), job, companyId], { env, encoding: "utf8", cwd: path.join(here, "..", "..") });
  const line = (run.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  return { status: run.status, result: line ? JSON.parse(line.slice(7)) : null, err: run.stderr?.slice(-500) };
}

async function newCompany(label, { vat = true } = {}) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  if (vat) await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const draft = async (date, unitPrice, extra = {}) => {
    const r1 = await api("POST", `/api/companies/${cid}/invoices`, {
      token, body: { customerName: "Atomic Co", date, dueDate: date, lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 0.05 }], ...extra },
    });
    if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 200));
    return r1.json;
  };
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });
  const generate = (start = prevStart, end = prevEnd) =>
    api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: start, periodEnd: end } });
  return { token, cid, userId, draft, issue, generate };
}

// Runs `fn` while a trigger raises an exception for the matching write; always removes the trigger.
async function withFault(table, when, fn) {
  const name = "p9b_fault_" + Math.random().toString(36).slice(2, 8);
  await db.query(`CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN
    IF ${when} THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await db.query(`CREATE TRIGGER ${name} BEFORE ${table.op} ON ${table.name} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try {
    return await fn();
  } finally {
    await db.query(`DROP TRIGGER IF EXISTS ${name} ON ${table.name}`).catch(() => {});
    await db.query(`DROP FUNCTION IF EXISTS ${name}()`).catch(() => {});
  }
}

const entriesFor = async (cid, invoiceId) =>
  (await db.query(`SELECT id, status, reversed_entry_id FROM journal_entries WHERE company_id = $1 AND source_id = $2`, [cid, invoiceId])).rows;
const invoiceStatus = async (id) => (await db.query(`SELECT status FROM invoices WHERE id = $1`, [id])).rows[0]?.status;

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await atomicityCrash();
    await atomicityVoidAndCreditNote();
    await atomicityRace();
    await recurringDiscountAndShipping();
    await employeeOwnRecords();
    arabicCoverage();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. A crash between the journal and the status leaves neither
// ═════════════════════════════════════════════════════════════════════════════
async function atomicityCrash() {
  const C = await newCompany("atomA");
  // Stock-tracked product with costing on, so the COGS journal is part of the issue too.
  await api("PATCH", `/api/companies/${C.cid}/preferences`, { token: C.token, body: { inventoryCostingEnabled: true } });
  const p = await api("POST", `/api/companies/${C.cid}/products`, { token: C.token, body: { name: "Atomic widget", unitPrice: "100", vatRate: "0.05", trackInventory: true } });
  await api("POST", `/api/products/${p.json.id}/movements`, { token: C.token, body: { type: "purchase", quantity: 10, unitCost: "40" } });
  const inv = await C.draft(today, 100, { lines: [{ description: "Widget", quantity: 2, unitPrice: 100, vatRate: 0.05, productId: p.json.id }] });

  const crashed = await withFault({ op: "UPDATE", name: "invoices" }, `NEW.company_id = '${C.cid}' AND NEW.status = 'sent' AND OLD.status = 'draft'`, () => C.issue(inv.id));
  ok("issue: a failure at the status write fails the request", crashed.status >= 400, { s: crashed.status });
  ok("issue: the failure does not leak SQL", !/pg_|SELECT |INSERT /i.test(crashed.text ?? ""), crashed.text?.slice(0, 200));
  ok("issue: no revenue journal remains", (await entriesFor(C.cid, inv.id)).length === 0, await entriesFor(C.cid, inv.id));
  ok("issue: no COGS journal and no stock movement remain",
    n((await db.query(`SELECT COUNT(*) AS c FROM journal_entries WHERE company_id = $1 AND source = 'inventory_cogs'`, [C.cid])).rows[0].c) === 0 &&
      n((await db.query(`SELECT COUNT(*) AS c FROM inventory_movements WHERE company_id = $1 AND type = 'sale'`, [C.cid])).rows[0].c) === 0,
    {});
  ok("issue: the stock is untouched", n((await db.query(`SELECT current_stock FROM products WHERE id = $1`, [p.json.id])).rows[0].current_stock) === 10, {});
  ok("issue: the invoice is still a draft", (await invoiceStatus(inv.id)) === "draft", await invoiceStatus(inv.id));

  const again = await C.issue(inv.id);
  ok("issue: once the fault is gone the issue succeeds", again.status === 200 && again.json?.status === "sent", { s: again.status, t: again.text?.slice(0, 200) });
  ok("issue: exactly one revenue journal and one COGS journal",
    (await entriesFor(C.cid, inv.id)).length === 2 && (await invoiceStatus(inv.id)) === "sent", await entriesFor(C.cid, inv.id));
  const twice = await C.issue(inv.id);
  ok("issue: issuing again posts nothing more", twice.status < 500 && (await entriesFor(C.cid, inv.id)).length === 2, { s: twice.status });
}

// ═════════════════════════════════════════════════════════════════════════════
// 1b. Void and credit note are all-or-nothing as well
// ═════════════════════════════════════════════════════════════════════════════
async function atomicityVoidAndCreditNote() {
  const C = await newCompany("atomB");
  const inv = await C.draft(today, 1000);
  await C.issue(inv.id);

  const voidFail = await withFault({ op: "UPDATE", name: "invoices" }, `NEW.company_id = '${C.cid}' AND NEW.status = 'void'`, () =>
    api("PATCH", `/api/invoices/${inv.id}/status`, { token: C.token, body: { status: "void" } }));
  ok("void: a failure at the status write fails the request", voidFail.status >= 400, { s: voidFail.status });
  ok("void: no reversal journal remains", (await entriesFor(C.cid, inv.id)).filter((e) => e.reversed_entry_id).length === 0, await entriesFor(C.cid, inv.id));
  ok("void: the invoice keeps its status", (await invoiceStatus(inv.id)) === "sent", await invoiceStatus(inv.id));

  const cnFail = await withFault({ op: "UPDATE", name: "invoices" }, `NEW.company_id = '${C.cid}' AND NEW.status = 'credited'`, () =>
    api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/credit-note`, { token: C.token, body: {} }));
  ok("credit note: a failure at the original's status sync fails the request", cnFail.status >= 400, { s: cnFail.status });
  const cnRows = (await db.query(`SELECT id FROM invoices WHERE company_id = $1 AND invoice_type = 'credit_note'`, [C.cid])).rows;
  const cnEntries = (await db.query(`SELECT id FROM journal_entries WHERE company_id = $1 AND reversal_reason = 'Credit note issued'`, [C.cid])).rows;
  ok("credit note: neither the credit note nor its journal remains", cnRows.length === 0 && cnEntries.length === 0, { cnRows, cnEntries });

  const voided = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: C.token, body: { status: "void" } });
  ok("void: once the fault is gone the void posts one reversal and sets the status",
    voided.status === 200 && (await invoiceStatus(inv.id)) === "void" && (await entriesFor(C.cid, inv.id)).filter((e) => e.reversed_entry_id).length === 1,
    { s: voided.status });
}

// ═════════════════════════════════════════════════════════════════════════════
// 1c. Issue racing a VAT filing never produces a return that disagrees with the ledger
// ═════════════════════════════════════════════════════════════════════════════
async function atomicityRace() {
  for (let round = 1; round <= 3; round++) {
    const C = await newCompany("atomR" + round);
    const seed = await C.draft(prevMid, 100);
    ok(`race ${round}: seed invoice issued`, (await C.issue(seed.id)).status === 200, {});
    const drafts = [];
    for (let i = 0; i < 20; i++) drafts.push(await C.draft(prevMid, 100));
    const gen = await C.generate();
    ok(`race ${round}: return generated`, gen.status === 201 && !!gen.json?.id, { s: gen.status, t: gen.text?.slice(0, 200) });

    const issues = drafts.map((d, i) => new Promise((r) => setTimeout(r, i * 8)).then(() => C.issue(d.id)));
    const filing = new Promise((r) => setTimeout(r, 60)).then(() =>
      api("POST", `/api/vat-returns/${gen.json.id}/file`, { token: C.token, body: { ftaReferenceNumber: `FTA-${rnd}-${round}`, filedAt: today } }));
    const results = await Promise.all([...issues, filing]);
    const filed = results[results.length - 1];
    ok(`race ${round}: the filing is recorded`, filed.status === 201, { s: filed.status, t: filed.text?.slice(0, 300) });
    ok(`race ${round}: every issue either succeeded or was refused as a locked period (never a 5xx)`,
      results.slice(0, 20).every((r) => r.status === 200 || r.status === 403), results.slice(0, 20).map((r) => r.status));

    const rows = (await db.query(`SELECT id, status, subtotal, vat_amount FROM invoices WHERE company_id = $1`, [C.cid])).rows;
    let mismatched = 0;
    for (const row of rows) {
      const posted = (await db.query(`SELECT 1 FROM journal_entries WHERE company_id = $1 AND source = 'invoice' AND source_id = $2 AND status = 'posted' AND reversed_entry_id IS NULL`, [C.cid, row.id])).rowCount > 0;
      if (posted !== (row.status !== "draft")) mismatched++;
    }
    ok(`race ${round}: every invoice is issued if and only if its journal is posted`, mismatched === 0, { mismatched, of: rows.length });

    const issuedRows = rows.filter((r) => r.status !== "draft");
    const docNet = issuedRows.reduce((s, r) => s + n(r.subtotal), 0);
    const docVat = issuedRows.reduce((s, r) => s + n(r.vat_amount), 0);
    const ledgerVat = n((await db.query(
      `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) AS v FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.source = 'invoice' AND je.status = 'posted' AND a.code = '2020'`, [C.cid])).rows[0].v);
    const snap = (await db.query(`SELECT snapshot FROM tax_filings WHERE company_id = $1`, [C.cid])).rows[0]?.snapshot?.boxes ?? {};
    ok(`race ${round}: the filed return equals the issued documents and the ledger`,
      close(snap.box1bDubaiAmount, docNet) && close(snap.box12TotalDueTax, docVat) && close(ledgerVat, docVat),
      { snapNet: snap.box1bDubaiAmount, docNet, snapVat: snap.box12TotalDueTax, docVat, ledgerVat, issued: issuedRows.length });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. Recurring templates carry line discounts and a shipping line
// ═════════════════════════════════════════════════════════════════════════════
async function recurringDiscountAndShipping() {
  const C = await newCompany("recDisc");
  // 2 x 500 less a 10% line discount (-100), a 50 shipping line, all at 5% VAT: net 950, VAT 47.50, total 997.50.
  const lines = [
    { description: "Retainer", quantity: 2, unitPrice: 500, vatRate: 0.05, discountType: "percent", discountValue: 10 },
    { description: "Delivery", quantity: 1, unitPrice: 50, vatRate: 0.05, lineKind: "shipping" },
  ];
  const t = await api("POST", `/api/companies/${C.cid}/recurring-invoices`, { token: C.token, body: { customerName: "Disc Co", frequency: "monthly", startDate: today, lines } });
  ok("recurring: a template with a line discount and a shipping line is stored", t.status === 200 && t.json?.id, t.text?.slice(0, 200));
  const stored = JSON.parse(t.json?.linesJson ?? "[]");
  ok("recurring: the stored lines keep discountType, discountValue and lineKind",
    stored[0]?.discountType === "percent" && n(stored[0]?.discountValue) === 10 && stored[1]?.lineKind === "shipping", stored);

  const tooBig = await api("POST", `/api/companies/${C.cid}/recurring-invoices`, { token: C.token, body: { customerName: "Disc Co", frequency: "monthly", startDate: today, lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.05, discountType: "amount", discountValue: 50 }] } });
  ok("recurring: a discount above its line is refused up front (422)", tooBig.status === 422, { s: tooBig.status, t: tooBig.text?.slice(0, 200) });
  const twoShip = await api("POST", `/api/companies/${C.cid}/recurring-invoices`, { token: C.token, body: { customerName: "Disc Co", frequency: "monthly", startDate: today, lines: [{ description: "a", quantity: 1, unitPrice: 10, vatRate: 0, lineKind: "shipping" }, { description: "b", quantity: 1, unitPrice: 10, vatRate: 0, lineKind: "shipping" }] } });
  ok("recurring: two shipping lines are refused up front (422)", twoShip.status === 422, { s: twoShip.status, t: twoShip.text?.slice(0, 200) });

  const run = runJob("recurring", C.cid);
  ok("recurring: the generator ran and made one invoice", run.status === 0 && run.result?.generated === 1, run);
  const inv = (await db.query(`SELECT id, status, subtotal, vat_amount, total, discount_amount FROM invoices WHERE company_id = $1`, [C.cid])).rows[0];
  ok("recurring: invoice totals match the sales-line math (950 / 47.50 / 997.50)", inv && close(inv.subtotal, 950) && close(inv.vat_amount, 47.5) && close(inv.total, 997.5), inv);
  const kinds = (await db.query(`SELECT line_kind, quantity, unit_price, discount_type, discount_value FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [inv.id])).rows;
  ok("recurring: the invoice has the item, its discount line and the shipping line",
    kinds.map((k) => k.line_kind).join(",") === "item,discount,shipping" && kinds[0].discount_type === "percent" && n(kinds[0].discount_value) === 10, kinds);
  const bal = (await db.query(
    `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [C.cid])).rows.reduce((o, r) => ({ ...o, [r.code]: Math.round(n(r.net) * 100) / 100 }), {});
  ok("recurring: the journal books AR 997.50, discounts given 100 (debit), shipping 50 (credit), VAT 47.50",
    close(bal["1040"], 997.5) && close(bal["4050"], 100) && close(bal["4035"], -50) && close(bal["2020"], -47.5), bal);
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. An employee-role user sees only their own HR records
// ═════════════════════════════════════════════════════════════════════════════
async function employeeOwnRecords() {
  const C = await newCompany("hrOwn", { vat: false });
  let seq = 0;
  const member = async (role) => {
    const u = await api("POST", "/api/auth/register", { body: { name: `${role}${++seq}`, email: `${role}${seq}_hrown_${rnd}@example.com`, password: "Password123!" } });
    if (!u.json?.token) throw new Error("member register failed " + u.status);
    await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [C.cid, u.json.user.id, role]);
    return { token: u.json.token, userId: u.json.user.id };
  };
  const as = (token) => ({
    get: (p) => api("GET", p, { token }),
    post: (p, body = {}) => api("POST", p, { token, body }),
    patch: (p, body = {}) => api("PATCH", p, { token, body }),
    del: (p) => api("DELETE", p, { token }),
  });
  const owner = as(C.token);
  const emp1 = await member("employee");
  const emp2 = await member("employee");
  const acct = await member("accountant");
  const e1c = as(emp1.token), e2c = as(emp2.token), ac = as(acct.token);

  const join = `${now.getUTCFullYear() - 2}-01-01`;
  const mkEmployee = async (name, extra = {}) => {
    const r = await owner.post(`/api/companies/${C.cid}/employees`, { fullName: name, nationality: "India", basicSalary: 6000, joinDate: join, ...extra });
    if (!r.json?.id) throw new Error("employee failed " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const E1 = await mkEmployee("Own Person", { userId: emp1.userId });
  const E2 = await mkEmployee("Other Person");
  ok("link: an employee record can be created linked to a company member", E1.user_id === emp1.userId, E1.user_id);

  // ── the link itself ──────────────────────────────────────────────────────
  const stranger = await api("POST", "/api/auth/register", { body: { name: "Stranger", email: `stranger_${rnd}@example.com`, password: "Password123!" } });
  const notMember = await owner.patch(`/api/employees/${E2.id}`, { userId: stranger.json.user.id });
  ok("link: a user who is not a member of the company is 422 INVALID_USER", notMember.status === 422 && notMember.json?.code === "INVALID_USER", { s: notMember.status, j: notMember.json });
  const twice = await owner.patch(`/api/employees/${E2.id}`, { userId: emp1.userId });
  ok("link: a login can belong to one employee record only (409 USER_ALREADY_LINKED)", twice.status === 409 && twice.json?.code === "USER_ALREADY_LINKED", { s: twice.status, j: twice.json });
  const selfLink = await e1c.patch(`/api/employees/${E2.id}`, { userId: emp1.userId });
  ok("link: an employee cannot link themselves to another record (403 ROLE_REQUIRED)", selfLink.status === 403 && selfLink.json?.code === "ROLE_REQUIRED", { s: selfLink.status, j: selfLink.json });
  const cleared = await owner.patch(`/api/employees/${E2.id}`, { userId: null });
  ok("link: null clears the link", cleared.status === 200 && cleared.json?.user_id === null, cleared.json);

  // ── data to look at ──────────────────────────────────────────────────────
  const annual = (await owner.get(`/api/companies/${C.cid}/leave-types`)).json.find((t) => t.code === "annual");
  const day = (d) => prevEnd.slice(0, 8) + String(d).padStart(2, "0");
  for (const [e, d] of [[E1, 4], [E2, 11]]) {
    const r = await owner.post(`/api/companies/${C.cid}/leave-requests`, { employeeId: e.id, leaveTypeId: annual.id, startDate: day(d), endDate: day(d + 1) });
    if (r.status !== 201) throw new Error("leave failed " + r.status + " " + r.text.slice(0, 200));
  }
  const bank = (await db.query(`SELECT id FROM accounts WHERE company_id = $1 AND code = '1020'`, [C.cid])).rows[0].id;
  const prevMonth = { month: Number(prevEnd.slice(5, 7)), year: Number(prevEnd.slice(0, 4)) };
  const loanFor = async (e) => {
    const r = await owner.post(`/api/companies/${C.cid}/employee-loans`, { employeeId: e.id, principal: 1000, instalmentCount: 5, firstPeriodYear: prevMonth.year, firstPeriodMonth: prevMonth.month, disbursementDate: day(2), paymentAccountId: bank });
    if (r.status !== 201) throw new Error("loan failed " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const L1 = await loanFor(E1), L2 = await loanFor(E2);
  const settleBody = (e) => ({ employeeId: e.id, terminationDate: prevEnd, provisionUsed: 0 });
  const S1 = await owner.post(`/api/companies/${C.cid}/final-settlements`, settleBody(E1));
  const S2 = await owner.post(`/api/companies/${C.cid}/final-settlements`, settleBody(E2));
  ok("setup: two draft settlements exist", S1.status === 201 && S2.status === 201, { a: S1.status, b: S2.status, t: S1.text.slice(0, 200) });
  const run = await owner.post(`/api/companies/${C.cid}/payroll-runs`, { periodMonth: prevMonth.month, periodYear: prevMonth.year });
  await owner.post(`/api/payroll-runs/${run.json.id}/calculate`, {});
  const items = (await owner.get(`/api/payroll-runs/${run.json.id}/items`)).json;
  const item1 = items.find((i) => i.employee_id === E1.id), item2 = items.find((i) => i.employee_id === E2.id);
  ok("setup: the run has a pay line per employee", !!item1 && !!item2, items.length);

  // ── the employee sees only their own ─────────────────────────────────────
  const emps = await e1c.get(`/api/companies/${C.cid}/employees`);
  ok("employee: the employee list is only their own record", emps.status === 200 && emps.json.length === 1 && emps.json[0].id === E1.id, emps.json?.map?.((e) => e.full_name));
  ok("employee: their own record is readable", (await e1c.get(`/api/employees/${E1.id}`)).status === 200, {});
  const otherEmp = await e1c.get(`/api/employees/${E2.id}`);
  ok("employee: another employee's record is 403 HR_OWN_RECORDS_ONLY", otherEmp.status === 403 && otherEmp.json?.code === "HR_OWN_RECORDS_ONLY", { s: otherEmp.status, j: otherEmp.json });

  const bal = await e1c.get(`/api/companies/${C.cid}/leave-balances?asOf=${prevEnd}`);
  ok("employee: leave balances are only their own", bal.status === 200 && bal.json.length > 0 && bal.json.every((r) => r.employeeId === E1.id), bal.json?.map?.((r) => r.employeeId));
  ok("employee: another employee's leave balances are 403", (await e1c.get(`/api/companies/${C.cid}/leave-balances?employeeId=${E2.id}`)).status === 403, {});
  ok("employee: their own leave balances by id are 200", (await e1c.get(`/api/companies/${C.cid}/leave-balances?employeeId=${E1.id}`)).status === 200, {});
  const lr = await e1c.get(`/api/companies/${C.cid}/leave-requests`);
  ok("employee: leave requests are only their own", lr.status === 200 && lr.json.length === 1 && lr.json[0].employeeId === E1.id, lr.json);
  ok("employee: another employee's leave requests are 403", (await e1c.get(`/api/companies/${C.cid}/leave-requests?employeeId=${E2.id}`)).status === 403, {});

  const loans = await e1c.get(`/api/companies/${C.cid}/employee-loans`);
  ok("employee: loans are only their own", loans.status === 200 && loans.json.length === 1 && loans.json[0].id === L1.id, loans.json);
  ok("employee: another employee's loan is 403", (await e1c.get(`/api/employee-loans/${L2.id}`)).status === 403, {});
  ok("employee: their own loan is 200", (await e1c.get(`/api/employee-loans/${L1.id}`)).status === 200, {});
  const loanPrev = (e) => e1c.post(`/api/companies/${C.cid}/employee-loans/preview`, { employeeId: e.id, principal: 1000, instalmentCount: 5, firstPeriodYear: prevMonth.year, firstPeriodMonth: prevMonth.month });
  ok("employee: a loan preview for another employee is 403, for themselves 200", (await loanPrev(E2)).status === 403 && (await loanPrev(E1)).status === 200, {});

  const sPrev = (e) => e1c.post(`/api/companies/${C.cid}/final-settlements/preview`, settleBody(e));
  const otherPrev = await sPrev(E2);
  ok("employee: a settlement preview for another employee is 403 HR_OWN_RECORDS_ONLY", otherPrev.status === 403 && otherPrev.json?.code === "HR_OWN_RECORDS_ONLY", { s: otherPrev.status, j: otherPrev.json });
  ok("employee: a settlement preview for themselves is 200", (await sPrev(E1)).status === 200, {});
  const sList = await e1c.get(`/api/companies/${C.cid}/final-settlements`);
  ok("employee: settlements are only their own", sList.status === 200 && sList.json.length === 1 && sList.json[0].employeeId === E1.id, sList.json);
  ok("employee: another employee's settlement is 403, their own 200", (await e1c.get(`/api/final-settlements/${S2.json.id}`)).status === 403 && (await e1c.get(`/api/final-settlements/${S1.json.id}`)).status === 200, {});
  const calc = (e) => e1c.post(`/api/companies/${C.cid}/payroll/gratuity-calculator`, { employeeId: e.id, terminationDate: prevEnd });
  ok("employee: the gratuity calculator for another employee is 403", (await calc(E2)).status === 403, {});

  const runs = await e1c.get(`/api/companies/${C.cid}/payroll-runs`);
  ok("employee: payroll runs show the month but no company totals", runs.status === 200 && runs.json.length === 1 && runs.json[0].total_net === undefined && runs.json[0].status === "calculated", runs.json);
  const runOne = await e1c.get(`/api/payroll-runs/${run.json.id}`);
  ok("employee: a single run has no totals either", runOne.status === 200 && runOne.json.total_net === undefined, runOne.json);
  const myItems = await e1c.get(`/api/payroll-runs/${run.json.id}/items`);
  ok("employee: the pay lines are only their own", myItems.status === 200 && myItems.json.length === 1 && myItems.json[0].employee_id === E1.id, myItems.json?.length);
  ok("employee: another employee's payslip is 403, their own is a PDF",
    (await e1c.get(`/api/payroll-runs/${run.json.id}/payslips/${item2.id}/pdf`)).status === 403 && (await fetch(BASE + `/api/payroll-runs/${run.json.id}/payslips/${item1.id}/pdf`, { headers: { Authorization: "Bearer " + emp1.token } })).status === 200, {});
  const reg = await e1c.get(`/api/payroll-runs/${run.json.id}/register`);
  ok("employee: the payroll register is 403 ROLE_REQUIRED", reg.status === 403 && reg.json?.code === "ROLE_REQUIRED", { s: reg.status, j: reg.json });
  const regCsv = await fetch(BASE + `/api/payroll-runs/${run.json.id}/register?format=csv`, { headers: { Authorization: "Bearer " + emp1.token } });
  ok("employee: the register CSV is refused too", regCsv.status === 403, regCsv.status);
  ok("employee: the WPS file is refused", (await e1c.get(`/api/payroll-runs/${run.json.id}/generate-sif`)).status === 403, {});

  // writes stay closed to the employee role
  ok("employee: cannot create an employee record", (await e1c.post(`/api/companies/${C.cid}/employees`, { fullName: "Mallory", basicSalary: 100 })).status === 403, {});
  ok("employee: cannot edit their own salary", (await e1c.patch(`/api/employees/${E1.id}`, { basicSalary: 90000 })).status === 403, {});
  ok("employee: cannot delete an employee record", (await e1c.del(`/api/employees/${E2.id}`)).status === 403, {});
  ok("employee: cannot start or change a payroll run", (await e1c.post(`/api/companies/${C.cid}/payroll-runs`, { periodMonth: 1, periodYear: 2020 })).status === 403 && (await e1c.post(`/api/payroll-runs/${run.json.id}/calculate`, {})).status === 403, {});
  ok("employee: cannot edit a pay line", (await e1c.patch(`/api/payroll-items/${item1.id}`, { overtime: 5000 })).status === 403, {});
  ok("the database was not touched by the refused writes", n((await db.query(`SELECT basic_salary FROM employees WHERE id = $1`, [E1.id])).rows[0].basic_salary) === 6000, {});

  // ── an employee with no linked record sees nothing ───────────────────────
  const none = await e2c.get(`/api/companies/${C.cid}/employees`);
  ok("unlinked employee: the employee list is empty", none.status === 200 && none.json.length === 0, none.json);
  ok("unlinked employee: leave, loans and settlements are empty",
    (await e2c.get(`/api/companies/${C.cid}/leave-balances`)).json.length === 0 && (await e2c.get(`/api/companies/${C.cid}/leave-requests`)).json.length === 0 &&
      (await e2c.get(`/api/companies/${C.cid}/employee-loans`)).json.length === 0 && (await e2c.get(`/api/companies/${C.cid}/final-settlements`)).json.length === 0, {});
  ok("unlinked employee: nobody's loan or payslip is readable", (await e2c.get(`/api/employee-loans/${L1.id}`)).status === 403 && (await e2c.get(`/api/payroll-runs/${run.json.id}/payslips/${item1.id}/pdf`)).status === 403, {});

  // ── accountant and owner see everything ──────────────────────────────────
  for (const [who, c] of [["accountant", ac], ["owner", owner]]) {
    ok(`${who}: sees both employees`, (await c.get(`/api/companies/${C.cid}/employees`)).json.length === 2, {});
    const b = await c.get(`/api/companies/${C.cid}/leave-balances?asOf=${prevEnd}`);
    ok(`${who}: sees every employee's leave balances`, new Set(b.json.map((r) => r.employeeId)).size === 2, {});
    ok(`${who}: sees both loans, both settlements, both leave requests`,
      (await c.get(`/api/companies/${C.cid}/employee-loans`)).json.length === 2 && (await c.get(`/api/companies/${C.cid}/final-settlements`)).json.length === 2 && (await c.get(`/api/companies/${C.cid}/leave-requests`)).json.length === 2, {});
    ok(`${who}: sees the run totals, all pay lines and the register`,
      (await c.get(`/api/payroll-runs/${run.json.id}`)).json.total_net !== undefined && (await c.get(`/api/payroll-runs/${run.json.id}/items`)).json.length === 2 && (await c.get(`/api/payroll-runs/${run.json.id}/register`)).status === 200, {});
    ok(`${who}: a settlement preview for any employee is 200`, (await c.post(`/api/companies/${C.cid}/final-settlements/preview`, settleBody(E2))).status === 200, {});
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. Arabic coverage: the strict gate is green and only the pages another stream is rewriting stay reserved
// ═════════════════════════════════════════════════════════════════════════════
function arabicCoverage() {
  const root = path.join(here, "..", "..");
  const gate = spawnSync("node", [path.join(root, "scripts", "check-i18n.mjs")], { cwd: root, encoding: "utf8" });
  ok("i18n: check-i18n (strict) passes", gate.status === 0, (gate.stdout + gate.stderr).slice(-400));
  const allow = JSON.parse(readFileSync(path.join(root, "scripts", "i18n-allowlist.json"), "utf8"));
  ok("i18n: nothing is allow-listed as untranslated", Object.keys(allow.todo ?? {}).length === 0, allow.todo);
  ok("i18n: the only reserved page left is the VAT filing page", JSON.stringify(allow.reserved) === JSON.stringify(["client/src/pages/VATFiling.tsx"]), allow.reserved);
  for (const page of ["CorporateTax", "EvidenceCenter", "MonthEndClose", "Onboarding", "TaxReturnArchive", "VATAutopilot"]) {
    const table = path.join(root, "client", "src", "pages", `${page}.i18n.ts`);
    ok(`i18n: ${page} has a message table with Arabic`, existsSync(table) && /[\u0600-\u06FF]/.test(readFileSync(table, "utf8")), table);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
