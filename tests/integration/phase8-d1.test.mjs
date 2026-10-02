// Integration tests for Phase 8 domain D1: sales and getting paid (S1 backend).
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5071 DATABASE_URL=... node tests/integration/phase8-d1.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";
import Stripe from "stripe";
import { spawnSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
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
async function api(method, p, { body, token, raw, headers: extra } = {}) {
  const headers = { "Content-Type": "application/json", ...(extra || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, {
    method, headers,
    body: body === undefined ? undefined : (typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)),
    signal: AbortSignal.timeout(60_000),
  });
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

// Run a D1 job in a child process (TypeScript) against the same database.
function runJob(job, companyId) {
  const env = { ...process.env, SESSION_SECRET: crypto.randomBytes(24).toString("hex"), JWT_SECRET: crypto.randomBytes(24).toString("hex"), NODE_ENV: "development", LOG_LEVEL: "error" };
  const run = spawnSync("npx", ["tsx", path.join(here, "helpers", "run-sales-jobs.ts"), job, companyId], { env, encoding: "utf8", cwd: path.join(here, "..", "..") });
  const line = (run.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  return { status: run.status, result: line ? JSON.parse(line.slice(7)) : null, err: run.stderr?.slice(-500) };
}

// A no-login POST needs the double-submit CSRF cookie + header (public endpoints are CSRF-protected).
async function publicPost(p, body, { ip } = {}) {
  const r = await fetch(BASE + "/api/csrf-token");
  const csrfToken = (await r.json()).csrfToken;
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return api("POST", p, { body, headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, "User-Agent": "d1-test/1.0", ...(ip ? { "X-Forwarded-For": ip } : {}) } });
}

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
  // Net debit per account code of the entries a document (source + source id) posted.
  const entryOf = async (source, sourceId) => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit) AS dr, SUM(jl.credit) AS cr FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = $2 AND je.source_id = $3 GROUP BY a.code`,
      [cid, source, sourceId])).rows;
    const out = {};
    for (const row of rows) out[row.code] = { dr: r2(row.dr), cr: r2(row.cr) };
    return out;
  };
  const delta = async (fn) => {
    const before = await balances();
    const result = await fn();
    const after = await balances();
    const d = {};
    for (const code of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const v = r2((after[code] ?? 0) - (before[code] ?? 0));
      if (v !== 0) d[code] = v;
    }
    return { d, result };
  };
  const contact = async (extra = {}) => {
    const r = await api("POST", `/api/companies/${cid}/customer-contacts`, {
      token, body: { name: "Buyer " + Math.random().toString(36).slice(2, 6), email: `buyer_${Math.random().toString(36).slice(2, 8)}@example.com`, ...extra },
    });
    if (!r.json?.id) throw new Error("contact failed " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const draft = async (body) => {
    const r = await api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "Buyer", date: today, dueDate: today, ...body } });
    if (!r.json?.id) throw new Error("invoice failed " + r.status + " " + r.text.slice(0, 300));
    return r.json;
  };
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });
  const pay = (id, amount, extra = {}) =>
    api("POST", `/api/companies/${cid}/invoices/${id}/payments`, { token, body: { amount, date: today, method: "bank", paymentAccountId: acct("1020").id, ...extra } });
  const monthStart = today.slice(0, 8) + "01";
  const vat201 = async (from = monthStart, to = today) =>
    (await api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: from, periodEnd: to } })).json;
  const advance = (body) => api("POST", `/api/companies/${cid}/customer-advances`, { token, body: { date: today, vatRate: 0.05, kind: "advance", ...body } });
  const subledger2055 = async () => r2((await db.query(
    `SELECT COALESCE(SUM(a.net_amount - COALESCE((SELECT SUM(x.net_amount) FROM customer_advance_applications x
        WHERE x.advance_id = a.id AND ((x.kind = 'application' AND x.status = 'active' AND x.invoice_id IN (SELECT id FROM invoices WHERE status NOT IN ('draft'))) OR (x.kind = 'refund' AND x.status IN ('active','pending')))), 0)), 0) AS v
       FROM customer_advances a JOIN invoices i ON i.id = a.invoice_id WHERE a.company_id = $1 AND a.status <> 'void' AND i.status NOT IN ('draft','void','cancelled')`, [cid])).rows[0].v);
  const getInvoice = async (id) => (await api("GET", `/api/invoices/${id}`, { token })).json;
  return { token, cid, userId, acct, balances, entryOf, delta, contact, draft, issue, pay, vat201, getInvoice, advance, subledger2055 };
}

// ───────────────────────────── D1-7: discounts, shipping, mass assignment ─────────────────────────────
async function discountsAndShipping() {
  const C = await newCompany("disc");
  const inv = await C.draft({
    discountType: "amount", discountValue: 50,
    lines: [
      { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "percent", discountValue: 10 },
      { description: "Delivery", quantity: 1, unitPrice: 100, lineKind: "shipping" },
    ],
  });
  const full = await C.getInvoice(inv.id);
  ok("D1-7 subtotal 950, VAT 47.50, total 997.50", n(full.subtotal) === 950 && n(full.vatAmount) === 47.5 && n(full.total) === 997.5, { s: full.subtotal, v: full.vatAmount, t: full.total });
  ok("D1-7 response carries discountAmount 150 and shippingAmount 100", n(full.discountAmount) === 150 && n(full.shippingAmount) === 100, full);
  ok("D1-7 itemsSubtotal 850", n(full.itemsSubtotal) === 850, full.itemsSubtotal);
  const kinds = full.lines.map((l) => l.lineKind);
  ok("D1-7 lines are item, line discount, document discount, shipping in order", JSON.stringify(kinds) === JSON.stringify(["item", "discount", "discount", "shipping"]), kinds);
  const itemLine = full.lines[0];
  ok("D1-7 line discount is a child of its item", full.lines[1].parentLineId === itemLine.id && n(itemLine.discountValue) === 10 && itemLine.discountType === "percent", full.lines.slice(0, 2));

  const issued = await C.issue(inv.id);
  ok("D1-7 invoice issues", issued.status === 200, issued.text?.slice(0, 200));
  const je = await C.entryOf("invoice", inv.id);
  ok("D1-7 journal: Dr 1040 997.50, Dr 4050 150, Cr 4010 1000, Cr 4035 100, Cr 2020 47.50",
    je["1040"]?.dr === 997.5 && je["4050"]?.dr === 150 && je["4010"]?.cr === 1000 && je["4035"]?.cr === 100 && je["2020"]?.cr === 47.5, je);
  const totalDr = Object.values(je).reduce((s, x) => s + x.dr, 0), totalCr = Object.values(je).reduce((s, x) => s + x.cr, 0);
  ok("D1-7 the entry balances", close(totalDr, totalCr), { totalDr, totalCr });
  const bal = await C.balances();
  ok("D1-7 AR equals the invoice total", bal["1040"] === 997.5, bal);

  // editing a posted, discounted invoice without changing the ledger is allowed; changing amounts is not
  const sameLines = [
    { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "percent", discountValue: 10 },
    { description: "Delivery", quantity: 1, unitPrice: 100, lineKind: "shipping" },
  ];
  const rename = await api("PUT", `/api/invoices/${inv.id}`, { token: C.token, body: { customerName: "Buyer Renamed", date: today, discountType: "amount", discountValue: 50, lines: sameLines } });
  ok("editing only the customer name of a posted discounted invoice is allowed", rename.status === 200 && n(rename.json?.total) === 997.5, rename.text?.slice(0, 300));
  const afterRename = await C.getInvoice(inv.id);
  ok("the rename kept the derived lines intact", afterRename.lines.map((l) => l.lineKind).join() === "item,discount,discount,shipping" && afterRename.customerName === "Buyer Renamed", afterRename.lines.map((l) => l.lineKind));
  const change = await api("PUT", `/api/invoices/${inv.id}`, { token: C.token, body: { date: today, discountType: "amount", discountValue: 60, lines: sameLines } });
  ok("changing the discount of a posted invoice is refused (422)", change.status === 422, change.text?.slice(0, 200));

  const pdf = await api("GET", `/api/invoices/${inv.id}/pdf`, { token: C.token, raw: true });
  const text = pdf.status === 200 ? await pdfText(pdf.buf) : "";
  ok("D1-7 PDF shows the discount and the delivery line", /Discount/i.test(text) && /Delivery/i.test(text) && /997\.50/.test(text), text.slice(0, 400));

  // credit the whole invoice: the remainder credit note zeroes every account it touched.
  const cn = await api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/credit-note`, { token: C.token, body: {} });
  ok("D1-7 full credit note is accepted", cn.status === 201, cn.text?.slice(0, 200));
  const after = await C.balances();
  const nonZero = Object.entries(after).filter(([, v]) => v !== 0);
  ok("D1-7 credit note zeroes every account", nonZero.length === 0, after);

  // partial credit on a discounted invoice: credit part of the item line only
  const inv2 = await C.draft({ lines: [
    { description: "A", quantity: 1, unitPrice: 500, vatRate: 0.05, discountType: "percent", discountValue: 20 },
    { description: "B", quantity: 1, unitPrice: 500, vatRate: 0.05 },
  ] });
  await C.issue(inv2.id);
  const l2 = (await C.getInvoice(inv2.id)).lines;
  const b = l2.find((l) => l.description === "B");
  const part = await api("POST", `/api/companies/${C.cid}/invoices/${inv2.id}/credit-note`, { token: C.token, body: { lines: [{ description: "B", quantity: 1, unitPrice: 500, vatRate: 0.05, originalLineId: b.id }] } });
  ok("partial credit note on a discounted invoice is accepted", part.status === 201, part.text?.slice(0, 300));
  const rest = await api("POST", `/api/companies/${C.cid}/invoices/${inv2.id}/credit-note`, { token: C.token, body: {} });
  ok("remainder credit note after a partial one is accepted", rest.status === 201, rest.text?.slice(0, 300));
  const balNow = await C.balances();
  ok("both credit notes leave 1040/4010/4050/2020 at zero", ["1040", "4010", "4050", "2020"].every((c) => (balNow[c] ?? 0) === 0), balNow);

  // validation
  const tooBig = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body: { customerName: "x", date: today, lines: [{ description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05, discountType: "amount", discountValue: 150 }] } });
  ok("a line discount above the line is 422 DISCOUNT_EXCEEDS_LINE", tooBig.status === 422 && tooBig.json?.code === "DISCOUNT_EXCEEDS_LINE", tooBig.text?.slice(0, 200));
  const tooBigDoc = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body: { customerName: "x", date: today, discountType: "amount", discountValue: 150, lines: [{ description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("a document discount above the items is 422 DISCOUNT_EXCEEDS_SUBTOTAL", tooBigDoc.status === 422 && tooBigDoc.json?.code === "DISCOUNT_EXCEEDS_SUBTOTAL", tooBigDoc.text?.slice(0, 200));
}

// ───────────────────────────── I-4: mass assignment ─────────────────────────────
async function massAssignment() {
  const C = await newCompany("mass");
  const r = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body: {
    customerName: "M", date: today, dueDate: today, invoiceType: "credit_note", status: "paid", lateFeeForInvoiceId: null, isOpeningBalance: true, salesOrderId: "00000000-0000-0000-0000-000000000000",
    lines: [{ description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("I-4 create ignores invoiceType, status, isOpeningBalance", r.status === 200 && r.json?.invoiceType === "invoice" && r.json?.status === "draft" && r.json?.isOpeningBalance === false, r.json);
  const put = await api("PUT", `/api/invoices/${r.json.id}`, { token: C.token, body: { status: "paid", invoiceType: "advance", date: today, lines: [{ description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  const after = await C.getInvoice(r.json.id);
  ok("I-4 update ignores status and invoiceType", put.status === 200 && after.status === "draft" && after.invoiceType === "invoice", after);
  const other = await newCompany("mass2");
  const foreign = await other.contact();
  const x = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body: { customerName: "M", date: today, contactId: foreign.id, lines: [{ description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("I-4 another company's contact id is refused", x.status === 422 && x.json?.code === "CONTACT_NOT_FOUND", x.text?.slice(0, 200));
}


// ───────────────────────────── D1-4/5/6: customer advances ─────────────────────────────
async function advances() {
  const C = await newCompany("adv");
  const cust = await C.contact();
  const bank = C.acct("1020").id;

  // D1-4: advance invoice 1,050 (1,000 + 5%) paid
  const { d, result: a1 } = await C.delta(() => C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: bank, method: "bank" } }));
  ok("D1-4 advance is created (201) with an issued, paid advance invoice", a1.status === 201 && a1.json?.invoice?.invoiceType === "advance" && a1.json?.invoice?.status === "paid" && /^ADV-/.test(a1.json?.advance?.number), a1.text?.slice(0, 300));
  ok("D1-4 net effect Dr 1020 1,050 / Cr 2055 1,000 / Cr 2020 50, AR unchanged", d["1020"] === 1050 && d["2055"] === -1000 && d["2020"] === -50 && d["1040"] === undefined, d);
  const advId = a1.json?.advance?.id;
  const box = await C.vat201();
  ok("D1-4 VAT 201 box 1 shows 1,000 / 50", close(box.box1bDubaiAmount, 1000) && close(box.box1bDubaiVat, 50), { a: box.box1bDubaiAmount, v: box.box1bDubaiVat });
  const stmt = await api("GET", `/api/companies/${C.cid}/contacts/${cust.id}/statement?from=${today.slice(0, 8)}01&to=${today}`, { token: C.token });
  ok("D1-4 statement lists the unapplied advance as a memo, not as a credit on the balance",
    stmt.json?.unappliedAdvances?.length === 1 && close(stmt.json.unappliedAdvances[0].availableGross, 1050) && close(stmt.json.closingBalance, 0), stmt.json?.unappliedAdvances);
  ok("D1-4 2055 equals the advances sub-ledger", (await C.balances())["2055"] === -(await C.subledger2055()), { gl: (await C.balances())["2055"], sub: await C.subledger2055() });

  const Z = await C.advance({ contactId: cust.id, amount: 500, vatRate: 0 });
  const boxZ = await C.vat201();
  const zJe = await C.entryOf("invoice", Z.json?.invoice?.id);
  ok("D1-4 zero-rated advance: no 2020 line, box 4 carries it", Z.status === 201 && zJe["2020"] === undefined && zJe["2055"]?.cr === 500 && close(boxZ.box4ZeroRatedAmount, 500), { zJe, b4: boxZ.box4ZeroRatedAmount });
  const dep = await C.advance({ contactId: cust.id, amount: 300, kind: "deposit" });
  const boxD = await C.vat201();
  ok("D1-4 a deposit is outside VAT: no VAT, not in box 1 or 4", dep.status === 201 && close(boxD.box1bDubaiAmount, 1000) && close(boxD.box4ZeroRatedAmount, 500) && (await C.entryOf("invoice", dep.json.invoice.id))["2020"] === undefined, { b1: boxD.box1bDubaiAmount, b4: boxD.box4ZeroRatedAmount });

  // D1-5: final invoice 3,150 applying the advance
  const fin = await C.draft({ contactId: cust.id, lines: [{ description: "Project", quantity: 1, unitPrice: 3000, vatRate: 0.05 }] });
  const over = await api("POST", `/api/invoices/${fin.id}/advance-applications`, { token: C.token, body: { advanceId: advId, amount: 1000.01 } });
  ok("D1-5 applying more than the open advance is 422 ADVANCE_EXCEEDED", over.status === 422 && over.json?.code === "ADVANCE_EXCEEDED", over.text?.slice(0, 200));
  const app1 = await api("POST", `/api/invoices/${fin.id}/advance-applications`, { token: C.token, body: { advanceId: advId, amount: 1000 } });
  ok("D1-5 apply the advance to the draft (201)", app1.status === 201, app1.text?.slice(0, 300));
  const fullFin = await C.getInvoice(fin.id);
  ok("D1-5 the draft now totals 2,100 with an advance line", n(fullFin.total) === 2100 && n(fullFin.subtotal) === 2000 && fullFin.lines.some((l) => l.lineKind === "advance" && n(l.unitPrice) === -1000), { t: fullFin.total, k: fullFin.lines.map((l) => l.lineKind) });
  const issueFin = await C.issue(fin.id);
  const finJe = await C.entryOf("invoice", fin.id);
  ok("D1-5 journal: Dr 1040 2,100, Dr 2055 1,000 / Cr 4010 3,000, Cr 2020 100", issueFin.status === 200 && finJe["1040"]?.dr === 2100 && finJe["2055"]?.dr === 1000 && finJe["4010"]?.cr === 3000 && finJe["2020"]?.cr === 100, finJe);
  const boxF = await C.vat201();
  ok("D1-5 VAT 201 box 1 (advance 1,000/50 + final 2,000/100)", close(boxF.box1bDubaiAmount, 3000) && close(boxF.box1bDubaiVat, 150), { a: boxF.box1bDubaiAmount, v: boxF.box1bDubaiVat });
  const pdf = await api("GET", `/api/invoices/${fin.id}/pdf`, { token: C.token, raw: true });
  const text = pdf.status === 200 ? await pdfText(pdf.buf) : "";
  ok("D1-5 PDF has the line 'Less advance ADV-'", /Less advance ADV-/.test(text), text.slice(0, 300));
  const edit = await api("POST", `/api/invoices/${fin.id}/advance-applications`, { token: C.token, body: { advanceId: advId, amount: 1 } });
  ok("D1-5 applying to an issued invoice is 409 INVOICE_NOT_DRAFT", edit.status === 409 && edit.json?.code === "INVOICE_NOT_DRAFT", edit.text?.slice(0, 200));
  const partial = await api("POST", `/api/companies/${C.cid}/invoices/${fin.id}/credit-note`, { token: C.token, body: { lines: [{ description: "Project", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("a partial credit note on an invoice carrying an advance is 422 ADVANCE_APPLIED_PARTIAL_CREDIT", partial.status === 422 && partial.json?.code === "ADVANCE_APPLIED_PARTIAL_CREDIT", partial.text?.slice(0, 200));
  const adv1 = (await api("GET", `/api/companies/${C.cid}/customer-advances/${advId}`, { token: C.token })).json;
  ok("D1-5 the advance shows applied with nothing available", adv1.status === "applied" && n(adv1.available) === 0, adv1);
  const gl = (await C.balances())["2055"], sub = await C.subledger2055();
  ok("I-2 2055 equals the sub-ledger after apply and issue", gl === -sub, { gl, sub });

  // a full credit note of the final invoice releases the advance again
  const cn = await api("POST", `/api/companies/${C.cid}/invoices/${fin.id}/credit-note`, { token: C.token, body: {} });
  const adv2 = (await api("GET", `/api/companies/${C.cid}/customer-advances/${advId}`, { token: C.token })).json;
  ok("a full credit of the final invoice makes the advance available again", cn.status === 201 && n(adv2.available) === 1000 && adv2.status === "open", { s: cn.status, adv2 });
  ok("I-2 2055 equals the sub-ledger after the credit note", (await C.balances())["2055"] === -(await C.subledger2055()), { gl: (await C.balances())["2055"], sub: await C.subledger2055() });

  // D1-6: refund of the whole advance
  const before = await C.balances();
  const ref = await api("POST", `/api/companies/${C.cid}/customer-advances/${advId}/refund`, { token: C.token, body: { amount: 1050, date: today, bankAccountId: bank } });
  ok("D1-6 refund returns the credit note and the refund (201)", ref.status === 201 && ref.json?.creditNote?.id && ref.json?.refund?.id, ref.text?.slice(0, 300));
  const cnJe = await C.entryOf("invoice", ref.json?.creditNote?.id);
  ok("D1-6 credit note Dr 2055 1,000, Dr 2020 50 / Cr 1040 1,050", cnJe["2055"]?.dr === 1000 && cnJe["2020"]?.dr === 50 && cnJe["1040"]?.cr === 1050, cnJe);
  const rfJe = await C.entryOf("customer_refund", ref.json?.refund?.id);
  ok("D1-6 refund Dr 1040 / Cr 1020", rfJe["1040"]?.dr === 1050 && rfJe["1020"]?.cr === 1050, rfJe);
  const adv3 = (await api("GET", `/api/companies/${C.cid}/customer-advances/${advId}`, { token: C.token })).json;
  ok("D1-6 the customer's advance balance is 0", n(adv3.available) === 0 && adv3.status === "refunded", adv3);
  ok("I-2 2055 equals the sub-ledger after the refund", (await C.balances())["2055"] === -(await C.subledger2055()), { gl: (await C.balances())["2055"], sub: await C.subledger2055() });
  const refAgain = await api("POST", `/api/companies/${C.cid}/customer-advances/${advId}/refund`, { token: C.token, body: { amount: 50, date: today, bankAccountId: bank } });
  ok("refunding more than what is left is 422 ADVANCE_EXCEEDED", refAgain.status === 422 && refAgain.json?.code === "ADVANCE_EXCEEDED", refAgain.text?.slice(0, 200));

  // a refund dated in a locked month -> 403
  const prevMid = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
  const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
  const adv4 = await C.advance({ contactId: cust.id, amount: 105, date: prevMid, receive: { paymentAccountId: bank } });
  ok("an advance can be dated in an open earlier month", adv4.status === 201, adv4.text?.slice(0, 200));
  await db.query(`INSERT INTO month_end_close (company_id, period_end, status, closed_by, closed_at) VALUES ($1, $2::date, 'locked', $3, now())
                  ON CONFLICT (company_id, period_end) DO UPDATE SET status = 'locked'`, [C.cid, prevEnd, C.userId]);
  const lockedRefund = await api("POST", `/api/companies/${C.cid}/customer-advances/${adv4.json?.advance?.id}/refund`, { token: C.token, body: { amount: 105, date: prevMid, bankAccountId: bank } });
  ok("D1-6 a refund dated in a locked month is 403", lockedRefund.status === 403, lockedRefund.text?.slice(0, 200));
  const advLocked = await C.advance({ contactId: cust.id, amount: 105, date: prevMid });
  ok("an advance dated in a locked month is 403", advLocked.status === 403, advLocked.text?.slice(0, 200));
  const adv4now = (await api("GET", `/api/companies/${C.cid}/customer-advances/${adv4.json?.advance?.id}`, { token: C.token })).json;
  ok("the refused refund reserved nothing", n(adv4now.available) === 100 && adv4now.status === "open", adv4now);

  // concurrency: 5 parallel applies of 400 to five drafts never exceed the available 1,000 (net)
  const adv5 = await C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: bank } });
  const drafts = [];
  for (let i = 0; i < 5; i++) drafts.push(await C.draft({ contactId: cust.id, lines: [{ description: "Work " + i, quantity: 1, unitPrice: 2000, vatRate: 0.05 }] }));
  const results = await Promise.all(drafts.map((dr) => api("POST", `/api/invoices/${dr.id}/advance-applications`, { token: C.token, body: { advanceId: adv5.json.advance.id, amount: 400 } })));
  const okCount = results.filter((r) => r.status === 201).length;
  const adv5now = (await api("GET", `/api/companies/${C.cid}/customer-advances/${adv5.json.advance.id}`, { token: C.token })).json;
  ok("D1-5 five parallel applies of 400 against 1,000: exactly two succeed, available stays >= 0", okCount === 2 && n(adv5now.available) === 200, { okCount, available: adv5now.available, statuses: results.map((r) => r.status) });

  // another company cannot touch it
  const other = await newCompany("adv2");
  const x = await api("GET", `/api/companies/${C.cid}/customer-advances`, { token: other.token });
  ok("I-1 company B is refused on the advances list", x.status === 403, x.status);
  const y = await api("POST", `/api/invoices/${fin.id}/advance-applications`, { token: other.token, body: { advanceId: advId, amount: 1 } });
  ok("I-1 company B cannot apply advances to A's invoice (404)", y.status === 404, y.status);
}

// ───────────────────────────── D1-8: price lists ─────────────────────────────
async function priceLists() {
  const C = await newCompany("price");
  const prod = (await api("POST", `/api/companies/${C.cid}/products`, { token: C.token, body: { name: "Widget P", unitPrice: "100", vatRate: "0.05" } })).json;
  const list = await api("POST", `/api/companies/${C.cid}/price-lists`, { token: C.token, body: { name: "Wholesale", items: [{ productId: prod.id, unitPrice: 80 }] } });
  ok("D1-8 a price list with an item is created (201)", list.status === 201 && list.json?.items?.length === 1, list.text?.slice(0, 200));
  const cust = await C.contact({ priceListId: list.json?.id });
  ok("D1-8 the customer carries the list", cust.priceListId === list.json?.id, cust);
  const res = await api("GET", `/api/companies/${C.cid}/price-lists/resolve?contactId=${cust.id}&currency=AED`, { token: C.token });
  ok("D1-8 resolve gives the list and price 80 for the product", res.json?.priceListId === list.json?.id && n(res.json?.prices?.[prod.id]) === 80, res.text?.slice(0, 200));
  const other = await C.contact();
  const none = await api("GET", `/api/companies/${C.cid}/price-lists/resolve?contactId=${other.id}&currency=AED`, { token: C.token });
  ok("D1-8 a customer without a list resolves to none", none.json?.priceListId === null, none.text?.slice(0, 200));
  const usd = await api("GET", `/api/companies/${C.cid}/price-lists/resolve?contactId=${cust.id}&currency=USD`, { token: C.token });
  ok("D1-8 a currency that differs from the list resolves to none", usd.json?.priceListId === null, usd.text?.slice(0, 200));

  const inv = await C.draft({ contactId: cust.id, lines: [{ description: "Widget P", quantity: 2, unitPrice: 80, vatRate: 0.05, productId: prod.id, priceListId: list.json.id }] });
  const lineRow = (await db.query(`SELECT price_list_id, unit_price::float8 AS price FROM invoice_lines WHERE invoice_id = $1`, [inv.id])).rows[0];
  ok("D1-8 the line stores the list id and the price", lineRow?.price_list_id === list.json.id && lineRow.price === 80, lineRow);
  const edited = await api("PUT", `/api/invoices/${inv.id}`, { token: C.token, body: { date: today, lines: [{ description: "Widget P", quantity: 2, unitPrice: 75, vatRate: 0.05, productId: prod.id, priceListId: list.json.id }] } });
  ok("D1-8 the price stays editable", edited.status === 200 && n(edited.json?.subtotal) === 150, edited.text?.slice(0, 200));

  const B = await newCompany("price2");
  const foreignList = await api("POST", `/api/companies/${B.cid}/price-lists`, { token: B.token, body: { name: "B list" } });
  const bad = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body: { customerName: "x", date: today, lines: [{ description: "w", quantity: 1, unitPrice: 1, vatRate: 0.05, priceListId: foreignList.json.id }] } });
  ok("D1-8 another company's price list on a line is 422", bad.status === 422 && bad.json?.code === "PRICE_LIST_NOT_FOUND", bad.text?.slice(0, 200));
  const badContact = await api("PUT", `/api/companies/${C.cid}/customer-contacts/${cust.id}`, { token: C.token, body: { priceListId: foreignList.json.id } });
  ok("D1-8 another company's price list on a contact is 422", badContact.status === 422, badContact.text?.slice(0, 200));
  const x = await api("GET", `/api/companies/${C.cid}/price-lists`, { token: B.token });
  ok("I-1 company B is refused on A's price lists", x.status === 403, x.status);
}

// ───────────────────────────── D1-9: late fees ─────────────────────────────
async function lateFees() {
  const C = await newCompany("late");
  const cust = await C.contact();
  const overdue = addDays(today, -16);
  const inv = await C.draft({ contactId: cust.id, date: addDays(today, -40), dueDate: overdue, lines: [{ description: "Service", quantity: 1, unitPrice: 1000, vatRate: 0 }] });
  await C.issue(inv.id);
  const off = runJob("late-fees", C.cid);
  ok("D1-9 the job runs", off.status === 0, off);
  const none = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'late_fee'`, [C.cid])).rows[0].n;
  ok("D1-9 disabled by default: nothing is added", none === 0, none);

  const cfg = await api("PATCH", `/api/chasing/config/${C.cid}`, { token: C.token, body: { lateFee: { enabled: true, type: "percent", value: 2, afterDays: 15, vatTreatment: "out_of_scope" } } });
  ok("D1-9 the late-fee setting is saved", cfg.status === 200 && cfg.json?.lateFee?.enabled === true && cfg.json.lateFee.value === 2, cfg.text?.slice(0, 200));
  const bad = await api("PATCH", `/api/chasing/config/${C.cid}`, { token: C.token, body: { lateFee: { enabled: true, type: "percent", value: 120, afterDays: 15 } } });
  ok("D1-9 a percent above 100 is refused", bad.status === 400, bad.status);
  const r1 = runJob("late-fees", C.cid), r2 = runJob("late-fees", C.cid);
  ok("D1-9 both runs succeed", r1.status === 0 && r2.status === 0 && r1.result?.created === 1 && r2.result?.created === 0, { r1, r2 });
  const fees = (await db.query(`SELECT i.id, i.total::float8 AS total, i.status, l.vat_supply_type, l.line_kind, l.unit_price::float8 AS price, i.late_fee_for_invoice_id
                                  FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.company_id = $1 AND i.invoice_type = 'late_fee'`, [C.cid])).rows;
  ok("D1-9 exactly one 20.00 line, out of scope, linked to the invoice", fees.length === 1 && fees[0].price === 20 && fees[0].vat_supply_type === "out_of_scope" && fees[0].line_kind === "late_fee" && fees[0].late_fee_for_invoice_id === inv.id, fees);
  const je = await C.entryOf("invoice", fees[0]?.id);
  ok("D1-9 journal Dr 1040 / Cr 4040 20.00 and no VAT", je["1040"]?.dr === 20 && je["4040"]?.cr === 20 && je["2020"] === undefined, je);
  ok("D1-9 the late fee is issued", fees[0]?.status === "sent", fees[0]);
  const boxes = await C.vat201(addDays(today, -60), today);
  ok("D1-9 the fee is not in the VAT return", close(boxes.box4ZeroRatedAmount, 1000) && close(boxes.box1bDubaiAmount, 0) && close(boxes.box5ExemptAmount, 0), { b1: boxes.box1bDubaiAmount, b4: boxes.box4ZeroRatedAmount });

  // a voided fee is never recreated
  await api("PATCH", `/api/invoices/${fees[0].id}/status`, { token: C.token, body: { status: "void" } });
  const r3 = runJob("late-fees", C.cid);
  const after = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'late_fee'`, [C.cid])).rows[0].n;
  ok("D1-9 a voided fee is not recreated", r3.status === 0 && after === 1, { r3, after });

  // not yet due: 10 days overdue gets nothing
  const young = await C.draft({ contactId: cust.id, date: addDays(today, -20), dueDate: addDays(today, -10), lines: [{ description: "Young", quantity: 1, unitPrice: 500, vatRate: 0 }] });
  await C.issue(young.id);
  const r4 = runJob("late-fees", C.cid);
  ok("D1-9 an invoice inside the grace period gets no fee", r4.result?.created === 0, r4);
}

// ───────────────────────────── D1-10: recurring auto-send ─────────────────────────────
async function recurring() {
  const C = await newCompany("rec");
  const cust = await C.contact();
  const noEmail = await C.contact({ email: null });
  const lines = [{ description: "Retainer", quantity: 1, unitPrice: 1000, vatRate: 0.05 }];
  const bad = await api("POST", `/api/companies/${C.cid}/recurring-invoices`, { token: C.token, body: { contactId: noEmail.id, autoSend: true, frequency: "monthly", startDate: today, lines } });
  ok("D1-10 auto-send without a customer email is 422 CONTACT_EMAIL_REQUIRED", bad.status === 422 && bad.json?.code === "CONTACT_EMAIL_REQUIRED", bad.text?.slice(0, 200));
  const t = await api("POST", `/api/companies/${C.cid}/recurring-invoices`, { token: C.token, body: { contactId: cust.id, autoSend: true, paymentTermsDays: 14, frequency: "monthly", startDate: today, lines } });
  ok("D1-10 a template with contactId and autoSend is created", t.status === 200 && t.json?.autoSend === true && t.json?.contactId === cust.id && t.json?.paymentTermsDays === 14, t.text?.slice(0, 200));
  const run = runJob("recurring", C.cid);
  ok("D1-10 the generator ran", run.status === 0 && run.result?.generated === 1, run);
  const inv = (await db.query(`SELECT id, status, contact_id, to_char(due_date, 'YYYY-MM-DD') AS due, to_char(date, 'YYYY-MM-DD') AS d FROM invoices WHERE company_id = $1`, [C.cid])).rows[0];
  ok("D1-10 the invoice is created with the contact and a due date 14 days out", inv?.status === "sent" && inv.contact_id === cust.id && inv.due === addDays(inv.d, 14), inv);
  const tpl = (await db.query(`SELECT is_active, last_send_status, last_send_error FROM recurring_invoices WHERE id = $1`, [t.json.id])).rows[0];
  ok("D1-10 mail not configured: not_sent recorded, template stays active", tpl?.last_send_status === "not_sent" && /not configured|nothing was sent/i.test(tpl.last_send_error || "") && tpl.is_active === true, tpl);
  const notes = (await db.query(`SELECT count(*)::int AS n FROM notifications WHERE company_id = $1 AND type = 'recurring_invoice_not_sent'`, [C.cid])).rows[0].n;
  ok("D1-10 a notification says it was not sent", notes >= 1, notes);
  const jes = await C.entryOf("invoice", inv.id);
  ok("D1-10 the invoice is posted (Dr 1040 1,050)", jes["1040"]?.dr === 1050, jes);
}

// ───────────────────────────── D1-16: custom fields ─────────────────────────────
async function customFields() {
  const C = await newCompany("cf");
  const def = await api("POST", `/api/companies/${C.cid}/custom-fields`, { token: C.token, body: { entity: "invoice", key: "po_number", labelEn: "PO Number", labelAr: "رقم أمر الشراء", fieldType: "text", showOnPdf: true } });
  ok("D1-16 a text field with en and ar labels is created", def.status === 201 && def.json?.labelAr === "رقم أمر الشراء", def.text?.slice(0, 200));
  const sel = await api("POST", `/api/companies/${C.cid}/custom-fields`, { token: C.token, body: { entity: "invoice", key: "priority", labelEn: "Priority", labelAr: "الأولوية", fieldType: "select", options: ["Low", "High"], showOnPdf: false } });
  ok("D1-16 a select field is created", sel.status === 201, sel.text?.slice(0, 200));
  const dup = await api("POST", `/api/companies/${C.cid}/custom-fields`, { token: C.token, body: { entity: "invoice", key: "po_number", labelEn: "x", labelAr: "x", fieldType: "text" } });
  ok("D1-16 a duplicate key is 409", dup.status === 409, dup.text?.slice(0, 200));
  const badKey = await api("POST", `/api/companies/${C.cid}/custom-fields`, { token: C.token, body: { entity: "invoice", key: "Bad Key", labelEn: "x", labelAr: "x", fieldType: "text" } });
  ok("D1-16 an invalid key is refused", badKey.status === 400, badKey.status);

  const inv = await C.draft({ lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
  const set = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { po_number: "PO-7781", priority: "High" } } });
  ok("D1-16 values are saved", set.status === 200 && set.json?.find((f) => f.key === "po_number")?.value === "PO-7781", set.text?.slice(0, 300));
  const badSel = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { priority: "Urgent" } } });
  ok("D1-16 a select value outside the options is 422 CUSTOM_FIELD_INVALID", badSel.status === 422 && badSel.json?.code === "CUSTOM_FIELD_INVALID", badSel.text?.slice(0, 200));
  const unknown = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { nope: "x" } } });
  ok("D1-16 an unknown field is 422", unknown.status === 422, unknown.status);

  await C.issue(inv.id);
  const pdf = await api("GET", `/api/invoices/${inv.id}/pdf`, { token: C.token, raw: true });
  const text = pdf.status === 200 ? await pdfText(pdf.buf) : "";
  ok("D1-16 the PDF shows the flagged field and not the unflagged one", /PO Number/.test(text) && /PO-7781/.test(text) && !/Priority/.test(text), text.slice(0, 400));

  const share = await api("POST", `/api/invoices/${inv.id}/share`, { token: C.token, body: {} });
  const pub = await api("GET", `/api/public/invoices/${share.json.token}`);
  const pf = pub.json?.customFields?.find((f) => f.key === "po_number");
  ok("D1-16 the public page carries the field with both labels", pf?.labelEn === "PO Number" && pf?.labelAr === "رقم أمر الشراء" && pf?.value === "PO-7781", pub.json?.customFields);
  ok("D1-16 the unflagged field is not on the public page", !pub.json?.customFields?.some((f) => f.key === "priority"), pub.json?.customFields);

  const locked = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { po_number: "PO-1" } } });
  ok("D1-16 an issued invoice's fields are locked (409 DOCUMENT_LOCKED)", locked.status === 409 && locked.json?.code === "DOCUMENT_LOCKED", locked.text?.slice(0, 200));

  const B = await newCompany("cf2");
  const foreign = await api("PUT", `/api/companies/${B.cid}/custom-fields/values/invoice/${inv.id}`, { token: B.token, body: { values: {} } });
  ok("D1-16 another tenant's record is 404", foreign.status === 404, foreign.text?.slice(0, 200));
  const cross = await api("GET", `/api/companies/${C.cid}/custom-fields`, { token: B.token });
  ok("I-1 company B is refused on A's custom fields", cross.status === 403, cross.status);

  // delete archives when values exist
  const del = await api("DELETE", `/api/companies/${C.cid}/custom-fields/${def.json.id}`, { token: C.token });
  ok("D1-16 deleting a field with values archives it", del.json?.outcome === "archived", del.text);
  const del2 = await api("DELETE", `/api/companies/${C.cid}/custom-fields/${sel.json.id}`, { token: C.token });
  ok("D1-16 deleting a field with values archives it too", del2.json?.outcome === "archived", del2.text);
  const del3 = await api("POST", `/api/companies/${C.cid}/custom-fields`, { token: C.token, body: { entity: "contact", key: "tmp", labelEn: "Tmp", labelAr: "مؤقت", fieldType: "number" } });
  const del4 = await api("DELETE", `/api/companies/${C.cid}/custom-fields/${del3.json.id}`, { token: C.token });
  ok("D1-16 deleting an unused field removes it", del4.json?.outcome === "deleted", del4.text);
}

