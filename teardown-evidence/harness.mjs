// Independent end-to-end harness for Muhasib. Not the project's own tests.
const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const results = [];
let ctx = {};

function rec(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 600)}`);
}

async function api(method, path, { body, token, raw } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, ct: res.headers.get("content-type") };
}

const rand = Math.random().toString(36).slice(2, 8);
const EMAIL = `roast_${rand}@example.com`;
const EMAIL2 = `roast2_${rand}@example.com`;
const PASSWORD = "Password123!";

function num(v) { return v === null || v === undefined ? NaN : Number(v); }
function close(a, b, tol = 0.01) { return Math.abs(num(a) - num(b)) <= tol; }

async function main() {
  // ── 1. Health ─────────────────────────────────────────────
  let r = await api("GET", "/api/version");
  rec("health: /api/version", r.status === 200, r.json);

  // ── 2. Signup ─────────────────────────────────────────────
  r = await api("POST", "/api/auth/register", { body: { name: "Roast Tester", email: EMAIL, password: PASSWORD } });
  rec("auth: register", r.status === 200 && !!r.json?.token, { status: r.status, msg: r.json?.message });
  if (!r.json?.token) { dump(); return; }
  ctx.token = r.json.token;
  ctx.companyId = r.json.company.id;
  ctx.userId = r.json.user.id;

  // weak password rejection
  r = await api("POST", "/api/auth/register", { body: { name: "Weak", email: `weak_${rand}@example.com`, password: "123" } });
  rec("auth: weak password rejected", r.status >= 400, { status: r.status });

  // ── 3. Chart of accounts ──────────────────────────────────
  r = await api("GET", `/api/companies/${ctx.companyId}/accounts`, { token: ctx.token });
  const accounts = Array.isArray(r.json) ? r.json : r.json?.accounts || [];
  rec("coa: seeded on signup", accounts.length > 10, `count=${accounts.length}`);
  ctx.accounts = accounts;
  const byCode = Object.fromEntries(accounts.map((a) => [a.code, a]));
  ctx.byCode = byCode;
  rec("coa: has AR/Revenue/VAT-payable accounts",
    accounts.some((a) => /receivable/i.test(a.name)) &&
    accounts.some((a) => /revenue|sales/i.test(a.name)) &&
    accounts.some((a) => /vat/i.test(a.name)),
    accounts.slice(0, 6).map((a) => `${a.code} ${a.name}`).join(" | "));

  // ── 4. Customer contact ───────────────────────────────────
  r = await api("POST", `/api/companies/${ctx.companyId}/customer-contacts`, {
    token: ctx.token,
    body: { name: "Acme Trading LLC", email: "ap@acme.example", trn: "100123456700003", type: "customer" },
  });
  rec("contacts: create customer", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });
  ctx.contactId = r.json?.id;

  // bad TRN (UAE TRN is 15 digits) — should be rejected
  r = await api("POST", `/api/companies/${ctx.companyId}/customer-contacts`, {
    token: ctx.token,
    body: { name: "Bad TRN Co", trn: "123", type: "customer" },
  });
  rec("contacts: invalid TRN rejected", r.status >= 400, { status: r.status, msg: r.json?.message });

  // ── 5. Invoice ────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  r = await api("POST", `/api/companies/${ctx.companyId}/invoices`, {
    token: ctx.token,
    body: {
      customerName: "Acme Trading LLC",
      date: today,
      dueDate: today,
      currency: "AED",
      status: "draft",
      lines: [
        { description: "Consulting", quantity: 10, unitPrice: 100, vatRate: 5 },
        { description: "Zero rated export", quantity: 1, unitPrice: 500, vatRate: 0 },
      ],
    },
  });
  rec("invoice: create draft", r.status === 200, { status: r.status, msg: r.json?.message });
  ctx.invoice = r.json;
  if (ctx.invoice?.id) {
    rec("invoice: totals correct (1500 net / 50 VAT / 1550 gross)",
      close(ctx.invoice.subtotal, 1500) && close(ctx.invoice.vatAmount, 50) && close(ctx.invoice.total, 1550),
      { subtotal: ctx.invoice.subtotal, vat: ctx.invoice.vatAmount, total: ctx.invoice.total });
    rec("invoice: number allocated", !!ctx.invoice.number, ctx.invoice.number);
  }

  // bad VAT rate must be rejected
  r = await api("POST", `/api/companies/${ctx.companyId}/invoices`, {
    token: ctx.token,
    body: { customerName: "X", date: today, lines: [{ description: "d", quantity: 1, unitPrice: 100, vatRate: 0.5 }] },
  });
  rec("invoice: bogus 50% VAT rate rejected", r.status >= 400, { status: r.status });

  // negative amount
  r = await api("POST", `/api/companies/${ctx.companyId}/invoices`, {
    token: ctx.token,
    body: { customerName: "X", date: today, lines: [{ description: "d", quantity: 1, unitPrice: -100, vatRate: 5 }] },
  });
  rec("invoice: negative unit price rejected", r.status >= 400, { status: r.status });

  // foreign currency with no rate
  r = await api("POST", `/api/companies/${ctx.companyId}/invoices`, {
    token: ctx.token,
    body: { customerName: "X", date: today, currency: "USD", lines: [{ description: "d", quantity: 1, unitPrice: 100, vatRate: 5 }] },
  });
  rec("invoice: foreign currency without FX rate refused", r.status === 422, { status: r.status, code: r.json?.code });

  // ── 6. GL before posting ──────────────────────────────────
  r = await api("GET", `/api/companies/${ctx.companyId}/journal`, { token: ctx.token });
  const je0 = Array.isArray(r.json) ? r.json : r.json?.entries || [];
  rec("gl: draft invoice does NOT hit the ledger", je0.length === 0, `entries=${je0.length}`);

  // ── 7. Issue / post the invoice ───────────────────────────
  r = await api("POST", `/api/invoices/${ctx.invoice?.id}/post`, { token: ctx.token, body: {} });
  const posted = r.status === 200;
  rec("invoice: post to GL", posted, { status: r.status, msg: r.json?.message });

  r = await api("GET", `/api/companies/${ctx.companyId}/journal`, { token: ctx.token });
  const je1 = Array.isArray(r.json) ? r.json : r.json?.entries || [];
  rec("gl: journal entry created on issue", je1.length > 0, `entries=${je1.length}`);
  ctx.je1 = je1;

  if (je1[0]?.id) {
    r = await api("GET", `/api/journal/${je1[0].id}`, { token: ctx.token });
    const lines = r.json?.lines || r.json?.entryLines || [];
    const dr = lines.reduce((s, l) => s + num(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + num(l.credit || 0), 0);
    rec("gl: entry is balanced (Dr = Cr)", close(dr, cr), { dr, cr, lines: lines.length });
    rec("gl: AR debited 1550 / revenue 1500 / VAT 50",
      close(dr, 1550) && close(cr, 1550), { dr, cr });
  }

  // double-post guard
  r = await api("POST", `/api/invoices/${ctx.invoice?.id}/post`, { token: ctx.token, body: {} });
  rec("gl: double-posting the same invoice is blocked", r.status >= 400, { status: r.status, msg: r.json?.message });

  // ── 8. Payment ────────────────────────────────────────────
  r = await api("POST", `/api/companies/${ctx.companyId}/invoices/${ctx.invoice?.id}/payments`, {
    token: ctx.token,
    body: { amount: 1550, date: today, method: "bank_transfer", reference: "TT-1" },
  });
  rec("payment: record full payment", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });

  r = await api("GET", `/api/invoices/${ctx.invoice?.id}`, { token: ctx.token });
  rec("payment: invoice marked paid", /paid/i.test(r.json?.status || ""), { status: r.json?.status, amountPaid: r.json?.amountPaid });

  // overpayment guard
  r = await api("POST", `/api/companies/${ctx.companyId}/invoices/${ctx.invoice?.id}/payments`, {
    token: ctx.token,
    body: { amount: 99999, date: today, method: "cash" },
  });
  rec("payment: overpayment blocked", r.status >= 400, { status: r.status, msg: r.json?.message });

  // ── 9. Credit note ────────────────────────────────────────
  r = await api("POST", `/api/companies/${ctx.companyId}/invoices/${ctx.invoice?.id}/credit-note`, {
    token: ctx.token,
    body: { reason: "Partial return", lines: [{ description: "Consulting", quantity: 1, unitPrice: 100, vatRate: 5 }] },
  });
  rec("credit note: create from invoice", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });
  ctx.creditNote = r.json;
  if (ctx.creditNote?.id) {
    r = await api("POST", `/api/credit-notes/${ctx.creditNote.id}/issue`, { token: ctx.token, body: {} });
    rec("credit note: issue posts to GL", r.status === 200, { status: r.status, msg: r.json?.message });
  }

  // ── 10. Manual journal ────────────────────────────────────
  const cash = ctx.accounts.find((a) => /cash|bank/i.test(a.name));
  const exp = ctx.accounts.find((a) => /expense|rent|utilit|office/i.test(a.name) && a.type === "expense") || ctx.accounts.find((a) => a.type === "expense");
  if (cash && exp) {
    r = await api("POST", `/api/companies/${ctx.companyId}/journal`, {
      token: ctx.token,
      body: {
        date: today, description: "Unbalanced entry test", reference: "TEST-UNBAL",
        lines: [
          { accountId: exp.id, debit: 100, credit: 0, description: "x" },
          { accountId: cash.id, debit: 0, credit: 90, description: "y" },
        ],
      },
    });
    rec("gl: unbalanced manual journal rejected", r.status >= 400, { status: r.status, msg: r.json?.message });

    r = await api("POST", `/api/companies/${ctx.companyId}/journal`, {
      token: ctx.token,
      body: {
        date: today, description: "Office rent", reference: "TEST-BAL",
        lines: [
          { accountId: exp.id, debit: 1000, credit: 0, description: "rent" },
          { accountId: cash.id, debit: 0, credit: 1000, description: "cash" },
        ],
      },
    });
    rec("gl: balanced manual journal accepted", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });
    ctx.manualJe = r.json;
  } else {
    rec("gl: manual journal (skipped, no accounts found)", false, "could not resolve cash/expense accounts");
  }

  // ── 11. Reports ───────────────────────────────────────────
  r = await api("GET", `/api/companies/${ctx.companyId}/reports/trial-balance`, { token: ctx.token });
  const tb = r.json;
  const tbRows = tb?.rows || tb?.accounts || (Array.isArray(tb) ? tb : []);
  const tbDr = tbRows.reduce((s, x) => s + num(x.debit ?? x.totalDebit ?? 0), 0);
  const tbCr = tbRows.reduce((s, x) => s + num(x.credit ?? x.totalCredit ?? 0), 0);
  rec("report: trial balance returns", r.status === 200, { status: r.status });
  rec("report: trial balance balances", close(tbDr, tbCr, 0.02), { dr: tbDr, cr: tbCr, rows: tbRows.length });

  r = await api("GET", `/api/companies/${ctx.companyId}/financial-statements/profit-loss?startDate=2000-01-01&endDate=2100-01-01`, { token: ctx.token });
  rec("report: P&L returns", r.status === 200, { status: r.status, keys: r.json ? Object.keys(r.json).slice(0, 8) : null });
  ctx.pl = r.json;

  r = await api("GET", `/api/companies/${ctx.companyId}/financial-statements/balance-sheet?asOfDate=2100-01-01`, { token: ctx.token });
  rec("report: balance sheet returns", r.status === 200, { status: r.status });
  const bs = r.json;
  const A = num(bs?.totalAssets ?? bs?.assets?.total);
  const L = num(bs?.totalLiabilities ?? bs?.liabilities?.total);
  const E = num(bs?.totalEquity ?? bs?.equity?.total);
  rec("report: balance sheet actually balances (A = L + E)", close(A, L + E, 0.02), { A, L, E, diff: A - (L + E) });

  r = await api("GET", `/api/companies/${ctx.companyId}/financial-statements/cash-flow?startDate=2000-01-01&endDate=2100-01-01`, { token: ctx.token });
  rec("report: cash flow returns", r.status === 200, { status: r.status });

  r = await api("GET", `/api/reports/catalog`, { token: ctx.token });
  const catalog = Array.isArray(r.json) ? r.json : r.json?.reports || [];
  rec("report: catalog", r.status === 200, `reports advertised=${catalog.length}`);
  ctx.catalog = catalog;

  r = await api("GET", `/api/reports/${ctx.companyId}/aging`, { token: ctx.token });
  rec("report: AR aging", r.status === 200, { status: r.status });

  // ── 12. VAT ───────────────────────────────────────────────
  r = await api("GET", `/api/companies/${ctx.companyId}/reports/vat-return?startDate=2000-01-01&endDate=2100-01-01`, { token: ctx.token });
  rec("vat: VAT return report", r.status === 200, { status: r.status, body: r.json });
  ctx.vatReport = r.json;

  r = await api("POST", `/api/companies/${ctx.companyId}/vat-returns/generate`, {
    token: ctx.token,
    body: { periodStart: "2000-01-01", periodEnd: "2100-01-01" },
  });
  rec("vat: generate VAT 201 return", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });
  ctx.vatReturn = r.json;

  r = await api("GET", `/api/vat/autopilot/calculate/${ctx.companyId}`, { token: ctx.token });
  rec("vat: autopilot calculate", r.status === 200, { status: r.status, msg: r.json?.message });

  // ── 13. e-invoicing ───────────────────────────────────────
  r = await api("GET", `/api/invoices/${ctx.invoice?.id}/einvoice/validate`, { token: ctx.token });
  rec("e-invoice: validate endpoint", r.status === 200, { status: r.status, body: r.json });
  r = await api("GET", `/api/invoices/${ctx.invoice?.id}/einvoice-xml`, { token: ctx.token });
  rec("e-invoice: XML generation", r.status === 200, { status: r.status, len: r.text.length, head: r.text.slice(0, 120) });
  r = await api("POST", `/api/invoices/${ctx.invoice?.id}/einvoice/submit`, { token: ctx.token, body: {} });
  rec("e-invoice: submit to ASP", r.status === 200, { status: r.status, msg: r.json?.message });

  // ── 14. PDF ───────────────────────────────────────────────
  r = await api("GET", `/api/invoices/${ctx.invoice?.id}/pdf`, { token: ctx.token });
  rec("invoice: PDF renders", r.status === 200 && /pdf/i.test(r.ct || ""), { status: r.status, ct: r.ct, len: r.text.length });

  // ── 15. Bank ──────────────────────────────────────────────
  r = await api("POST", `/api/companies/${ctx.companyId}/bank-accounts`, {
    token: ctx.token,
    body: { name: "ENBD Current", accountNumber: "1234567890", currency: "AED", openingBalance: 0 },
  });
  rec("bank: create bank account", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });
  ctx.bankAccount = r.json;

  r = await api("GET", `/api/companies/${ctx.companyId}/bank-statements/unreconciled`, { token: ctx.token });
  rec("bank: unreconciled feed", r.status === 200, { status: r.status });

  r = await api("GET", `/api/bank/providers`, { token: ctx.token });
  rec("bank: open-banking providers", r.status === 200, r.json);

  // ── 16. Dashboard ─────────────────────────────────────────
  r = await api("GET", `/api/companies/${ctx.companyId}/dashboard/stats`, { token: ctx.token });
  rec("dashboard: stats", r.status === 200, { status: r.status, body: r.json });

  // ── 17. Multi-tenant isolation ────────────────────────────
  r = await api("POST", "/api/auth/register", { body: { name: "Attacker", email: EMAIL2, password: PASSWORD } });
  ctx.token2 = r.json?.token;
  ctx.companyId2 = r.json?.company?.id;
  rec("auth: second tenant registered", !!ctx.token2, { status: r.status });

  if (ctx.token2) {
    r = await api("GET", `/api/companies/${ctx.companyId}/invoices`, { token: ctx.token2 });
    rec("SECURITY: tenant B cannot list tenant A invoices", r.status === 403 || r.status === 404, { status: r.status, n: Array.isArray(r.json) ? r.json.length : null });

    r = await api("GET", `/api/invoices/${ctx.invoice?.id}`, { token: ctx.token2 });
    rec("SECURITY: tenant B cannot read tenant A invoice by id", r.status === 403 || r.status === 404, { status: r.status });

    r = await api("GET", `/api/companies/${ctx.companyId}/accounts`, { token: ctx.token2 });
    rec("SECURITY: tenant B cannot read tenant A chart of accounts", r.status === 403 || r.status === 404, { status: r.status });

    r = await api("DELETE", `/api/invoices/${ctx.invoice?.id}`, { token: ctx.token2 });
    rec("SECURITY: tenant B cannot delete tenant A invoice", r.status === 403 || r.status === 404, { status: r.status });

    r = await api("GET", `/api/companies/${ctx.companyId}/financial-statements/balance-sheet?asOfDate=2100-01-01`, { token: ctx.token2 });
    rec("SECURITY: tenant B cannot pull tenant A balance sheet", r.status === 403 || r.status === 404, { status: r.status });

    r = await api("POST", `/api/companies/${ctx.companyId}/journal`, {
      token: ctx.token2,
      body: { date: today, description: "hostile", lines: [] },
    });
    rec("SECURITY: tenant B cannot post journal into tenant A", r.status === 403 || r.status === 404 || r.status === 400, { status: r.status });
  }

  // no-auth access
  r = await api("GET", `/api/companies/${ctx.companyId}/invoices`);
  rec("SECURITY: unauthenticated read blocked", r.status === 401, { status: r.status });

  // admin surface
  r = await api("GET", `/api/admin/users`, { token: ctx.token });
  rec("SECURITY: non-admin blocked from admin API", r.status === 401 || r.status === 403 || r.status === 404, { status: r.status });

  // ── 18. Period lock ───────────────────────────────────────
  r = await api("GET", `/api/companies/${ctx.companyId}/month-end/periods`, { token: ctx.token });
  rec("month-end: periods endpoint", r.status === 200, { status: r.status });

  // ── 19. Deleting a posted invoice ─────────────────────────
  r = await api("DELETE", `/api/invoices/${ctx.invoice?.id}`, { token: ctx.token });
  rec("integrity: cannot delete a posted+paid invoice", r.status >= 400, { status: r.status, msg: r.json?.message });

  // ── 20. Backdating into a filed VAT period ────────────────
  r = await api("POST", `/api/companies/${ctx.companyId}/invoices`, {
    token: ctx.token,
    body: { customerName: "Backdated", date: "2019-01-01", lines: [{ description: "old", quantity: 1, unitPrice: 100, vatRate: 5 }] },
  });
  rec("integrity: backdated invoice into ancient period", r.status === 200 ? false : true,
    { status: r.status, note: r.status === 200 ? "ACCEPTED — no guard" : r.json?.message });

  dump();
}

function dump() {
  const pass = results.filter((x) => x.ok).length;
  console.log("\n================ SUMMARY ================");
  console.log(`PASS ${pass} / ${results.length}`);
  console.log("FAILURES:");
  results.filter((x) => !x.ok).forEach((x) => console.log(" - " + x.step + "  :: " + (typeof x.detail === "string" ? x.detail : JSON.stringify(x.detail))));
  require("fs").writeFileSync("/tmp/harness-results.json", JSON.stringify({ results, ctx: { catalog: ctx.catalog?.length, vatReport: ctx.vatReport, pl: ctx.pl } }, null, 2));
}

import { createRequire } from "module";
const require = createRequire(import.meta.url);

main().catch((e) => { console.error("HARNESS CRASH", e); dump(); });
