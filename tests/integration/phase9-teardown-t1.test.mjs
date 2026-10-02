// Integration tests for the Phase 9 teardown t1 fixes (server side of documents and inventory).
// Live requests against a running server + Postgres; start the server with PAYMENT_GATEWAY_FAKE=1.
//   BASE_URL=http://localhost:5071 DATABASE_URL=... node tests/integration/phase9-teardown-t1.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.
//
// THE DOCUMENT-DATE CONTRACT (F1) the clients follow: every document date is sent as a calendar day "YYYY-MM-DD"
// (what the picker shows) or as an ISO instant, which the server converts to the UAE calendar day.

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

// ───────────────────────────── F1: document dates ─────────────────────────────
async function documentDates() {
  const C = await newCompany("dates");
  const lines = [{ description: "Boundary sale", quantity: 1, unitPrice: 1000, vatRate: 0.05 }];
  // 2026-10-01 from a +04:00 browser (local midnight is the previous day 20:00Z), from a UTC client and as a plain day
  const forms = {
    "+04:00 client (2026-09-30T20:00:00.000Z)": "2026-09-30T20:00:00.000Z",
    "UTC client (2026-10-01T00:00:00.000Z)": "2026-10-01T00:00:00.000Z",
    "calendar day (2026-10-01)": "2026-10-01",
    "no-offset datetime (2026-10-01T00:00:00)": "2026-10-01T00:00:00",
  };
  const made = [];
  for (const [label, date] of Object.entries(forms)) {
    const inv = await C.draft({ date, dueDate: date, lines });
    const row = (await db.query(`SELECT date::date::text AS d, to_char(due_date, 'YYYY-MM-DD') AS due FROM invoices WHERE id = $1`, [inv.id])).rows[0];
    ok(`F1 invoice from a ${label} is stored on 2026-10-01 (document and due date)`, row.d === "2026-10-01" && row.due === "2026-10-01", row);
    const iss = await C.issue(inv.id);
    const je = (await db.query(`SELECT date::date::text AS d FROM journal_entries WHERE source = 'invoice' AND source_id = $1`, [inv.id])).rows[0];
    ok(`F1 its journal entry is dated 2026-10-01 (${label})`, iss.status === 200 && je?.d === "2026-10-01", { s: iss.status, je });
    made.push(inv);
  }
  const q3 = await C.vat201("2026-07-01", "2026-09-30");
  const q4 = await C.vat201("2026-10-01", "2026-12-31");
  ok("F1 the four boundary sales are in Q4 (VAT 201 4,000 / 200), not Q3", close(q4.box1bDubaiAmount, 4000) && close(q4.box1bDubaiVat, 200) && close(q3.box1bDubaiAmount, 0), { q4: q4.box1bDubaiAmount, q3: q3.box1bDubaiAmount });
  const vs = await api("GET", `/api/companies/${C.cid}/reports/vat-summary?startDate=2026-10-01&endDate=2026-10-31`, { token: C.token });
  const vsSep = await api("GET", `/api/companies/${C.cid}/reports/vat-summary?startDate=2026-09-01&endDate=2026-09-30`, { token: C.token });
  const sales = (j) => n(j?.sales?.subtotal ?? j?.salesSubtotal ?? j?.totalSales ?? j?.sales?.total);
  ok("F1 the VAT summary agrees: October has the sales, September none", sales(vs.json) > 0 && sales(vsSep.json) === 0, { oct: vs.text?.slice(0, 160), sep: vsSep.text?.slice(0, 160) });
  const pl = await api("GET", `/api/companies/${C.cid}/financial-statements/profit-loss?startDate=2026-10-01&endDate=2026-10-31`, { token: C.token });
  const plSep = await api("GET", `/api/companies/${C.cid}/financial-statements/profit-loss?startDate=2026-09-01&endDate=2026-09-30`, { token: C.token });
  const rev = (j) => n(j?.revenue);
  ok("F1 the P&L agrees with the VAT return: revenue 4,000 in October, 0 in September", rev(pl.json) === 4000 && rev(plSep.json) === 0, { oct: pl.text?.slice(0, 200), sep: plSep.text?.slice(0, 200) });

  // the same contract on the other documents
  const cust = await C.contact();
  const q = await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Q", contactId: cust.id, date: "2026-09-30T20:00:00.000Z", expiryDate: "2026-10-31T20:00:00.000Z", lines } });
  const qrow = (await db.query(`SELECT date::date::text AS d, expiry_date::date::text AS e FROM quotes WHERE id = $1`, [q.json?.id])).rows[0];
  ok("F1 a quote sent from a +04:00 client keeps its day (date and valid-until)", qrow?.d === "2026-10-01" && qrow?.e === "2026-11-01", qrow);
  const so = await api("POST", `/api/companies/${C.cid}/sales-orders`, { token: C.token, body: { contactId: cust.id, date: "2026-09-30T20:00:00.000Z", lines } });
  ok("F1 a sales order accepts an instant and stores the UAE day", so.status === 201 && String(so.json?.date).startsWith("2026-10-01"), so.text?.slice(0, 160));
  const adv = await api("POST", `/api/companies/${C.cid}/customer-advances`, { token: C.token, body: { contactId: cust.id, date: "2026-09-30T20:00:00.000Z", amount: 105 } });
  const advRow = (await db.query(`SELECT date::date::text AS d FROM invoices WHERE id = $1`, [adv.json?.invoice?.id])).rows[0];
  ok("F1 an advance accepts an instant and stores the UAE day", adv.status === 201 && advRow?.d === "2026-10-01", { s: adv.status, advRow });
  const jr = await api("POST", `/api/companies/${C.cid}/journal`, { token: C.token, body: { date: "2026-09-30T20:00:00.000Z", memo: "Manual", status: "posted", lines: [{ accountId: C.acct("1010").id, debit: 10, credit: 0, description: "x" }, { accountId: C.acct("3010")?.id ?? C.acct("3020").id, debit: 0, credit: 10, description: "y" }] } });
  const jrow = (await db.query(`SELECT date::date::text AS d FROM journal_entries WHERE id = $1`, [jr.json?.id]).catch(() => ({ rows: [] }))).rows[0];
  ok("F1 a manual journal keeps the UAE day", jr.status === 201 || jr.status === 200 ? jrow?.d === "2026-10-01" : false, { s: jr.status, t: jr.text?.slice(0, 200), jrow });
  const paid = await api("POST", `/api/companies/${C.cid}/invoices/${made[0].id}/payments`, { token: C.token, body: { amount: 100, date: "2026-10-01T00:00:00.000Z", method: "bank", paymentAccountId: C.acct("1020").id } });
  const pj = (await db.query(`SELECT date::date::text AS d FROM journal_entries WHERE source = 'payment' AND source_id = $1`, [made[0].id])).rows[0];
  ok("F1 a payment dated by an instant posts on the UAE day", paid.status === 201 && pj?.d === "2026-10-01", { s: paid.status, pj });
  const bill = await api("POST", `/api/companies/${C.cid}/bills`, { token: C.token, body: { vendor_name: "S", bill_date: "2026-09-30T20:00:00.000Z", due_date: "2026-10-30T20:00:00.000Z", currency: "AED", line_items: [{ description: "g", quantity: 1, unit_price: 100, vat_rate: 0.05 }] } });
  const brow = (await db.query(`SELECT bill_date::date::text AS d FROM vendor_bills WHERE id = $1`, [bill.json?.id])).rows[0];
  ok("F1 a bill keeps the UAE day", brow?.d === "2026-10-01", brow);
  const bad = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body: { customerName: "x", date: "2026-02-30", lines } });
  ok("F1 an impossible date is 400", bad.status === 400, bad.status);
}

