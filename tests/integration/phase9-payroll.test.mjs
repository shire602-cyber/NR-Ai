// Integration tests for the payroll fix round (teardown 6, accountant 3): access, pro-rata, settlement provision,
// leave deductions, self-approval, WPS SIF, gratuity, leave provision, payment step, register, settlement vs run.
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5073 DATABASE_URL=... node tests/integration/phase9-payroll.test.mjs

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
  return { token, cid, balances, member, accountId, jes, get, post, patch, del };
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

// ---------------------------------------------------------------------------
// 1. The employee role cannot see or change payroll (the teardown's own probes)
// ---------------------------------------------------------------------------
async function employeeRoleProbes() {
  const A = await newCompany("pyA");
  const acct = await A.member("accountant");
  const emp = await A.member("employee");
  const maria = await newEmployee(A, "Maria Employee", { basicSalary: 5000 });
  const fatima = await newEmployee(A, "Fatima Colleague", { basicSalary: 7000, iban: "AE070331234567890999999" });
  await A.patch(`/api/employees/${maria.id}`, { userId: emp.userId });
  const runId = await newRun(A, acct.token);
  await A.post(`/api/payroll-runs/${runId}/calculate`, {}, acct.token);
  const all = await items(A, runId);
  const fatimaItem = itemOf(all, fatima);
  const bank = await A.accountId("1020");

  const list = await A.get(`/api/companies/${A.cid}/employees`, emp.token);
  ok("probe: the employee list shows only her own record (no colleague, no colleague IBAN)", list.status === 403 || (Array.isArray(list.json) && list.json.every((e) => e.id === maria.id) && !list.text.includes("AE070331234567890999999")), { s: list.status, t: list.text.slice(0, 200) });
  const colleague = await A.get(`/api/employees/${fatima.id}`, emp.token);
  ok("probe: a colleague's record is 403", colleague.status === 403, colleague.status);
  const its = await A.get(`/api/payroll-runs/${runId}/items`, emp.token);
  ok("probe: the run's items show only her own line", its.status === 403 || (Array.isArray(its.json) && its.json.every((i) => i.employee_id === maria.id)), { s: its.status, n: its.json?.length });
  const pdf = await api("GET", `/api/payroll-runs/${runId}/payslips/${fatimaItem.id}/pdf`, { token: emp.token });
  ok("probe: a colleague's payslip PDF is 403", pdf.status === 403, pdf.status);
  const sif = await api("GET", `/api/payroll-runs/${runId}/generate-sif`, { token: emp.token });
  ok("probe: the SIF file is 403", sif.status === 403, sif.status);
  const reg = await A.get(`/api/payroll-runs/${runId}/register`, emp.token);
  ok("probe: the payroll register is 403", reg.status === 403, reg.status);
  const tb = await A.get(`/api/companies/${A.cid}/reports/trial-balance`, emp.token);
  ok("probe: the trial balance is 403 for the employee role", tb.status === 403, tb.status);
  const raise = await A.patch(`/api/employees/${maria.id}`, { basicSalary: 50000 }, emp.token);
  ok("probe: she cannot change her own salary (403 ROLE_REQUIRED) and it stays 5,000", raise.status === 403 && raise.json?.code === "ROLE_REQUIRED" && close((await db.query(`SELECT basic_salary FROM employees WHERE id = $1`, [maria.id])).rows[0].basic_salary, 5000), { s: raise.status, j: raise.json });
  const create = await A.post(`/api/companies/${A.cid}/payroll-runs`, { periodMonth: prevMonthNo === 1 ? 12 : prevMonthNo - 1, periodYear: prevMonthNo === 1 ? prevYear - 1 : prevYear }, emp.token);
  ok("probe: she cannot create a run", create.status === 403, create.status);
  const recalc = await A.post(`/api/payroll-runs/${runId}/calculate`, {}, emp.token);
  ok("probe: she cannot recalculate a run", recalc.status === 403, recalc.status);
  const grat = await A.post(`/api/companies/${A.cid}/payroll/gratuity-calculator`, { employeeId: fatima.id, terminationDate: prevEnd }, emp.token);
  ok("probe: the gratuity calculator on a colleague is 403", grat.status === 403, grat.status);
  const ownGrat = await A.post(`/api/companies/${A.cid}/payroll/gratuity-calculator`, { employeeId: maria.id, terminationDate: prevEnd }, emp.token);
  ok("probe: ...but on herself it works", ownGrat.status === 200, ownGrat.status);
  const approve = await A.post(`/api/payroll-runs/${runId}/approve`, {}, emp.token);
  ok("probe: she cannot approve or pay a run", approve.status === 403, approve.status);
  const pay = await A.post(`/api/payroll-runs/${runId}/record-payment`, { paymentAccountId: bank }, emp.token);
  ok("probe: ...nor record its payment", pay.status === 403, pay.status);
  const own = await api("GET", `/api/payroll-runs/${runId}/payslips/${itemOf(all, maria).id}/pdf`, { token: emp.token });
  ok("probe: her own payslip still downloads", own.status === 200, own.status);

  const bad = await A.post(`/api/companies/${A.cid}/employees`, { fullName: "Bad Id", basicSalary: 1000, molPersonId: "123" });
  ok("employee: a MOHRE person ID that is not 14 digits is refused", bad.status === 400 || bad.status === 422, bad.status);
}

