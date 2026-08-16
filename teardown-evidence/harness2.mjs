// Pass 2 — correct endpoints, deep GL inspection.
const BASE = "http://127.0.0.1:5000";
const out = [];
function log(...a) { const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); console.log(s); out.push(s); }

async function api(method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ct: res.headers.get("content-type") };
}

const rand = Math.random().toString(36).slice(2, 8);
const T = (s, ok, d) => log(`${ok ? "PASS" : "FAIL"}  ${s}  ${d === undefined ? "" : typeof d === "string" ? d : JSON.stringify(d).slice(0, 900)}`);
const n = (v) => Number(v ?? 0);
const close = (a, b, t = 0.01) => Math.abs(n(a) - n(b)) <= t;

let tk, cid, accounts, byCode;
const today = new Date().toISOString().slice(0, 10);

async function main() {
  let r = await api("POST", "/api/auth/register", { body: { name: "Deep Tester", email: `deep_${rand}@example.com`, password: "Password123!" } });
  tk = r.json.token; cid = r.json.company.id;
  T("register", !!tk);

  // Set TRN so VAT features unlock
  r = await api("PATCH", `/api/companies/${cid}`, { token: tk, body: { trnVatNumber: "100123456700003", vatRegistered: true, name: "Deep Test LLC" } });
  T("company: set TRN", r.status === 200, { status: r.status, msg: r.json?.message, trn: r.json?.trnVatNumber });

  r = await api("GET", `/api/companies/${cid}`, { token: tk });
  T("company: TRN persisted", !!(r.json?.trnVatNumber || r.json?.trn), { trn: r.json?.trnVatNumber, vatReg: r.json?.vatRegistered });

  r = await api("GET", `/api/companies/${cid}/accounts`, { token: tk });
  accounts = r.json;
  byCode = Object.fromEntries(accounts.map((a) => [a.code, a]));
  log("ACCOUNT SAMPLE: " + JSON.stringify(accounts.slice(0, 3)));
  log("ACCOUNT CODES: " + accounts.map((a) => `${a.code}:${a.nameEn || a.name}`).join(" | "));

  // ── Invoice: create then ISSUE via status ─────────────────
  r = await api("POST", `/api/companies/${cid}/invoices`, {
    token: tk,
    body: { customerName: "Acme Trading LLC", customerTrn: "100999888700003", date: today, dueDate: today, currency: "AED", status: "draft",
      lines: [{ description: "Consulting", quantity: 10, unitPrice: 100, vatRate: 5 }, { description: "Export", quantity: 1, unitPrice: 500, vatRate: 0 }] },
  });
  const inv = r.json; T("invoice: create", r.status === 200, { number: inv?.number, total: inv?.total });

  r = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: tk, body: { status: "sent" } });
  T("invoice: issue (draft -> sent)", r.status === 200, { status: r.status, msg: r.json?.message });

  // ── GL after issue ────────────────────────────────────────
  r = await api("GET", `/api/companies/${cid}/journal`, { token: tk });
  const jes = Array.isArray(r.json) ? r.json : r.json?.entries || [];
  T("gl: entry created on issue", jes.length === 1, `entries=${jes.length}`);
  if (jes[0]) {
    const d = await api("GET", `/api/journal/${jes[0].id}`, { token: tk });
    const lines = d.json?.lines || [];
    log("JE LINES: " + JSON.stringify(lines.map((l) => ({ acc: l.accountId?.slice(0, 6), code: accounts.find((a) => a.id === l.accountId)?.code, dr: l.debit, cr: l.credit }))));
    const dr = lines.reduce((s, l) => s + n(l.debit), 0), cr = lines.reduce((s, l) => s + n(l.credit), 0);
    T("gl: balanced", close(dr, cr), { dr, cr });
    T("gl: AR debit = 1550", close(dr, 1550), { dr });
  }

  // ── Reports after issue ───────────────────────────────────
  r = await api("GET", `/api/companies/${cid}/financial-statements/profit-loss?startDate=2000-01-01&endDate=2100-01-01`, { token: tk });
  log("P&L: " + JSON.stringify(r.json));
  T("P&L revenue = 1500", close(r.json?.revenue, 1500), { revenue: r.json?.revenue, net: r.json?.netIncome });

  r = await api("GET", `/api/companies/${cid}/financial-statements/balance-sheet?asOfDate=2100-01-01`, { token: tk });
  log("BS: " + JSON.stringify(r.json).slice(0, 1200));
  const A = n(r.json?.totalAssets), L = n(r.json?.totalLiabilities), E = n(r.json?.totalEquity);
  T("BS: assets = 1550 (AR)", close(A, 1550), { A });
  T("BS: liabilities = 50 (output VAT)", close(L, 50), { L });
  T("BS: equity = 1500 (retained profit)", close(E, 1500), { E });
  T("BS: A = L + E", close(A, L + E), { A, L, E });

  r = await api("GET", `/api/companies/${cid}/dashboard/stats`, { token: tk });
  log("DASH: " + JSON.stringify(r.json));
  T("dashboard: revenue positive 1500", close(r.json?.revenue, 1500), { revenue: r.json?.revenue });
  T("dashboard: outstanding positive 1550", close(r.json?.outstanding, 1550), { outstanding: r.json?.outstanding });

  // ── Payment with correct account ──────────────────────────
  const bank = accounts.find((a) => a.type === "asset" && /bank|cash/i.test(a.nameEn || a.name || ""));
  log("PAYMENT ACCOUNT: " + JSON.stringify(bank && { code: bank.code, name: bank.nameEn }));
  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token: tk, body: { amount: 1000, date: today, method: "bank_transfer", paymentAccountId: bank?.id } });
  T("payment: partial 1000", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });

  r = await api("GET", `/api/invoices/${inv.id}`, { token: tk });
  T("payment: status now partial", /partial/i.test(r.json?.status || ""), { status: r.json?.status, paid: r.json?.amountPaid });

  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token: tk, body: { amount: 9999, date: today, method: "cash", paymentAccountId: bank?.id } });
  T("payment: overpayment blocked", r.status >= 400, { status: r.status, msg: r.json?.message });

  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token: tk, body: { amount: 550, date: today, method: "cash", paymentAccountId: bank?.id } });
  T("payment: settle remaining 550", r.status === 200 || r.status === 201, { status: r.status });
  r = await api("GET", `/api/invoices/${inv.id}`, { token: tk });
  T("payment: status now paid", /paid/i.test(r.json?.status || ""), { status: r.json?.status });

  // ── VAT with TRN present ──────────────────────────────────
  r = await api("GET", `/api/companies/${cid}/reports/vat-return?from=2000-01-01&to=2100-01-01`, { token: tk });
  log("VAT RETURN REPORT: " + JSON.stringify(r.json).slice(0, 900));
  T("vat: return report", r.status === 200, { status: r.status });

  r = await api("POST", `/api/companies/${cid}/vat-returns/generate`, { token: tk, body: { periodStart: "2000-01-01", periodEnd: "2100-01-01" } });
  log("VAT 201: " + JSON.stringify(r.json).slice(0, 1200));
  T("vat: generate 201", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });
  const vr = r.json;
  if (vr?.id) {
    const sub = await api("POST", `/api/vat-returns/${vr.id}/submit`, { token: tk, body: {} });
    T("vat: submit to FTA", sub.status === 200, { status: sub.status, msg: sub.json?.message, body: JSON.stringify(sub.json).slice(0, 300) });
  }

  r = await api("GET", `/api/vat/autopilot/calculate/${cid}`, { token: tk });
  log("VAT AUTOPILOT: " + JSON.stringify(r.json).slice(0, 900));
  T("vat: autopilot", r.status === 200, { status: r.status });

  // ── e-invoicing with TRN ──────────────────────────────────
  r = await api("GET", `/api/invoices/${inv.id}/einvoice/validate`, { token: tk });
  log("EINV VALIDATE: " + JSON.stringify(r.json).slice(0, 600));
  r = await api("POST", `/api/invoices/${inv.id}/generate-einvoice`, { token: tk, body: {} });
  T("e-invoice: generate", r.status === 200, { status: r.status, msg: r.json?.message });
  r = await api("GET", `/api/invoices/${inv.id}/einvoice-xml`, { token: tk });
  T("e-invoice: XML", r.status === 200, { status: r.status, head: r.text.slice(0, 200) });
  r = await api("POST", `/api/invoices/${inv.id}/einvoice/submit`, { token: tk, body: {} });
  log("EINV SUBMIT: " + JSON.stringify(r.json).slice(0, 400));

  // ── Bank account creation (the 500) ───────────────────────
  for (const body of [
    { name: "ENBD Current", accountNumber: "123", currency: "AED" },
    { nameEn: "ENBD Current", bankName: "Emirates NBD", accountNumber: "123", currency: "AED" },
  ]) {
    r = await api("POST", `/api/companies/${cid}/bank-accounts`, { token: tk, body });
    T(`bank: create with keys [${Object.keys(body).join(",")}]`, r.status < 400, { status: r.status, msg: String(r.json?.message).slice(0, 200) });
  }

  // ── Period lock / month-end ───────────────────────────────
  for (const p of ["/api/companies/CID/month-end/periods", "/api/companies/CID/month-end/close", "/api/companies/CID/periods", "/api/month-end/CID/periods"]) {
    r = await api("GET", p.replace("CID", cid), { token: tk });
    log(`probe ${p} -> ${r.status}`);
  }

  // ── Every advertised report ───────────────────────────────
  r = await api("GET", "/api/reports/catalog", { token: tk });
  const cat = Array.isArray(r.json) ? r.json : r.json?.reports || [];
  log(`CATALOG ${cat.length}: ` + JSON.stringify(cat).slice(0, 2500));

  // ── Inventory / payroll / fixed assets smoke ──────────────
  const smoke = [
    ["GET", `/api/companies/${cid}/inventory/items`],
    ["GET", `/api/companies/${cid}/payroll/employees`],
    ["GET", `/api/companies/${cid}/fixed-assets`],
    ["GET", `/api/companies/${cid}/budgets`],
    ["GET", `/api/companies/${cid}/purchase-orders`],
    ["GET", `/api/companies/${cid}/quotes`],
    ["GET", `/api/companies/${cid}/expense-claims`],
    ["GET", `/api/companies/${cid}/bills`],
    ["GET", `/api/companies/${cid}/cost-centers`],
    ["GET", `/api/companies/${cid}/recurring-invoices`],
    ["GET", `/api/companies/${cid}/receipts`],
    ["GET", `/api/companies/${cid}/corporate-tax/liability`],
    ["GET", `/api/companies/${cid}/anomalies`],
    ["GET", `/api/companies/${cid}/cashflow/forecast`],
    ["GET", `/api/exchange-rates`],
    ["GET", `/api/notifications`],
  ];
  for (const [m, p] of smoke) {
    const rr = await api(m, p, { token: tk });
    log(`SMOKE ${m} ${p} -> ${rr.status} ${rr.status >= 400 ? String(rr.json?.message).slice(0, 120) : (Array.isArray(rr.json) ? `[${rr.json.length}]` : Object.keys(rr.json || {}).slice(0, 6).join(","))}`);
  }

  // ── AI endpoints without key ──────────────────────────────
  const rr = await api("POST", `/api/ai/chat`, { token: tk, body: { message: "what is my VAT position" } });
  log(`AI chat -> ${rr.status} ${String(rr.json?.message).slice(0, 160)}`);

  require("fs").writeFileSync("/tmp/pass2.txt", out.join("\n"));
}
import { createRequire } from "module";
const require = createRequire(import.meta.url);
main().catch((e) => { console.error("CRASH", e); require("fs").writeFileSync("/tmp/pass2.txt", out.join("\n") + "\nCRASH " + e.stack); });
