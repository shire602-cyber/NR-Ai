// Teardown 7 fix round (payroll v3 #2 #4 #5 #6 #7 #8 #9, trader v1 #3 #4): payslips, prior-service provisions, pro-rata, register, settlements, unpaid leave, numbering, opening stock, vendor credits.
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5073 DATABASE_URL=... node tests/integration/phase9-teardown7-t3.test.mjs


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
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevMonthDay = (day) => prevEnd.slice(0, 8) + String(day).padStart(2, "0");
const thisMonthFirst = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
const prevYear = Number(prevEnd.slice(0, 4));
const prevMonthNo = Number(prevEnd.slice(5, 7));
let db;
let userSeq = 0;

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai", mohreEstablishmentId: "0000123456789", wpsEmployerRoutingCode: "123456789" } });
  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = Math.round(n(row.net) * 100) / 100;
    return out;
  };
  const member = async (role) => {
    const u = await api("POST", "/api/auth/register", { body: { name: `${role}${++userSeq}`, email: `${role}${userSeq}_${label}_${rnd}@example.com`, password: "Password123!" } });
    if (!u.json?.token) throw new Error("member register failed " + u.status);
    await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [cid, u.json.user.id, role]);
    return { token: u.json.token, userId: u.json.user.id };
  };
  const accountId = async (code) => (await db.query(`SELECT id FROM accounts WHERE company_id = $1 AND code = $2`, [cid, code])).rows[0]?.id;
  const jes = async (source, sourceId) =>
    (await db.query(`SELECT * FROM journal_entries WHERE company_id = $1 AND source = $2 AND ($3::uuid IS NULL OR source_id = $3) AND status = 'posted'`, [cid, source, sourceId ?? null])).rows;
  const get = (p, t = token) => api("GET", p, { token: t });
  const post = (p, body = {}, t = token) => api("POST", p, { token: t, body });
  const patch = (p, body = {}, t = token) => api("PATCH", p, { token: t, body });
  const del = (p, t = token) => api("DELETE", p, { token: t });
  const bill = async (date, unitPrice, extra = {}, approve = true, t = token) => {
    const r1 = await api("POST", `/api/companies/${cid}/bills`, {
      token: t, body: { vendor_name: "Acme Supplies", bill_date: date, due_date: date, currency: "AED", line_items: [{ description: "Goods", quantity: 1, unit_price: unitPrice, vat_rate: 5 }], ...extra },
    });
    if (!r1.json?.id) throw new Error("bill failed " + r1.status + " " + r1.text.slice(0, 200));
    if (!approve) return r1.json.id;
    const r2 = await api("POST", `/api/bills/${r1.json.id}/approve`, { token: t, body: {} });
    if (![200, 201].includes(r2.status)) throw new Error("bill approve failed " + r2.status + " " + r2.text.slice(0, 200));
    return r1.json.id;
  };
  return { token, cid, balances, member, accountId, jes, get, post, patch, del, bill };
}

let personSeq = 0;
const newEmployee = async (C, name, extra = {}) => {
  const k = ++personSeq;
  const r = await C.post(`/api/companies/${C.cid}/employees`, {
    fullName: name, nationality: "India", basicSalary: 6000, joinDate: `${prevYear - 2}-01-01`,
    molPersonId: String(10000000000000 + k), routingCode: "987654321", iban: `AE07033123456789012${String(10000 + k)}`, ...extra,
  });
  if (!r.json?.id) throw new Error("employee failed " + r.status + " " + r.text.slice(0, 200));
  return r.json;
};
const newRun = async (C, t = C.token) => {
  const r = await C.post(`/api/companies/${C.cid}/payroll-runs`, { periodMonth: prevMonthNo, periodYear: prevYear }, t);
  if (!r.json?.id) throw new Error("run failed " + r.status + " " + r.text);
  return r.json.id;
};
const items = async (C, runId) => (await C.get(`/api/payroll-runs/${runId}/items`)).json;
const itemOf = (rows, emp) => rows.find((i) => i.employee_id === emp.id);
const leaveTypeId = async (C, code) => (await C.get(`/api/companies/${C.cid}/leave-types`)).json.find((t) => t.code === code).id;

