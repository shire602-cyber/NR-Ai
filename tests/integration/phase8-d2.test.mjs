// Integration tests for Phase 8 domain D2: purchases, projects and people.
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5073 DATABASE_URL=... node tests/integration/phase8-d2.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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
    method, headers,
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
const prevMonthDay = (day) => prevEnd.slice(0, 8) + String(day).padStart(2, "0");
const prevMid = prevMonthDay(15);
let db;
let userSeq = 0;

/** A company with its owner, plus helpers for members of other roles. */
async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });

  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = Math.round(n(row.net) * 100) / 100;
    return out;
  };
  /** A user with `role` in this company (their own signup company is irrelevant). */
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
  const put = (p, body = {}, t = token) => api("PUT", p, { token: t, body });
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
  return { token, cid, userId, balances, member, accountId, jes, get, post, patch, put, del, bill };
}

const line = (unit_price, extra = {}) => ({ description: "Returned goods", quantity: 1, unit_price, vat_rate: 5, ...extra });
const contactCount = async (cid, name) =>
  n((await db.query(`SELECT COUNT(*) AS c FROM customer_contacts WHERE company_id = $1 AND lower(btrim(name)) = lower(btrim($2))`, [cid, name])).rows[0].c);

// ---------------------------------------------------------------------------
// A. Contacts (0106)
// ---------------------------------------------------------------------------

async function contactsBackfill() {
  const A = await newCompany("bfA");
  const B = await newCompany("bfB");
  // legacy rows: bills with a name and no link, as they existed before 0106
  const insertBill = (cid, name, trn) => db.query(
    `INSERT INTO vendor_bills (company_id, vendor_name, vendor_trn, bill_date, status, total_amount) VALUES ($1, $2, $3, now(), 'approved', 100)`, [cid, name, trn ?? null]);
  await insertBill(A.cid, "Gamma Co", "100123456700009");
  await insertBill(A.cid, "gamma co ", null);
  await insertBill(A.cid, "GAMMA CO", "not-a-trn");
  await insertBill(A.cid, "Twin Ltd", null);
  await insertBill(B.cid, "Gamma Co", null);
  // an existing customer that is also a vendor, and an ambiguous pair
  await db.query(`INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'Dual Party')`, [A.cid]);
  await insertBill(A.cid, "dual party", null);
  await db.query(`INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'twin ltd'), ($1, 'TWIN LTD')`, [A.cid]);
  const sql = readFileSync(join(ROOT, "migrations", "0106_unified_contacts_vendor_id.sql"), "utf8");
  await db.query(sql);
  await db.query(sql); // idempotent

  ok("0106 backfill: case and space variants become one vendor contact", (await contactCount(A.cid, "gamma co")) === 1, await contactCount(A.cid, "gamma co"));
  const gamma = (await db.query(`SELECT id, contact_type, trn_number FROM customer_contacts WHERE company_id = $1 AND lower(btrim(name)) = 'gamma co'`, [A.cid])).rows[0];
  ok("0106 backfill: the new contact is a vendor and keeps a valid 15-digit TRN only", gamma?.contact_type === "vendor" && gamma?.trn_number === "100123456700009", gamma);
  const linked = (await db.query(`SELECT COUNT(*) AS c FROM vendor_bills WHERE company_id = $1 AND vendor_id = $2`, [A.cid, gamma.id])).rows[0].c;
  ok("0106 backfill: all three name variants are linked to it", n(linked) === 3, linked);
  const bGamma = (await db.query(`SELECT b.vendor_id, c.company_id FROM vendor_bills b JOIN customer_contacts c ON c.id = b.vendor_id WHERE b.company_id = $1`, [B.cid])).rows;
  ok("0106 backfill: another company's same-named bill links to ITS OWN contact", bGamma.length === 1 && bGamma[0].company_id === B.cid, bGamma);
  const twin = (await db.query(`SELECT vendor_id FROM vendor_bills WHERE company_id = $1 AND vendor_name = 'Twin Ltd'`, [A.cid])).rows[0];
  ok("0106 backfill: a name matching two contacts stays unlinked (never guessed)", twin && twin.vendor_id === null, twin);
  const dual = (await db.query(`SELECT contact_type FROM customer_contacts WHERE company_id = $1 AND name = 'Dual Party'`, [A.cid])).rows[0];
  ok("0106 backfill: a customer that has bills becomes both", dual?.contact_type === "both", dual);
  ok("0106 backfill: re-running adds no duplicate contacts", (await contactCount(A.cid, "gamma co")) === 1 && (await contactCount(A.cid, "dual party")) === 1);
}

async function vendorResolution() {
  const A = await newCompany("vrA");
  const B = await newCompany("vrB");

  const id1 = await A.bill(prevMid, 100, { vendor_name: "Delta Trading" }, false);
  const b1 = (await A.get(`/api/bills/${id1}`)).json;
  ok("bill: an unknown vendor name creates a vendor contact and links the bill", !!b1.vendor_id && (await contactCount(A.cid, "Delta Trading")) === 1, b1);
  const id2 = await A.bill(prevMid, 100, { vendor_name: " delta trading " }, false);
  const b2 = (await A.get(`/api/bills/${id2}`)).json;
  ok("bill: the same name in another case finds the same contact", b2.vendor_id === b1.vendor_id && (await contactCount(A.cid, "Delta Trading")) === 1, { a: b1.vendor_id, b: b2.vendor_id });

  await Promise.all([1, 2, 3, 4, 5].map(() => A.bill(prevMid, 10, { vendor_name: "Epsilon Parallel" }, false)));
  ok("bill: five parallel bills for a new vendor create one contact", (await contactCount(A.cid, "Epsilon Parallel")) === 1, await contactCount(A.cid, "Epsilon Parallel"));

  const contact = (await A.get(`/api/companies/${A.cid}/customer-contacts?type=vendor`)).json;
  ok("contacts ?type=vendor lists vendors", Array.isArray(contact) && contact.some((c) => c.id === b1.vendor_id && c.contactType === "vendor"), contact?.length);
  const customers = (await A.get(`/api/companies/${A.cid}/customer-contacts?type=customer`)).json;
  ok("contacts ?type=customer excludes vendor-only contacts", Array.isArray(customers) && !customers.some((c) => c.id === b1.vendor_id));
  const bad = await A.get(`/api/companies/${A.cid}/customer-contacts?type=nonsense`);
  ok("contacts ?type=nonsense is a 400", bad.status === 400, bad.status);

  // vendor_id of another company and unknown ids
  const foreign = await B.post(`/api/companies/${B.cid}/customer-contacts`, { name: "B Only Vendor", contactType: "vendor" });
  const r = await A.post(`/api/companies/${A.cid}/bills`, { vendor_id: foreign.json.id, bill_date: prevMid, line_items: [{ description: "x", quantity: 1, unit_price: 1, vat_rate: 5 }] });
  ok("bill: another company's vendor id is 422 INVALID_VENDOR", r.status === 422 && r.json?.code === "INVALID_VENDOR", { s: r.status, j: r.json });
  const noVendor = await A.post(`/api/companies/${A.cid}/bills`, { bill_date: prevMid, line_items: [{ description: "x", quantity: 1, unit_price: 1, vat_rate: 5 }] });
  ok("bill: neither vendor id nor name is a 400", noVendor.status === 400, noVendor.status);

  // a customer used as vendor becomes both
  const cust = await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "Customer And Supplier" });
  ok("contact: created as customer by default", cust.json?.contactType === "customer", cust.json);
  const viaId = await A.post(`/api/companies/${A.cid}/bills`, { vendor_id: cust.json.id, bill_date: prevMid, line_items: [{ description: "x", quantity: 1, unit_price: 1, vat_rate: 5 }] });
  ok("bill by vendor_id: the contact's name is snapshotted on the bill", viaId.json?.vendor_name === "Customer And Supplier" && viaId.json?.vendor_id === cust.json.id, viaId.json);
  const after = (await db.query(`SELECT contact_type FROM customer_contacts WHERE id = $1`, [cust.json.id])).rows[0];
  ok("a customer contact used as a vendor becomes both", after.contact_type === "both", after);

  // type stranding
  const strand = await A.put(`/api/companies/${A.cid}/customer-contacts/${b1.vendor_id}`, { contactType: "customer" });
  ok("contact: removing the vendor side while bills exist is 409 CONTACT_TYPE_IN_USE", strand.status === 409 && strand.json?.code === "CONTACT_TYPE_IN_USE", { s: strand.status, j: strand.json });
  const both = await A.put(`/api/companies/${A.cid}/customer-contacts/${b1.vendor_id}`, { contactType: "both" });
  ok("contact: widening to both is fine", both.status === 200 && both.json?.contactType === "both", both.json);
  const invalid = await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "Bad Type", contactType: "supplier" });
  ok("contact: an unknown type is a 400", invalid.status === 400, invalid.status);

  // purchase order and vendor credit link too
  const po = await A.post(`/api/companies/${A.cid}/purchase-orders`, {
    number: "PO-" + rnd, vendorName: "Delta Trading", date: prevMid, currency: "AED",
    lines: [{ description: "Chairs", quantity: 2, unitPrice: 50, vatRate: 0.05 }],
  });
  ok("purchase order: linked to the vendor contact by name", po.status === 201 && po.json?.vendorId === b1.vendor_id, { s: po.status, j: po.json });
  const poStatus = await A.post(`/api/companies/${A.cid}/purchase-orders`, {
    number: "PO2-" + rnd, vendorName: "Delta Trading", date: prevMid, status: "received", lines: [{ description: "x", quantity: 1, unitPrice: 1, vatRate: 0.05 }],
  });
  ok("purchase order: a status in the create body is ignored (always draft)", poStatus.json?.status === "draft", poStatus.json?.status);
  const poPut = await A.put(`/api/purchase-orders/${po.json.id}`, { status: "received", notes: "x" });
  ok("purchase order: status cannot be set through PUT", poPut.status === 200 && poPut.json?.status === "draft", poPut.json?.status);
  const vc = await A.post(`/api/companies/${A.cid}/vendor-credits`, { bill_id: id1, date: prevMid, line_items: [line(10)] });
  ok("vendor credit: inherits the bill's vendor link", vc.status === 201 && vc.json?.vendor_id === b1.vendor_id, { s: vc.status, v: vc.json?.vendor_id });
}

// ---------------------------------------------------------------------------
// B. Vendor statement and ageing detail
// ---------------------------------------------------------------------------

async function openingBalanceVendor() {
  const A = await newCompany("obA");
  const yr = now.getUTCFullYear();
  const posted = await A.post(`/api/companies/${A.cid}/opening-balances`, {
    asOfDate: `${yr}-01-01`,
    rows: [{ accountCode: "2010", debit: 0, credit: 500 }, { accountCode: "3010", debit: 500, credit: 0 }],
    bills: [{ party: "Opening Vendor Ltd", number: "OB-1", date: `${yr - 1}-12-15`, amount: 500, currency: "AED" }],
  });
  ok("opening balances: a posting with an open bill is accepted", posted.status === 201, { s: posted.status, t: posted.text.slice(0, 200) });
  const bill = (await db.query(`SELECT b.vendor_id, c.contact_type, c.name FROM vendor_bills b LEFT JOIN customer_contacts c ON c.id = b.vendor_id WHERE b.company_id = $1`, [A.cid])).rows[0];
  ok("opening balances: the opening bill is linked to a vendor contact created for it", bill?.vendor_id && bill.contact_type === "vendor" && bill.name === "Opening Vendor Ltd", bill);
  const st = await A.get(`/api/companies/${A.cid}/contacts/${bill.vendor_id}/vendor-statement?from=${yr - 1}-12-01&to=${today}`);
  ok("opening balances: the vendor statement shows the opening bill (500 owed)", st.status === 200 && close(st.json?.closingBalance, 500), st.json?.closingBalance);
}

async function vendorStatement() {
  const A = await newCompany("vsA");
  const B = await newCompany("vsB");
  const vendor = "Statement Vendor LLC";
  const b1 = await A.bill(prevMonthDay(5), 1000, { vendor_name: vendor, due_date: prevMonthDay(20) });  // 1,050
  const b2 = await A.bill(prevMonthDay(10), 2000, { vendor_name: vendor, due_date: today });             // 2,100
  const b3 = await A.bill(prevMonthDay(12), 400, { vendor_name: vendor, due_date: today });              // 420
  await A.bill(prevMonthDay(11), 7000, { vendor_name: vendor }, false);                                  // pending: not on the ledger
  const contactId = (await A.get(`/api/bills/${b1}`)).json.vendor_id;

  const vc = await A.post(`/api/companies/${A.cid}/vendor-credits`, { bill_id: b2, date: prevMonthDay(14), line_items: [line(100)] });
  await A.post(`/api/companies/${A.cid}/vendor-credits/${vc.json.id}/approve`, {});             // 105
  const pay = await A.post(`/api/bills/${b1}/payments`, { amount: 500, payment_date: prevMonthDay(16), reference: "TRF-1" });
  ok("setup: payment on an approved bill is accepted", pay.status === 200, pay.status);

  const st = await A.get(`/api/companies/${A.cid}/contacts/${contactId}/vendor-statement?from=${prevMonthDay(1)}&to=${today}`);
  ok("vendor statement: 200 with lines of types bill, vendor_credit and payment", st.status === 200 && st.json.lines.map((l) => l.type).join() === "bill,bill,bill,vendor_credit,payment", { s: st.status, t: st.json?.lines?.map((l) => l.type) });
  const refs = st.json?.lines?.map((l) => l.balance);
  ok("vendor statement: running balance 1050 → 3150 → 3570 → 3465 → 2965", JSON.stringify(refs) === JSON.stringify([1050, 3150, 3570, 3465, 2965]), refs);
  ok("vendor statement: pending bill is excluded", st.json?.lines?.every((l) => l.documentAmount !== 7350), st.json?.lines);
  const ledger = await A.balances();
  ok("vendor statement: closing balance equals the A/P ledger (2010)", close(st.json?.closingBalance, -ledger["2010"]) && close(st.json?.closingBalance, 2965), { closing: st.json?.closingBalance, ap: ledger["2010"] });
  ok("vendor statement: totals add up", close(st.json?.totalCredits, 3570) && close(st.json?.totalDebits, 605), st.json && { c: st.json.totalCredits, d: st.json.totalDebits });

  const asOf = await A.get(`/api/companies/${A.cid}/payables/ageing-detail?asOf=${today}&vendorId=${contactId}`);
  const detail = asOf.json?.vendors?.[0];
  ok("ageing detail: one vendor, a row per open bill and a negative row for the unapplied credit", asOf.status === 200 && asOf.json.vendors.length === 1 && detail.rows.length === 4, { s: asOf.status, rows: detail?.rows?.length });
  const rep = (await A.get(`/api/reports/${A.cid}/aging?asOf=${today}`)).json.find((r) => r.type === "payable" && r.name === vendor);
  ok("ageing detail: total equals the payables ageing line of that vendor", close(detail?.totals?.total, rep?.total) && close(detail?.totals?.total, 2965), { detail: detail?.totals, rep });
  ok("ageing detail: every row carries bucket, daysPastDue and AED outstanding", detail.rows.every((r) => typeof r.bucket === "string" && typeof r.daysPastDue === "number" && typeof r.outstandingAed === "number"), detail.rows[0]);
  const all = await A.get(`/api/companies/${A.cid}/payables/ageing-detail`);
  ok("ageing detail without a vendor or day: all vendors as of today", all.status === 200 && all.json.asOf === today && close(all.json.totals.total, 2965), { s: all.status, t: all.json?.totals });

  // pending bills are not payables (fix 5)
  ok("payables ageing excludes pending (unposted) bills, so it ties to 2010", close(rep?.total, -ledger["2010"]), { rep: rep?.total, ap: ledger["2010"] });

  const pdf = await api("GET", `/api/companies/${A.cid}/contacts/${contactId}/vendor-statement/pdf?from=${prevMonthDay(1)}&to=${today}`, { token: A.token });
  ok("vendor statement PDF starts with %PDF", pdf.status === 200 && pdf.text.startsWith("%PDF"), pdf.status);
  const mail = await A.post(`/api/companies/${A.cid}/contacts/${contactId}/vendor-statement/email`, { from: prevMonthDay(1), to: today, recipient: "vendor@example.com" });
  ok("vendor statement email: 503 EMAIL_NOT_CONFIGURED without a provider (or sent)", (mail.status === 503 && mail.json?.code === "EMAIL_NOT_CONFIGURED") || mail.status === 200, { s: mail.status, j: mail.json });
  const noRecipient = await A.post(`/api/companies/${A.cid}/contacts/${contactId}/vendor-statement/email`, { from: prevMonthDay(1), to: today });
  ok("vendor statement email: no recipient is 400 NO_RECIPIENT", noRecipient.status === 400 && noRecipient.json?.code === "NO_RECIPIENT", noRecipient.json);
  const badPeriod = await A.get(`/api/companies/${A.cid}/contacts/${contactId}/vendor-statement?from=2026-02-30&to=${today}`);
  ok("vendor statement: an invalid period is 400 INVALID_PERIOD", badPeriod.status === 400 && badPeriod.json?.code === "INVALID_PERIOD", badPeriod.json);

  // a USD bill at 3.6725 goes through approval and onto the statement at its booking rate
  const F = await newCompany("vsFx");
  const usdId = await F.bill(prevMonthDay(8), 100, { vendor_name: "Dollar Supplier", currency: "USD", exchange_rate: 3.6725 });
  const usdContact = (await F.get(`/api/bills/${usdId}`)).json.vendor_id;
  const usdStatement = (await F.get(`/api/companies/${F.cid}/contacts/${usdContact}/vendor-statement?from=${prevMonthDay(1)}&to=${today}`)).json;
  const usdLedger = await F.balances();
  ok("vendor statement: a USD bill is valued in AED at its rate and ties to A/P (385.61)", close(usdStatement.closingBalance, 385.61) && close(-usdLedger["2010"], 385.61) && usdStatement.lines[0].currency === "USD" && close(usdStatement.lines[0].documentAmount, 105), { usdStatement: usdStatement.lines, ledger: usdLedger["2010"] });

  // tenant probes
  const cross = await B.get(`/api/companies/${A.cid}/contacts/${contactId}/vendor-statement?from=${prevMonthDay(1)}&to=${today}`);
  ok("tenant: B cannot read A's vendor statement", cross.status === 403, cross.status);
  const crossContact = await B.get(`/api/companies/${B.cid}/contacts/${contactId}/vendor-statement?from=${prevMonthDay(1)}&to=${today}`);
  ok("tenant: A's contact id under B's company is 404", crossContact.status === 404, crossContact.status);
  const crossAge = await B.get(`/api/companies/${B.cid}/payables/ageing-detail?vendorId=${contactId}`);
  ok("tenant: A's vendor id in B's ageing detail is 404", crossAge.status === 404, crossAge.status);
  const crossDetail = await B.get(`/api/companies/${A.cid}/payables/ageing-detail`);
  ok("tenant: B cannot read A's ageing detail", crossDetail.status === 403, crossDetail.status);
}

