// Integration tests for Phase 6 stream C: payslip, customer statement, proforma and delivery-note PDFs.
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5063 DATABASE_URL=... node tests/integration/phase6-pdfs.test.mjs
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
async function api(method, p, { body, token, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const today = ymd(now);
const addDays = (iso, days) => ymd(new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000));
const from = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))); // first day of last month
const beforeFrom = addDays(from, -20);
const IBAN = "AE070331234567890129876";

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const bank = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json.find((a) => a.code === "1020");
  return { token, cid, bank };
}

async function issueInvoice(C, contact, date, unitPrice, extra = {}) {
  const r1 = await api("POST", `/api/companies/${C.cid}/invoices`, {
    token: C.token,
    body: { customerName: contact.name, contactId: contact.id, date, dueDate: date, lines: [{ description: "Service", quantity: 2, unitPrice: unitPrice / 2, vatRate: 0.05 }], ...extra },
  });
  if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 200));
  const r2 = await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token: C.token, body: { status: "sent" } });
  if (r2.status !== 200) throw new Error("issue failed " + r2.status + " " + r2.text.slice(0, 200));
  return r1.json;
}
const pay = (C, inv, amount, date) =>
  api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/payments`, { token: C.token, body: { amount, date, method: "bank", paymentAccountId: C.bank.id } });

async function main() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await statementSection();
    await refundOnStatement("linked", true);
    await refundOnStatement("nameonly", false);
    await pdfVariantsSection();
    await payslipSection();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

async function statementSection() {
  const A = await newCompany("stmtA");
  const B = await newCompany("stmtB");
  const c = await api("POST", `/api/companies/${A.cid}/customer-contacts`, { token: A.token, body: { name: "Statement Customer LLC", email: `cust_${rnd}@example.com` } });
  const contact = c.json;
  ok("statement: setup contact", !!contact?.id, c);

  const inv0 = await issueInvoice(A, contact, beforeFrom, 1000); // 1,050 incl. VAT, before the period
  ok("statement: setup payment before the period", [200, 201].includes((await pay(A, inv0, 300, beforeFrom)).status));
  const inv1 = await issueInvoice(A, contact, addDays(from, 2), 500); // 525
  ok("statement: setup payment in the period", [200, 201].includes((await pay(A, inv1, 200, addDays(from, 4))).status));
  const cn = await api("POST", `/api/companies/${A.cid}/invoices/${inv1.id}/credit-note`, { token: A.token, body: { date: addDays(from, 3), lines: [{ description: "Service", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  ok("statement: setup credit note (105)", cn.status === 201, { s: cn.status, t: cn.text?.slice(0, 200) });
  // excluded documents: a draft and a voided invoice
  await api("POST", `/api/companies/${A.cid}/invoices`, { token: A.token, body: { customerName: contact.name, contactId: contact.id, date: addDays(from, 5), dueDate: addDays(from, 5), lines: [{ description: "Draft", quantity: 1, unitPrice: 9999, vatRate: 0.05 }] } });
  const voided = await issueInvoice(A, contact, addDays(from, 5), 777);
  const v = await api("PATCH", `/api/invoices/${voided.id}/status`, { token: A.token, body: { status: "void" } });
  ok("statement: setup void", v.status === 200, { s: v.status, t: v.text?.slice(0, 200) });

  const url = `/api/companies/${A.cid}/contacts/${contact.id}/statement`;
  const s = await api("GET", `${url}?from=${from}&to=${today}`, { token: A.token });
  ok("statement: JSON 200", s.status === 200 && !!s.json, { s: s.status, t: s.text?.slice(0, 200) });
  const st = s.json ?? {};
  ok("statement: opening balance = 1,050 - 300", close(st.openingBalance, 750), st.openingBalance);
  ok("statement: lines are the invoice, the credit note and the payment (no draft, no void)",
    (st.lines ?? []).map((l) => l.type).join(",") === "invoice,credit_note,payment" &&
    (st.lines ?? []).every((l) => l.reference !== voided.number), (st.lines ?? []).map((l) => `${l.type}:${l.reference}`));
  ok("statement: running balance 1,275 -> 1,170 -> 970",
    (st.lines ?? []).map((l) => l.balance).join(",") === "1275,1170,970", (st.lines ?? []).map((l) => l.balance));
  ok("statement: closing balance 970", close(st.closingBalance, 970), st.closingBalance);
  ok("statement: ageing total matches the closing balance", close(st.aging?.total, 970), st.aging);
  const invoiceRow = await api("GET", `/api/invoices/${inv1.id}`, { token: A.token });
  ok("statement: matches the invoice outstanding (525 - 200 - 105 = 220)", close(invoiceRow.json?.outstandingAmount, 220), invoiceRow.json?.outstandingAmount);

  const bad = await api("GET", `${url}?from=nonsense&to=${today}`, { token: A.token });
  ok("statement: bad dates -> 400", bad.status === 400, bad.status);
  const reversed = await api("GET", `${url}?from=${today}&to=${from}`, { token: A.token });
  ok("statement: from after to -> 400", from < today ? reversed.status === 400 : true, reversed.status);
  const cross = await api("GET", `/api/companies/${B.cid}/contacts/${contact.id}/statement?from=${from}&to=${today}`, { token: B.token });
  ok("statement: another company's contact id -> 404", cross.status === 404, cross.status);
  const foreign = await api("GET", `${url}?from=${from}&to=${today}`, { token: B.token });
  ok("statement: another company's user -> 403", foreign.status === 403, foreign.status);

  const pdf = await api("GET", `${url}/pdf?from=${from}&to=${today}`, { token: A.token, raw: true });
  ok("statement: PDF is application/pdf", pdf.status === 200 && /application\/pdf/.test(pdf.headers.get("content-type") ?? "") && pdf.buf.subarray(0, 5).toString() === "%PDF-", { s: pdf.status });
  const text = pdf.status === 200 ? await pdfText(pdf.buf) : "";
  ok("statement: PDF carries the invoice number and the closing balance", text.includes(inv1.number) && text.includes("970.00"), text.slice(0, 200));

  const mail = await api("POST", `${url}/email`, { token: A.token, body: { from, to: today } });
  ok("statement: email without a provider -> 503 EMAIL_NOT_CONFIGURED", mail.status === 503 && mail.json?.code === "EMAIL_NOT_CONFIGURED", { s: mail.status, j: mail.json });
  const noMail = await api("POST", `${url}/email`, { token: A.token, body: { from: "bad", to: today } });
  ok("statement: email with bad dates -> 400", noMail.status === 400, noMail.status);
  const foreignMail = await api("POST", `${url}/email`, { token: B.token, body: { from, to: today } });
  ok("statement: email by another company's user -> 403", foreignMail.status === 403, foreignMail.status);
}

// A customer refund (cash paid back against a credit note) is a statement line that INCREASES what the
// customer owes; a voided refund is not money moved and does not appear. Covers a customer that is a
// contact on the invoice and one that only exists as a name (the contact is created afterwards).
async function refundOnStatement(label, linked) {
  const C = await newCompany("stmtR" + label);
  const name = `Refund Customer ${label} ${rnd}`;
  const d1 = addDays(from, 2), d2 = addDays(from, 3), d3 = addDays(from, 6);
  let contact;
  let inv;
  if (linked) {
    contact = (await api("POST", `/api/companies/${C.cid}/customer-contacts`, { token: C.token, body: { name } })).json;
    inv = await issueInvoice(C, contact, d1, 1000); // 1,050 incl. VAT
  } else {
    // name-only: no contactId on the invoice; the contact with the same name exists only afterwards
    inv = await issueInvoice(C, { name, id: undefined }, d1, 1000);
    contact = (await api("POST", `/api/companies/${C.cid}/customer-contacts`, { token: C.token, body: { name } })).json;
  }
  ok(`refund statement (${label}): setup contact and invoice`, !!contact?.id && !!inv?.id, { c: contact, i: inv?.id });
  ok(`refund statement (${label}): setup invoice paid in full`, [200, 201].includes((await pay(C, inv, 1050, d1)).status));
  const cn = await api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/credit-note`, { token: C.token, body: { date: d2 } });
  ok(`refund statement (${label}): setup full credit note`, cn.status === 201, { s: cn.status, t: cn.text?.slice(0, 200) });
  const refundUrl = `/api/companies/${C.cid}/credit-notes/${cn.json?.id}/refunds`;
  const r1 = await api("POST", refundUrl, { token: C.token, body: { amount: 300, date: d3, bankAccountId: C.bank.id, reference: "RF-KEEP" } });
  ok(`refund statement (${label}): setup refund of 300`, r1.status === 201, { s: r1.status, t: r1.text?.slice(0, 200) });
  const r2 = await api("POST", refundUrl, { token: C.token, body: { amount: 200, date: d3, bankAccountId: C.bank.id, reference: "RF-VOIDED" } });
  const vr = await api("POST", `${refundUrl}/${r2.json?.refund?.id}/void`, { token: C.token, body: {} });
  ok(`refund statement (${label}): setup second refund created and voided`, r2.status === 201 && vr.status === 200, { s: r2.status, v: vr.status });

  const s = await api("GET", `/api/companies/${C.cid}/contacts/${contact.id}/statement?from=${from}&to=${today}`, { token: C.token });
  const st = s.json ?? {};
  const lines = st.lines ?? [];
  const refundLines = lines.filter((l) => l.type === "refund");
  ok(`refund statement (${label}): exactly one refund line (the voided one is absent)`,
    s.status === 200 && refundLines.length === 1 && refundLines[0].reference === "RF-KEEP" && !lines.some((l) => l.reference === "RF-VOIDED"),
    { s: s.status, lines: lines.map((l) => `${l.type}:${l.reference}:${l.debit}/${l.credit}`) });
  const idx = lines.indexOf(refundLines[0]);
  ok(`refund statement (${label}): the refund is a debit of 300 that raises the balance by 300`,
    idx > 0 && close(refundLines[0].debit, 300) && close(refundLines[0].credit, 0) && close(refundLines[0].balance - lines[idx - 1].balance, 300),
    { refund: refundLines[0], before: lines[idx - 1] });
  ok(`refund statement (${label}): invoice 1,050, payment -1,050, credit note -1,050, refund +300 = closing -750`,
    lines.map((l) => l.type).sort().join(",") === "credit_note,invoice,payment,refund" &&
      close(lines.find((l) => l.type === "invoice")?.debit, 1050) && close(lines.find((l) => l.type === "payment")?.credit, 1050) &&
      close(lines.find((l) => l.type === "credit_note")?.credit, 1050),
    lines.map((l) => `${l.type}:${l.debit}/${l.credit}`));
  ok(`refund statement (${label}): closing balance is the customer's credit left after the refund (-750)`, close(st.closingBalance, -750), st.closingBalance);
}