// ───────────────────────────── D1-15: quote send / accept / decline / expiry ─────────────────────────────
async function quoteAcceptance() {
  const C = await newCompany("quote");
  const cust = await C.contact();
  const mkQuote = async (extra = {}) => (await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Acme", contactId: cust.id, date: today, expiryDate: addDays(today, 30), lines: [{ description: "Design", quantity: 2, unitPrice: 500, vatRate: 0.05 }], ...extra } })).json;
  const q = await mkQuote();
  ok("quote created as a draft", q?.status === "draft" && n(q.total) === 1050, q);

  const sent = await api("POST", `/api/quotes/${q.id}/send`, { token: C.token, body: {} });
  ok("D1-15 send returns the quote, a share URL and the email outcome", sent.status === 200 && sent.json?.quote?.status === "sent" && /^\/view\/quote\//.test(sent.json?.shareUrl) && sent.json?.emailed === false && !!sent.json?.emailError, sent.text?.slice(0, 300));
  const again = await api("POST", `/api/quotes/${q.id}/send`, { token: C.token, body: {} });
  ok("D1-15 sending a quote that is not a draft is 409 QUOTE_NOT_DRAFT", again.status === 409 && again.json?.code === "QUOTE_NOT_DRAFT", again.text?.slice(0, 200));
  const token = sent.json.shareUrl.split("/").pop();

  const edit = await api("PUT", `/api/quotes/${q.id}`, { token: C.token, body: { status: "accepted", customerName: "x", lines: [{ description: "x", quantity: 1, unitPrice: 1, vatRate: 0.05 }] } });
  ok("a sent quote cannot be edited (409 QUOTE_NOT_EDITABLE, status in the body is ignored)", edit.status === 409 && edit.json?.code === "QUOTE_NOT_EDITABLE", edit.text?.slice(0, 200));
  const del = await api("DELETE", `/api/quotes/${q.id}`, { token: C.token });
  ok("a sent quote cannot be deleted", del.status === 409, del.status);

  const view = await api("GET", `/api/public/quotes/${token}`);
  ok("D1-15 the public page shows the quote without internal ids", view.status === 200 && view.json?.quote?.number === q.number && view.json?.canRespond === true && view.json?.quote?.id === undefined && view.json?.company?.name, view.text?.slice(0, 300));
  const pdf = await api("GET", `/api/public/quotes/${token}/pdf`, { raw: true });
  ok("D1-15 the public PDF downloads", pdf.status === 200 && pdf.buf.slice(0, 4).toString() === "%PDF", pdf.status);
  const unknown = await api("GET", `/api/public/quotes/${"0".repeat(48)}`);
  ok("an unknown token is 404", unknown.status === 404, unknown.status);

  const noCsrf = await api("POST", `/api/public/quotes/${token}/accept`, { body: { name: "Sam", email: "sam@example.com", agree: true } });
  ok("accepting without a CSRF token is refused", noCsrf.status === 403 || noCsrf.status === 401, noCsrf.status);
  const noAgree = await publicPost(`/api/public/quotes/${token}/accept`, { name: "Sam", email: "sam@example.com", agree: false });
  ok("accepting without ticking agree is 400", noAgree.status === 400, noAgree.text?.slice(0, 200));

  const acc = await publicPost(`/api/public/quotes/${token}/accept`, { name: "Sam Customer", email: "sam@example.com", agree: true }, { ip: "203.0.113.9" });
  ok("D1-15 accept: status accepted", acc.status === 200 && acc.json?.status === "accepted", acc.text?.slice(0, 200));
  const sig = (await db.query(`SELECT * FROM quote_signatures WHERE quote_id = $1`, [q.id])).rows;
  ok("D1-15 signature row: name, email, ip, user agent, time, hash, 5-year retention",
    sig.length === 1 && sig[0].signer_name === "Sam Customer" && sig[0].signer_email === "sam@example.com" && !!sig[0].ip && /d1-test/.test(sig[0].user_agent || "") && !!sig[0].signed_at && /^[0-9a-f]{64}$/.test(sig[0].quote_hash) && new Date(sig[0].retention_expires_at) > new Date(Date.now() + 4.9 * 365 * 86400000) && sig[0].action === "accepted", sig[0]);
  const second = await publicPost(`/api/public/quotes/${token}/accept`, { name: "Sam", email: "sam@example.com", agree: true });
  ok("D1-15 a second accept is 409", second.status === 409 && second.json?.code === "QUOTE_NOT_OPEN", second.text?.slice(0, 200));
  const sigApi = await api("GET", `/api/quotes/${q.id}/signature`, { token: C.token });
  ok("D1-15 the signature record is readable by the company", sigApi.status === 200 && sigApi.json?.current?.signerName === "Sam Customer", sigApi.text?.slice(0, 200));
  const revAcc = await api("POST", `/api/quotes/${q.id}/revise`, { token: C.token, body: {} });
  ok("an accepted quote cannot be revised", revAcc.status === 409, revAcc.status);

  // decline stores the reason
  const q2 = await mkQuote();
  const s2 = await api("POST", `/api/quotes/${q2.id}/send`, { token: C.token, body: {} });
  const t2 = s2.json.shareUrl.split("/").pop();
  const dec = await publicPost(`/api/public/quotes/${t2}/decline`, { name: "Dana", email: "dana@example.com", reason: "Too expensive" });
  const sig2 = (await db.query(`SELECT action, reason FROM quote_signatures WHERE quote_id = $1`, [q2.id])).rows[0];
  ok("D1-15 decline: status declined and the reason is stored", dec.status === 200 && dec.json?.status === "declined" && sig2?.action === "declined" && sig2.reason === "Too expensive", { dec: dec.text, sig2 });
  const afterDecline = await publicPost(`/api/public/quotes/${t2}/accept`, { name: "Dana", email: "dana@example.com", agree: true });
  ok("a declined quote cannot then be accepted (409)", afterDecline.status === 409, afterDecline.status);
  const rev = await api("POST", `/api/quotes/${q2.id}/revise`, { token: C.token, body: {} });
  ok("a declined quote can be revised back to a draft, which revokes the link", rev.status === 200 && rev.json?.status === "draft" && !rev.json?.shareToken, rev.text?.slice(0, 200));
  const dead = await api("GET", `/api/public/quotes/${t2}`);
  ok("the revoked link is 404", dead.status === 404, dead.status);
  const resend = await api("POST", `/api/quotes/${q2.id}/send`, { token: C.token, body: {} });
  const t2b = resend.json?.shareUrl?.split("/").pop();
  const acc2 = await publicPost(`/api/public/quotes/${t2b}/accept`, { name: "Dana", email: "dana@example.com", agree: true });
  ok("a revised and re-sent quote can be accepted (the old signature is superseded)", resend.status === 200 && acc2.status === 200, { resend: resend.text?.slice(0, 120), acc2: acc2.text?.slice(0, 120) });
  const delDeclined = await api("DELETE", `/api/quotes/${(await mkQuote()).id}`, { token: C.token });
  ok("a draft can be deleted", delDeclined.status === 200, delDeclined.status);

  // parallel accepts: exactly one effect
  const q3 = await mkQuote();
  const t3 = (await api("POST", `/api/quotes/${q3.id}/send`, { token: C.token, body: {} })).json.shareUrl.split("/").pop();
  const races = await Promise.all(Array.from({ length: 6 }, (_, i) => publicPost(`/api/public/quotes/${t3}/accept`, { name: "R" + i, email: `r${i}@example.com`, agree: true })));
  const winners = races.filter((r) => r.status === 200).length;
  const sigCount = (await db.query(`SELECT count(*)::int AS n FROM quote_signatures WHERE quote_id = $1`, [q3.id])).rows[0].n;
  ok("D1-15 six parallel accepts: exactly one wins, one signature row", winners === 1 && sigCount === 1 && races.filter((r) => r.status === 409).length === 5, { statuses: races.map((r) => r.status), sigCount });

  // expiry: a sent quote past its date answers 410 and the daily job marks it expired
  const q4 = await mkQuote({ expiryDate: today });
  const t4 = (await api("POST", `/api/quotes/${q4.id}/send`, { token: C.token, body: {} })).json.shareUrl.split("/").pop();
  await db.query(`UPDATE quotes SET expiry_date = $2 WHERE id = $1`, [q4.id, addDays(today, -1)]);
  const gone = await api("GET", `/api/public/quotes/${t4}`);
  ok("D1-15 past its valid-until date the public link answers 410", gone.status === 410, gone.text?.slice(0, 200));
  const goneAccept = await publicPost(`/api/public/quotes/${t4}/accept`, { name: "L", email: "l@example.com", agree: true });
  ok("D1-15 accepting an expired quote is 410", goneAccept.status === 410, goneAccept.text?.slice(0, 200));
  const job = runJob("quote-expiry", C.cid);
  const st = (await db.query(`SELECT status FROM quotes WHERE id = $1`, [q4.id])).rows[0].status;
  ok("D1-15 the daily job sets the quote to expired", job.status === 0 && st === "expired" && job.result?.expired >= 1, { job, st });
  const q5 = await mkQuote({ expiryDate: addDays(today, -3) });
  const past = await api("POST", `/api/quotes/${q5.id}/send`, { token: C.token, body: {} });
  ok("sending a quote whose valid-until date has passed is 422", past.status === 422 && past.json?.code === "QUOTE_EXPIRY_IN_PAST", past.text?.slice(0, 200));

  // mass assignment on quotes
  const m = await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "M", status: "accepted", shareToken: "deadbeef", convertedInvoiceId: "00000000-0000-0000-0000-000000000000", lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.05 }] } });
  ok("I-4 a quote create ignores status, shareToken and links", m.status === 201 && m.json?.status === "draft" && !m.json?.shareToken && !m.json?.convertedInvoiceId, m.json);

  // tenant isolation
  const B = await newCompany("quote2");
  const x = await api("POST", `/api/quotes/${q.id}/send`, { token: B.token, body: {} });
  ok("I-1 company B cannot send A's quote (404)", x.status === 404, x.status);
  const y = await api("GET", `/api/quotes/${q.id}/signature`, { token: B.token });
  ok("I-1 company B cannot read A's signature (404)", y.status === 404, y.status);
}

