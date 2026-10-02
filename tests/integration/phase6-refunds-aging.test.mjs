// Integration tests for Phase 6 stream D: customer refunds and the aging report "as of" a day.
//   BASE_URL=http://localhost:5064 DATABASE_URL=... node tests/integration/phase6-refunds-aging.test.mjs
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
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const day = (ago) => ymd(new Date(Date.now() - ago * 86400000));
const today = day(0);
const now = new Date();
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevStart = prevEnd.slice(0, 8) + "01";
const prevMid = prevEnd.slice(0, 8) + "15";

let db;

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const account = async (code) => ((await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? []).find((a) => a.code === code);
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
      token, body: { customerName: "Refund Co", date, dueDate: date, lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 0.05 }], ...extra },
    });
    if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 200));
    const r2 = await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token, body: { status: "sent" } });
    if (r2.status !== 200) throw new Error("issue failed " + r2.status + " " + r2.text.slice(0, 200));
    return r1.json;
  };
  const pay = async (invoiceId, amount, date, bankId) => {
    const r1 = await api("POST", `/api/companies/${cid}/invoices/${invoiceId}/payments`, { token, body: { amount, date, paymentAccountId: bankId } });
    if (r1.status !== 201) throw new Error("payment failed " + r1.status + " " + r1.text.slice(0, 200));
    return r1.json;
  };
  const creditNote = async (invoiceId, body = {}) => {
    const r1 = await api("POST", `/api/companies/${cid}/invoices/${invoiceId}/credit-note`, { token, body });
    if (r1.status !== 201) throw new Error("credit note failed " + r1.status + " " + r1.text.slice(0, 200));
    return r1.json;
  };
  const refund = (cnId, body) => api("POST", `/api/companies/${cid}/credit-notes/${cnId}/refunds`, { token, body });
  const refunds = (cnId) => api("GET", `/api/companies/${cid}/credit-notes/${cnId}/refunds`, { token });
  const aging = (asOf) => api("GET", `/api/reports/${cid}/aging${asOf ? `?asOf=${asOf}` : ""}`, { token });
  return { token, cid, account, balances, invoice, pay, creditNote, refund, refunds, aging };
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await refundSection();
    await refundContactAndAccount();
    await agingSection();
    await payablesAgingWithCredits();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ═════════════════════════════════════════════════════════════════════════════
