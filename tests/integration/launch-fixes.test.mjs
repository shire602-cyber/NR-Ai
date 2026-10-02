// Integration tests for launch phase-1 fixes: controllable payment dates,
// per-line revenue accounts, supply-type derivation, bill date convention.
// Drives real HTTP against a running server + Postgres.
//   BASE_URL=http://127.0.0.1:5055 node tests/integration/launch-fixes.test.mjs

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
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const today = ymd(0);
const n = (v) => Number(v ?? 0);
const close = (a, b, t = 0.005) => Math.abs(n(a) - n(b)) <= t;
const day = (d) => String(d).slice(0, 10);

async function main() {
  let r = await api("POST", "/api/auth/register", { body: { name: "Launch Fix", email: `launch_${rnd}@example.com`, password: "Password123!" } });
  ok("signup", r.status === 200 && !!r.json?.token, r.status);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json;
  const byCode = (c) => accounts.find((a) => a.code === c);
  const bank = byCode("1020");
  const journal = async () => (await api("GET", `/api/companies/${cid}/journal`, { token })).json ?? [];

  const mkInvoice = async (extra = {}) => {
    const x = await api("POST", `/api/companies/${cid}/invoices`, {
      token,
      body: { customerName: "Launch Co", date: ymd(-10), lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }], ...extra },
    });
    return x;
  };
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });

  // ── Fix 1: payment dates ─────────────────────────────────────
  r = await mkInvoice();
  const inv = r.json;
  await issue(inv.id);

  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, {
    token, body: { amount: 100, date: ymd(3), method: "bank", paymentAccountId: bank.id },
  });
  ok("payments: future date is rejected", r.status === 422 && r.json?.code === "PAYMENT_DATE_IN_FUTURE", { s: r.status, code: r.json?.code });

  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, {
    token, body: { amount: 100, date: ymd(-5), method: "bank", paymentAccountId: bank.id },
  });
  ok("payments: explicit past date accepted", r.status === 201, { s: r.status, m: r.json?.message });
  let je = (await journal()).filter((e) => e.source === "payment");
  ok("payments: journal entry is dated on the payment date", je.length === 1 && day(je[0].date) === ymd(-5), { dates: je.map((e) => e.date) });

  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, {
    token, body: { amount: 100, method: "bank", paymentAccountId: bank.id },
  });
  ok("payments: no date defaults to today", r.status === 201, { s: r.status });
  je = (await journal()).filter((e) => e.source === "payment");
  ok("payments: default-date entry posts on today", je.some((e) => day(e.date) === today), { dates: je.map((e) => e.date) });

  // A payment dated before the invoice is a legitimate deposit/prepayment: the
  // cash is recorded on its real bank date.
  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, {
    token, body: { amount: 100, date: ymd(-20), method: "bank", paymentAccountId: bank.id },
  });
  ok("payments: a payment dated before the invoice date is accepted (prepayment)", r.status === 201, { s: r.status, code: r.json?.code, m: r.json?.message });
  je = (await journal()).filter((e) => e.source === "payment");
  ok("payments: the prepayment journal is dated on the real payment date", je.some((e) => day(e.date) === ymd(-20)), { dates: je.map((e) => e.date) });

  // status -> paid with a payment date
  r = await mkInvoice();
  const inv2 = r.json;
  await issue(inv2.id);
  r = await api("PATCH", `/api/invoices/${inv2.id}/status`, { token, body: { status: "paid", paymentAccountId: bank.id } });
  ok("status->paid by hand is refused (STATUS_DERIVED)", r.status === 400 && r.json?.code === "STATUS_DERIVED", { s: r.status, c: r.json?.code });
  r = await api("POST", `/api/companies/${cid}/invoices/${inv2.id}/payments`, { token, body: { amount: Number(inv2.total), date: ymd(-7), method: "bank", paymentAccountId: bank.id } });
  ok("payment: accepts a payment date", r.status === 201, { s: r.status, m: r.json?.message });
  je = (await journal()).filter((e) => e.source === "payment");
  ok("payment: journal posts on the payment date", je.some((e) => day(e.date) === ymd(-7)), { dates: je.map((e) => e.date) });

  r = await mkInvoice();
  const inv3 = r.json;
  await issue(inv3.id);
  r = await api("POST", `/api/companies/${cid}/invoices/${inv3.id}/payments`, { token, body: { amount: Number(inv3.total), date: ymd(2), method: "bank", paymentAccountId: bank.id } });
  ok("payment: a future payment date is rejected", r.status === 422, { s: r.status, code: r.json?.code });

  // period lock applies to the payment date
  await api("POST", `/api/companies/${cid}/month-end/lock-period`, { token, body: { periodEnd: "2020-06-30" } });
  r = await api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "Old", date: "2019-01-01", lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.05 }] } });
  // (an old invoice, then a payment dated in the locked June 2020 month)
  const oldInv = r.json;
  if (oldInv?.id) {
    await issue(oldInv.id);
    r = await api("POST", `/api/companies/${cid}/invoices/${oldInv.id}/payments`, { token, body: { amount: 5, date: "2020-06-15", method: "bank", paymentAccountId: bank.id } });
    ok("payments: a payment dated in a locked period is refused", r.status === 403, { s: r.status, m: r.json?.message });
  }

  // ── Fix 1: bills ─────────────────────────────────────────────
  r = await api("POST", `/api/companies/${cid}/bills`, {
    token, body: { vendor_name: "Vendor", bill_date: ymd(-10), currency: "AED", line_items: [{ description: "goods", quantity: 1, unit_price: 1000, vat_rate: 0.05 }] },
  });
  const bill = r.json;
  ok("bills: create", r.status === 200 && !!bill?.id, { s: r.status, m: r.json?.message });
  ok("bills: bill_date is UTC midnight of the calendar day (no prior-day 20:00Z)", String(bill?.bill_date).endsWith("T00:00:00.000Z") && day(bill?.bill_date) === ymd(-10), { bill_date: bill?.bill_date });
  // a UAE browser sends midnight local as an ISO instant
  const uaeMidnight = new Date(Date.parse(ymd(-9) + "T00:00:00Z") - 4 * 3600000).toISOString();
  r = await api("POST", `/api/companies/${cid}/bills`, {
    token, body: { vendor_name: "Vendor2", bill_date: uaeMidnight, currency: "AED", line_items: [{ description: "g", quantity: 1, unit_price: 100, vat_rate: 0.05 }] },
  });
  ok("bills: a UAE-midnight ISO instant is stored as that calendar day", day(r.json?.bill_date) === ymd(-9), { sent: uaeMidnight, got: r.json?.bill_date });

  await api("POST", `/api/bills/${bill.id}/approve`, { token, body: {} });
  r = await api("POST", `/api/bills/${bill.id}/payments`, { token, body: { amount: 100, payment_date: ymd(4) } });
  ok("bills: future payment date rejected", r.status === 422 && r.json?.code === "PAYMENT_DATE_IN_FUTURE", { s: r.status, code: r.json?.code });
  r = await api("POST", `/api/bills/${bill.id}/payments`, { token, body: { amount: 100, payment_date: ymd(-4) } });
  ok("bills: explicit payment date accepted", r.status === 200, { s: r.status, m: r.json?.message });
  je = (await journal()).filter((e) => e.source === "bill_payment");
  ok("bills: payment journal is dated on payment_date", je.length === 1 && day(je[0].date) === ymd(-4), { dates: je.map((e) => e.date) });
  r = await api("POST", `/api/bills/${bill.id}/payments`, { token, body: { amount: 50 } });
  ok("bills: payment_date is optional (defaults to today)", r.status === 200, { s: r.status, m: r.json?.message });
  r = await api("POST", `/api/bills/${bill.id}/payments`, { token, body: { amount: 10, payment_date: ymd(-20) } });
  ok("bills: a payment dated before the bill date is accepted (prepayment)", r.status === 200, { s: r.status, code: r.json?.code, m: r.json?.message });
  je = (await journal()).filter((e) => e.source === "bill_payment");
  ok("bills: the prepayment journal is dated on the real payment date", je.some((e) => day(e.date) === ymd(-20)), { dates: je.map((e) => e.date) });

  // ── Fix 1: expense claim mark-paid ───────────────────────────
  r = await api("POST", `/api/companies/${cid}/expense-claims`, { token, body: { title: "Trip", items: [{ expense_date: ymd(-8), category: "taxi", description: "Taxi", amount: 100, vat_amount: 5 }] } });
  const claim = r.json;
  await api("POST", `/api/expense-claims/${claim.id}/submit`, { token, body: {} });
  await api("POST", `/api/expense-claims/${claim.id}/approve`, { token, body: { review_notes: "ok" } });
  r = await api("POST", `/api/expense-claims/${claim.id}/mark-paid`, { token, body: { payment_date: ymd(-2) } });
  ok("claims: mark-paid accepts payment_date", r.status === 200, { s: r.status, m: r.json?.message });
  je = (await journal()).filter((e) => e.source === "expense_claim_payment");
  ok("claims: reimbursement journal is dated on payment_date", je.length === 1 && day(je[0].date) === ymd(-2), { dates: je.map((e) => e.date) });
  r = await api("POST", `/api/companies/${cid}/expense-claims`, { token, body: { title: "Trip2", items: [{ expense_date: ymd(-8), category: "taxi", description: "Taxi", amount: 50, vat_amount: 0 }] } });
  const claim2 = r.json;
  await api("POST", `/api/expense-claims/${claim2.id}/submit`, { token, body: {} });
  await api("POST", `/api/expense-claims/${claim2.id}/approve`, { token, body: { review_notes: "ok" } });
  r = await api("POST", `/api/expense-claims/${claim2.id}/mark-paid`, { token, body: { payment_date: ymd(-30) } });
  ok("claims: a reimbursement dated before the expense date is accepted", r.status === 200, { s: r.status, code: r.json?.code, m: r.json?.message });

  // ── Fix 1: bank matching ─────────────────────────────────────
  r = await api("POST", `/api/companies/${cid}/bank-accounts`, { token, body: { nameEn: "Recon", bankName: "Emirates NBD", currency: "AED", glAccountId: bank.id } });
  const bankAccountId = r.json?.id;
  const depDate = ymd(-6);
  const csv = ["Date,Description,Debit,Credit,Balance", `${depDate},CUSTOMER DEPOSIT,,1050.00,10000.00`].join("\n");
  r = await api("POST", `/api/companies/${cid}/bank-statements/import`, { token, body: { bankAccountId, csvContent: csv } });
  ok("bank: import", r.status === 201 && n(r.json?.imported) === 1, { s: r.status, j: r.json });
  const unrec = (await api("GET", `/api/companies/${cid}/bank-statements/unreconciled?bankAccountId=${bankAccountId}`, { token })).json;
  const dep = (Array.isArray(unrec) ? unrec : unrec?.transactions ?? [])[0];
  r = await mkInvoice({ date: ymd(-9) });
  const inv4 = r.json;
  await issue(inv4.id);
  if (dep) {
    r = await api("POST", `/api/companies/${cid}/bank-statements/${dep.id}/match`, { token, body: { matchedType: "invoice", matchedId: inv4.id, paymentDate: ymd(3) } });
    ok("bank: match with a future paymentDate rejected", r.status === 422, { s: r.status, code: r.json?.code });
    r = await api("POST", `/api/companies/${cid}/bank-statements/${dep.id}/match`, { token, body: { matchedType: "invoice", matchedId: inv4.id } });
    ok("bank: match defaults to the bank transaction date", r.status === 200, { s: r.status, m: r.json?.message });
    je = (await journal()).filter((e) => e.source === "payment");
    ok("bank: matched payment journal posts on the bank line date", je.some((e) => day(e.date) === depDate), { dates: je.map((e) => e.date), depDate });
  }

  // ── Fix 2: revenue accounts ──────────────────────────────────
  const service = byCode("4020"), other = byCode("4030"), expense = byCode("5000");
  ok("revenue: chart has 4020/4030", !!service && !!other, {});
  r = await mkInvoice({ lines: [{ description: "bad", quantity: 1, unitPrice: 10, vatRate: 0.05, revenueAccountId: expense.id }] });
  ok("revenue: a non-income account is rejected (400)", r.status === 400 && r.json?.code === "INVALID_REVENUE_ACCOUNT", { s: r.status, j: r.json });
  r = await mkInvoice({ lines: [{ description: "bad", quantity: 1, unitPrice: 10, vatRate: 0.05, revenueAccountId: "00000000-0000-4000-8000-000000000000" }] });
  ok("revenue: an unknown / foreign account is rejected (400)", r.status === 400 && r.json?.code === "INVALID_REVENUE_ACCOUNT", { s: r.status, j: r.json });

  // account belonging to ANOTHER company
  const other2 = await api("POST", "/api/auth/register", { body: { name: "Other", email: `other_${rnd}@example.com`, password: "Password123!" } });
  const foreignAccts = (await api("GET", `/api/companies/${other2.json.company.id}/accounts`, { token: other2.json.token })).json;
  const foreignIncome = foreignAccts.find((a) => a.code === "4020");
  r = await mkInvoice({ lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 0.05, revenueAccountId: foreignIncome.id }] });
  ok("revenue: another company's income account is rejected (400)", r.status === 400, { s: r.status, j: r.json });

  const mix = await mkInvoice({
    lines: [
      { description: "consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, revenueAccountId: service.id },
      { description: "licence", quantity: 3, unitPrice: 200, vatRate: 0.05, revenueAccountId: other.id },
      { description: "goods", quantity: 2, unitPrice: 50.5, vatRate: 0.05 },
    ],
  });
  ok("revenue: invoice with chosen accounts created", mix.status === 200 || mix.status === 201, { s: mix.status, j: mix.json });
  const mixInv = mix.json;
  await issue(mixInv.id);
  let entry = (await journal()).find((e) => e.source === "invoice" && e.sourceId === mixInv.id);
  const credit = (code) => entry?.lines?.filter((l) => l.account?.code === code).reduce((s, l) => s + n(l.credit), 0) ?? 0;
  ok("revenue: 4020 credited 1000", close(credit("4020"), 1000), { c: credit("4020") });
  ok("revenue: 4030 credited 600", close(credit("4030"), 600), { c: credit("4030") });
  ok("revenue: default 4010 credited 101", close(credit("4010"), 101), { c: credit("4010") });
  const dr = entry.lines.reduce((s, l) => s + n(l.debit), 0), cr = entry.lines.reduce((s, l) => s + n(l.credit), 0);
  ok("revenue: mixed-account journal is balanced", close(dr, cr) && close(dr, 1786.05), { dr, cr });

  // lines keep the choice on read
  r = await api("GET", `/api/invoices/${mixInv.id}`, { token });
  ok("revenue: revenueAccountId round-trips on read", r.json?.lines?.filter((l) => l.revenueAccountId === service.id).length === 1, { lines: r.json?.lines });

  // editing the accounts of a posted invoice is refused
  r = await api("PUT", `/api/invoices/${mixInv.id}`, {
    token, body: { customerName: "Launch Co", date: ymd(-10), lines: [
      { description: "consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, revenueAccountId: other.id },
      { description: "licence", quantity: 3, unitPrice: 200, vatRate: 0.05, revenueAccountId: other.id },
      { description: "goods", quantity: 2, unitPrice: 50.5, vatRate: 0.05 } ] },
  });
  ok("revenue: changing accounts on a posted invoice is refused (422)", r.status === 422 && r.json?.code === "INVOICE_POSTED_REVENUE_ACCOUNT_LOCKED", { s: r.status, j: r.json });

  // credit note reverses the SAME accounts
  r = await api("POST", `/api/companies/${cid}/invoices/${mixInv.id}/credit-note`, { token, body: {} });
  ok("revenue: credit note issued", r.status === 201, { s: r.status, j: r.json });
  const cn = r.json;
  entry = (await journal()).find((e) => e.source === "invoice" && e.sourceId === cn?.id);
  const debit = (code) => entry?.lines?.filter((l) => l.account?.code === code).reduce((s, l) => s + n(l.debit), 0) ?? 0;
  ok("revenue: credit note debits 4020 / 4030 / 4010 exactly as posted", close(debit("4020"), 1000) && close(debit("4030"), 600) && close(debit("4010"), 101), { d: [debit("4020"), debit("4030"), debit("4010")] });
  ok("revenue: credit-note journal balanced", close(entry.lines.reduce((s, l) => s + n(l.debit), 0), entry.lines.reduce((s, l) => s + n(l.credit), 0)), {});

  // quote -> invoice keeps the choice
  r = await api("POST", `/api/companies/${cid}/quotes`, { token, body: { customerName: "Q Co", date: today, lines: [{ description: "advice", quantity: 1, unitPrice: 500, vatRate: 0.05, revenueAccountId: service.id }] } });
  const quote = r.json;
  if (quote?.id) {
    r = await api("POST", `/api/quotes/${quote.id}/convert-to-invoice`, { token, body: {} });
    const converted = r.json?.invoice;
    const full = converted ? (await api("GET", `/api/invoices/${converted.id}`, { token })).json : null;
    ok("revenue: quote conversion keeps the revenue account", full?.lines?.[0]?.revenueAccountId === service.id, { status: r.status, lines: full?.lines });
  }

  // ── Fix 3a: supply type ──────────────────────────────────────
  r = await mkInvoice({ lines: [
    { description: "export", quantity: 1, unitPrice: 100, vatRate: 0 },
    { description: "rent", quantity: 1, unitPrice: 100, vatRate: 0, vatSupplyType: "exempt" },
    { description: "std", quantity: 1, unitPrice: 100, vatRate: 0.05 },
  ] });
  const st = (await api("GET", `/api/invoices/${r.json.id}`, { token })).json;
  const types = Object.fromEntries((st.lines ?? []).map((l) => [l.description, l.vatSupplyType]));
  ok("supply type: 0% line stored as zero_rated", types.export === "zero_rated", types);
  ok("supply type: explicit exempt preserved", types.rent === "exempt", types);
  ok("supply type: 5% line stored as standard_rated", types.std === "standard_rated", types);

  // ── Fix 3b: no float noise ───────────────────────────────────
  const decimals = (v) => (String(v).split(".")[1] ?? "").length;
  const walk = (o, acc = []) => { if (typeof o === "number") acc.push(o); else if (o && typeof o === "object") Object.values(o).forEach((v) => walk(v, acc)); return acc; };
  const noNoise = (label, body) => ok(label, walk(body).every((v) => decimals(v) <= 2 || !Number.isFinite(v)), { sample: walk(body).filter((v) => decimals(v) > 2).slice(0, 4) });
  const from = ymd(-40), to = today;
  noNoise("floats: trial balance rounded", (await api("GET", `/api/companies/${cid}/reports/trial-balance?startDate=${from}&endDate=${to}`, { token })).json);
  noNoise("floats: aging rounded", (await api("GET", `/api/reports/${cid}/aging`, { token })).json);
  noNoise("floats: dashboard stats rounded", (await api("GET", `/api/companies/${cid}/dashboard/stats`, { token })).json);
  noNoise("floats: dashboard P&L rounded", (await api("GET", `/api/companies/${cid}/reports/income-statement?startDate=${from}&endDate=${to}`, { token })).json);
  noNoise("floats: dashboard balance sheet rounded", (await api("GET", `/api/companies/${cid}/reports/balance-sheet?asOfDate=${to}`, { token })).json);
  noNoise("floats: P&L statement rounded", (await api("GET", `/api/companies/${cid}/financial-statements/profit-loss?startDate=${from}&endDate=${to}`, { token })).json);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(fails.join("\n")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
