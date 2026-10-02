// Integration tests for the Phase 9 teardown 7 (blind re-verification) fixes, server side: refunds, emirate, stock dates, credit note reason, numbering.
// Live requests against a running server + Postgres; start the server with PAYMENT_GATEWAY_FAKE=1.
//   BASE_URL=http://localhost:5071 DATABASE_URL=... node tests/integration/phase9-teardown7-t1.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.
//
import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, p, { body, token, raw, headers: extra } = {}) {
  const headers = { "Content-Type": "application/json", ...(extra || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)), signal: AbortSignal.timeout(60_000) });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
async function pdfText(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const parts = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const item of content.items) if (item.str.trim() !== "") parts.push(item.str);
  }
  return parts.join(" ");
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const today = ymd(now);
const addDays = (iso, days) => ymd(new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000));
let db;

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json;
  const acct = (code) => accounts.find((a) => a.code === code);
  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = r2(row.net);
    return out;
  };
  const entryOf = async (source, sourceId) => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit) AS dr, SUM(jl.credit) AS cr FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = $2 AND je.source_id = $3 GROUP BY a.code`, [cid, source, sourceId])).rows;
    const out = {};
    for (const row of rows) out[row.code] = { dr: r2(row.dr), cr: r2(row.cr) };
    return out;
  };
  const contact = async (extra = {}) => {
    const r = await api("POST", `/api/companies/${cid}/customer-contacts`, { token, body: { name: "Buyer " + Math.random().toString(36).slice(2, 6), email: `b_${Math.random().toString(36).slice(2, 8)}@example.com`, ...extra } });
    if (!r.json?.id) throw new Error("contact failed " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const draft = async (body) => {
    const r = await api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "Buyer", date: today, dueDate: today, ...body } });
    if (!r.json?.id) throw new Error("invoice failed " + r.status + " " + r.text.slice(0, 300));
    return r.json;
  };
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });
  const vat201 = async (from, to) => (await api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: from, periodEnd: to } })).json;
  const getInvoice = async (id) => (await api("GET", `/api/invoices/${id}`, { token })).json;
  return { token, cid, userId, acct, balances, entryOf, contact, draft, issue, vat201, getInvoice };
}


// ───────── #1: a refund of a credit balance is a payment-side event, never a second credit note ─────────
async function refundIsPaymentSide() {
  const C = await newCompany("t7ref");
  const { token, cid } = C;
  const bank = C.acct("1020").id;
  const cust = await C.contact({ name: "Emirates Towers " + rnd });
  // The report's invoice: 400 x 35 less a 5% line discount, plus 200 shipping = 13,500 net, 675 VAT, 14,175 gross.
  const inv = await C.draft({ contactId: cust.id, customerName: cust.name, lines: [
    { description: "Cement", quantity: 400, unitPrice: 35, vatRate: 0.05, discountType: "percent", discountValue: 5 },
    { description: "Delivery", quantity: 1, unitPrice: 200, vatRate: 0.05, lineKind: "shipping" },
  ] });
  await C.issue(inv.id);
  const paid = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token, body: { amount: 14175, date: today, method: "bank", paymentAccountId: bank } });
  ok("T7-1 the invoice (14,175) is paid in full", paid.status === 201, paid.text?.slice(0, 200));

  const none = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payment-refunds`, { token, body: { amount: 100, date: today, bankAccountId: bank } });
  ok("T7-1 refunding a paid invoice with no credit note is refused (422 NO_CREDIT_BALANCE) and issues nothing", none.status === 422 && none.json?.code === "NO_CREDIT_BALANCE" && (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'credit_note'`, [cid])).rows[0].n === 0, { s: none.status, t: none.text?.slice(0, 200) });

  // 20 bags back: 665 net + 33.25 VAT = 698.25
  const cn = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: today, reason: "returned, damaged packaging", lines: [{ description: "20 bags", quantity: 20, unitPrice: 33.25, vatRate: 0.05 }] } });
  ok("T7-1 the credit note (698.25) is issued", cn.status === 201 || cn.status === 200, cn.text?.slice(0, 200));
  const cnId = cn.json?.id ?? cn.json?.creditNote?.id;
  let bal = await C.balances();
  ok("T7-1 the customer holds a 698.25 credit inside 1040", close(bal["1040"], -698.25), bal);

  const refund = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payment-refunds`, { token, body: { amount: 698.25, date: today, bankAccountId: bank, reference: "RF-T7" } });
  ok("T7-1 the refund of 698.25 is accepted", refund.status === 201, refund.text?.slice(0, 300));
  const cns = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'credit_note'`, [cid])).rows[0].n;
  ok("T7-1 no second credit note was issued", cns === 1, cns);
  bal = await C.balances();
  ok("T7-1 sales fell by 665 once and output VAT by 33.25 once (2020 = 641.75)", close(bal["2020"], -641.75), { v: bal["2020"] });
  ok("T7-1 the refund posted Dr 1040 / Cr bank 698.25 and AR is 0", close(bal["1040"], 0), bal);
  const rj = await C.entryOf("customer_refund", refund.json?.refund?.id);
  ok("T7-1 the refund entry is Dr 1040 698.25 / Cr 1020 698.25 and touches no revenue or VAT", close(rj["1040"]?.dr, 698.25) && close(rj["1020"]?.cr, 698.25) && !rj["4010"] && !rj["2020"], rj);
  const boxes = await C.vat201(addDays(today, -30), today);
  ok("T7-1 the VAT return's output tax is 641.75 (one credit note), box 14 payable 641.75", close(boxes?.box14PayableTax, 641.75), { b14: boxes?.box14PayableTax });
  const aging = (await api("GET", `/api/reports/${cid}/aging`, { token })).json ?? [];
  const ageingTotal = r2(aging.filter((r) => r.type === "receivable").reduce((a, r) => a + n(r.total), 0));
  ok("T7-1 AR in the ledger equals the receivables ageing", close(ageingTotal, bal["1040"] ?? 0), { ageingTotal, gl: bal["1040"] });

  // the refund is listed with the payments and can be voided from there
  const list = await api("GET", `/api/companies/${cid}/invoices/${inv.id}/payment-refunds`, { token });
  const row = list.json?.refunds?.[0];
  ok("T7-1 the payments list shows the refund with its credit note", list.status === 200 && row && close(row.amount, 698.25) && row.creditNoteId === cnId && !row.voidedAt, list.text?.slice(0, 300));
  const credit0 = await api("GET", `/api/companies/${cid}/customers/${cust.id}/credit`, { token });
  ok("T7-1 the customer credit endpoint shows the refund and the balance equals the invoice's refundable amount (0 after refund)", credit0.status === 200 && close(credit0.json?.balance?.available, 0) && credit0.json?.refunds?.some((r) => close(r.amount, 698.25) && r.refundDate), credit0.text?.slice(0, 300));
  const blocked = await api("PATCH", `/api/invoices/${cnId}/status`, { token, body: { status: "void" } });
  ok("T7-1 the credit note cannot be voided while a refund stands", blocked.status === 409, { s: blocked.status, t: blocked.text?.slice(0, 160) });
  const voided = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payment-refunds/${row?.id}/void`, { token });
  bal = await C.balances();
  ok("T7-1 voiding the refund reverses its journal and restores the credit (1040 = -698.25)", voided.status === 200 && close(bal["1040"], -698.25), { s: voided.status, bal1040: bal["1040"], t: voided.text?.slice(0, 160) });
  const credit1 = await api("GET", `/api/companies/${cid}/customers/${cust.id}/credit`, { token });
  ok("T7-1 the customer credit endpoint includes the credit the credit note left (698.25 = the invoice's refundable)", close(credit1.json?.balance?.available, 698.25) && close(credit1.json?.balance?.creditNoteCredit, 698.25), credit1.text?.slice(0, 300));
  const viaCustomer = await api("POST", `/api/companies/${cid}/customers/${cust.id}/credit-refunds`, { token, body: { amount: 698.25, date: today, bankAccountId: bank } });
  const cr = credit1.json?.refunds?.[0];
  ok("T7-1 the customer's Refund credit dialog path pays it back (against the credit note, no new credit note)", viaCustomer.status === 201 && (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'credit_note'`, [cid])).rows[0].n === 1, { s: viaCustomer.status, t: viaCustomer.text?.slice(0, 200) });
  const credit2 = await api("GET", `/api/companies/${cid}/customers/${cust.id}/credit`, { token });
  const live = credit2.json?.refunds?.find((r) => !r.voidedAt);
  const voidViaCustomer = await api("POST", `/api/companies/${cid}/customers/${cust.id}/credit-refunds/${live?.id}/void`, { token });
  ok("T7-1 the customer's void path voids a credit-note refund too (credit back to 698.25)", voidViaCustomer.status === 200 && close((await api("GET", `/api/companies/${cid}/customers/${cust.id}/credit`, { token })).json?.balance?.available, 698.25), { s: voidViaCustomer.status, t: voidViaCustomer.text?.slice(0, 200) });
  void cr;
  const list2 = await api("GET", `/api/companies/${cid}/invoices/${inv.id}/payment-refunds`, { token });
  ok("T7-1 the voided refund shows voided and the credit is refundable again", !!list2.json?.refunds?.[0]?.voidedAt && close(list2.json?.refundable, 698.25), list2.text?.slice(0, 200));
  const voidCn = await api("PATCH", `/api/invoices/${cnId}/status`, { token, body: { status: "void" } });
  ok("T7-1 the credit note can now be voided", voidCn.status === 200, { s: voidCn.status, t: voidCn.text?.slice(0, 200) });
  bal = await C.balances();
  ok("T7-1 after voiding it AR is 0 and output VAT is back to 675", close(bal["1040"], 0) && close(bal["2020"], -675), bal);
  const other = await newCompany("t7ref2");
  const foreign = await api("GET", `/api/companies/${cid}/invoices/${inv.id}/payment-refunds`, { token: other.token });
  ok("T7-1 another company cannot read the invoice's refunds", foreign.status === 403, foreign.status);
}

// ───────── #7: the credit note reason prints; #5-numbering ─────────
async function creditNoteReasonAndNumbering() {
  const C = await newCompany("t7pdf");
  const { token, cid } = C;
  const cust = await C.contact();
  const next = await api("GET", `/api/companies/${cid}/invoices/next-number`, { token });
  ok("T7-8 the next invoice number is the next sequence number, not a timestamp", next.status === 200 && /^INV-\d{4}-\d{5}$/.test(next.json?.number || "") && !/\d{9,}/.test(next.json?.number || ""), next.text?.slice(0, 120));
  const inv = await C.draft({ contactId: cust.id, customerName: cust.name, number: "INV-1790954137194", lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
  ok("T7-8 the created invoice carries exactly the number the form showed", inv.number === next.json?.number, { got: inv.number, shown: next.json?.number });
  await C.issue(inv.id);
  const cn = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: today, reason: "returned, damaged packaging", lines: [{ description: "Returned", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  const cnId = cn.json?.id ?? cn.json?.creditNote?.id;
  const pdf = await api("GET", `/api/invoices/${cnId}/pdf`, { token, raw: true });
  const text = await pdfText(pdf.buf);
  ok("T7-7 the credit note PDF prints the reason (EN/AR label)", /Reason for issue/.test(text) && /returned, damaged packaging/.test(text), text.slice(0, 400));
  const row = (await db.query(`SELECT credit_note_reason FROM invoices WHERE id = $1`, [cnId])).rows[0];
  ok("T7-7 the reason is stored on the credit note", row?.credit_note_reason === "returned, damaged packaging", row);
  const invPdf = await pdfText((await api("GET", `/api/invoices/${inv.id}/pdf`, { token, raw: true })).buf);
  ok("T7-7 an invoice PDF has no reason line", !/Reason for issue/.test(invPdf), null);
  const paid = await api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "paid", paymentAccountId: C.acct("1020").id } });
  ok("T7-8 status Paid is refused by the server (400 STATUS_DERIVED)", paid.status === 400 && paid.json?.code === "STATUS_DERIVED", paid.status);
}

// ───────── #2: emirate per supply ─────────
async function emiratePerSupply() {
  const C = await newCompany("t7em");
  const { token, cid } = C;
  const bad = await api("POST", `/api/companies/${cid}/customer-contacts`, { token, body: { name: "Bad " + rnd, emirate: "narnia" } });
  ok("T7-2 an unknown emirate on a contact is refused (422 INVALID_EMIRATE)", bad.status === 422 && bad.json?.code === "INVALID_EMIRATE", { s: bad.status, t: bad.text?.slice(0, 160) });
  const dxb = await C.contact({ emirate: "dubai" });
  ok("T7-2 a contact stores its emirate", dxb.emirate === "dubai", dxb);
  const upd = await api("PUT", `/api/companies/${cid}/customer-contacts/${dxb.id}`, { token, body: { emirate: "abu_dhabi" } });
  ok("T7-2 a contact's emirate can be changed", upd.status === 200 && upd.json?.emirate === "abu_dhabi", upd.text?.slice(0, 160));
  await api("PUT", `/api/companies/${cid}/customer-contacts/${dxb.id}`, { token, body: { emirate: "dubai" } });
  const plain = await C.contact();
  ok("T7-2 a contact without one has none", plain.emirate === null || plain.emirate === undefined, plain.emirate);

  const lines = [{ description: "Goods", quantity: 1, unitPrice: 1000, vatRate: 0.05 }];
  const fromContact = await C.draft({ contactId: dxb.id, customerName: dxb.name, lines });
  ok("T7-2 an invoice takes the contact's emirate", fromContact.emirate === "dubai", fromContact.emirate);
  const override = await C.draft({ contactId: dxb.id, customerName: dxb.name, emirate: "ajman", lines });
  ok("T7-2 the body's emirate wins", override.emirate === "ajman", override.emirate);
  const none = await C.draft({ contactId: plain.id, customerName: plain.name, lines });
  ok("T7-2 neither: null (the company's emirate applies)", none.emirate === null || none.emirate === undefined, none.emirate);
  const badInv = await api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "x", date: today, dueDate: today, emirate: "gotham", lines } });
  ok("T7-2 an unknown invoice emirate is refused", badInv.status === 422 && badInv.json?.code === "INVALID_EMIRATE", { s: badInv.status });

  const put = await api("PUT", `/api/invoices/${none.id}`, { token, body: { customerName: plain.name, contactId: plain.id, date: today, dueDate: today, emirate: "fujairah", lines } });
  ok("T7-2 a draft's emirate is editable", put.status === 200 && (await C.getInvoice(none.id)).emirate === "fujairah", { s: put.status, t: put.text?.slice(0, 200) });
  await C.issue(none.id);
  const locked = await api("PUT", `/api/invoices/${none.id}`, { token, body: { customerName: plain.name, contactId: plain.id, date: today, dueDate: today, emirate: "dubai", lines } });
  ok("T7-2 an issued invoice's emirate cannot be changed (409 EMIRATE_LOCKED)", locked.status === 409 && locked.json?.code === "EMIRATE_LOCKED", { s: locked.status, c: locked.json?.code, t: locked.text?.slice(0, 120) });

  // a draft created without an emirate (as a quote conversion is) takes the contact's at issue
  const bare = await C.draft({ contactId: dxb.id, customerName: dxb.name, lines });
  await db.query(`UPDATE invoices SET emirate = NULL WHERE id = $1`, [bare.id]);
  await C.issue(bare.id);
  ok("T7-2 issuing a draft with no emirate fills it from the contact", (await C.getInvoice(bare.id)).emirate === "dubai", (await C.getInvoice(bare.id)).emirate);

  await C.issue(fromContact.id);
  const cn = await api("POST", `/api/companies/${cid}/invoices/${fromContact.id}/credit-note`, { token, body: { date: today, lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  const cnRow = (await db.query(`SELECT emirate FROM invoices WHERE id = $1`, [cn.json?.id ?? cn.json?.creditNote?.id])).rows[0];
  ok("T7-2 a credit note copies its invoice's emirate", cnRow?.emirate === "dubai", cnRow);

  const emPdf = await pdfText((await api("GET", `/api/invoices/${fromContact.id}/pdf`, { token, raw: true })).buf);
  ok("T7-2 the invoice PDF prints the place of supply under the customer", /Place of supply/.test(emPdf) && /Dubai/.test(emPdf), emPdf.slice(0, 300));
  const spec = await fetch(BASE + "/api/v1/openapi.json");
  const specText = await spec.text();
  ok("T7-2 the API v1 schemas expose emirate (contacts and invoices)", spec.status === 200 && (specText.match(/"emirate"/g) || []).length >= 4, (specText.match(/"emirate"/g) || []).length);
}

// ───────── #5: stock movements take the document's date ─────────
async function stockMovementDates() {
  const C = await newCompany("t7stk");
  const { token, cid } = C;
  await api("PATCH", `/api/companies/${cid}/preferences`, { token, body: { inventoryCostingEnabled: true } });
  const cust = await C.contact();
  const product = (await api("POST", `/api/companies/${cid}/products`, { token, body: { name: "CEM " + rnd, unitPrice: "35", costPrice: "20", vatRate: "5", unit: "bag", currentStock: 100, trackInventory: true } })).json;
  const invDay = addDays(today, -10);
  const inv = await C.draft({ contactId: cust.id, customerName: cust.name, date: invDay, dueDate: addDays(invDay, 30), lines: [{ description: "Cement", quantity: 10, unitPrice: 35, vatRate: 0.05, productId: product.id }] });
  await C.issue(inv.id);
  const sale = (await db.query(`SELECT to_char(movement_date, 'YYYY-MM-DD') AS d, to_char(created_at, 'YYYY-MM-DD') AS created FROM inventory_movements WHERE source_invoice_id = $1 AND type = 'sale'`, [inv.id])).rows[0];
  ok("T7-5 the sale's stock movement is dated the invoice date, not the day the status changed", sale?.d === invDay, sale);
  const cnDay = addDays(today, -4);
  const cn = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: cnDay, restock: true } });
  ok("T7-5 the credit note with restock is issued", cn.status === 201 || cn.status === 200, cn.text?.slice(0, 200));
  const back = (await db.query(`SELECT to_char(movement_date, 'YYYY-MM-DD') AS d FROM inventory_movements WHERE source_invoice_id = $1 AND type = 'return'`, [inv.id])).rows[0];
  ok("T7-5 the restock movement is dated the credit note date", back?.d === cnDay, back);
  const cogs = (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE company_id = $1 AND source = 'inventory_cogs' ORDER BY created_at`, [cid])).rows.map((r) => r.d);
  ok("T7-5 the COGS entries carry the same two dates", cogs[0] === invDay && cogs[1] === cnDay, cogs);
  const list = await api("GET", `/api/companies/${cid}/inventory-movements`, { token });
  ok("T7-5 the movements API exposes movementDate", list.status === 200 && list.json.every((m) => "movementDate" in m), list.text?.slice(0, 160));
}