// ---------------------------------------------------------------------------
// C. Existing defects the approvals depend on (fixes 1-5)
// ---------------------------------------------------------------------------

async function defects() {
  const A = await newCompany("dfA");
  const pending = await A.bill(prevMid, 1000, { vendor_name: "Defect Vendor" }, false);
  const pay = await A.post(`/api/bills/${pending}/payments`, { amount: 100, payment_date: prevMid });
  ok("fix 1: paying a pending bill is 409 BILL_NOT_APPROVED", pay.status === 409 && pay.json?.code === "BILL_NOT_APPROVED", { s: pay.status, j: pay.json });
  const ledger = await A.balances();
  ok("fix 1: nothing posted for the refused payment", !ledger["2010"], ledger);
  const approve = await A.post(`/api/bills/${pending}/approve`, {});
  ok("fix 1: the bill is still approvable afterwards", approve.status === 200 && approve.json?.status === "approved", { s: approve.status, j: approve.json?.status });

  // fix 2: ten parallel approves post one journal
  const parallel = await A.bill(prevMid, 500, { vendor_name: "Parallel Vendor" }, false);
  const results = await Promise.all(Array.from({ length: 10 }, () => A.post(`/api/bills/${parallel}/approve`, {})));
  ok("fix 2: ten parallel bill approves: exactly one succeeds", results.filter((r) => r.status === 200).length === 1, results.map((r) => r.status));
  ok("fix 2: ...and exactly one journal entry exists", (await A.jes("bill", parallel)).length === 1, (await A.jes("bill", parallel)).length);

  // fix 3 / payroll approve parallel / fix 4 are covered in the people and approvals groups below
}


// ---------------------------------------------------------------------------
// D. Approvals (0108): D2-4 and D2-5
// ---------------------------------------------------------------------------

const prevMonthYear = () => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
};
const auditCount = async (type, id, action) =>
  n((await db.query(`SELECT COUNT(*) AS c FROM audit_logs WHERE resource_type = $1 AND resource_id = $2 AND action = $3`, [type, id, action])).rows[0].c);

async function approvalRulesApi() {
  const A = await newCompany("arA");
  const B = await newCompany("arB");
  const acct = await A.member("accountant");
  const emp = await A.member("employee");

  const made = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "Big bills", thresholdAed: 5000, approverRoles: ["accountant", "owner"] });
  ok("rules: the owner creates a rule", made.status === 201 && made.json?.thresholdAed === 5000 && made.json?.approverRoles?.join() === "accountant,owner", { s: made.status, j: made.json });
  const byAcct = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "x", thresholdAed: 1, approverRoles: ["owner"] }, acct.token);
  ok("rules: an accountant cannot create one (403 ROLE_REQUIRED)", byAcct.status === 403 && byAcct.json?.code === "ROLE_REQUIRED", { s: byAcct.status, j: byAcct.json });
  const three = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "x", thresholdAed: 1, approverRoles: ["accountant", "cfo", "owner"] });
  ok("rules: three steps are refused", three.status === 400, three.status);
  const unknownRole = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "x", thresholdAed: 1, approverRoles: ["bookkeeper"] });
  ok("rules: an unknown role is refused", unknownRole.status === 400, unknownRole.status);
  const negative = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "x", thresholdAed: -5, approverRoles: ["owner"] });
  ok("rules: a negative threshold is refused", negative.status === 400, negative.status);
  const listed = await A.get(`/api/companies/${A.cid}/approval-rules`, emp.token);
  ok("rules: any member may list them", listed.status === 200 && listed.json.length === 1, { s: listed.status });
  const crossList = await B.get(`/api/companies/${A.cid}/approval-rules`);
  ok("tenant: B cannot list A's rules", crossList.status === 403, crossList.status);
  const crossPatch = await B.patch(`/api/approval-rules/${made.json.id}`, { thresholdAed: 1 });
  ok("tenant: B patching A's rule is 404 and changes nothing", crossPatch.status === 404 && n((await db.query(`SELECT threshold_aed FROM approval_rules WHERE id = $1`, [made.json.id])).rows[0].threshold_aed) === 5000, crossPatch.status);
  const crossDel = await B.del(`/api/approval-rules/${made.json.id}`);
  ok("tenant: B deleting A's rule is 404", crossDel.status === 404, crossDel.status);
  const patched = await A.patch(`/api/approval-rules/${made.json.id}`, { name: "Renamed" });
  ok("rules: the owner can edit", patched.status === 200 && patched.json?.name === "Renamed", patched.json);
  const gone = await A.del(`/api/approval-rules/${made.json.id}`);
  ok("rules: delete deactivates", gone.status === 200 && gone.json?.isActive === false && (await db.query(`SELECT 1 FROM approval_rules WHERE id = $1`, [made.json.id])).rows.length === 1, gone.json);
}

async function approvalsBill() {
  const A = await newCompany("abA");
  const B = await newCompany("abB");
  const emp = await A.member("employee");
  const acct = await A.member("accountant");
  const acct2 = await A.member("accountant");
  const rule = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "Over 5,000", thresholdAed: 5000, approverRoles: ["accountant", "owner"] });

  // D2-4: 6,000 + VAT = 6,300 needs two steps
  const big = await A.bill(prevMid, 6000, { vendor_name: "Big Vendor" }, false, emp.token);
  const r1 = await A.post(`/api/bills/${big}/approve`, {}, emp.token);
  ok("D2-4: an employee's approval is 403 APPROVAL_REQUIRED naming the role and step", r1.status === 403 && r1.json?.code === "APPROVAL_REQUIRED" && r1.json?.requiredRole === "accountant" && r1.json?.step === 1 && r1.json?.requiredSteps === 2, { s: r1.status, j: r1.json });
  ok("D2-4: nothing was recorded for the refused call", n((await db.query(`SELECT COUNT(*) AS c FROM approval_requests WHERE document_id = $1`, [big])).rows[0].c) === 0);
  const r2 = await A.post(`/api/bills/${big}/approve`, {}, acct.token);
  ok("D2-4: the accountant's approval is step 1 of 2, status pending_approval", r2.status === 200 && r2.json?.status === "pending_approval" && r2.json?.approval?.completedSteps === 1 && r2.json?.approval?.requiredSteps === 2 && r2.json?.approval?.nextRole === "owner", { s: r2.status, j: r2.json });
  ok("D2-4: no journal entry yet", (await A.jes("bill", big)).length === 0);
  const again = await A.post(`/api/bills/${big}/approve`, {}, acct.token);
  ok("D2-4: the same person cannot sign twice (403 APPROVER_ALREADY_SIGNED)", again.status === 403 && again.json?.code === "APPROVER_ALREADY_SIGNED", { s: again.status, j: again.json });
  const lowRank = await A.post(`/api/bills/${big}/approve`, {}, acct2.token);
  ok("D2-4: a second accountant cannot sign the owner's step (403 APPROVAL_REQUIRED, role owner)", lowRank.status === 403 && lowRank.json?.code === "APPROVAL_REQUIRED" && lowRank.json?.requiredRole === "owner", { s: lowRank.status, j: lowRank.json });
  const pay = await A.post(`/api/bills/${big}/payments`, { amount: 10, payment_date: prevMid });
  ok("D2-4: pay while waiting for approval is 409 APPROVAL_IN_PROGRESS", pay.status === 409 && pay.json?.code === "APPROVAL_IN_PROGRESS", { s: pay.status, j: pay.json });
  const edit = await A.patch(`/api/bills/${big}`, { notes: "x" });
  ok("D2-4: edit while waiting for approval is 409 APPROVAL_IN_PROGRESS", edit.status === 409 && edit.json?.code === "APPROVAL_IN_PROGRESS", { s: edit.status, j: edit.json });
  const del = await A.del(`/api/bills/${big}`);
  ok("D2-4: delete while waiting for approval is 409 APPROVAL_IN_PROGRESS", del.status === 409 && del.json?.code === "APPROVAL_IN_PROGRESS", { s: del.status, j: del.json });
  const hist = await A.get(`/api/approvals/bill/${big}`);
  ok("D2-4: history shows one request with one approved step", hist.status === 200 && hist.json.requests.length === 1 && hist.json.requests[0].steps.length === 1 && hist.json.requests[0].completedSteps === 1, hist.json);
  const note = n((await db.query(`SELECT COUNT(*) AS c FROM notifications WHERE company_id = $1 AND related_entity_id = $2 AND user_id = $3`, [A.cid, big, A.userId])).rows[0].c);
  ok("D2-4: the owner is notified in-app that the second step is waiting", note >= 1, note);
  const crossHist = await B.get(`/api/approvals/bill/${big}`);
  ok("tenant: B cannot read A's approval history (404)", crossHist.status === 404, crossHist.status);
  const crossReject = await B.post(`/api/approvals/bill/${big}/reject`, { comment: "no" });
  ok("tenant: B rejecting A's request is 404 and nothing is written", crossReject.status === 404 && (await db.query(`SELECT status FROM vendor_bills WHERE id = $1`, [big])).rows[0].status === "pending_approval", crossReject.status);

  // a rule edited or switched off mid-request does not change the request in flight
  await A.patch(`/api/approval-rules/${rule.json.id}`, { approverRoles: ["accountant"], isActive: false });
  const fin = await A.post(`/api/bills/${big}/approve`, {});
  ok("D2-4: the owner's approval completes it, under the roles snapshot taken at step 1", fin.status === 200 && fin.json?.status === "approved", { s: fin.status, j: fin.json });
  ok("D2-4: exactly one bill journal entry", (await A.jes("bill", big)).length === 1);
  ok("D2-4: an audit row per step", (await auditCount("bill", big, "approval.step_approved")) === 2, await auditCount("bill", big, "approval.step_approved"));
  const ledger = await A.balances();
  ok("D2-4: A/P holds the bill (6,300)", close(ledger["2010"], -6300), ledger);
  await A.patch(`/api/approval-rules/${rule.json.id}`, { approverRoles: ["accountant", "owner"], isActive: true });

  // the person who entered a bill never approves it, whatever their rank
  const own = await A.bill(prevMid, 5000, { vendor_name: "Own Vendor" }, false);
  const selfTry = await A.post(`/api/bills/${own}/approve`, {});
  ok("self-approval: the owner who created a 5,300 bill under a two-step rule is refused SELF_APPROVAL", selfTry.status === 403 && selfTry.json?.code === "SELF_APPROVAL", { s: selfTry.status, j: selfTry.json });
  ok("self-approval: nothing was recorded or posted", (await A.jes("bill", own)).length === 0 && n((await db.query(`SELECT COUNT(*) AS c FROM approval_requests WHERE document_id = $1`, [own])).rows[0].c) === 0);
  const createdBy = (await db.query(`SELECT created_by FROM vendor_bills WHERE id = $1`, [own])).rows[0].created_by;
  ok("self-approval: the bill records its creator", createdBy === A.userId, createdBy);
  const byOther = await A.post(`/api/bills/${own}/approve`, {}, acct.token);
  ok("self-approval: another person can still take step 1", byOther.status === 200 && byOther.json?.status === "pending_approval", { s: byOther.status, j: byOther.json });

  // below the threshold: one step, as before
  const small = await A.bill(prevMid, 4000, { vendor_name: "Small Vendor" }, false);
  const s1 = await A.post(`/api/bills/${small}/approve`, {}, acct.token);
  ok("D2-4: a 4,200 bill approves in one step", s1.status === 200 && s1.json?.status === "approved", { s: s1.status, j: s1.json?.status });

  // ten parallel final approvals post once
  const race = await A.bill(prevMid, 6000, { vendor_name: "Race Vendor" }, false, emp.token);
  await A.post(`/api/bills/${race}/approve`, {}, acct.token);
  const burst = await Promise.all(Array.from({ length: 10 }, () => A.post(`/api/bills/${race}/approve`, {})));
  ok("D2-4: ten parallel final approvals: one 200", burst.filter((r) => r.status === 200).length === 1, burst.map((r) => r.status));
  ok("D2-4: ...one journal entry", (await A.jes("bill", race)).length === 1, (await A.jes("bill", race)).length);

  // reject restores the bill and frees it
  const rej = await A.bill(prevMid, 6000, { vendor_name: "Reject Vendor" }, false, emp.token);
  await A.post(`/api/bills/${rej}/approve`, {}, acct.token);
  const rejected = await A.post(`/api/approvals/bill/${rej}/reject`, { comment: "wrong amount" }, acct2.token);
  ok("reject: a person below the next role cannot reject (403)", rejected.status === 403, rejected.status);
  const rejectedOwner = await A.post(`/api/approvals/bill/${rej}/reject`, { comment: "wrong amount" });
  ok("reject: the owner rejects; the bill goes back to draft (F4)", rejectedOwner.status === 200 && rejectedOwner.json?.status === "rejected" && (await db.query(`SELECT status FROM vendor_bills WHERE id = $1`, [rej])).rows[0].status === "draft", rejectedOwner.json);
  const editAfter = await A.patch(`/api/bills/${rej}`, { notes: "fixed" });
  ok("reject: the bill can be edited again", editAfter.status === 200, editAfter.status);

  // queue
  const q = await A.get(`/api/companies/${A.cid}/approvals`);
  ok("queue: a rejected bill is no longer waiting for approval (F4)", q.status === 200 && !q.json.some((row) => row.documentId === rej), q.json?.slice?.(0, 3));
  const unsigned = await A.bill(prevMid, 6000, { vendor_name: "Unsigned Vendor" }, false, emp.token);
  const q2 = await A.get(`/api/companies/${A.cid}/approvals`);
  ok("queue: pending lists the unsigned bill a rule covers", q2.status === 200 && q2.json.some((row) => row.documentId === unsigned && row.requestId === null && row.canAct === true), q2.json?.slice?.(0, 3));
  const history = await A.get(`/api/companies/${A.cid}/approvals?status=approved`);
  ok("queue: approved lists finished requests", history.status === 200 && history.json.some((row) => row.documentId === big), history.status);
  const qCross = await B.get(`/api/companies/${B.cid}/approvals`);
  ok("tenant: B's queue never shows A's documents", qCross.status === 200 && qCross.json.length === 0, qCross.json?.length);
}