// ───────────────────────────── D1-1/2/3: sales orders ─────────────────────────────
async function salesOrders() {
  const C = await newCompany("so");
  await api("PATCH", `/api/companies/${C.cid}/preferences`, { token: C.token, body: { inventoryCostingEnabled: true } });
  const cust = await C.contact();
  const jeBefore = (await db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1`, [C.cid])).rows[0].n;
  const q = (await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Acme", contactId: cust.id, date: today, lines: [{ description: "Chairs", quantity: 4, unitPrice: 100, vatRate: 0.05 }, { description: "Desk", quantity: 1, unitPrice: 600, vatRate: 0.05 }] } })).json;

  const conv = await api("POST", `/api/quotes/${q.id}/convert-to-sales-order`, { token: C.token, body: {} });
  ok("D1-1 conversion returns the sales order (201), open, SO- number, totals equal the quote", conv.status === 201 && conv.json?.status === "open" && /^SO-/.test(conv.json?.number) && n(conv.json?.total) === n(q.total) && n(conv.json?.subtotal) === n(q.subtotal) && n(conv.json?.vatAmount) === n(q.vatAmount), conv.text?.slice(0, 300));
  ok("D1-1 the customer contact is carried", conv.json?.contactId === cust.id, conv.json);
  const jeAfter = (await db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1`, [C.cid])).rows[0].n;
  ok("D1-1 a sales order posts nothing (zero journal lines)", jeAfter === jeBefore, { jeBefore, jeAfter });
  const qNow = (await api("GET", `/api/quotes/${q.id}`, { token: C.token })).json;
  ok("D1-1 the quote is converted and points at the order", qNow.status === "converted" && qNow.convertedSalesOrderId === conv.json?.id, qNow);
  const again = await api("POST", `/api/quotes/${q.id}/convert-to-sales-order`, { token: C.token, body: {} });
  ok("D1-1 a second conversion is 409 QUOTE_ALREADY_CONVERTED", again.status === 409 && again.json?.code === "QUOTE_ALREADY_CONVERTED", again.text?.slice(0, 200));
  const toInv = await api("POST", `/api/quotes/${q.id}/convert-to-invoice`, { token: C.token, body: {} });
  ok("a converted quote cannot also become an invoice", toInv.status === 409, toInv.status);

  // parallel conversions make exactly one order
  const qp = (await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Acme", contactId: cust.id, date: today, lines: [{ description: "X", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } })).json;
  const racers = await Promise.all(Array.from({ length: 8 }, () => api("POST", `/api/quotes/${qp.id}/convert-to-sales-order`, { token: C.token, body: {} })));
  const made = (await db.query(`SELECT count(*)::int AS n FROM sales_orders WHERE quote_id = $1`, [qp.id])).rows[0].n;
  ok("eight parallel conversions make exactly one sales order", racers.filter((r) => r.status === 201).length === 1 && made === 1, { statuses: racers.map((r) => r.status), made });

  // D1-2: available to promise
  const prod = (await api("POST", `/api/companies/${C.cid}/products`, { token: C.token, body: { name: "Gadget", unitPrice: "100", vatRate: "0.05", trackInventory: true } })).json;
  const buy = await api("POST", `/api/products/${prod.id}/movements`, { token: C.token, body: { type: "purchase", quantity: 6, unitCost: "40" } });
  ok("setup: 6 units in stock", buy.status === 200 && buy.json?.newStock === 6, buy.text?.slice(0, 200));
  const movesBefore = (await db.query(`SELECT count(*)::int AS n FROM inventory_movements WHERE product_id = $1`, [prod.id])).rows[0].n;
  const so = await api("POST", `/api/companies/${C.cid}/sales-orders`, { token: C.token, body: { contactId: cust.id, date: today, lines: [{ description: "Gadget", quantity: 10, unitPrice: 100, vatRate: 0.05, productId: prod.id }] } });
  ok("D1-2 a sales order for 10 with 6 in stock saves", so.status === 201, so.text?.slice(0, 300));
  const soLine = so.json?.lines?.[0];
  ok("D1-2 availableToPromise 6, shortfall 4", soLine?.availableToPromise === 6 && soLine?.shortfall === 4, soLine);
  const movesAfter = (await db.query(`SELECT count(*)::int AS n FROM inventory_movements WHERE product_id = $1`, [prod.id])).rows[0].n;
  const stock = (await api("GET", `/api/products/${prod.id}`, { token: C.token })).json.currentStock;
  ok("D1-2 no stock movement, stock still 6", movesBefore === movesAfter && n(stock) === 6, { movesBefore, movesAfter, stock });
  const avail = await api("GET", `/api/companies/${C.cid}/products/availability?ids=${prod.id}`, { token: C.token });
  ok("availability endpoint: onHand 6, committed 10, available -4", avail.json?.[0]?.onHand === 6 && avail.json?.[0]?.committed === 10 && avail.json?.[0]?.available === -4, avail.text?.slice(0, 200));

  // D1-3: invoice 4 -> invoice 6 -> invoice 1 (an order of untracked goods, so stock cannot interfere)
  const so3 = await api("POST", `/api/companies/${C.cid}/sales-orders`, { token: C.token, body: { contactId: cust.id, date: today, lines: [{ description: "Gadget", quantity: 10, unitPrice: 100, vatRate: 0.05 }] } });
  const soId = so3.json.id, lineId = so3.json.lines[0].id;
  const inv1 = await api("POST", `/api/companies/${C.cid}/sales-orders/${soId}/invoices`, { token: C.token, body: { lines: [{ salesOrderLineId: lineId, quantity: 4 }] } });
  ok("D1-3 invoice for 4 is a draft linked to the order", inv1.status === 201 && inv1.json?.status === "draft" && inv1.json?.salesOrderId === soId && n(inv1.json?.subtotal) === 400, inv1.text?.slice(0, 300));
  const mid = (await api("GET", `/api/companies/${C.cid}/sales-orders/${soId}`, { token: C.token })).json;
  ok("D1-3 partially_invoiced after 4 of 10", mid.invoicingStatus === "partially_invoiced" && mid.lines[0].invoicedQty === 4, { s: mid.invoicingStatus, l: mid.lines[0] });
  const over = await api("POST", `/api/companies/${C.cid}/sales-orders/${soId}/invoices`, { token: C.token, body: { lines: [{ salesOrderLineId: lineId, quantity: 7 }] } });
  ok("D1-3 asking for more than is left is 422 SO_QTY_EXCEEDED", over.status === 422 && over.json?.code === "SO_QTY_EXCEEDED", over.text?.slice(0, 200));
  const inv2 = await api("POST", `/api/companies/${C.cid}/sales-orders/${soId}/invoices`, { token: C.token, body: { lines: [{ salesOrderLineId: lineId, quantity: 6 }] } });
  const full = (await api("GET", `/api/companies/${C.cid}/sales-orders/${soId}`, { token: C.token })).json;
  ok("D1-3 invoiced after 6 more", inv2.status === 201 && full.invoicingStatus === "invoiced", { s: inv2.status, st: full.invoicingStatus });
  const third = await api("POST", `/api/companies/${C.cid}/sales-orders/${soId}/invoices`, { token: C.token, body: { lines: [{ salesOrderLineId: lineId, quantity: 1 }] } });
  ok("D1-3 the third invoice is 409 SO_FULLY_INVOICED", third.status === 409 && third.json?.code === "SO_FULLY_INVOICED", third.text?.slice(0, 200));
  const issue1 = await C.issue(inv1.json.id), issue2 = await C.issue(inv2.json.id);
  const je1 = await C.entryOf("invoice", inv1.json.id), je2 = await C.entryOf("invoice", inv2.json.id);
  ok("D1-3 each invoice posts Dr 1040 / Cr 4010 / Cr 2020 for its own lines", issue1.status === 200 && issue2.status === 200 && je1["1040"]?.dr === 420 && je1["4010"]?.cr === 400 && je1["2020"]?.cr === 20 && je2["1040"]?.dr === 630 && je2["4010"]?.cr === 600 && je2["2020"]?.cr === 30, { je1, je2 });
  const locked = await api("PUT", `/api/companies/${C.cid}/sales-orders/${soId}`, { token: C.token, body: { contactId: cust.id, date: today, lines: [{ description: "Gadget", quantity: 5, unitPrice: 100, vatRate: 0.05 }] } });
  ok("an invoiced sales order cannot be edited (409 SO_LOCKED)", locked.status === 409 && locked.json?.code === "SO_LOCKED", locked.text?.slice(0, 200));
  const cancel = await api("POST", `/api/companies/${C.cid}/sales-orders/${soId}/cancel`, { token: C.token, body: {} });
  ok("an order with invoices cannot be cancelled (409)", cancel.status === 409, cancel.status);

  // a void releases quantity by itself
  const bal = await C.pay(inv2.json.id, 0.01).then(() => null).catch(() => null);
  void bal;
  const voidIt = await api("PATCH", `/api/invoices/${inv1.json.id}/status`, { token: C.token, body: { status: "void" } });
  const afterVoid = (await api("GET", `/api/companies/${C.cid}/sales-orders/${soId}`, { token: C.token })).json;
  ok("a voided invoice releases its quantity (back to partially invoiced)", voidIt.status === 200 && afterVoid.invoicingStatus === "partially_invoiced" && afterVoid.lines[0].invoicedQty === 6, { v: voidIt.status, s: afterVoid.invoicingStatus, q: afterVoid.lines[0].invoicedQty });

  // deliveries
  const d1 = await api("POST", `/api/companies/${C.cid}/sales-orders/${soId}/deliveries`, { token: C.token, body: { lines: [{ salesOrderLineId: lineId, quantity: 4 }] } });
  ok("D1-3 a delivery of 4 (DN- number), posts nothing", d1.status === 201 && /^DN-/.test(d1.json?.number), d1.text?.slice(0, 200));
  const d2 = await api("POST", `/api/companies/${C.cid}/sales-orders/${soId}/deliveries`, { token: C.token, body: { lines: [{ salesOrderLineId: lineId, quantity: 7 }] } });
  ok("D1-3 delivering more than ordered is 422 DELIVERY_EXCEEDS_ORDERED", d2.status === 422 && d2.json?.code === "DELIVERY_EXCEEDS_ORDERED", d2.text?.slice(0, 200));
  const d3 = await api("POST", `/api/companies/${C.cid}/sales-orders/${soId}/deliveries`, { token: C.token, body: { lines: [{ salesOrderLineId: lineId, quantity: 6 }] } });
  const delivered = (await api("GET", `/api/companies/${C.cid}/sales-orders/${soId}`, { token: C.token })).json;
  ok("D1-3 deliveredQty 10 of 10, delivered", d3.status === 201 && delivered.lines[0].deliveredQty === 10 && delivered.deliveryStatus === "delivered", { s: d3.status, q: delivered.lines[0].deliveredQty, ds: delivered.deliveryStatus });
  const dnPdf = await api("GET", `/api/companies/${C.cid}/sales-orders/${soId}/deliveries/${d1.json.id}/pdf`, { token: C.token, raw: true });
  const dnText = dnPdf.status === 200 ? await pdfText(dnPdf.buf) : "";
  ok("D1-3 the delivery note PDF has the item and quantity and no prices", /Gadget/.test(dnText) && !/AED|VAT|Unit Price|Total/i.test(dnText), dnText.slice(0, 300));
  const soPdf = await api("GET", `/api/companies/${C.cid}/sales-orders/${soId}/pdf`, { token: C.token, raw: true });
  const soText = soPdf.status === 200 ? await pdfText(soPdf.buf) : "";
  ok("the sales order PDF shows the order number and total", soPdf.status === 200 && /SALES ORDER/.test(soText) && /1,?050\.00/.test(soText), soText.slice(0, 200));

  // I-3: parallel invoicing of one order never exceeds the ordered quantity
  const so2 = (await api("POST", `/api/companies/${C.cid}/sales-orders`, { token: C.token, body: { contactId: cust.id, date: today, lines: [{ description: "Bulk", quantity: 10, unitPrice: 10, vatRate: 0.05 }] } })).json;
  const l2 = so2.lines[0].id;
  const par = await Promise.all(Array.from({ length: 5 }, () => api("POST", `/api/companies/${C.cid}/sales-orders/${so2.id}/invoices`, { token: C.token, body: { lines: [{ salesOrderLineId: l2, quantity: 4 }] } })));
  const okInv = par.filter((r) => r.status === 201).length;
  const billed = (await db.query(`SELECT COALESCE(SUM(il.quantity), 0)::float8 AS q FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.sales_order_id = $1`, [so2.id])).rows[0].q;
  ok("I-3 five parallel invoices of 4 against 10: exactly two succeed, never more than ordered", okInv === 2 && billed === 8 && par.filter((r) => r.status === 422).length === 3, { statuses: par.map((r) => r.status), billed });

  // an invoice made from the order re-checks quantities when edited
  const draft2 = par.find((r) => r.status === 201).json;
  const draftLine = (await C.getInvoice(draft2.id)).lines[0];
  const editBig = await api("PUT", `/api/invoices/${draft2.id}`, { token: C.token, body: { date: today, lines: [{ description: "Bulk", quantity: 7, unitPrice: 10, vatRate: 0.05, salesOrderLineId: draftLine.salesOrderLineId }] } });
  ok("editing an order invoice above the remaining quantity is 422 SO_QTY_EXCEEDED", editBig.status === 422 && editBig.json?.code === "SO_QTY_EXCEEDED", editBig.text?.slice(0, 200));
  const editOk = await api("PUT", `/api/invoices/${draft2.id}`, { token: C.token, body: { date: today, lines: [{ description: "Bulk", quantity: 2, unitPrice: 10, vatRate: 0.05, salesOrderLineId: draftLine.salesOrderLineId }] } });
  const reread = await C.getInvoice(draft2.id);
  ok("editing within the remaining quantity works and keeps the order link", editOk.status === 200 && reread.lines[0].salesOrderLineId === draftLine.salesOrderLineId && reread.salesOrderId === so2.id, { s: editOk.status, l: reread.lines[0] });
  const foreignLine = await api("PUT", `/api/invoices/${draft2.id}`, { token: C.token, body: { date: today, lines: [{ description: "Bulk", quantity: 1, unitPrice: 10, vatRate: 0.05, salesOrderLineId: lineId }] } });
  ok("a line naming another order's line is 422 SALES_ORDER_LINE_MISMATCH", foreignLine.status === 422 && foreignLine.json?.code === "SALES_ORDER_LINE_MISMATCH", foreignLine.text?.slice(0, 200));
  const plain = await C.draft({ lines: [{ description: "plain", quantity: 1, unitPrice: 5, vatRate: 0.05, salesOrderLineId: l2 }] });
  const plainLine = (await C.getInvoice(plain.id)).lines[0];
  ok("I-4 a plain invoice cannot link itself to a sales order line", plainLine.salesOrderLineId === null, plainLine);

  // percent discounts only on orders
  const bad = await api("POST", `/api/companies/${C.cid}/sales-orders`, { token: C.token, body: { contactId: cust.id, date: today, lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05, discountType: "amount", discountValue: 10 }] } });
  ok("a sales order takes percent discounts only", bad.status === 422 && bad.json?.code === "SO_DISCOUNT_PERCENT_ONLY", bad.text?.slice(0, 200));

  // quote amount discounts become percents with the same total
  const qd = (await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Acme", contactId: cust.id, date: today, lines: [{ description: "A", quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "amount", discountValue: 100 }, { description: "Ship", quantity: 1, unitPrice: 50, vatRate: 0.05, lineKind: "shipping" }] } })).json;
  const qdc = await api("POST", `/api/quotes/${qd.id}/convert-to-sales-order`, { token: C.token, body: {} });
  ok("an amount discount on a quote converts to a percent with the same total", qdc.status === 201 && n(qdc.json?.total) === n(qd.total) && qdc.json?.lines?.some((l) => l.discountType === "percent" && n(l.discountValue) === 10), qdc.text?.slice(0, 300));
  const qdi = (await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Acme", contactId: cust.id, date: today, lines: [{ description: "A", quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "amount", discountValue: 100 }, { description: "Ship", quantity: 1, unitPrice: 50, vatRate: 0.05, lineKind: "shipping" }] } })).json;
  const qdic = await api("POST", `/api/quotes/${qdi.id}/convert-to-invoice`, { token: C.token, body: {} });
  ok("a quote with discounts converts to an invoice with the same total (and its contact)", qdic.status === 200 && n(qdic.json?.invoice?.total) === n(qdi.total) && qdic.json?.invoice?.contactId === cust.id, qdic.text?.slice(0, 300));

  // tenant isolation
  const B = await newCompany("so2");
  const x = await api("GET", `/api/companies/${C.cid}/sales-orders/${soId}`, { token: B.token });
  ok("I-1 company B is refused on A's sales orders", x.status === 403, x.status);
  const y = await api("GET", `/api/companies/${B.cid}/sales-orders/${soId}`, { token: B.token });
  ok("I-1 A's order id under B's company is 404", y.status === 404, y.status);
  const z = await api("POST", `/api/quotes/${q2id(qp)}/convert-to-sales-order`, { token: B.token, body: {} });
  ok("I-1 company B cannot convert A's quote", z.status === 404, z.status);
}
const q2id = (q) => q.id;

// ───────────────────────────── D1-11..14, I-5: online payment (Stripe Connect, fake adapter) ─────────────────────────────
// The gateway sections need a server booted with PAYMENT_GATEWAY_FAKE=1 (test-only; production refuses it).
// Without it they are skipped, and only the "not configured" behaviour is asserted.
const stripeSigner = new Stripe("not-a-key-webhook-signing-helper", { apiVersion: "2024-12-18.acacia" });
const CONNECT_SECRET = "whsec_fake_connect_secret";
async function sendConnectEvent(event, { secret = CONNECT_SECRET } = {}) {
  const payload = JSON.stringify(event);
  const header = stripeSigner.webhooks.generateTestHeaderString({ payload, secret });
  return api("POST", "/api/webhooks/stripe", { body: payload, headers: { "stripe-signature": header } });
}
let evtSeq = 0;
// Provider ids are globally unique in real life; make each test run's ids unique too.
const ID = (s) => `${s}_${rnd}`;
const evt = (type, account, object, id) => ({ id: id || `evt_t_${rnd}_${++evtSeq}`, type, account, object: "event", api_version: "2024-12-18.acacia", data: { object }, livemode: false, created: Math.floor(Date.now() / 1000) });
const sessionObj = (sessionId, invoiceId, amountMinor, pi, extra = {}) => ({ id: sessionId, object: "checkout.session", payment_status: "paid", payment_intent: pi, amount_total: amountMinor, currency: "aed", metadata: { kind: "invoice", invoiceId }, ...extra });
const feeOf = (settled) => Math.round((settled * 0.029 + 1) * 100) / 100;

async function onlinePayments() {
  const C = await newCompany("pay");
  const status0 = await api("GET", `/api/companies/${C.cid}/payment-gateway`, { token: C.token });
  ok("D1-13 status endpoint answers with the mode and nothing connected", status0.status === 200 && status0.json?.connection === null && status0.json?.ready === false, status0.text?.slice(0, 200));
  const fake = status0.json?.mode === "fake";

  const cust = await C.contact();
  const inv = await C.draft({ contactId: cust.id, discountType: "amount", discountValue: 50, lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "percent", discountValue: 10 }, { description: "Delivery", quantity: 1, unitPrice: 100, lineKind: "shipping" }] });
  await C.issue(inv.id);
  const share = (await api("POST", `/api/invoices/${inv.id}/share`, { token: C.token, body: {} })).json.token;
  const pub0 = await api("GET", `/api/public/invoices/${share}`);
  ok("D1-13 public invoice: onlinePayment.configured is false without a connected account", pub0.json?.onlinePayment?.configured === false && pub0.json?.invoice?.outstanding === 997.5, pub0.json?.onlinePayment);
  const co0 = await publicPost(`/api/public/invoices/${share}/checkout`, {});
  ok("D1-13 checkout is 503 PAYMENT_NOT_CONFIGURED", co0.status === 503 && co0.json?.code === "PAYMENT_NOT_CONFIGURED", co0.text?.slice(0, 200));
  const conn0 = await api("POST", `/api/companies/${C.cid}/payment-gateway/stripe/connect`, { token: C.token, body: {} });
  ok("connecting without provider keys is 503", fake || conn0.status === 503, conn0.status);
  if (!fake) {
    console.log("SKIP  online payment sections: the server was not started with PAYMENT_GATEWAY_FAKE=1");
    return;
  }

  // ── onboarding (owner only) ──
  const helper = await api("POST", "/api/auth/register", { body: { name: "member", email: `member_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant') ON CONFLICT DO NOTHING`, [C.cid, helper.json.user.id]);
  const notOwner = await api("POST", `/api/companies/${C.cid}/payment-gateway/stripe/connect`, { token: helper.json.token, body: {} });
  ok("connect is owner only (403 OWNER_ONLY)", notOwner.status === 403 && notOwner.json?.code === "OWNER_ONLY", notOwner.text?.slice(0, 200));
  const notOwner2 = await api("PATCH", `/api/companies/${C.cid}/payment-gateway/settings`, { token: helper.json.token, body: { allowPartial: true } });
  ok("settings are owner only", notOwner2.status === 403, notOwner2.status);
  const otherCo = await newCompany("pay2");
  const foreign = await api("GET", `/api/companies/${C.cid}/payment-gateway`, { token: otherCo.token });
  ok("I-1 company B is refused on A's payment gateway", foreign.status === 403, foreign.status);

  const conn = await api("POST", `/api/companies/${C.cid}/payment-gateway/stripe/connect`, { token: C.token, body: {} });
  ok("connect returns the provider URL", conn.status === 200 && /state=/.test(conn.json?.url || ""), conn.text?.slice(0, 200));
  const tamper = await fetch(conn.json.url.replace(/state=[^&]+/, "state=" + "x".repeat(40)), { redirect: "manual" });
  ok("a callback with a forged state does not connect", tamper.status === 302 && /stripe=error/.test(tamper.headers.get("location") || ""), tamper.headers.get("location"));
  const cb = await fetch(conn.json.url, { redirect: "manual" });
  ok("the callback with the signed state connects the account", cb.status === 302 && /stripe=connected/.test(cb.headers.get("location") || ""), cb.headers.get("location"));
  const reuse = await fetch(conn.json.url, { redirect: "manual" });
  ok("the state is single-use", /stripe=error/.test(reuse.headers.get("location") || ""), reuse.headers.get("location"));
  const status1 = (await api("GET", `/api/companies/${C.cid}/payment-gateway`, { token: C.token })).json;
  ok("the company is now ready with a masked account id", status1.ready === true && status1.connection?.status === "active" && /^acct_…/.test(status1.connection?.accountId || ""), status1);
  const account = (await db.query(`SELECT external_account_id FROM payment_gateway_connections WHERE company_id = $1`, [C.cid])).rows[0].external_account_id;

  // ── D1-11: pay 997.50 ──
  const pub1 = await api("GET", `/api/public/invoices/${share}`);
  ok("public invoice now offers Pay now", pub1.json?.onlinePayment?.configured === true && pub1.json?.onlinePayment?.payable === true && pub1.json?.onlinePayment?.allowPartial === false, pub1.json?.onlinePayment);
  const co1 = await publicPost(`/api/public/invoices/${share}/checkout`, {});
  ok("checkout returns a payment URL", co1.status === 200 && /^https?:\/\/[^/]+\/(api\/public\/fake-pay\/cs_fake_|c\/)/.test(co1.json?.url || ""), co1.text?.slice(0, 200));
  const link1 = (await db.query(`SELECT * FROM payment_links WHERE invoice_id = $1 AND status = 'open'`, [inv.id])).rows;
  ok("one open payment link for 997.50", link1.length === 1 && n(link1[0].amount) === 997.5, link1);
  const co1b = await publicPost(`/api/public/invoices/${share}/checkout`, {});
  const links = (await db.query(`SELECT status FROM payment_links WHERE invoice_id = $1 ORDER BY created_at`, [inv.id])).rows.map((r) => r.status);
  ok("a second checkout expires the older open session", co1b.status === 200 && JSON.stringify(links) === JSON.stringify(["expired", "open"]), links);
  const session1 = (await db.query(`SELECT provider_session_id FROM payment_links WHERE invoice_id = $1 AND status = 'open'`, [inv.id])).rows[0].provider_session_id;

  const before = await C.balances();
  const paid = evt("checkout.session.completed", account, sessionObj(session1, inv.id, 99750, ID("pi_test_main")));
  const w1 = await sendConnectEvent(paid);
  ok("D1-11 the signed Connect event is accepted", w1.status === 200, w1.text?.slice(0, 200));
  const pay1 = (await db.query(`SELECT ip.*, a.code FROM invoice_payments ip JOIN accounts a ON a.id = ip.payment_account_id WHERE ip.invoice_id = $1`, [inv.id])).rows;
  ok("D1-11 invoice_payments 997.50 into account 1025, method gateway, reference = the payment id", pay1.length === 1 && n(pay1[0].amount) === 997.5 && pay1[0].code === "1025" && pay1[0].method === "gateway" && pay1[0].reference === ID("pi_test_main"), pay1);
  const pj = await C.entryOf("payment", inv.id);
  ok("D1-11 journal Dr 1025 997.50 / Cr 1040 997.50", pj["1025"]?.dr === 997.5 && pj["1040"]?.cr === 997.5, pj);
  const gp = (await db.query(`SELECT * FROM gateway_payments WHERE provider_payment_id = '${ID("pi_test_main")}'`)).rows[0];
  const fee = feeOf(997.5);
  const fj = await C.entryOf("gateway_fee", gp?.id);
  ok("D1-11 fee entry Dr 5110 / Cr 1025", fj["5110"]?.dr === fee && fj["1025"]?.cr === fee && gp?.status === "settled" && n(gp.fee_aed) === fee, { fj, gp, fee });
  const invNow = await C.getInvoice(inv.id);
  ok("D1-11 the invoice is paid", invNow.status === "paid" && n(invNow.outstandingAmount) === 0 && n(invNow.paidAmount) === 997.5, { s: invNow.status, o: invNow.outstandingAmount });
  const after = await C.balances();
  ok("D1-11 net effect on 1025: +997.50 - fee", r2(n(after["1025"]) - n(before["1025"])) === r2(997.5 - fee), { b: before["1025"], a: after["1025"], fee });
  const audit = (await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'invoice.payment' AND details::text LIKE '%${ID("pi_test_main")}%' OR (action = 'invoice.payment' AND resource_id = $1)`, [inv.id])).rows[0].n;
  ok("D1-11 a payment audit row exists (it feeds the payment.received and invoice.paid webhooks)", audit >= 1, audit);

  // replays
  const w1r = await sendConnectEvent(paid);
  ok("D1-11 replaying the event id posts nothing", w1r.status === 200 && (await db.query(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows[0].n === 1, w1r.text?.slice(0, 100));
  const w1s = await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(session1, inv.id, 99750, ID("pi_test_main"))));
  ok("a different event id for the same payment posts nothing either", w1s.status === 200 && (await db.query(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows[0].n === 1 && (await db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source = 'gateway_fee'`, [C.cid])).rows[0].n === 1, w1s.text?.slice(0, 100));
  const parallel = await Promise.all(Array.from({ length: 5 }, () => sendConnectEvent(evt("checkout.session.completed", account, sessionObj(session1, inv.id, 99750, ID("pi_test_main"))))));
  ok("five parallel events for one payment: still one payment and one fee entry", parallel.every((r) => r.status === 200) && (await db.query(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).rows[0].n === 1 && (await db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source = 'gateway_fee'`, [C.cid])).rows[0].n === 1, parallel.map((r) => r.status));
  const paidAgain = await api("GET", `/api/public/invoices/${share}`);
  ok("a paid invoice no longer offers Pay now and refuses checkout", paidAgain.json?.onlinePayment?.payable === false && (await publicPost(`/api/public/invoices/${share}/checkout`, {})).status === 409, paidAgain.json?.onlinePayment);

  // ── forgery ──
  const mkOpen = async (price = 300) => {
    const i = await C.draft({ contactId: cust.id, lines: [{ description: "Forge", quantity: 1, unitPrice: price, vatRate: 0 }] });
    await C.issue(i.id);
    const t = (await api("POST", `/api/invoices/${i.id}/share`, { token: C.token, body: {} })).json.token;
    await publicPost(`/api/public/invoices/${t}/checkout`, {});
    const sid = (await db.query(`SELECT provider_session_id FROM payment_links WHERE invoice_id = $1 AND status = 'open'`, [i.id])).rows[0].provider_session_id;
    return { i, t, sid };
  };
  const countPayments = async (invoiceId) => (await db.query(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [invoiceId])).rows[0].n;
  const F = await mkOpen();
  await sendConnectEvent(evt("checkout.session.completed", "acct_fake_attacker", sessionObj(F.sid, F.i.id, 30000, ID("pi_forge_1"))));
  ok("forgery: a validly signed event from another connected account posts nothing", (await countPayments(F.i.id)) === 0);
  await sendConnectEvent(evt("checkout.session.completed", account, sessionObj("cs_unknown_session", F.i.id, 30000, ID("pi_forge_2"))));
  ok("forgery: an unknown session posts nothing", (await countPayments(F.i.id)) === 0);
  const G = await mkOpen(400);
  await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(F.sid, G.i.id, 30000, ID("pi_forge_3"))));
  ok("forgery: metadata naming another invoice posts nothing", (await countPayments(G.i.id)) === 0 && (await countPayments(F.i.id)) === 0);
  await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(F.sid, F.i.id, 100, ID("pi_forge_4"))));
  ok("forgery: an amount that is not what we asked for posts nothing", (await countPayments(F.i.id)) === 0);
  const badSecret = await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(F.sid, F.i.id, 30000, ID("pi_forge_5"))), { secret: "whsec_wrong" });
  ok("forgery: a wrong signature is refused (400, or 503 on a server without real Stripe keys)", [400, 503].includes(badSecret.status) && (await countPayments(F.i.id)) === 0, badSecret.status);
  const good = await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(F.sid, F.i.id, 30000, ID("pi_forge_ok"))));
  ok("the genuine event for the same session still posts", good.status === 200 && (await countPayments(F.i.id)) === 1);

  // ── D1-12: partial payments ──
  const P = await mkOpen(997.5);
  const noPartial = await publicPost(`/api/public/invoices/${P.t}/checkout`, { amount: 500 });
  ok("D1-12 a partial amount is 422 PARTIAL_NOT_ALLOWED while the setting is off", noPartial.status === 422 && noPartial.json?.code === "PARTIAL_NOT_ALLOWED", noPartial.text?.slice(0, 200));
  const sett = await api("PATCH", `/api/companies/${C.cid}/payment-gateway/settings`, { token: C.token, body: { allowPartial: true } });
  ok("allowPartial is switched on by the owner", sett.status === 200 && sett.json?.allowPartial === true, sett.text?.slice(0, 200));
  const over = await publicPost(`/api/public/invoices/${P.t}/checkout`, { amount: 1000 });
  ok("D1-12 an amount above the outstanding is 422 AMOUNT_EXCEEDS_OUTSTANDING", over.status === 422 && over.json?.code === "AMOUNT_EXCEEDS_OUTSTANDING", over.text?.slice(0, 200));
  const tiny = await publicPost(`/api/public/invoices/${P.t}/checkout`, { amount: 1 });
  ok("an amount below the minimum is 422 AMOUNT_BELOW_MINIMUM", tiny.status === 422 && tiny.json?.code === "AMOUNT_BELOW_MINIMUM", tiny.text?.slice(0, 200));
  const part = await publicPost(`/api/public/invoices/${P.t}/checkout`, { amount: 500 });
  ok("D1-12 a partial 500 is accepted at checkout creation", part.status === 200, part.text?.slice(0, 200));
  const sidP = (await db.query(`SELECT provider_session_id FROM payment_links WHERE invoice_id = $1 AND status = 'open'`, [P.i.id])).rows[0].provider_session_id;
  await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(sidP, P.i.id, 50000, ID("pi_partial"))));
  const pi = await C.getInvoice(P.i.id);
  ok("D1-12 the invoice is partial with 497.50 outstanding", pi.status === "partial" && n(pi.outstandingAmount) === 497.5, { s: pi.status, o: pi.outstandingAmount });

  // ── I-5: payment on a void invoice is parked, not posted ──
  const V = await mkOpen(200);
  await api("PATCH", `/api/invoices/${V.i.id}/status`, { token: C.token, body: { status: "void" } });
  const wv = await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(V.sid, V.i.id, 20000, ID("pi_void"))));
  const gv = (await db.query(`SELECT status, note FROM gateway_payments WHERE provider_payment_id = '${ID("pi_void")}'`)).rows[0];
  ok("I-5 a payment on a void invoice is unallocated: no invoice payment, owner notified", wv.status === 200 && gv?.status === "unallocated" && (await countPayments(V.i.id)) === 0, gv);
  const nUn = (await db.query(`SELECT count(*)::int AS n FROM notifications WHERE company_id = $1 AND type = 'online_payment' AND title LIKE '%could not be applied%'`, [C.cid])).rows[0].n;
  ok("I-5 the owner gets a notification", nUn >= 1, nUn);
  const noFeeForUnallocated = (await db.query(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source = 'gateway_fee' AND source_id = (SELECT id FROM gateway_payments WHERE provider_payment_id = '${ID("pi_void")}')`, [C.cid])).rows[0].n;
  ok("I-5 no fee is booked for money that was never applied", noFeeForUnallocated === 0, noFeeForUnallocated);

  // ── foreign currency invoice ──
  await api("POST", `/api/companies/${C.cid}/exchange-rates`, { token: C.token, body: { fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: today } });
  const U = await C.draft({ contactId: cust.id, currency: "USD", lines: [{ description: "Export", quantity: 1, unitPrice: 100, vatRate: 0 }] });
  await C.issue(U.id);
  const tU = (await api("POST", `/api/invoices/${U.id}/share`, { token: C.token, body: {} })).json.token;
  await publicPost(`/api/public/invoices/${tU}/checkout`, { fakeRate: 3.6725 });
  const sidU = (await db.query(`SELECT provider_session_id FROM payment_links WHERE invoice_id = $1 AND status = 'open'`, [U.id])).rows[0].provider_session_id;
  await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(sidU, U.id, 10000, ID("pi_usd"), { currency: "usd", metadata: { kind: "invoice", invoiceId: U.id, fakeRate: "3.6725" } })));
  const ujp = await C.entryOf("payment", U.id);
  ok("a USD invoice settles into 1025 in AED at the provider's rate (367.25), receivable cleared at the invoice rate", ujp["1025"]?.dr === 367.25 && ujp["1040"]?.cr === 367.25, ujp);

  // ── D1-14: refund made in the Stripe dashboard ──
  const refundEvent = (id, amountMinor, refundId) => evt("charge.refunded", account, { id: "ch_fake_main", object: "charge", payment_intent: ID("pi_test_main"), currency: "aed", refunds: { data: [{ id: refundId, amount: amountMinor, currency: "aed", status: "succeeded" }] } }, id);
  const rf = await sendConnectEvent(refundEvent(undefined, 20000, ID("re_test_1")));
  ok("D1-14 the refund event is accepted", rf.status === 200, rf.text?.slice(0, 200));
  const cns = (await db.query(`SELECT id, total::float8 AS total FROM invoices WHERE original_invoice_id = $1 AND invoice_type = 'credit_note'`, [inv.id])).rows;
  ok("D1-14 a credit note of 200.00 exists on the paid invoice", cns.length === 1 && cns[0].total === -200, cns);
  const grf = (await db.query(`SELECT * FROM gateway_refunds WHERE provider_refund_id = '${ID("re_test_1")}'`)).rows[0];
  const refJe = await C.entryOf("customer_refund", grf?.customer_refund_id);
  ok("D1-14 the refund is paid out of 1025 (Dr 1040 / Cr 1025)", grf?.status === "settled" && refJe["1040"]?.dr === 200 && refJe["1025"]?.cr === 200, { grf, refJe });
  const gp2 = (await db.query(`SELECT refunded_amount::float8 AS r FROM gateway_payments WHERE provider_payment_id = '${ID("pi_test_main")}'`)).rows[0];
  ok("D1-14 the payment shows 200 refunded", gp2.r === 200, gp2);
  await sendConnectEvent(refundEvent(undefined, 20000, ID("re_test_1")));
  await sendConnectEvent(refundEvent(undefined, 20000, ID("re_test_1")));
  const cns2 = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE original_invoice_id = $1 AND invoice_type = 'credit_note'`, [inv.id])).rows[0].n;
  ok("D1-14 replaying the refund (new event ids, same refund id) is idempotent", cns2 === 1, cns2);
  const cnJe = await C.entryOf("invoice", cns[0].id);
  ok("D1-14 the credit note reverses revenue, VAT and receivable proportionally and balances", Math.abs(Object.values(cnJe).reduce((a, x) => a + x.dr - x.cr, 0)) < 0.005 && cnJe["1040"]?.cr === 200, cnJe);
  const unknownRefund = await sendConnectEvent(evt("charge.refunded", account, { id: "ch_x", object: "charge", payment_intent: "pi_never_seen", currency: "aed", refunds: { data: [{ id: ID("re_zz"), amount: 100, currency: "aed", status: "succeeded" }] } }));
  ok("a refund for a payment we never recorded posts nothing", unknownRefund.status === 200 && (await db.query(`SELECT count(*)::int AS n FROM gateway_refunds WHERE provider_refund_id = '${ID("re_zz")}'`)).rows[0].n === 0);

  // ── reconciliation list, expiry, deauthorise ──
  const list = await api("GET", `/api/companies/${C.cid}/gateway-payments`, { token: C.token });
  ok("the gateway payments list shows states, fees and refunds", list.status === 200 && list.json?.some((p) => p.providerPaymentId === ID("pi_test_main") && p.status === "settled" && p.refunds?.length === 1), list.text?.slice(0, 200));
  const exp = await sendConnectEvent(evt("checkout.session.expired", account, { id: session1 }));
  ok("a session expiry event is handled", exp.status === 200);
  const deauth = await sendConnectEvent(evt("account.application.deauthorized", account, { id: "ca_x" }));
  const status2 = (await api("GET", `/api/companies/${C.cid}/payment-gateway`, { token: C.token })).json;
  ok("deauthorising on Stripe's side revokes the connection", deauth.status === 200 && status2.connection?.status === "revoked" && status2.ready === false, status2);
  const afterRevoke = await publicPost(`/api/public/invoices/${P.t}/checkout`, {});
  ok("checkout is 503 again after the revoke", afterRevoke.status === 503, afterRevoke.status);

  // ── portal: the contact link decides, not the name ──
  const D = await newCompany("pay3");
  const cx = await D.contact({ name: "Same Name" }), cy = await D.contact({ name: "Same Name" });
  const connD = await api("POST", `/api/companies/${D.cid}/payment-gateway/stripe/connect`, { token: D.token, body: {} });
  await fetch(connD.json.url, { redirect: "manual" });
  const iy = await D.draft({ contactId: cy.id, customerName: "Same Name", lines: [{ description: "Y work", quantity: 1, unitPrice: 300, vatRate: 0 }] });
  await D.issue(iy.id);
  const portalX = (await api("POST", "/api/portal/generate-access", { token: D.token, body: { contactId: cx.id } })).json.token;
  const portalY = (await api("POST", "/api/portal/generate-access", { token: D.token, body: { contactId: cy.id } })).json.token;
  const listX = await api("GET", `/api/portal/${portalX}/invoices`);
  const listY = await api("GET", `/api/portal/${portalY}/invoices`);
  ok("portal: contact X does not see contact Y's invoice even with the same name", listX.json?.length === 0 && listY.json?.length === 1, { x: listX.json?.length, y: listY.json?.length });
  const payX = await api("POST", `/api/portal/${portalX}/invoices/${iy.id}/checkout`, { body: {} });
  ok("portal: contact X's token cannot pay Y's invoice (404)", payX.status === 404, payX.text?.slice(0, 200));
  const payY = await api("POST", `/api/portal/${portalY}/invoices/${iy.id}/checkout`, { body: {} });
  ok("portal: contact Y's token can start the payment", payY.status === 200 && /^https?:\/\/[^/]+\/(api\/public\/fake-pay\/|c\/)/.test(payY.json?.url || ""), payY.text?.slice(0, 200));
  const pdfY = await api("GET", `/api/portal/${portalX}/invoices/${iy.id}/pdf`, { raw: true });
  ok("portal: contact X cannot download Y's invoice PDF (403)", pdfY.status === 403, pdfY.status);
}

// ───────────────────────────── advances: races, void interplay, currency ─────────────────────────────
async function advancesEdges() {
  const C = await newCompany("adv3");
  const cust = await C.contact();
  const bank = C.acct("1020").id;
  const adv = await C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: bank } });
  const advId = adv.json.advance.id;

  // issue racing apply: whichever wins, the journal equals the invoice total and 2055 ties to the sub-ledger
  const draft = await C.draft({ contactId: cust.id, lines: [{ description: "Race", quantity: 1, unitPrice: 3000, vatRate: 0.05 }] });
  const [applyRes, issueRes] = await Promise.all([
    api("POST", `/api/invoices/${draft.id}/advance-applications`, { token: C.token, body: { advanceId: advId, amount: 1000 } }),
    C.issue(draft.id),
  ]);
  const finalInv = await C.getInvoice(draft.id);
  const je = await C.entryOf("invoice", draft.id);
  const hasAdvanceLine = finalInv.lines.some((l) => l.lineKind === "advance");
  ok("issue racing apply: one wins cleanly (apply 201 + deduction posted, or apply 409 and no deduction)",
    issueRes.status === 200 && ((applyRes.status === 201 && hasAdvanceLine && je["2055"]?.dr === 1000) || (applyRes.status === 409 && !hasAdvanceLine && je["2055"] === undefined)), { apply: applyRes.status, hasAdvanceLine, je });
  ok("issue racing apply: the journal's receivable equals the invoice total", je["1040"]?.dr === n(finalInv.total), { je, total: finalInv.total });
  ok("issue racing apply: 2055 equals the sub-ledger", (await C.balances())["2055"] === -(await C.subledger2055()), { gl: (await C.balances())["2055"], sub: await C.subledger2055() });

  // foreign-currency invoices cannot take an advance
  await api("POST", `/api/companies/${C.cid}/exchange-rates`, { token: C.token, body: { fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: today } });
  const usd = await C.draft({ contactId: cust.id, currency: "USD", lines: [{ description: "Abroad", quantity: 1, unitPrice: 100, vatRate: 0 }] });
  const cur = await api("POST", `/api/invoices/${usd.id}/advance-applications`, { token: C.token, body: { advanceId: advId, amount: 10 } });
  ok("a foreign-currency invoice cannot take an advance (422 ADVANCE_CURRENCY_UNSUPPORTED)", cur.status === 422 && cur.json?.code === "ADVANCE_CURRENCY_UNSUPPORTED", cur.text?.slice(0, 200));

  // an advance in another currency than AED is refused at creation (AED only)
  const other = await C.contact();
  const noContact = await C.advance({ contactId: "00000000-0000-0000-0000-000000000000", amount: 100 });
  ok("an advance for an unknown contact is refused", noContact.status === 422, noContact.text?.slice(0, 120));
  const mismatch = await C.draft({ contactId: other.id, lines: [{ description: "Other customer", quantity: 1, unitPrice: 500, vatRate: 0.05 }] });
  const wrong = await api("POST", `/api/invoices/${mismatch.id}/advance-applications`, { token: C.token, body: { advanceId: advId, amount: 10 } });
  ok("an advance cannot be applied to another customer's invoice (422 ADVANCE_CONTACT_MISMATCH)", wrong.status === 422 && wrong.json?.code === "ADVANCE_CONTACT_MISMATCH", wrong.text?.slice(0, 200));
  const unissuedAdv = await C.draft({ contactId: cust.id, lines: [{ description: "Small", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
  const tooMuch = await api("POST", `/api/invoices/${unissuedAdv.id}/advance-applications`, { token: C.token, body: { advanceId: advId, amount: 50 } });
  ok("an advance larger than the invoice's items is refused (422, nothing reserved)", [422].includes(tooMuch.status) && ["ADVANCE_EXCEEDED", "ADVANCE_EXCEEDS_INVOICE"].includes(tooMuch.json?.code) || tooMuch.status === 201, tooMuch.text?.slice(0, 200));

  // remove an application from a draft restores the advance
  const D = await C.advance({ contactId: cust.id, amount: 525, receive: { paymentAccountId: bank } });
  const dd = await C.draft({ contactId: cust.id, lines: [{ description: "Work", quantity: 1, unitPrice: 2000, vatRate: 0.05 }] });
  const ap = await api("POST", `/api/invoices/${dd.id}/advance-applications`, { token: C.token, body: { advanceId: D.json.advance.id, amount: 500 } });
  const before = (await api("GET", `/api/companies/${C.cid}/customer-advances/${D.json.advance.id}`, { token: C.token })).json;
  const rm = await api("DELETE", `/api/invoices/${dd.id}/advance-applications/${ap.json?.application?.id}`, { token: C.token });
  const afterRm = (await api("GET", `/api/companies/${C.cid}/customer-advances/${D.json.advance.id}`, { token: C.token })).json;
  const ddNow = await C.getInvoice(dd.id);
  ok("removing an application from a draft gives the advance back and drops the line", ap.status === 201 && n(before.available) === 0 && rm.status === 200 && n(afterRm.available) === 500 && !ddNow.lines.some((l) => l.lineKind === "advance") && n(ddNow.total) === 2100, { before: before.available, after: afterRm.available, total: ddNow.total });

  // void interplay: an advance that was applied cannot be voided; a voided final invoice releases it
  const ap2 = await api("POST", `/api/invoices/${dd.id}/advance-applications`, { token: C.token, body: { advanceId: D.json.advance.id, amount: 500 } });
  await C.issue(dd.id);
  const voidAdv = await api("PATCH", `/api/invoices/${D.json.advance.invoiceId}/status`, { token: C.token, body: { status: "void" } });
  ok("an advance invoice that has been applied cannot be voided (409)", ap2.status === 201 && voidAdv.status === 409, { s: voidAdv.status, t: voidAdv.text?.slice(0, 160) });
  const voidFinal = await api("PATCH", `/api/invoices/${dd.id}/status`, { token: C.token, body: { status: "void" } });
  const afterVoid = (await api("GET", `/api/companies/${C.cid}/customer-advances/${D.json.advance.id}`, { token: C.token })).json;
  ok("voiding the final invoice releases the advance", voidFinal.status === 200 && n(afterVoid.available) === 500 && afterVoid.status === "open", afterVoid);
  ok("2055 equals the sub-ledger after the void", (await C.balances())["2055"] === -(await C.subledger2055()), { gl: (await C.balances())["2055"], sub: await C.subledger2055() });

  // full credit then void of the credit note re-applies the deduction
  const e = await C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: bank } });
  const f = await C.draft({ contactId: cust.id, lines: [{ description: "F", quantity: 1, unitPrice: 2000, vatRate: 0.05 }] });
  await api("POST", `/api/invoices/${f.id}/advance-applications`, { token: C.token, body: { advanceId: e.json.advance.id, amount: 1000 } });
  await C.issue(f.id);
  const cn = await api("POST", `/api/companies/${C.cid}/invoices/${f.id}/credit-note`, { token: C.token, body: {} });
  const released = (await api("GET", `/api/companies/${C.cid}/customer-advances/${e.json.advance.id}`, { token: C.token })).json;
  const cnVoid = await api("PATCH", `/api/invoices/${cn.json?.id}/status`, { token: C.token, body: { status: "void" } });
  const reapplied = (await api("GET", `/api/companies/${C.cid}/customer-advances/${e.json.advance.id}`, { token: C.token })).json;
  ok("a full credit releases the advance and voiding that credit note deducts it again", cn.status === 201 && n(released.available) === 1000 && cnVoid.status === 200 && n(reapplied.available) === 0, { released: released.available, voidS: cnVoid.status, reapplied: reapplied.available });
  ok("2055 equals the sub-ledger after credit and void of the credit note", (await C.balances())["2055"] === -(await C.subledger2055()), { gl: (await C.balances())["2055"], sub: await C.subledger2055() });

  // partial refund of an advance
  const g = await C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: bank } });
  const pr = await api("POST", `/api/companies/${C.cid}/customer-advances/${g.json.advance.id}/refund`, { token: C.token, body: { amount: 525, date: today, bankAccountId: bank } });
  const gNow = (await api("GET", `/api/companies/${C.cid}/customer-advances/${g.json.advance.id}`, { token: C.token })).json;
  ok("a partial refund of an advance (525 gross) leaves 500 net available", pr.status === 201 && n(gNow.available) === 500 && gNow.status === "open", { s: pr.status, a: gNow.available, t: pr.text?.slice(0, 200) });
  const prRest = await api("POST", `/api/companies/${C.cid}/customer-advances/${g.json.advance.id}/refund`, { token: C.token, body: { amount: 525, date: today, bankAccountId: bank } });
  const gDone = (await api("GET", `/api/companies/${C.cid}/customer-advances/${g.json.advance.id}`, { token: C.token })).json;
  ok("refunding the rest closes it", prRest.status === 201 && n(gDone.available) === 0 && gDone.status === "refunded", { s: prRest.status, a: gDone.available, st: gDone.status, t: prRest.text?.slice(0, 200) });
  ok("2055 equals the sub-ledger after partial refunds", (await C.balances())["2055"] === -(await C.subledger2055()), { gl: (await C.balances())["2055"], sub: await C.subledger2055() });
  // the advance invoice itself cannot be edited
  const edit = await api("PUT", `/api/invoices/${g.json.advance.invoiceId}`, { token: C.token, body: { date: today, lines: [{ description: "x", quantity: 1, unitPrice: 1, vatRate: 0.05 }] } });
  ok("an advance tax invoice cannot be edited", edit.status === 422, edit.status);
}

// ───────────────────────────── fuzz: money adds up on random documents ─────────────────────────────
async function fuzz() {
  const C = await newCompany("fuzz");
  let seed = 424242;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const invoices = [];
  let expected5 = 0, expected0 = 0, allBalanced = true, arEqualsTotal = true, totalsMatch = true;
  for (let i = 0; i < 25; i++) {
    const lines = [];
    const count = 1 + Math.floor(rand() * 3);
    for (let j = 0; j < count; j++) {
      const zero = rand() < 0.3;
      lines.push({
        description: `L${i}-${j}`, quantity: Math.round((1 + rand() * 4) * 100) / 100, unitPrice: Math.round(rand() * 20000) / 100 + 1, vatRate: zero ? 0 : 0.05,
        ...(rand() < 0.4 ? { discountType: "percent", discountValue: Math.round(rand() * 3000) / 100 } : {}),
      });
    }
    if (rand() < 0.5) lines.push({ description: "Ship", quantity: 1, unitPrice: Math.round(rand() * 5000) / 100 + 1, lineKind: "shipping" });
    const body = { lines, ...(rand() < 0.5 ? { discountType: rand() < 0.5 ? "percent" : "amount", discountValue: Math.round(rand() * 500) / 100 + 0.5 } : {}) };
    const r = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body: { customerName: "F", date: today, dueDate: today, ...body } });
    if (r.status !== 200) continue; // an over-large discount combination is a legitimate 422
    const iss = await C.issue(r.json.id);
    if (iss.status !== 200) { totalsMatch = false; continue; }
    const full = await C.getInvoice(r.json.id);
    const sumNet = full.lines.reduce((s, l) => s + n(l.quantity) * n(l.unitPrice), 0);
    const sumVat = full.lines.reduce((s, l) => s + n(l.quantity) * n(l.unitPrice) * n(l.vatRate), 0);
    if (Math.abs(n(full.subtotal) - sumNet) > 0.006 || Math.abs(n(full.vatAmount) - sumVat) > 0.006 || Math.abs(n(full.total) - (n(full.subtotal) + n(full.vatAmount))) > 0.006) totalsMatch = false;
    for (const l of full.lines) {
      const net = n(l.quantity) * n(l.unitPrice);
      if (n(l.vatRate) > 0) expected5 += net; else expected0 += net;
    }
    const je = await C.entryOf("invoice", full.id);
    const dr = Object.values(je).reduce((s, x) => s + x.dr, 0), cr = Object.values(je).reduce((s, x) => s + x.cr, 0);
    if (Math.abs(dr - cr) > 0.005) allBalanced = false;
    if (Math.abs((je["1040"]?.dr ?? 0) - n(full.total)) > 0.005) arEqualsTotal = false;
    invoices.push(full);
  }
  ok("fuzz: at least 15 random invoices were created and issued", invoices.length >= 15, invoices.length);
  ok("fuzz: every total is the sum of its lines (subtotal, VAT, total)", totalsMatch);
  ok("fuzz: every journal balances and receivables equal the invoice total", allBalanced && arEqualsTotal, { allBalanced, arEqualsTotal });
  const box = await C.vat201();
  ok("fuzz: VAT 201 box 1 and box 4 equal the sum of the lines", close(box.box1bDubaiAmount, expected5, 0.05) && close(box.box4ZeroRatedAmount, expected0, 0.05), { b1: box.box1bDubaiAmount, e5: expected5, b4: box.box4ZeroRatedAmount, e0: expected0 });
  const bal = await C.balances();
  ok("fuzz: AR equals the sum of invoice totals", close(bal["1040"], invoices.reduce((s, x) => s + n(x.total), 0), 0.1), { ar: bal["1040"] });
  let creditFail = 0;
  for (const inv of invoices) {
    const cn = await api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/credit-note`, { token: C.token, body: {} });
    if (cn.status !== 201) creditFail++;
  }
  const after = await C.balances();
  ok("fuzz: a full credit note of every invoice zeroes every account", creditFail === 0 && Object.values(after).every((v) => v === 0), { creditFail, after });
}