// Customer refunds
// ═════════════════════════════════════════════════════════════════════════════
async function refundSection() {
  const R = await newCompany("refund");
  const bank = await R.account("1020");
  const rev = await R.account("4010");

  // invoice 1,000 + 5% VAT = 1,050, paid in full, then credited in full: the customer is owed 1,050
  const inv = await R.invoice(today, 1000);
  await R.pay(inv.id, 1050, today, bank.id);
  const cn = await R.creditNote(inv.id);
  let r = await R.refunds(cn.id);
  ok("refund: summary before any refund: 1,050 refundable", r.status === 200 && close(r.json?.summary?.refundable, 1050) && r.json?.refunds?.length === 0, { s: r.status, j: r.json });

  r = await R.refund(cn.id, { amount: 1050, bankAccountId: bank.id, date: today, reference: "TRF-1" });
  ok("refund: full refund is accepted (201)", r.status === 201 && close(r.json?.refund?.amount, 1050) && close(r.json?.remaining, 0), { s: r.status, j: r.json });
  const refundId = r.json?.refund?.id;
  const entry = (await db.query(
    `SELECT je.id, je.source, je.status, je.source_id, a.code, jl.debit, jl.credit FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'customer_refund' ORDER BY a.code`, [R.cid])).rows;
  ok("refund: one balanced entry Dr 1040 / Cr 1020 for 1,050, a system entry",
    entry.length === 2 && entry.every((e) => e.status === "posted" && e.source_id === refundId)
      && close(entry.find((e) => e.code === "1040")?.debit, 1050) && close(entry.find((e) => e.code === "1020")?.credit, 1050),
    entry);
  let bal = await R.balances();
  ok("refund: receivable and bank both net to 0 after invoice, payment, credit note and refund", close(bal["1040"], 0) && close(bal["1020"], 0), bal);
  r = await R.refunds(cn.id);
  ok("refund: the list shows the refund and 0 remaining", r.json?.refunds?.length === 1 && close(r.json?.summary?.refundable, 0) && close(r.json?.summary?.refunded, 1050), r.json);

  r = await R.refund(cn.id, { amount: 1, bankAccountId: bank.id });
  ok("refund: a second refund is refused (422 REFUND_EXCEEDS_REMAINING)", r.status === 422 && r.json?.code === "REFUND_EXCEEDS_REMAINING", { s: r.status, j: r.json });

  // the generic journal routes cannot undo or change it
  const jr = await api("POST", `/api/journal/${entry[0].id}/reverse`, { token: R.token, body: {} });
  ok("refund: the refund entry cannot be reversed from the journal (409)", jr.status === 409, { s: jr.status, j: jr.json });

  // a credit note with a standing refund cannot be voided underneath it
  let v = await api("PATCH", `/api/invoices/${cn.id}/status`, { token: R.token, body: { status: "void" } });
  ok("refund: voiding the credit note while a refund stands is refused (409 CREDIT_NOTE_HAS_REFUNDS)", v.status === 409 && v.json?.code === "CREDIT_NOTE_HAS_REFUNDS", { s: v.status, j: v.json });

  // void restores the remaining
  v = await api("POST", `/api/companies/${R.cid}/credit-notes/${cn.id}/refunds/${refundId}/void`, { token: R.token, body: {} });
  ok("refund: void -> 200 with the amount back on the credit note", v.status === 200 && close(v.json?.summary?.refundable, 1050) && !!v.json?.refund?.voidedAt, { s: v.status, j: v.json });
  bal = await R.balances();
  ok("refund: the void reversed the entry (receivable back to a 1,050 credit, bank back to +0 net of the refund)", close(bal["1040"], -1050) && close(bal["1020"], 1050), bal);
  v = await api("POST", `/api/companies/${R.cid}/credit-notes/${cn.id}/refunds/${refundId}/void`, { token: R.token, body: {} });
  ok("refund: voiding twice is refused (409 REFUND_ALREADY_VOID)", v.status === 409 && v.json?.code === "REFUND_ALREADY_VOID", { s: v.status, j: v.json });

  // partial refunds and the cap
  r = await R.refund(cn.id, { amount: 400, bankAccountId: bank.id });
  ok("refund: partial refund of 400 leaves 650", r.status === 201 && close(r.json?.remaining, 650), { s: r.status, j: r.json });
  r = await R.refund(cn.id, { amount: 650.01, bankAccountId: bank.id });
  ok("refund: 650.01 is more than the 650 left (422)", r.status === 422 && r.json?.code === "REFUND_EXCEEDS_REMAINING", { s: r.status, j: r.json });
  r = await R.refund(cn.id, { amount: 650, bankAccountId: bank.id });
  ok("refund: the exact rest is accepted", r.status === 201 && close(r.json?.remaining, 0), { s: r.status, j: r.json });
  r = await R.refunds(cn.id);
  ok("refund: the list keeps the voided refund and two live ones", r.json?.refunds?.length === 3 && r.json.refunds.filter((x) => !x.voidedAt).length === 2, r.json?.refunds?.length);

  // validation
  r = await R.refund(cn.id, { amount: 0, bankAccountId: bank.id });
  ok("refund: amount 0 is refused (400)", r.status === 400, { s: r.status, j: r.json });
  r = await R.refund(cn.id, { amount: 10, bankAccountId: rev.id });
  ok("refund: a non-cash account is refused (400)", r.status === 400 && r.json?.code === "INVALID_BANK_ACCOUNT", { s: r.status, j: r.json });
  r = await R.refund(cn.id, { amount: 10, bankAccountId: bank.id, date: day(-3) });
  ok("refund: a future date is refused (422)", r.status === 422, { s: r.status, j: r.json });
  const other = await newCompany("refundother");
  r = await api("GET", `/api/companies/${R.cid}/credit-notes/${cn.id}/refunds`, { token: other.token });
  ok("refund: another company's user cannot read the refunds (403)", r.status === 403, { s: r.status });
  r = await api("POST", `/api/companies/${other.cid}/credit-notes/${cn.id}/refunds`, { token: other.token, body: { amount: 1, bankAccountId: (await other.account("1020")).id } });
  ok("refund: nor refund a credit note through their own company id (404)", r.status === 404, { s: r.status, j: r.json });

  // a credit note on an UNPAID invoice only reduced what was owed: nothing to pay back
  const unpaid = await R.invoice(today, 1000);
  const cnUnpaid = await R.creditNote(unpaid.id);
  r = await R.refunds(cnUnpaid.id);
  ok("refund: credit note on an unpaid invoice has nothing refundable", close(r.json?.summary?.refundable, 0), r.json?.summary);
  r = await R.refund(cnUnpaid.id, { amount: 100, bankAccountId: bank.id });
  ok("refund: refunding it is refused (422)", r.status === 422 && r.json?.code === "REFUND_EXCEEDS_REMAINING", { s: r.status, j: r.json });

  // a partial credit note on a paid invoice refunds only the credited part
  const inv3 = await R.invoice(today, 1000);
  await R.pay(inv3.id, 1050, today, bank.id);
  const cn3 = await R.creditNote(inv3.id, { lines: [{ description: "Service", quantity: 1, unitPrice: 200, vatRate: 0.05 }] });
  r = await R.refunds(cn3.id);
  ok("refund: partial credit note of 210 on a paid invoice -> 210 refundable", close(r.json?.summary?.refundable, 210), r.json?.summary);

  // foreign currency: a USD credit note. Without a refund-date rate the cash goes out at the invoice rate
  // (no FX); with one the receivable still clears at the invoice rate and the difference is realised FX
  const F = await newCompany("refundfx");
  const fbank = await F.account("1020");
  const finv = await F.invoice(today, 1000, { currency: "USD", exchangeRate: 3.6725 });
  const fpay = await api("POST", `/api/companies/${F.cid}/invoices/${finv.id}/payments`, { token: F.token, body: { amount: 1050, date: today, paymentAccountId: fbank.id, exchangeRate: 3.6725 } });
  const fcn = await F.creditNote(finv.id);
  ok("refund: USD: setup payment accepted", fpay.status === 201, { s: fpay.status, j: fpay.json });
  const f1 = await F.refund(fcn.id, { amount: 500, bankAccountId: fbank.id });
  const f2 = await F.refund(fcn.id, { amount: 550, bankAccountId: fbank.id, exchangeRate: 3.7 });
  ok("refund: USD: both refunds accepted", f1.status === 201 && f2.status === 201 && close(f2.json?.remaining, 0), { a: f1.json, b: f2.json });
  const fxLines = async (refundIdOf) => (await db.query(
    `SELECT a.code, jl.debit, jl.credit, jl.foreign_currency FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'customer_refund' AND je.source_id = $2 ORDER BY a.code`, [F.cid, refundIdOf])).rows;
  const l1 = await fxLines(f1.json?.refund?.id), l2 = await fxLines(f2.json?.refund?.id);
  ok("refund: USD without a rate: Dr 1040 1,836.25 / Cr 1020 1,836.25, no FX leg",
    l1.length === 2 && close(l1.find((e) => e.code === "1040")?.debit, 1836.25) && close(l1.find((e) => e.code === "1020")?.credit, 1836.25), l1);
  ok("refund: USD at 3.70: Dr 1040 2,019.88 (invoice rate) + Dr FX loss 15.12 / Cr 1020 2,035.00",
    close(l2.find((e) => e.code === "1040")?.debit, 2019.88) && close(l2.find((e) => e.code === "5140")?.debit, 15.12) && close(l2.find((e) => e.code === "1020")?.credit, 2035), l2);

  // period lock
  const L = await newCompany("refundlock");
  const lbank = await L.account("1020");
  const linv = await L.invoice(prevMid, 1000);
  await L.pay(linv.id, 1050, prevMid, lbank.id);
  const lcn = await L.creditNote(linv.id, { date: prevMid });
  await db.query("INSERT INTO month_end_close (company_id, period_start, period_end, status) VALUES ($1, $2, $3, 'locked')", [L.cid, prevStart, prevEnd]);
  r = await L.refund(lcn.id, { amount: 100, bankAccountId: lbank.id, date: prevMid });
  ok("refund: a refund dated in a locked period is refused (403)", r.status === 403, { s: r.status, j: r.json });
  r = await L.refund(lcn.id, { amount: 100, bankAccountId: lbank.id, date: today });
  ok("refund: dated in the open month it is accepted", r.status === 201, { s: r.status, j: r.json });
  r = await L.refund(lcn.id, { amount: 100, bankAccountId: lbank.id, date: ymd(new Date(Date.parse(prevMid) - 40 * 86400000)) });
  ok("refund: a date before the credit note is refused", r.status === 403 || r.status === 422, { s: r.status, j: r.json });
}