// ───────────────────────────── F5-F8: tax credit note, customer details, opening balance ─────────────────────────────
async function taxDocuments() {
  const C = await newCompany("taxdoc");
  const cust = await C.contact({ name: "Gulf Towers LLC", address: "Business Bay Tower 3, Office 1204", city: "Dubai", country: "United Arab Emirates", trnNumber: "100765432100003" });
  const inv = await C.draft({ contactId: cust.id, customerName: "Gulf Towers LLC", lines: [{ description: "Cement", quantity: 400, unitPrice: 35, vatRate: 0.05 }] });
  await C.issue(inv.id);
  const stored = await C.getInvoice(inv.id);
  ok("F7 the invoice picked up the contact's TRN and address when the caller sent none", stored.customerTrn === "100765432100003" && /Business Bay/.test(stored.customerAddress || ""), { trn: stored.customerTrn, a: stored.customerAddress });
  const pdf = await api("GET", `/api/invoices/${inv.id}/pdf`, { token: C.token, raw: true });
  const text = await pdfText(pdf.buf);
  ok("F7 the tax invoice PDF prints the customer's address and TRN", /Business Bay Tower 3/.test(text) && /100765432100003/.test(text), text.slice(0, 500));

  // an invoice made without the contact's details on it (older data) still prints them from the contact
  await db.query(`UPDATE invoices SET customer_trn = NULL, customer_address = NULL WHERE id = $1`, [inv.id]);
  const pdfOld = await api("GET", `/api/invoices/${inv.id}/pdf`, { token: C.token, raw: true });
  const textOld = await pdfText(pdfOld.buf);
  ok("F7 older invoices print the contact's address and TRN too", /Business Bay Tower 3/.test(textOld) && /100765432100003/.test(textOld), textOld.slice(0, 300));

  // F5/F6: partial credit note
  const cn = await api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/credit-note`, { token: C.token, body: { lines: [{ description: "Cement", quantity: 20, unitPrice: 35, vatRate: 0.05 }] } });
  ok("a partial credit note is accepted", cn.status === 201, cn.text?.slice(0, 200));
  const cnPdf = await api("GET", `/api/invoices/${cn.json.id}/pdf`, { token: C.token, raw: true });
  const cnText = await pdfText(cnPdf.buf);
  ok("F6 the credit note PDF is titled TAX CREDIT NOTE", /TAX CREDIT NOTE/.test(cnText) && !/TAX INVOICE\b/.test(cnText.replace(/Original Tax Invoice/g, "")), cnText.slice(0, 300));
  ok("F6 it names the original tax invoice by number and date", cnText.includes(stored.number) && /Original Tax Invoice/.test(cnText), cnText.slice(0, 500));
  ok("F6 it shows 'Credit amount' with positive amounts and no TOTAL DUE, due date or payment terms", /Credit amount/.test(cnText) && !/TOTAL DUE/.test(cnText) && !/Payment Terms/.test(cnText) && !/Due Date/.test(cnText) && !/AED\s*-/.test(cnText) && /735\.00/.test(cnText), cnText);
  ok("F6 the credit note prints the customer's address and TRN as well", /Business Bay Tower 3/.test(cnText) && /100765432100003/.test(cnText), cnText.slice(0, 400));

  // F8: an opening-balance open item is not a tax invoice
  const ob = await C.draft({ contactId: cust.id, customerName: "Al Noor Trading", lines: [{ description: "Opening balance", quantity: 1, unitPrice: 12600, vatRate: 0 }] });
  await C.issue(ob.id);
  await db.query(`UPDATE invoices SET is_opening_balance = true WHERE id = $1`, [ob.id]);
  const obPdf = await api("GET", `/api/invoices/${ob.id}/pdf`, { token: C.token, raw: true });
  const obText = await pdfText(obPdf.buf);
  ok("F8 an opening-balance invoice prints as OPENING BALANCE with no VAT wording and no tax-invoice wording",
    /OPENING BALANCE/.test(obText) && !/VAT/i.test(obText) && !/TAX INVOICE/.test(obText) && !/Subtotal/.test(obText) && /12,?600\.00/.test(obText), obText);
}

// ───────────────────────────── F10/F11: company setup ─────────────────────────────
async function companySetup() {
  const C = await newCompany("setup");
  for (const [field, value, code] of [["taxRegistrationType", "Flat Rate", "FLAT_RATE_NOT_SUPPORTED"], ["taxRegistrationType", "flat_rate", "FLAT_RATE_NOT_SUPPORTED"], ["vatFilingFrequency", "Annually", "ANNUAL_FILING_NOT_SUPPORTED"], ["vatFilingFrequency", "annual", "ANNUAL_FILING_NOT_SUPPORTED"]]) {
    const patch = await api("PATCH", `/api/companies/${C.cid}`, { token: C.token, body: { [field]: value } });
    const put = await api("PUT", `/api/companies/${C.cid}`, { token: C.token, body: { [field]: value } });
    ok(`F10 ${field}=${value} is refused on PATCH and PUT (422 ${code})`, patch.status === 422 && patch.json?.code === code && put.status === 422 && put.json?.code === code, { p: patch.status, u: put.status, t: patch.text?.slice(0, 160) });
  }
  const good = await api("PATCH", `/api/companies/${C.cid}`, { token: C.token, body: { taxRegistrationType: "Standard", vatFilingFrequency: "Quarterly" } });
  ok("F10 Standard and Quarterly are accepted", good.status === 200 && good.json?.vatFilingFrequency === "Quarterly", good.text?.slice(0, 160));
  const created = await api("POST", "/api/companies", { token: C.token, body: { name: "Flat Co " + rnd, taxRegistrationType: "Flat Rate" } });
  ok("F10 a new company cannot be created as Flat Rate either", created.status === 422, created.status);
  const unchanged = (await api("GET", `/api/companies/${C.cid}`, { token: C.token })).json;
  ok("F10 the refused writes changed nothing", unchanged?.taxRegistrationType === "Standard" && unchanged?.vatFilingFrequency === "Quarterly", { t: unchanged?.taxRegistrationType, f: unchanged?.vatFilingFrequency });

  const banks = await api("GET", "/api/banks", { token: C.token });
  const names = (banks.json?.banks ?? []).map((b) => b.value);
  ok("F11 GET /api/banks lists the accepted banks", banks.status === 200 && names.length >= 2 && names.includes("Emirates NBD") && names.includes("Other"), banks.text?.slice(0, 200));
  const unauth = await api("GET", "/api/banks");
  ok("F11 the bank list needs a login", unauth.status === 401, unauth.status);
  const gl = C.acct("1020").id;
  let allAccepted = true, detail = null;
  for (const name of names) {
    const r = await api("POST", `/api/companies/${C.cid}/bank-accounts`, { token: C.token, body: { nameEn: "Acct " + name, bankName: name, accountNumber: "123456", currency: "AED", glAccountId: gl } });
    if (![200, 201].includes(r.status)) { allAccepted = false; detail = { name, s: r.status, t: r.text?.slice(0, 200) }; }
  }
  ok("F11 every bank the list offers is accepted by the bank-account API", allAccepted, detail);
  // S5 opened the bank name to free text (any bank can be recorded), so there is no rejection to test: the list only has to be a subset.
}

// ───────────────────── F4: the purchase-to-stock chain ─────────────────────
async function purchaseToStock() {
  const C = await newCompany("stock");
  const { token, cid } = C;
  await api("PATCH", `/api/companies/${cid}/preferences`, { token, body: { inventoryCostingEnabled: true } });
  const product = async (name, extra = {}) => (await api("POST", `/api/companies/${cid}/products`, { token, body: { name: name + " " + rnd, unitPrice: "30", costPrice: "0", vatRate: "5", unit: "bag", currentStock: 0, trackInventory: true, ...extra } })).json;
  const stockOf = async (id) => (await db.query(`SELECT current_stock, average_cost, inventory_value FROM products WHERE id = $1`, [id])).rows[0];
  const sumValues = async () => r2((await db.query(`SELECT COALESCE(SUM(inventory_value),0) AS v FROM products WHERE company_id = $1 AND track_inventory = true`, [cid])).rows[0].v);
  const tie = async (label) => { const b = await C.balances(); ok(`F4 ${label}: 1070 equals the sum of stock values`, close(b["1070"] ?? 0, await sumValues()), { gl: b["1070"], stock: await sumValues() }); return b; };
  const mkBill = (body) => api("POST", `/api/companies/${cid}/bills`, { token, body: { vendor_name: "Gulf Cement " + rnd, bill_date: today, ...body } });

  // 1. opening stock sets quantity AND average cost; the opening journal is Dr 1070 / Cr OBE and is counted once
  const cement = await product("Cement", { currentStock: 0 });
  const patched = await api("PATCH", `/api/products/${cement.id}`, { token, body: { currentStock: 200, costPrice: "18" } });
  let st = await stockOf(cement.id);
  ok("F4 opening stock sets quantity, average cost and value", patched.status === 200 && st.current_stock === 200 && close(st.average_cost, 18) && close(st.inventory_value, 3600), st);
  let b = await tie("after opening stock");
  ok("F4 opening stock posts 3,600 once (Dr 1070 / Cr Opening Balance Equity)", close(b["1070"], 3600) && close(b["3040"], -3600), b);

  // 2. a bill line with a product brings the stock in at the line's cost and debits 1070 instead of expense
  const bill = await mkBill({ line_items: [{ description: "Cement 100 bags", quantity: 100, unit_price: 22, vat_rate: 5, product_id: cement.id }] });
  ok("F4 a bill line accepts product_id", bill.status === 200 && bill.json?.id, bill.text?.slice(0, 200));
  const appr = await api("POST", `/api/bills/${bill.json.id}/approve`, { token });
  ok("F4 the bill approves", appr.status === 200, appr.text?.slice(0, 200));
  st = await stockOf(cement.id);
  ok("F4 approving the bill adds 100 bags and re-averages: 300 bags, 5,800 (19.333333)", st.current_stock === 300 && close(st.inventory_value, 5800) && close(st.average_cost, 19.333333, 0.0001), st);
  const billJe = await C.entryOf("bill", bill.json.id);
  ok("F4 the bill debits 1070 for the goods (no expense), 105 input VAT, credits AP 2,310", close(billJe["1070"]?.dr, 2200) && close(billJe["1050"]?.dr, 110) && !billJe["5000"] && close(billJe["2010"]?.cr, 2310), billJe);
  b = await tie("after the bill");
  const mv = (await db.query(`SELECT to_char(movement_date, 'YYYY-MM-DD') AS movement_date, source_bill_id, type, quantity FROM inventory_movements WHERE product_id = $1 AND source_bill_id = $2`, [cement.id, bill.json.id])).rows;
  ok("F4 the bill's movement is a purchase on the bill, dated the bill date", mv.length === 1 && mv[0].type === "purchase" && mv[0].quantity === 100 && mv[0].movement_date === today, mv);

  // 3. purchase order: receiving brings stock in (Dr 1070 / Cr 2015); billing it clears GRNI, no double count
  const sand = await product("Sand", { currentStock: 0 });
  const po = await api("POST", `/api/companies/${cid}/purchase-orders`, { token, body: { number: "PO-" + rnd, vendorName: "Gulf Cement " + rnd, date: today, lines: [{ description: "Sand", quantity: 50, unitPrice: 10, vatRate: 0.05, productId: sand.id }] } });
  ok("F4 a purchase order line accepts productId", po.status === 201 && po.json?.lines?.[0]?.productId === sand.id, po.text?.slice(0, 200));
  const poAppr = await api("POST", `/api/purchase-orders/${po.json.id}/approve`, { token });
  ok("F4 the purchase order approves", poAppr.status === 200, poAppr.text?.slice(0, 200));
  const rec = await api("POST", `/api/purchase-orders/${po.json.id}/receive`, { token });
  st = await stockOf(sand.id);
  ok("F4 receiving the order puts 50 bags into stock at 10", rec.status === 200 && st.current_stock === 50 && close(st.inventory_value, 500), { s: rec.status, st, t: rec.text?.slice(0, 160) });
  b = await C.balances();
  ok("F4 the receipt posts Dr 1070 / Cr 2015 GRNI 500", close(b["2015"], -500), b);
  await tie("after the receipt");
  const poBill = await mkBill({ purchase_order_id: po.json.id, line_items: [{ description: "Sand 50 bags", quantity: 50, unit_price: 10.4, vat_rate: 5, product_id: sand.id }] });
  await api("POST", `/api/bills/${poBill.json.id}/approve`, { token });
  b = await C.balances();
  st = await stockOf(sand.id);
  ok("F4 billing the received order clears GRNI to zero (no 1070 double count)", close(b["2015"] ?? 0, 0) && st.current_stock === 50 && close(st.inventory_value, 500), { grni: b["2015"], st });
  ok("F4 the price difference (520 - 500) goes to 5210", close(b["5210"], 20), b);
  await tie("after billing the received order");

  // 4. movements: dated, and a negative adjustment is possible
  const back = addDays(today, -3);
  const dated = await api("POST", `/api/products/${cement.id}/movements`, { token, body: { type: "adjustment", quantity: -20, date: back, notes: "damaged" } });
  const dm = (await db.query(`SELECT to_char(movement_date, 'YYYY-MM-DD') AS movement_date FROM inventory_movements WHERE id = $1`, [dated.json?.movement?.id])).rows[0];
  ok("F4 a movement accepts a date and keeps it", dated.status === 200 && dm && dm.movement_date === back, { s: dated.status, dm, t: dated.text?.slice(0, 160) });
  const je = (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS date FROM journal_entries WHERE company_id = $1 AND source = 'inventory_movement' AND source_id = $2`, [cid, dated.json?.movement?.id])).rows[0];
  ok("F4 the movement journal is dated that day", je && je.date === back, je);
  st = await stockOf(cement.id);
  ok("F4 the negative adjustment removed 20 bags at the average", st.current_stock === 280, st);
  await tie("after the dated adjustment");
  const future = await api("POST", `/api/products/${cement.id}/movements`, { token, body: { type: "purchase", quantity: 1, unitCost: "20", date: addDays(today, 5) } });
  ok("F4 a future movement date is refused", future.status === 422, future.status);

  // 5. vendor credit for returned goods reduces stock and credits 1070 at what left
  const vc = await api("POST", `/api/companies/${cid}/vendor-credits`, { token, body: { vendor_name: "Gulf Cement " + rnd, date: today, line_items: [{ description: "Return 10 bags", quantity: 10, unit_price: 22, vat_rate: 5, product_id: cement.id }] } });
  ok("F4 a vendor credit line accepts product_id", vc.status === 201 || vc.status === 200, vc.text?.slice(0, 200));
  const before = await stockOf(cement.id);
  const vcOk = await api("POST", `/api/companies/${cid}/vendor-credits/${vc.json?.id}/approve`, { token });
  const after = await stockOf(cement.id);
  ok("F4 approving the vendor credit takes 10 bags out of stock", vcOk.status === 200 && after.current_stock === before.current_stock - 10, { s: vcOk.status, before, after, t: vcOk.text?.slice(0, 160) });
  const vcJe = await C.entryOf("vendor_credit_note", vc.json?.id);
  ok("F4 the credit does not post a second stock leg through expense", !vcJe["5000"], vcJe);
  await tie("after the vendor credit");
  const voided = await api("POST", `/api/companies/${cid}/vendor-credits/${vc.json?.id}/void`, { token, body: {} });
  const restored = await stockOf(cement.id);
  ok("F4 voiding the vendor credit puts the bags back", voided.status === 200 && restored.current_stock === before.current_stock, { s: voided.status, restored, t: voided.text?.slice(0, 160) });
  await tie("after voiding the vendor credit");
  const foreign = await api("POST", `/api/companies/${cid}/bills`, { token, body: { vendor_name: "X", bill_date: today, line_items: [{ description: "x", quantity: 1, unit_price: 1, vat_rate: 5, product_id: "00000000-0000-4000-8000-000000000000" }] } });
  ok("F4 a bill line naming a product of another company is refused", foreign.status === 422, { s: foreign.status, t: foreign.text?.slice(0, 160) });
}