async function approvalsOtherDocuments() {
  const A = await newCompany("aoA");
  const acct = await A.member("accountant");
  const acct2 = await A.member("accountant");
  const cfo = await A.member("cfo");
  const emp = await A.member("employee");
  const ruleFor = (documentType, approverRoles, thresholdAed = 0) =>
    A.post(`/api/companies/${A.cid}/approval-rules`, { documentType, name: documentType + " rule", thresholdAed, approverRoles });
  const claimRule = await ruleFor("expense_claim", ["accountant"], 100);
  const poRule = await ruleFor("purchase_order", ["cfo"]);
  const journalRule = await ruleFor("manual_journal", ["owner"]);
  const payrollRule = await ruleFor("payroll_run", ["accountant", "owner"]);

  // --- expense claim: the submitter never approves their own claim
  const claim = await A.post(`/api/companies/${A.cid}/expense-claims`, { title: "Client lunch", items: [{ expense_date: prevMid, category: "office supplies", description: "Paper", amount: 300, vat_amount: 15 }] }, acct.token);
  await A.post(`/api/expense-claims/${claim.json.id}/submit`, {}, acct.token);
  const c1 = await A.post(`/api/expense-claims/${claim.json.id}/approve`, {}, emp.token);
  ok("D2-5 claim: an employee's approval is 403 APPROVAL_REQUIRED", c1.status === 403 && c1.json?.code === "APPROVAL_REQUIRED", { s: c1.status, j: c1.json });
  const c2 = await A.post(`/api/expense-claims/${claim.json.id}/approve`, {}, acct.token);
  ok("D2-5 claim: the submitter cannot approve their own claim (403 SELF_APPROVAL)", c2.status === 403 && c2.json?.code === "SELF_APPROVAL", { s: c2.status, j: c2.json });
  const c3 = await A.post(`/api/expense-claims/${claim.json.id}/approve`, {}, acct2.token);
  ok("D2-5 claim: another accountant approves in one step and it posts", c3.status === 200 && c3.json?.status === "approved" && (await A.jes("expense_claim", claim.json.id)).length === 1, { s: c3.status, j: c3.json });
  const small = await A.post(`/api/companies/${A.cid}/expense-claims`, { title: "Small", items: [{ expense_date: prevMid, category: "office", description: "Pens", amount: 50, vat_amount: 0 }] }, emp.token);
  await A.post(`/api/expense-claims/${small.json.id}/submit`, {}, emp.token);
  const c4 = await A.post(`/api/expense-claims/${small.json.id}/approve`, {}, acct.token);
  ok("D2-5 claim: below the threshold the existing approval applies", c4.status === 200 && c4.json?.status === "approved", { s: c4.status, j: c4.json?.status });

  // --- purchase order
  const po = await A.post(`/api/companies/${A.cid}/purchase-orders`, { number: "PO-A-" + rnd, vendorName: "PO Vendor", date: prevMid, lines: [{ description: "Desks", quantity: 1, unitPrice: 800, vatRate: 0.05 }] });
  await A.post(`/api/purchase-orders/${po.json.id}/send`, {});
  const rcvEarly = await A.post(`/api/purchase-orders/${po.json.id}/receive`, {});
  ok("fix 4: with a PO rule, a sent (unapproved) order cannot be received", rcvEarly.status === 400 && rcvEarly.json?.code === "APPROVAL_REQUIRED_BEFORE_RECEIVE", { s: rcvEarly.status, j: rcvEarly.json });
  const p1 = await A.post(`/api/purchase-orders/${po.json.id}/approve`, {}, acct.token);
  ok("D2-5 PO: an accountant cannot sign a cfo step (403 APPROVAL_REQUIRED)", p1.status === 403 && p1.json?.code === "APPROVAL_REQUIRED" && p1.json?.requiredRole === "cfo", { s: p1.status, j: p1.json });
  const p2 = await A.post(`/api/purchase-orders/${po.json.id}/approve`, {}, cfo.token);
  ok("D2-5 PO: the cfo approves", p2.status === 200 && p2.json?.status === "approved", { s: p2.status, j: p2.json?.status });
  const rcv = await A.post(`/api/purchase-orders/${po.json.id}/receive`, {});
  ok("fix 4: an approved order is received", rcv.status === 200 && rcv.json?.status === "received", { s: rcv.status, j: rcv.json?.status });

  // --- manual journal
  const bank = await A.accountId("1020"), exp = await A.accountId("5000");
  const draftBody = (extra = {}) => ({ date: prevMid, memo: "Adjustment", status: "draft", lines: [{ accountId: exp, debit: 500, credit: 0 }, { accountId: bank, debit: 0, credit: 500 }], ...extra });
  const j1 = await A.post(`/api/companies/${A.cid}/journal`, draftBody(), acct.token);
  const j1post = await A.post(`/api/journal/${j1.json.id}/post`, {}, acct.token);
  ok("D2-5 journal: an accountant cannot post a journal an owner rule covers (403 APPROVAL_REQUIRED)", j1post.status === 403 && j1post.json?.code === "APPROVAL_REQUIRED", { s: j1post.status, j: j1post.json });
  const sub = await A.post(`/api/journal/${j1.json.id}/submit-for-approval`, {}, acct.token);
  ok("D2-5 journal: submit-for-approval opens a pending request", sub.status === 201 && sub.json?.status === "pending", { s: sub.status, j: sub.json });
  const jPut = await A.put(`/api/journal/${j1.json.id}`, { date: prevMid, lines: draftBody().lines }, acct.token);
  ok("D2-5 journal: a submitted draft cannot be edited (409 APPROVAL_IN_PROGRESS)", jPut.status === 409 && jPut.json?.code === "APPROVAL_IN_PROGRESS", { s: jPut.status, j: jPut.json });
  const jDel = await A.del(`/api/journal/${j1.json.id}`, acct.token);
  ok("D2-5 journal: ...nor deleted", jDel.status === 409 && jDel.json?.code === "APPROVAL_IN_PROGRESS", { s: jDel.status, j: jDel.json });
  const j1ok = await A.post(`/api/journal/${j1.json.id}/post`, {});
  ok("D2-5 journal: the owner posts it (final step)", j1ok.status === 200 && j1ok.json?.status === "posted", { s: j1ok.status, j: j1ok.json });
  const own = await A.post(`/api/companies/${A.cid}/journal`, draftBody());
  const ownPost = await A.post(`/api/journal/${own.json.id}/post`, {});
  ok("D2-5 journal: the creator cannot approve their own journal, and nobody else holds the owner role (409 NO_ELIGIBLE_APPROVER)", ownPost.status === 409 && ownPost.json?.code === "NO_ELIGIBLE_APPROVER" && ownPost.json?.requiredRole === "owner", { s: ownPost.status, j: ownPost.json });
  const asPostedAcct = await A.post(`/api/companies/${A.cid}/journal`, draftBody({ status: "posted" }), acct.token);
  ok("D2-5 journal: created as posted by someone below the rule's role is 403 (save a draft)", asPostedAcct.status === 403 && asPostedAcct.json?.code === "APPROVAL_REQUIRED", { s: asPostedAcct.status, j: asPostedAcct.json });
  const asPostedOwner = await A.post(`/api/companies/${A.cid}/journal`, draftBody({ status: "posted" }));
  ok("D2-5 journal: created as posted by the one approver the rule needs passes and leaves a trail", asPostedOwner.status === 200 && asPostedOwner.json?.status === "posted" && (await auditCount("manual_journal", asPostedOwner.json.id, "approval.step_approved")) === 1, { s: asPostedOwner.status, j: asPostedOwner.json });

  // --- payroll run
  const emp1 = await A.post(`/api/companies/${A.cid}/employees`, { fullName: "Pay Roll One", nationality: "India", basicSalary: 6000, joinDate: "2024-01-01" });
  ok("setup: employee created", emp1.status === 200 || emp1.status === 201, emp1.status);
  const { month, year } = prevMonthYear();
  // the preparer is a second accountant: a run's creator never approves it (payroll_runs.created_by)
  await A.patch(`/api/companies/${A.cid}`, { mohreEstablishmentId: "0000123456789", wpsEmployerRoutingCode: "123456789" });
  await A.patch(`/api/employees/${emp1.json.id}`, { molPersonId: "12345678901234", routingCode: "987654321", iban: "AE070331234567890123456" });
  const run = await A.post(`/api/companies/${A.cid}/payroll-runs`, { periodMonth: month, periodYear: year }, acct2.token);
  await A.post(`/api/payroll-runs/${run.json.id}/calculate`, {}, acct2.token);
  const sifEarly = await api("GET", `/api/payroll-runs/${run.json.id}/generate-sif`, { token: A.token });
  ok("fix 3: the WPS file of an unapproved run is 409 PAYROLL_NOT_APPROVED", sifEarly.status === 409 && sifEarly.json?.code === "PAYROLL_NOT_APPROVED", { s: sifEarly.status, j: sifEarly.json });
  const patchStatus = await A.patch(`/api/payroll-runs/${run.json.id}`, { status: "approved" });
  ok("payroll: a PATCH cannot set the status around the approval", (await db.query(`SELECT status FROM payroll_runs WHERE id = $1`, [run.json.id])).rows[0].status === "calculated", patchStatus.status);
  const pr1 = await A.post(`/api/payroll-runs/${run.json.id}/approve`, {}, emp.token);
  ok("D2-5 payroll: an employee's approval is 403 APPROVAL_REQUIRED", pr1.status === 403 && pr1.json?.code === "APPROVAL_REQUIRED", { s: pr1.status, j: pr1.json });
  const pr2 = await A.post(`/api/payroll-runs/${run.json.id}/approve`, {}, acct.token);
  ok("D2-5 payroll: the accountant's approval is step 1 of 2", pr2.status === 200 && pr2.json?.status === "pending_approval" && pr2.json?.approval?.completedSteps === 1, { s: pr2.status, j: pr2.json });
  ok("D2-5 payroll: nothing posted yet", (await A.jes("system", run.json.id)).length === 0);
  const recalc = await A.post(`/api/payroll-runs/${run.json.id}/calculate`, {});
  ok("D2-5 payroll: recalculating a run waiting for approval is 409 APPROVAL_IN_PROGRESS", recalc.status === 409 && recalc.json?.code === "APPROVAL_IN_PROGRESS", { s: recalc.status, j: recalc.json });
  const sifWait = await api("GET", `/api/payroll-runs/${run.json.id}/generate-sif`, { token: A.token });
  ok("D2-5 payroll: no WPS file while waiting", sifWait.status === 409, sifWait.status);
  const pr3 = await A.post(`/api/payroll-runs/${run.json.id}/approve`, {});
  ok("D2-5 payroll: the owner's approval completes it", pr3.status === 200 && pr3.json?.status === "approved" && (await A.jes("system", run.json.id)).length === 1, { s: pr3.status, j: pr3.json?.status });
  const sifOk = await api("GET", `/api/payroll-runs/${run.json.id}/generate-sif`, { token: A.token });
  ok("fix 3: the WPS file is produced for the approved run", sifOk.status === 200 && sifOk.text.startsWith("EDR") && sifOk.text.trim().split("\n").pop().startsWith("SCR"), { s: sifOk.status });

  // queue shows all five types while pending
  const claim2 = await A.post(`/api/companies/${A.cid}/expense-claims`, { title: "Pending claim", items: [{ expense_date: prevMid, category: "office", description: "Ink", amount: 400, vat_amount: 0 }] }, acct.token);
  await A.post(`/api/expense-claims/${claim2.json.id}/submit`, {}, acct.token);
  const po2 = await A.post(`/api/companies/${A.cid}/purchase-orders`, { number: "PO-B-" + rnd, vendorName: "PO Vendor", date: prevMid, lines: [{ description: "Desks", quantity: 1, unitPrice: 800, vatRate: 0.05 }] });
  await A.post(`/api/purchase-orders/${po2.json.id}/send`, {});
  const j2 = await A.post(`/api/companies/${A.cid}/journal`, draftBody(), acct.token);
  await ruleFor("bill", ["accountant"], 0);
  await A.bill(prevMid, 900, { vendor_name: "Queue Vendor" }, false);
  const emp2 = await A.post(`/api/companies/${A.cid}/employees`, { fullName: "Pay Roll Two", nationality: "India", basicSalary: 7000, joinDate: "2024-01-01" });
  const nextRun = await A.post(`/api/companies/${A.cid}/payroll-runs`, { periodMonth: month === 1 ? 12 : month - 1, periodYear: month === 1 ? year - 1 : year });
  await A.post(`/api/payroll-runs/${nextRun.json.id}/calculate`, {});
  const queue = await A.get(`/api/companies/${A.cid}/approvals`);
  const types = new Set((queue.json ?? []).map((row) => row.documentType));
  ok("D2-5: the queue lists all five document types", ["bill", "expense_claim", "purchase_order", "payroll_run", "manual_journal"].every((t) => types.has(t)), [...types]);
  void emp2; void j2; void claimRule; void poRule; void journalRule; void payrollRule;
}

async function approvalsPayrollRace() {
  const A = await newCompany("prA");
  await A.post(`/api/companies/${A.cid}/employees`, { fullName: "Race Employee", nationality: "India", basicSalary: 6000, joinDate: "2024-01-01" });
  const { month, year } = prevMonthYear();
  const run = await A.post(`/api/companies/${A.cid}/payroll-runs`, { periodMonth: month, periodYear: year });
  await A.post(`/api/payroll-runs/${run.json.id}/calculate`, {});
  const burst = await Promise.all(Array.from({ length: 10 }, () => A.post(`/api/payroll-runs/${run.json.id}/approve`, {})));
  ok("fix 2: ten parallel payroll approves: exactly one 200", burst.filter((r) => r.status === 200).length === 1, burst.map((r) => r.status));
  ok("fix 2: ...and one payroll journal entry", (await A.jes("system", run.json.id)).length === 1, (await A.jes("system", run.json.id)).length);
}

// ---------------------------------------------------------------------------
// E. Projects (0107): D2-1, D2-2, D2-3
// ---------------------------------------------------------------------------

async function projectsFlow() {
  const A = await newCompany("pjA");
  const B = await newCompany("pjB");
  const emp = await A.member("employee");
  const customer = (await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "Project Customer LLC", email: "pc@example.com" })).json;
  const bCustomer = (await B.post(`/api/companies/${B.cid}/customer-contacts`, { name: "B Customer" })).json;

  const made = await A.post(`/api/companies/${A.cid}/projects`, { name: "Website build", contactId: customer.id, hourlyRate: 200, budgetAmount: 4000, budgetHours: 10 });
  const projectId = made.json?.id;
  ok("project: created with a P-0001 code, hourly, AED", made.status === 201 && made.json?.code === "P-0001" && made.json?.billingMethod === "hourly" && made.json?.currency === "AED", { s: made.status, j: made.json });
  const second = await A.post(`/api/companies/${A.cid}/projects`, { name: "Second" });
  ok("project: the next code is P-0002", second.json?.code === "P-0002", second.json?.code);
  const badContact = await A.post(`/api/companies/${A.cid}/projects`, { name: "x", contactId: bCustomer.id });
  ok("tenant: another company's customer on a project is 422 INVALID_CONTACT", badContact.status === 422 && badContact.json?.code === "INVALID_CONTACT", { s: badContact.status, j: badContact.json });
  const vendorOnly = (await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "Vendor Only", contactType: "vendor" })).json;
  const vendorProject = await A.post(`/api/companies/${A.cid}/projects`, { name: "x", contactId: vendorOnly.id });
  ok("project: a vendor-only contact cannot be the customer", vendorProject.status === 422, vendorProject.status);
  const stranger = await B.get(`/api/projects/${projectId}`);
  ok("tenant: B reading A's project is 404", stranger.status === 404, stranger.status);
  const strangerList = await B.get(`/api/companies/${A.cid}/projects`);
  ok("tenant: B listing A's projects is 403", strangerList.status === 403, strangerList.status);

  // tasks
  const task = await A.post(`/api/projects/${projectId}/tasks`, { name: "Design" });
  const freeTask = await A.post(`/api/projects/${projectId}/tasks`, { name: "Internal", isBillable: false });
  ok("tasks: created billable by default", task.status === 201 && task.json?.isBillable === true && freeTask.json?.isBillable === false, { t: task.json, f: freeTask.json });
  const taskOnB = await B.post(`/api/projects/${projectId}/tasks`, { name: "x" });
  ok("tenant: B cannot add a task to A's project", taskOnB.status === 404, taskOnB.status);

  // D2-1: 2h and 1.5h billable, 0.5h non-billable
  const e1 = await A.post(`/api/companies/${A.cid}/time-entries`, { projectId, entryDate: prevMid, hours: 2, notes: "Wireframes" });
  const e2 = await A.post(`/api/companies/${A.cid}/time-entries`, { projectId, entryDate: prevMid, minutes: 90, taskId: task.json.id });
  const e3 = await A.post(`/api/companies/${A.cid}/time-entries`, { projectId, entryDate: prevMid, minutes: 30, isBillable: false });
  ok("time: entries created (hours or minutes)", [e1, e2, e3].every((r) => r.status === 201) && e1.json?.minutes === 120, [e1.status, e2.status, e3.status]);
  const nonBillableTask = await A.post(`/api/companies/${A.cid}/time-entries`, { projectId, entryDate: prevMid, minutes: 60, taskId: freeTask.json.id });
  ok("time: an entry on a non-billable task is accepted", nonBillableTask.status === 201, nonBillableTask.status);
  const tooLong = await A.post(`/api/companies/${A.cid}/time-entries`, { projectId, entryDate: prevMid, minutes: 1500 });
  ok("time: more than 24 hours is refused", tooLong.status === 400, tooLong.status);
  const foreignProject = await B.post(`/api/companies/${B.cid}/time-entries`, { projectId, entryDate: prevMid, minutes: 60 });
  ok("tenant: time on A's project from B's company is 422 INVALID_PROJECT", foreignProject.status === 422 && foreignProject.json?.code === "INVALID_PROJECT", { s: foreignProject.status, j: foreignProject.json });
  const wrongTask = await A.post(`/api/companies/${A.cid}/time-entries`, { projectId: second.json.id, entryDate: prevMid, minutes: 60, taskId: task.json.id });
  ok("time: a task of another project is 422 INVALID_TASK", wrongTask.status === 422 && wrongTask.json?.code === "INVALID_TASK", { s: wrongTask.status, j: wrongTask.json });

  let unbilled = (await A.get(`/api/projects/${projectId}/unbilled`)).json;
  ok("D2-1: unbilled hours 3.5 and amount 700 (non-billable time left out)", close(unbilled.unbilledHours, 3.5) && close(unbilled.unbilledAmount, 700) && unbilled.timeEntries.length === 2, unbilled);

  // timer
  const start = await A.post(`/api/companies/${A.cid}/timer/start`, { projectId, notes: "Timer work" });
  ok("D2-1: the timer starts", start.status === 201 && start.json?.running === true, { s: start.status, j: start.json });
  const second2 = await A.post(`/api/companies/${A.cid}/timer/start`, { projectId });
  ok("D2-1: a second start is 409 TIMER_ALREADY_RUNNING", second2.status === 409 && second2.json?.code === "TIMER_ALREADY_RUNNING", { s: second2.status, j: second2.json });
  const running = await A.get(`/api/companies/${A.cid}/timer`);
  ok("timer: GET returns the running entry", running.json?.running?.id === start.json?.id, running.json);
  // backdate the start by 90 s + 29 s so the stop rounds to 2 minutes (119 s -> 2 min)
  await db.query(`UPDATE time_entries SET started_at = started_at - interval '119 seconds' WHERE id = $1`, [start.json.id]);
  const stop = await A.post(`/api/companies/${A.cid}/timer/stop`, {});
  ok("D2-1: stopping rounds to the nearest minute (119 s = 2 min)", stop.status === 200 && stop.json?.minutes === 2 && stop.json?.running === false, { s: stop.status, j: stop.json });
  const stopAgain = await A.post(`/api/companies/${A.cid}/timer/stop`, {});
  ok("timer: stopping with none running is 404 NO_RUNNING_TIMER", stopAgain.status === 404 && stopAgain.json?.code === "NO_RUNNING_TIMER", { s: stopAgain.status, j: stopAgain.json });
  await A.del(`/api/time-entries/${start.json.id}`);
  const burst = await Promise.all(Array.from({ length: 6 }, () => A.post(`/api/companies/${A.cid}/timer/start`, { projectId })));
  ok("timer: six parallel starts yield one running timer", burst.filter((r) => r.status === 201).length === 1 && burst.filter((r) => r.status === 409).length === 5, burst.map((r) => r.status));
  const burstId = burst.find((r) => r.status === 201).json.id;
  const patchRunning = await A.patch(`/api/time-entries/${burstId}`, { notes: "x" });
  ok("time: a running timer cannot be edited", patchRunning.status === 409 && patchRunning.json?.code === "TIMER_RUNNING", { s: patchRunning.status, j: patchRunning.json });
  await A.post(`/api/companies/${A.cid}/timer/stop`, {});
  await A.del(`/api/time-entries/${burstId}`);

  // employees edit only their own entries
  const byEmp = await A.patch(`/api/time-entries/${e1.json.id}`, { notes: "mine?" }, emp.token);
  ok("time: an employee cannot change someone else's entry (403)", byEmp.status === 403, byEmp.status);
  const crossEntry = await B.patch(`/api/time-entries/${e1.json.id}`, { notes: "x" });
  ok("tenant: B changing A's time entry is 404", crossEntry.status === 404, crossEntry.status);
  const crossDelete = await B.del(`/api/time-entries/${e1.json.id}`);
  ok("tenant: B deleting A's time entry is 404", crossDelete.status === 404, crossDelete.status);

  // costs: a billable bill line (500) and a claim item (300) tagged with the project
  const billId = await A.bill(prevMid, 500, { vendor_name: "Print Shop", line_items: [{ description: "Brochures", quantity: 1, unit_price: 500, vat_rate: 5, project_id: projectId, is_billable: true }] }, false);
  const claim = (await A.post(`/api/companies/${A.cid}/expense-claims`, { title: "Travel", items: [{ expense_date: prevMid, category: "travel", description: "Taxi", amount: 300, vat_amount: 15, project_id: projectId, is_billable: true }] })).json;
  await A.post(`/api/expense-claims/${claim.id}/submit`, {});
  const noCostYet = (await A.get(`/api/projects/${projectId}/unbilled`)).json;
  ok("D2-2: costs are not billable before the bill and claim are approved", noCostYet.expenses.length === 0, noCostYet.expenses);
  const foreignLine = await A.post(`/api/companies/${A.cid}/bills`, { vendor_name: "x", bill_date: prevMid, line_items: [{ description: "x", quantity: 1, unit_price: 1, vat_rate: 5, project_id: (await B.post(`/api/companies/${B.cid}/projects`, { name: "B project" })).json.id }] });
  ok("tenant: B's project on A's bill line is 422 INVALID_PROJECT", foreignLine.status === 422 && foreignLine.json?.code === "INVALID_PROJECT", { s: foreignLine.status, j: foreignLine.json });
  const approveBill = await A.post(`/api/bills/${billId}/approve`, {});
  const approveClaim = await A.post(`/api/expense-claims/${claim.id}/approve`, {});
  ok("setup: bill and claim approved", approveBill.status === 200 && approveClaim.status === 200, [approveBill.status, approveClaim.status]);
  unbilled = (await A.get(`/api/projects/${projectId}/unbilled`)).json;
  ok("D2-2: both costs appear (net, AED) once approved", unbilled.expenses.length === 2 && close(unbilled.unbilledExpenses, 800), unbilled.expenses);

  // the claim's journal carries the project on the expense line, the bill's too
  const taggedCost = n((await db.query(`SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1 AND jl.project_id = $2 AND je.status = 'posted'`, [A.cid, projectId])).rows[0].c);
  ok("D2-2: the ledger lines of the bill and the claim are tagged with the project (800 of cost)", close(taggedCost, 800), taggedCost);

  // invoice from unbilled
  const inv = await A.post(`/api/projects/${projectId}/invoice`, { vatRate: 5 });
  ok("D2-2: the project invoice is a 201 draft", inv.status === 201 && inv.json?.status === "draft" && inv.json?.contactId === customer.id, { s: inv.status, j: inv.json });
  const invLines = (await db.query(`SELECT description, quantity, unit_price, vat_rate, project_id FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [inv.json.id])).rows;
  ok("D2-2: four lines, each tagged with the project, VAT 5%", invLines.length === 4 && invLines.every((l) => l.project_id === projectId && close(l.vat_rate, 0.05)), invLines);
  ok("D2-2: totals 1,500 + VAT 75 = 1,575", close(inv.json?.subtotal, 1500) && close(inv.json?.vatAmount, 75) && close(inv.json?.total, 1575), { s: inv.json?.subtotal, v: inv.json?.vatAmount, t: inv.json?.total });
  const again = await A.post(`/api/projects/${projectId}/invoice`, {});
  ok("D2-2: a second call is 409 NOTHING_TO_BILL", again.status === 409 && again.json?.code === "NOTHING_TO_BILL", { s: again.status, j: again.json });
  const billedEdit = await A.patch(`/api/time-entries/${e1.json.id}`, { minutes: 30 });
  ok("D2-2: billed time is read-only (409 TIME_ENTRY_BILLED)", billedEdit.status === 409 && billedEdit.json?.code === "TIME_ENTRY_BILLED", { s: billedEdit.status, j: billedEdit.json });
  const billedList = (await A.get(`/api/companies/${A.cid}/time-entries?projectId=${projectId}&billed=billed`)).json;
  ok("time list: filter billed", billedList.length === 2 && billedList.every((e) => e.billedInvoiceNumber), billedList.length);

  // issue it, then profitability (D2-3)
  const issue = await A.patch(`/api/invoices/${inv.json.id}/status`, { status: "sent" });
  ok("D2-3: the invoice is issued", issue.status === 200, { s: issue.status, j: issue.json });
  const profit = (await A.get(`/api/projects/${projectId}/profitability`)).json;
  ok("D2-3: revenue 1,500, costs 800, margin 700", close(profit.revenue, 1500) && close(profit.costs, 800) && close(profit.margin, 700), profit);
  const direct = (await db.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit) FILTER (WHERE a.type = 'income'), 0) AS revenue, COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE a.type = 'expense'), 0) AS costs
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND jl.project_id = $2`, [A.cid, projectId])).rows[0];
  ok("D2-3: profitability equals a direct sum over journal_lines", close(profit.revenue, direct.revenue) && close(profit.costs, direct.costs), { profit, direct });
  ok("D2-3: margin 46.67 %, hours and budget used", close(profit.marginPct, 46.67) && close(profit.hours.billed, 3.5) && close(profit.budget.usedPct, 20) && close(profit.budget.hoursUsedPct, 50), profit);
  const tb = await A.balances();
  ok("D2-3: the ledger still balances (trial balance nets to zero)", close(Object.values(tb).reduce((a, b) => a + b, 0), 0), tb);
  const del = await A.del(`/api/projects/${projectId}`);
  ok("project: delete with activity is 409 PROJECT_HAS_ACTIVITY", del.status === 409 && del.json?.code === "PROJECT_HAS_ACTIVITY", { s: del.status, j: del.json });

  // voiding the issued invoice takes its revenue off the project and frees the time and costs again
  const voided = await A.patch(`/api/invoices/${inv.json.id}/status`, { status: "void" });
  ok("void: the project invoice is voided", voided.status === 200, { s: voided.status, j: voided.json });
  const afterVoid = (await A.get(`/api/projects/${projectId}/profitability`)).json;
  ok("void: project revenue falls back to 0 (the reversal carries the project tag); costs stay 800", close(afterVoid.revenue, 0) && close(afterVoid.costs, 800), afterVoid);
  const freedByVoid = (await A.get(`/api/projects/${projectId}/unbilled`)).json;
  ok("void: the time and costs of a voided invoice are unbilled again", close(freedByVoid.unbilledHours, 3.5) && close(freedByVoid.unbilledExpenses, 800), freedByVoid);

  // second project: draft deleted frees the entries; ten parallel invoices bill once
  const p2 = (await A.post(`/api/companies/${A.cid}/projects`, { name: "Free the entries", contactId: customer.id, hourlyRate: 100 })).json;
  await A.post(`/api/companies/${A.cid}/time-entries`, { projectId: p2.id, entryDate: prevMid, hours: 3 });
  const draft = await A.post(`/api/projects/${p2.id}/invoice`, {});
  const none = await A.post(`/api/projects/${p2.id}/invoice`, {});
  ok("D2-2: billed entries are not billed twice", draft.status === 201 && none.status === 409, [draft.status, none.status]);
  const delDraft = await A.patch(`/api/invoices/${draft.json.id}/status`, { status: "cancelled" });
  ok("D2-2: the draft invoice can be abandoned (cancelled; a posted-number draft is never hard-deleted: FTA retention)", delDraft.status === 200, { s: delDraft.status, j: delDraft.json });
  const freed = (await A.get(`/api/projects/${p2.id}/unbilled`)).json;
  ok("D2-2: abandoning the draft frees the entries", close(freed.unbilledHours, 3) && close(freed.unbilledAmount, 300), freed);
  const race = await Promise.all(Array.from({ length: 10 }, () => A.post(`/api/projects/${p2.id}/invoice`, {})));
  ok("concurrency: ten parallel /invoice calls: exactly one 201, the rest 409", race.filter((r) => r.status === 201).length === 1 && race.filter((r) => r.status === 409).length === 9, race.map((r) => r.status));
  const noCustomer = (await A.post(`/api/companies/${A.cid}/projects`, { name: "No customer", hourlyRate: 10 })).json;
  await A.post(`/api/companies/${A.cid}/time-entries`, { projectId: noCustomer.id, entryDate: prevMid, hours: 1 });
  const noC = await A.post(`/api/projects/${noCustomer.id}/invoice`, {});
  ok("project invoice: no customer is 422 PROJECT_HAS_NO_CUSTOMER", noC.status === 422 && noC.json?.code === "PROJECT_HAS_NO_CUSTOMER", { s: noC.status, j: noC.json });
  const strangerInvoice = await B.post(`/api/projects/${projectId}/invoice`, {});
  ok("tenant: B invoicing A's project is 404", strangerInvoice.status === 404, strangerInvoice.status);
  const notBilled = await A.post(`/api/projects/${p2.id}/invoice`, { timeEntryIds: ["00000000-0000-4000-8000-000000000000"] });
  ok("project invoice: an unknown time entry id is refused, not skipped", notBilled.status === 422 || notBilled.status === 409, notBilled.status);
}

