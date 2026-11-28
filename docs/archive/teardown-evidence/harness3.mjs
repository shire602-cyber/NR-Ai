// Pass 3 — integrity attacks: overpayment, period locks, VAT after filing, ledger damage.
const BASE = "http://127.0.0.1:5000";
const out = [];
const log = (...a) => { const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); console.log(s); out.push(s); };
async function api(m, p, { body, token } = {}) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method: m, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: res.status, json: j, text: t, ct: res.headers.get("content-type") };
}
const n = (v) => Number(v ?? 0);
const T = (s, ok, d) => log(`${ok ? "PASS" : "FAIL"}  ${s}  ${d === undefined ? "" : typeof d === "string" ? d : JSON.stringify(d).slice(0, 700)}`);
const rand = Math.random().toString(36).slice(2, 8);
const today = new Date().toISOString().slice(0, 10);

async function trialBalance(tk, cid) {
  const r = await api("GET", `/api/companies/${cid}/reports/trial-balance`, { token: tk });
  const rows = r.json?.rows || r.json?.accounts || (Array.isArray(r.json) ? r.json : []);
  const dr = rows.reduce((s, x) => s + n(x.debit ?? x.totalDebit), 0);
  const cr = rows.reduce((s, x) => s + n(x.credit ?? x.totalCredit), 0);
  return { dr, cr, rows: rows.filter((x) => n(x.debit ?? x.totalDebit) || n(x.credit ?? x.totalCredit)).map((x) => `${x.code || x.accountCode}:${n(x.debit ?? x.totalDebit)}/${n(x.credit ?? x.totalCredit)}`) };
}