const runFor = async (C, month, year, t = C.token) => {
  const r = await C.post(`/api/companies/${C.cid}/payroll-runs`, { periodMonth: month, periodYear: year }, t);
  if (!r.json?.id) throw new Error("run failed " + r.status + " " + r.text);
  return r.json.id;
};
const pdfText = async (token, path) => {
  const res = await fetch(BASE + path, { headers: { Authorization: "Bearer " + token } });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (res.status !== 200) return { status: res.status, text: "", type: res.headers.get("content-type") };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: buf, verbosity: 0 }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join(" ") + "\n";
  return { status: res.status, text, type: res.headers.get("content-type") };
};
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const auditCount = async (type, id, action) =>
  n((await db.query(`SELECT COUNT(*) AS c FROM audit_logs WHERE resource_type = $1 AND resource_id = $2 AND action = $3`, [type, id, action])).rows[0].c);

// ---------------------------------------------------------------------------
// A. Payslips for every stage of a run (v3 #2)
// ---------------------------------------------------------------------------
async function payslips() {
  const A = await newCompany("t7psA");
  const acct = await A.member("accountant");
  const acct2 = await A.member("accountant");
  const bank = await A.accountId("1020");
  const e = await newEmployee(A, "Slip Person");
  await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "payroll_run", name: "payroll", thresholdAed: 0, approverRoles: ["accountant", "owner"] });
  const runId = await newRun(A, acct2.token);
  await A.post(`/api/payroll-runs/${runId}/calculate`, {}, acct2.token);
  const itemId = itemOf(await items(A, runId), e).id;
  const path = `/api/payroll-runs/${runId}/payslips/${itemId}/pdf`;
  const calc = await pdfText(A.token, path);
  ok("payslip: a calculated run's slip downloads (200 pdf)", calc.status === 200 && /pdf/.test(calc.type ?? ""), calc.status);
  ok("payslip: ...with the DRAFT banner", /DRAFT/.test(calc.text) && /not yet approved/i.test(calc.text), calc.text.slice(0, 200));
  await A.post(`/api/payroll-runs/${runId}/approve`, {}, acct.token);
  const pending = await pdfText(A.token, path);
  ok("payslip: a run waiting for approval still shows DRAFT", pending.status === 200 && /DRAFT/.test(pending.text), pending.status);
  await A.post(`/api/payroll-runs/${runId}/approve`, {});
  const approved = await pdfText(A.token, path);
  ok("payslip: once approved the slip is issued without a draft mark", approved.status === 200 && !/DRAFT/.test(approved.text) && /PAYSLIP/.test(approved.text), approved.status);
  await A.post(`/api/payroll-runs/${runId}/record-payment`, { paymentAccountId: bank });
  const paid = await pdfText(A.token, path);
  ok("payslip: a paid run's slip downloads, no draft mark (the teardown's 409)", paid.status === 200 && !/DRAFT/.test(paid.text), paid.status);
}

