// Phase 9, teardown 7 (platform): the employee role is limited to self-service (deny by default at
// storage.hasCompanyAccess), the sign-up TRN is saved, and the onboarding bank account is linked to the ledger.
//   BASE_URL=http://localhost:5079 DATABASE_URL=... node tests/integration/phase9-teardown7-platform.test.mjs

import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; const d = (JSON.stringify(detail) ?? "").slice(0, 300); fails.push(name + "  :: " + d); console.log("FAIL  " + name + "  " + d); }
}
async function api(method, p, { body, token, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const now = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevYear = Number(prevEnd.slice(0, 4));
const prevMonthNo = Number(prevEnd.slice(5, 7));
const today = ymd(now);
let db, seq = 0;

async function register(label, extra = {}) {
  const email = `${label}${++seq}_${rnd}@example.com`;
  const r = await api("POST", "/api/auth/register", { body: { name: label, email, password: PASSWORD, ...extra } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  return { email, token: r.json.token, userId: r.json.user.id, cid: r.json.company.id };
}
async function addMember(u, role) {
  const m = await register("m" + role);
  await db.query(`DELETE FROM company_users WHERE user_id = $1`, [m.userId]);
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [u.cid, m.userId, role]);
  return m;
}
const get = (u, p) => api("GET", p, { token: u.token });
const send = (method, u, p, body = {}) => api(method, p, { token: u.token, body });
const refused = (r) => r.status === 403 && r.json?.code === "ROLE_REQUIRED";

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query("SET TIME ZONE 'UTC'");
  try {
    await employeeIsLimitedToSelfService();
    await otherRolesAreUnchanged();
    await signUpSavesTheTrn();
    await onboardingBankAccountIsLinked();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

async function employeeIsLimitedToSelfService() {
  const owner = await register("t7own");
  await send("PATCH", owner, `/api/companies/${owner.cid}`, { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai", mohreEstablishmentId: "0000123456789", wpsEmployerRoutingCode: "123456789" });
  const emp = await addMember(owner, "employee");
  const accounts = (await get(owner, `/api/companies/${owner.cid}/accounts`)).json;
  const cash = accounts.find((a) => a.code === "1010"), rent = accounts.find((a) => a.type === "expense");
  const je = { date: today, memo: "Probe", status: "posted", lines: [{ accountId: rent.id, debit: 10, credit: 0 }, { accountId: cash.id, debit: 0, credit: 10 }] };
  const ownerJe = await send("POST", owner, `/api/companies/${owner.cid}/journal`, je);
  ok("owner posts a manual journal (control)", ownerJe.status === 200 || ownerJe.status === 201, ownerJe.text.slice(0, 200));
  const jeCount = async () => (await db.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE company_id = $1`, [owner.cid])).rows[0].c;
  const before = await jeCount();
  const bankAcct = await send("POST", owner, `/api/companies/${owner.cid}/bank-accounts`, { nameEn: "Probe bank", bankName: "Emirates NBD", currency: "AED" });

  const reads = [
    ["journal", `/api/companies/${owner.cid}/journal`],
    ["chart of accounts", `/api/companies/${owner.cid}/accounts`],
    ["accounts with balances", `/api/companies/${owner.cid}/accounts-with-balances`],
    ["bank reconciliations", `/api/companies/${owner.cid}/bank-reconciliations`],
    ["bank accounts", `/api/companies/${owner.cid}/bank-accounts`],
    ["team (with emails)", `/api/companies/${owner.cid}/team`],
    ["activity log", `/api/companies/${owner.cid}/activity-logs`],
    ["audit trail report", `/api/companies/${owner.cid}/reports/run/audit-trail?from=${today}&to=${today}`],
    ["trial balance", `/api/companies/${owner.cid}/reports/trial-balance`],
    ["invoices", `/api/companies/${owner.cid}/invoices`],
    ["bills", `/api/companies/${owner.cid}/bills`],
    ["expense claim summary", `/api/companies/${owner.cid}/expense-claims/summary`],
  ];
  for (const [name, path] of reads) {
    const r = await get(emp, path);
    ok(`employee: GET ${name} is 403 ROLE_REQUIRED`, refused(r), { s: r.status, j: r.json ?? r.text.slice(0, 120) });
  }
  const writes = [
    ["manual journal", "POST", `/api/companies/${owner.cid}/journal`, je],
    ["account", "POST", `/api/companies/${owner.cid}/accounts`, { code: "9999", nameEn: "Probe", type: "asset" }],
    ["invoice", "POST", `/api/companies/${owner.cid}/invoices`, { customerName: "X", number: "PROBE-1", date: today, lines: [{ description: "x", quantity: 1, unitPrice: 5 }] }],
    ["bank reconciliation", "POST", `/api/companies/${owner.cid}/bank-reconciliations`, { bankAccountId: bankAcct.json?.id, statementDate: today, statementBalance: 0 }],
    ["company details", "PATCH", `/api/companies/${owner.cid}`, { name: "Hijacked" }],
  ];
  for (const [name, method, path, body] of writes) {
    const r = await send(method, emp, path, body);
    ok(`employee: ${method} ${name} is 403 ROLE_REQUIRED`, refused(r), { s: r.status, j: r.json ?? r.text.slice(0, 120) });
  }
  ok("employee: no journal entry was created", (await jeCount()) === before, { before, after: await jeCount() });
  ok("employee: the refusal message is the agreed text", (await get(emp, `/api/companies/${owner.cid}/journal`)).json?.message === "Your role only covers your own HR records.", null);
  const hijack = (await db.query(`SELECT name FROM companies WHERE id = $1`, [owner.cid])).rows[0].name;
  ok("employee: the company name is unchanged", hijack !== "Hijacked", hijack);

  // self-service stays open
  const employee = await send("POST", owner, `/api/companies/${owner.cid}/employees`, { fullName: "Maria Employee", nationality: "India", basicSalary: 5000, joinDate: `${prevYear - 2}-01-01`, molPersonId: "10000000000001", routingCode: "987654321", iban: "AE070331234567890123401" });
  const colleague = await send("POST", owner, `/api/companies/${owner.cid}/employees`, { fullName: "Fatima Colleague", nationality: "India", basicSalary: 7000, joinDate: `${prevYear - 2}-01-01`, molPersonId: "10000000000002", routingCode: "987654321", iban: "AE070331234567890123402" });
  await send("PATCH", owner, `/api/employees/${employee.json.id}`, { userId: emp.userId });
  const run = await send("POST", owner, `/api/companies/${owner.cid}/payroll-runs`, { periodMonth: prevMonthNo, periodYear: prevYear });
  const calc = await send("POST", owner, `/api/payroll-runs/${run.json?.id}/calculate`, {});
  ok("setup: two employees, a run and its calculation", employee.status === 201 && colleague.status === 201 && calc.status === 200, { e: employee.text.slice(0, 120), c: calc.text.slice(0, 120) });
  const all = (await get(owner, `/api/payroll-runs/${run.json.id}/items`)).json;
  const mine = all.find((i) => i.employee_id === employee.json.id), theirs = all.find((i) => i.employee_id === colleague.json.id);

  const items = await get(emp, `/api/payroll-runs/${run.json.id}/items`);
  ok("employee: own payroll items are 200 and only her own line", items.status === 200 && items.json.length === 1 && items.json[0].employee_id === employee.json.id, { s: items.status, n: items.json?.length });
  const slip = await api("GET", `/api/payroll-runs/${run.json.id}/payslips/${mine.id}/pdf`, { token: emp.token, raw: true });
  ok("employee: own payslip PDF is 200", slip.status === 200 && slip.buf.slice(0, 4).toString() === "%PDF", slip.status);
  const other = await api("GET", `/api/payroll-runs/${run.json.id}/payslips/${theirs.id}/pdf`, { token: emp.token });
  ok("employee: a colleague's payslip PDF is still 403", other.status === 403, other.status);
  const bal = await get(emp, `/api/companies/${owner.cid}/leave-balances?asOf=${today}`);
  ok("employee: leave balance is 200 and only her own", bal.status === 200 && Array.isArray(bal.json) && bal.json.every((r) => !r.employee_id || r.employee_id === employee.json.id), { s: bal.status, t: bal.text.slice(0, 160) });
  const types = await get(emp, `/api/companies/${owner.cid}/leave-types`);
  const annual = (types.json ?? []).find((t) => t.code === "annual");
  ok("employee: leave types are 200", types.status === 200 && !!annual, types.status);
  const leave = await send("POST", emp, `/api/companies/${owner.cid}/leave-requests`, { employeeId: employee.json.id, leaveTypeId: annual?.id, startDate: today, endDate: today });
  ok("employee: leave request creation is 201", leave.status === 201, { s: leave.status, t: leave.text.slice(0, 200) });
  const own = await send("POST", emp, `/api/companies/${owner.cid}/leave-requests`, { employeeId: colleague.json.id, leaveTypeId: annual?.id, startDate: today, endDate: today });
  ok("employee: a leave request for a colleague is 403 HR_OWN_RECORDS_ONLY", own.status === 403 && own.json?.code === "HR_OWN_RECORDS_ONLY", { s: own.status, j: own.json });
  const approve = await send("POST", emp, `/api/leave-requests/${leave.json?.id}/approve`);
  ok("employee: approving her own leave is 403 ROLE_REQUIRED", approve.status === 403 && approve.json?.code === "ROLE_REQUIRED", { s: approve.status, j: approve.json });
  const cancel = await send("POST", emp, `/api/leave-requests/${leave.json?.id}/cancel`);
  ok("employee: cancelling her own leave request is 200", cancel.status === 200 && cancel.json?.status === "cancelled", { s: cancel.status, j: cancel.json });
  const reqs = await get(emp, `/api/companies/${owner.cid}/leave-requests`);
  ok("employee: leave requests list is 200 with only her own requests", reqs.status === 200 && reqs.json.length >= 1 && reqs.json.every((r) => r.employeeId === employee.json.id), { s: reqs.status, n: reqs.json?.length });
  const self = await get(emp, `/api/employees/${employee.json.id}`);
  ok("employee: own employee record is 200", self.status === 200, self.status);
  const notes = await get(emp, `/api/notifications`);
  ok("employee: notifications are 200", notes.status === 200, notes.status);
  // expense claims: an employee files and follows their own, never a colleague's
  const item = { expense_date: today, category: "Travel", description: "Taxi", amount: 40, vat_amount: 0 };
  const mineClaim = await send("POST", emp, `/api/companies/${owner.cid}/expense-claims`, { title: "My taxi", items: [item] });
  const otherClaim = await send("POST", owner, `/api/companies/${owner.cid}/expense-claims`, { title: "Boss lunch", items: [item] });
  ok("employee: creating her own expense claim is 200/201", (mineClaim.status === 200 || mineClaim.status === 201) && !!mineClaim.json?.id, { s: mineClaim.status, t: mineClaim.text.slice(0, 160) });
  const claims = await get(emp, `/api/companies/${owner.cid}/expense-claims`);
  ok("employee: the claim list holds only her own claims", claims.status === 200 && claims.json.length === 1 && claims.json[0].id === mineClaim.json?.id, { s: claims.status, n: claims.json?.length });
  const ownOpen = await get(emp, `/api/expense-claims/${mineClaim.json?.id}`);
  ok("employee: she opens her own claim", ownOpen.status === 200, ownOpen.status);
  const otherOpen = await get(emp, `/api/expense-claims/${otherClaim.json?.id}`);
  ok("employee: a colleague's claim is 403 EXPENSE_CLAIM_OWN_ONLY", otherOpen.status === 403 && otherOpen.json?.code === "EXPENSE_CLAIM_OWN_ONLY", { s: otherOpen.status, j: otherOpen.json });
  const otherSubmit = await send("POST", emp, `/api/expense-claims/${otherClaim.json?.id}/submit`);
  ok("employee: submitting a colleague's claim is 403", otherSubmit.status === 403, otherSubmit.status);
  const otherDelete = await send("DELETE", emp, `/api/expense-claims/${otherClaim.json?.id}`);
  ok("employee: deleting a colleague's claim is 403", otherDelete.status === 403, otherDelete.status);
  const ownSubmit = await send("POST", emp, `/api/expense-claims/${mineClaim.json?.id}/submit`);
  ok("employee: submitting her own claim is 200", ownSubmit.status === 200, { s: ownSubmit.status, t: ownSubmit.text.slice(0, 160) });
  const selfApprove = await send("POST", emp, `/api/expense-claims/${mineClaim.json?.id}/approve`);
  ok("employee: approving her own claim is 403 ROLE_REQUIRED", selfApprove.status === 403 && selfApprove.json?.code === "ROLE_REQUIRED", { s: selfApprove.status, j: selfApprove.json });
  const me = await get(emp, `/api/auth/me`);
  ok("employee: /api/auth/me is 200", me.status === 200, me.status);
  const list = await get(emp, `/api/companies`);
  ok("employee: the company list is 200 and carries her role", list.status === 200 && list.json.some((c) => c.id === owner.cid && c.myRole === "employee"), list.json);
  const shell = await get(emp, `/api/companies/${owner.cid}`);
  ok("employee: the company record for the shell is 200", shell.status === 200, shell.status);
}

async function otherRolesAreUnchanged() {
  const owner = await register("t7rol");
  for (const role of ["accountant", "cfo"]) {
    const m = await addMember(owner, role);
    for (const [name, path] of [["journal", "journal"], ["accounts", "accounts"], ["invoices", "invoices"], ["bank reconciliations", "bank-reconciliations"], ["activity log", "activity-logs"]]) {
      const r = await get(m, `/api/companies/${owner.cid}/${path}`);
      ok(`${role}: GET ${name} is unchanged (200)`, r.status === 200, { s: r.status, t: r.text.slice(0, 120) });
    }
  }
  const acct = await addMember(owner, "accountant");
  const accounts = (await get(owner, `/api/companies/${owner.cid}/accounts`)).json;
  const cash = accounts.find((a) => a.code === "1010"), exp = accounts.find((a) => a.type === "expense");
  const r = await send("POST", acct, `/api/companies/${owner.cid}/journal`, { date: today, memo: "Acct", status: "draft", lines: [{ accountId: exp.id, debit: 5, credit: 0 }, { accountId: cash.id, debit: 0, credit: 5 }] });
  ok("accountant: creating a journal entry is unchanged", r.status === 200 || r.status === 201, r.text.slice(0, 200));
  const team = await get(owner, `/api/companies/${owner.cid}/team`);
  ok("owner: the team list is unchanged", team.status === 200, team.status);
  const stranger = await register("t7str");
  const foreign = await get(stranger, `/api/companies/${owner.cid}/journal`);
  ok("a stranger still gets the plain access-denied (not ROLE_REQUIRED)", foreign.status === 403 && foreign.json?.code !== "ROLE_REQUIRED", foreign.json);
}

async function signUpSavesTheTrn() {
  const u = await register("t7trn", { trn: "100987654300003" });
  const co = await get(u, `/api/companies/${u.cid}`);
  ok("sign-up: the TRN typed at sign-up is saved on the company", co.json?.trnVatNumber === "100987654300003", co.json?.trnVatNumber);
  const bare = await register("t7notrn");
  ok("sign-up: no TRN typed leaves it empty", !(await get(bare, `/api/companies/${bare.cid}`)).json?.trnVatNumber, null);
  const bad = await api("POST", "/api/auth/register", { body: { name: "Bad", email: `badtrn_${rnd}@example.com`, password: PASSWORD, trn: "12345" } });
  ok("sign-up: a TRN that is not 15 digits is refused (400) and no account is created", bad.status === 400 && (await db.query(`SELECT 1 FROM users WHERE email = $1`, [`badtrn_${rnd}@example.com`])).rowCount === 0, { s: bad.status, j: bad.json });
}

async function onboardingBankAccountIsLinked() {
  const u = await register("t7bank");
  const created = await send("POST", u, `/api/companies/${u.cid}/bank-accounts`, { nameEn: "Emirates NBD Current", bankName: "Emirates NBD", accountNumber: "1234567890", iban: "", currency: "AED" });
  ok("onboarding bank account: created", created.status === 201, created.text.slice(0, 200));
  const gl = (await get(u, `/api/companies/${u.cid}/accounts`)).json.find((a) => a.id === created.json?.glAccountId);
  ok("onboarding bank account: linked to its own 10xx asset ledger account (1021), not left unlinked", gl?.code === "1021" && gl?.type === "asset", { glAccountId: created.json?.glAccountId, gl });
  const bill = await send("POST", u, `/api/companies/${u.cid}/bills`, { vendor_name: "Supplier", bill_number: "OB-1", bill_date: today, due_date: today, line_items: [{ description: "x", quantity: 1, unit_price: 1000, vat_rate: 0 }] });
  await send("POST", u, `/api/bills/${bill.json?.id}/approve`, {});
  const pay = await send("POST", u, `/api/bills/${bill.json?.id}/payments`, { amount: 1000, payment_account_id: created.json?.glAccountId });
  const rows = (await db.query(`SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [u.cid])).rows;
  const net = Object.fromEntries(rows.map((r) => [r.code, Number(r.net)]));
  ok("onboarding bank account: a bill payment from it posts Cr 1021, not 1030 Petty Cash", pay.status === 200 && close(net["1021"], -1000) && !net["1030"], { s: pay.status, net });
  const explicit = await send("POST", u, `/api/companies/${u.cid}/bank-accounts`, { nameEn: "Unlinked on purpose", bankName: "Other", currency: "AED", glAccountId: null });
  ok("a bank account created with an explicit null link stays unlinked", explicit.status === 201 && explicit.json?.glAccountId === null, explicit.json);
}

main().catch((e) => { console.error(e); process.exit(1); });