// ---------------------------------------------------------------------------
// F. People (0109): D2-6 .. D2-10
// ---------------------------------------------------------------------------

const prevYear = Number(prevEnd.slice(0, 4));
const prevMonthNo = Number(prevEnd.slice(5, 7));
const joinTwoYearsAgo = `${prevYear - 2}-01-01`;
const newEmployee = async (C, name, extra = {}) => {
  const r = await C.post(`/api/companies/${C.cid}/employees`, { fullName: name, nationality: "India", basicSalary: 6000, joinDate: joinTwoYearsAgo, ...extra });
  if (!r.json?.id) throw new Error("employee failed " + r.status + " " + r.text.slice(0, 200));
  return r.json;
};
const leaveTypeId = async (C, code) => (await C.get(`/api/companies/${C.cid}/leave-types`)).json.find((t) => t.code === code)?.id;
const runFor = async (C) => {
  const { month, year } = prevMonthYear();
  const run = await C.post(`/api/companies/${C.cid}/payroll-runs`, { periodMonth: month, periodYear: year });
  if (!run.json?.id) throw new Error("run failed " + run.status + " " + run.text);
  return run.json.id;
};

async function leaveBalances() {
  const A = await newCompany("lvA");
  const B = await newCompany("lvB");
  const emp = await A.member("employee");
  const e1 = await newEmployee(A, "Leave Person");
  const bEmp = await newEmployee(B, "B Person");
  const types = (await A.get(`/api/companies/${A.cid}/leave-types`)).json;
  ok("leave: the default types are seeded on first use (annual, sick, maternity, parental, bereavement, study, hajj, unpaid)", ["annual", "sick", "maternity", "parental", "bereavement", "study", "hajj", "unpaid"].every((c) => types.some((t) => t.code === c)), types.map((t) => t.code));
  const annual = types.find((t) => t.code === "annual");
  ok("leave: annual is 30 days, monthly service accrual, carry-forward 30", annual.annualDays === 30 && annual.accrual === "monthly_service" && annual.carryForwardMaxDays === 30, annual);
  const noCarry = await A.patch(`/api/leave-types/${annual.id}`, { carryForwardMaxDays: 0 });
  ok("leave: the carry-forward maximum can be changed", noCarry.status === 200 && noCarry.json?.carryForwardMaxDays === 0, noCarry.json);

  const bal = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${prevEnd}&employeeId=${e1.id}`)).json.find((r) => r.code === "annual");
  ok(`D2-6: annual balance at ${prevEnd} is ${2.5 * prevMonthNo} (2.5 a month for ${prevMonthNo} months of this year, carry 0)`, close(bal?.balance, 2.5 * prevMonthNo) && close(bal?.opening, 0) && close(bal?.accrued, 2.5 * prevMonthNo), bal);

  const req1 = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: annual.id, startDate: prevMonthDay(14), endDate: prevMonthDay(18), reason: "Family" });
  ok("D2-6: a 5-day annual leave request is created pending", req1.status === 201 && req1.json?.status === "pending" && req1.json?.days === 5, { s: req1.status, j: req1.json });
  const after = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${prevEnd}&employeeId=${e1.id}`)).json.find((r) => r.code === "annual");
  ok("D2-6: pending leave reduces what is available (not the balance)", close(after.available, 2.5 * prevMonthNo - 5) && close(after.pending, 5) && close(after.balance, 2.5 * prevMonthNo), after);
  const overlap = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: annual.id, startDate: prevMonthDay(16), endDate: prevMonthDay(17) });
  ok("D2-6: overlapping leave is 409 LEAVE_OVERLAP", overlap.status === 409 && overlap.json?.code === "LEAVE_OVERLAP", { s: overlap.status, j: overlap.json });
  const tooMuch = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: annual.id, startDate: prevMonthDay(20), endDate: prevMonthDay(28) });
  ok("D2-6: more than is available is 422 LEAVE_INSUFFICIENT_BALANCE (when the balance is below 9)", prevMonthNo >= 4 || (tooMuch.status === 422 && tooMuch.json?.code === "LEAVE_INSUFFICIENT_BALANCE"), { s: tooMuch.status, j: tooMuch.json });
  const huge = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: annual.id, startDate: `${prevYear}-01-01`, endDate: `${prevYear}-02-28` });
  ok("D2-6: 59 days against less is 422 LEAVE_INSUFFICIENT_BALANCE with the available figure", huge.status === 422 && huge.json?.code === "LEAVE_INSUFFICIENT_BALANCE" && typeof huge.json?.available === "number", { s: huge.status, j: huge.json });
  const approve = await A.post(`/api/leave-requests/${req1.json.id}/approve`, {});
  ok("leave: approved", approve.status === 200 && approve.json?.status === "approved", { s: approve.status, j: approve.json });
  const taken = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${prevEnd}&employeeId=${e1.id}`)).json.find((r) => r.code === "annual");
  ok("leave: approved leave is taken (balance falls by 5)", close(taken.balance, 2.5 * prevMonthNo - 5) && close(taken.taken, 5), taken);
  const again = await A.post(`/api/leave-requests/${req1.json.id}/approve`, {});
  ok("leave: approving twice is 409 NOT_PENDING", again.status === 409 && again.json?.code === "NOT_PENDING", { s: again.status, j: again.json });
  const cancel = await A.post(`/api/leave-requests/${req1.json.id}/cancel`, {});
  ok("leave: an approved request can be cancelled (before payroll is approved)", cancel.status === 200 && cancel.json?.status === "cancelled", { s: cancel.status, j: cancel.json });

  // parallel: five identical requests, one gets in
  const sickId = await leaveTypeId(A, "sick");
  const burst = await Promise.all(Array.from({ length: 5 }, () => A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: sickId, startDate: prevMonthDay(2), endDate: prevMonthDay(3) })));
  ok("concurrency: five identical leave requests: exactly one 201, four 409 LEAVE_OVERLAP", burst.filter((r) => r.status === 201).length === 1 && burst.filter((r) => r.json?.code === "LEAVE_OVERLAP").length === 4, burst.map((r) => r.status));

  // role and tenant
  const byEmp = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: sickId, startDate: prevMonthDay(7), endDate: prevMonthDay(7) }, emp.token);
  ok("leave: an employee cannot create requests (403 ROLE_REQUIRED)", byEmp.status === 403 && byEmp.json?.code === "ROLE_REQUIRED", { s: byEmp.status, j: byEmp.json });
  const readByEmp = await A.get(`/api/companies/${A.cid}/leave-requests`, emp.token);
  ok("leave: any member can read", readByEmp.status === 200, readByEmp.status);
  const foreignEmp = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: bEmp.id, leaveTypeId: sickId, startDate: prevMonthDay(7), endDate: prevMonthDay(7) });
  ok("tenant: B's employee in A's leave request is 422 INVALID_EMPLOYEE", foreignEmp.status === 422 && foreignEmp.json?.code === "INVALID_EMPLOYEE", { s: foreignEmp.status, j: foreignEmp.json });
  const bType = await leaveTypeId(B, "sick");
  const foreignType = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: bType, startDate: prevMonthDay(7), endDate: prevMonthDay(7) });
  ok("tenant: B's leave type in A's request is 422 INVALID_LEAVE_TYPE", foreignType.status === 422 && foreignType.json?.code === "INVALID_LEAVE_TYPE", { s: foreignType.status, j: foreignType.json });
  const crossApprove = await B.post(`/api/leave-requests/${burst.find((r) => r.status === 201).json.id}/approve`, {});
  ok("tenant: B approving A's request is 404", crossApprove.status === 404, crossApprove.status);
  const crossBal = await B.get(`/api/companies/${A.cid}/leave-balances`);
  ok("tenant: B reading A's balances is 403", crossBal.status === 403, crossBal.status);
  const crossType = await B.patch(`/api/leave-types/${sickId}`, { annualDays: 1 });
  ok("tenant: B changing A's leave type is 404", crossType.status === 404, crossType.status);
  const override = await A.put(`/api/companies/${A.cid}/leave-balances`, { employeeId: e1.id, leaveTypeId: annual.id, year: prevYear, openingDays: 4, adjustmentDays: 1, note: "migrated" });
  const overridden = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${prevEnd}&employeeId=${e1.id}`)).json.find((r) => r.code === "annual");
  ok("leave: an opening balance and an adjustment override the derivation", override.status === 200 && close(overridden.opening, 4) && close(overridden.adjustment, 1), overridden);
}

async function sickLeavePayroll() {
  const A = await newCompany("skA");
  const e1 = await newEmployee(A, "Sick Person");
  const sickId = await leaveTypeId(A, "sick") ?? (await A.get(`/api/companies/${A.cid}/leave-types`)).json.find((t) => t.code === "sick").id;
  const r = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: sickId, startDate: prevMonthDay(1), endDate: prevMonthDay(20) });
  await A.post(`/api/leave-requests/${r.json.id}/approve`, {});
  const runId = await runFor(A);
  const calc = await A.post(`/api/payroll-runs/${runId}/calculate`, {});
  ok("D2-7: calculate accepts the run with approved sick leave", calc.status === 200, { s: calc.status, j: calc.json });
  const item = (await A.get(`/api/payroll-runs/${runId}/items`)).json[0];
  ok("D2-7: 20 sick days in the month: 5 half-pay days, deduction 500, net 5,500", close(item.leave_deduction, 500) && close(item.half_pay_leave_days, 5) && close(item.unpaid_leave_days, 0) && close(item.net_salary, 5500), item);
  const approve = await A.post(`/api/payroll-runs/${runId}/approve`, {});
  ok("D2-7: the run is approved", approve.status === 200, { s: approve.status, j: approve.json });
  const je = (await db.query(`SELECT jl.id, a.code, jl.debit, jl.credit FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.source = 'system' AND je.source_id = $2`, [A.cid, runId])).rows;
  const by = (code, side) => je.filter((l) => l.code === code).reduce((a, l) => a + n(l[side]), 0);
  ok("D2-7: salaries expense (5020) is debited 5,500: 500 less than the 6,000 gross", close(by("5020", "debit"), 5500), je);
  ok("D2-7: net payable (2030) is credited 5,500 and the entry balances", close(by("2030", "credit"), 5500) && close(je.reduce((a, l) => a + n(l.debit) - n(l.credit), 0), 0), je);
  const lateChange = await A.post(`/api/leave-requests/${r.json.id}/cancel`, {});
  ok("D2-7: leave inside an approved payroll month cannot be cancelled (409 LEAVE_IN_APPROVED_PAYROLL)", lateChange.status === 409 && lateChange.json?.code === "LEAVE_IN_APPROVED_PAYROLL", { s: lateChange.status, j: lateChange.json });
  const unpaidType = (await A.get(`/api/companies/${A.cid}/leave-types`)).json.find((t) => t.code === "unpaid").id;
  const lateNew = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: unpaidType, startDate: prevMonthDay(22), endDate: prevMonthDay(23) });
  const lateApprove = await A.post(`/api/leave-requests/${lateNew.json.id}/approve`, {});
  ok("D2-7: new unpaid leave in an approved payroll month cannot be approved", lateApprove.status === 409 && lateApprove.json?.code === "LEAVE_IN_APPROVED_PAYROLL", { s: lateApprove.status, j: lateApprove.json });

  // D2-10: register
  const reg = (await A.get(`/api/payroll-runs/${runId}/register`)).json;
  ok("D2-10: register has a row per employee with the components", reg.rows.length === 1 && close(reg.rows[0].gross, 6000) && close(reg.rows[0].leaveDeduction, 500) && close(reg.rows[0].net, 5500), reg.rows);
  ok("D2-10: register totals equal the run's totals", close(reg.totals.net, (await A.get(`/api/payroll-runs/${runId}`)).json.total_net) && close(reg.totals.leaveDeduction, 500), reg.totals);
  ok("D2-10: journal tie-out: net = Cr 2030, gross - leave = Dr 5020, all checks ok", reg.journalTieOut.available && reg.journalTieOut.ok && reg.journalTieOut.checks.some((c) => c.account === "5020" && close(c.ledger, 5500)), reg.journalTieOut);
  const csv = await api("GET", `/api/payroll-runs/${runId}/register?format=csv`, { token: A.token });
  ok("D2-10: register CSV has a header, a row and a total", csv.status === 200 && csv.text.split("\n").filter(Boolean).length === 3 && csv.text.startsWith("Employee no,Employee"), csv.text.slice(0, 120));
  const B = await newCompany("skB");
  const crossReg = await B.get(`/api/payroll-runs/${runId}/register`);
  ok("tenant: B reading A's register is 404", crossReg.status === 404, crossReg.status);
}