// ───────── addendum: customer credit in the ageing; foreign-currency invoices ─────────
async function creditInAgeingAndForeignCurrency() {
  const C = await newCompany("t7cr");
  const { token, cid } = C;
  const bank = C.acct("1020").id;
  ok("T7-a account 2050 is named Customer Credit", /customer credit/i.test(C.acct("2050")?.nameEn || ""), C.acct("2050")?.nameEn);
  const cust = await C.contact({ name: "Overpayer " + rnd });
  const inv = await C.draft({ contactId: cust.id, customerName: cust.name, lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
  await C.issue(inv.id);
  await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token, body: { amount: 1250, date: today, method: "bank", paymentAccountId: bank, allowCredit: true } });
  const bal = await C.balances();
  const aging = (await api("GET", `/api/reports/${cid}/aging`, { token })).json ?? [];
  const rec = aging.filter((r) => r.type === "receivable");
  const total = r2(rec.reduce((a, r) => a + n(r.total), 0));
  ok("T7-a the overpayment is a negative line for the customer in the receivables ageing", rec.some((r) => /Overpayer/.test(r.name) && close(r.total, -200)), rec);
  ok("T7-a ageing = AR 1040 + customer credit 2050 (-200)", close(total, r2((bal["1040"] ?? 0) + (bal["2050"] ?? 0))), { total, ar: bal["1040"], credit: bal["2050"] });
  await api("POST", `/api/companies/${cid}/customers/${cust.id}/credit-refunds`, { token, body: { amount: 200, date: today, bankAccountId: bank } });
  const aging2 = (await api("GET", `/api/reports/${cid}/aging`, { token })).json ?? [];
  ok("T7-a after refunding the credit the ageing line is gone", !aging2.some((r) => /Overpayer/.test(r.name)), aging2);

  // foreign currency from the invoice screen: currency + rate on create/update, rate defaulted from the rate table
  await api("POST", `/api/companies/${cid}/exchange-rates`, { token, body: { fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: addDays(today, -30) } });
  const usd = await C.draft({ contactId: cust.id, customerName: cust.name, currency: "USD", lines: [{ description: "Licence", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
  ok("T7-b a USD invoice is created with the rate defaulted from the rate table", usd.currency === "USD" && close(usd.exchangeRate, 3.6725) && close(usd.baseCurrencyAmount, 3856.13, 0.01), { c: usd.currency, r: usd.exchangeRate, base: usd.baseCurrencyAmount });
  const own = await C.draft({ contactId: cust.id, customerName: cust.name, currency: "USD", exchangeRate: 3.7, lines: [{ description: "Licence", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
  ok("T7-b an explicit rate on the invoice is kept", close(own.exchangeRate, 3.7), own.exchangeRate);
  const upd = await api("PUT", `/api/invoices/${usd.id}`, { token, body: { customerName: cust.name, contactId: cust.id, date: today, dueDate: today, currency: "USD", exchangeRate: 3.68, lines: [{ description: "Licence", quantity: 1, unitPrice: 2000, vatRate: 0.05 }] } });
  const after = await C.getInvoice(usd.id);
  ok("T7-b updating currency and rate re-prices the AED value (2,100 USD x 3.68)", upd.status === 200 && close(after.exchangeRate, 3.68) && close(after.baseCurrencyAmount, 7728, 0.01), { s: upd.status, r: after.exchangeRate, base: after.baseCurrencyAmount, t: upd.text?.slice(0, 160) });
  await C.issue(usd.id);
  const b2 = await C.balances();
  const je = await C.entryOf("invoice", usd.id);
  ok("T7-b the issued USD invoice posts AED values (Dr 1040 7,728)", close(je["1040"]?.dr, 7728), je);
  const noRate = await api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "x", date: today, dueDate: today, currency: "EUR", lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.05 }] } });
  ok("T7-b a currency with no rate and none supplied is refused (422 NO_EXCHANGE_RATE)", noRate.status === 422 && noRate.json?.code === "NO_EXCHANGE_RATE", { s: noRate.status, c: noRate.json?.code });
  void b2;
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    const sections = { refundIsPaymentSide, creditNoteReasonAndNumbering, emiratePerSupply, stockMovementDates, creditInAgeingAndForeignCurrency };
    for (const [name, fn] of Object.entries(sections)) {
      if (only && !only.includes(name)) continue;
      try { await fn(); } catch (e) { fail++; fails.push(name + " threw " + e.message); console.log("FAIL  " + name + " threw " + e.stack); }
    }
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}
main();