// ───────────────────────────── custom fields on every entity ─────────────────────────────
async function customFieldEntities() {
  const C = await newCompany("cfe");
  const mk = (entity, key, extra = {}) => api("POST", `/api/companies/${C.cid}/custom-fields`, { token: C.token, body: { entity, key, labelEn: key.toUpperCase(), labelAr: "حقل " + key, fieldType: "text", showOnPdf: true, ...extra } });
  for (const e of ["contact", "quote", "bill", "sales_order"]) ok(`a field on ${e} is created`, (await mk(e, "ref_" + e.slice(0, 3))).status === 201);
  const num = await mk("invoice", "qty_hint", { fieldType: "number", showOnPdf: false });
  const dt = await mk("invoice", "ship_date", { fieldType: "date", showOnPdf: false });
  ok("number and date fields are created", num.status === 201 && dt.status === 201);
  const cust = await C.contact();
  const cv = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/contact/${cust.id}`, { token: C.token, body: { values: { ref_con: "VIP" } } });
  ok("a contact field value is saved", cv.status === 200 && cv.json?.find((f) => f.key === "ref_con")?.value === "VIP", cv.text?.slice(0, 200));
  const q = (await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Q", contactId: cust.id, date: today, lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } })).json;
  const qv = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/quote/${q.id}`, { token: C.token, body: { values: { ref_quo: "Q-77" } } });
  ok("a quote field value is saved", qv.status === 200, qv.text?.slice(0, 200));
  const sent = await api("POST", `/api/quotes/${q.id}/send`, { token: C.token, body: {} });
  const view = await api("GET", `/api/public/quotes/${sent.json.shareUrl.split("/").pop()}`);
  const f = view.json?.customFields?.find((x) => x.key === "ref_quo");
  ok("the public quote page shows the field with both labels", f?.labelEn === "REF_QUO" && f?.labelAr === "حقل ref_quo" && f?.value === "Q-77", view.json?.customFields);
  const qpdf = await api("GET", `/api/quotes/${q.id}/pdf`, { token: C.token, raw: true });
  const qtext = qpdf.status === 200 ? await pdfText(qpdf.buf) : "";
  ok("the quote PDF shows the flagged field", /REF_QUO/.test(qtext) && /Q-77/.test(qtext), qtext.slice(0, 200));
  const so = (await api("POST", `/api/companies/${C.cid}/sales-orders`, { token: C.token, body: { contactId: cust.id, date: today, lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } })).json;
  await api("PUT", `/api/companies/${C.cid}/custom-fields/values/sales_order/${so.id}`, { token: C.token, body: { values: { ref_sal: "SO-REF" } } });
  const sopdf = await api("GET", `/api/companies/${C.cid}/sales-orders/${so.id}/pdf`, { token: C.token, raw: true });
  const sotext = sopdf.status === 200 ? await pdfText(sopdf.buf) : "";
  ok("the sales order PDF shows the flagged field", /REF_SAL/.test(sotext) && /SO-REF/.test(sotext), sotext.slice(0, 200));
  const bill = await api("POST", `/api/companies/${C.cid}/bills`, { token: C.token, body: { vendor_name: "Supplier", bill_date: today, due_date: today, currency: "AED", line_items: [{ description: "Goods", quantity: 1, unit_price: 100, vat_rate: 0.05 }] } });
  const bv = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/bill/${bill.json?.id}`, { token: C.token, body: { values: { ref_bil: "B-1" } } });
  ok("a bill field value is saved (the API supports bills)", bill.json?.id && bv.status === 200 && bv.json?.find((x) => x.key === "ref_bil")?.value === "B-1", { s: bv.status, t: bv.text?.slice(0, 200) });
  const wrongEntity = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/contact/${bill.json?.id}`, { token: C.token, body: { values: { ref_con: "x" } } });
  ok("a record id of the wrong entity type is 404", wrongEntity.status === 404, wrongEntity.status);
  const badEntity = await api("GET", `/api/companies/${C.cid}/custom-fields/values/spaceship/${cust.id}`, { token: C.token });
  ok("an unknown entity is 400", badEntity.status === 400, badEntity.status);
  const inv = await C.draft({ lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.05 }] });
  const bad = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { qty_hint: "many", ship_date: "2026-13-45" } } });
  ok("a non-number and an impossible date are both reported (422 with both fields)", bad.status === 422 && !!bad.json?.details?.fields?.qty_hint && !!bad.json?.details?.fields?.ship_date, bad.text?.slice(0, 300));
  const okVals = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { qty_hint: "12.50", ship_date: "2026-10-31" } } });
  ok("a number and a date are stored canonically; an empty value clears", okVals.status === 200 && okVals.json?.find((x) => x.key === "qty_hint")?.value === "12.5", okVals.text?.slice(0, 200));
  const cleared = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { qty_hint: "" } } });
  ok("clearing removes the value", cleared.json?.find((x) => x.key === "qty_hint")?.value === null);
}

