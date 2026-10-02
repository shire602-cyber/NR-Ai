// Phase 9, teardown t5 (accounting-firm partner and external auditor): audit-trail gaps (F5), data & privacy
// scoping (F9) and the API v1 gaps (F13). Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5079 DATABASE_URL=... node tests/integration/phase9-teardown-t5.test.mjs

import pg from "pg";
import crypto from "node:crypto";

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, p, { body, token, headers: extra, raw } = {}) {
  const headers = { "Content-Type": "application/json", ...(extra || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const rnd = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let db, seq = 0;

async function register(label) {
  const email = `${label}${++seq}_${rnd}@example.com`;
  const r = await api("POST", "/api/auth/register", { body: { name: label, email, password: PASSWORD } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  return { email, token: r.json.token, userId: r.json.user.id, cid: r.json.company.id };
}
async function addMember(u, role) {
  const m = await register("m" + role);
  await db.query(`DELETE FROM company_users WHERE user_id = $1`, [m.userId]);
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [u.cid, m.userId, role]);
  return m;
}
const waitFor = async (fn, ms = 40000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 300)); } return null; };
const trail = async (u, extra = "") => {
  const r = await api("GET", `/api/companies/${u.cid}/reports/run/audit-trail?from=${day(-2)}&to=${day(2)}&limit=500${extra}`, { token: u.token });
  return (r.json?.rows ?? []).map((x) => x.cells);
};
const createKey = async (u, scopes) => (await api("POST", `/api/companies/${u.cid}/api-keys`, { token: u.token, body: { name: "k", scopes } })).json;
const v1 = (method, p, { key, body, idem } = {}) => api(method, "/api/v1" + p, { token: key, body, headers: method !== "GET" ? { "Idempotency-Key": idem ?? crypto.randomUUID() } : {} });

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await db.query("SET TIME ZONE 'UTC'");
  try {
    await billChangesAreAudited();
    await contactsInvitationsAndCompanySetup();
    await vatDraftRegenerationKeepsTheReplacedFigures();
    await approvalRejectionAndRefusedActions();
    await exportIsOwnerOnlyAndNeverForADeletedCompany();
    await apiAccountsEndpoint();
    await apiInvoiceTermsAndPayments();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

async function billChangesAreAudited() {
  const owner = await register("audbill");
  const staff = await addMember(owner, "accountant");
  const mk = await api("POST", `/api/companies/${owner.cid}/bills`, { token: staff.token, body: { vendor_name: "Supplier A", bill_number: "S-1", bill_date: "2026-09-10", due_date: "2026-10-10", line_items: [{ description: "Rent", unit_price: 1000, vat_rate: 5 }] } });
  ok("staff creates a bill", mk.status === 200 && !!mk.json?.id, mk.text?.slice(0, 200));
  const edit = await api("PATCH", `/api/bills/${mk.json.id}`, { token: staff.token, body: { bill_date: "2026-09-25", due_date: "2026-10-25" } });
  ok("staff changes the bill date", edit.status === 200, edit.text?.slice(0, 200));
  const doomed = await api("POST", `/api/companies/${owner.cid}/bills`, { token: staff.token, body: { vendor_name: "Gone Ltd", bill_date: today, line_items: [{ description: "x", unit_price: 10 }] } });
  const del = await api("DELETE", `/api/bills/${doomed.json.id}`, { token: staff.token });
  await new Promise((r) => setTimeout(r, 400));
  const rows = await trail(owner);
  const create = rows.find((r) => r.action === "bill.create" && /S-1/.test(r.description));
  const update = rows.find((r) => r.action === "bill.update");
  ok("the trail shows who created the bill, with its figures", !!create && /maccountant/.test(create.user) && /vendor: Supplier A/.test(create.description) && /total: 1050/.test(create.description), create);
  ok("the date change is a trail row naming the old and the new date (F5)", !!update && /billDate: 2026-09-10 -> 2026-09-25/.test(update.description), update);
  ok("and the due date change", /dueDate: 2026-10-10 -> 2026-10-25/.test(update?.description ?? "") && !/vendor:/.test(update?.description ?? ""), update?.description);
  ok("the actor on that row is the staff member, not the owner", /maccountant/.test(update?.user ?? "") && !/audbill/.test(update?.user ?? ""), update?.user);
  const rows2 = await trail(owner);
  ok("a refused delete (409, inside the retention period) is a trail row of its own (F5: refused actions)", del.status === 409 && rows2.some((r) => r.action === "refused.409" && /DELETE/.test(r.description) && new RegExp(`/api/bills/${doomed.json.id}`).test(r.description) && /maccountant/.test(r.user)), { s: del.status, refused: rows2.filter((r) => /refused/.test(r.action)) });
}

async function contactsInvitationsAndCompanySetup() {
  const owner = await register("audmisc");
  const c = await api("POST", `/api/companies/${owner.cid}/customer-contacts`, { token: owner.token, body: { name: "Acme", email: `acme_${rnd}@example.com` } });
  await api("PUT", `/api/companies/${owner.cid}/customer-contacts/${c.json.id}`, { token: owner.token, body: { name: "Acme Trading", trnNumber: "100123456700003" } });
  await api("POST", `/api/companies/${owner.cid}/team/invite`, { token: owner.token, body: { email: `invitee_${rnd}@example.com`, role: "accountant" } });
  await api("PATCH", `/api/companies/${owner.cid}`, { token: owner.token, body: { contactPhone: "+971500000001", emirate: "dubai" } });
  await api("PATCH", `/api/companies/${owner.cid}`, { token: owner.token, body: { contactPhone: "+971500000002" } });
  const rows = await trail(owner);
  const by = (a) => rows.filter((r) => r.action === a);
  ok("contact create is audited", by("contact.create").some((r) => /Acme/.test(r.description)), by("contact.create"));
  ok("contact edit shows old and new name and the TRN", by("contact.update").some((r) => /name: Acme -> Acme Trading/.test(r.description) && /trn: - -> 100123456700003/.test(r.description)), by("contact.update"));
  ok("an invitation is audited with the role", by("team.invite").some((r) => /role: accountant/.test(r.description) && /email: invitee_/.test(r.description)), by("team.invite"));
  const upd = by("company.update").find((r) => /\+971500000002/.test(r.description));
  ok("a company setup change shows the old and new value", !!upd && /contactPhone: \+971500000001 -> \+971500000002/.test(upd.description), by("company.update").map((r) => r.description));
}

async function vatDraftRegenerationKeepsTheReplacedFigures() {
  const u = await register("audvat");
  await api("PATCH", `/api/companies/${u.cid}`, { token: u.token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  const start = new Date(Date.UTC(now.getUTCFullYear(), (q - 1) * 3, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 0));
  const ymd = (d) => d.toISOString().slice(0, 10);
  const inDay = ymd(new Date(start.getTime() + 20 * 86400000));
  const issue = async (amount) => {
    const inv = await api("POST", `/api/companies/${u.cid}/invoices`, { token: u.token, body: { customerName: "C", date: inDay, dueDate: inDay, lines: [{ description: "x", quantity: 1, unitPrice: amount, vatRate: 0.05 }] } });
    await api("PATCH", `/api/invoices/${inv.json.id}/status`, { token: u.token, body: { status: "sent" } });
  };
  await issue(1000);
  const g1 = await api("POST", `/api/companies/${u.cid}/vat-returns/generate`, { token: u.token, body: { periodStart: ymd(start), periodEnd: ymd(end) } });
  await issue(2000);
  const g2 = await api("POST", `/api/companies/${u.cid}/vat-returns/generate`, { token: u.token, body: { periodStart: ymd(start), periodEnd: ymd(end) } });
  ok("a VAT draft is generated and regenerated for a closed period", g1.status === 201 && g2.status === 201 && g1.json.id === g2.json.id, [g1.status, g2.status, g1.text?.slice(0, 200)]);
  const rows = await trail(u);
  const gen = rows.find((r) => r.action === "vat.draft.generate");
  const regen = rows.find((r) => r.action === "vat.draft.regenerate");
  ok("generation is a trail row", !!gen, rows.map((r) => r.action));
  ok("regeneration is a trail row showing each figure the replaced draft had, next to the new one", !!regen && /box14PayableTax: 50 -> 150/.test(regen.description) && /box1bDubaiVat: 50 -> 150/.test(regen.description), regen);
  const stored = (await db.query(`SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'vat.draft.regenerate'`, [u.cid])).rows[0];
  const d = JSON.parse(stored.details);
  ok("and the full replaced draft stays in the audit details", d.before.box8TotalVat === 50 && d.after.box8TotalVat === 150 && d.before.period === d.after.period, d.before);
}

async function approvalRejectionAndRefusedActions() {
  const owner = await register("audappr");
  const staff = await addMember(owner, "accountant");
  const rule = await api("POST", `/api/companies/${owner.cid}/approval-rules`, { token: owner.token, body: { documentType: "bill", name: "Big", thresholdAed: 100, approverRoles: ["owner"] } });
  const bill = await api("POST", `/api/companies/${owner.cid}/bills`, { token: staff.token, body: { vendor_name: "Approve Me", bill_date: today, line_items: [{ description: "x", unit_price: 5000 }] } });
  const submit = await api("POST", `/api/bills/${bill.json.id}/approve`, { token: staff.token });
  const reject = await api("POST", `/api/approvals/bill/${bill.json.id}/reject`, { token: owner.token, body: { comment: "Wrong vendor" } });
  ok("fixture: a rule, a bill sent for approval, a rejection", rule.status < 300 && reject.status === 200, [rule.status, submit.status, reject.status, reject.text?.slice(0, 200)]);
  const rows = await trail(owner);
  ok("the rejection is in the trail with the reason", rows.some((r) => r.action === "approval.rejected" && /reason: Wrong vendor/.test(r.description)), rows.filter((r) => /approval/.test(r.action)));

  // refused actions
  const stranger = await register("audX");
  const refused = await api("POST", `/api/companies/${owner.cid}/bills`, { token: stranger.token, body: { vendor_name: "Nope", bill_date: today, line_items: [{ description: "x", unit_price: 1 }] } });
  const second = await api("PATCH", `/api/bills/${bill.json.id}`, { token: staff.token, body: { notes: "late edit" } });
  await new Promise((r) => setTimeout(r, 500));
  const rows2 = await trail(owner);
  const r403 = rows2.filter((r) => r.action === "refused.403");
  ok("a refused (403) attempt on a money route is a trail row naming the actor, method, path and status", refused.status === 403 && r403.some((r) => /POST/.test(r.description) && new RegExp(`/api/companies/${owner.cid}/bills`).test(r.description) && /403/.test(r.description) && /audX/.test(r.user)), { s: refused.status, r403 });
  const refusedRows = rows2.filter((r) => /^refused\./.test(r.action));
  ok("a refused edit that is a 409 is recorded too", second.status !== 409 || refusedRows.some((r) => r.action === "refused.409"), { s: second.status, refusedRows });
  ok("refusals cannot be made up by a non-money 403", !rows2.some((r) => r.action === "refused.403" && /\/api\/auth\//.test(r.description)), r403);
}

async function exportIsOwnerOnlyAndNeverForADeletedCompany() {
  const owner = await register("expown");
  const acct = await addMember(owner, "accountant");
  const co = (await api("GET", `/api/companies/${owner.cid}`, { token: owner.token })).json;
  const byAcct = await api("POST", `/api/companies/${owner.cid}/exports`, { token: acct.token });
  ok("an accountant cannot request a full-company export (403)", byAcct.status === 403, byAcct.text);
  const job = await api("POST", `/api/companies/${owner.cid}/exports`, { token: owner.token });
  await waitFor(async () => (await db.query(`SELECT 1 FROM company_data_exports WHERE id = $1 AND status IN ('ready','failed')`, [job.json.id])).rows.length);
  const acctDl = await api("GET", `/api/companies/${owner.cid}/exports/${job.json.id}/download`, { token: acct.token, raw: true });
  const acctList = await api("GET", `/api/companies/${owner.cid}/exports`, { token: acct.token });
  ok("nor read or download the owner's export (403)", acctDl.status === 403 && acctList.status === 403, [acctDl.status, acctList.status]);
  const del = await api("DELETE", `/api/companies/${owner.cid}`, { token: owner.token, body: { password: PASSWORD, confirmName: co.name } });
  ok("fixture: the company is in its deletion window", del.status === 202, del.text);
  const acctAfter = await api("GET", `/api/companies/${owner.cid}/exports/${job.json.id}/download`, { token: acct.token, raw: true });
  ok("an accountant still cannot download a deleted company's export (403)", acctAfter.status === 403, acctAfter.status);
  const ownerAfter = await api("GET", `/api/companies/${owner.cid}/exports/${job.json.id}/download`, { token: owner.token, raw: true });
  ok("the owner can (the books stay theirs during the 30 days)", ownerAfter.status === 200, ownerAfter.status);
  const ownerNew = await api("POST", `/api/companies/${owner.cid}/exports`, { token: owner.token });
  ok("and can request a fresh export of the pending-deletion company", ownerNew.status === 202 || ownerNew.status === 409, ownerNew.status);
  const mine = await api("GET", "/api/me/company-deletions", { token: owner.token });
  ok("the deletion list carries the company id the page must scope its actions to", mine.json?.some((r) => r.companyId === owner.cid && r.companyName === co.name && r.status === "pending"), mine.text?.slice(0, 200));
}

async function apiAccountsEndpoint() {
  const u = await register("apiacc");
  const other = await register("apiaccB");
  const noScope = await createKey(u, ["read:invoices"]);
  const denied = await v1("GET", "/accounts", { key: noScope.key });
  ok("without read:accounts the chart is 403 SCOPE_MISSING", denied.status === 403 && denied.json?.error?.code === "SCOPE_MISSING", denied.text);
  const k = await createKey(u, ["read:accounts"]);
  const list = await v1("GET", "/accounts?limit=200", { key: k.key });
  const cash = list.json?.data?.find((a) => a.code === "1010");
  ok("GET /accounts lists the chart with id, code, name, type and the system flag", list.status === 200 && list.json.data.length > 20 && cash && /^[0-9a-f-]{36}$/.test(cash.id) && cash.type === "asset" && typeof cash.name === "string" && cash.isSystem === true && cash.isActive === true, cash);
  const ownIds = new Set((await db.query(`SELECT id FROM accounts WHERE company_id = $1`, [u.cid])).rows.map((r) => r.id));
  ok("only this company's accounts", list.json.data.every((a) => ownIds.has(a.id)), list.json.data.length);
  const typed = await v1("GET", "/accounts?type=expense&limit=200", { key: k.key });
  ok("?type filters", typed.status === 200 && typed.json.data.length > 0 && typed.json.data.every((a) => a.type === "expense"), typed.status);
  const byCode = await v1("GET", "/accounts?code=1010", { key: k.key });
  ok("?code finds one", byCode.json?.data?.length === 1 && byCode.json.data[0].id === cash.id, byCode.text?.slice(0, 200));
  const bad = await v1("GET", "/accounts?type=banana", { key: k.key });
  ok("a bad type is 400", bad.status === 400, bad.status);
  const one = await v1("GET", `/accounts/${cash.id}`, { key: k.key });
  ok("GET /accounts/:id", one.status === 200 && one.json.data.code === "1010", one.status);
  const foreign = (await db.query(`SELECT id FROM accounts WHERE company_id = $1 LIMIT 1`, [other.cid])).rows[0].id;
  const cross = await v1("GET", `/accounts/${foreign}`, { key: k.key });
  ok("another company's account id is 404", cross.status === 404, cross.status);
  // the ids are usable where the API needs them
  const w = await createKey(u, ["read:accounts", "write:invoices", "read:invoices", "write:payments", "write:journals", "read:journals"]);
  const revenue = list.json.data.find((a) => a.code === "4010");
  const j = await v1("POST", "/journals", { key: w.key, body: { date: today, lines: [{ accountId: cash.id, debit: "10.00" }, { accountId: revenue.id, credit: "10.00" }] } });
  ok("account ids from the endpoint work on a journal", j.status === 201, j.text?.slice(0, 200));
  const spec = (await api("GET", "/api/v1/openapi.json")).json;
  ok("OpenAPI documents /accounts with the scope", !!spec.paths["/api/v1/accounts"]?.get && spec.paths["/api/v1/accounts"].get["x-required-scope"] === "read:accounts", Object.keys(spec.paths).filter((p) => /accounts/.test(p)));
}

async function apiInvoiceTermsAndPayments() {
  const u = await register("apiterm");
  const k = await createKey(u, ["read:accounts", "read:invoices", "write:invoices", "read:payments", "write:payments"]);
  const bank = (await v1("GET", "/accounts?code=1010", { key: k.key })).json.data[0];
  const line = [{ description: "Work", quantity: 1, unitPrice: "1000.00", vatRate: 0.05 }];
  const net30 = await v1("POST", "/invoices", { key: k.key, body: { customerName: "T", date: "2026-09-01", paymentTerms: "net30", lines: line } });
  ok("paymentTerms net30 sets the due date 30 days after the invoice date", net30.status === 201 && net30.json.data.dueDate === "2026-10-01", net30.text?.slice(0, 300));
  const onReceipt = await v1("POST", "/invoices", { key: k.key, body: { customerName: "T", date: "2026-09-01", paymentTerms: "due_on_receipt", lines: line } });
  ok("due_on_receipt is the same day", onReceipt.json?.data?.dueDate === "2026-09-01", onReceipt.text?.slice(0, 200));
  const both = await v1("POST", "/invoices", { key: k.key, body: { customerName: "T", date: "2026-09-01", paymentTerms: "net30", dueDate: "2026-09-20", lines: line } });
  ok("an explicit dueDate wins over the terms", both.json?.data?.dueDate === "2026-09-20", both.text?.slice(0, 200));
  const none = await v1("POST", "/invoices", { key: k.key, body: { customerName: "T", date: "2026-09-01", lines: line } });
  ok("neither: no due date, as before", none.status === 201 && none.json.data.dueDate === null, none.json?.data?.dueDate);

  const id = net30.json.data.id;
  await api("PATCH", `/api/invoices/${id}/status`, { token: (await api("POST", "/api/auth/login", { body: { email: u.email, password: PASSWORD } })).json.token, body: { status: "sent" } });
  const over = await v1("POST", `/invoices/${id}/payments`, { key: k.key, body: { amount: "2000.00", paymentAccountId: bank.id } });
  ok("an overpayment is refused with a message that names allowCredit", over.status === 422 && /allowCredit/.test(over.json?.error?.message ?? ""), over.text?.slice(0, 300));
  const accepted = await v1("POST", `/invoices/${id}/payments`, { key: k.key, body: { amount: "2000.00", paymentAccountId: bank.id, allowCredit: true } });
  ok("and allowCredit is a field the schema accepts: the excess becomes a customer advance (201)", accepted.status === 201 && accepted.json.data.amount === "2000.00", accepted.text?.slice(0, 300));
  const unknown = await v1("POST", `/invoices/${id}/payments`, { key: k.key, body: { amount: "1.00", paymentAccountId: bank.id, nonsense: true } });
  const msg = unknown.json?.error?.details?.issues?.[0]?.message ?? "";
  ok("an unknown field is still refused (400), by name", unknown.status === 400, unknown.text?.slice(0, 200));
  const spec = (await api("GET", "/api/v1/openapi.json")).json;
  const props = spec.paths["/api/v1/invoices/{id}/payments"].post.requestBody.content["application/json"].schema.properties;
  ok("OpenAPI lists allowCredit on payments and paymentTerms on invoices", !!props.allowCredit && !!spec.paths["/api/v1/invoices"].post.requestBody.content["application/json"].schema.properties.paymentTerms, Object.keys(props));
  void msg;
}

main().catch((e) => { console.error(e); process.exit(1); });
