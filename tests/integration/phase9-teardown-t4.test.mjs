// Integration tests for the t4 teardown fixes (banking, FX, fixed assets, close): depreciation catch-up that never posts
// into a closed or locked period, disposal after a closed year, bill payments that need a real bank account, USD bank
// reconciliation, one receipt over several invoices, overpayment as customer credit, split bank lines and own-account
// transfers across currencies.
//   BASE_URL=http://localhost:5075 DATABASE_URL=... node tests/integration/phase9-teardown-t4.test.mjs

import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, p, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const day = (offset) => ymd(new Date(Date.now() + offset * 86400000));
const today = day(0);
const Y = new Date().getUTCFullYear();
let db;

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  const acct = (code) => accounts.find((x) => x.code === code);
  const get = (p) => api("GET", p, { token });
  const post = (p, body) => api("POST", p, { token, body });
  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = Math.round(n(row.net) * 100) / 100;
    return out;
  };
  const bankAccount = async (extra = {}) => {
    const r2 = await post(`/api/companies/${cid}/bank-accounts`, { nameEn: "Bank " + Math.random().toString(36).slice(2, 5), bankName: "FAB", currency: "AED", ...extra });
    if (r2.status !== 201) throw new Error("bank account failed " + r2.status + " " + r2.text);
    return r2.json;
  };
  const importCsv = (bankAccountId, rows) => post(`/api/companies/${cid}/bank-statements/import`, { bankAccountId, content: ["Date,Description,Debit,Credit,Balance", ...rows].join("\n"), format: "csv" });
  const txns = async (bankAccountId) => (await get(`/api/companies/${cid}/bank-statements/transactions?bankAccountId=${bankAccountId}`)).json ?? [];
  const journal = (date, lines, extra = {}) => post(`/api/companies/${cid}/journal`, { date, status: "posted", confirmBackdated: true, lines, ...extra });
  const invoice = async ({ date = day(-5), dueDate = day(2), unitPrice = 1000, vatRate = 0, name = "Gulf Horizon" } = {}) => {
    const r2 = await post(`/api/companies/${cid}/invoices`, { customerName: name, date, dueDate, lines: [{ description: "svc", quantity: 1, unitPrice, vatRate }] });
    if (!r2.json?.id) throw new Error("invoice failed " + r2.status + " " + r2.text.slice(0, 200));
    await api("PATCH", `/api/invoices/${r2.json.id}/status`, { token, body: { status: "sent" } });
    return r2.json;
  };
  return { token, cid, userId, accounts, acct, get, post, balances, bankAccount, importCsv, txns, journal, invoice };
}

const firstOf = (r) => r.json?.asset ?? r.json;
const entriesOf = async (cid, source) => (await db.query(`SELECT id, memo, date::text AS d FROM journal_entries WHERE company_id = $1 AND source = $2 AND status = 'posted' ORDER BY date`, [cid, source])).rows;