async function loansFlow() {
  const A = await newCompany("lnA");
  const B = await newCompany("lnB");
  const emp = await A.member("employee");
  const e1 = await newEmployee(A, "Loan Person");
  const bEmp = await newEmployee(B, "B Loan Person");
  const bank = await A.accountId("1020");
  const { month, year } = prevMonthYear();
  const body = (count, extra = {}) => ({ employeeId: e1.id, principal: 12000, instalmentCount: count, firstPeriodYear: year, firstPeriodMonth: month, disbursementDate: prevMonthDay(2), paymentAccountId: bank, ...extra });

  const prev = await A.post(`/api/companies/${A.cid}/employee-loans/preview`, body(10));
  ok("loans: preview returns the schedule and the 20 % cap", prev.status === 200 && prev.json.schedule.length === 10 && close(prev.json.maxInstalment, 1200) && prev.json.withinCap === true, prev.json);
  const prevBad = await A.post(`/api/companies/${A.cid}/employee-loans/preview`, body(6));
  ok("loans: preview shows a schedule over the cap as not within it", prevBad.status === 200 && prevBad.json.withinCap === false, prevBad.json?.withinCap);
  const capped = await A.post(`/api/companies/${A.cid}/employee-loans`, body(6));
  ok("D2-8: 12,000 over 6 instalments is 422 DEDUCTION_CAP with maxInstalment 1,200", capped.status === 422 && capped.json?.code === "DEDUCTION_CAP" && close(capped.json?.maxInstalment, 1200), { s: capped.status, j: capped.json });
  const future = await A.post(`/api/companies/${A.cid}/employee-loans`, body(10, { disbursementDate: ymd(new Date(Date.now() + 5 * 86400000)) }));
  ok("loans: a future disbursement date is 422", future.status === 422, future.status);
  const badAccount = await A.post(`/api/companies/${A.cid}/employee-loans`, body(10, { paymentAccountId: await A.accountId("1040") }));
  ok("loans: paying from receivables (not cash or bank) is 422 INVALID_PAYMENT_ACCOUNT", badAccount.status === 422 && badAccount.json?.code === "INVALID_PAYMENT_ACCOUNT", { s: badAccount.status, j: badAccount.json });
  const foreignEmp = await A.post(`/api/companies/${A.cid}/employee-loans`, body(10, { employeeId: bEmp.id }));
  ok("tenant: B's employee in A's loan is 422 INVALID_EMPLOYEE", foreignEmp.status === 422 && foreignEmp.json?.code === "INVALID_EMPLOYEE", { s: foreignEmp.status, j: foreignEmp.json });
  const byEmp = await A.post(`/api/companies/${A.cid}/employee-loans`, body(10), emp.token);
  ok("loans: an employee cannot make a loan (403 ROLE_REQUIRED)", byEmp.status === 403 && byEmp.json?.code === "ROLE_REQUIRED", { s: byEmp.status, j: byEmp.json });
  const foreignAccount = await A.post(`/api/companies/${A.cid}/employee-loans`, body(10, { paymentAccountId: await B.accountId("1020") }));
  ok("tenant: B's bank account on A's loan is 422", foreignAccount.status === 422, foreignAccount.status);

  const loan = await A.post(`/api/companies/${A.cid}/employee-loans`, body(10));
  ok("D2-8: 12,000 over 10 instalments is created as LN-0001 with 10 scheduled instalments of 1,200", loan.status === 201 && loan.json?.loanNumber === "LN-0001" && loan.json?.instalments.length === 10 && loan.json.instalments.every((i) => close(i.amount, 1200) && i.status === "scheduled"), { s: loan.status, j: loan.json });
  let ledger = await A.balances();
  ok("D2-8: the disbursement is Dr 1080 Employee Loans 12,000 / Cr bank", close(ledger["1080"], 12000) && close(ledger["1020"], -12000), ledger);
  const jeSource = (await A.jes("employee_loan", loan.json.id)).length;
  ok("D2-8: one employee_loan journal entry", jeSource === 1, jeSource);
  const readOnly = await A.post(`/api/journal/${(await A.jes("employee_loan", loan.json.id))[0].id}/reverse`, { reason: "x" });
  ok("D2-8: the loan journal is read-only through the generic journal routes (409)", readOnly.status === 409, readOnly.status);

  const runId = await runFor(A);
  const calc = await A.post(`/api/payroll-runs/${runId}/calculate`, {});
  const item = (await A.get(`/api/payroll-runs/${runId}/items`)).json[0];
  ok("D2-8: calculate reserves the first instalment: loan deduction 1,200, net 4,800", calc.status === 200 && close(item.loan_deduction, 1200) && close(item.net_salary, 4800), { s: calc.status, item });
  const reserved = (await db.query(`SELECT status, payroll_run_id FROM employee_loan_installments WHERE loan_id = $1 AND sequence = 1`, [loan.json.id])).rows[0];
  ok("D2-8: the instalment is reserved to the run", reserved.status === "reserved" && reserved.payroll_run_id === runId, reserved);
  const cancelReserved = await A.post(`/api/employee-loans/${loan.json.id}/cancel`, {});
  ok("D2-8: a loan with a reserved instalment cannot be cancelled (409 LOAN_HAS_DEDUCTIONS)", cancelReserved.status === 409 && cancelReserved.json?.code === "LOAN_HAS_DEDUCTIONS", { s: cancelReserved.status, j: cancelReserved.json });
  const recalc = await A.post(`/api/payroll-runs/${runId}/calculate`, {});
  const item2 = (await A.get(`/api/payroll-runs/${runId}/items`)).json[0];
  ok("D2-8: recalculating releases and reserves again (still one instalment, not two)", recalc.status === 200 && close(item2.loan_deduction, 1200) && (await db.query(`SELECT COUNT(*) AS c FROM employee_loan_installments WHERE loan_id = $1 AND status = 'reserved'`, [loan.json.id])).rows[0].c === "1", item2);
  const approve = await A.post(`/api/payroll-runs/${runId}/approve`, {});
  ledger = await A.balances();
  ok("D2-8: approving credits 1080 with the instalment (balance 10,800), net payable 4,800", approve.status === 200 && close(ledger["1080"], 10800) && close(ledger["2030"], -4800), { s: approve.status, ledger });
  const deducted = (await db.query(`SELECT status FROM employee_loan_installments WHERE loan_id = $1 AND sequence = 1`, [loan.json.id])).rows[0];
  ok("D2-8: the instalment is deducted", deducted.status === "deducted", deducted);
  const sifMissing = await api("GET", `/api/payroll-runs/${runId}/generate-sif`, { token: A.token });
  ok("D2-8: a WPS file without the establishment and person IDs is 422 SIF_MISSING_IDS and lists them", sifMissing.status === 422 && sifMissing.json?.code === "SIF_MISSING_IDS" && sifMissing.json.missing.length >= 4, { s: sifMissing.status, j: sifMissing.json });
  await A.patch(`/api/companies/${A.cid}`, { mohreEstablishmentId: "0000123456789", wpsEmployerRoutingCode: "123456789" });
  await A.patch(`/api/employees/${e1.id}`, { molPersonId: "12345678901234", routingCode: "987654321", iban: "AE070331234567890123456" });
  const sif = await api("GET", `/api/payroll-runs/${runId}/generate-sif`, { token: A.token });
  ok("D2-8: the WPS file pays the net 4,800 (EDR row, then one SCR row with the total)", sif.status === 200 && /^EDR,12345678901234,987654321,AE070331234567890123456,/.test(sif.text) && sif.text.trim().split("\n").pop().startsWith("SCR,0000123456789,123456789,") && sif.text.includes(",4800.00,"), sif.text.slice(0, 400));
  const reg = (await A.get(`/api/payroll-runs/${runId}/register`)).json;
  ok("D2-10: register: loans = Cr 1080, tie-out ok", close(reg.totals.loanDeduction, 1200) && reg.journalTieOut.ok, reg.journalTieOut);
  const cancelDeducted = await A.post(`/api/employee-loans/${loan.json.id}/cancel`, {});
  ok("D2-8: a loan with a deducted instalment cannot be cancelled", cancelDeducted.status === 409 && cancelDeducted.json?.code === "LOAN_HAS_DEDUCTIONS", { s: cancelDeducted.status, j: cancelDeducted.json });

  // cash repayment of the rest
  const repay = await A.post(`/api/employee-loans/${loan.json.id}/repay`, { paymentAccountId: bank });
  ledger = await A.balances();
  ok("loans: repaying in cash clears 1080 (Dr bank / Cr 1080 for the 10,800 left) and settles the loan", repay.status === 200 && repay.json?.status === "settled" && close(ledger["1080"], 0), { s: repay.status, ledger });
  const repayAgain = await A.post(`/api/employee-loans/${loan.json.id}/repay`, { paymentAccountId: bank });
  ok("loans: a settled loan cannot be repaid again", repayAgain.status === 409, repayAgain.status);

  // cancel a fresh loan: exact reversal
  const second = await A.post(`/api/companies/${A.cid}/employee-loans`, body(12, { principal: 6000, disbursementDate: prevMonthDay(3), kind: "advance" }));
  ok("loans: a second loan is LN-0002", second.json?.loanNumber === "LN-0002" && second.json?.kind === "advance", second.json?.loanNumber);
  const cancelled = await A.post(`/api/employee-loans/${second.json.id}/cancel`, {});
  ledger = await A.balances();
  ok("loans: cancelling before any deduction reverses the disbursement exactly", cancelled.status === 200 && cancelled.json?.status === "cancelled" && close(ledger["1080"], 0) && (await A.jes("employee_loan_cancel", second.json.id)).length === 1, { s: cancelled.status, ledger });
  const crossLoan = await B.get(`/api/employee-loans/${loan.json.id}`);
  ok("tenant: B reading A's loan is 404", crossLoan.status === 404, crossLoan.status);
  const crossCancel = await B.post(`/api/employee-loans/${second.json.id}/cancel`, {});
  ok("tenant: B cancelling A's loan is 404", crossCancel.status === 404, crossCancel.status);
  const crossList = await B.get(`/api/companies/${A.cid}/employee-loans`);
  ok("tenant: B listing A's loans is 403", crossList.status === 403, crossList.status);
}