// ---------------------------------------------------------------------------
// 2 + 6. Mid-month joiner (30-day basis) and the SIF
// ---------------------------------------------------------------------------
async function proRataAndSif() {
  const A = await newCompany("prA");
  const acct = await A.member("accountant");
  const full = await newEmployee(A, "Full Month", { basicSalary: 6000 });
  const joiner = await newEmployee(A, "Mid Joiner", { basicSalary: 3000, joinDate: prevMonthDay(15) });
  const future = await newEmployee(A, "Joins Next Month", { basicSalary: 4000, joinDate: thisMonthFirst });
  const runId = await newRun(A, acct.token);
  const calc = await A.post(`/api/payroll-runs/${runId}/calculate`, {}, acct.token);
  const rows = await items(A, runId);
  const j = itemOf(rows, joiner);
  ok("pro-rata: joined on the 15th: 16/30 of 3,000 = 1,600, days_worked 16", calc.status === 200 && j && close(j.basic_salary, 1600) && close(j.days_worked, 16) && close(j.net_salary, 1600), j);
  ok("pro-rata: a full-month employee is paid in full", close(itemOf(rows, full).net_salary, 6000), itemOf(rows, full));
  ok("pro-rata: someone who joins after the period gets no line, and the run says so", !itemOf(rows, future) && (calc.json.warnings ?? []).some((w) => String(w).includes("Joins Next Month")), { warnings: calc.json.warnings });
  ok("pro-rata: the part-month employee is named in the warnings", (calc.json.warnings ?? []).some((w) => String(w).includes("Mid Joiner")), calc.json.warnings);
  const sifEarly = await api("GET", `/api/payroll-runs/${runId}/generate-sif`, { token: A.token });
  ok("sif: before approval it is 409", sifEarly.status === 409, sifEarly.status);
  const ap = await A.post(`/api/payroll-runs/${runId}/approve`, {});
  ok("pro-rata: the run approves", ap.status === 200, { s: ap.status, j: ap.json });
  const sif = await api("GET", `/api/payroll-runs/${runId}/generate-sif`, { token: A.token });
  const lines = sif.text.split(/\r?\n/).filter(Boolean);
  const edr = lines.filter((l) => l.startsWith("EDR"));
  ok("sif: text/csv, one EDR per paid employee, then exactly one SCR as the last row", sif.status === 200 && /text\/csv/.test(sif.headers.get("content-type") ?? "") && edr.length === 2 && lines.length === 3 && lines[2].startsWith("SCR"), lines);
  const jf = edr.find((l) => l.includes(prevMonthDay(15)));
  const f = jf.split(",");
  ok("sif: EDR = EDR, person ID, routing code, IBAN, start, end, days, fixed, variable, leave days", f.length === 10 && f[0] === "EDR" && /^\d{14}$/.test(f[1]) && f[2] === "987654321" && f[3].startsWith("AE") && f[4] === prevMonthDay(15) && f[5] === prevEnd && f[7] === "1600.00" && f[8] === "0.00" && f[9] === "0", f);
  ok("sif: the mid-month joiner reports 16 days, not the calendar days", f[6] === "16", f);
  const fullEdr = edr.find((l) => !l.includes(prevMonthDay(15))).split(",");
  ok("sif: a full month reports the calendar days from the 1st", fullEdr[4] === prevEnd.slice(0, 8) + "01" && fullEdr[6] === String(Number(prevEnd.slice(8, 10))), fullEdr);
  const scr = lines[2].split(",");
  ok("sif: SCR = SCR, establishment ID, routing code, date, time, MMYYYY, EDR count, total, AED, reference", scr.length === 10 && scr[1] === "0000123456789" && scr[2] === "123456789" && /^\d{4}-\d{2}-\d{2}$/.test(scr[3]) && /^\d{4}$/.test(scr[4]) && scr[5] === String(prevMonthNo).padStart(2, "0") + prevYear && scr[6] === "2" && scr[7] === "7600.00" && scr[8] === "AED", scr);

  // a missing ID: 422 listing it
  const B = await newCompany("prB");
  await B.patch(`/api/companies/${B.cid}`, { mohreEstablishmentId: "", wpsEmployerRoutingCode: "" });
  const noId = await newEmployee(B, "No Ids", { molPersonId: undefined, routingCode: undefined });
  const runB = await newRun(B);
  await B.post(`/api/payroll-runs/${runB}/calculate`);
  await B.post(`/api/payroll-runs/${runB}/approve`);
  const miss = await api("GET", `/api/payroll-runs/${runB}/generate-sif`, { token: B.token });
  ok("sif: missing identifiers are 422 SIF_MISSING_IDS and the body lists them", miss.status === 422 && miss.json?.code === "SIF_MISSING_IDS" && miss.json.missing.length >= 3, { s: miss.status, j: miss.json });
  void noId;
}

