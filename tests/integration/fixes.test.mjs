// Integration tests for the Phase 0/1 fixes. Drives real HTTP against a real
// server backed by a real Postgres. Run with the app already listening on
// $BASE_URL (default http://127.0.0.1:5000). Exits non-zero on any failure.
//
// Covered:
//   - C5  app booted (health)
//   - C2  VAT 201 boxes store money exactly (no float rounding)
//   - C3  period lock succeeds and blocks writes into the locked period
//   - C4  overpayment is rejected unless allowCredit=true
//   - H6  bank account creation does not 500 on the documented field name
//   - H4  absurd VAT return period is rejected  (only asserted if 1.6 is implemented)
//   - ledger integrity: issue posts a balanced entry; TB balances

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const today = new Date().toISOString().slice(0, 10);
const n = (v) => Number(v ?? 0);
const close = (a, b, t = 0.005) => Math.abs(n(a) - n(b)) <= t;

async function main() {
  // C5 — health
  let r = await api("GET", "/api/version");
  ok("C5 app boots and /api/version responds", r.status === 200, r.status);

  // signup
  r = await api("POST", "/api/auth/register", { body: { name: "Fix Test", email: `fix_${rnd}@example.com`, password: "Password123!" } });
  ok("signup returns a token", r.status === 200 && !!r.json?.token, r.status);
  const token = r.json.token, companyId = r.json.company.id;
  await api("PATCH", `/api/companies/${companyId}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });

  const accounts = (await api("GET", `/api/companies/${companyId}/accounts`, { token })).json;
  const bank = accounts.find((a) => a.code === "1020");

  // ── C4: overpayment ────────────────────────────────────────
  r = await api("POST", `/api/companies/${companyId}/invoices`, {
    token, body: { customerName: "Overpay Co", date: today, dueDate: today, lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 5 }] },
  });
  const inv = r.json;
  await api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "sent" } });

  r = await api("POST", `/api/companies/${companyId}/invoices/${inv.id}/payments`, {
    token, body: { amount: 100000, date: today, method: "cash", paymentAccountId: bank.id },
  });
  ok("C4 overpayment (100,000 on a 1,050 invoice) is rejected", r.status === 422 && r.json?.code === "PAYMENT_EXCEEDS_BALANCE", { status: r.status, code: r.json?.code });

  // invoice must still be unpaid / not silently marked paid
  r = await api("GET", `/api/invoices/${inv.id}`, { token });
  ok("C4 invoice not silently marked paid by the overpayment", !/paid/i.test(r.json?.status || ""), { status: r.json?.status });

  // exact-balance payment still works
  r = await api("POST", `/api/companies/${companyId}/invoices/${inv.id}/payments`, {
    token, body: { amount: 1050, date: today, method: "cash", paymentAccountId: bank.id },
  });
  ok("C4 exact-balance payment (1,050) is accepted", r.status === 201 || r.status === 200, { status: r.status });

  // explicit opt-in credit path still available
  r = await api("POST", `/api/companies/${companyId}/invoices`, {
    token, body: { customerName: "Credit Co", date: today, lines: [{ description: "svc", quantity: 1, unitPrice: 100, vatRate: 5 }] },
  });
  const inv2 = r.json;
  await api("PATCH", `/api/invoices/${inv2.id}/status`, { token, body: { status: "sent" } });
  r = await api("POST", `/api/companies/${companyId}/invoices/${inv2.id}/payments`, {
    token, body: { amount: 200, date: today, method: "cash", paymentAccountId: bank.id, allowCredit: true },
  });
  ok("C4 overpayment WITH allowCredit=true is accepted", r.status === 201 || r.status === 200, { status: r.status, msg: r.json?.message });

  // ── C2: money precision ────────────────────────────────────
  // Build an invoice whose VAT 201 box carries an awkward figure and assert it
  // round-trips exactly (a float column would corrupt 9,999,999.99).
  r = await api("POST", `/api/companies/${companyId}/invoices`, {
    token, body: { customerName: "Big Co", date: today, lines: [{ description: "big", quantity: 1, unitPrice: 9999999.99, vatRate: 0 }] },
  });
  const big = r.json;
  ok("C2 large invoice total stored exactly (9,999,999.99)", close(big?.subtotal, 9999999.99), { subtotal: big?.subtotal });
  await api("PATCH", `/api/invoices/${big.id}/status`, { token, body: { status: "sent" } });
  // Use a valid current-month period (period validation now rejects absurd spans).
  const monthStart = today.slice(0, 8) + "01";
  r = await api("POST", `/api/companies/${companyId}/vat-returns/generate`, {
    token, body: { periodStart: monthStart, periodEnd: today },
  });
  ok("C2 VAT return generates", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });
  // box4 zero-rated should equal the 9,999,999.99 line exactly (not 10,000,000)
  const box4 = r.json?.box4ZeroRatedAmount;
  ok("C2 VAT box stores 9,999,999.99 exactly (float would give 10,000,000)", close(box4, 9999999.99, 0.005), { box4 });

  // ── H4: absurd VAT period rejected ─────────────────────────
  r = await api("POST", `/api/companies/${companyId}/vat-returns/generate`, {
    token, body: { periodStart: "1900-01-01", periodEnd: "2999-12-31" },
  });
  ok("H4 absurd 1,100-year VAT period is rejected", r.status === 422, { status: r.status, code: r.json?.code });

  // future period rejected
  r = await api("POST", `/api/companies/${companyId}/vat-returns/generate`, {
    token, body: { periodStart: "2099-01-01", periodEnd: "2099-03-31" },
  });
  ok("H4 future VAT period is rejected", r.status === 422, { status: r.status, code: r.json?.code });

  // ── H6: bank account creation does not 500 ─────────────────
  // The canonical handler lives in bank-statements.routes.ts. It used to be
  // SHADOWED by a looser duplicate in companies.routes.ts, so its UAE bank
  // validation never ran. `name` is accepted as an alias for `nameEn`.
  r = await api("POST", `/api/companies/${companyId}/bank-accounts`, {
    token, body: { name: "ENBD Current", bankName: "Emirates NBD", accountNumber: "1234567890", currency: "AED" },
  });
  ok("H6 bank account created from a {name} alias (no 500)", r.status === 201 || r.status === 200, { status: r.status, msg: r.json?.message });

  // an empty payload is a clean 4xx, not a 500
  r = await api("POST", `/api/companies/${companyId}/bank-accounts`, { token, body: {} });
  ok("H6 empty bank account payload returns 4xx not 500", r.status >= 400 && r.status < 500, { status: r.status });

  // the stricter validation is now actually reachable
  r = await api("POST", `/api/companies/${companyId}/bank-accounts`, {
    token, body: { nameEn: "Made Up", bankName: "Not A Real Bank", currency: "AED" },
  });
  ok("H6 unrecognised bankName is rejected (shadowed handler is now live)", r.status >= 400 && r.status < 500, { status: r.status });

  // ── C3: period lock ────────────────────────────────────────
  // Locking is per calendar month (the month of periodEnd), so lock June 2020
  // and then attempt a write dated inside June 2020.
  r = await api("POST", `/api/companies/${companyId}/month-end/lock-period`, {
    token, body: { periodEnd: "2020-06-30" },
  });
  ok("C3 lock-period succeeds (no 500)", r.status === 200 || r.status === 201, { status: r.status, msg: r.json?.message });

  // an invoice dated inside the locked month must be refused
  r = await api("POST", `/api/companies/${companyId}/invoices`, {
    token, body: { customerName: "Locked", date: "2020-06-15", lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 5 }] },
  });
  ok("C3 write into the locked period is blocked", r.status >= 400, { status: r.status, msg: r.json?.message });

  // a write outside the locked period still works
  r = await api("POST", `/api/companies/${companyId}/invoices`, {
    token, body: { customerName: "Open period", date: today, lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 5 }] },
  });
  ok("C3 write outside the locked period still works", r.status === 200, { status: r.status });

  // ── ledger integrity ───────────────────────────────────────
  r = await api("GET", `/api/companies/${companyId}/reports/trial-balance`, { token });
  const rows = r.json?.rows || [];
  const dr = rows.reduce((s, x) => s + n(x.debit ?? x.totalDebit), 0);
  const cr = rows.reduce((s, x) => s + n(x.credit ?? x.totalCredit), 0);
  ok("ledger: trial balance balances", close(dr, cr, 0.02), { dr, cr });

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error("HARNESS CRASH", e); process.exit(2); });