async function pdfVariantsSection() {
  const C = await newCompany("pdfv");
  const contact = (await api("POST", `/api/companies/${C.cid}/customer-contacts`, { token: C.token, body: { name: "Delivery Customer" } })).json;
  const inv = await issueInvoice(C, contact, today, 1000);

  const d = await api("GET", `/api/invoices/${inv.id}/pdf?variant=delivery`, { token: C.token, raw: true });
  ok("delivery note: application/pdf", d.status === 200 && /application\/pdf/.test(d.headers.get("content-type") ?? "") && d.buf.subarray(0, 5).toString() === "%PDF-" && /delivery-note/.test(d.headers.get("content-disposition") ?? ""), { s: d.status });
  const dt = d.status === 200 ? await pdfText(d.buf) : "";
  ok("delivery note: titled, with a signature block", dt.includes("DELIVERY NOTE") && dt.includes("Received by") && dt.includes("Signature"), dt.slice(0, 200));
  ok("delivery note: no prices, VAT or totals", !/Price|VAT|Subtotal|TOTAL|1,050|1,000\.00|500\.00|50\.00/.test(dt), dt);
  const plain = await api("GET", `/api/invoices/${inv.id}/pdf`, { token: C.token, raw: true });
  const plainText = await pdfText(plain.buf);
  ok("invoice PDF without a variant is unchanged (still a tax invoice with totals)", plain.status === 200 && /1,?050\.00/.test(plainText) && !plainText.includes("DELIVERY NOTE"), plainText.slice(0, 200));
  const other = await newCompany("pdfv2");
  const denied = await api("GET", `/api/invoices/${inv.id}/pdf?variant=delivery`, { token: other.token, raw: true });
  ok("delivery note keeps the invoice PDF authorization (other company -> 404)", denied.status === 404 || denied.status === 403, denied.status);

  const q = await api("POST", `/api/companies/${C.cid}/quotes`, { token: C.token, body: { customerName: "Quote Customer", date: today, expiryDate: addDays(today, 14), currency: "AED", lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] } });
  ok("proforma: setup quote", q.status === 201, { s: q.status, t: q.text?.slice(0, 200) });
  const p = await api("GET", `/api/quotes/${q.json?.id}/pdf?variant=proforma`, { token: C.token, raw: true });
  ok("proforma: application/pdf", p.status === 200 && /application\/pdf/.test(p.headers.get("content-type") ?? "") && /proforma/.test(p.headers.get("content-disposition") ?? ""), { s: p.status });
  const pt = p.status === 200 ? await pdfText(p.buf) : "";
  ok("proforma: titled and marked not a tax invoice", pt.includes("PROFORMA INVOICE") && pt.includes("This is not a tax invoice"), pt.slice(0, 200));
  const qdenied = await api("GET", `/api/quotes/${q.json?.id}/pdf?variant=proforma`, { token: other.token, raw: true });
  ok("proforma keeps the quote PDF authorization (other company -> 403)", qdenied.status === 403, qdenied.status);
}