// ───────────────────── F9: refund of a customer credit balance ─────────────────────
async function customerCredit() {
  const C = await newCompany("credit");
  const { token, cid } = C;
  const bank = C.acct("1020").id;
  const cust = await C.contact({ name: "Overpayer " + rnd });
  const inv = await C.draft({ customerName: cust.name, contactId: cust.id, lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
  await C.issue(inv.id);
  const paid = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token, body: { amount: 1250, date: today, method: "bank", paymentAccountId: bank, allowCredit: true } });
  ok("F9 an overpayment is accepted with allowCredit", [200, 201].includes(paid.status), paid.text?.slice(0, 200));
  let credit = await api("GET", `/api/companies/${cid}/customers/${cust.id}/credit`, { token });
  ok("F9 the customer's credit balance is 200 (1,250 paid on 1,050)", credit.status === 200 && close(credit.json?.balance?.available, 200), credit.text?.slice(0, 200));
  const stmt = await api("GET", `/api/companies/${cid}/contacts/${cust.id}/statement?from=${addDays(today, -30)}&to=${today}`, { token });
  ok("F9 the customer statement carries the credit balance", stmt.status === 200 && close(stmt.json?.creditBalance, 200), stmt.text?.slice(0, 200));
  const before = await C.balances();
  const refund = await api("POST", `/api/companies/${cid}/customers/${cust.id}/credit-refunds`, { token, body: { amount: 150, date: today, bankAccountId: bank, reference: "RF-1" } });
  ok("F9 refund 150 of the credit", refund.status === 201, refund.text?.slice(0, 200));
  const rje = await C.entryOf("customer_credit_refund", refund.json?.refund?.id);
  ok("F9 the refund posts Dr 2050 / Cr bank 150", close(rje["2050"]?.dr, 150) && close(rje["1020"]?.cr, 150), rje);
  const after = await C.balances();
  ok("F9 2050 fell by 150 and the bank by 150", close((after["2050"] ?? 0) - (before["2050"] ?? 0), 150) && close((after["1020"] ?? 0) - (before["1020"] ?? 0), -150), { before, after });
  credit = await api("GET", `/api/companies/${cid}/customers/${cust.id}/credit`, { token });
  ok("F9 the balance is now 50 and the refund is listed", close(credit.json?.balance?.available, 50) && credit.json?.refunds?.length === 1, credit.text?.slice(0, 200));
  const over = await api("POST", `/api/companies/${cid}/customers/${cust.id}/credit-refunds`, { token, body: { amount: 60, date: today, bankAccountId: bank } });
  ok("F9 a refund above the balance is refused (422)", over.status === 422 && over.json?.code === "EXCEEDS_CREDIT_BALANCE", { s: over.status, t: over.text?.slice(0, 160) });
  const wrongAcct = await api("POST", `/api/companies/${cid}/customers/${cust.id}/credit-refunds`, { token, body: { amount: 10, date: today, bankAccountId: C.acct("2010").id } });
  ok("F9 a refund from a non-bank account is refused", wrongAcct.status === 400, wrongAcct.status);
  const other = await newCompany("credit2");
  const foreignCust = await api("GET", `/api/companies/${other.cid}/customers/${cust.id}/credit`, { token: other.token });
  ok("F9 another company cannot read this customer's credit", foreignCust.status === 404, foreignCust.status);
  const voided = await api("POST", `/api/companies/${cid}/customers/${cust.id}/credit-refunds/${refund.json?.refund?.id}/void`, { token });
  credit = await api("GET", `/api/companies/${cid}/customers/${cust.id}/credit`, { token });
  ok("F9 voiding the refund restores the balance to 200", voided.status === 200 && close(credit.json?.balance?.available, 200), { s: voided.status, t: credit.text?.slice(0, 200) });
  const again = await api("POST", `/api/companies/${cid}/customers/${cust.id}/credit-refunds/${refund.json?.refund?.id}/void`, { token });
  ok("F9 a second void is refused", again.status === 409, again.status);
}