// ═════════════════════════════════════════════════════════════════════════════
// Refunds: the customer contact carries through, and the money leaves a cash/bank account
// ═════════════════════════════════════════════════════════════════════════════
async function refundContactAndAccount() {
  const F = await newCompany("refundcontact");
  const bank = await F.account("1020");
  const contact = (await api("POST", `/api/companies/${F.cid}/customer-contacts`, { token: F.token, body: { name: "FX Co", email: "fx@example.com" } })).json;
  const from = day(60);
  const statement = async () => (await api("GET", `/api/companies/${F.cid}/contacts/${contact.id}/statement?from=${from}&to=${today}`, { token: F.token })).json;

  const inv = await F.invoice(today, 1000, { currency: "USD", exchangeRate: 3.6725, contactId: contact.id, customerName: "FX Co" });
  const p = await api("POST", `/api/companies/${F.cid}/invoices/${inv.id}/payments`, { token: F.token, body: { amount: 1050, date: today, paymentAccountId: bank.id, exchangeRate: 3.6725 } });
  ok("contact: setup: USD invoice paid in full", p.status === 201, { s: p.status, j: p.json });
  const cn = await F.creditNote(inv.id);
  const cnRow = (await db.query(`SELECT contact_id FROM invoices WHERE id = $1`, [cn.creditNote?.id ?? cn.id])).rows[0];
  ok("contact: the credit note carries the original invoice's contact_id", cnRow?.contact_id === contact.id, cnRow);

  const rf = await F.refund(cn.creditNote?.id ?? cn.id, { amount: 1050, bankAccountId: bank.id, exchangeRate: 3.70, date: today });
  ok("contact: refund at 3.70 accepted", rf.status === 201, { s: rf.status, j: rf.json });
  const refundRow = (await db.query(`SELECT contact_id FROM customer_refunds WHERE company_id = $1`, [F.cid])).rows[0];
  ok("contact: the refund carries the contact_id", refundRow?.contact_id === contact.id, refundRow);
  const st = await statement();
  const bal = await F.balances();
  ok("contact: statement closing balance is 0.00 after a refund at a different rate", close(st?.closingBalance, 0), { closing: st?.closingBalance, lines: st?.lines?.map((l) => `${l.type}:${l.debit}-${l.credit}`) });
  ok("contact: and receivables (1040) is 0.00 in the ledger", close(bal["1040"] ?? 0, 0), bal);
  const refundLine = st?.lines?.find((l) => l.type === "refund");
  ok("contact: the refund is valued at the credit note's rate (3,856.13)", close(refundLine?.debit, 3856.13), refundLine);

  // an older credit note without a contact falls back to the original invoice's contact
  const inv2 = await F.invoice(today, 100, { contactId: contact.id, customerName: "FX Co" });
  await F.pay(inv2.id, 105, today, bank.id);
  const cn2 = await F.creditNote(inv2.id);
  const cn2Id = cn2.creditNote?.id ?? cn2.id;
  await db.query(`UPDATE invoices SET contact_id = NULL WHERE id = $1`, [cn2Id]);
  await F.refund(cn2Id, { amount: 105, bankAccountId: bank.id, date: today });
  const fb = (await db.query(`SELECT contact_id FROM customer_refunds WHERE credit_note_id = $1`, [cn2Id])).rows[0];
  ok("contact: a credit note without a contact falls back to the original invoice's contact", fb?.contact_id === contact.id, fb);

  // refund account: bank or cash only, never receivables or inventory
  const R = await newCompany("refundacct");
  const rbank = await R.account("1020"), ar = await R.account("1040"), stock = await R.account("1070");
  const rinv = await R.invoice(today, 1000);
  await R.pay(rinv.id, 1050, today, rbank.id);
  const rcn = await R.creditNote(rinv.id);
  const rcnId = rcn.creditNote?.id ?? rcn.id;
  let r = await R.refund(rcnId, { amount: 100, bankAccountId: ar.id, date: today });
  ok("refund account: Accounts Receivable (1040) is refused (400)", r.status === 400 && r.json?.code === "INVALID_BANK_ACCOUNT", { s: r.status, j: r.json });
  r = await R.refund(rcnId, { amount: 100, bankAccountId: stock.id, date: today });
  ok("refund account: Inventory (1070) is refused (400)", r.status === 400 && r.json?.code === "INVALID_BANK_ACCOUNT", { s: r.status, j: r.json });
  r = await R.refund(rcnId, { amount: 100, bankAccountId: rbank.id, date: today });
  ok("refund account: the bank account (1020) is accepted (201)", r.status === 201, { s: r.status, j: r.json });
  const cash = await R.account("1010");
  r = await R.refund(rcnId, { amount: 50, bankAccountId: cash.id, date: today });
  ok("refund account: cash on hand (1010) is accepted (201)", r.status === 201, { s: r.status, j: r.json });
}