// ---------------------------------------------------------------------------
// 4. Leave and sick deductions use the full wage / 30
// ---------------------------------------------------------------------------
async function wageBasedDeductions() {
  const A = await newCompany("wgA");
  const e = await newEmployee(A, "Wage Person", { basicSalary: 6000, housingAllowance: 1500 });
  const sick = await leaveTypeId(A, "sick"), unpaid = await leaveTypeId(A, "unpaid");
  const r1 = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e.id, leaveTypeId: sick, startDate: prevMonthDay(1), endDate: prevMonthDay(20) });
  await A.post(`/api/leave-requests/${r1.json.id}/approve`, {});
  const r2 = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e.id, leaveTypeId: unpaid, startDate: prevMonthDay(22), endDate: prevMonthDay(23) });
  await A.post(`/api/leave-requests/${r2.json.id}/approve`, {});
  const runId = await newRun(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`);
  const item = itemOf(await items(A, runId), e);
  ok("wage: daily rate is (6,000 + 1,500) / 30 = 250: 2 unpaid days = 500, 5 half-pay sick days = 625", close(item.leave_deduction, 1125) && close(item.unpaid_leave_days, 2) && close(item.half_pay_leave_days, 5), item);
  ok("wage: net = 7,500 - 1,125 = 6,375", close(item.net_salary, 6375), item);
}

// ---------------------------------------------------------------------------
// 5. Self-approval of a run
// ---------------------------------------------------------------------------
async function runSelfApproval() {
  const A = await newCompany("saA");
  const acct = await A.member("accountant");
  const acct2 = await A.member("accountant");
  await newEmployee(A, "Self Person");
  const rule = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "payroll_run", name: "payroll", thresholdAed: 0, approverRoles: ["accountant"] });
  ok("self-approval: setup rule", rule.status === 201 || rule.status === 200, rule.status);
  const runId = await newRun(A, acct.token);
  await A.post(`/api/payroll-runs/${runId}/calculate`, {}, acct.token);
  ok("self-approval: payroll_runs.created_by is the preparer", (await db.query(`SELECT created_by FROM payroll_runs WHERE id = $1`, [runId])).rows[0].created_by === acct.userId, null);
  const own = await A.post(`/api/payroll-runs/${runId}/approve`, {}, acct.token);
  ok("self-approval: the preparer cannot approve the run (403 SELF_APPROVAL)", own.status === 403 && own.json?.code === "SELF_APPROVAL", { s: own.status, j: own.json });
  const other = await A.post(`/api/payroll-runs/${runId}/approve`, {}, acct2.token);
  ok("self-approval: a second accountant approves and it posts", other.status === 200 && other.json?.status === "approved" && (await A.jes("system", runId)).length === 1, { s: other.status, j: other.json });
  // the owner who prepares a run when only an owner step exists has nobody to approve
  const B = await newCompany("saB");
  await newEmployee(B, "Owner Prepared");
  await B.post(`/api/companies/${B.cid}/approval-rules`, { documentType: "payroll_run", name: "payroll", thresholdAed: 0, approverRoles: ["owner"] });
  const runB = await newRun(B);
  await B.post(`/api/payroll-runs/${runB}/calculate`);
  const ownerOwn = await B.post(`/api/payroll-runs/${runB}/approve`, {});
  ok("self-approval: an owner-only rule on a run the owner prepared is 409 NO_ELIGIBLE_APPROVER", ownerOwn.status === 409 && ownerOwn.json?.code === "NO_ELIGIBLE_APPROVER", { s: ownerOwn.status, j: ownerOwn.json });
}

// ---------------------------------------------------------------------------
// 3 + 7. Settlement provision, leave provision, gratuity day count
// ---------------------------------------------------------------------------
async function settlementAndProvisions() {
  const A = await newCompany("stA");
  // 3 years 6 months of service at the termination date
  const join = ymd(new Date(Date.UTC(prevYear, prevMonthNo - 1 - 42, 1)));
  const e = await newEmployee(A, "Leaver", { basicSalary: 6000, joinDate: join, openingGratuityProvision: 5000 });
  ok("settlement: the opening gratuity provision is stored per employee", close((await db.query(`SELECT opening_gratuity_provision AS v FROM employees WHERE id = $1`, [e.id])).rows[0].v, 5000), null);
  const exp = await A.accountId("5000"), prov = await A.accountId("2036"), bank = await A.accountId("1020");
  const seed = await A.post(`/api/companies/${A.cid}/journal`, { date: prevMonthDay(1), memo: "Opening provision", status: "posted", lines: [{ accountId: exp, debit: 5000, credit: 0 }, { accountId: prov, debit: 0, credit: 5000 }] });
  ok("settlement: setup journal", seed.status === 200, seed.status);

  const runId = await newRun(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`);
  const item = itemOf(await items(A, runId), e);
  const ap = await A.post(`/api/payroll-runs/${runId}/approve`, {});
  ok("settlement: the run approves", ap.status === 200, { s: ap.status, j: ap.json });
  const accrual = n(item.gratuity_accrual);
  let ledger = await A.balances();
  ok("settlement: 2036 holds opening 5,000 plus the run's accrual", accrual > 0 && close(-ledger["2036"], 5000 + accrual), { accrual, ledger: ledger["2036"] });
  ok("leave provision: the run credits 2037 with 2.5 x months x 6,000/30 and debits 5029 the same", close(-ledger["2037"], 500 * prevMonthNo) && close(ledger["5029"], 500 * prevMonthNo), { l2037: ledger["2037"], l5029: ledger["5029"], prevMonthNo });

  const calc = (await A.post(`/api/companies/${A.cid}/payroll/gratuity-calculator`, { employeeId: e.id, terminationDate: prevEnd })).json;
  const prev = await A.post(`/api/companies/${A.cid}/final-settlements/preview`, { employeeId: e.id, terminationDate: prevEnd, leaveDays: 4 });
  const expectedProvision = Math.min(5000 + accrual, 5000 + accrual);
  ok("settlement: the default provision used is the employee's whole 2036 provision (opening + accruals)", prev.status === 200 && close(prev.json.provisionUsed, expectedProvision), { p: prev.json.provisionUsed, expectedProvision });
  ok("settlement: only the difference to the legal gratuity is expensed", close(prev.json.gratuityTrueUp, calc.totalGratuity - expectedProvision), { t: prev.json.gratuityTrueUp, g: calc.totalGratuity });
  const draft = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e.id, terminationDate: prevEnd, leaveDays: 4, reason: "resignation" });
  const posted = await A.post(`/api/final-settlements/${draft.json.id}/post`, {});
  ok("settlement: posts", posted.status === 200, { s: posted.status, j: posted.json });
  ledger = await A.balances();
  ok("settlement: 2036 returns to zero for the leaver", close(ledger["2036"], 0), ledger);
  ok("leave provision: the settlement uses it (Dr 2037) and releases the excess over the 800 payout: 2037 ends at zero", close(ledger["2037"], 0), ledger);
  // gratuity day count: includes the last day of service, Maria 3.5 years on 5,000 basic = 12,250
  const m = await newEmployee(A, "Maria Gratuity", { basicSalary: 5000, joinDate: "2023-01-01" });
  const g = await A.post(`/api/companies/${A.cid}/payroll/gratuity-calculator`, { employeeId: m.id, terminationDate: "2026-06-30" });
  ok("gratuity: the last day of service counts: 1 Jan 2023 to 30 Jun 2026 = 3.5 years = 12,250", g.status === 200 && close(g.json.totalGratuity, 12250, 0.01), g.json);
}