// ───────────────────── t2: credit notes, derived status, gateway, revenue accounts, run-now ─────────────────────
async function publicPost(p, body) {
  const r = await fetch(BASE + "/api/csrf-token");
  const csrfToken = (await r.json()).csrfToken;
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return api("POST", p, { body, headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, "User-Agent": "t2-test/1.0" } });
}

async function t2CreditNotes() {
  const C = await newCompany("t2cn");
  const { token, cid } = C;
  const cust = await C.contact();
  const invDay = addDays(today, -20);
  const inv = await C.draft({ contactId: cust.id, customerName: cust.name, date: invDay, dueDate: addDays(invDay, 30), lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
  await C.issue(inv.id);
  const early = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: addDays(invDay, -5), lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("T2 a credit note dated before its invoice is refused (422)", early.status === 422 && early.json?.code === "CREDIT_NOTE_DATE_BEFORE_INVOICE", { s: early.status, t: early.text?.slice(0, 200) });
  const future = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: addDays(today, 5), lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("T2 a future credit note date is refused (422)", future.status === 422, future.status);
  const cnDay = addDays(today, -8);
  const cn = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: cnDay, lines: [{ description: "8 h x 50", quantity: 8, unitPrice: 50, vatRate: 0.05 }] } });
  ok("T2 a partial credit note with a date is issued", cn.status === 201 || cn.status === 200, cn.text?.slice(0, 200));
  const row = (await db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d, total::float8 AS total FROM invoices WHERE id = $1`, [cn.json?.id ?? cn.json?.creditNote?.id])).rows[0];
  ok("T2 the credit note is dated that day and for 420 (400 + 5% VAT)", row && row.d === cnDay && close(Math.abs(row.total), 420), row);
  const je = (await db.query(`SELECT to_char(je.date, 'YYYY-MM-DD') AS d FROM journal_entries je WHERE je.company_id = $1 AND je.source_id::text = $2 LIMIT 1`, [cid, String(cn.json?.id ?? cn.json?.creditNote?.id)])).rows[0];
  ok("T2 its journal is dated the same day", je?.d === cnDay, je);
  const legacy = await api("POST", `/api/companies/${cid}/credit-notes`, { token, body: { customerName: "x", lines: [] } });
  ok("T2 the legacy New Credit Note route stays 410 and names the replacement", legacy.status === 410 && /invoices\/:invoiceId\/credit-note/.test(legacy.text), legacy.text?.slice(0, 200));
  await api("POST", `/api/companies/${cid}/month-end/lock-period`, { token, body: { periodEnd: addDays(today, -6) } });
  const locked = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: addDays(today, -10), lines: [{ description: "y", quantity: 1, unitPrice: 10, vatRate: 0.05 }] } });
  ok("T2 a credit note dated inside a locked period is refused (403)", locked.status === 403, { s: locked.status, t: locked.text?.slice(0, 160) });
  const open = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: addDays(today, -2), lines: [{ description: "z", quantity: 1, unitPrice: 10, vatRate: 0.05 }] } });
  ok("T2 a date after the lock is accepted", open.status === 201 || open.status === 200, open.text?.slice(0, 160));
}

async function t2Status() {
  const C = await newCompany("t2st");
  const { token, cid } = C;
  const bank = C.acct("1020").id;
  const inv = await C.draft({ lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
  await C.issue(inv.id);
  for (const status of ["paid", "partial"]) {
    const r = await api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status, paymentAccountId: bank } });
    ok(`T2 status '${status}' cannot be set by hand (400 STATUS_DERIVED)`, r.status === 400 && r.json?.code === "STATUS_DERIVED", { s: r.status, t: r.text?.slice(0, 160) });
  }
  const part = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token, body: { amount: 50, date: today, method: "bank", paymentAccountId: bank } });
  ok("T2 a partial payment makes the invoice partial", part.status === 201 && (await C.getInvoice(inv.id)).status === "partial", part.text?.slice(0, 160));
  await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token, body: { amount: 55, date: today, method: "bank", paymentAccountId: bank } });
  ok("T2 the full payment derives paid", (await C.getInvoice(inv.id)).status === "paid", null);
  const issueOk = await C.draft({ lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
  const issued = await C.issue(issueOk.id);
  ok("T2 issuing (draft to sent) still works", issued.status === 200, issued.status);
}

async function t2Gateway() {
  const C = await newCompany("t2gw");
  const { token, cid } = C;
  const status = (await api("GET", `/api/companies/${cid}/payment-gateway`, { token })).json;
  if (status?.mode !== "fake") { console.log("SKIP  T2 gateway: server not started with PAYMENT_GATEWAY_FAKE=1"); return; }
  const conn = await api("POST", `/api/companies/${cid}/payment-gateway/stripe/connect`, { token, body: {} });
  await fetch(conn.json.url, { redirect: "manual" });
  const cust = await C.contact();
  const mk = async () => { const i = await C.draft({ contactId: cust.id, customerName: cust.name, lines: [{ description: "Retainer", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] }); await C.issue(i.id); return i; };
  const share = async (i) => (await api("POST", `/api/invoices/${i.id}/share`, { token, body: {} })).json.token;

  const a = await mk();
  const co = await publicPost(`/api/public/invoices/${await share(a)}/checkout`, {});
  const url = co.json?.url || "";
  ok("T2 Pay now returns a checkout page served by this server", co.status === 200 && /\/api\/public\/fake-pay\/cs_fake_/.test(url), url);
  const page = await fetch(url);
  const html = await page.text();
  ok("T2 the simulated checkout page shows the amount with Pay and Fail buttons", page.status === 200 && /Simulated checkout/.test(html) && />Pay</.test(html) && /Fail the payment/.test(html) && /1050\.00/.test(html), html.slice(0, 300));
  const pay = await fetch(url + "/pay", { method: "POST", redirect: "manual" });
  ok("T2 Pay fires the webhook path and redirects back (303)", pay.status === 303, pay.status);
  const paid = await C.getInvoice(a.id);
  ok("T2 the invoice is paid through the gateway into 1025 with a fee entry", paid.status === "paid", paid.status);
  const pj = await C.entryOf("payment", a.id);
  ok("T2 the payment posted Dr 1025 / Cr 1040", close(pj["1025"]?.dr, 1050) && close(pj["1040"]?.cr, 1050), pj);
  const feeRows = (await db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source = 'gateway_fee'`, [cid])).rows[0].n;
  ok("T2 the gateway fee was booked", feeRows === 1, feeRows);
  const again = await fetch(url + "/pay", { method: "POST", redirect: "manual" });
  const pays = (await db.query(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [a.id])).rows[0].n;
  ok("T2 pressing Pay twice records one payment", pays === 1, { s: again.status, pays });

  const b = await mk();
  const co2 = await publicPost(`/api/public/invoices/${await share(b)}/checkout`, {});
  const fail = await fetch(co2.json.url + "/fail", { method: "POST", redirect: "manual" });
  const linkState = (await db.query(`SELECT status FROM payment_links WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 1`, [b.id])).rows[0]?.status;
  ok("T2 Fail closes the payment link and records nothing", fail.status === 303 && linkState === "expired" && (await C.getInvoice(b.id)).status === "sent", { s: fail.status, linkState });
  // In a real browser the Pay button is a form post: it must not be refused by CORS (Origin: null).
  let chromium = null;
  try { ({ chromium } = await import("playwright-core")); } catch { console.log("SKIP  T2 browser Pay: playwright-core is not installed"); }
  if (chromium) {
    let browser = null;
    try { browser = await chromium.launch({ headless: true }); } catch (e) { console.log("SKIP  T2 browser Pay: no browser " + String(e.message).split("\n")[0].slice(0, 80)); }
    if (browser) {
      try {
        const d = await mk();
        const co3 = await publicPost(`/api/public/invoices/${await share(d)}/checkout`, {});
        const page = await (await browser.newContext()).newPage();
        await page.goto(co3.json.url, { waitUntil: "domcontentloaded" });
        const nav = page.waitForURL((u) => !/fake-pay/.test(u.toString()), { timeout: 15000 }).catch(() => null);
        await page.getByRole("button", { name: "Pay", exact: true }).click();
        await nav;
        const body = await page.content();
        const settled = (await C.getInvoice(d.id)).status === "paid";
        ok("T2 the simulated Pay button completes in a browser (no CORS error) and the invoice is paid", settled && !/Not allowed by CORS/.test(body), { url: page.url(), body: body.slice(0, 200), settled });
      } finally { await browser.close(); }
    }
  }
  const notFake = await fetch(BASE + "/api/public/fake-pay/cs_fake_doesnotexist");
  ok("T2 an unknown checkout page is 404", notFake.status === 404, notFake.status);

  // 1025 is selectable in Record Payment; a payment can be refunded (credit note + refund), shown on the statement
  const c = await mk();
  const clearing = C.acct("1025")?.id;
  const rp = await api("POST", `/api/companies/${cid}/invoices/${c.id}/payments`, { token, body: { amount: 1050, date: today, method: "gateway", paymentAccountId: clearing } });
  ok("T2 Record Payment accepts the gateway clearing account 1025", rp.status === 201, rp.text?.slice(0, 200));
  const bank = C.acct("1020").id;
  const rf = await api("POST", `/api/companies/${cid}/invoices/${c.id}/payment-refunds`, { token, body: { amount: 525, date: today, bankAccountId: clearing, reference: "RF-77" } });
  ok("T2 refund 525 of the payment (credit note + refund)", rf.status === 201 && rf.json?.creditNote?.id && rf.json?.refund?.id, rf.text?.slice(0, 240));
  const rj = await C.entryOf("customer_refund", rf.json?.refund?.id);
  ok("T2 the refund posts Dr 1040 525 / Cr 1025 525", close(rj["1040"]?.dr, 525) && close(rj["1025"]?.cr, 525), rj);
  const stmt = await api("GET", `/api/companies/${cid}/contacts/${cust.id}/statement?from=${addDays(today, -30)}&to=${today}`, { token });
  const types = (stmt.json?.lines ?? []).map((l) => l.type);
  ok("T2 the customer statement shows the credit note and the refund", types.includes("credit_note") && types.includes("refund"), types);
  const tooMuch = await api("POST", `/api/companies/${cid}/invoices/${c.id}/payment-refunds`, { token, body: { amount: 900, date: today, bankAccountId: bank } });
  ok("T2 refunding more than was paid is refused", tooMuch.status === 422, { s: tooMuch.status, t: tooMuch.text?.slice(0, 200) });
  const bal = await C.balances();
  const aging = (await api("GET", `/api/reports/${cid}/aging`, { token })).json ?? [];
  const arAging = r2(aging.filter((r) => r.type === "receivable").reduce((acc, r) => acc + n(r.total), 0));
  ok("T2 AR ageing equals the AR control account 1040", close(arAging, bal["1040"] ?? 0), { arAging, gl: bal["1040"] });
  const unpaid = await api("POST", `/api/companies/${cid}/invoices/${b.id}/payment-refunds`, { token, body: { amount: 10, date: today, bankAccountId: bank } });
  ok("T2 an invoice with no payment cannot be refunded", unpaid.status === 422 && ["NO_PAYMENT_TO_REFUND", "INVOICE_NOT_SETTLED"].includes(unpaid.json?.code), { s: unpaid.status, c: unpaid.json?.code });
}