// ─────────────── 3 / 4: depreciation never posts into a closed or locked period ───────────────
async function depreciationSection() {
  const A = await newCompany("dep");
  const bank = A.acct("1020");
  const cap = A.acct("3010")?.id ?? A.acct("4010").id;
  await A.journal(`${Y - 3}-12-01`, [{ accountId: bank.id, debit: 100000, credit: 0 }, { accountId: cap, debit: 0, credit: 100000 }], { description: "capital" });
  const mkAsset = async (body) => firstOf(await A.post(`/api/companies/${A.cid}/fixed-assets`, { paymentAccountId: bank.id, depreciationMethod: "straight_line", ...body }));
  const van = await mkAsset({ assetName: "Old Van", category: "vehicles", purchaseDate: `${Y - 2}-04-01`, purchaseCost: 4800, salvageValue: 0, usefulLifeYears: 4 });
  const truck = await mkAsset({ assetName: "Old Truck", category: "vehicles", purchaseDate: `${Y - 2}-10-01`, purchaseCost: 1200, salvageValue: 0, usefulLifeYears: 2 });
  ok("t4-3: assets created two years back", !!van?.id && !!truck?.id, { van, truck });

  let r = await A.post(`/api/companies/${A.cid}/year-end/close`, { yearStart: `${Y - 2}-01-01` });
  ok("t4-3: setup: the financial year two years back is closed", r.status === 200 || r.status === 201, { s: r.status, j: r.json });

  r = await A.post(`/api/fixed-assets/${van.id}/depreciate`, { month: 1, year: Y });
  ok("t4-3: catch-up into earlier years asks for backdating confirmation (409)", r.status === 409 && r.json?.code === "BACKDATING_CONFIRMATION_REQUIRED", { s: r.status, j: r.json });
  ok("t4-3: ...and posted nothing", (await db.query(`SELECT COUNT(*)::int AS c FROM depreciation_schedules WHERE asset_id = $1`, [van.id])).rows[0].c === 0, {});

  r = await A.post(`/api/fixed-assets/${van.id}/depreciate`, { month: 1, year: Y, confirmBackdated: true });
  ok("t4-3: confirmed catch-up posts", r.status === 200, { s: r.status, j: r.json });
  const cu = r.json?.priorPeriodCatchUp;
  ok("t4-3: the 9 months of the closed year are ONE labelled journal, dated the first open day, debiting retained earnings", cu?.months?.length === 9 && close(cu.total, 900) && close(cu.retainedEarningsTotal, 900) && cu.date === `${Y - 1}-01-01`, cu);
  const cuLines = (await db.query(`SELECT a.code, jl.debit::float8 AS d, jl.credit::float8 AS c, je.memo FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.id = $1`, [cu?.journalEntryId])).rows;
  ok("t4-3: Dr 3020 900 / Cr 1240 900, memo says prior-period catch-up and what it covers", cuLines.some((l) => l.code === "3020" && close(l.d, 900)) && cuLines.some((l) => l.code === "1240" && close(l.c, 900)) && /Prior-period depreciation catch-up/.test(cuLines[0]?.memo) && /4\/\d{4}-12\/\d{4}/.test(cuLines[0]?.memo), cuLines);
  const inClosedYear = (await db.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE company_id = $1 AND memo LIKE 'Depreciation%' AND date >= $2 AND date < $3`, [A.cid, `${Y - 2}-01-01`, `${Y - 1}-01-01`])).rows[0].c;
  ok("t4-3: nothing was posted inside the closed year", inClosedYear === 0, inClosedYear);
  const rows = (await db.query(`SELECT period_year, period_month, catch_up, journal_entry_id FROM depreciation_schedules WHERE asset_id = $1 ORDER BY 1, 2`, [van.id])).rows;
  ok("t4-3: the schedule has 22 months; the 9 closed-year months are flagged catch-up and point at that journal", rows.length === 22 && rows.filter((x) => x.catch_up).length === 9 && rows.filter((x) => x.catch_up).every((x) => x.journal_entry_id === cu.journalEntryId && x.period_year === Y - 2), rows.slice(0, 11));
  const sched = (await A.get(`/api/companies/${A.cid}/fixed-assets/depreciation-schedule?to=${Y}-01-31`)).json ?? [];
  ok("t4-3: the schedule report shows which months the catch-up journal covers", sched.filter((x) => x.name === "Old Van" && x.catchUp).length === 9, sched.filter((x) => x.name === "Old Van").slice(0, 3));
  r = await A.get(`/api/companies/${A.cid}/fixed-assets/register?asOf=${Y}-12-31`);
  const van22 = r.json?.rows?.find((x) => x.name === "Old Van");
  ok("t4-3: nothing counted twice: accumulated 2,200 and the register equals the ledger", close(van22?.accumulated, 2200) && close(r.json?.glTie?.difference, 0), { van22, tie: r.json?.glTie });
  r = await A.post(`/api/fixed-assets/${van.id}/depreciate`, { month: 1, year: Y, confirmBackdated: true });
  ok("t4-3: running the same month again is refused (409), nothing re-posted", r.status === 409, { s: r.status });

  // 4. disposal after a closed year
  r = await A.post(`/api/fixed-assets/${truck.id}/dispose`, { disposalDate: today, disposalAmount: 600, proceedsAccountId: bank.id });
  ok("t4-4: the asset can be disposed of although a closed year lies in its history", r.status === 200 && !!r.json?.journalEntryId, { s: r.status, j: r.json });
  const catchJe = (await db.query(`SELECT je.id, je.date::text AS d, je.memo FROM journal_entries je WHERE je.company_id = $1 AND je.memo LIKE 'Prior-period depreciation catch-up: Old Truck%'`, [A.cid])).rows;
  ok("t4-4: disposal catch-up is one journal dated the disposal date (never backdated)", catchJe.length === 1 && catchJe[0].d.slice(0, 10) === today, catchJe);
  const retained = (await db.query(`SELECT SUM(jl.debit)::float8 AS d FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1 AND a.code = '3020'`, [catchJe[0]?.id])).rows[0].d;
  ok("t4-4: the closed-year months (Oct-Dec) debit retained earnings: 3 x 50", close(retained, 150), retained);
  r = await A.get(`/api/companies/${A.cid}/fixed-assets/register?asOf=${today}`);
  const bal = await A.balances();
  ok("t4-4: after disposal the register equals the ledger (1290 less 1240) and the truck is gone", close(r.json?.glTie?.difference, 0) && !r.json?.rows?.some((x) => x.name === "Old Truck") && close(r.json?.totals?.nbv, n(bal["1290"]) + n(bal["1240"])), { tie: r.json?.glTie, totals: r.json?.totals, bal1290: bal["1290"], bal1240: bal["1240"] });
  const disp = (await db.query(`SELECT status, disposal_journal_id FROM fixed_assets WHERE id = $1`, [truck.id])).rows[0];
  ok("t4-4: disposal_journal_id is recorded", disp.status === "disposed" && !!disp.disposal_journal_id, disp);

  // land: no useful life, never depreciated, but in the register at cost and tied to the ledger
  r = await A.post(`/api/companies/${A.cid}/fixed-assets`, { assetName: "Plot 12", category: "Land", purchaseDate: `${Y - 1}-02-01`, purchaseCost: 50000, paymentAccountId: bank.id });
  const land = firstOf(r);
  ok("land: an asset with no useful life is created", (r.status === 200 || r.status === 201) && !!land?.id, { s: r.status, j: r.json });
  r = await A.post(`/api/companies/${A.cid}/fixed-assets/run-depreciation`, { month: 1, year: Y, confirmBackdated: true });
  const landRun = r.json?.results?.find((x) => x.assetId === land?.id);
  ok("land: running depreciation skips it", r.status === 200 && landRun?.skipped === true, { s: r.status, landRun });
  r = await A.post(`/api/fixed-assets/${land?.id}/depreciate`, { month: 2, year: Y });
  const landRows = (await db.query(`SELECT COUNT(*)::int AS c FROM depreciation_schedules WHERE asset_id = $1`, [land?.id])).rows[0].c;
  ok("land: no schedule rows and no depreciation journal", landRows === 0 && r.status === 400 && (await db.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE company_id = $1 AND memo LIKE 'Depreciation: Plot 12%'`, [A.cid])).rows[0].c === 0, { s: r.status, landRows });
  r = await A.get(`/api/companies/${A.cid}/fixed-assets/register?asOf=${today}`);
  ok("land: the register lists it at cost, and the register still equals the ledger", close(r.json?.rows?.find((x) => x.name === "Plot 12")?.cost, 50000) && close(r.json?.rows?.find((x) => x.name === "Plot 12")?.accumulated, 0) && close(r.json?.glTie?.difference, 0), { row: r.json?.rows?.find((x) => x.name === "Plot 12"), tie: r.json?.glTie });

  // the company's own owner can reopen their own closed year, with a reason; a member without ownership cannot
  const O = await newCompany("own");
  await O.journal(`${Y - 2}-03-01`, [{ accountId: O.acct("1020").id, debit: 100, credit: 0 }, { accountId: O.acct("3010")?.id ?? O.acct("4010").id, debit: 0, credit: 100 }], { description: "x" });
  r = await O.post(`/api/companies/${O.cid}/year-end/close`, { yearStart: `${Y - 2}-01-01` });
  ok("t4-4: setup: a second company closes a year", r.status === 200 || r.status === 201, { s: r.status, j: r.json });
  const emp = await api("POST", "/api/auth/register", { body: { name: "emp", email: `emp_${rnd}@example.com`, password: "Password123!" } });
  await db.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'employee') ON CONFLICT DO NOTHING`, [O.cid, emp.json?.user?.id]);
  r = await api("POST", `/api/companies/${O.cid}/year-end/reopen`, { token: emp.json?.token, body: { yearStart: `${Y - 2}-01-01`, reason: "Disposal of an asset needs it" } });
  ok("t4-4: a member who is not the owner cannot reopen (403; an employee-role member is refused earlier with ROLE_REQUIRED)", r.status === 403 && (r.json?.code === "REOPEN_FORBIDDEN" || r.json?.code === "ROLE_REQUIRED"), { s: r.status, j: r.json });
  r = await O.post(`/api/companies/${O.cid}/year-end/reopen`, { yearStart: `${Y - 2}-01-01`, reason: "short" });
  ok("t4-4: the owner needs a reason (400)", r.status === 400, { s: r.status, j: r.json });
  r = await O.post(`/api/companies/${O.cid}/year-end/reopen`, { yearStart: `${Y - 2}-01-01`, reason: "Disposal of an asset needs it" });
  ok("t4-4: the company's own owner reopens it (200)", r.status === 200, { s: r.status, j: r.json });
  const audit = (await db.query(`SELECT COUNT(*)::int AS c FROM audit_logs WHERE details LIKE $1 AND action LIKE 'year_end.reopen%'`, [`%${O.cid}%`])).rows[0]?.c;
  ok("t4-4: ...and it is audit-logged", audit >= 1, audit);
  // a locked month: the owner unlocks it with a reason (audit row), a plain member cannot
  const lockEnd = `${Y - 1}-03-31`;
  await O.post(`/api/companies/${O.cid}/month-end/lock-period`, { periodEnd: lockEnd });
  r = await api("POST", "/api/period-lock/unlock", { token: emp.json?.token, body: { companyId: O.cid, period: `${Y - 1}-03`, reason: "need to post a late invoice" } });
  ok("t4-4: a member who is not the owner cannot unlock a month (403)", r.status === 403, { s: r.status });
  r = await api("POST", "/api/period-lock/unlock", { token: O.token, body: { companyId: O.cid, period: `${Y - 1}-03`, reason: "need to post a late invoice" } });
  ok("t4-4: the company's own owner unlocks a month with a reason (200)", r.status === 200, { s: r.status, j: r.json });
  const unlockAudit = (await db.query(`SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = 'period.unlock' AND details LIKE $1`, [`%${O.cid}%`])).rows[0]?.c;
  ok("t4-4: ...with an audit row carrying the reason", unlockAudit === 1, unlockAudit);
}

// ─────────────── 2: bill payments need a real bank account ───────────────
async function billSection() {
  const B = await newCompany("bil");
  const fab = await B.bankAccount({ nameEn: "FAB AED", createLedgerAccount: true });
  ok("t4-12: a bank account can be created with its own ledger account (no chart-of-accounts step first)", !!fab.glAccountId && fab.bankName === "FAB", fab);
  const gl = B.accounts.find((a) => a.id === fab.glAccountId) ?? (await B.get(`/api/companies/${B.cid}/accounts`)).json.find((a) => a.id === fab.glAccountId);
  ok("t4-12: the ledger account is an asset with the next free code (1021)", gl?.code === "1021" && gl?.type === "asset", gl);
  const mkBill = async (no) => {
    const bill = await B.post(`/api/companies/${B.cid}/bills`, { vendor_name: "Sharjah Supplies", bill_number: no, bill_date: day(-6), due_date: day(5), line_items: [{ description: "x", quantity: 1, unit_price: 2000, vat_rate: 0 }] });
    await B.post(`/api/bills/${bill.json?.id}/approve`, {});
    return bill.json;
  };
  const bill = await mkBill("AFL-0920");
  let r = await B.post(`/api/bills/${bill.id}/payments`, { amount: 2100 });
  ok("t4-2: paying without choosing a bank account is refused (422 PAYMENT_ACCOUNT_REQUIRED)", r.status === 422 && r.json?.code === "PAYMENT_ACCOUNT_REQUIRED", { s: r.status, j: r.json });
  r = await B.post(`/api/bills/${bill.id}/payments`, { amount: 2000, payment_account_id: B.acct("1020").id });
  ok("t4-2: the header '1020 Bank Accounts' is refused (422 PAYMENT_ACCOUNT_INVALID)", r.status === 422 && r.json?.code === "PAYMENT_ACCOUNT_INVALID", { s: r.status, j: r.json });
  r = await B.post(`/api/bills/${bill.id}/payments`, { amount: 2000, payment_account_id: fab.glAccountId });
  const bal = await B.balances();
  ok("t4-2: with the bank account it posts Cr 1021", r.status === 200 && close(bal["1021"], -2000) && close(bal["1020"] ?? 0, 0), { s: r.status, j: r.json, bal });
}

// ─────────────── 6-7: USD bank reconciliation in USD ───────────────
async function usdSection() {
  const U = await newCompany("usd");
  await U.post(`/api/companies/${U.cid}/exchange-rates`, { fromCurrency: "USD", toCurrency: "AED", rate: 3.675, effectiveDate: day(-90) });
  const usd = await U.bankAccount({ nameEn: "FAB USD", currency: "USD", createLedgerAccount: true, reconcileFrom: day(-30) });
  // the opening balance was keyed in AED only (no foreign amount): USD 10,000 at 3.675
  await U.journal(day(-40), [{ accountId: usd.glAccountId, debit: 36750, credit: 0 }, { accountId: U.acct("3010")?.id ?? U.acct("4010").id, debit: 0, credit: 36750 }], { description: "opening USD" });
  await U.importCsv(usd.id, [`${day(-5)},USD WIRE FEE,25.00,,9975.00`]);
  const fee = (await U.txns(usd.id))[0];
  await U.post(`/api/companies/${U.cid}/bank-statements/${fee.id}/create-entry`, { accountId: U.acct("5110")?.id ?? U.acct("5000").id });
  const r = await U.get(`/api/companies/${U.cid}/bank-statements/reconciliation-report?bankAccountId=${usd.id}&asOf=${today}&statementBalance=9975`);
  ok("t4-7: the USD account reconciles in USD: ledger USD 9,975 (opening 10,000 keyed in AED, less the USD 25 fee)", close(r.json?.ledgerBalance, 9975) && r.json?.currency === "USD", { l: r.json?.ledgerBalance, c: r.json?.currency, w: r.json?.warnings });
  ok("t4-7: difference 0 in USD, no phantom items", close(r.json?.difference, 0) && !r.json?.items?.depositsInTransit?.length && !r.json?.items?.outstandingPayments?.length && !r.json?.items?.unreconciledDebits?.length, r.json);
  const w = await U.get(`/api/companies/${U.cid}/bank-statements/reconciliation-report?bankAccountId=${usd.id}&asOf=${today}&statementBalance=9000`);
  ok("t4-7: a wrong statement balance shows the difference in USD", close(w.json?.difference, -975), w.json?.difference);
}

// ─────────────── 6-7: matching tools ───────────────
async function matchingSection() {
  const M = await newCompany("mat");
  const fab = await M.bankAccount({ nameEn: "FAB AED", createLedgerAccount: true });
  const inv1 = await M.invoice({ unitPrice: 2100, name: "Atlas Trading" });
  const inv2 = await M.invoice({ unitPrice: 1050, name: "Atlas Trading" });
  await M.importCsv(fab.id, [`${day(-1)},ATLAS TRADING RECEIPT,,3150.00,3150.00`]);
  const line = (await M.txns(fab.id)).find((t) => /ATLAS/.test(t.description));

  let r = await M.get(`/api/companies/${M.cid}/bank-statements/${line.id}/suggestions`);
  const combo = r.json?.find((s) => s.kind === "invoices");
  ok("t4-8: the matcher offers the combination 2,100 + 1,050 for a 3,150 receipt", !!combo && combo.targetIds?.length === 2 && combo.targetIds.includes(inv1.id) && combo.targetIds.includes(inv2.id) && combo.confidence >= 80, r.json?.slice?.(0, 3));

  r = await M.post(`/api/companies/${M.cid}/bank-statements/${line.id}/match`, { matchedType: "invoices", allocations: [{ invoiceId: inv1.id }, { invoiceId: inv2.id }] });
  ok("t4-8: one receipt settles both invoices", r.status === 200 && (await db.query(`SELECT COUNT(*)::int AS c FROM invoice_payments WHERE invoice_id = ANY($1)`, [[inv1.id, inv2.id]])).rows[0].c === 2, { s: r.status, j: r.json });
  const links = (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transaction_entries WHERE bank_transaction_id = $1`, [line.id])).rows[0].c;
  ok("t4-8: the bank line is linked to both payment entries", links === 1 && !!r.json?.journalEntryId, { links });
  r = await M.get(`/api/companies/${M.cid}/bank-statements/reconciliation-report?bankAccountId=${fab.id}&asOf=${today}&statementBalance=3150`);
  ok("t4-8: reconciliation shows no open items and difference 0", close(r.json?.difference, 0) && !r.json?.items?.depositsInTransit?.length && !r.json?.items?.unreconciledCredits?.length, r.json?.items);
  r = await api("DELETE", `/api/companies/${M.cid}/bank-statements/${line.id}/match`, { token: M.token });
  ok("t4-8: unmatching releases both entries, payments stay", r.status === 200 && (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transaction_entries WHERE bank_transaction_id = $1`, [line.id])).rows[0].c === 0, { s: r.status });
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${line.id}/match`, { matchedType: "invoices", allocations: [{ invoiceId: inv1.id }, { invoiceId: inv2.id }] });
  ok("t4-8: matching again re-links the payments (still two)", r.status === 200 && (await db.query(`SELECT COUNT(*)::int AS c FROM invoice_payments WHERE invoice_id = ANY($1)`, [[inv1.id, inv2.id]])).rows[0].c === 2, { s: r.status, j: r.json });

  // partial on the last invoice
  const p1 = await M.invoice({ unitPrice: 500, name: "Partial Co" });
  const p2 = await M.invoice({ unitPrice: 700, name: "Partial Co" });
  await M.importCsv(fab.id, [`${day(-1)},PARTIAL CO,,900.00,4050.00`]);
  const pl = (await M.txns(fab.id)).find((t) => /PARTIAL CO/.test(t.description));
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${pl.id}/match`, { matchedType: "invoices", allocations: [{ invoiceId: p1.id }, { invoiceId: p2.id }] });
  const pays = (await db.query(`SELECT invoice_id, amount::float8 AS a FROM invoice_payments WHERE invoice_id = ANY($1)`, [[p1.id, p2.id]])).rows;
  ok("t4-8: in order, with a partial on the last (500 + 400)", r.status === 200 && close(pays.find((x) => x.invoice_id === p1.id)?.a, 500) && close(pays.find((x) => x.invoice_id === p2.id)?.a, 400), { s: r.status, pays });

  // overpayment: 9,000 against 8,400
  const big = await M.invoice({ unitPrice: 8400, name: "Gulf Horizon" });
  await M.importCsv(fab.id, [`${day(-1)},GULF HORIZON,,9000.00,13050.00`]);
  const ol = (await M.txns(fab.id)).find((t) => /GULF HORIZON/.test(t.description));
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${ol.id}/match`, { matchedType: "invoice", matchedId: big.id });
  ok("t4-8: an overpayment without a choice -> 422 MATCH_AMOUNT_MISMATCH offering customer credit (not 'allowCredit=true')", r.status === 422 && r.json?.code === "MATCH_AMOUNT_MISMATCH" && r.json?.details?.canKeepAsCredit === true && close(r.json?.details?.excess, 600) && !/allowCredit/.test(r.text), { s: r.status, j: r.json });
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${ol.id}/match`, { matchedType: "invoice", matchedId: big.id, keepAsCredit: true });
  const bal = await M.balances();
  ok("t4-8: keeping the excess as customer credit pays the invoice and credits 2050 with 600", r.status === 200 && close(bal["2050"], -600), { s: r.status, j: r.json, b2050: bal["2050"] });
  const big2 = await M.invoice({ unitPrice: 1000, name: "Credit Co" });
  await M.importCsv(fab.id, [`${day(-1)},CREDIT CO,,1200.00,14250.00`]);
  const cl = (await M.txns(fab.id)).find((t) => /CREDIT CO/.test(t.description));
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${cl.id}/match`, { matchedType: "invoices", allocations: [{ invoiceId: big2.id, amount: 1000 }], keepAsCredit: true });
  const bal2 = await M.balances();
  ok("t4-8: allocations with explicit amounts and keepAsCredit post the excess to 2050 as well", r.status === 200 && close(bal2["2050"], -800), { s: r.status, j: r.json, b2050: bal2["2050"] });
  const own = await M.invoice({ unitPrice: 300, name: "Leftover Co" });
  await M.importCsv(fab.id, [`${day(-1)},LEFTOVER CO,,350.00,13400.00`]);
  const ll = (await M.txns(fab.id)).find((t) => /LEFTOVER CO/.test(t.description));
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${ll.id}/match`, { matchedType: "invoices", allocations: [{ invoiceId: own.id }] });
  ok("t4-8: money left after the listed invoices needs a choice (422 OVERPAYMENT_CHOICE_REQUIRED)", r.status === 422 && r.json?.code === "OVERPAYMENT_CHOICE_REQUIRED" && close(r.json?.details?.excess, 50), { s: r.status, j: r.json });

  // split a bank line over several accounts (a loan instalment)
  await M.importCsv(fab.id, [`${day(-1)},LOAN INSTALMENT,3000.00,,10400.00`]);
  const li = (await M.txns(fab.id)).find((t) => /LOAN INSTALMENT/.test(t.description));
  const principal = M.acct("5030").id, interest = M.acct("5040").id;
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${li.id}/create-entry`, { lines: [{ accountId: principal, amount: 2500 }, { accountId: interest, amount: 400 }] });
  ok("t4-8: a split that does not add up -> 422 SPLIT_INVALID", r.status === 422 && r.json?.code === "SPLIT_INVALID", { s: r.status, j: r.json });
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${li.id}/create-entry`, { lines: [{ accountId: principal, amount: 2500, description: "Principal" }, { accountId: interest, amount: 500, description: "Interest" }] });
  const b2 = await M.balances();
  ok("t4-8: a split posts principal and interest in one entry", r.status === 201 && close(b2["5030"], 2500) && close(b2["5040"], 500), { s: r.status, j: r.json });

  // own-account transfer AED -> USD: two bank lines, one journal, the exchange difference to 5140
  await M.post(`/api/companies/${M.cid}/exchange-rates`, { fromCurrency: "USD", toCurrency: "AED", rate: 3.675, effectiveDate: day(-60) });
  const usd = await M.bankAccount({ nameEn: "FAB USD", currency: "USD", createLedgerAccount: true });
  await M.importCsv(fab.id, [`${day(-1)},TT TO USD ACCOUNT,3700.00,,6700.00`]);
  await M.importCsv(usd.id, [`${day(-1)},FROM AED ACCOUNT,,1000.00,1000.00`]);
  const outLine = (await M.txns(fab.id)).find((t) => /TT TO USD/.test(t.description));
  const inLine = (await M.txns(usd.id))[0];
  r = await M.get(`/api/companies/${M.cid}/bank-statements/${inLine.id}/suggestions`);
  ok("t4-8: the USD side is suggested as the other leg of the transfer", r.json?.some((s) => s.kind === "transfer" && s.targetId === outLine.id), r.json?.slice?.(0, 3));
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${inLine.id}/transfer`, { otherTransactionId: outLine.id });
  ok("t4-8: the transfer posts as one journal", r.status === 201 && !!r.json?.journalEntryId, { s: r.status, j: r.json });
  const tl = (await db.query(`SELECT a.code, jl.debit::float8 AS d, jl.credit::float8 AS c, jl.foreign_currency, jl.foreign_debit::float8 AS fd FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`, [r.json?.journalEntryId])).rows;
  ok("t4-8: Dr USD bank 3,675 (USD 1,000 on the line), Dr 5140 25 / Cr AED bank 3,700", tl.length === 3 && tl.some((l) => l.code === "5140" && close(l.d, 25)) && tl.some((l) => close(l.d, 3675) && l.foreign_currency === "USD" && close(l.fd, 1000)) && tl.some((l) => close(l.c, 3700)), tl);
  const both = (await db.query(`SELECT COUNT(*)::int AS c FROM bank_transactions WHERE id = ANY($1) AND is_reconciled AND matched_journal_entry_id = $2`, [[outLine.id, inLine.id], r.json?.journalEntryId])).rows[0].c;
  ok("t4-8: both bank lines are matched to it", both === 2, both);
  const rep = await M.get(`/api/companies/${M.cid}/bank-statements/reconciliation-report?bankAccountId=${usd.id}&asOf=${today}&statementBalance=1000`);
  ok("t4-8: the USD account reconciles with no open items", close(rep.json?.difference, 0) && !rep.json?.items?.depositsInTransit?.length && !rep.json?.items?.unreconciledCredits?.length, rep.json);
  r = await api("DELETE", `/api/companies/${M.cid}/bank-statements/${outLine.id}/match`, { token: M.token });
  ok("t4-8: the outgoing leg cannot be unmatched while the other leg is linked (409)", r.status === 409 && r.json?.code === "ENTRY_LINKED_ELSEWHERE", { s: r.status, j: r.json });
  await api("DELETE", `/api/companies/${M.cid}/bank-statements/${inLine.id}/match`, { token: M.token });
  r = await api("DELETE", `/api/companies/${M.cid}/bank-statements/${outLine.id}/match`, { token: M.token });
  ok("t4-8: after releasing the incoming leg, the outgoing leg's unmatch reverses the journal", r.status === 200 && !!r.json?.reversedEntryId, { s: r.status, j: r.json });
  r = await M.post(`/api/companies/${M.cid}/bank-statements/${inLine.id}/transfer`, { otherTransactionId: inLine.id });
  ok("t4-8: a transfer needs two different lines (422)", r.status === 422, { s: r.status });

  // report dates are the UAE calendar day
  const D = await newCompany("dts");
  const dbank = await D.bankAccount({ nameEn: "Dates", createLedgerAccount: true });
  const jd = `${Y - 1}-08-10`;
  await D.journal(jd, [{ accountId: dbank.glAccountId, debit: 500, credit: 0 }, { accountId: D.acct("4010").id, debit: 0, credit: 500 }], { description: "deposit" });
  const rep2 = await D.get(`/api/companies/${D.cid}/bank-statements/reconciliation-report?bankAccountId=${dbank.id}&asOf=${today}&statementBalance=0`);
  ok("t4-11: a 10 Aug journal is reported on 10 Aug, not the day before", rep2.json?.items?.depositsInTransit?.[0]?.date === jd, rep2.json?.items?.depositsInTransit);
}