// ---------------------------------------------------------------------------
// B. Prior-service provisions (v3 #4)
// ---------------------------------------------------------------------------
async function priorService() {
  const A = await newCompany("t7psB");
  const acct = await A.member("accountant");
  const e1 = await newEmployee(A, "No Opening", { basicSalary: 6000 });
  const e2 = await newEmployee(A, "With Opening", { basicSalary: 4000, openingGratuityProvision: 5000, openingLeaveProvision: 1000, openingLeaveDays: 4, openingProvisionsAsOf: `${prevYear}-08-31` });
  const stored = (await db.query(`SELECT opening_leave_days, opening_leave_provision, to_char(opening_provisions_as_of, 'YYYY-MM-DD') AS d FROM employees WHERE id = $1`, [e2.id])).rows[0];
  ok("prior service: the opening fields are stored on the employee", close(stored.opening_leave_days, 4) && close(stored.opening_leave_provision, 1000) && stored.d === `${prevYear}-08-31`, stored);

  const runId = await newRun(A, acct.token);
  const calc = await A.post(`/api/payroll-runs/${runId}/calculate`, {}, acct.token);
  const missing = calc.json?.priorServiceMissing ?? [];
  ok("prior service: the run lists the employee with prior service and no opening provisions", missing.length === 1 && missing[0].employeeId === e1.id, missing);
  ok("prior service: ...and warns in words", (calc.json?.warnings ?? []).some((w) => /Prior service not provided for/.test(w) && w.includes("No Opening") && !w.includes("With Opening")), calc.json?.warnings);
  const ap = await A.post(`/api/payroll-runs/${runId}/approve`, {});
  ok("prior service: the run approves", ap.status === 200, { s: ap.status, j: ap.json });
  const ledger = await A.balances();
  ok("prior service: the leave provision is this month's accrual (basic/12 each), not a year-to-date catch-up", close(-ledger["2037"], (6000 + 4000) / 12) && close(ledger["5029"], (6000 + 4000) / 12), { l2037: ledger["2037"], l5029: ledger["5029"] });
  const runJe = (await A.jes("system", runId))[0];
  const retained = (await db.query(`SELECT COUNT(*) AS c FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1 AND a.code = '3020'`, [runJe.id])).rows[0].c;
  ok("prior service: nothing silent in the run's journal (no equity line)", n(retained) === 0, retained);
  const reg = (await A.get(`/api/payroll-runs/${runId}/register`)).json;
  ok("prior service: the register carries the same warning", (reg.warnings ?? []).some((w) => /Prior service not provided for/.test(w)) && (reg.priorServiceMissing ?? []).length === 1, reg.warnings);

  const bal = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${prevEnd}&employeeId=${e2.id}`)).json.find((r) => r.code === "annual");
  ok("prior service: opening leave days are the opening balance, accruing only from the as-of date", close(bal.opening, 4) && close(bal.accrued, 2.5) && close(bal.balance, 6.5), bal);

  // the explicit catch-up
  const periodStartMinus1 = `${prevYear}-${String(prevMonthNo - 1).padStart(2, "0")}-${lastDay(prevYear, prevMonthNo - 1)}`;
  const gr = (await A.post(`/api/companies/${A.cid}/payroll/gratuity-calculator`, { employeeId: e1.id, terminationDate: periodStartMinus1 })).json.totalGratuity;
  const lv = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${periodStartMinus1}&employeeId=${e1.id}`)).json.find((r) => r.code === "annual").balance;
  const before = (await A.jes("payroll_catchup")).length;
  const byAcct = await A.post(`/api/payroll-runs/${runId}/book-prior-service-catchup`, {}, acct.token);
  ok("catch-up: it is an explicit, accountant-or-above action that exists", byAcct.status !== 404, byAcct.status);
  const cu = byAcct.status === 200 ? byAcct : await A.post(`/api/payroll-runs/${runId}/book-prior-service-catchup`, {});
  ok("catch-up: books for the employee without openings", cu.status === 200 && (cu.json?.employees ?? []).length === 1 && cu.json.employees[0].employeeId === e1.id, { s: cu.status, j: cu.json });
  const cj = (await A.jes("payroll_catchup"))[0];
  const cjDate = cj ? (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE id = $1`, [cj.id])).rows[0].d : null;
  const cl = cj ? (await db.query(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`, [cj.id])).rows : [];
  const side = (code, s) => cl.filter((l) => l.code === code).reduce((a, l) => a + n(l[s]), 0);
  ok("catch-up: its own journal (not the run's), dated the run's period end", !!cj && cj.id !== runJe.id && cjDate === prevEnd && before === 0, { cj: cj?.id, cjDate });
  ok("catch-up: Cr 2036 the gratuity to date and Cr 2037 the leave to date, against retained earnings", close(side("2036", "credit"), gr) && close(side("2037", "credit"), lv * (6000 / 30)) && close(side("3020", "debit"), gr + lv * 200) && side("5028", "debit") === 0 && side("5029", "debit") === 0, { cl, gr, lv });
  ok("catch-up: the run's own journal is untouched", (await A.jes("system", runId)).length === 1, null);
  const again = await A.post(`/api/payroll-runs/${runId}/book-prior-service-catchup`, {});
  ok("catch-up: a second booking is 409 NOTHING_TO_BOOK", again.status === 409 && again.json?.code === "NOTHING_TO_BOOK", { s: again.status, j: again.json });
  const reg2 = (await A.get(`/api/payroll-runs/${runId}/register`)).json;
  ok("catch-up: the warning is gone from the register", (reg2.priorServiceMissing ?? []).length === 0, reg2.warnings);
  const opening = (await db.query(`SELECT opening_gratuity_provision AS g FROM employees WHERE id = $1`, [e1.id])).rows[0].g;
  ok("catch-up: the gratuity becomes the employee's opening provision", close(opening, gr), opening);
  const accrual = n(itemOf(await items(A, runId), e1).gratuity_accrual);
  const prev = await A.post(`/api/companies/${A.cid}/final-settlements/preview`, { employeeId: e1.id, terminationDate: prevEnd, leaveDays: 0 });
  ok("settlement: the default provision is opening + accruals", prev.status === 200 && close(prev.json.provisionUsed, gr + accrual), { p: prev.json.provisionUsed, gr, accrual });
}

