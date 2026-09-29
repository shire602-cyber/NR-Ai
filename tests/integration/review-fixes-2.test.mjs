// Integration tests for the second round of adversarial-review fixes:
//   7  VAT autopilot never saves an open period; status PATCH checks first
//   8  payments dated before their document (prepayments) are accepted
//   LOW bill locks/limits, payroll salary input, balance-sheet rounding, VAT PATCH body
// Drives real HTTP against a running server + Postgres.
//   BASE_URL=http://127.0.0.1:5057 node tests/integration/review-fixes-2.test.mjs

import pg from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const DATABASE_URL =
  process.env.DATABASE_URL;
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
const NIL_UUID = "00000000-0000-4000-8000-000000000000";

const db = new pg.Client({ connectionString: DATABASE_URL });

async function signup(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: `RF2 ${label}`, email: `rf2_${label}_${rnd}@example.com`, password: "Password123!" } });
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  return { token, cid };
}

async function main() {
  await db.connect();
  const A = await signup("a");
  const B = await signup("b");
  const { token, cid } = A;
  const rows = async (company, where = "") =>
    (await db.query(`SELECT id, status, period_start, period_end FROM vat_return_periods WHERE company_id = $1 ${where}`, [company])).rows;

  // ── Defect 7: VAT autopilot ───────────────────────────────────
  const monthStart = today.slice(0, 8) + "01";
  const monthEnd = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).toISOString().slice(0, 10);
  const calcUrl = (c, s, e) => `/api/vat/autopilot/calculate/${c}?periodStart=${s}&periodEnd=${e}&frequency=monthly`;

  let r = await api("GET", calcUrl(cid, monthStart, monthEnd), { token });
  ok("autopilot: open period calculates", r.status === 200 && r.json?.isDraftPreview === true, { s: r.status, m: r.json?.message });
  ok("autopilot: open period returns NO periodId", r.json?.periodId === null || r.json?.periodId === undefined, { periodId: r.json?.periodId });
  ok("autopilot: open period wrote nothing to vat_return_periods", (await rows(cid)).length === 0, await rows(cid));
  r = await api("GET", `/api/vat/autopilot/periods/${cid}`, { token });
  ok("autopilot: periods list has no saved row for the open period", Array.isArray(r.json) && r.json.every((p) => p.id === null), r.json?.map((p) => p.id));
  ok("autopilot: listed periods carry the isDraftPreview flag (all finished here)", Array.isArray(r.json) && r.json.length > 0 && r.json.every((p) => p.isDraftPreview === false), r.json?.map((p) => p.isDraftPreview));

  r = await api("GET", calcUrl(cid, ymd(40).slice(0, 8) + "01", ymd(70)), { token });
  ok("autopilot: a period that has not started is refused (422)", r.status === 422 && r.json?.code === "PERIOD_IN_FUTURE", { s: r.status, j: r.json });
  ok("autopilot: refused period wrote nothing", (await rows(cid)).length === 0, {});

  r = await api("GET", calcUrl(cid, "2025-01-01", "2025-03-31"), { token });
  const closedId = r.json?.periodId;
  ok("autopilot: a finished period is saved and returns its periodId", r.status === 200 && !!closedId && r.json?.isDraftPreview === false, { s: r.status, id: closedId, p: r.json?.isDraftPreview });
  ok("autopilot: exactly one row exists (the closed period)", (await rows(cid)).length === 1, await rows(cid));

  r = await api("PATCH", `/api/vat/autopilot/periods/${closedId}/status`, { token, body: { companyId: cid, status: "ready" } });
  ok("autopilot status: a finished period can be marked ready", r.status === 200 && r.json?.status === "ready", { s: r.status, j: r.json });

  r = await api("PATCH", `/api/vat/autopilot/periods/${NIL_UUID}/status`, { token, body: { companyId: cid, status: "ready" } });
  ok("autopilot status: a non-existent period is 404", r.status === 404, { s: r.status, j: r.json });
  ok("autopilot status: the 404 changed no row", (await rows(cid)).every((x) => x.id === closedId && x.status === "ready"), await rows(cid));

  // Another company's period: 404 with the caller's own companyId, 403 with the owner's.
  r = await api("GET", calcUrl(B.cid, "2025-01-01", "2025-03-31"), { token: B.token });
  const bPeriod = r.json?.periodId;
  ok("autopilot: company B has a saved period", !!bPeriod, r.json);
  r = await api("PATCH", `/api/vat/autopilot/periods/${bPeriod}/status`, { token, body: { companyId: cid, status: "ready" } });
  ok("autopilot status: another company's period id is 404", r.status === 404, { s: r.status, j: r.json });
  r = await api("PATCH", `/api/vat/autopilot/periods/${bPeriod}/status`, { token, body: { companyId: B.cid, status: "ready" } });
  ok("autopilot status: naming another company is refused (403)", r.status === 403, { s: r.status });
  ok("autopilot status: company B's row is untouched", (await rows(B.cid))[0]?.status === "draft", await rows(B.cid));

  // Rows an earlier version saved for OPEN periods: kept, but read as previews and frozen.
  const legacyReady = (await db.query(
    `INSERT INTO vat_return_periods (company_id, period_start, period_end, due_date, frequency, status)
     VALUES ($1, $2, $3, $4, 'monthly', 'ready') RETURNING id`,
    [cid, monthStart, monthEnd, ymd(60)]
  )).rows[0].id;
  const qStart = `${today.slice(0, 4)}-${String(Math.floor((+today.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const qEnd = new Date(Date.UTC(+qStart.slice(0, 4), +qStart.slice(5, 7) + 2, 0)).toISOString().slice(0, 10);
  const legacyDraft = (await db.query(
    `INSERT INTO vat_return_periods (company_id, period_start, period_end, due_date, frequency, status)
     VALUES ($1, $2, $3, $4, 'quarterly', 'draft') RETURNING id`,
    [cid, qStart, qEnd, ymd(60)]
  )).rows[0].id;
  // (skipped by the unique constraint if the month IS the quarter; re-select to be safe)
  const legacyDraftId = legacyDraft;

  r = await api("GET", `/api/vat/autopilot/periods/${cid}`, { token });
  ok("legacy open row: the periods list does not surface its stale id/status", Array.isArray(r.json) && !r.json.some((p) => p.id === legacyReady), r.json?.map((p) => [p.id, p.status]));
  r = await api("GET", `/api/vat/autopilot/periods/${cid}/${legacyReady}`, { token });
  ok("legacy open row: the detail read flags it as a draft preview", r.status === 200 && r.json?.isDraftPreview === true && r.json?.status === "draft", { s: r.status, p: r.json?.isDraftPreview, st: r.json?.status });
  r = await api("PATCH", `/api/vat/autopilot/periods/${legacyReady}/status`, { token, body: { companyId: cid, status: "submitted" } });
  ok("legacy open row: cannot be moved to submitted (400 PERIOD_NOT_ENDED)", r.status === 400 && r.json?.code === "PERIOD_NOT_ENDED", { s: r.status, j: r.json });
  r = await api("PATCH", `/api/vat/autopilot/periods/${legacyDraftId}/status`, { token, body: { companyId: cid, status: "ready" } });
  ok("open period cannot be moved to ready (400 PERIOD_NOT_ENDED)", r.status === 400 && r.json?.code === "PERIOD_NOT_ENDED", { s: r.status, j: r.json });
  const after = await rows(cid);
  ok("rejected transitions changed no row", after.find((x) => x.id === legacyReady)?.status === "ready" && after.find((x) => x.id === legacyDraftId)?.status === "draft", after.map((x) => [x.id, x.status]));

  // ── Defect 8: prepayments accepted; auto-reconcile uses the same resolver ──
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json;
  const bank = accounts.find((a) => a.code === "1020");
  const journal = async () => (await api("GET", `/api/companies/${cid}/journal`, { token })).json ?? [];
  const mkInvoice = async (date) => {
    const x = await api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "Pre Co", date, lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] } });
    await api("PATCH", `/api/invoices/${x.json.id}/status`, { token, body: { status: "sent" } });
    return x.json;
  };
  const inv = await mkInvoice(ymd(-5));
  r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token, body: { amount: 100, date: ymd(-30), method: "bank", paymentAccountId: bank.id } });
  ok("prepayment: an invoice payment before the invoice date is accepted", r.status === 201, { s: r.status, j: r.json });
  ok("prepayment: it is booked on the real bank date", (await journal()).some((e) => e.source === "payment" && day(e.date) === ymd(-30)), {});

  r = await api("POST", `/api/companies/${cid}/bank-accounts`, { token, body: { nameEn: "Recon", bankName: "Emirates NBD", currency: "AED", glAccountId: bank.id } });
  const bankAccountId = r.json?.id;
  const csv = ["Date,Description,Debit,Credit,Balance", `${ymd(-40)},EARLY DEPOSIT,,500.00,10000.00`, `${ymd(3)},FUTURE DEPOSIT,,300.00,10500.00`].join("\n");
  r = await api("POST", `/api/companies/${cid}/bank-statements/import`, { token, body: { bankAccountId, csvContent: csv } });
  ok("auto-reconcile: statement imported", r.status === 201, { s: r.status, j: r.json });
  const unrec = (await api("GET", `/api/companies/${cid}/bank-statements/unreconciled?bankAccountId=${bankAccountId}`, { token })).json;
  const txns = Array.isArray(unrec) ? unrec : unrec?.transactions ?? [];
  const early = txns.find((t) => String(t.description).includes("EARLY"));
  const future = txns.find((t) => String(t.description).includes("FUTURE"));
  if (future) {
    r = await api("POST", `/api/companies/${cid}/auto-reconcile/apply`, { token, body: { matches: [{ bankTransactionId: future.id, matchedType: "invoice", matchedId: inv.id }] } });
    ok("auto-reconcile: a future bank date is refused like every other settlement path", r.status === 200 && r.json?.applied === 0 && /future/i.test(r.json?.errors?.[0] ?? ""), { s: r.status, j: r.json });
  } else ok("auto-reconcile: future bank line imported", false, txns.map((t) => t.description));
  if (early) {
    r = await api("POST", `/api/companies/${cid}/auto-reconcile/apply`, { token, body: { matches: [{ bankTransactionId: early.id, matchedType: "invoice", matchedId: inv.id }] } });
    ok("auto-reconcile: a bank date before the invoice date is applied (deposit)", r.status === 200 && r.json?.applied === 1, { s: r.status, j: r.json });
  } else ok("auto-reconcile: early bank line imported", false, txns.map((t) => t.description));
  await api("POST", `/api/companies/${cid}/month-end/lock-period`, { token, body: { periodEnd: "2020-06-30" } });
  const lockedCsv = ["Date,Description,Debit,Credit,Balance", `2020-06-15,LOCKED DEPOSIT,,50.00,50.00`].join("\n");
  await api("POST", `/api/companies/${cid}/bank-statements/import`, { token, body: { bankAccountId, csvContent: lockedCsv } });
  const unrec2 = (await api("GET", `/api/companies/${cid}/bank-statements/unreconciled?bankAccountId=${bankAccountId}`, { token })).json;
  const locked = (Array.isArray(unrec2) ? unrec2 : unrec2?.transactions ?? []).find((t) => String(t.description).includes("LOCKED"));
  if (locked) {
    r = await api("POST", `/api/companies/${cid}/auto-reconcile/apply`, { token, body: { matches: [{ bankTransactionId: locked.id, matchedType: "invoice", matchedId: inv.id }] } });
    ok("auto-reconcile: a bank date in a locked period is refused", r.json?.applied === 0 && /locked/i.test(r.json?.errors?.[0] ?? ""), { s: r.status, j: r.json });
  }

  // ── LOW a/b: bills ────────────────────────────────────────────
  const mkBill = (body) => api("POST", `/api/companies/${cid}/bills`, { token, body: { vendor_name: "V", bill_date: ymd(-3), currency: "AED", ...body } });
  r = await mkBill({ line_items: [{ description: "x", quantity: 10000000000, unit_price: 1, vat_rate: 5 }] });
  ok("bills: quantity above 9,999,999,999.9999 is a clear 400", r.status === 400 && JSON.stringify(r.json).includes("9,999,999,999.9999"), { s: r.status, j: r.json });
  r = await mkBill({ line_items: [{ description: "x", quantity: 1, unit_price: 1e13, vat_rate: 5 }] });
  ok("bills: unit_price above 9,999,999,999,999.999999 is a clear 400", r.status === 400 && JSON.stringify(r.json).includes("9,999,999,999,999.999999"), { s: r.status, j: r.json });
  r = await mkBill({ line_items: [{ description: "x", quantity: "abc", unit_price: 1, vat_rate: 5 }] });
  ok("bills: a non-numeric quantity is a 400", r.status === 400, { s: r.status, j: r.json });
  r = await mkBill({ line_items: [{ description: "x", quantity: 9999999999.9999, unit_price: 0.000001, vat_rate: 0 }] });
  ok("bills: the maximum quantity is accepted (no DB overflow)", r.status === 200 && close(r.json?.subtotal, 10000), { s: r.status, j: r.json });
  r = await mkBill({ line_items: [{ description: "rounding", quantity: "1.23456", unit_price: "2.0000006", vat_rate: 5 }] });
  const billId = r.json?.id;
  const full = billId ? (await api("GET", `/api/bills/${billId}`, { token })).json : null;
  const ln = full?.line_items?.[0];
  ok("bills: quantity rounded to 4dp and unit price to 6dp before the amount", n(ln?.quantity) === 1.2346 && n(ln?.unit_price) === 2.000001 && n(ln?.amount) === 2.47, ln);
  ok("bills: subtotal is exact (2.47) with VAT 0.12", close(r.json?.subtotal, 2.47) && close(r.json?.vat_amount, 0.12), { sub: r.json?.subtotal, vat: r.json?.vat_amount });
  r = await mkBill({ line_items: [{ description: "float", quantity: 3, unit_price: 0.1, vat_rate: 0 }, { description: "float2", quantity: 100, unit_price: 1.005, vat_rate: 0 }] });
  ok("bills: line maths uses decimals, not floats (3 x 0.1 + 100 x 1.005 = 100.80)", r.status === 200 && r.json?.subtotal === "100.80", { s: r.status, sub: r.json?.subtotal });

  // period lock is checked on the STORED calendar day
  //   2020-06-30T22:00Z is 2020-07-01 in the UAE: stored as July -> not in the locked June.
  r = await mkBill({ bill_date: "2020-06-30T22:00:00.000Z", line_items: [{ description: "x", quantity: 1, unit_price: 10, vat_rate: 5 }] });
  ok("bill lock: a UAE-July instant whose UTC day is June 30 is allowed", r.status === 200 && day(r.json?.bill_date) === "2020-07-01", { s: r.status, d: r.json?.bill_date, m: r.json?.message });
  r = await mkBill({ bill_date: "2020-06-30T10:00:00.000Z", line_items: [{ description: "x", quantity: 1, unit_price: 10, vat_rate: 5 }] });
  ok("bill lock: a genuinely locked June day is refused (403)", r.status === 403, { s: r.status, j: r.json });

  // ── LOW c: payroll salary input ───────────────────────────────
  r = await api("POST", `/api/companies/${cid}/employees`, { token, body: { fullName: "Salary Test", basicSalary: 4000 } });
  const empId = r.json?.id;
  ok("payroll: employee created", r.status === 201 || r.status === 200, { s: r.status, j: r.json });
  r = await api("PATCH", `/api/employees/${empId}`, { token, body: { basicSalary: "5,000" } });
  ok("payroll: basicSalary \"5,000\" is a 400 (was truncated to 5)", r.status === 400 && r.json?.code === "INVALID_BASIC_SALARY", { s: r.status, j: r.json });
  r = await api("PATCH", `/api/employees/${empId}`, { token, body: { basicSalary: "5000abc" } });
  ok("payroll: basicSalary \"5000abc\" is a 400", r.status === 400, { s: r.status, j: r.json });
  r = await api("PATCH", `/api/employees/${empId}`, { token, body: { basicSalary: "5000.50" } });
  ok("payroll: a strict numeric string is accepted", r.status === 200, { s: r.status, j: r.json });
  const emp = (await db.query("SELECT basic_salary FROM employees WHERE id = $1", [empId])).rows[0];
  ok("payroll: the parsed number is what is stored", n(emp?.basic_salary) === 5000.5, emp);

  // ── LOW d: statements tie exactly ─────────────────────────────
  await mkInvoice(ymd(-2));
  await mkBill({ line_items: [{ description: "opex", quantity: 3, unit_price: 33.335, vat_rate: 5 }] });
  const cents = (v) => Math.round(n(v) * 100);
  const sumCents = (list) => list.reduce((s, x) => s + cents(x.amount), 0);
  r = await api("GET", `/api/companies/${cid}/financial-statements/balance-sheet?asOfDate=${today}`, { token });
  const bs = r.json;
  ok("financial-statements BS: each total equals the sum of its displayed rows", cents(bs?.assets?.total) === sumCents(bs?.assets?.breakdown ?? []) && cents(bs?.liabilities?.total) === sumCents(bs?.liabilities?.breakdown ?? []) && cents(bs?.equity?.total) === sumCents(bs?.equity?.breakdown ?? []), bs);
  ok("financial-statements BS: Assets == Liabilities + Equity exactly", cents(bs?.assets?.total) === cents(bs?.totalLiabilitiesAndEquity) && bs?.isBalanced === true, { a: bs?.assets?.total, le: bs?.totalLiabilitiesAndEquity });
  r = await api("GET", `/api/companies/${cid}/financial-statements/profit-loss?startDate=${ymd(-40)}&endDate=${today}`, { token });
  const pl = r.json;
  ok("financial-statements P&L: totals are sums of displayed rows and net = revenue - expenses",
    cents(pl?.revenue) === sumCents(pl?.breakdown?.revenue ?? []) && cents(pl?.expenses) === sumCents(pl?.breakdown?.expenses ?? []) && cents(pl?.netIncome) === cents(pl?.revenue) - cents(pl?.expenses), pl);
  r = await api("GET", `/api/companies/${cid}/reports/balance-sheet?endDate=${today}`, { token });
  const dbs = r.json;
  ok("dashboard BS: totals are sums of displayed rows", cents(dbs?.totalAssets) === sumCents(dbs?.assets ?? []) && cents(dbs?.totalLiabilities) === sumCents(dbs?.liabilities ?? []) && cents(dbs?.totalEquity) === sumCents(dbs?.equity ?? []), dbs);
  ok("dashboard BS: Assets == Liabilities + Equity exactly", cents(dbs?.totalAssets) === cents(dbs?.totalLiabilitiesAndEquity), { a: dbs?.totalAssets, le: dbs?.totalLiabilitiesAndEquity });
  r = await api("GET", `/api/companies/${cid}/reports/income-statement?startDate=${ymd(-40)}&endDate=${today}`, { token });
  const dpl = r.json;
  ok("dashboard P&L: totals are sums of displayed rows and net = revenue - expenses",
    cents(dpl?.totalRevenue) === sumCents(dpl?.revenue ?? []) && cents(dpl?.totalExpenses) === sumCents(dpl?.expenses ?? []) && cents(dpl?.netProfit) === cents(dpl?.totalRevenue) - cents(dpl?.totalExpenses), dpl);

  // ── LOW e: PATCH /api/vat-returns/:id body validation ─────────
  const prevEnd = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, 0)).toISOString().slice(0, 10);
  const prevStart = prevEnd.slice(0, 8) + "01";
  r = await api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: prevStart, periodEnd: prevEnd } });
  const vrId = r.json?.id;
  ok("vat return: generated a saved return for a finished period", !!vrId, { s: r.status, j: r.json });
  r = await api("PATCH", `/api/vat-returns/${vrId}`, { token, body: { periodEnd: prevEnd, notes: "date as string" } });
  ok("vat return PATCH: a string periodEnd is accepted (was a 500)", r.status === 200, { s: r.status, j: r.json });
  r = await api("PATCH", `/api/vat-returns/${vrId}`, { token, body: { periodEnd: "not-a-date" } });
  ok("vat return PATCH: an invalid date is a 400", r.status === 400, { s: r.status, j: r.json });
  r = await api("PATCH", `/api/vat-returns/${vrId}`, { token, body: { status: "bogus" } });
  ok("vat return PATCH: an unknown status is a 400", r.status === 400, { s: r.status, j: r.json });
  r = await api("PATCH", `/api/vat-returns/${vrId}`, { token, body: { box9ExpensesAmount: "5,000" } });
  ok("vat return PATCH: a non-numeric amount is a 400", r.status === 400, { s: r.status, j: r.json });
  r = await api("PATCH", `/api/vat-returns/${vrId}`, { token, body: { notes: "still works", companyId: B.cid } });
  ok("vat return PATCH: a normal edit works and companyId cannot be rewritten", r.status === 200 && r.json?.companyId === cid, { s: r.status, c: r.json?.companyId });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(fails.join("\n")); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.end());