async function t2RevenueAccounts() {
  const C = await newCompany("t2rev");
  const { token, cid } = C;
  const cust = await C.contact();
  const service = C.acct("4020")?.id, product = C.acct("4010")?.id;
  const stock = (await api("POST", `/api/companies/${cid}/products`, { token, body: { name: "Widget " + rnd, unitPrice: "100", costPrice: "40", vatRate: "5", unit: "pc", currentStock: 0, trackInventory: false } })).json;
  const q = (await api("POST", `/api/companies/${cid}/quotes`, { token, body: { customerName: cust.name, contactId: cust.id, date: today, lines: [
    { description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 0.05 },
    { description: "Widget", quantity: 1, unitPrice: 100, vatRate: 0.05, productId: stock.id },
    { description: "Explicit product-sales line", quantity: 1, unitPrice: 50, vatRate: 0.05, revenueAccountId: product },
  ] } })).json;
  const conv = await api("POST", `/api/quotes/${q.id}/convert-to-invoice`, { token, body: {} });
  ok("T2 the quote converts", conv.status === 200, conv.text?.slice(0, 200));
  const invId = conv.json?.invoice?.id;
  await C.issue(invId);
  const je = await C.entryOf("invoice", invId);
  ok("T2 a converted quote's service line goes to 4020 Service Revenue (1,000)", close(je["4020"]?.cr, 1000), je);
  ok("T2 a product line and an explicit account line stay on 4010 (150)", close(je["4010"]?.cr, 150), je);

  const proj = (await api("POST", `/api/companies/${cid}/projects`, { token, body: { name: "Rebuild", contactId: cust.id, hourlyRate: 200 } })).json;
  await api("POST", `/api/companies/${cid}/time-entries`, { token, body: { projectId: proj.id, entryDate: addDays(today, -1), hours: 3, notes: "Build" } });
  const draft = await api("POST", `/api/projects/${proj.id}/invoice`, { token, body: { vatRate: 5 } });
  ok("T2 an invoice from unbilled time is drafted", draft.status === 201, draft.text?.slice(0, 200));
  await C.issue(draft.json.id);
  const pj = await C.entryOf("invoice", draft.json.id);
  ok("T2 time-derived lines go to 4020 Service Revenue (600), not 4010", close(pj["4020"]?.cr, 600) && !pj["4010"], pj);
  void service;
}