// ---------------------------------------------------------------------------
// C + G. Mid-month joiner, rounding, journal numbers, audit trail (v3 #5, #9)
// ---------------------------------------------------------------------------
async function proRataAndNumbers() {
  const A = await newCompany("t7prC");
  const acct = await A.member("accountant");
  const ahmed = await newEmployee(A, "Ahmed Joiner", { basicSalary: 5000, housingAllowance: 2000, transportAllowance: 500, joinDate: "2026-08-15" });
  const early = await newEmployee(A, "Second Of August", { basicSalary: 6000, housingAllowance: 1500, joinDate: "2026-08-02" });
  const late = await newEmployee(A, "Last Day Joiner", { basicSalary: 3000, joinDate: "2026-08-31" });
  const runId = await runFor(A, 8, 2026, acct.token);
  ok("audit: creating a run is in the trail", (await auditCount("payroll_run", runId, "payroll_run.create")) === 1, null);
  const calc = await A.post(`/api/payroll-runs/${runId}/calculate`, {}, acct.token);
  ok("audit: calculating a run is in the trail", calc.status === 200 && (await auditCount("payroll_run", runId, "payroll_run.calculate")) === 1, calc.status);
  const rows = await items(A, runId);
  const a = itemOf(rows, ahmed);
  ok("pro-rata: 15-31 Aug is 17 days: 17/30 x 7,500 = 4,250.00 net", close(a.net_salary, 4250) && close(a.days_worked, 17), a);
  ok("pro-rata: rounded once per line: the components add to exactly 4,250.00", close(n(a.basic_salary) + n(a.housing_allowance) + n(a.transport_allowance), 4250, 0.0001), [a.basic_salary, a.housing_allowance, a.transport_allowance]);
  const e2 = itemOf(rows, early);
  ok("pro-rata: joining on the 2nd (30 days of 31) is a full month's pay, days_worked 30", close(e2.net_salary, 7500) && close(e2.days_worked, 30), e2);
  const e3 = itemOf(rows, late);
  ok("pro-rata: joining on the 31st is one day: 1/30 of 3,000 = 100.00", close(e3.net_salary, 100) && close(e3.days_worked, 1), e3);
  ok("pro-rata: the notes say how many days of 30", (calc.json.proRataNotes ?? []).some((nt) => nt.name === "Ahmed Joiner" && nt.days === 17), calc.json.proRataNotes);
  const ap = await A.post(`/api/payroll-runs/${runId}/approve`, {});
  ok("pro-rata: the run approves", ap.status === 200, { s: ap.status, j: ap.json });
  const je = (await A.jes("system", runId))[0];
  ok("numbers: the journal of 31 Aug is numbered with 31 Aug (UAE day), not the day before", /^JE-20260831-/.test(je.entry_number), je.entry_number);
  const sif = await api("GET", `/api/payroll-runs/${runId}/generate-sif`, { token: A.token });
  const edr = sif.text.split(/\r?\n/).filter((l) => l.startsWith("EDR")).map((l) => l.split(","));
  const ahmedRow = edr.find((f) => f[4] === "2026-08-15");
  ok("sif: Ahmed's row says 17 days, 15 to 31 Aug, 4,250.00", !!ahmedRow && ahmedRow[5] === "2026-08-31" && ahmedRow[6] === "17" && ahmedRow[7] === "4250.00", ahmedRow);
  const earlyRow = edr.find((f) => f[4] === "2026-08-02");
  ok("sif: the 2 Aug joiner's start date and 30 days agree (2 to 31 Aug)", !!earlyRow && earlyRow[6] === "30", earlyRow);

  // 30-day February/September style month: a 15th joiner in a 30-day month is 16/30
  const B = await newCompany("t7prC2");
  const sep = await newEmployee(B, "Sept Joiner", { basicSalary: 3000, joinDate: "2026-09-15" });
  const run2 = await runFor(B, 9, 2026);
  await B.post(`/api/payroll-runs/${run2}/calculate`);
  ok("pro-rata: 15-30 Sep is 16 days: 16/30 x 3,000 = 1,600", close(itemOf(await items(B, run2), sep).net_salary, 1600), null);
}