// ---------------------------------------------------------------------------
// 7. Leave balances start at zero carry-forward, and the leave-provision setting
// ---------------------------------------------------------------------------
async function leaveSettings() {
  const A = await newCompany("lsA");
  const e = await newEmployee(A, "Leave Setting");
  const bal = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${prevEnd}&employeeId=${e.id}`)).json.find((r) => r.code === "annual");
  ok("leave: no carry-forward into the first tracked year unless entered", close(bal.opening, 0), bal);
  const off = await A.patch(`/api/companies/${A.cid}`, { leaveProvisionEnabled: false });
  ok("leave provision: the company setting can be turned off", off.status === 200 && off.json?.leaveProvisionEnabled === false, off.json);
  const runId = await newRun(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`);
  await A.post(`/api/payroll-runs/${runId}/approve`, {});
  const ledger = await A.balances();
  ok("leave provision: switched off, the run posts no 2037 / 5029", !ledger["2037"] && !ledger["5029"], ledger);
}

// ---------------------------------------------------------------------------
// 8 + 9. Payment step, register, delete a draft, settlement blocked by a draft run
// ---------------------------------------------------------------------------
async function paymentRegisterAndDelete() {
  const A = await newCompany("pmA");
  const e1 = await newEmployee(A, "Paid One", { basicSalary: 6000 });
  const e2 = await newEmployee(A, "Paid Two", { basicSalary: 4000, housingAllowance: 1000 });
  const bank = await A.accountId("1020");
  const runId = await newRun(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`);
  const early = await A.post(`/api/payroll-runs/${runId}/record-payment`, { paymentAccountId: bank });
  ok("payment: an unapproved run cannot be paid (409 PAYROLL_NOT_APPROVED)", early.status === 409 && early.json?.code === "PAYROLL_NOT_APPROVED", { s: early.status, j: early.json });
  const draftReg = (await A.get(`/api/payroll-runs/${runId}/register`)).json;
  ok("register: a draft run's register says so", draftReg.isDraft === true && !!draftReg.label, { isDraft: draftReg.isDraft, label: draftReg.label });
  const ap = await A.post(`/api/payroll-runs/${runId}/approve`, {});
  const statuses = (await items(A, runId)).map((i) => i.status);
  ok("payment: approving does not mark anyone Paid", ap.status === 200 && statuses.every((s) => s === "approved"), statuses);
  const reg = (await A.get(`/api/payroll-runs/${runId}/register`)).json;
  const rowsAdd = reg.rows.every((r) => close(n(r.gross) - n(r.totalDeductions), n(r.net)));
  const sum = (k) => reg.rows.reduce((a, r) => a + n(r[k]), 0);
  ok("register: every row adds up (gross - deductions = net) and the rows add to the totals", rowsAdd && close(sum("net"), reg.totals.net) && close(sum("gross"), reg.totals.gross) && close(sum("totalDeductions"), reg.totals.totalDeductions), { rows: reg.rows, totals: reg.totals });
  ok("register: an approved run is not labelled a draft", reg.isDraft === false, reg.isDraft);
  const pay = await A.post(`/api/payroll-runs/${runId}/record-payment`, { paymentAccountId: bank });
  const ledger = await A.balances();
  ok("payment: recording payment posts Dr 2030 / Cr bank and 2030 returns to zero", pay.status === 200 && close(ledger["2030"], 0) && (await A.jes("payroll_payment", runId)).length === 1, { s: pay.status, j: pay.json, ledger });
  ok("payment: only now are the items Paid", (await items(A, runId)).every((i) => i.status === "paid"), null);
  const again = await A.post(`/api/payroll-runs/${runId}/record-payment`, { paymentAccountId: bank });
  ok("payment: paying twice is 409 PAYROLL_ALREADY_PAID", again.status === 409 && again.json?.code === "PAYROLL_ALREADY_PAID", { s: again.status, j: again.json });
  const delPosted = await A.del(`/api/payroll-runs/${runId}`);
  ok("delete: an approved run cannot be deleted", delPosted.status === 409, delPosted.status);

  // a draft run with no journal can be deleted
  const prevM = prevMonthNo === 1 ? 12 : prevMonthNo - 1, prevY = prevMonthNo === 1 ? prevYear - 1 : prevYear;
  const d = await A.post(`/api/companies/${A.cid}/payroll-runs`, { periodMonth: prevM, periodYear: prevY });
  await A.post(`/api/payroll-runs/${d.json.id}/calculate`);
  const del = await A.del(`/api/payroll-runs/${d.json.id}`);
  ok("delete: a calculated draft run with no journal is deleted", del.status === 200 && (await db.query(`SELECT 1 FROM payroll_runs WHERE id = $1`, [d.json.id])).rowCount === 0 && (await db.query(`SELECT 1 FROM payroll_items WHERE payroll_run_id = $1`, [d.json.id])).rowCount === 0, { s: del.status, j: del.json });
  void e1; void e2;
}

async function settlementBlockedByRun() {
  const A = await newCompany("sbA");
  const join = ymd(new Date(Date.UTC(prevYear, prevMonthNo - 1 - 30, 1)));
  const e = await newEmployee(A, "Blocked Leaver", { joinDate: join });
  const bank = await A.accountId("1020");
  const loan = await A.post(`/api/companies/${A.cid}/employee-loans`, { employeeId: e.id, principal: 6000, instalmentCount: 10, firstPeriodYear: prevYear, firstPeriodMonth: prevMonthNo, disbursementDate: prevMonthDay(2), paymentAccountId: bank });
  ok("blocked: setup loan", loan.status === 201 || loan.status === 200, { s: loan.status, j: loan.json });
  const runId = await newRun(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`);
  const draft = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e.id, terminationDate: prevEnd, leaveDays: 0 });
  const blocked = await A.post(`/api/final-settlements/${draft.json.id}/post`, {});
  ok("blocked: posting while a draft run holds the instalment is 409 SETTLEMENT_BLOCKED_BY_RUN with the run id", blocked.status === 409 && blocked.json?.code === "SETTLEMENT_BLOCKED_BY_RUN" && JSON.stringify(blocked.json).includes(runId), { s: blocked.status, j: blocked.json });
  const del = await A.del(`/api/payroll-runs/${runId}`);
  ok("blocked: deleting the draft run releases the instalment", del.status === 200 && (await db.query(`SELECT COUNT(*) AS c FROM employee_loan_installments WHERE loan_id = $1 AND status = 'reserved'`, [loan.json.id])).rows[0].c === "0", { s: del.status, j: del.json });
  const ok2 = await A.post(`/api/final-settlements/${draft.json.id}/post`, {});
  ok("blocked: the settlement then posts", ok2.status === 200, { s: ok2.status, j: ok2.json });
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await employeeRoleProbes();
    await proRataAndSif();
    await wageBasedDeductions();
    await runSelfApproval();
    await settlementAndProvisions();
    await leaveSettings();
    await paymentRegisterAndDelete();
    await settlementBlockedByRun();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