async function settlementFlow() {
  const A = await newCompany("fsA");
  const B = await newCompany("fsB");
  const emp = await A.member("employee");
  const terminationDate = prevEnd;
  // 3 years and 6 months of service at the termination date
  const join = ymd(new Date(Date.UTC(Number(prevEnd.slice(0, 4)), Number(prevEnd.slice(5, 7)) - 1 - 42, 1)));
  const e1 = await newEmployee(A, "Leaving Person", { joinDate: join });
  const bank = await A.accountId("1020"), exp = await A.accountId("5000"), provision = await A.accountId("2036");

  // the 2036 provision holds 10,500 (as if accrued by earlier payroll runs)
  const seed = await A.post(`/api/companies/${A.cid}/journal`, { date: prevMonthDay(1), memo: "Provision to date", status: "posted", lines: [{ accountId: exp, debit: 10500, credit: 0 }, { accountId: provision, debit: 0, credit: 10500 }] });
  ok("setup: 2036 provision holds 10,500", seed.status === 200, seed.status);

  const calc = (await A.post(`/api/companies/${A.cid}/payroll/gratuity-calculator`, { employeeId: e1.id, terminationDate })).json;
  const prev = await A.post(`/api/companies/${A.cid}/final-settlements/preview`, { employeeId: e1.id, terminationDate, provisionUsed: 10500, leaveDays: 4 });
  ok("D2-9: the preview's gratuity equals the gratuity calculator's", prev.status === 200 && close(prev.json.gratuityAmount, calc.totalGratuity) && calc.totalGratuity > 14000, { prev: prev.json, calc: calc.totalGratuity });
  ok("D2-9: leave encashment 4 days x 6,000/30 = 800; true-up = gratuity - 10,500; net = gratuity + 800", close(prev.json.leaveEncashment, 800) && close(prev.json.gratuityTrueUp, calc.totalGratuity - 10500) && close(prev.json.netPayable, calc.totalGratuity + 800), prev.json);
  const tooMuch = await A.post(`/api/companies/${A.cid}/final-settlements/preview`, { employeeId: e1.id, terminationDate, provisionUsed: 99999 });
  ok("D2-9: a provision above the 2036 balance is 422 PROVISION_EXCEEDS_BALANCE", tooMuch.status === 422 && tooMuch.json?.code === "PROVISION_EXCEEDS_BALANCE", { s: tooMuch.status, j: tooMuch.json });
  const negative = await A.post(`/api/companies/${A.cid}/final-settlements/preview`, { employeeId: e1.id, terminationDate, provisionUsed: 10500, otherDeductions: 500000 });
  ok("D2-9: deductions beyond what is owed are 422 SETTLEMENT_NEGATIVE", negative.status === 422 && negative.json?.code === "SETTLEMENT_NEGATIVE", { s: negative.status, j: negative.json });
  const byEmp = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e1.id, terminationDate, provisionUsed: 10500, leaveDays: 4 }, emp.token);
  ok("D2-9: an employee cannot create a settlement (403 ROLE_REQUIRED)", byEmp.status === 403 && byEmp.json?.code === "ROLE_REQUIRED", { s: byEmp.status, j: byEmp.json });
  const foreign = await B.post(`/api/companies/${B.cid}/final-settlements`, { employeeId: e1.id, terminationDate });
  ok("tenant: A's employee in B's settlement is 422 INVALID_EMPLOYEE", foreign.status === 422 && foreign.json?.code === "INVALID_EMPLOYEE", { s: foreign.status, j: foreign.json });

  const draft = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e1.id, terminationDate, provisionUsed: 10500, leaveDays: 4, reason: "resignation" });
  ok("D2-9: the draft is created", draft.status === 201 && draft.json?.status === "draft", { s: draft.status, j: draft.json });
  const dup = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e1.id, terminationDate });
  ok("D2-9: a second settlement for the employee is 409 SETTLEMENT_EXISTS", dup.status === 409 && dup.json?.code === "SETTLEMENT_EXISTS", { s: dup.status, j: dup.json });
  const crossPost = await B.post(`/api/final-settlements/${draft.json.id}/post`, {});
  ok("tenant: B posting A's settlement is 404", crossPost.status === 404, crossPost.status);

  const burst = await Promise.all(Array.from({ length: 6 }, () => A.post(`/api/final-settlements/${draft.json.id}/post`, {})));
  ok("concurrency: six parallel posts: exactly one 200", burst.filter((r) => r.status === 200).length === 1, burst.map((r) => r.status));
  ok("concurrency: ...and one settlement journal entry", (await A.jes("final_settlement", draft.json.id)).length === 1, (await A.jes("final_settlement", draft.json.id)).length);
  const lines = (await db.query(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.source = 'final_settlement' AND je.source_id = $2`, [A.cid, draft.json.id])).rows;
  const side = (code, s) => lines.filter((l) => l.code === code).reduce((a, l) => a + n(l[s]), 0);
  ok("D2-9: Dr 2036 10,500 (the provision used)", close(side("2036", "debit"), 10500), lines);
  ok("D2-9: Dr 5028 true-up, Dr 5020 leave 800, Cr 2030 net, and the entry balances", close(side("5028", "debit"), calc.totalGratuity - 10500) && close(side("5020", "debit"), 800) && close(side("2030", "credit"), calc.totalGratuity + 800) && close(lines.reduce((a, l) => a + n(l.debit) - n(l.credit), 0), 0), lines);
  const posted = (await A.get(`/api/final-settlements/${draft.json.id}`)).json;
  ok("D2-9: posting terminates the employee on the termination date", posted.status === "posted" && (await db.query(`SELECT status, to_char(termination_date, 'YYYY-MM-DD') AS d FROM employees WHERE id = $1`, [e1.id])).rows[0].status === "terminated", posted);
  const protectedEntry = await A.post(`/api/journal/${(await A.jes("final_settlement", draft.json.id))[0].id}/reverse`, { reason: "x" });
  ok("D2-9: the settlement journal is read-only through the generic journal routes", protectedEntry.status === 409, protectedEntry.status);

  const pay = await A.post(`/api/final-settlements/${draft.json.id}/pay`, { paymentAccountId: bank });
  const ledger = await A.balances();
  ok("D2-9: paying settles 2030 (Dr 2030 / Cr bank)", pay.status === 200 && pay.json?.status === "paid" && close(ledger["2030"], 0), { s: pay.status, ledger });
  const voidPaid = await A.post(`/api/final-settlements/${draft.json.id}/void`, {});
  ok("D2-9: a paid settlement cannot be voided (409 SETTLEMENT_PAID)", voidPaid.status === 409 && voidPaid.json?.code === "SETTLEMENT_PAID", { s: voidPaid.status, j: voidPaid.json });

  // an unpaid settlement can be voided: exact reversal, employee active again, loan reopened
  const e2 = await newEmployee(A, "Second Leaver", { joinDate: join });
  const { month, year } = prevMonthYear();
  const loan = await A.post(`/api/companies/${A.cid}/employee-loans`, { employeeId: e2.id, principal: 3000, instalmentCount: 5, firstPeriodYear: year, firstPeriodMonth: month, disbursementDate: prevMonthDay(2), paymentAccountId: bank });
  ok("setup: a loan of 3,000 to the second leaver", loan.status === 201, { s: loan.status, j: loan.json });
  const draft2 = await A.post(`/api/companies/${A.cid}/final-settlements`, { employeeId: e2.id, terminationDate, provisionUsed: 0, leaveDays: 0 });
  ok("D2-9: the loan still owed (3,000) is recovered from the settlement", close(draft2.json?.loanRecovered, 3000) && close(draft2.json?.netPayable, draft2.json?.gratuityAmount - 3000), draft2.json);
  const post2 = await A.post(`/api/final-settlements/${draft2.json.id}/post`, {});
  ok("D2-9: posting settles the loan (Cr 1080 3,000)", post2.status === 200 && (await db.query(`SELECT status FROM employee_loans WHERE id = $1`, [loan.json.id])).rows[0].status === "settled" && close((await A.balances())["1080"], 0), { s: post2.status });
  const void2 = await A.post(`/api/final-settlements/${draft2.json.id}/void`, {});
  ok("D2-9: voiding an unpaid settlement reverses it exactly, reopens the loan and the employee", void2.status === 200 && void2.json?.status === "void"
    && (await db.query(`SELECT status FROM employees WHERE id = $1`, [e2.id])).rows[0].status === "active"
    && (await db.query(`SELECT status FROM employee_loans WHERE id = $1`, [loan.json.id])).rows[0].status === "active"
    && close((await A.balances())["1080"], 3000) && (await A.jes("final_settlement_void", draft2.json.id)).length === 1, void2.json);

  // GCC national: no gratuity
  const e3 = await newEmployee(A, "Emirati Person", { nationality: "UAE", joinDate: join });
  const gcc = await A.post(`/api/companies/${A.cid}/final-settlements/preview`, { employeeId: e3.id, terminationDate, leaveDays: 2 });
  ok("D2-9: a GCC national has no gratuity: only the leave pay (2 x 200 = 400)", gcc.status === 200 && close(gcc.json.gratuityAmount, 0) && close(gcc.json.netPayable, 400), gcc.json);
  ok("D2-9: ...but the years of service still show (3.5)", gcc.json.yearsOfService > 3.4 && gcc.json.yearsOfService < 3.6, gcc.json.yearsOfService);
}

async function lockedPeriods() {
  const L = await newCompany("lkA");
  const acct = await L.member("accountant");
  const owner = L.token;
  await L.post(`/api/companies/${L.cid}/approval-rules`, { documentType: "bill", name: "Bills", thresholdAed: 0, approverRoles: ["accountant"] });
  const bill = await L.bill(prevMid, 500, { vendor_name: "Locked Vendor" }, false);
  const emp = await newEmployee(L, "Locked Person");
  const bank = await L.accountId("1020");
  const lock = await L.post(`/api/companies/${L.cid}/month-end/lock-period`, { periodEnd: prevEnd });
  ok("setup: the previous month is locked", lock.status === 200 || lock.status === 201, { s: lock.status, j: lock.json });
  const approve = await L.post(`/api/bills/${bill}/approve`, {}, acct.token);
  ok("locked month: approving a bill is 403 and nothing is recorded", approve.status === 403 && (await L.jes("bill", bill)).length === 0 && n((await db.query(`SELECT COUNT(*) AS c FROM approval_requests WHERE document_id = $1`, [bill])).rows[0].c) === 0, { s: approve.status, j: approve.json });
  const { month, year } = prevMonthYear();
  const loan = await L.post(`/api/companies/${L.cid}/employee-loans`, { employeeId: emp.id, principal: 1200, instalmentCount: 3, firstPeriodYear: year, firstPeriodMonth: month, disbursementDate: prevMonthDay(5), paymentAccountId: bank });
  ok("locked month: disbursing a loan is 403 and no loan remains", loan.status === 403 && n((await db.query(`SELECT COUNT(*) AS c FROM employee_loans WHERE company_id = $1`, [L.cid])).rows[0].c) === 0, { s: loan.status, j: loan.json });
  const draft = await L.post(`/api/companies/${L.cid}/final-settlements`, { employeeId: emp.id, terminationDate: prevEnd, leaveDays: 0 });
  const post = await L.post(`/api/final-settlements/${draft.json.id}/post`, {});
  ok("locked month: posting a settlement is 403 and the employee stays active", post.status === 403 && (await db.query(`SELECT status FROM employees WHERE id = $1`, [emp.id])).rows[0].status === "active" && (await L.jes("final_settlement", draft.json.id)).length === 0, { s: post.status, j: post.json });
  const run = await runFor(L);
  await L.post(`/api/payroll-runs/${run}/calculate`, {});
  const payroll = await L.post(`/api/payroll-runs/${run}/approve`, {}, owner);
  ok("locked month: approving payroll is 403 and nothing is posted", payroll.status === 403 && (await L.jes("system", run)).length === 0, { s: payroll.status, j: payroll.json });
}


// ---------------------------------------------------------------------------
// S4 (frontend): the response shapes and error bodies the screens read.
// A client type that drifts from the API breaks a screen silently, so each shape is pinned here.
// ---------------------------------------------------------------------------

const hasKeys = (obj, keys) => !!obj && keys.every((k) => k in obj);

async function uiContracts() {
  const A = await newCompany("uiA");
  const acct = await A.member("accountant");
  const emp = await A.member("employee");

  // contacts: type filter, `both` in each list, vendor picker data
  const cust = (await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "UI Customer", email: "uic@example.com" })).json;
  const vend = (await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "UI Vendor", contactType: "vendor", trnNumber: "100123456700009" })).json;
  const both = (await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "UI Both", contactType: "both", email: "uib@example.com" })).json;
  const vendors = (await A.get(`/api/companies/${A.cid}/customer-contacts?type=vendor`)).json.map((c) => c.id);
  const customers = (await A.get(`/api/companies/${A.cid}/customer-contacts?type=customer`)).json.map((c) => c.id);
  ok("ui: the vendor picker list holds vendor and both contacts, never customer-only", vendors.includes(vend.id) && vendors.includes(both.id) && !vendors.includes(cust.id), vendors);
  ok("ui: the customer list holds customer and both contacts, never vendor-only", customers.includes(cust.id) && customers.includes(both.id) && !customers.includes(vend.id), customers);
  ok("ui: contacts carry contactType, trnNumber and email for the picker and the type badge", hasKeys(vend, ["id", "name", "contactType", "trnNumber"]) && vend.contactType === "vendor", vend);
  const stranded = await A.put(`/api/companies/${A.cid}/customer-contacts/${vend.id}`, { contactType: "customer" });
  ok("ui: a contact with no documents can change type", stranded.status === 200 && stranded.json?.contactType === "customer", { s: stranded.status, j: stranded.json });
  await A.put(`/api/companies/${A.cid}/customer-contacts/${vend.id}`, { contactType: "vendor" });

  // bill with a vendor id and a project line, vendor statement and ageing shapes
  const project = (await A.post(`/api/companies/${A.cid}/projects`, { name: "UI project", contactId: cust.id, hourlyRate: 200, budgetAmount: 4000, budgetHours: 10 })).json;
  const exp = await A.accountId("5000");
  const made = await A.post(`/api/companies/${A.cid}/bills`, {
    vendor_id: vend.id, vendor_name: "UI Vendor", bill_date: prevMid, due_date: prevMid, currency: "AED",
    line_items: [{ description: "Tagged cost", quantity: 1, unit_price: 500, vat_rate: 5, account_id: exp, project_id: project.id, is_billable: true }],
  });
  ok("ui: a bill takes vendor_id and a project line with is_billable", made.status === 200 || made.status === 201, { s: made.status, j: made.json });
  const billId = made.json?.id;
  const detail = (await A.get(`/api/bills/${billId}`)).json;
  ok("ui: the bill detail returns vendor_id and each line's project_id and is_billable (the edit form refills from them)", detail.vendor_id === vend.id && detail.line_items[0].project_id === project.id && detail.line_items[0].is_billable === true, { v: detail.vendor_id, l: detail.line_items?.[0] });
  await A.post(`/api/bills/${billId}/approve`, {});
  const stmt = (await A.get(`/api/companies/${A.cid}/contacts/${vend.id}/vendor-statement?from=${prevMid.slice(0, 8)}01&to=${today}`)).json;
  ok("ui: the vendor statement has opening, lines (type, reference, debit, credit, balance), closing, aging and the contact", hasKeys(stmt, ["openingBalance", "lines", "closingBalance", "aging", "contact"]) && hasKeys(stmt.lines[0], ["date", "type", "reference", "debit", "credit", "balance"]) && stmt.lines[0].type === "bill" && close(stmt.closingBalance, 525), stmt);
  const ageing = (await A.get(`/api/companies/${A.cid}/payables/ageing-detail?vendorId=${vend.id}&asOf=${today}`)).json;
  ok("ui: the ageing detail has asOf, vendors[].rows[] with outstandingAed and the bucket totals", hasKeys(ageing, ["asOf", "vendors", "totals"]) && hasKeys(ageing.vendors[0].rows[0], ["number", "billDate", "dueDate", "outstandingAed", "daysPastDue", "bucket"]) && hasKeys(ageing.totals, ["current", "days1to30", "days31to60", "days61to90", "over90", "total"]) && close(ageing.totals.total, 525), ageing);

  // timer: {running} shape, then the stopped entry the toast reads
  const idle = (await A.get(`/api/companies/${A.cid}/timer`)).json;
  ok("ui: GET timer answers {running: null} when idle", "running" in idle && idle.running === null, idle);
  const started = await A.post(`/api/companies/${A.cid}/timer/start`, { projectId: project.id });
  ok("ui: starting a timer returns the entry with project code and name, startedAt, running", started.status === 201 && hasKeys(started.json, ["id", "projectId", "projectCode", "projectName", "startedAt", "running"]) && started.json.running === true, started.json);
  const running = (await A.get(`/api/companies/${A.cid}/timer`)).json.running;
  ok("ui: GET timer then returns that entry as running", running?.id === started.json?.id && running?.projectCode === "P-0001", running);
  const stopped = await A.post(`/api/companies/${A.cid}/timer/stop`, {});
  ok("ui: stopping returns the entry with whole minutes and hours", stopped.status === 200 && Number.isInteger(stopped.json?.minutes) && "hours" in stopped.json && stopped.json.running === false, stopped.json);

  // time entries and the unbilled view
  await A.post(`/api/companies/${A.cid}/time-entries`, { projectId: project.id, entryDate: today, hours: 2, isBillable: true, notes: "Work" });
  const entries = (await A.get(`/api/companies/${A.cid}/time-entries?projectId=${project.id}`)).json;
  ok("ui: time entries carry userName, taskName, hours, billed, running and the billed invoice number", hasKeys(entries[0], ["userName", "taskName", "hours", "isBillable", "billed", "running", "billedInvoiceNumber", "entryDate"]), entries[0]);
  const unbilled = (await A.get(`/api/projects/${project.id}/unbilled`)).json;
  ok("ui: unbilled lists time (with rate and amount) and costs (with source type) and the three totals", hasKeys(unbilled, ["timeEntries", "expenses", "unbilledHours", "unbilledAmount", "unbilledExpenses"]) && hasKeys(unbilled.timeEntries[0], ["id", "hours", "rate", "amount"]) && unbilled.expenses[0]?.sourceType === "bill_line" && close(unbilled.unbilledExpenses, 500), unbilled);
  const invoice = await A.post(`/api/projects/${project.id}/invoice`, { timeEntryIds: unbilled.timeEntries.map((e) => e.id), expenseIds: unbilled.expenses.map((e) => e.id), vatRate: 5 });
  ok("ui: invoice-from-unbilled returns the draft with id, number and lineCount", invoice.status === 201 && hasKeys(invoice.json, ["id", "number", "lineCount"]) && invoice.json.lineCount === unbilled.timeEntries.length + unbilled.expenses.length && invoice.json.lineCount >= 2, { s: invoice.status, j: invoice.json });
  const again = await A.post(`/api/projects/${project.id}/invoice`, {});
  ok("ui: billing nothing is 409 NOTHING_TO_BILL (the dialog maps the code to its own message)", again.status === 409 && again.json?.code === "NOTHING_TO_BILL", { s: again.status, j: again.json });
  const profit = (await A.get(`/api/projects/${project.id}/profitability`)).json;
  ok("ui: profitability has revenue, costs, margin, marginPct, hours{} and budget{amount, hours, usedPct, hoursUsedPct}", hasKeys(profit, ["revenue", "costs", "margin", "marginPct", "hours", "budget"]) && hasKeys(profit.hours, ["total", "billable", "billed", "unbilled"]) && hasKeys(profit.budget, ["amount", "hours", "usedPct", "hoursUsedPct"]) && close(profit.costs, 500) && close(profit.budget.usedPct, 12.5), profit);

  // approvals: the queue row, the pending body, the 403 body, the history rows, the reject body
  await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "UI rule", thresholdAed: 1000, approverRoles: ["accountant", "owner"] });
  // entered by the employee: the owner who signs the last step must not be the creator
  const big = await A.bill(prevMid, 3000, { vendor_name: "UI Vendor", vendor_id: vend.id }, false, emp.token);
  const refused = await A.post(`/api/bills/${big}/approve`, {}, emp.token);
  ok("ui: the refusal toast reads code and details {step, requiredSteps, requiredRole}", refused.status === 403 && refused.json?.code === "APPROVAL_REQUIRED" && refused.json?.details?.requiredRole === "accountant" && refused.json?.details?.step === 1 && refused.json?.details?.requiredSteps === 2, refused.json);
  const step1 = await A.post(`/api/bills/${big}/approve`, {}, acct.token);
  ok("ui: a recorded step answers {status: pending_approval, approval{completedSteps, requiredSteps, nextRole}}", step1.json?.status === "pending_approval" && hasKeys(step1.json?.approval, ["requestId", "completedSteps", "requiredSteps", "nextRole"]), step1.json);
  const queue = (await A.get(`/api/companies/${A.cid}/approvals?status=pending`)).json;
  const row = queue.find((r) => r.documentId === big);
  ok("ui: the queue row has every column and the action flag the table needs", hasKeys(row, ["requestId", "documentType", "documentId", "reference", "counterparty", "amountAed", "completedSteps", "requiredSteps", "nextRole", "status", "canAct"]) && row.documentType === "bill" && row.completedSteps === 1 && row.nextRole === "owner" && row.canAct === true, row);
  const accountantView = (await A.get(`/api/companies/${A.cid}/approvals?status=pending`, acct.token)).json.find((r) => r.documentId === big);
  ok("ui: canAct is false for the person who already signed (the Approve button is hidden)", accountantView?.canAct === false, accountantView);
  const history = (await A.get(`/api/approvals/bill/${big}`)).json;
  ok("ui: history rows carry the rule name, required roles, steps with decidedByName and decision", hasKeys(history.requests[0], ["status", "ruleName", "requiredRoles", "requiredSteps", "completedSteps", "amountAed", "createdAt", "steps"]) && hasKeys(history.requests[0].steps[0], ["stepNumber", "requiredRole", "decidedByName", "decision", "comment", "decidedAt"]), history);
  const rules = (await A.get(`/api/companies/${A.cid}/approval-rules`)).json;
  ok("ui: rules list with thresholdAed, approverRoles and isActive for the rules table", hasKeys(rules[0], ["id", "documentType", "name", "thresholdAed", "approverRoles", "isActive"]), rules[0]);
  const ownerOnly = await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "x", thresholdAed: 1, approverRoles: ["owner"] }, acct.token);
  ok("ui: only the owner creates rules (403 ROLE_REQUIRED), which is why the Rules tab hides its buttons for others", ownerOnly.status === 403 && ownerOnly.json?.code === "ROLE_REQUIRED", { s: ownerOnly.status, j: ownerOnly.json });
  const rejected = await A.post(`/api/approvals/bill/${big}/reject`, { comment: "Wrong vendor" });
  ok("ui: reject answers {requestId, status: rejected} and returns the bill to draft", rejected.status === 200 && rejected.json?.status === "rejected" && (await db.query(`SELECT status FROM vendor_bills WHERE id = $1`, [big])).rows[0].status === "draft", { s: rejected.status, j: rejected.json });

  // people: the shapes the Leave, Loans, Settlement and Register tabs read
  const e1 = await newEmployee(A, "UI Person");
  const types = (await A.get(`/api/companies/${A.cid}/leave-types`)).json;
  ok("ui: leave types carry bilingual names, pay policy and active flag", hasKeys(types[0], ["id", "code", "nameEn", "nameAr", "payPolicy", "annualDays", "accrual", "carryForwardMaxDays", "allowNegative", "isActive"]), types[0]);
  const annual = types.find((t) => t.code === "annual");
  const bal = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${today}&employeeId=${e1.id}`)).json.find((b) => b.code === "annual");
  ok("ui: balances carry the employee name, year and the opening/accrued/taken/pending/balance/available columns", hasKeys(bal, ["employeeName", "leaveTypeId", "code", "year", "opening", "accrued", "adjustment", "taken", "pending", "balance", "available"]), bal);
  const lr = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: annual.id, startDate: prevMonthDay(14), endDate: prevMonthDay(16) });
  const lrList = (await A.get(`/api/companies/${A.cid}/leave-requests?status=pending&limit=200`)).json;
  ok("ui: leave requests list with employee name, bilingual type name, dates, days and status", lr.status === 201 && hasKeys(lrList[0], ["employeeName", "typeNameEn", "typeNameAr", "startDate", "endDate", "days", "status"]) && lrList[0].days === 3, lrList[0]);
  const lrBy = await A.post(`/api/leave-requests/${lr.json?.id}/approve`, {}, emp.token);
  ok("ui: an employee approving leave is 403 ROLE_REQUIRED (the buttons are hidden for them)", lrBy.status === 403 && lrBy.json?.code === "ROLE_REQUIRED", { s: lrBy.status, j: lrBy.json });

  const bank = await A.accountId("1020");
  const { month, year } = prevMonthYear();
  const prev = (await A.post(`/api/companies/${A.cid}/employee-loans/preview`, { employeeId: e1.id, principal: 6000, instalmentCount: 6, firstPeriodYear: year, firstPeriodMonth: month })).json;
  ok("ui: the loan preview has monthlyWage, maxInstalment, instalmentAmount, withinCap and the schedule", hasKeys(prev, ["monthlyWage", "maxInstalment", "instalmentAmount", "withinCap", "schedule"]) && hasKeys(prev.schedule[0], ["sequence", "periodYear", "periodMonth", "amount"]), prev);
  const capErr = await A.post(`/api/companies/${A.cid}/employee-loans`, { employeeId: e1.id, principal: 12000, instalmentCount: 6, firstPeriodYear: year, firstPeriodMonth: month, disbursementDate: prevMonthDay(2), paymentAccountId: bank });
  ok("ui: DEDUCTION_CAP carries maxInstalment (the client shows the preview's own maximum, which is the same number)", capErr.status === 422 && capErr.json?.code === "DEDUCTION_CAP" && capErr.json?.maxInstalment > 0 && Math.abs(capErr.json.maxInstalment - prev.maxInstalment) < 0.005, { cap: capErr.json, prev: prev.maxInstalment });
  const loan = (await A.post(`/api/companies/${A.cid}/employee-loans`, { employeeId: e1.id, principal: 6000, instalmentCount: 6, firstPeriodYear: year, firstPeriodMonth: month, disbursementDate: prevMonthDay(2), paymentAccountId: bank, kind: "advance" })).json;
  const loanList = (await A.get(`/api/companies/${A.cid}/employee-loans?status=all&limit=200`)).json;
  const loanOne = (await A.get(`/api/employee-loans/${loan.id}`)).json;
  ok("ui: loans list with number, employee name, kind, principal, instalment and outstanding; detail adds instalments", hasKeys(loanList[0], ["loanNumber", "employeeName", "kind", "principal", "instalmentAmount", "instalmentCount", "status", "outstanding"]) && close(loanList[0].outstanding, 6000) && loanOne.instalments.length === 6 && hasKeys(loanOne.instalments[0], ["sequence", "periodYear", "periodMonth", "amount", "deductedAmount", "status"]), { l: loanList[0], d: loanOne.instalments?.[0] });

  const sPrev = (await A.post(`/api/companies/${A.cid}/final-settlements/preview`, { employeeId: e1.id, terminationDate: prevEnd })).json;
  ok("ui: the settlement preview has the breakdown the dialog prints (years, gratuity, provision, true-up, leave, loan, net, warnings)", hasKeys(sPrev, ["employeeName", "isGccNational", "basicSalary", "yearsOfService", "gratuityAmount", "provisionAccrued", "provisionBalance", "provisionUsed", "gratuityTrueUp", "leaveDays", "leaveEncashment", "loanRecovered", "otherDeductions", "netPayable", "warnings"]) && Array.isArray(sPrev.warnings) && close(sPrev.loanRecovered, 6000), sPrev);

  // payroll run: items and totals carry the leave and loan columns; the register has rows, totals and the tie-out
  const run = await runFor(A);
  await A.post(`/api/payroll-runs/${run}/calculate`, {});
  const items = (await A.get(`/api/payroll-runs/${run}/items`)).json;
  ok("ui: payroll items carry leave_deduction and loan_deduction next to deductions", hasKeys(items[0], ["deductions", "leave_deduction", "loan_deduction", "net_salary"]) && close(items[0].loan_deduction, 1000), items[0]);
  const runRow = (await A.get(`/api/companies/${A.cid}/payroll-runs`)).json.find((r) => r.id === run);
  ok("ui: the run carries total_leave_deductions and total_loan_deductions for the summary cards", hasKeys(runRow, ["total_leave_deductions", "total_loan_deductions"]) && close(runRow.total_loan_deductions, 1000), runRow);
  const approveRun = await A.post(`/api/payroll-runs/${run}/approve`, {});
  ok("ui: setup: the run approves (no payroll rule)", approveRun.status === 200, { s: approveRun.status, j: approveRun.json });
  const register = (await A.get(`/api/payroll-runs/${run}/register`)).json;
  ok("ui: the register has rows, totals and journalTieOut.checks[] with label, account, register, ledger, ok", hasKeys(register, ["periodMonth", "periodYear", "rows", "totals", "journalTieOut"]) && hasKeys(register.rows[0], ["employeeName", "basic", "gross", "leaveDeduction", "loanDeduction", "deductions", "net"]) && register.journalTieOut.available === true && register.journalTieOut.ok === true && hasKeys(register.journalTieOut.checks[0], ["label", "account", "register", "ledger", "ok"]), register.journalTieOut);
  const csv = await api("GET", `/api/payroll-runs/${run}/register?format=csv`, { token: A.token });
  ok("ui: the register CSV is text/csv with a header row", csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") || "") && /Employee/.test(csv.text.split("\n")[0]), { s: csv.status, h: csv.headers.get("content-type") });

  // reverse charge on a bill: the vendor's country feeds the default, the bill keeps the flag, the posting is the self-assessed pair
  const us = (await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "US Software Inc", contactType: "vendor", country: "United States" })).json;
  const usList = (await A.get(`/api/companies/${A.cid}/customer-contacts?type=vendor`)).json.find((c) => c.id === us.id);
  ok("ui: the vendor list carries each contact's country (a non-UAE vendor turns the reverse-charge switch on)", usList?.country === "United States" && vend.country === "UAE", { us: usList?.country, uae: vend.country });
  for (const r of (await A.get(`/api/companies/${A.cid}/approval-rules`)).json) await A.del(`/api/approval-rules/${r.id}`); // single-step approvals again
  const before = await A.balances();
  const rcMade = await A.post(`/api/companies/${A.cid}/bills`, {
    vendor_id: us.id, vendor_name: "US Software Inc", bill_date: prevMid, due_date: prevMid, currency: "AED", reverse_charge: true,
    line_items: [{ description: "Software subscription", quantity: 1, unit_price: 3600, vat_rate: 5, account_id: exp }],
  });
  const rcDetail = (await A.get(`/api/bills/${rcMade.json?.id}`)).json;
  ok("ui: a reverse-charge bill is payable without VAT (total 3,600) and its detail returns reverse_charge true for the edit form", rcDetail.reverse_charge === true && close(rcDetail.total_amount, 3600) && close(rcDetail.vat_amount, 180), { rc: rcDetail.reverse_charge, t: rcDetail.total_amount, v: rcDetail.vat_amount });
  await A.post(`/api/bills/${rcMade.json?.id}/approve`, {});
  const after = await A.balances();
  ok("ui: approving it declares the VAT both ways: Dr 1050 input 180 and Cr 2020 output 180, payable 3,600 (what the on-screen box 3 / box 10 preview shows)", close((after["1050"] ?? 0) - (before["1050"] ?? 0), 180) && close((after["2020"] ?? 0) - (before["2020"] ?? 0), -180) && close((after["2010"] ?? 0) - (before["2010"] ?? 0), -3600), { d1050: (after["1050"] ?? 0) - (before["1050"] ?? 0), d2020: (after["2020"] ?? 0) - (before["2020"] ?? 0), d2010: (after["2010"] ?? 0) - (before["2010"] ?? 0) });
  const billPage = readFileSync(join(ROOT, "client/src/pages/BillPay.tsx"), "utf8");
  ok("ui: the bill dialog has the reverse-charge switch with the box 3 and box 10 preview", /switch-reverse-charge/.test(billPage) && /reverse-charge-preview/.test(billPage));

  // client sources: the new screens are routed and in the menu, and every screen string has Arabic
  const app = readFileSync(join(ROOT, "client/src/App.tsx"), "utf8");
  const nav = readFileSync(join(ROOT, "client/src/components/layout/nav-config.ts"), "utf8");
  ok("ui: /projects, /projects/:id and /approvals are routed, and the menu links Projects and Approvals", /path="\/projects"/.test(app) && /path="\/projects\/:id"/.test(app) && /path="\/approvals"/.test(app) && /url: "\/projects"/.test(nav) && /url: "\/approvals"/.test(nav));
}