async function submitAudit() {
  const A = await newCompany("t7auA");
  const acct = await A.member("accountant");
  const acct2 = await A.member("accountant");
  await newEmployee(A, "Audit Person");
  await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "payroll_run", name: "payroll", thresholdAed: 0, approverRoles: ["accountant", "owner"] });
  const runId = await newRun(A, acct2.token);
  await A.post(`/api/payroll-runs/${runId}/calculate`, {}, acct2.token);
  await A.post(`/api/payroll-runs/${runId}/approve`, {}, acct.token);
  ok("audit: the preparer's submission (first approval step) is a payroll_run.submit row by the accountant", (await auditCount("payroll_run", runId, "payroll_run.submit")) === 1, null);
}

// ---------------------------------------------------------------------------
// D. The register ties out to the ledger (v3 #6)
// ---------------------------------------------------------------------------
async function register() {
  const A = await newCompany("t7rgD");
  await newEmployee(A, "Khalid Emirati", { nationality: "UAE", basicSalary: 10000, housingAllowance: 4000, transportAllowance: 1000 });
  const rj = await newEmployee(A, "Rajesh Expat", { basicSalary: 6000 });
  const unpaid = await leaveTypeId(A, "unpaid");
  const lr = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: rj.id, leaveTypeId: unpaid, startDate: prevMonthDay(3), endDate: prevMonthDay(4) });
  await A.post(`/api/leave-requests/${lr.json.id}/approve`, {});
  const runId = await newRun(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`);
  await A.post(`/api/payroll-runs/${runId}/approve`, {});
  const reg = (await A.get(`/api/payroll-runs/${runId}/register`)).json;
  const k = reg.rows.find((r) => r.employeeName === "Khalid Emirati");
  ok("register: employer cost columns: employer pension, gratuity accrual, leave accrual and their sum per row", k && close(k.pensionEmployer, 1875) && close(k.leaveAccrual, 10000 / 12) && close(k.employerCost, k.pensionEmployer + k.gratuityAccrual + k.leaveAccrual), k);
  ok("register: the totals carry them", close(reg.totals.employerCost, reg.rows.reduce((s, r) => s + r.employerCost, 0)) && close(reg.totals.leaveAccrual, reg.rows.reduce((s, r) => s + r.leaveAccrual, 0)) && reg.totals.leaveAccrual > 1000, reg.totals);
  const r = reg.rows.find((x) => x.employeeName === "Rajesh Expat");
  ok("register: deductions are split (unpaid/sick leave, employee pension, loans, other) and add to the total", close(r.leaveDeduction, 400) && k.pensionEmployee > 0 && close(reg.totals.totalDeductions, reg.totals.leaveDeduction + reg.totals.pensionEmployee + reg.totals.loanDeduction + reg.totals.deductions), { leave: r.leaveDeduction, totals: reg.totals });
  const rec = reg.reconciliation;
  const row = (code) => (rec?.rows ?? []).find((x) => x.code === code);
  ok("register: a tie-out block to 5020 and 2030 with the difference 0.00", !!rec && !!row("5020") && !!row("2030") && close(row("5020").difference, 0) && close(row("2030").difference, 0) && close(rec.difference, 0) && rec.ok === true, rec);
  ok("register: 5020 ledger = gross less leave deductions, 2030 ledger = net, shown next to the register totals", close(row("5020").register, reg.totals.gross - reg.totals.leaveDeduction) && close(row("5020").ledger, row("5020").register) && close(row("2030").ledger, reg.totals.net), rec?.rows);
  ok("register: the employer lines tie too (5025, 5028, 5029)", ["5025", "5028", "5029"].every((c) => row(c) && close(row(c).difference, 0)), rec?.rows);
  const csv = await api("GET", `/api/payroll-runs/${runId}/register?format=csv`, { token: A.token });
  ok("register: the CSV has the employer cost column", /Employer cost/.test(csv.text.split("\n")[0]), csv.text.split("\n")[0]);
}

// ---------------------------------------------------------------------------
// E. Final settlements: always current, and under approval (v3 #7)
// ---------------------------------------------------------------------------
async function settlements() {
  const A = await newCompany("t7stE");
  const acct = await A.member("accountant");
  const bank = await A.accountId("1020");
  const join = new Date(Date.UTC(prevYear, prevMonthNo - 1 - 42, 1)).toISOString().slice(0, 10);
  const e1 = await newEmployee(A, "Stale Draft", { joinDate: join });
  const loan = await A.post(`/api/companies/${A.cid}/employee-loans`, { employeeId: e1.id, principal: 12000, instalmentCount: 10, firstPeriodYear: prevYear, firstPeriodMonth: prevMonthNo, disbursementDate: prevMonthDay(2), paymentAccountId: bank });
  ok("settlement: setup loan", loan.status === 200 || loan.status === 201, loan.status);
  const draft = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e1.id, terminationDate: prevEnd, leaveDays: 0 });
  ok("settlement: the draft owes the whole loan (12,000)", close(draft.json.loanRecovered, 12000), draft.json);
  const runId = await newRun(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`);
  await A.post(`/api/payroll-runs/${runId}/approve`, {});
  const fresh = (await A.get(`/api/final-settlements/${draft.json.id}`)).json;
  ok("settlement: a draft is recalculated on every read: after the instalment it shows 10,800 and the new net", close(fresh.loanRecovered, 10800) && close(fresh.netPayable, n(draft.json.netPayable) + 1200), { loan: fresh.loanRecovered, net: fresh.netPayable, was: draft.json.netPayable });
  ok("settlement: ...and says when it was last calculated", !!fresh.calculatedAt, Object.keys(fresh));
  const list = (await A.get(`/api/companies/${A.cid}/final-settlements`)).json;
  const listed = (Array.isArray(list) ? list : list.rows ?? list.items ?? []).find((s) => s.id === draft.json.id);
  ok("settlement: the list shows the current figures too", close(listed?.loanRecovered, 10800), listed);

  // approval rule on final settlements
  const rule = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "final_settlement", name: "settlement", thresholdAed: 0, approverRoles: ["owner"] });
  ok("settlement: final_settlement is a document type in approval rules", rule.status === 201 || rule.status === 200, { s: rule.status, j: rule.json });
  const e2 = await newEmployee(A, "Gated Leaver", { joinDate: join });
  const d2 = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e2.id, terminationDate: prevEnd, leaveDays: 0 }, acct.token);
  const queue = (await A.get(`/api/companies/${A.cid}/approvals`)).json;
  ok("settlement: the queue lists it", queue.some((r) => r.documentType === "final_settlement" && r.documentId === d2.json.id), queue.map((r) => r.documentType));
  const own = await A.post(`/api/final-settlements/${d2.json.id}/post`, {}, acct.token);
  ok("settlement: the accountant who prepared it cannot post it alone (403 APPROVAL_REQUIRED)", own.status === 403 && own.json?.code === "APPROVAL_REQUIRED", { s: own.status, j: own.json });
  const byOwner = await A.post(`/api/final-settlements/${d2.json.id}/post`, {});
  ok("settlement: the owner's approval posts it", byOwner.status === 200 && (await A.get(`/api/final-settlements/${d2.json.id}`)).json.status === "posted", { s: byOwner.status, j: byOwner.json });
  const e3 = await newEmployee(A, "Rejected Leaver", { joinDate: join });
  const d3 = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e3.id, terminationDate: prevEnd, leaveDays: 0 }, acct.token);
  await A.post(`/api/approvals/final_settlement/${d3.json.id}/reject`, { comment: "Check the leave days" });
  const rej = await A.post(`/api/final-settlements/${d3.json.id}/post`, {});
  ok("settlement: a rejected settlement cannot be posted until resubmitted (409 REQUEST_REJECTED)", rej.status === 409 && rej.json?.code === "REQUEST_REJECTED", { s: rej.status, j: rej.json });
}