// ═════════════════════════════════════════════════════════════════════════════
// Aging as of a day
// ═════════════════════════════════════════════════════════════════════════════
const rowOf = (j, type, name) => (j ?? []).find((x) => x.type === type && x.name === name);

async function agingSection() {
  const A = await newCompany("aging");
  const bank = await A.account("1020");

  // PAID: issued 60 days ago, due 30 days ago, paid 10 days ago
  const paid = await A.invoice(day(60), 1000, { customerName: "PaidCo", dueDate: day(30) });
  await A.pay(paid.id, 1050, day(10), bank.id);
  // CREDITED later: issued 50 days ago, due 45 days ago, credit note 5 days ago
  const credited = await A.invoice(day(50), 1000, { customerName: "CreditedCo", dueDate: day(45) });
  await A.creditNote(credited.id, { date: day(5) });
  // VOIDED now: issued 40 days ago, due 35 days ago
  const voided = await A.invoice(day(40), 1000, { customerName: "VoidedCo", dueDate: day(35) });
  const vr = await api("PATCH", `/api/invoices/${voided.id}/status`, { token: A.token, body: { status: "void", date: today } });
  ok("aging: setup: invoice voided today", vr.status === 200, { s: vr.status, j: vr.json });
  // OPEN: issued 90 days ago, due 45 days ago, never paid
  await A.invoice(day(90), 1000, { customerName: "OpenCo", dueDate: day(45) });
  // NOT YET ISSUED at the early as-of: issued 15 days ago
  await A.invoice(day(15), 500, { customerName: "LateCo", dueDate: day(1) });

  // PAID: payment dated 10 days ago, not created_at (which is today)
  let r = await A.aging(day(20));
  ok("aging: asOf before the payment date shows the invoice outstanding (1,050, 1-30 days overdue)",
    r.status === 200 && close(rowOf(r.json, "receivable", "PaidCo")?.total, 1050) && close(rowOf(r.json, "receivable", "PaidCo")?.days30, 1050),
    rowOf(r.json, "receivable", "PaidCo"));
  ok("aging: asOf before the credit note shows its invoice at the full 1,050 (25 days overdue)",
    close(rowOf(r.json, "receivable", "CreditedCo")?.total, 1050) && close(rowOf(r.json, "receivable", "CreditedCo")?.days30, 1050), rowOf(r.json, "receivable", "CreditedCo"));
  ok("aging: asOf before the void still counts the voided invoice (voided today)", close(rowOf(r.json, "receivable", "VoidedCo")?.total, 1050), rowOf(r.json, "receivable", "VoidedCo"));
  ok("aging: an invoice issued after asOf is not there", !rowOf(r.json, "receivable", "LateCo"), rowOf(r.json, "receivable", "LateCo"));
  ok("aging: the open invoice (due 45 days ago) is 25 days past due as of 20 days ago", close(rowOf(r.json, "receivable", "OpenCo")?.total, 1050), rowOf(r.json, "receivable", "OpenCo"));

  const omitted0 = await A.aging();
  r = await A.aging(day(5));
  ok("aging: asOf after the payment date shows it paid (no row)", !rowOf(r.json, "receivable", "PaidCo"), rowOf(r.json, "receivable", "PaidCo"));
  ok("aging: asOf the payment day itself counts the payment", !rowOf((await A.aging(day(10))).json, "receivable", "PaidCo"), null);
  ok("aging: the day before the payment still shows it", !!rowOf((await A.aging(day(11))).json, "receivable", "PaidCo"), null);
  ok("aging: a credit note dated that day is counted (asOf = its date)", !rowOf(r.json, "receivable", "CreditedCo"), rowOf(r.json, "receivable", "CreditedCo"));
  ok("aging: the voided invoice is gone from asOf = the void day", !rowOf((await A.aging(today)).json, "receivable", "VoidedCo"), null);
  const late5 = rowOf((await A.aging(day(5))).json, "receivable", "LateCo");
  ok("aging: the late invoice (issued 15 days ago, due yesterday) is Current as of 5 days ago, a day past due today",
    close(late5?.current, 525) && close(rowOf(omitted0.json, "receivable", "LateCo")?.days30, 525), { late5, today: rowOf(omitted0.json, "receivable", "LateCo") });

  // omitted == today for what is open
  const omitted = await A.aging();
  const asToday = await A.aging(today);
  ok("aging: asOf omitted answers like asOf = today (same rows and amounts)",
    omitted.status === 200 && JSON.stringify(omitted.json) === JSON.stringify(asToday.json), { omitted: omitted.json, today: asToday.json });
  ok("aging: and shows only the invoices still open today (OpenCo, LateCo)",
    omitted.json.filter((x) => x.type === "receivable").map((x) => x.name).sort().join() === "LateCo,OpenCo", omitted.json);

  // validation
  r = await A.aging("2026-13-45");
  ok("aging: a bad asOf is refused (400 INVALID_AS_OF)", r.status === 400 && r.json?.code === "INVALID_AS_OF", { s: r.status, j: r.json });
  r = await A.aging(day(-2));
  ok("aging: a future asOf is refused (400 AS_OF_IN_FUTURE)", r.status === 400 && r.json?.code === "AS_OF_IN_FUTURE", { s: r.status, j: r.json });

  // ── payables ──────────────────────────────────────────────────────────────
  const mk = await api("POST", `/api/companies/${A.cid}/bills`, {
    token: A.token, body: { vendor_name: "Supplier", bill_date: day(60), due_date: day(30), currency: "AED", line_items: [{ description: "Goods", quantity: 1, unit_price: 1000, vat_rate: 0.05 }] },
  });
  const billId = mk.json?.id;
  const ap = await api("POST", `/api/bills/${billId}/approve`, { token: A.token, body: {} });
  ok("aging: setup: bill approved", !!billId && [200, 201].includes(ap.status), { s: ap.status, j: ap.json });
  const bp = await api("POST", `/api/bills/${billId}/payments`, { token: A.token, body: { payment_date: day(10), amount: 1050 } });
  ok("aging: setup: bill paid 10 days ago", [200, 201].includes(bp.status), { s: bp.status, j: bp.json });
  r = await A.aging(day(20));
  const bill20 = rowOf(r.json, "payable", "Supplier");
  ok("aging: payables as of 20 days ago: the bill is outstanding (1,050, 1-30 overdue)", close(bill20?.total, 1050) && close(bill20?.days30, 1050), bill20);
  r = await A.aging(day(5));
  ok("aging: payables as of 5 days ago: paid", !rowOf(r.json, "payable", "Supplier"), rowOf(r.json, "payable", "Supplier"));
  r = await A.aging();
  ok("aging: payables with asOf omitted: paid", !rowOf(r.json, "payable", "Supplier"), r.json);
  const card = await api("GET", `/api/companies/${A.cid}/bills/aging?asOf=${day(20)}`, { token: A.token });
  ok("aging: the Bill Pay aging card as of 20 days ago counts the bill (1-30, 1 bill)", card.status === 200 && close(card.json?.days_1_30?.amount, 1050) && card.json?.days_1_30?.count === 1, card.json);
  const card2 = await api("GET", `/api/companies/${A.cid}/bills/aging?asOf=${day(5)}`, { token: A.token });
  const card3 = await api("GET", `/api/companies/${A.cid}/bills/aging`, { token: A.token });
  ok("aging: the card as of 5 days ago and with asOf omitted are both empty", card2.status === 200 && card3.status === 200 && close(card2.json?.days_1_30?.amount, 0) && close(card3.json?.days_1_30?.amount, 0), { a: card2.json, b: card3.json });
}