// ---------------------------------------------------------------------------
// G. L2 live-review fix round
// ---------------------------------------------------------------------------

async function fixRound() {
  const A = await newCompany("fxA");
  const B = await newCompany("fxB");
  const acct = await A.member("accountant");
  const bank = await A.accountId("1020"), exp = await A.accountId("5000");
  const { month, year } = prevMonthYear();

  // C1: a draft cannot be posted by editing it
  const draft = await A.post(`/api/companies/${A.cid}/journal`, { date: prevMid, memo: "Draft", status: "draft", lines: [{ accountId: exp, debit: 50, credit: 0 }, { accountId: bank, debit: 0, credit: 50 }] });
  const viaPut = await A.put(`/api/journal/${draft.json.id}`, { date: prevMid, status: "posted", lines: [{ accountId: exp, debit: 50, credit: 0 }, { accountId: bank, debit: 0, credit: 50 }] });
  ok("C1: PUT with status posted is 409 USE_POST_ROUTE and the entry stays a draft", viaPut.status === 409 && viaPut.json?.code === "USE_POST_ROUTE" && (await db.query(`SELECT status FROM journal_entries WHERE id = $1`, [draft.json.id])).rows[0].status === "draft", { s: viaPut.status, j: viaPut.json });
  const stillEdit = await A.put(`/api/journal/${draft.json.id}`, { date: prevMid, lines: [{ accountId: exp, debit: 60, credit: 0 }, { accountId: bank, debit: 0, credit: 60 }] });
  ok("C1: an ordinary draft edit still works", stillEdit.status === 200, stillEdit.status);

  // C2: an approved PO changed afterwards goes back to draft
  const po = await A.post(`/api/companies/${A.cid}/purchase-orders`, { number: "PO-C2-" + rnd, vendorName: "C2 Vendor", date: prevMid, lines: [{ description: "Desks", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
  await A.post(`/api/purchase-orders/${po.json.id}/send`, {});
  await A.post(`/api/purchase-orders/${po.json.id}/approve`, {});
  const changed = await A.put(`/api/purchase-orders/${po.json.id}`, { lines: [{ description: "Desks", quantity: 5, unitPrice: 1000, vatRate: 0.05 }] });
  ok("C2: changing the lines of an approved PO returns it to draft and logs it", changed.status === 200 && changed.json?.status === "draft" && n((await db.query(`SELECT COUNT(*) AS c FROM activity_logs WHERE entity_type = 'purchase_order' AND entity_id = $1`, [po.json.id])).rows[0].c) >= 1, { s: changed.status, st: changed.json?.status });
  const rcv = await A.post(`/api/purchase-orders/${po.json.id}/receive`, {});
  ok("C2: it cannot be received until approved again", rcv.status === 400, rcv.status);
  const notes = await A.post(`/api/purchase-orders/${po.json.id}/send`, {});
  await A.post(`/api/purchase-orders/${po.json.id}/approve`, {});
  const noteOnly = await A.put(`/api/purchase-orders/${po.json.id}`, { notes: "just a note" });
  ok("C2: a change that keeps the lines and amounts leaves the approval alone", notes.status === 200 && noteOnly.json?.status === "approved", noteOnly.json?.status);

  // M3: overdue only for approved or partial bills
  const dueBefore = prevMonthDay(1);
  const pend = await A.bill(prevMonthDay(1), 100, { vendor_name: "Overdue Vendor", due_date: dueBefore }, false);
  const appr = await A.bill(prevMonthDay(1), 100, { vendor_name: "Overdue Vendor", due_date: dueBefore });
  const listed = (await A.get(`/api/companies/${A.cid}/bills`)).json;
  ok("M3: a pending bill past its due date is not rewritten to overdue; an approved one is", listed.find((b) => b.id === pend).status === "pending" && listed.find((b) => b.id === appr).status === "overdue", listed.map((b) => b.status));

  // L1: DEDUCTION_CAP carries details.maxInstalment; M1: the cap covers all loans
  const emp = (await A.post(`/api/companies/${A.cid}/employees`, { fullName: "Cap Person", nationality: "India", basicSalary: 6000, joinDate: joinTwoYearsAgo })).json;
  const loanBody = (principal, count, extra = {}) => ({ employeeId: emp.id, principal, instalmentCount: count, firstPeriodYear: year, firstPeriodMonth: month, disbursementDate: prevMonthDay(2), paymentAccountId: bank, ...extra });
  const over = await A.post(`/api/companies/${A.cid}/employee-loans`, loanBody(12000, 6));
  ok("L1: DEDUCTION_CAP has details.maxInstalment (1,200)", over.status === 422 && over.json?.code === "DEDUCTION_CAP" && close(over.json?.details?.maxInstalment, 1200), over.json);
  const first = await A.post(`/api/companies/${A.cid}/employee-loans`, loanBody(12000, 10));
  ok("M1: the first loan takes the whole 20 % (1,200 a month)", first.status === 201, { s: first.status, j: first.json });
  const second = await A.post(`/api/companies/${A.cid}/employee-loans`, loanBody(1200, 12));
  ok("M1: a second loan over the same months is refused (the cap is shared): 422 DEDUCTION_CAP, 0 left", second.status === 422 && second.json?.code === "DEDUCTION_CAP" && close(second.json?.details?.maxInstalment, 0), { s: second.status, j: second.json });
  const later = await A.post(`/api/companies/${A.cid}/employee-loans`, loanBody(1200, 12, { firstPeriodYear: year + 1, firstPeriodMonth: month }));
  ok("M1: the same loan starting after the first one ends is fine", later.status === 201, { s: later.status, j: later.json });

  // L2: the type's annual days drive the accrual from service month 13
  const annualType = (await A.get(`/api/companies/${A.cid}/leave-types`)).json.find((t) => t.code === "annual");
  await A.patch(`/api/leave-types/${annualType.id}`, { annualDays: 24, carryForwardMaxDays: 0 });
  const bal24 = (await A.get(`/api/companies/${A.cid}/leave-balances?asOf=${prevEnd}&employeeId=${emp.id}`)).json.find((r) => r.code === "annual");
  ok(`L2: a 24-day annual type accrues 2 a month: ${2 * prevMonthNo} days at ${prevEnd}`, close(bal24?.accrued, 2 * prevMonthNo), bal24);
}

async function fixRoundPeople() {
  const A = await newCompany("fpA");
  const bank = await A.accountId("1020");

  // H3: a whole month of unpaid leave deducts at most 30/30 of basic; a failing calculation leaves nothing half-done
  const e1 = await newEmployee(A, "Unpaid Person");
  const e2 = await newEmployee(A, "Second Person");
  const e3 = await newEmployee(A, "Edited Person");
  const unpaid = (await A.get(`/api/companies/${A.cid}/leave-types`)).json.find((t) => t.code === "unpaid").id;
  const daysInPrev = Number(prevEnd.slice(8, 10));
  const lr = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e1.id, leaveTypeId: unpaid, startDate: prevMonthDay(1), endDate: prevEnd });
  await A.post(`/api/leave-requests/${lr.json.id}/approve`, {});
  const runId = await runFor(A);
  await A.post(`/api/payroll-runs/${runId}/calculate`, {});
  const items = (await A.get(`/api/payroll-runs/${runId}/items`)).json;
  const it1 = items.find((i) => i.employee_id === e1.id);
  const expectedDeduction = Math.min(daysInPrev, 30) / 30 * 6000;
  ok(`H3: a ${daysInPrev}-day unpaid month deducts ${expectedDeduction} (never more than 30/30 of basic)`, close(it1.leave_deduction, expectedDeduction) && n(it1.net_salary) >= 0, it1);
  // an edited item whose deductions plus a later full month of unpaid leave exceed its pay makes a recalculation fail as a whole
  const e1Item = items.find((i) => i.employee_id === e3.id);
  const patched = await A.patch(`/api/payroll-items/${e1Item.id}`, { deductions: 5000 });
  ok("setup: the third employee's item is edited (deductions 5,000)", patched.status === 200, patched.status);
  const lr3 = await A.post(`/api/companies/${A.cid}/leave-requests`, { employeeId: e3.id, leaveTypeId: unpaid, startDate: prevMonthDay(1), endDate: prevEnd });
  await A.post(`/api/leave-requests/${lr3.json.id}/approve`, {});
  const before = (await A.get(`/api/payroll-runs/${runId}/items`)).json.map((i) => i.id).sort();
  const failing = await A.post(`/api/payroll-runs/${runId}/calculate`, {});
  const afterIds = (await A.get(`/api/payroll-runs/${runId}/items`)).json.map((i) => i.id).sort();
  ok("H3: a calculation that fails part-way is refused (400) and leaves every item exactly as it was", failing.status === 400 && JSON.stringify(before) === JSON.stringify(afterIds) && afterIds.length === 3, { s: failing.status, before, afterIds });
  ok("H3: ...and the run keeps its status", (await db.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runId])).rows[0].status === "calculated");

  // H4: timer instants are timestamptz and the running entry reports elapsed seconds
  const col = (await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'time_entries' AND column_name IN ('started_at', 'ended_at')`)).rows.map((r) => r.data_type);
  ok("H4: time_entries.started_at and ended_at are timestamptz", col.length === 2 && col.every((t) => t === "timestamp with time zone"), col);
  const proj = (await A.post(`/api/companies/${A.cid}/projects`, { name: "Timer project", hourlyRate: 100 })).json;
  const st = await A.post(`/api/companies/${A.cid}/timer/start`, { projectId: proj.id });
  await db.query(`UPDATE time_entries SET started_at = started_at - interval '119 seconds' WHERE id = $1`, [st.json.id]);
  const cur = (await A.get(`/api/companies/${A.cid}/timer`)).json.running;
  ok("H4: a running timer returns elapsedSeconds from the database clock (about 119)", cur.elapsedSeconds >= 119 && cur.elapsedSeconds <= 130, cur.elapsedSeconds);
  await db.query(`SET timezone = 'Asia/Dubai'`);
  const stop = await A.post(`/api/companies/${A.cid}/timer/stop`, {});
  ok("H4: stop gives 2 minutes whatever the session time zone", stop.status === 200 && stop.json.minutes === 2, stop.json);
  await db.query(`RESET timezone`);

}

async function settlementProvision() {
  const C = await newCompany("m2C");
  // M2: a settlement whose provision was not typed is recomputed at posting
  const leaver = await newEmployee(C, "Provision Person", { joinDate: ymd(new Date(Date.UTC(Number(prevEnd.slice(0, 4)) - 3, 0, 1))) });
  const draft = await C.post(`/api/companies/${C.cid}/final-settlements`, { employeeId: leaver.id, terminationDate: prevEnd, leaveDays: 0 });
  ok("M2: the draft's provision (nothing accrued yet) is 0", draft.status === 201 && close(draft.json.provisionUsed, 0), draft.json);
  const runC = await runFor(C);
  await C.post(`/api/payroll-runs/${runC}/calculate`, {});
  const apprC = await C.post(`/api/payroll-runs/${runC}/approve`, {});
  ok("setup: a payroll run accrues gratuity (350 each) after the drafts", apprC.status === 200, apprC.status);
  const posted = await C.post(`/api/final-settlements/${draft.json.id}/post`, {});
  ok("M2: posting recomputes the provision from the accrual to date (350) when it was not typed", posted.status === 200 && close(posted.json.provisionUsed, 350), posted.json);
}

async function creditNotesAndInvoiceProjects() {
  const A = await newCompany("h1A");
  const B = await newCompany("h1B");
  const customer = (await A.post(`/api/companies/${A.cid}/customer-contacts`, { name: "H1 Customer" })).json;
  const p = (await A.post(`/api/companies/${A.cid}/projects`, { name: "H1 project", contactId: customer.id, hourlyRate: 200 })).json;
  const bProject = (await B.post(`/api/companies/${B.cid}/projects`, { name: "B project" })).json;
  const profit = async (id = p.id) => (await A.get(`/api/projects/${id}/profitability`)).json;

  // H2: projectId on invoice lines
  const mk = (extra) => A.post(`/api/companies/${A.cid}/invoices`, { customerName: "H1 Customer", date: prevMid, dueDate: prevMid, lines: [{ description: "Work", quantity: 2, unitPrice: 200, vatRate: 0.05, ...extra }] });
  const foreign = await mk({ projectId: bProject.id });
  ok("H2: another company's project on an invoice line is 400 INVALID_PROJECT", foreign.status === 400 && foreign.json?.code === "INVALID_PROJECT", { s: foreign.status, j: foreign.json });
  const inv = await mk({ projectId: p.id });
  ok("H2: a line with projectId is stored with it", inv.status === 200 && (await db.query(`SELECT project_id FROM invoice_lines WHERE invoice_id = $1 AND line_kind = 'item'`, [inv.json.id])).rows[0].project_id === p.id, { s: inv.status, j: inv.json });
  const edit = await A.put(`/api/invoices/${inv.json.id}`, { customerName: "H1 Customer", date: prevMid, dueDate: prevMid, lines: [{ description: "Work edited", quantity: 2, unitPrice: 200, vatRate: 0.05 }] });
  ok("H2: an update that sends no projectId carries the old line's project over", edit.status === 200 && (await db.query(`SELECT project_id FROM invoice_lines WHERE invoice_id = $1 AND line_kind = 'item'`, [inv.json.id])).rows[0].project_id === p.id, { s: edit.status, j: edit.json });
  const badEdit = await A.put(`/api/invoices/${inv.json.id}`, { customerName: "H1 Customer", date: prevMid, dueDate: prevMid, lines: [{ description: "x", quantity: 2, unitPrice: 200, vatRate: 0.05, projectId: bProject.id }] });
  ok("H2: an update naming another company's project is 400 INVALID_PROJECT", badEdit.status === 400 && badEdit.json?.code === "INVALID_PROJECT", { s: badEdit.status, j: badEdit.json });
  const issue = await A.patch(`/api/invoices/${inv.json.id}/status`, { status: "sent" });
  ok("H2: the issued invoice puts 400 of revenue on the project", issue.status === 200 && close((await profit()).revenue, 400), await profit());

  // H1: credit notes reduce project revenue
  const partial = await A.post(`/api/companies/${A.cid}/invoices/${inv.json.id}/credit-note`, { date: prevMid, lines: [{ description: "Returned", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
  ok("H1: a partial credit note (100) takes 100 off the project's revenue", partial.status === 201 || partial.status === 200, { s: partial.status, j: partial.json });
  ok("H1: project revenue is now 300", close((await profit()).revenue, 300), await profit());
  const full = await A.post(`/api/companies/${A.cid}/invoices/${inv.json.id}/credit-note`, { date: prevMid, body: {} });
  ok("H1: the remaining credit note is accepted", full.status === 201 || full.status === 200, { s: full.status, j: full.json });
  ok("H1: project revenue falls to 0 after the full credit", close((await profit()).revenue, 0), await profit());
  const tb = await A.balances();
  ok("H1: the ledger still balances", close(Object.values(tb).reduce((a, b) => a + b, 0), 0), tb);
}

async function vendorFxAndAgeing() {
  const A = await newCompany("l3A");
  const vendor = "FX Statement Vendor";
  const billId = await A.bill(prevMonthDay(3), 1000, { vendor_name: vendor, currency: "USD", exchange_rate: 3.6725 });
  const contactId = (await A.get(`/api/bills/${billId}`)).json.vendor_id;
  const credit = await A.post(`/api/companies/${A.cid}/vendor-credits`, { vendor_name: vendor, date: prevMonthDay(10), currency: "USD", exchange_rate: 3.7, line_items: [{ description: "Credit", quantity: 1, unit_price: 1000, vat_rate: 5 }] });
  await A.post(`/api/companies/${A.cid}/vendor-credits/${credit.json.id}/approve`, {});
  const applied = await A.post(`/api/companies/${A.cid}/vendor-credits/${credit.json.id}/apply`, { bill_id: billId, amount: 1050 });
  ok("setup: a USD credit at another rate is applied (FX difference posts)", applied.status === 200, { s: applied.status, j: applied.json });
  const st = (await A.get(`/api/companies/${A.cid}/contacts/${contactId}/vendor-statement?from=${prevMonthDay(1)}&to=${today}`)).json;
  const ledger = await A.balances();
  ok("L3: the statement includes the exchange-difference line and closes at the 2010 balance", st.lines.some((l) => l.type === "vendor_credit_fx") && close(st.closingBalance, -(ledger["2010"] ?? 0)), { lines: st.lines.map((l) => [l.type, l.balance]), closing: st.closingBalance, ap: ledger["2010"] });

  // ageing detail: an unlinked document groups with the contact its name matches
  const second = await A.bill(prevMonthDay(4), 500, { vendor_name: vendor });
  await db.query(`UPDATE vendor_bills SET vendor_id = NULL WHERE id = $1`, [second]);
  const detail = (await A.get(`/api/companies/${A.cid}/payables/ageing-detail`)).json;
  ok("L3: ageing detail puts linked and unlinked bills of the vendor in ONE group", detail.vendors.filter((v) => v.name === vendor || v.vendorId === contactId).length === 1, detail.vendors.map((v) => [v.vendorId, v.name, v.rows.length]));

  // L4: the balance summaries leave a pending bill out of what is owed
  const pending = await A.bill(prevMonthDay(5), 700, { vendor_name: "Summary Vendor" }, false);
  const sums = (await A.get(`/api/companies/${A.cid}/reports/balance-summaries`)).json;
  ok("L4: balance summaries do not count a pending (unposted) bill", !sums.vendors.some((v) => v.name === "Summary Vendor"), sums.vendors?.map((v) => v.name));
  void pending;
}

async function noEligibleApprover() {
  const A = await newCompany("neA");
  await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "Accountant signs", thresholdAed: 100, approverRoles: ["accountant"] });
  const bill = await A.bill(prevMid, 500, { vendor_name: "Lonely Owner Vendor" }, false);
  const alone = await A.post(`/api/bills/${bill}/approve`, {});
  ok("NO_ELIGIBLE_APPROVER: the only member created the bill, so nobody can sign: 409 naming the role", alone.status === 409 && alone.json?.code === "NO_ELIGIBLE_APPROVER" && alone.json?.requiredRole === "accountant" && alone.json?.step === 1, { s: alone.status, j: alone.json });
  ok("NO_ELIGIBLE_APPROVER: nothing was recorded", n((await db.query(`SELECT COUNT(*) AS c FROM approval_requests WHERE document_id = $1`, [bill])).rows[0].c) === 0);
  const acct = await A.member("accountant");
  const again = await A.post(`/api/bills/${bill}/approve`, {});
  ok("once an accountant is added, the creator's own approval is plain SELF_APPROVAL (403)", again.status === 403 && again.json?.code === "SELF_APPROVAL", { s: again.status, j: again.json });
  const done = await A.post(`/api/bills/${bill}/approve`, {}, acct.token);
  ok("...and the accountant approves it", done.status === 200 && done.json?.status === "approved", { s: done.status, j: done.json });
}


// F4: a rejection ends the request; F10: the sole possible approver is the creator.
async function rejectionEndsTheRequest() {
  const A = await newCompany("rjA");
  const prep = await A.member("employee");
  const prep2 = await A.member("employee");
  const acct = await A.member("accountant");
  for (const [documentType, roles] of [["bill", ["owner"]], ["expense_claim", ["accountant"]], ["purchase_order", ["owner"]], ["payroll_run", ["accountant"]], ["manual_journal", ["owner"]]]) {
    await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType, name: documentType + " rule", thresholdAed: 0, approverRoles: roles });
  }
  const queue = async (status) => (await A.get(`/api/companies/${A.cid}/approvals?status=${status}`)).json;

  // bill
  const bill = await A.bill(prevMid, 8000, { vendor_name: "Rejected Vendor" }, false, prep.token);
  const rej = await A.post(`/api/approvals/bill/${bill}/reject`, { comment: "Wrong period" });
  ok("F4 bill: the rejection ends the request and the bill is a draft", rej.status === 200 && (await db.query(`SELECT status FROM vendor_bills WHERE id = $1`, [bill])).rows[0].status === "draft", rej.json);
  ok("F4 bill: it is out of the waiting queue", !(await queue("pending")).some((r) => r.documentId === bill), null);
  const rejRow = (await queue("rejected")).find((r) => r.documentId === bill);
  ok("F4 bill: the rejected queue shows the reason, who rejected, and that it can be resubmitted", rejRow?.rejectionReason === "Wrong period" && !!rejRow.rejectedByName && rejRow.canResubmit === true, rejRow);
  const approveRejected = await A.post(`/api/bills/${bill}/approve`, {});
  ok("F4 bill: approving a rejected request is 409 REQUEST_REJECTED and posts nothing", approveRejected.status === 409 && approveRejected.json?.code === "REQUEST_REJECTED" && (await A.jes("bill", bill)).length === 0, { s: approveRejected.status, j: approveRejected.json });
  const rejectAgain = await A.post(`/api/approvals/bill/${bill}/reject`, { comment: "again" });
  ok("F4 bill: rejecting it twice is refused too", rejectAgain.status === 409, rejectAgain.status);
  const stranger = await A.post(`/api/approvals/bill/${bill}/resubmit`, {}, prep2.token);
  ok("F4 bill: another employee cannot resubmit it (403 ROLE_REQUIRED)", stranger.status === 403 && stranger.json?.code === "ROLE_REQUIRED", { s: stranger.status, j: stranger.json });
  const early = await A.post(`/api/approvals/bill/${(await A.bill(prevMid, 300, { vendor_name: "Fresh" }, false, prep.token))}/resubmit`, {}, prep.token);
  ok("F4 bill: a document that was never rejected cannot be resubmitted (409 NOT_REJECTED)", early.status === 409 && early.json?.code === "NOT_REJECTED", { s: early.status, j: early.json });
  const resub = await A.post(`/api/approvals/bill/${bill}/resubmit`, {}, prep.token);
  ok("F4 bill: the preparer resubmits: a new request with no steps, the bill is pending again", resub.status === 201 && resub.json?.completedSteps === 0 && (await db.query(`SELECT status FROM vendor_bills WHERE id = $1`, [bill])).rows[0].status === "pending", { s: resub.status, j: resub.json });
  const hist = (await A.get(`/api/approvals/bill/${bill}`)).json;
  ok("F4 bill: the history keeps both requests, the first rejected with its reason", hist.requests.length === 2 && hist.requests.some((r) => r.status === "rejected" && r.steps.some((st) => st.decision === "rejected" && st.comment === "Wrong period")), hist.requests?.map((r) => r.status));
  ok("F4 bill: the audit trail records the rejection (with the reason) and the resubmission", (await auditCount("bill", bill, "approval.rejected")) === 1 && (await auditCount("bill", bill, "approval.resubmitted")) === 1, null);
  const reasonAudit = (await db.query(`SELECT 1 FROM audit_logs WHERE resource_id = $1 AND action = 'approval.rejected' AND details LIKE '%Wrong period%'`, [bill])).rowCount;
  ok("F4 bill: ...and the audit row carries the reason", reasonAudit === 1, reasonAudit);
  const note = (await db.query(`SELECT message FROM notifications WHERE user_id = $1 AND related_entity_id = $2 ORDER BY created_at DESC LIMIT 5`, [prep.userId, bill])).rows;
  ok("F4 bill: the preparer's notification carries the reason", note.some((r) => String(r.message).includes("Wrong period")), note);
  const ok1 = await A.post(`/api/bills/${bill}/approve`, {});
  ok("F4 bill: after the resubmission the owner approves it and it posts", ok1.status === 200 && ok1.json?.status === "approved" && (await A.jes("bill", bill)).length === 1, { s: ok1.status, j: ok1.json });

  // expense claim
  const claim = await A.post(`/api/companies/${A.cid}/expense-claims`, { title: "Rejected claim", items: [{ expense_date: prevMid, category: "office", description: "Ink", amount: 400, vat_amount: 0 }] }, prep.token);
  await A.post(`/api/expense-claims/${claim.json.id}/submit`, {}, prep.token);
  await A.post(`/api/approvals/expense_claim/${claim.json.id}/reject`, { comment: "No receipt" }, acct.token);
  const claimApprove = await A.post(`/api/expense-claims/${claim.json.id}/approve`, {}, acct.token);
  ok("F4 claim: approving a rejected claim is 409 REQUEST_REJECTED", claimApprove.status === 409 && claimApprove.json?.code === "REQUEST_REJECTED", { s: claimApprove.status, j: claimApprove.json });
  const claimResub = await A.post(`/api/approvals/expense_claim/${claim.json.id}/resubmit`, {}, prep.token);
  const claimOk = await A.post(`/api/expense-claims/${claim.json.id}/approve`, {}, acct.token);
  ok("F4 claim: resubmitted by the submitter, then approved", claimResub.status === 201 && claimOk.status === 200 && claimOk.json?.status === "approved", { r: claimResub.status, a: claimOk.status, j: claimOk.json });

  // purchase order
  const po = await A.post(`/api/companies/${A.cid}/purchase-orders`, { number: "PO-RJ-" + rnd, vendorName: "PO Vendor", date: prevMid, lines: [{ description: "Desks", quantity: 1, unitPrice: 800, vatRate: 0.05 }] }, prep.token);
  await A.post(`/api/purchase-orders/${po.json.id}/send`, {}, prep.token);
  await A.post(`/api/approvals/purchase_order/${po.json.id}/reject`, { comment: "Too dear" });
  const poApprove = await A.post(`/api/purchase-orders/${po.json.id}/approve`, {});
  ok("F4 purchase order: approving a rejected order is 409 REQUEST_REJECTED", poApprove.status === 409 && poApprove.json?.code === "REQUEST_REJECTED", { s: poApprove.status, j: poApprove.json });
  const poResub = await A.post(`/api/approvals/purchase_order/${po.json.id}/resubmit`, {}, prep.token);
  const poOk = await A.post(`/api/purchase-orders/${po.json.id}/approve`, {});
  ok("F4 purchase order: resubmitted, then approved", poResub.status === 201 && poOk.status === 200, { r: poResub.status, a: poOk.status, j: poOk.json });

  // payroll run
  await newEmployee(A, "Reject Payroll Person");
  const run = await A.post(`/api/companies/${A.cid}/payroll-runs`, { periodMonth: prevMonthNo, periodYear: prevYear }, acct.token);
  await A.post(`/api/payroll-runs/${run.json.id}/calculate`, {}, acct.token);
  await A.post(`/api/approvals/payroll_run/${run.json.id}/reject`, { comment: "Check overtime" });
  const runApprove = await A.post(`/api/payroll-runs/${run.json.id}/approve`, {});
  ok("F4 payroll run: approving a rejected run is 409 REQUEST_REJECTED and posts nothing", runApprove.status === 409 && runApprove.json?.code === "REQUEST_REJECTED" && (await A.jes("system", run.json.id)).length === 0, { s: runApprove.status, j: runApprove.json });
  const runResub = await A.post(`/api/approvals/payroll_run/${run.json.id}/resubmit`, {}, acct.token);
  const runOk = await A.post(`/api/payroll-runs/${run.json.id}/approve`, {});
  ok("F4 payroll run: the preparer resubmits, an approver other than the preparer approves", runResub.status === 201 && runOk.status === 200 && runOk.json?.status === "approved", { r: runResub.status, a: runOk.status, j: runOk.json });

  // manual journal
  const bank = await A.accountId("1020"), exp = await A.accountId("5000");
  const j = await A.post(`/api/companies/${A.cid}/journal`, { date: prevMid, memo: "Adjustment", status: "draft", lines: [{ accountId: exp, debit: 500, credit: 0 }, { accountId: bank, debit: 0, credit: 500 }] }, acct.token);
  await A.post(`/api/journal/${j.json.id}/submit-for-approval`, {}, acct.token);
  await A.post(`/api/approvals/manual_journal/${j.json.id}/reject`, { comment: "Wrong accounts" });
  const jApprove = await A.post(`/api/journal/${j.json.id}/post`, {});
  ok("F4 journal: posting a rejected journal is 409 REQUEST_REJECTED", jApprove.status === 409 && jApprove.json?.code === "REQUEST_REJECTED", { s: jApprove.status, j: jApprove.json });
  const jResub = await A.post(`/api/approvals/manual_journal/${j.json.id}/resubmit`, {}, acct.token);
  const jOk = await A.post(`/api/journal/${j.json.id}/post`, {});
  ok("F4 journal: resubmitted, then the owner posts it", jResub.status === 201 && jOk.status === 200 && jOk.json?.status === "posted", { r: jResub.status, a: jOk.status, j: jOk.json });
}

async function soleApprover() {
  const A = await newCompany("soA");
  await A.post(`/api/companies/${A.cid}/approval-rules`, { documentType: "bill", name: "Owner signs", thresholdAed: 0, approverRoles: ["owner"] });
  const bill = await A.bill(prevMid, 900, { vendor_name: "One Person Vendor" }, false);
  const plain = await A.post(`/api/bills/${bill}/approve`, {});
  ok("F10: the creator who is the only possible approver is told so (409 NO_ELIGIBLE_APPROVER, soleApprover)", plain.status === 409 && plain.json?.code === "NO_ELIGIBLE_APPROVER" && plain.json?.soleApprover === true, { s: plain.status, j: plain.json });
  const row = (await A.get(`/api/companies/${A.cid}/approvals`)).json.find((r) => r.documentId === bill);
  ok("F10: the queue row says soleApprover so the screen offers the acknowledged approval", row?.soleApprover === true && row.canAct === false, row);
  const done = await A.post(`/api/bills/${bill}/approve`, { acknowledgeSoleApprover: true });
  ok("F10: with the acknowledgement the sole approver approves and it posts", done.status === 200 && done.json?.status === "approved" && (await A.jes("bill", bill)).length === 1, { s: done.status, j: done.json });
  const step = (await db.query(`SELECT s.self_approved FROM approval_steps s JOIN approval_requests r ON r.id = s.request_id WHERE r.document_id = $1`, [bill])).rows;
  const reqRow = (await db.query(`SELECT self_approved FROM approval_requests WHERE document_id = $1`, [bill])).rows[0];
  ok("F10: the step and the request are recorded as self-approved", step.length === 1 && step[0].self_approved === true && reqRow.self_approved === true, { step, reqRow });
  ok("F10: the audit trail has a self-approved entry", (await auditCount("bill", bill, "approval.self_approved")) === 1, null);
  const approvedRow = (await A.get(`/api/companies/${A.cid}/approvals?status=approved`)).json.find((r) => r.documentId === bill);
  ok("F10: the approved queue row carries selfApproved for the warning badge", approvedRow?.selfApproved === true, approvedRow);

  // another eligible approver exists: SELF_APPROVAL stays, whatever the acknowledgement says
  const B = await newCompany("soB");
  const partner = await B.member("owner");
  await B.post(`/api/companies/${B.cid}/approval-rules`, { documentType: "bill", name: "Owner signs", thresholdAed: 0, approverRoles: ["owner"] });
  const billB = await B.bill(prevMid, 900, { vendor_name: "Two Owners Vendor" }, false);
  const self = await B.post(`/api/bills/${billB}/approve`, { acknowledgeSoleApprover: true });
  ok("F10: with another eligible approver the creator still gets 403 SELF_APPROVAL, acknowledged or not", self.status === 403 && self.json?.code === "SELF_APPROVAL", { s: self.status, j: self.json });
  const other = await B.post(`/api/bills/${billB}/approve`, {}, partner.token);
  ok("F10: ...and the other owner approves, not marked self-approved", other.status === 200 && (await db.query(`SELECT self_approved FROM approval_requests WHERE document_id = $1`, [billB])).rows[0].self_approved === false, { s: other.status, j: other.json });
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await contactsBackfill();
    await vendorResolution();
    await vendorStatement();
    await openingBalanceVendor();
    await defects();
    await approvalRulesApi();
    await approvalsBill();
    await approvalsOtherDocuments();
    await approvalsPayrollRace();
    await projectsFlow();
    await leaveBalances();
    await sickLeavePayroll();
    await loansFlow();
    await settlementFlow();
    await lockedPeriods();
    await fixRound();
    await fixRoundPeople();
    await settlementProvision();
    await creditNotesAndInvoiceProjects();
    await vendorFxAndAgeing();
    await noEligibleApprover();
    await rejectionEndsTheRequest();
    await soleApprover();
    await uiContracts();
    // @@GROUPS
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