// ---------------------------------------------------------------------------
// F. Unpaid leave is not service (v3 #8)
// ---------------------------------------------------------------------------
async function unpaidLeave() {
  const A = await newCompany("t7ulF");
  const sunil = await newEmployee(A, "Sunil Unpaid", { basicSalary: 8000, housingAllowance: 3000, transportAllowance: 1000 });
  const unpaid = await leaveTypeId(A, "unpaid");
  const lr = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: sunil.id, leaveTypeId: unpaid, startDate: prevMonthDay(3), endDate: prevMonthDay(12) });
  await A.post(`/api/leave-requests/${lr.json.id}/approve`, {});
  const runId = await newRun(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`);
  const item = itemOf(await items(A, runId), sunil);
  ok("unpaid: 10 unpaid days cut the month's gratuity accrual to 20/30: 466.67 x 2/3 = 311.11", close(item.gratuity_accrual, 311.11), item.gratuity_accrual);
  await A.post(`/api/payroll-runs/${runId}/approve`, {});
  const prov = (await db.query(`SELECT amount::float8 AS a FROM employee_leave_provisions WHERE payroll_run_id = $1 AND employee_id = $2`, [runId, sunil.id])).rows[0];
  ok("unpaid: ...and the annual-leave accrual to (2.5 - 10/12) days x 8,000/30 = 444.44", prov && close(prov.a, 444.44), prov);
  const bal = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${prevEnd}&employeeId=${sunil.id}`)).json.find((r) => r.code === "annual");
  ok("unpaid: the annual leave balance accrues 10 x 30/360 = 0.83 days less", close(bal.accrued, 2.5 * prevMonthNo - 10 / 12, 0.01), bal);

  const maria = await newEmployee(A, "Maria Earlier", { basicSalary: 5000, joinDate: "2023-01-01" });
  const plain = (await A.post(`/api/companies/${A.cid}/payroll/gratuity-calculator`, { employeeId: maria.id, terminationDate: "2026-06-30" })).json.totalGratuity;
  ok("unpaid: setup: 3.5 years on 5,000 is 12,250", close(plain, 12250, 0.01), plain);
  const l2 = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: maria.id, leaveTypeId: unpaid, startDate: "2024-02-01", endDate: "2024-03-07" });
  const l2a = await A.post(`/api/leave-requests/${l2.json.id}/approve`, {});
  ok("unpaid: setup: 36 unpaid days approved", l2.status === 201 && l2a.status === 200, { c: l2.status, a: l2a.status, j: l2a.json });
  const less = (await A.post(`/api/companies/${A.cid}/payroll/gratuity-calculator`, { employeeId: maria.id, terminationDate: "2026-06-30" })).json.totalGratuity;
  ok("unpaid: the gratuity excludes the 36 unpaid days (3 years + 145/360)", close(less, (3 + 145 / 360) * 21 * 5000 / 30, 0.02), { less, plain });
}