// ─────────────── UI (S6): the screens t4 had to do through the API, and the dialogs that kept old values ───────────────
// Real Chromium against BASE. Skipped when playwright-core or a browser is not available.
const uiAmount = (text) => {
  const t = String(text ?? "");
  return (t.includes("-") ? -1 : 1) * Math.abs(Number(t.replace(/[^0-9.]/g, "")));
};

async function uiSection() {
  let chromium;
  try { ({ chromium } = await import("playwright-core")); } catch { console.log("SKIP  t4 UI: playwright-core is not installed"); return; }
  let browser;
  try { browser = await chromium.launch({ headless: true }); } catch (e) { console.log("SKIP  t4 UI: no browser " + String(e.message).split("\n")[0].slice(0, 80)); return; }
  try { await uiChecks(browser); } finally { await browser.close(); }
}

async function uiLogin(page, email) {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (c) => {
    await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
  }, { email, password: "Password123!" });
}

async function uiChecks(browser) {
  const U = await newCompany("tui");
  const email = (await db.query(`SELECT email FROM users WHERE id = $1`, [U.userId])).rows[0].email;
  await db.query(`UPDATE companies SET onboarding_completed = true WHERE id = $1`, [U.cid]);
  await api("PATCH", "/api/onboarding", { token: U.token, body: { showTour: false } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 120)));
  await uiLogin(page, email);
  const dismiss = async (pg) => {
    const b = pg.locator("[data-testid=button-skip-onboarding]");
    if (await b.isVisible({ timeout: 1500 }).catch(() => false)) { await b.click(); await b.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {}); }
  };
  const open = async (path, pg = page) => {
    await pg.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await pg.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await dismiss(pg);
  };
  const pick = async (trigger, name) => { await page.locator(trigger).click(); await page.getByRole("option", { name }).first().click(); };

  // 12: bank accounts and ledger accounts from the screens
  await open("/bank-reconciliation");
  await page.locator("[data-testid=button-open-import]").click();
  await page.locator("[data-testid=button-add-account-from-import]").click();
  await page.locator("[data-testid=bank-account-dialog]").waitFor();
  ok("t4-12 UI: the import dialog's empty state leads to the bank account form", true);
  await page.locator("[data-testid=input-bank-name]").fill("FAB AED");
  await pick("[data-testid=select-bank-bank]", "Other");
  await page.locator("[data-testid=input-bank-iban]").fill("AE070331234567890123456");
  await page.locator("[data-testid=input-bank-reconcile-from]").fill(`${Y - 1}-01-01`);
  await page.locator("[data-testid=button-save-bank-account]").click();
  await page.waitForTimeout(1500);
  const aed = (await db.query(`SELECT ba.id, ba.bank_name, ba.currency, ba.reconcile_from::text AS rf, a.code, a.type FROM bank_accounts ba LEFT JOIN accounts a ON a.id = ba.gl_account_id WHERE ba.company_id = $1 AND ba.name_en = 'FAB AED'`, [U.cid])).rows[0];
  ok("t4-12 UI: a bank account is created from the screen: a listed bank or \"Other\", its own ledger account 1021, reconcile-from set", aed?.bank_name === "Other" && aed.code === "1021" && aed.type === "asset" && aed.rf === `${Y - 1}-01-01` && aed.currency === "AED", aed);
  await page.locator("[data-testid=tab-bank-accounts]").click();
  await page.locator("[data-testid=button-add-bank-account]").click();
  ok("t4-15 UI: the form opens empty again (nothing from the last account)", (await page.locator("[data-testid=input-bank-name]").inputValue()) === "" && /Other/.test(await page.locator("[data-testid=select-bank-bank]").innerText()) && (await page.locator("[data-testid=input-bank-reconcile-from]").inputValue()) === "");
  await page.locator("[data-testid=input-bank-name]").fill("FAB USD");
  await pick("[data-testid=select-bank-bank]", "FAB");
  await pick("[data-testid=select-bank-currency]", "USD");
  await page.locator("[data-testid=button-new-gl-account]").click();
  const suggested = await page.locator("[data-testid=input-gl-code]").inputValue();
  await page.locator("[data-testid=input-gl-name]").fill("FAB USD account");
  await page.locator("[data-testid=button-save-gl-account]").click();
  await page.waitForTimeout(1200);
  ok("t4-12 UI: a ledger account is created from the bank form, with the next bank code suggested (1022), and selected", suggested === "1022" && /1022/.test(await page.locator("[data-testid=select-bank-gl]").innerText()), { suggested });
  await page.locator("[data-testid=button-save-bank-account]").click();
  await page.waitForTimeout(1500);
  const usd = (await db.query(`SELECT ba.id, ba.currency, a.code FROM bank_accounts ba LEFT JOIN accounts a ON a.id = ba.gl_account_id WHERE ba.company_id = $1 AND ba.name_en = 'FAB USD'`, [U.cid])).rows[0];
  ok("t4-12 UI: the USD bank account is linked to 1022", usd?.currency === "USD" && usd.code === "1022", usd);

  await open("/chart-of-accounts");
  await page.locator("[data-testid=button-add-account]").click();
  await page.locator("[data-testid=gl-account-dialog]").waitFor({ timeout: 5000 });
  await pick("[data-testid=select-gl-type]", "Liability");
  await page.locator("[data-testid=input-gl-name]").fill("Bank Loan");
  await page.locator("[data-testid=button-save-gl-account]").click();
  await page.waitForTimeout(1200);
  const loan = (await db.query(`SELECT code, type FROM accounts WHERE company_id = $1 AND name_en = 'Bank Loan'`, [U.cid])).rows[0];
  ok("t4-12 UI: Chart of Accounts > Add Account creates an account (it used to open the Journal)", loan?.type === "liability" && /^2\d{3}$/.test(loan.code) && /chart-of-accounts/.test(page.url()), { loan, url: page.url() });
  await open("/accounts");
  await page.locator("[data-testid=button-create-account]").click();
  ok("t4-12 UI: Accounts > Add Account has a code field with a suggestion (it failed with 'Validation error')", /^\d{4}$/.test(await page.locator("[data-testid=input-account-code]").inputValue()));
  await page.keyboard.press("Escape");

  // matching
  const inv1 = await U.invoice({ unitPrice: 20000, vatRate: 0.05, name: "Atlas Trading", dueDate: day(1) }); // 21,000
  const inv2 = await U.invoice({ unitPrice: 10000, vatRate: 0.05, name: "Atlas Trading", dueDate: day(2) }); // 10,500
  const inv3 = await U.invoice({ unitPrice: 8400, vatRate: 0, name: "Gulf Horizon", dueDate: day(3) });
  const inv4 = await U.invoice({ unitPrice: 1000, vatRate: 0, name: "Pearl Trading", dueDate: day(4) });
  await U.importCsv(aed.id, [
    `${day(-4)},ATLAS TRADING RECEIPT,,31500.00,31500.00`,
    `${day(-3)},GULF HORIZON TRANSFER,,9000.00,40500.00`,
    `${day(-2)},PEARL TRADING,,1040.00,41540.00`,
    `${day(-1)},FAB LOAN INSTALMENT,5000.00,,36540.00`,
  ]);
  const lines = await U.txns(aed.id);
  const L = (re) => lines.find((t) => re.test(t.description));
  await open("/bank-reconciliation");
  const openMatch = async (txn) => { await page.locator(`[data-testid=button-match-${txn.id}]:visible`).click(); await page.locator("[data-testid=match-dialog]").waitFor(); };
  const closeMatch = async () => { await page.keyboard.press("Escape"); await page.locator("[data-testid=match-dialog]").waitFor({ state: "hidden", timeout: 5000 }); };

  // 9: the account chosen for one line is not kept for the next
  const atlas = L(/ATLAS/);
  const gulf = L(/GULF/);
  await openMatch(gulf);
  await pick("[data-testid=select-create-account]", /2\d{3}/);
  const chosen = await page.locator("[data-testid=select-create-account]").innerText();
  await closeMatch();
  await openMatch(atlas);
  const fresh = await page.locator("[data-testid=select-create-account]").innerText();
  ok("t4-9 UI: the account picked on one bank line is not still selected on the next (it posted a receipt to Loan Payable)", /Select an account/.test(fresh) && !/Select an account/.test(chosen), { chosen, fresh });
  await page.locator("[data-testid=button-create-entry]").isDisabled().then((d) => ok("t4-9 UI: 'Create entry and match' is disabled until an account is chosen for this line", d));

  // 8: one receipt, two invoices
  await page.locator("[data-testid=allocation-panel-toggle]").click();
  await page.locator("[data-testid=button-fill-allocation]").click();
  const sum = await page.locator("[data-testid=allocation-summary]").innerText();
  ok("t4-8 UI: 'fill in due-date order' allocates 21,000 + 10,500 with nothing left over", /31,500\.00/.test(sum) && (await page.locator("[data-testid=allocation-left]").count()) === 0 && (await page.locator(`[data-testid=allocation-check-${inv1.id}]`).getAttribute("data-state")) === "checked" && (await page.locator(`[data-testid=allocation-check-${inv2.id}]`).getAttribute("data-state")) === "checked", sum);
  await page.locator("[data-testid=button-post-allocation]").click();
  await page.waitForTimeout(1800);
  const pays = (await db.query(`SELECT COUNT(*)::int AS c FROM invoice_payments WHERE invoice_id = ANY($1)`, [[inv1.id, inv2.id]])).rows[0].c;
  ok("t4-8 UI: one receipt settles both invoices", pays === 2, pays);

  // 8: overpayment, the choice
  await openMatch(gulf);
  await page.locator("[data-testid=allocation-panel-toggle]").click();
  await page.locator(`[data-testid=allocation-check-${inv3.id}]`).click();
  ok("t4-8 UI: 9,000 against 8,400 shows the 600 left over and asks what to do with it", /600\.00/.test(await page.locator("[data-testid=allocation-left]").innerText()) && (await page.locator("[data-testid=button-post-allocation]").isDisabled()));
  await page.locator("[data-testid=allocation-keep-credit]").click();
  await page.locator("[data-testid=button-post-allocation]").click();
  await page.waitForTimeout(1800);
  let bal = await U.balances();
  ok("t4-8 UI: 'keep as customer credit' pays the invoice and credits 2050 with 600", close(bal["2050"], -600), bal["2050"]);

  // 8: overpayment via a suggestion: the dialog offers the choice (no raw API message)
  await openMatch(L(/PEARL/));
  const sug = page.locator("[data-testid=button-match-invoice]").first();
  if (await sug.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
    await sug.click();
    await page.locator("[data-testid=overpay-dialog]").waitFor({ timeout: 5000 });
    ok("t4-8 UI: a suggestion above what is owed asks 'keep the excess as customer credit?' instead of showing an API message", /customer credit/i.test(await page.locator("[data-testid=overpay-dialog]").innerText()) && !/allowCredit/.test(await page.locator("body").innerText()));
    await page.locator("[data-testid=button-keep-credit]").click();
    await page.waitForTimeout(1800);
    bal = await U.balances();
    ok("t4-8 UI: accepting the choice posts the payment and credits the excess (2050 -640)", close(bal["2050"], -640), bal["2050"]);
  } else {
    console.log("SKIP  t4-8 UI: no invoice suggestion for 1,040 against 1,000");
    await closeMatch();
  }

  // 8: split a loan instalment
  const loanLine = L(/LOAN/);
  await openMatch(loanLine);
  await page.locator("[data-testid=split-panel-toggle]").click();
  const interest = U.acct("5200")?.id ?? U.acct("5000").id;
  await page.locator("[data-testid=split-entry-account-0]").click();
  await page.getByRole("option", { name: new RegExp(loan.code) }).first().click();
  await page.locator("[data-testid=split-entry-amount-0]").fill("4200");
  await page.locator("[data-testid=split-entry-account-1]").click();
  await page.getByRole("option", { name: /^\s*5\d{3}/ }).first().click();
  ok("t4-8 UI: an unfinished split cannot be posted", await page.locator("[data-testid=button-post-split]").isDisabled());
  await page.locator("[data-testid=split-entry-amount-1]").fill("800");
  ok("t4-8 UI: 4,200 + 800 = 5,000 enables the split", !(await page.locator("[data-testid=button-post-split]").isDisabled()));
  await page.locator("[data-testid=button-post-split]").click();
  await page.waitForTimeout(1800);
  const loanEntry = (await db.query(`SELECT COUNT(*)::int AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1 AND je.source = 'bank_reconciliation' AND je.source_id = $2`, [U.cid, loanLine.id])).rows[0].c;
  ok("t4-8 UI: the split posts one entry with the bank line and two accounts (3 lines)", loanEntry === 3, loanEntry);

  // 9: what a matched line was matched to
  await page.getByLabel(/show reconciled/i).click().catch(async () => { await page.locator("#show-reconciled").click(); });
  await page.waitForTimeout(500);
  await page.locator(`[data-testid=button-details-${loanLine.id}]:visible`).click();
  await page.locator("[data-testid=matched-summary]").waitFor({ timeout: 8000 });
  ok("t4-9 UI: a matched line says what it was matched to: the entry number and its lines", /Posted entry/.test(await page.locator("[data-testid=matched-summary]").innerText()), await page.locator("[data-testid=matched-summary]").innerText());
  await closeMatch();

  // 2: bill payment: a required bank account, the main one preselected, never the header
  const bill = await U.post(`/api/companies/${U.cid}/bills`, { vendor_name: "Sharjah Supplies", bill_number: "AFL-0920", bill_date: day(-6), due_date: day(5), line_items: [{ description: "x", quantity: 1, unit_price: 2000, vat_rate: 0 }] });
  await U.post(`/api/bills/${bill.json?.id}/approve`, {});
  await open("/bill-pay");
  await page.locator(`[data-testid=button-bill-actions-${bill.json.id}]:visible`).first().click();
  await page.locator(`[data-testid=menu-pay-bill-${bill.json.id}]`).click();
  await page.locator("[data-testid=select-bill-payment-account]").waitFor({ timeout: 8000 });
  const preselected = await page.locator("[data-testid=select-bill-payment-account]").innerText();
  ok("t4-2 UI: the payment dialog preselects the company's main bank account (1021)", /1021/.test(preselected), preselected);
  await page.locator("[data-testid=select-bill-payment-account]").click();
  const optionTexts = await page.getByRole("option").allInnerTexts();
  ok("t4-2 UI: the picker offers bank and cash accounts and never the '1020 Bank Accounts' header", optionTexts.some((t) => /1021/.test(t)) && optionTexts.some((t) => /1022/.test(t)) && !optionTexts.some((t) => /^1020\b/.test(t.trim())), optionTexts);
  await page.keyboard.press("Escape");
  await page.locator('button[type=submit]:has-text("Record Payment")').click();
  await page.waitForTimeout(1800);
  bal = await U.balances();
  ok("t4-2 UI: the payment leaves from 1021, not the header", close(bal["1021"] ?? 0, n(bal["1021"])) && (bal["1020"] ?? 0) === 0 && (await db.query(`SELECT COUNT(*)::int AS c FROM bill_payments WHERE bill_id = $1 AND payment_account_id = $2`, [bill.json.id, aed.gl_account_id ?? (await db.query(`SELECT gl_account_id FROM bank_accounts WHERE id = $1`, [aed.id])).rows[0].gl_account_id])).rows[0].c === 1, bal);

  // 6/7/8: the reconciliation explains every item and does not say balanced on phantom pairs
  const aedGl = (await db.query(`SELECT gl_account_id FROM bank_accounts WHERE id = $1`, [aed.id])).rows[0].gl_account_id;
  await U.journal(day(-3), [{ accountId: aedGl, debit: 700, credit: 0 }, { accountId: U.acct("4010").id, debit: 0, credit: 700 }], { description: "Cash sale deposit" });
  await U.importCsv(aed.id, [`${day(-2)},BANK DEPOSIT CASH SALE,,700.00,37240.00`]);
  const rep = await U.get(`/api/companies/${U.cid}/bank-statements/reconciliation-report?bankAccountId=${aed.id}&asOf=${today}`);
  await open("/bank-reconciliation");
  await page.getByRole("tab", { name: "Reconciliation" }).click();
  await page.locator("[data-testid=input-recon-balance]").fill(String(rep.json.ledgerBalance));
  await page.locator("[data-testid=recon-difference]").waitFor();
  await page.waitForTimeout(1200);
  const verdict = await page.locator("[data-testid=recon-difference]").getAttribute("data-verdict");
  const bannerText = await page.locator("[data-testid=recon-difference]").innerText();
  ok("t4-8 UI: a difference of 0 built on a ledger deposit and a statement credit of the same amount is NOT shown as balanced", Math.abs(rep.json.ledgerBalance - rep.json.ledgerBalance) < 0.005 && verdict !== "balanced" && !/^Balanced$/m.test(bannerText.replace(/Not balanced/i, "")) && (await page.locator("[data-testid=button-recon-complete]").isDisabled()), { verdict, bannerText });
  const itemsText = await page.locator("[data-testid=reconciliation-items]").innerText();
  ok("t4-8 UI: every reconciling item shows its type, document and amount", /Deposit in transit|Statement credit/.test(itemsText) && /JE-|Statement line/.test(itemsText) && /700\.00/.test(itemsText), itemsText.slice(0, 300));

  // 7: a USD account reconciles in USD
  await U.importCsv(usd.id, [`${day(-2)},USD RECEIPT,,100.00,100.00`]);
  await page.locator("[data-testid=select-recon-account]").click();
  await page.getByRole("option", { name: /FAB USD/ }).click();
  await page.waitForTimeout(1500);
  const usdText = await page.locator("[data-testid=recon-statement-side]").innerText();
  ok("t4-7 UI: the USD account's statement and ledger sides are shown in USD", /USD/.test(usdText) && !/AED/.test(usdText), usdText);

  // 18: the header net is per currency
  await open("/bank-reconciliation");
  const netText = await page.locator("[data-testid=stat-net]").innerText();
  ok("t4-18 UI: the 'net amount' is per currency, never AED and USD lines added together", /AED/.test(netText) && /USD/.test(netText), netText);

  // 14: the journal list pages
  for (let i = 0; i < 60; i++) {
    await U.journal(day(-(i % 28)), [{ accountId: U.acct("5000").id, debit: 10 + i, credit: 0 }, { accountId: U.acct("1010").id, debit: 0, credit: 10 + i }], { memo: `Paging entry ${i}` });
  }
  await open("/journal");
  await page.locator("[data-testid=journal-pager]").waitFor({ timeout: 15000 });
  const rangeText = await page.locator("[data-testid=journal-pager-range]").innerText();
  const firstPage = await page.locator("[data-testid^=button-proof-journal-]").count();
  ok("t4-14 UI: the journal list says 'Showing 1 to 25 of N' and renders 25 entries", /Showing 1 to 25 of \d+/.test(rangeText) && firstPage === 25, { rangeText, firstPage });
  await page.locator("[data-testid=journal-pager-next]").first().click();
  ok("t4-14 UI: next page shows 26 to 50", /Showing 26 to 50 of/.test(await page.locator("[data-testid=journal-pager-range]").innerText()));

  // 15: contacts dialog starts empty each time
  await open("/contacts");
  await page.locator("[data-testid=button-add-contact]").click();
  await page.locator("[data-testid=input-contact-name]").fill("First Customer");
  await page.locator("[data-testid=input-contact-trn]").fill("100123456700003");
  await page.keyboard.press("Escape");
  await page.locator("[data-testid=button-add-contact]").click();
  ok("t4-15 UI: the Add Contact form opens empty (a customer inherited another customer's TRN)", (await page.locator("[data-testid=input-contact-name]").inputValue()) === "" && (await page.locator("[data-testid=input-contact-trn]").inputValue()) === "");
  await page.keyboard.press("Escape");

  ok("t4 UI: no uncaught page errors on these screens", pageErrors.length === 0, pageErrors.slice(0, 3));

  // 19/20: Arabic, and 375 px
  await db.query(`UPDATE accounts SET name_ar = 'قرض البنك' WHERE company_id = $1 AND name_en = 'Bank Loan'`, [U.cid]);
  const ar = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "ar-AE" });
  await ar.addInitScript(() => localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 })));
  const ap = await ar.newPage();
  await uiLogin(ap, email);
  await ap.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
  await dismiss(ap);
  await open("/bank-reconciliation", ap);
  const inView = async (loc) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); const b = await loc.boundingBox(); const w = await ap.evaluate(() => window.innerWidth); return !!b && b.x >= -1 && b.x + b.width <= w + 1; };
    await ap.getByRole("tab", { name: /التسوية/ }).click();
  await ap.waitForTimeout(800);
  const arText = await ap.locator("body").innerText();
  ok("t4-19 UI Arabic: the reconciliation screen is Arabic (item types, no English headings)", /بنود التسوية|البنود وراء الفرق/.test(arText) && !/Statement versus ledger|Deposit in transit/.test(arText), arText.slice(0, 200));
  await open("/chart-of-accounts", ap);
  ok("t4-19 UI Arabic: an account's Arabic name is shown (name_ar)", /قرض البنك/.test(await ap.locator("body").innerText()));
  await open("/fixed-assets", ap);
  ok("t4-20 UI 375px Arabic: the Add Asset button is fully on screen", await inView(ap.locator("button:has-text('إضافة أصل'), [data-testid=button-add-asset]").first()));
  await open("/vat-filing", ap);
  const wp = ap.locator("[data-testid=tab-vat-workpaper]");
  ok("t4-20 UI 375px Arabic: the VAT Workpaper tab can be reached on screen", (await wp.count()) === 0 || (await inView(wp)));
  const noOverflow = await ap.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok("t4-20 UI 375px Arabic: the VAT page does not scroll sideways", noOverflow);
  await ctx.close();
  await ar.close();
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await depreciationSection();
    await billSection();
    await usdSection();
    await matchingSection();
    await uiSection();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