async function payslipSection() {
  const A = await newCompany("payA");
  const B = await newCompany("payB");
  const emp = await api("POST", `/api/companies/${A.cid}/employees`, {
    token: A.token,
    body: { employeeNumber: "EMP-001", fullName: "Ahmed Khan", fullNameAr: "أحمد خان", nationality: "India", designation: "Accountant", iban: IBAN, basicSalary: 8000, housingAllowance: 3000, transportAllowance: 1000, otherAllowance: 0, joinDate: "2023-01-01" },
  });
  ok("payslip: setup employee", emp.status === 201, { s: emp.status, t: emp.text?.slice(0, 200) });
  const run = await api("POST", `/api/companies/${A.cid}/payroll-runs`, { token: A.token, body: { periodMonth: 8, periodYear: 2026 } });
  ok("payslip: setup run", [200, 201].includes(run.status) && !!run.json?.id, { s: run.status, t: run.text?.slice(0, 200) });
  const runId = run.json?.id;

  const calc = await api("POST", `/api/payroll-runs/${runId}/calculate`, { token: A.token });
  ok("payslip: setup calculate", calc.status === 200, { s: calc.status, t: calc.text?.slice(0, 200) });
  const items = (await api("GET", `/api/payroll-runs/${runId}/items`, { token: A.token })).json ?? [];
  const itemId = items[0]?.id;
  ok("payslip: the run has an item", !!itemId, items);

  const r = await api("GET", `/api/payroll-runs/${runId}/payslips/${itemId}/pdf`, { token: A.token, raw: true });
  ok("payslip: application/pdf on a calculated run", r.status === 200 && /application\/pdf/.test(r.headers.get("content-type") ?? "") && r.buf.subarray(0, 5).toString() === "%PDF-", { s: r.status });
  const text = r.status === 200 ? await pdfText(r.buf) : "";
  ok("payslip: content (name, ID, net pay, employer contributions, IBAN masked)",
    text.includes("Ahmed Khan") && text.includes("EMP-001") && text.includes("NET PAY") && text.includes("EMPLOYER CONTRIBUTIONS") && text.includes("9876") && !text.includes(IBAN) && !text.includes("0331234567890"),
    text.slice(0, 300));

  const foreign = await api("GET", `/api/payroll-runs/${runId}/payslips/${itemId}/pdf`, { token: B.token, raw: true });
  ok("payslip: another company's user -> 403", foreign.status === 403, foreign.status);
  const missing = await api("GET", `/api/payroll-runs/${runId}/payslips/00000000-0000-4000-8000-000000000000/pdf`, { token: A.token, raw: true });
  ok("payslip: unknown item -> 404", missing.status === 404, missing.status);

  const draft = await api("POST", `/api/companies/${A.cid}/payroll-runs`, { token: A.token, body: { periodMonth: 9, periodYear: 2026 } });
  const draftItem = await api("GET", `/api/payroll-runs/${draft.json?.id}/payslips/${itemId}/pdf`, { token: A.token });
  ok("payslip: a draft (not calculated) run -> 409", draftItem.status === 409, draftItem.status);
}

main().catch((e) => { console.error(e); process.exit(1); });