// ---------------------------------------------------------------------------
// H. Opening stock carries the opening date (v1 #3)
// ---------------------------------------------------------------------------
async function openingStock() {
  const A = await newCompany("t7osH");
  await A.patch(`/api/companies/${A.cid}/preferences`, { inventoryCostingEnabled: true });
  const prod = await A.post(`/api/companies/${A.cid}/products`, { name: "Bag", sku: "BAG-1", unitPrice: "35", costPrice: "18", trackInventory: true });
  const openingBody = (extra = {}) => ({
    asOfDate: "2026-07-01",
    rows: [{ accountCode: "1020", debit: 10000, credit: 0 }, { accountCode: "3010", debit: 0, credit: 13600 }],
    openingStock: [{ productId: prod.json.id, quantity: 200, unitCost: 18 }],
    ...extra,
  });
  const pre = await A.post(`/api/companies/${A.cid}/opening-balances/preview`, openingBody());
  ok("opening stock: the preview counts the stock: nothing left to balance to Opening Balance Equity", pre.status === 200 && pre.json?.totals?.balancingAmount === 0 && close(pre.json.totals.stockValue, 3600), pre.json?.totals);
  const post = await A.post(`/api/companies/${A.cid}/opening-balances`, openingBody());
  ok("opening stock: posts", post.status === 201, { s: post.status, j: post.json });
  const entries = (await db.query(`SELECT id, source, to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE company_id = $1 AND status = 'posted' ORDER BY created_at`, [A.cid])).rows;
  ok("opening stock: one journal, dated the opening date, no separate stock entry dated today", entries.length === 1 && entries[0].source === "opening_balance" && entries[0].d === "2026-07-01", entries);
  const lines = (await db.query(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`, [entries[0]?.id])).rows;
  ok("opening stock: Dr 1070 3,600 in it and nothing in Opening Balance Equity", lines.some((l) => l.code === "1070" && close(l.debit, 3600)) && !lines.some((l) => l.code === "3040"), lines);
  const p = (await A.get(`/api/products/${prod.json.id}`)).json;
  ok("opening stock: the item has 200 on hand at 18.00", p.currentStock === 200 && close(p.averageCost, 18) && close(p.inventoryValue, 3600), { s: p.currentStock, a: p.averageCost });
  const mv = (await A.get(`/api/companies/${A.cid}/inventory-movements`)).json;
  const m = mv.find((x) => x.productId === prod.json.id);
  ok("opening stock: it is listed on Inventory > Movements, dated 1 Jul", !!m && m.quantity === 200 && String(m.movementDate ?? m.createdAt).slice(0, 10) === "2026-07-01", m);
  const inv = (await A.balances())["1070"];
  ok("opening stock: 1070 equals the stock value", close(inv, 3600), inv);
  const again = await db.query(`SELECT COUNT(*) AS c FROM journal_entries WHERE company_id = $1 AND source = 'inventory_opening'`, [A.cid]);
  ok("opening stock: no inventory_opening entry was needed", n(again.rows[0].c) === 0, again.rows[0]);
}

// ---------------------------------------------------------------------------
// I. A vendor credit returns stock (v1 #4)
// ---------------------------------------------------------------------------
async function vendorCreditStock() {
  const A = await newCompany("t7vcI");
  await A.patch(`/api/companies/${A.cid}/preferences`, { inventoryCostingEnabled: true });
  const prod = await A.post(`/api/companies/${A.cid}/products`, { name: "Sack", sku: "SACK-1", unitPrice: "35", costPrice: "20", trackInventory: true });
  const bill = async (qty, price, date) => {
    const id = await A.bill(date, qty * price, { vendor_name: "Gulf Supplies", line_items: [{ description: "Sacks", quantity: qty, unit_price: price, vat_rate: 5, product_id: prod.json.id }] }, true);
    return id;
  };
  const b1 = await bill(400, 20, prevMonthDay(3));
  await bill(20, 22, prevMonthDay(6));
  const before = (await A.get(`/api/products/${prod.json.id}`)).json;
  ok("vendor credit: setup: 420 on hand", before.currentStock === 420, before.currentStock);
  const vc = await A.post(`/api/companies/${A.cid}/vendor-credits`, { bill_id: b1, date: prevMonthDay(12), line_items: [{ description: "Returned sacks", quantity: 10, unit_price: 22, vat_rate: 5, product_id: prod.json.id }] });
  ok("vendor credit: a line carries product and quantity", vc.status === 200 || vc.status === 201, { s: vc.status, j: vc.json });
  const ap = await A.post(`/api/companies/${A.cid}/vendor-credits/${vc.json.id}/approve`, {});
  ok("vendor credit: approves", ap.status === 200, { s: ap.status, j: ap.json });
  const after = (await A.get(`/api/products/${prod.json.id}`)).json;
  ok("vendor credit: stock falls 420 to 410", after.currentStock === 410, after.currentStock);
  ok("vendor credit: the average cost follows the existing rule: (value - 220) / 410", close(after.averageCost, (n(before.inventoryValue) - 220) / 410, 0.01), { a: after.averageCost, before: before.inventoryValue });
  const mv = (await db.query(`SELECT quantity FROM inventory_movements WHERE product_id = $1 AND source_vendor_credit_id = $2`, [prod.json.id, vc.json.id])).rows;
  ok("vendor credit: a stock-out movement of 10 is recorded against the credit", mv.length === 1 && mv[0].quantity === -10, mv);
  ok("vendor credit: 1070 still equals the stock value", close((await A.balances())["1070"], after.inventoryValue, 0.01), (await A.balances())["1070"]);
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await payslips();
    await priorService();
    await proRataAndNumbers();
    await submitAudit();
    await register();
    await settlements();
    await unpaidLeave();
    await openingStock();
    await vendorCreditStock();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