async function main() {
  let r = await api("POST", "/api/auth/register", { body: { name: "Integrity", email: `int_${rand}@example.com`, password: "Password123!" } });
  const tk = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token: tk, body: { trnVatNumber: "100123456700003", vatRegistered: true } });
  const accs = (await api("GET", `/api/companies/${cid}/accounts`, { token: tk })).json;
  const bank = accs.find((a) => a.code === "1020");
  const rev = accs.find((a) => a.code === "4010");
  const exp = accs.find((a) => a.code === "5010");

  // ── OVERPAYMENT DAMAGE ───────────────────────────────────
  r = await api("POST", `/api/companies/${cid}/invoices`, { token: tk, body: { customerName: "Overpay Co", date: today, dueDate: today, lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 5 }] } });
  const inv = r.json;
  await api("PATCH", `/api/invoices/${inv.id}/status`, { token: tk, body: { status: "sent" } });
  log("Invoice total = " + inv.total);

  const before = await trialBalance(tk, cid);
  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token: tk, body: { amount: 500, date: today, method: "cash", paymentAccountId: bank.id } });
  log("partial 500 -> " + r.status);
  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token: tk, body: { amount: 100000, date: today, method: "cash", paymentAccountId: bank.id } });
  T("OVERPAYMENT of AED 100,000 against a AED 1,050 invoice is REJECTED", r.status >= 400, { status: r.status, msg: r.json?.message, recorded: r.json?.amount });

  const inv2 = (await api("GET", `/api/invoices/${inv.id}`, { token: tk })).json;
  log("invoice after overpay: status=" + inv2.status + " amountPaid=" + inv2.amountPaid + " total=" + inv2.total);
  const after = await trialBalance(tk, cid);
  log("TB after: " + JSON.stringify(after));
  T("ledger still internally balanced after overpay", Math.abs(after.dr - after.cr) < 0.02, { dr: after.dr, cr: after.cr });

  const ar = after.rows.find((x) => x.startsWith("1040"));
  log("AR line after overpayment: " + ar);

  const bs = (await api("GET", `/api/companies/${cid}/financial-statements/balance-sheet?asOfDate=2100-01-01`, { token: tk })).json;
  log("BS after overpay: " + JSON.stringify(bs).slice(0, 700));

  // ── SINGLE PAYMENT > INVOICE, fresh invoice ──────────────
  r = await api("POST", `/api/companies/${cid}/invoices`, { token: tk, body: { customerName: "Overpay2", date: today, lines: [{ description: "s", quantity: 1, unitPrice: 100, vatRate: 5 }] } });
  const invB = r.json;
  await api("PATCH", `/api/invoices/${invB.id}/status`, { token: tk, body: { status: "sent" } });
  r = await api("POST", `/api/companies/${cid}/invoices/${invB.id}/payments`, { token: tk, body: { amount: 50000, date: today, method: "cash", paymentAccountId: bank.id } });
  T("single payment 50,000 on a 105 invoice REJECTED", r.status >= 400, { status: r.status, msg: r.json?.message });

  // negative payment
  r = await api("POST", `/api/companies/${cid}/invoices/${invB.id}/payments`, { token: tk, body: { amount: -500, date: today, method: "cash", paymentAccountId: bank.id } });
  T("negative payment rejected", r.status >= 400, { status: r.status, msg: r.json?.message });

  // ── PERIOD LOCK ──────────────────────────────────────────
  r = await api("POST", `/api/companies/${cid}/month-end/lock-period`, { token: tk, body: { periodStart: "2026-01-01", periodEnd: "2026-12-31", year: 2026, month: 8 } });
  T("month-end: lock period", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message, body: JSON.stringify(r.json).slice(0, 300) });

  r = await api("POST", `/api/companies/${cid}/invoices`, { token: tk, body: { customerName: "Locked period", date: today, lines: [{ description: "s", quantity: 1, unitPrice: 100, vatRate: 5 }] } });
  T("invoice into LOCKED period rejected", r.status >= 400, { status: r.status, msg: r.json?.message });

  r = await api("GET", `/api/period-lock/list?companyId=${cid}`, { token: tk });
  log("period-lock list -> " + r.status + " " + JSON.stringify(r.json).slice(0, 300));

  r = await api("POST", `/api/period-lock/unlock`, { token: tk, body: { companyId: cid, year: 2026, month: 8 } });
  T("non-admin can unlock a closed period?", r.status >= 400, { status: r.status, msg: r.json?.message });

  // ── AMEND AN INVOICE ALREADY IN A FILED VAT RETURN ───────
  const cid2 = await freshCompany();
  r = await api("POST", `/api/companies/${cid2.cid}/invoices`, { token: cid2.tk, body: { customerName: "Filed", date: today, lines: [{ description: "s", quantity: 1, unitPrice: 1000, vatRate: 5 }] } });
  const fi = r.json;
  await api("PATCH", `/api/invoices/${fi.id}/status`, { token: cid2.tk, body: { status: "sent" } });
  r = await api("POST", `/api/companies/${cid2.cid}/vat-returns/generate`, { token: cid2.tk, body: { periodStart: "2026-07-01", periodEnd: "2026-09-30" } });
  const vret = r.json;
  log("VAT return generated: " + r.status + " box8TotalVat=" + vret?.box8TotalVat);
  r = await api("POST", `/api/vat-returns/${vret?.id}/submit`, { token: cid2.tk, body: {} });
  log("VAT return submitted: " + r.status + " status=" + r.json?.status);

  r = await api("PUT", `/api/invoices/${fi.id}`, { token: cid2.tk, body: { lines: [{ description: "s", quantity: 1, unitPrice: 99999, vatRate: 5 }], date: today, customerName: "Filed" } });
  T("editing an invoice inside a SUBMITTED VAT period rejected", r.status >= 400, { status: r.status, msg: r.json?.message });
  const fiAfter = (await api("GET", `/api/invoices/${fi.id}`, { token: cid2.tk })).json;
  log("invoice after edit attempt: total=" + fiAfter.total);

  r = await api("POST", `/api/companies/${cid2.cid}/vat-returns/generate`, { token: cid2.tk, body: { periodStart: "2026-07-01", periodEnd: "2026-09-30" } });
  T("duplicate VAT return for the SAME period rejected", r.status >= 400, { status: r.status, msg: r.json?.message });

  // absurd VAT period
  r = await api("POST", `/api/companies/${cid2.cid}/vat-returns/generate`, { token: cid2.tk, body: { periodStart: "1900-01-01", periodEnd: "2999-12-31" } });
  T("1,100-year VAT period rejected", r.status >= 400, { status: r.status, msg: r.json?.message });

  // ── AUDIT TRAIL ──────────────────────────────────────────
  for (const p of [`/api/companies/${cid}/audit-logs`, `/api/companies/${cid}/activity-logs`, `/api/audit-logs?companyId=${cid}`, `/api/companies/${cid}/history`]) {
    const rr = await api("GET", p, { token: tk });
    log(`audit probe ${p} -> ${rr.status} ${rr.status === 200 ? (Array.isArray(rr.json) ? `[${rr.json.length}]` : Object.keys(rr.json || {}).join(",")) : ""}`);
  }

  // ── PAYROLL / INVENTORY / CT depth ───────────────────────
  const probes = [
    ["GET", `/api/companies/${cid}/payroll-runs`],
    ["GET", `/api/companies/${cid}/inventory-movements`],
    ["GET", `/api/companies/${cid}/budget-plans`],
    ["GET", `/api/companies/${cid}/corporate-tax/calculate`],
    ["GET", `/api/companies/${cid}/corporate-tax/returns`],
    ["GET", `/api/companies/${cid}/month-end/checklist`],
    ["GET", `/api/companies/${cid}/vat-workpapers`],
  ];
  for (const [m, p] of probes) {
    const rr = await api(m, p, { token: tk });
    log(`PROBE ${m} ${p} -> ${rr.status} ${JSON.stringify(rr.json).slice(0, 260)}`);
  }

  // ── ERROR LEAKAGE ────────────────────────────────────────
  r = await api("POST", `/api/companies/${cid}/bank-accounts`, { token: tk, body: { name: "x", accountNumber: "1" } });
  T("500s do not leak SQL to the client", !/insert into|select .* from/i.test(r.text), { status: r.status, leak: r.text.slice(0, 200) });

  require("fs").writeFileSync("/tmp/pass3.txt", out.join("\n"));
}

async function freshCompany() {
  const s = Math.random().toString(36).slice(2, 8);
  const r = await api("POST", "/api/auth/register", { body: { name: "F", email: `f_${s}@example.com`, password: "Password123!" } });
  const tk = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token: tk, body: { trnVatNumber: "100123456700003", vatRegistered: true } });
  return { tk, cid };
}

import { createRequire } from "module";
const require = createRequire(import.meta.url);
main().catch((e) => { console.error("CRASH", e); require("fs").writeFileSync("/tmp/pass3.txt", out.join("\n") + "\nCRASH " + e.stack); });