async function t2RunNow() {
  const C = await newCompany("t2run");
  const { token, cid } = C;
  const cust = await C.contact();
  const lines = [{ description: "Retainer", quantity: 1, unitPrice: 2000, vatRate: 0.05 }];
  const t = await api("POST", `/api/companies/${cid}/recurring-invoices`, { token, body: { contactId: cust.id, frequency: "monthly", startDate: today, lines } });
  ok("T2 a due template is created", t.status === 200, t.text?.slice(0, 160));
  const staff = await api("POST", "/api/auth/register", { body: { name: "staff", email: `staff_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'employee') ON CONFLICT DO NOTHING`, [cid, staff.json.user.id]);
  const denied = await api("POST", `/api/companies/${cid}/recurring-invoices/run-now`, { token: staff.json.token, body: {} });
  ok("T2 run-now needs the owner or accountant (403)", denied.status === 403, denied.status);
  const other = await newCompany("t2run2");
  const foreign = await api("POST", `/api/companies/${cid}/recurring-invoices/run-now`, { token: other.token, body: {} });
  ok("T2 another company cannot run this company's templates", foreign.status === 403, foreign.status);
  const r1 = await api("POST", `/api/companies/${cid}/recurring-invoices/run-now`, { token, body: {} });
  ok("T2 run-now generates the due invoice", r1.status === 200 && r1.json?.generated === 1, r1.text?.slice(0, 200));
  const r2_ = await api("POST", `/api/companies/${cid}/recurring-invoices/run-now`, { token, body: {} });
  const count = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [cid])).rows[0].n;
  ok("T2 a second run-now generates nothing (idempotent)", r2_.status === 200 && r2_.json?.generated === 0 && count === 1, { r2_: r2_.json, count });

  const lateCust = await C.contact();
  const od = await C.draft({ contactId: lateCust.id, customerName: lateCust.name, date: addDays(today, -40), dueDate: addDays(today, -16), lines: [{ description: "Service", quantity: 1, unitPrice: 1000, vatRate: 0 }] });
  await C.issue(od.id);
  const none = await api("POST", `/api/companies/${cid}/late-fees/run-now`, { token, body: {} });
  ok("T2 late-fee run-now with the setting off adds nothing", none.status === 200 && (none.json?.created ?? 0) === 0, none.text?.slice(0, 160));
  await api("PATCH", `/api/chasing/config/${cid}`, { token, body: { lateFee: { enabled: true, type: "percent", value: 2, afterDays: 15, vatTreatment: "out_of_scope" } } });
  const l1 = await api("POST", `/api/companies/${cid}/late-fees/run-now`, { token, body: {} });
  const l2 = await api("POST", `/api/companies/${cid}/late-fees/run-now`, { token, body: {} });
  const fees = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'late_fee'`, [cid])).rows[0].n;
  ok("T2 late-fee run-now raises one fee, a second run adds none", l1.status === 200 && l1.json?.created === 1 && l2.json?.created === 0 && fees === 1, { l1: l1.json, l2: l2.json, fees });
  const stranger = await api("POST", `/api/companies/${cid}/late-fees/run-now`, { token: other.token, body: {} });
  ok("T2 another company cannot run this company's late fees", stranger.status === 403, stranger.status);
}

async function t2Pdf() {
  const C = await newCompany("t2pdf");
  const { token, cid } = C;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { name: "Nour Digital Consulting FZ-LLC Dubai Branch Office", trnVatNumber: "100234567800003" } });
  const cust = await C.contact();
  const inv = await C.draft({ contactId: cust.id, customerName: cust.name, lines: [{ description: "Work", quantity: 1, unitPrice: 4000, vatRate: 0.05 }] });
  await C.issue(inv.id);
  const pdf = await api("GET", `/api/invoices/${inv.id}/pdf`, { token, raw: true });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf.buf), verbosity: 0 }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  const items = content.items.filter((i) => i.str.trim() !== "").map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height }));
  const trn = items.find((i) => /100234567800003/.test(i.s));
  if (!trn) console.log("DEBUG items", JSON.stringify(items.slice(0, 12)));
  const nameParts = items.filter((i) => /Nour|Digital|Consulting|Branch|Office|FZ-LLC/.test(i.s) && i.y > 700);
  const overlap = trn && nameParts.some((i) => Math.abs(i.y - trn.y) < Math.min(i.h, trn.h) * 0.9 && i.x < trn.x + trn.w && trn.x < i.x + i.w);
  ok("T2 the company name does not overlap the TRN line in the invoice PDF header", !!trn && !overlap, { trn, nameParts: nameParts.slice(0, 4) });
  const text = await pdfText(pdf.buf);
  ok("T2 the TRN is printed", /100234567800003/.test(text), text.slice(0, 200));
}

// ───────────── S2 client contract: the exact bodies and endpoints the client sends (teardown t1 + t2) ─────────────
// Static half: the client source names these endpoints and conventions. Live half: the server accepts the bodies the client builds.
async function s2ClientContract() {
  const fs = await import("node:fs");
  const read = (f) => fs.readFileSync(f, "utf8");
  const endpoints = read("client/src/lib/sales-endpoints.ts");
  ok("S2 the client posts payment refunds to /invoices/:id/payment-refunds", /invoices\/\$\{[^}]+\}\/payment-refunds/.test(endpoints), null);
  ok("S2 the client calls recurring-invoices/run-now and late-fees/run-now (company level)", /recurring-invoices\/run-now/.test(endpoints) && /late-fees\/run-now/.test(endpoints), null);
  ok("S2 every request body goes through the calendar-day replacer (Dates are sent as YYYY-MM-DD)", /stringifyBody/.test(read("client/src/lib/queryClient.ts")) && /calendarDateReplacer/.test(read("client/src/lib/calendar-date.ts")), null);
  ok("S2 the onboarding bank list comes from GET /api/banks", /\/api\/banks/.test(read("client/src/pages/Onboarding.tsx")), null);
  ok("S2 the credit-note dialog sends originalLineId per line", /originalLineId/.test(read("client/src/lib/credit-note.ts")), null);

  const C = await newCompany("s2c");
  const { token, cid } = C;
  await api("PATCH", `/api/companies/${cid}/preferences`, { token, body: { inventoryCostingEnabled: true } });
  const cust = await C.contact();
  const day = addDays(today, -10);
  const inv = await C.draft({ contactId: cust.id, customerName: cust.name, date: day, dueDate: addDays(day, 30), lines: [
    { description: "Design", quantity: 4, unitPrice: 100, vatRate: 0.05 },
    { description: "Hosting", quantity: 1, unitPrice: 200, vatRate: 0.05 },
  ] });
  await C.issue(inv.id);
  const full = (await api("GET", `/api/invoices/${inv.id}`, { token })).json;
  const lines = full?.lines ?? [];
  ok("S2 GET /api/invoices/:id returns line ids and creditedAmount (what the dialog needs)", lines.length === 2 && lines.every((l) => l.id) && full.creditedAmount !== undefined, { n: lines.length, c: full?.creditedAmount });

  // the body the dialog builds for 1 of 4 design hours: lines with originalLineId, a UAE-day date, no restock flag
  const design = lines.find((l) => l.description === "Design");
  const cn = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: today, reason: "One hour not delivered", lines: [{ description: "Design", quantity: 1, unitPrice: 100, vatRate: 0.05, originalLineId: design.id }] } });
  ok("S2 a partial credit note with originalLineId is issued (201)", cn.status === 201 || cn.status === 200, cn.text?.slice(0, 200));
  const after = (await api("GET", `/api/invoices/${inv.id}`, { token })).json;
  ok("S2 creditedAmount is 105 after it (what 'remaining creditable' is computed from)", close(after?.creditedAmount, 105), after?.creditedAmount);
  const rest = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: { date: today } });
  ok("S2 a whole credit (no lines) credits the remaining balance", (rest.status === 201 || rest.status === 200), rest.text?.slice(0, 200));

  // opening stock on the product form: currentStock + costPrice on create bring the stock in at that cost
  const prod = (await api("POST", `/api/companies/${cid}/products`, { token, body: { name: "Rebar " + rnd, unitPrice: 30, costPrice: 18, vatRate: 5, unit: "bag", trackInventory: true, currentStock: 50 } })).json;
  const st = (await db.query(`SELECT current_stock, average_cost, inventory_value FROM products WHERE id = $1`, [prod?.id])).rows[0];
  ok("S2 a new tracked product with currentStock + costPrice opens at 50 x 18 = 900", st?.current_stock === 50 && close(st.average_cost, 18) && close(st.inventory_value, 900), st);
  // the movement dialog: date, negative adjustment, unit cost left out
  const mv = await api("POST", `/api/products/${prod.id}/movements`, { token, body: { type: "adjustment", quantity: -3, date: addDays(today, -1), notes: "damaged" } });
  const st2 = (await db.query(`SELECT current_stock FROM products WHERE id = $1`, [prod.id])).rows[0];
  ok("S2 a dated negative adjustment without a unit cost is accepted and lowers the stock", (mv.status === 201 || mv.status === 200) && st2.current_stock === 47, { s: mv.status, st2 });

  // refund of a payment: the body the Refund payment dialog sends (amount, date, bankAccountId, notes)
  const inv2 = await C.draft({ contactId: cust.id, customerName: cust.name, lines: [{ description: "Service", quantity: 1, unitPrice: 200, vatRate: 0.05 }] });
  await C.issue(inv2.id);
  const bank = C.acct("1020").id;
  await api("POST", `/api/companies/${cid}/invoices/${inv2.id}/payments`, { token, body: { amount: 210, date: today, method: "bank", paymentAccountId: bank } });
  const rf = await api("POST", `/api/companies/${cid}/invoices/${inv2.id}/payment-refunds`, { token, body: { amount: 50, date: today, bankAccountId: bank, notes: "goodwill" } });
  ok("S2 the refund dialog body is accepted (201 with creditNote and refund)", rf.status === 201 && rf.json?.creditNote && rf.json?.refund, { s: rf.status, t: rf.text?.slice(0, 200) });
  // the run-now buttons post an empty body
  const rr = await api("POST", `/api/companies/${cid}/recurring-invoices/run-now`, { token, body: {} });
  const lf = await api("POST", `/api/companies/${cid}/late-fees/run-now`, { token, body: {} });
  ok("S2 both Run now buttons answer 200 with the counts the toast reads", rr.status === 200 && typeof rr.json?.generated === "number" && lf.status === 200 && typeof lf.json?.created === "number", { rr: rr.text?.slice(0, 120), lf: lf.text?.slice(0, 120) });

  // customer credit: the contact page's dialog reads balance.available and refunds[]{id,amount,refundDate,reference,voidedAt}; the statement dialog reads creditBalance / creditRefunds
  const creditUi = read("client/src/components/sales/CustomerCreditDialog.tsx");
  ok("S2 the credit dialog uses the credit, credit-refunds and void endpoints", /customerCredit\(/.test(creditUi) && /customerCreditRefunds\(/.test(creditUi) && /voidCustomerCreditRefund\(/.test(creditUi) && /credit-refunds\/\$\{refundId\}\/void/.test(endpoints), null);
  const payer = await C.contact({ name: "Overpayer " + rnd });
  const inv3 = await C.draft({ contactId: payer.id, customerName: payer.name, lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
  await C.issue(inv3.id);
  await api("POST", `/api/companies/${cid}/invoices/${inv3.id}/payments`, { token, body: { amount: 1250, date: today, method: "bank", paymentAccountId: bank, allowCredit: true } });
  const cr0 = await api("GET", `/api/companies/${cid}/customers/${payer.id}/credit`, { token });
  ok("S2 GET credit returns balance.available (200) the dialog shows", cr0.status === 200 && close(cr0.json?.balance?.available, 200) && Array.isArray(cr0.json?.refunds), cr0.text?.slice(0, 160));
  const cref = await api("POST", `/api/companies/${cid}/customers/${payer.id}/credit-refunds`, { token, body: { amount: 120, date: today, bankAccountId: bank, reference: "CR-1" } });
  ok("S2 the credit refund body the dialog sends (amount, date, bankAccountId, reference) is accepted", cref.status === 201 && close(cref.json?.remaining, 80), { s: cref.status, t: cref.text?.slice(0, 200) });
  const cr1 = await api("GET", `/api/companies/${cid}/customers/${payer.id}/credit`, { token });
  const rrow = cr1.json?.refunds?.[0];
  ok("S2 the refund list rows carry id, amount, refundDate, reference and a null voidedAt", rrow?.id && close(rrow.amount, 120) && rrow.refundDate === today && rrow.reference === "CR-1" && !rrow.voidedAt, rrow);
  const stm = await api("GET", `/api/companies/${cid}/contacts/${payer.id}/statement?from=${addDays(today, -30)}&to=${today}`, { token });
  ok("S2 the statement shows creditBalance 80 and the refund in creditRefunds", close(stm.json?.creditBalance, 80) && stm.json?.creditRefunds?.[0]?.date === today && close(stm.json?.creditRefunds?.[0]?.amount, 120), stm.text?.slice(0, 200));
  const cvoid = await api("POST", `/api/companies/${cid}/customers/${payer.id}/credit-refunds/${cref.json?.refund?.id}/void`, { token, body: {} });
  const cr2 = await api("GET", `/api/companies/${cid}/customers/${payer.id}/credit`, { token });
  ok("S2 voiding (empty body, as the dialog does) restores 200 and marks the row voided", cvoid.status === 200 && close(cr2.json?.balance?.available, 200) && !!cr2.json?.refunds?.[0]?.voidedAt, { s: cvoid.status, t: cr2.text?.slice(0, 200) });
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    const sections = { documentDates, taxDocuments, companySetup, purchaseToStock, customerCredit, t2CreditNotes, t2Status, t2Gateway, t2RevenueAccounts, t2RunNow, t2Pdf, s2ClientContract };
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