// Payables ageing equals A/P in the ledger: credits count from their own date, unapplied ones show as negatives.
async function payablesAgingWithCredits() {
  const A = await newCompany("agingcredit");
  const mkBill = await api("POST", `/api/companies/${A.cid}/bills`, {
    token: A.token, body: { vendor_name: "Supplier", bill_date: prevMid, due_date: prevMid, currency: "AED", line_items: [{ description: "Goods", quantity: 1, unit_price: 1000, vat_rate: 0.05 }] },
  });
  const billId = mkBill.json?.id;
  await api("POST", `/api/bills/${billId}/approve`, { token: A.token, body: {} });
  const credit = await api("POST", `/api/companies/${A.cid}/vendor-credits`, {
    token: A.token, body: { vendor_name: "Supplier", date: prevMid, line_items: [{ description: "Return", quantity: 1, unit_price: 400, vat_rate: 0.05 }] },
  });
  await api("POST", `/api/companies/${A.cid}/vendor-credits/${credit.json?.id}/approve`, { token: A.token, body: {} });
  const ledgerAp = (await A.balances())["2010"];
  ok("payables aging: setup: A/P in the ledger is 630 (1,050 bill - 420 approved credit)", close(ledgerAp, -630), ledgerAp);

  const rows = async (asOf) => ((await A.aging(asOf)).json ?? []).filter((x) => x.type === "payable");
  const total = (list) => list.reduce((sum, x) => sum + n(x.total), 0);
  let d = await rows();
  ok("payables aging: default total is 630 (bill 1,050 less the unapplied credit 420)", close(total(d), 630), d);
  let e = await rows(prevEnd);
  ok("payables aging: as of the end of last month the total is 630", close(total(e), 630), e);
  const card = await api("GET", `/api/companies/${A.cid}/bills/aging`, { token: A.token });
  const cardTotal = ["current", "days_1_30", "days_31_60", "days_61_90", "days_90_plus"].reduce((sum, k) => sum + n(card.json?.[k]?.amount), 0);
  ok("payables aging: the Bill Pay aging card total is 630 too, counting only the bill", close(cardTotal, 630) && ["current", "days_1_30", "days_31_60", "days_61_90", "days_90_plus"].reduce((sum, k) => sum + n(card.json?.[k]?.count), 0) === 1, card.json);
  const cardAsOf = await api("GET", `/api/companies/${A.cid}/bills/aging?asOf=${prevEnd}`, { token: A.token });
  ok("payables aging: the card as of last month end is 630 as well", close(["current", "days_1_30", "days_31_60", "days_61_90", "days_90_plus"].reduce((sum, k) => sum + n(cardAsOf.json?.[k]?.amount), 0), 630), cardAsOf.json);
  const early = await rows(addDay(prevMid, -1));
  ok("payables aging: the day before the bill and credit existed nothing is owed", early.length === 0, early);

  const applied = await api("POST", `/api/companies/${A.cid}/vendor-credits/${credit.json?.id}/apply`, { token: A.token, body: { bill_id: billId, amount: 420 } });
  ok("payables aging: setup: credit applied today", applied.status === 200, { s: applied.status, j: applied.json });
  e = await rows(prevEnd);
  ok("payables aging: applying it today leaves the end-of-last-month total at 630 and the bill row shows 630", close(total(e), 630) && close(e.find((x) => x.name === "Supplier")?.total, 630), e);
  d = await rows();
  ok("payables aging: default total after applying is still 630", close(total(d), 630), d);
  ok("payables aging: and equals A/P in the ledger", close(total(d), -(await A.balances())["2010"]), { total: total(d), ap: (await A.balances())["2010"] });
}

function addDay(ymdStr, n) { return ymd(new Date(Date.parse(ymdStr + "T00:00:00Z") + n * 86400000)); }

main().catch((e) => { console.error(e); process.exit(1); });