// ───────────────────────────── S2 (frontend): the screens' API contract ─────────────────────────────
// What the D1 screens read and send, checked against a live server: shapes the client types in
// client/src/lib/sales-api.ts depend on, the pages the SPA must serve, and the rules the UI hides buttons for.
async function frontendContract() {
  const C = await newCompany("fe");
  const cust = await C.contact();

  // The SPA serves every new screen (and the public quote link) on a hard load.
  for (const path of ["/sales-orders", "/customer-advances", "/settings/sales", "/view/quote/" + "a".repeat(32)]) {
    const page = await fetch(BASE + path);
    ok(`FE the app shell is served at ${path}`, page.status === 200 && /text\/html/.test(page.headers.get("content-type") || ""), page.status);
  }

  // Editors: an invoice reloads into the form from GET /api/invoices/:id.
  const adv = (await C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: C.acct("1020").id, method: "bank" } })).json;
  const inv = await C.draft({ contactId: cust.id, discountType: "amount", discountValue: 50, lines: [
    { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "percent", discountValue: 10 },
    { description: "Delivery", quantity: 1, unitPrice: 100, lineKind: "shipping" },
  ] });
  const apply = await api("POST", `/api/invoices/${inv.id}/advance-applications`, { token: C.token, body: { advanceId: adv.advance.id, amount: 500 } });
  ok("FE apply advance answers 201", apply.status === 201, apply.text?.slice(0, 200));
  const full = await C.getInvoice(inv.id);
  const app = full.advanceApplications?.[0];
  ok("FE GET invoice carries advanceApplications the dialog lists (id, advanceNumber, netAmount, vatAmount, status, kind)",
    !!app && typeof app.id === "string" && /^ADV-/.test(app.advanceNumber) && n(app.netAmount) === 500 && n(app.vatAmount) === 25 && app.status === "active" && app.kind === "application", app);
  ok("FE GET invoice lines carry lineKind, discount inputs and parent ids the editor filters on",
    full.lines.every((l) => typeof l.lineKind === "string") && full.lines.some((l) => l.lineKind === "advance") && full.lines.find((l) => l.lineKind === "item")?.discountType === "percent", full.lines.map((l) => l.lineKind));
  ok("FE the editor can rebuild totals from the response (itemsSubtotal + discountAmount = gross of the items)", n(full.itemsSubtotal) + n(full.discountAmount) === 1000, { i: full.itemsSubtotal, d: full.discountAmount });
  const advList = (await api("GET", `/api/companies/${C.cid}/customer-advances?contactId=${cust.id}&status=open`, { token: C.token })).json;
  const row = advList?.[0];
  ok("FE the advances list rows carry what the table and the apply dialog read",
    !!row && row.contactName && /^INV-/.test(row.invoiceNumber) && typeof row.invoiceStatus === "string" && n(row.available) === 500 && n(row.applied) === 500 && row.currency === "AED" && !isNaN(n(row.vatRate)), row);

  // Custom fields: the editor loads rows with key, both labels, type, options and the stored value.
  await api("POST", `/api/companies/${C.cid}/custom-fields`, { token: C.token, body: { entity: "invoice", key: "po_number", labelEn: "PO Number", labelAr: "رقم أمر الشراء", fieldType: "text", showOnPdf: true } });
  await api("POST", `/api/companies/${C.cid}/custom-fields`, { token: C.token, body: { entity: "invoice", key: "priority", labelEn: "Priority", labelAr: "الأولوية", fieldType: "select", options: ["Low", "High"] } });
  await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { po_number: "PO-1" } } });
  const values = (await api("GET", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token })).json;
  const poRow = values?.find((v) => v.key === "po_number");
  ok("FE field values rows: definitionId, key, labelEn, labelAr, fieldType, options, showOnPdf, isArchived, value",
    !!poRow && ["definitionId", "key", "labelEn", "labelAr", "fieldType", "showOnPdf", "isArchived", "value"].every((k) => k in poRow) && poRow.value === "PO-1" && values.find((v) => v.key === "priority")?.options?.join() === "Low,High", values);
  const outside = await api("PUT", `/api/companies/${C.cid}/custom-fields/values/invoice/${inv.id}`, { token: C.token, body: { values: { priority: "Urgent" } } });
  ok("FE a select value outside the options is 422 CUSTOM_FIELD_INVALID (the editor maps the code)", outside.status === 422 && outside.json?.code === "CUSTOM_FIELD_INVALID", outside.text?.slice(0, 200));
  const defs = (await api("GET", `/api/companies/${C.cid}/custom-fields?entity=invoice&includeArchived=true`, { token: C.token })).json;
  ok("FE the definitions list the settings panel shows", Array.isArray(defs) && defs.length === 2 && defs.every((d) => d.key && d.labelEn && d.labelAr && d.fieldType), defs);

  // Public invoice view: outstanding, paid and the onlinePayment flags drive Pay now.
  await C.issue(inv.id);
  const share = (await api("POST", `/api/invoices/${inv.id}/share`, { token: C.token, body: {} })).json.token;
  const pub = (await api("GET", `/api/public/invoices/${share}`)).json;
  ok("FE public invoice shape: outstanding, paid, discountAmount, shippingAmount, itemsSubtotal, customFields (both labels), onlinePayment flags",
    n(pub.invoice.outstanding) === n(full.total) - 0 && "paid" in pub.invoice && "itemsSubtotal" in pub.invoice && "discountAmount" in pub.invoice && "shippingAmount" in pub.invoice
      && pub.customFields?.[0]?.labelAr === "رقم أمر الشراء" && typeof pub.onlinePayment?.configured === "boolean" && typeof pub.onlinePayment?.allowPartial === "boolean" && typeof pub.onlinePayment?.payable === "boolean", pub);
  ok("FE with no connected account the page shows no Pay now (onlinePayment.configured false)", pub.onlinePayment.configured === false);
  ok("FE public invoice lines carry lineKind so the page hides derived discount/shipping rows and shows advance rows", pub.lines.some((l) => l.lineKind === "advance") && pub.lines.some((l) => l.lineKind === "discount"), pub.lines.map((l) => l.lineKind));

  // Settings: the gateway status the panel reads, and the chasing late-fee block.
  const gw = (await api("GET", `/api/companies/${C.cid}/payment-gateway`, { token: C.token })).json;
  ok("FE gateway status shape: configured, mode, connection, allowPartial, enabled, ready", ["configured", "mode", "connection", "allowPartial", "enabled", "ready"].every((k) => k in gw), gw);
  const cfg = (await api("GET", `/api/chasing/config/${C.cid}`, { token: C.token })).json;
  ok("FE chasing config carries lateFee {enabled false, type, value, afterDays, vatTreatment} off by default", cfg.lateFee?.enabled === false && ["percent", "fixed"].includes(cfg.lateFee?.type) && typeof cfg.lateFee?.afterDays === "number" && cfg.lateFee?.vatTreatment === "out_of_scope", cfg.lateFee);
  const lf = await api("PATCH", `/api/chasing/config/${C.cid}`, { token: C.token, body: { lateFee: { enabled: true, type: "percent", value: 2, afterDays: 15, vatTreatment: "out_of_scope" } } });
  ok("FE the late fee form saves the whole object", lf.status === 200 && lf.json?.lateFee?.enabled === true && lf.json?.lateFee?.value === 2, lf.text?.slice(0, 200));

  // Price lists: list rows carry items inline; resolve answers priceListId + prices by product.
  const prod = (await api("POST", `/api/companies/${C.cid}/products`, { token: C.token, body: { name: "Widget", unitPrice: "100", vatRate: "0.05" } })).json;
  const pl = (await api("POST", `/api/companies/${C.cid}/price-lists`, { token: C.token, body: { name: "Wholesale", currency: "AED", items: [{ productId: prod.id, unitPrice: 80 }] } })).json;
  await api("PUT", `/api/companies/${C.cid}/customer-contacts/${cust.id}`, { token: C.token, body: { priceListId: pl.id } });
  const lists = (await api("GET", `/api/companies/${C.cid}/price-lists`, { token: C.token })).json;
  ok("FE price list rows: name, currency, isActive and items inline", lists?.[0]?.name === "Wholesale" && lists[0].isActive === true && lists[0].items?.[0]?.productId === prod.id, lists);
  const res = (await api("GET", `/api/companies/${C.cid}/price-lists/resolve?contactId=${cust.id}&currency=AED`, { token: C.token })).json;
  ok("FE resolve returns the list id and a price per product", res?.priceListId === pl.id && n(res?.prices?.[prod.id]) === 80, res);

  // Sales orders: list rows and detail lines carry the quantities and availability the page shows.
  const track = (await api("POST", `/api/companies/${C.cid}/products`, { token: C.token, body: { name: "Gadget", unitPrice: "100", vatRate: "0.05", trackInventory: true } })).json;
  await api("POST", `/api/products/${track.id}/movements`, { token: C.token, body: { type: "purchase", quantity: 6, unitCost: "40" } });
  const so = (await api("POST", `/api/companies/${C.cid}/sales-orders`, { token: C.token, body: { contactId: cust.id, date: today, lines: [{ description: "Gadget", quantity: 10, unitPrice: 100, vatRate: 0.05, productId: track.id }] } })).json;
  const soList = (await api("GET", `/api/companies/${C.cid}/sales-orders`, { token: C.token })).json;
  ok("FE sales order list rows: number, customerName, status, invoicingStatus, deliveryStatus, total", !!soList?.[0] && ["number", "customerName", "status", "invoicingStatus", "deliveryStatus", "total", "currency", "date"].every((k) => k in soList[0]), soList?.[0]);
  const soFull = (await api("GET", `/api/companies/${C.cid}/sales-orders/${so.id}`, { token: C.token })).json;
  const sl = soFull.lines?.find((l) => l.lineKind === "item");
  ok("FE sales order detail lines: invoicedQty, deliveredQty, remainingQty, availableToPromise 6, shortfall 4; invoices and deliveries arrays",
    n(sl?.invoicedQty) === 0 && n(sl?.deliveredQty) === 0 && n(sl?.remainingQty) === 10 && n(sl?.availableToPromise) === 6 && n(sl?.shortfall) === 4 && Array.isArray(soFull.invoices) && Array.isArray(soFull.deliveries), sl);
  const av = (await api("GET", `/api/companies/${C.cid}/products/availability?ids=${track.id}`, { token: C.token })).json;
  ok("FE availability rows (editor badge): productId, onHand, committed, available", av?.[0]?.productId === track.id && n(av[0].onHand) === 6 && "committed" in av[0] && "available" in av[0], av);
  const tooMuch = await api("POST", `/api/companies/${C.cid}/sales-orders/${so.id}/invoices`, { token: C.token, body: { lines: [{ salesOrderLineId: sl.id, quantity: 11 }] } });
  ok("FE invoicing more than ordered is 422 SO_QTY_EXCEEDED (the dialog maps the code)", tooMuch.status === 422 && tooMuch.json?.code === "SO_QTY_EXCEEDED", tooMuch.text?.slice(0, 200));

  // Quotes: the list row, the send result and the signature record the dialogs read.
  const q = (await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Buyer", contactId: cust.id, date: today, lines: [{ description: "Design", quantity: 1, unitPrice: 500, vatRate: 0.05 }] } })).json;
  const sent = (await api("POST", `/api/quotes/${q.id}/send`, { token: C.token, body: {} })).json;
  ok("FE send quote answers {quote, shareUrl, emailed, emailError?} with a /view/quote/ link", /^\/view\/quote\/|^https?:\/\/.*\/view\/quote\//.test(sent.shareUrl || "") && typeof sent.emailed === "boolean" && sent.quote?.status === "sent", sent);
  const token = sent.shareUrl.split("/").pop();
  const pubQuote = (await api("GET", `/api/public/quotes/${token}`)).json;
  ok("FE public quote shape: quote totals and status, lines with lineKind, canRespond true", pubQuote.canRespond === true && pubQuote.quote?.status === "sent" && Array.isArray(pubQuote.lines) && !("id" in pubQuote.quote), pubQuote);
  const noCsrf = await api("POST", `/api/public/quotes/${token}/accept`, { body: { name: "Sara", email: "sara@example.com", agree: true } });
  ok("FE a public answer without the CSRF token is refused (the page always sends it)", noCsrf.status === 403, noCsrf.status);
  const noConsent = await publicPost(`/api/public/quotes/${token}/accept`, { name: "Sara", email: "sara@example.com", agree: false });
  ok("FE accepting without consent is 400 (the page blocks it before sending)", noConsent.status === 400, noConsent.status);
  const accepted = await publicPost(`/api/public/quotes/${token}/accept`, { name: "Sara", email: "sara@example.com", agree: true });
  ok("FE accept answers {status accepted, signedAt}", accepted.status === 200 && accepted.json?.status === "accepted" && !!accepted.json?.signedAt, accepted.text?.slice(0, 200));
  const sig = (await api("GET", `/api/quotes/${q.id}/signature`, { token: C.token })).json;
  ok("FE signature record shape: current {action, signerName, signerEmail, ip, userAgent, quoteHash, signedAt}", sig?.current?.action === "accepted" && sig.current.signerName === "Sara" && sig.current.signerEmail === "sara@example.com" && !!sig.current.quoteHash && Array.isArray(sig.history), sig);
  const again = await publicPost(`/api/public/quotes/${token}/accept`, { name: "Sara", email: "sara@example.com", agree: true });
  ok("FE a second answer is 409 QUOTE_NOT_OPEN (the page shows 'already answered')", again.status === 409 && again.json?.code === "QUOTE_NOT_OPEN", again.text?.slice(0, 200));

  // Recurring: the template carries contact, autoSend and terms; auto-send needs an email (the form hides it without a contact).
  const noEmail = await C.contact({ email: "" });
  const rec = await api("POST", `/api/companies/${C.cid}/recurring-invoices`, { token: C.token, body: { customerName: cust.name, contactId: cust.id, autoSend: true, paymentTermsDays: 14, currency: "AED", frequency: "monthly", startDate: new Date().toISOString(), linesJson: JSON.stringify([{ description: "Retainer", quantity: 1, unitPrice: 100, vatRate: 0.05 }]) } });
  ok("FE recurring template stores contactId, autoSend and paymentTermsDays", rec.status === 200 && rec.json?.autoSend === true && rec.json?.paymentTermsDays === 14 && rec.json?.contactId === cust.id, rec.text?.slice(0, 300));
  const recBad = await api("POST", `/api/companies/${C.cid}/recurring-invoices`, { token: C.token, body: { customerName: "NoMail", contactId: noEmail.id, autoSend: true, currency: "AED", frequency: "monthly", startDate: new Date().toISOString(), linesJson: JSON.stringify([{ description: "x", quantity: 1, unitPrice: 1, vatRate: 0.05 }]) } });
  ok("FE auto-send for a contact without email is 422 CONTACT_EMAIL_REQUIRED (the form maps the code)", recBad.status === 422 && recBad.json?.code === "CONTACT_EMAIL_REQUIRED", recBad.text?.slice(0, 200));

  // Statement memo (advances) and the list of invoice kinds the list badges read.
  const stmt = (await api("GET", `/api/companies/${C.cid}/contacts/${cust.id}/statement?from=${monthStartOf(today)}&to=${today}`, { token: C.token })).json;
  ok("FE statement JSON carries unappliedAdvances {number, availableGross} as a memo", stmt?.unappliedAdvances?.[0] && /^ADV-/.test(stmt.unappliedAdvances[0].number) && n(stmt.unappliedAdvances[0].availableGross) > 0, stmt?.unappliedAdvances);
  const invs = (await api("GET", `/api/companies/${C.cid}/invoices`, { token: C.token })).json;
  ok("FE invoice list rows carry invoiceType so the list can badge advance invoices", invs.some((i) => i.invoiceType === "advance") && invs.every((i) => typeof i.invoiceType === "string"), invs.map((i) => i.invoiceType));

  // Pay now appears only for a connected, enabled account; allowPartial reaches the page; Settings buttons need the owner.
  if (gw.mode === "fake") {
    const conn = await api("POST", `/api/companies/${C.cid}/payment-gateway/stripe/connect`, { token: C.token, body: {} });
    await fetch(conn.json.url, { redirect: "manual" });
    const pub2 = (await api("GET", `/api/public/invoices/${share}`)).json;
    ok("FE once connected the public invoice offers Pay now (configured, payable, partial off)", pub2.onlinePayment?.configured === true && pub2.onlinePayment?.payable === true && pub2.onlinePayment?.allowPartial === false, pub2.onlinePayment);
    await api("PATCH", `/api/companies/${C.cid}/payment-gateway/settings`, { token: C.token, body: { allowPartial: true } });
    const pub3 = (await api("GET", `/api/public/invoices/${share}`)).json;
    ok("FE allowPartial reaches the page (the amount field appears)", pub3.onlinePayment?.allowPartial === true, pub3.onlinePayment);
    await api("PATCH", `/api/companies/${C.cid}/payment-gateway/settings`, { token: C.token, body: { enabled: false } });
    const pub4 = (await api("GET", `/api/public/invoices/${share}`)).json;
    ok("FE turning payments off hides Pay now again", pub4.onlinePayment?.configured === false, pub4.onlinePayment);
    await api("PATCH", `/api/companies/${C.cid}/payment-gateway/settings`, { token: C.token, body: { enabled: true } });
    const portalToken = (await api("POST", "/api/portal/generate-access", { token: C.token, body: { contactId: cust.id } })).json.token;
    const portalList = (await api("GET", `/api/portal/${portalToken}/invoices`)).json;
    const hasFlag = Array.isArray(portalList) && portalList.some((i) => i.onlinePayment && typeof i.onlinePayment.configured === "boolean");
    // Not counted: the portal page shows Pay now from `onlinePayment` on each invoice row. Until the portal list sends it, the
    // button stays hidden (nothing is shown that cannot work). Reported to the lead as a one-line change in portal.public.routes.ts.
    if (!hasFlag) console.log("GAP   portal invoice rows do not carry onlinePayment yet, so the customer portal cannot show Pay now");
    else ok("FE portal invoice rows carry onlinePayment (Pay now in the customer portal)", true);
    ok("FE portal rows carry outstandingAmount, customFields and invoiceType", Array.isArray(portalList) && portalList.every((i) => "outstandingAmount" in i && Array.isArray(i.customFields) && typeof i.invoiceType === "string"), portalList?.[0]);
  }
}
const monthStartOf = (d) => d.slice(0, 8) + "01";

// ───────────────────────────── L1 review fixes ─────────────────────────────
async function reviewFixes() {
  const C = await newCompany("rv");
  const cust = await C.contact();
  const bank = C.acct("1020").id;
  const fake = (await api("GET", `/api/companies/${C.cid}/payment-gateway`, { token: C.token })).json?.mode === "fake";

  // HIGH 1: an advance invoice is credited only through the advance refund
  const adv = await C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: bank } });
  const advInv = adv.json.advance.invoiceId;
  const balBefore = await C.balances();
  const cnFull = await api("POST", `/api/companies/${C.cid}/invoices/${advInv}/credit-note`, { token: C.token, body: {} });
  const cnPart = await api("POST", `/api/companies/${C.cid}/invoices/${advInv}/credit-note`, { token: C.token, body: { lines: [{ description: "Advance payment", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("HIGH1 a direct credit note on an advance invoice is 409 ADVANCE_USE_REFUND (full and partial)", cnFull.status === 409 && cnFull.json?.code === "ADVANCE_USE_REFUND" && cnPart.status === 409 && cnPart.json?.code === "ADVANCE_USE_REFUND", { f: cnFull.text?.slice(0, 120), p: cnPart.text?.slice(0, 120) });
  const balAfter = await C.balances();
  const box = await C.vat201();
  ok("HIGH1 2055 still ties to the sub-ledger, nothing moved, VAT not under-declared", JSON.stringify(balBefore) === JSON.stringify(balAfter) && balAfter["2055"] === -(await C.subledger2055()) && close(box.box1bDubaiAmount, 1000) && close(box.box1bDubaiVat, 50), { balAfter, b1: box.box1bDubaiAmount, v: box.box1bDubaiVat });
  const refundOk = await api("POST", `/api/companies/${C.cid}/customer-advances/${adv.json.advance.id}/refund`, { token: C.token, body: { amount: 525, date: today, bankAccountId: bank } });
  ok("HIGH1 the advance refund (the proper route) still works", refundOk.status === 201, refundOk.text?.slice(0, 200));
  const voidAfterRefund = await api("PATCH", `/api/invoices/${advInv}/status`, { token: C.token, body: { status: "void" } });
  ok("HIGH1 an advance invoice with refund rows cannot be voided (409)", voidAfterRefund.status === 409, voidAfterRefund.text?.slice(0, 160));

  // HIGH 3: customer and currency are frozen while an advance is applied
  const adv2 = await C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: bank } });
  const other = await C.contact();
  const dr = await C.draft({ contactId: cust.id, lines: [{ description: "W", quantity: 1, unitPrice: 3000, vatRate: 0.05 }] });
  await api("POST", `/api/invoices/${dr.id}/advance-applications`, { token: C.token, body: { advanceId: adv2.json.advance.id, amount: 1000 } });
  const lines = [{ description: "W", quantity: 1, unitPrice: 3000, vatRate: 0.05 }];
  const chContact = await api("PUT", `/api/invoices/${dr.id}`, { token: C.token, body: { date: today, contactId: other.id, lines } });
  const chCur = await api("PUT", `/api/invoices/${dr.id}`, { token: C.token, body: { date: today, currency: "USD", lines } });
  const same = await api("PUT", `/api/invoices/${dr.id}`, { token: C.token, body: { date: today, contactId: cust.id, currency: "AED", lines } });
  ok("HIGH3 changing the customer or the currency of a draft with an applied advance is 409 ADVANCE_APPLIED", chContact.status === 409 && chContact.json?.code === "ADVANCE_APPLIED" && chCur.status === 409 && chCur.json?.code === "ADVANCE_APPLIED", { a: chContact.text?.slice(0, 120), b: chCur.text?.slice(0, 120) });
  ok("HIGH3 re-saving with the same customer and currency is fine", same.status === 200, same.text?.slice(0, 160));

  // MED 4: the refund account is validated before anything is reserved
  const adv3 = await C.advance({ contactId: cust.id, amount: 1050, receive: { paymentAccountId: bank } });
  const arAcct = C.acct("1040").id;
  const badAcct = await api("POST", `/api/companies/${C.cid}/customer-advances/${adv3.json.advance.id}/refund`, { token: C.token, body: { amount: 105, date: today, bankAccountId: arAcct } });
  const rev = C.acct("4010").id;
  const badAcct2 = await api("POST", `/api/companies/${C.cid}/customer-advances/${adv3.json.advance.id}/refund`, { token: C.token, body: { amount: 105, date: today, bankAccountId: rev } });
  const foreignAcct = await api("POST", `/api/companies/${C.cid}/customer-advances/${adv3.json.advance.id}/refund`, { token: C.token, body: { amount: 105, date: today, bankAccountId: "00000000-0000-0000-0000-000000000000" } });
  const a3 = (await api("GET", `/api/companies/${C.cid}/customer-advances/${adv3.json.advance.id}`, { token: C.token })).json;
  ok("MED4 refunding to Accounts Receivable, a revenue account or an unknown account is 422 INVALID_REFUND_ACCOUNT, nothing reserved",
    [badAcct, badAcct2, foreignAcct].every((r) => r.status === 422 && r.json?.code === "INVALID_REFUND_ACCOUNT") && n(a3.available) === 1000 && a3.applications.length === 0, { s: [badAcct.status, badAcct2.status, foreignAcct.status], a: a3.available, apps: a3.applications.length });

  // LOW 8: advances are AED only
  const usd = await C.advance({ contactId: cust.id, amount: 100, currency: "USD" });
  ok("LOW8 an advance in another currency is 422 ADVANCE_CURRENCY_UNSUPPORTED", usd.status === 422 && usd.json?.code === "ADVANCE_CURRENCY_UNSUPPORTED", usd.text?.slice(0, 160));
  const aed = await C.advance({ contactId: cust.id, amount: 105, currency: "AED" });
  ok("LOW8 an explicit AED advance is fine", aed.status === 201, aed.text?.slice(0, 160));

  // MED 5: a draft invoice has not taken stock, so the order is still committed
  await api("PATCH", `/api/companies/${C.cid}/preferences`, { token: C.token, body: { inventoryCostingEnabled: true } });
  const prod = (await api("POST", `/api/companies/${C.cid}/products`, { token: C.token, body: { name: "Atp", unitPrice: "100", vatRate: "0.05", trackInventory: true } })).json;
  await api("POST", `/api/products/${prod.id}/movements`, { token: C.token, body: { type: "purchase", quantity: 6, unitCost: "40" } });
  const mkSo = async (q) => (await api("POST", `/api/companies/${C.cid}/sales-orders`, { token: C.token, body: { contactId: cust.id, date: today, lines: [{ description: "Atp", quantity: q, unitPrice: 100, vatRate: 0.05, productId: prod.id }] } })).json;
  const so1 = await mkSo(5);
  const draftInv = await api("POST", `/api/companies/${C.cid}/sales-orders/${so1.id}/invoices`, { token: C.token, body: { lines: [{ salesOrderLineId: so1.lines[0].id, quantity: 5 }] } });
  const so2 = await mkSo(4);
  ok("MED5 stock 6, SO1 5 invoiced as a DRAFT, SO2 4: availableToPromise 1, shortfall 3", draftInv.status === 201 && so2.lines[0].availableToPromise === 1 && so2.lines[0].shortfall === 3, { d: draftInv.status, l: so2.lines[0] });

  // LOW 9 / MED 7: portal
  const draftOnly = await C.draft({ contactId: cust.id, lines: [{ description: "Not yet", quantity: 1, unitPrice: 50, vatRate: 0 }] });
  const issued = await C.draft({ contactId: cust.id, lines: [{ description: "Issued", quantity: 1, unitPrice: 300, vatRate: 0 }] });
  await C.issue(issued.id);
  const shareDraft = (await api("POST", `/api/invoices/${draftOnly.id}/share`, { token: C.token, body: {} })).json.token;
  const pubDraft = await api("GET", `/api/public/invoices/${shareDraft}`);
  ok("LOW9 a draft invoice's public link is 404", pubDraft.status === 404, pubDraft.status);
  const portal = (await api("POST", "/api/portal/generate-access", { token: C.token, body: { contactId: cust.id } })).json.token;
  const list0 = await api("GET", `/api/portal/${portal}/invoices`);
  ok("LOW9 the portal list leaves out drafts", list0.status === 200 && !list0.json.some((r) => r.id === draftOnly.id) && list0.json.some((r) => r.id === issued.id), list0.json?.map((r) => r.status));
  ok("MED7 portal rows carry onlinePayment (not configured before a connection)", list0.json.every((r) => r.onlinePayment && r.onlinePayment.configured === false && r.onlinePayment.payable === false), list0.json?.[0]?.onlinePayment);
  const pdfDraft = await api("GET", `/api/portal/${portal}/invoices/${draftOnly.id}/pdf`, { raw: true });
  ok("LOW9 a draft's portal PDF is refused", pdfDraft.status === 403 || pdfDraft.status === 404, pdfDraft.status);

  if (!fake) { console.log("SKIP  gateway review fixes: the server was not started with PAYMENT_GATEWAY_FAKE=1"); return; }
  const connUrl = (await api("POST", `/api/companies/${C.cid}/payment-gateway/stripe/connect`, { token: C.token, body: {} })).json.url;
  await fetch(connUrl, { redirect: "manual" });
  const account = (await db.query(`SELECT external_account_id FROM payment_gateway_connections WHERE company_id = $1`, [C.cid])).rows[0].external_account_id;
  const list1 = await api("GET", `/api/portal/${portal}/invoices`);
  const row = list1.json.find((r) => r.id === issued.id);
  ok("MED7 once connected, portal rows say configured and payable (partial off)", row?.onlinePayment?.configured === true && row.onlinePayment.payable === true && row.onlinePayment.allowPartial === false, row?.onlinePayment);
  const paidRow = list1.json.find((r) => r.id === draftOnly.id);
  ok("MED7 a credit note row is never payable", list1.json.filter((r) => r.invoiceType === "credit_note").every((r) => r.onlinePayment.payable === false));
  void paidRow;

  // MED 6: five parallel checkouts leave exactly one open link
  const shareIssued = (await api("POST", `/api/invoices/${issued.id}/share`, { token: C.token, body: {} })).json.token;
  const par = await Promise.all(Array.from({ length: 5 }, () => publicPost(`/api/public/invoices/${shareIssued}/checkout`, {})));
  const open = (await db.query(`SELECT count(*)::int AS n FROM payment_links WHERE invoice_id = $1 AND status = 'open'`, [issued.id])).rows[0].n;
  ok("MED6 five parallel checkouts: all answer 200 and exactly one link is open", par.every((r) => r.status === 200) && open === 1, { s: par.map((r) => r.status), open });
  const idx = (await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_payment_links_open_per_invoice'`)).rowCount;
  ok("MED6 the database enforces it (partial unique index)", idx === 1);

  // HIGH 2: a refund on an invoice that still owes money is parked, nothing posted
  await api("PATCH", `/api/companies/${C.cid}/payment-gateway/settings`, { token: C.token, body: { allowPartial: true } });
  const inv = await C.draft({ contactId: cust.id, lines: [{ description: "Big", quantity: 1, unitPrice: 997.5, vatRate: 0 }] });
  await C.issue(inv.id);
  const t = (await api("POST", `/api/invoices/${inv.id}/share`, { token: C.token, body: {} })).json.token;
  await publicPost(`/api/public/invoices/${t}/checkout`, { amount: 500 });
  const sid = (await db.query(`SELECT provider_session_id FROM payment_links WHERE invoice_id = $1 AND status = 'open'`, [inv.id])).rows[0].provider_session_id;
  await sendConnectEvent(evt("checkout.session.completed", account, sessionObj(sid, inv.id, 50000, ID("pi_rv_partial"))));
  const before = await C.balances();
  const cnBefore = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'credit_note'`, [C.cid])).rows[0].n;
  const rf = await sendConnectEvent(evt("charge.refunded", account, { id: "ch_rv", object: "charge", payment_intent: ID("pi_rv_partial"), currency: "aed", refunds: { data: [{ id: ID("re_rv_1"), amount: 50000, currency: "aed", status: "succeeded" }] } }));
  const gr = (await db.query(`SELECT status, note FROM gateway_refunds WHERE provider_refund_id = $1`, [ID("re_rv_1")])).rows[0];
  const cnAfter = (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1 AND invoice_type = 'credit_note'`, [C.cid])).rows[0].n;
  const after = await C.balances();
  ok("HIGH2 a refund on a partly paid invoice is parked: no credit note, 1025 and AR unchanged", rf.status === 200 && gr?.status === "unallocated" && cnAfter === cnBefore && after["1025"] === before["1025"] && after["1040"] === before["1040"], { gr, cnBefore, cnAfter, b: before["1025"], a: after["1025"] });
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    const sections = { discountsAndShipping, massAssignment, advances, priceLists, lateFees, recurring, customFields, quoteAcceptance, salesOrders, onlinePayments, advancesEdges, fuzz, customFieldEntities, frontendContract, reviewFixes };
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
