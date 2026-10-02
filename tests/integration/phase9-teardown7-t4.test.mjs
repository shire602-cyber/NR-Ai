// Integration tests for the Teardown 7 fixes (banking, FX, fixed assets):
//   F1  a foreign-currency receipt books at the receipt-date rate (editable), the difference is realised FX, the USD ledger equals the statement
//   F2  bank-balance FX revaluation per foreign account (idempotent per date, auto-reversed), neutral in the reconciliation
//   F3  fixed assets recorded by a bill / journal line; the register ties to 1290/1240
//   F4  disposal stops depreciation at the disposal date (pro rata by days in the disposal month)
//   F5  disposal with a buyer and VAT (standard 5% / zero-rated / out of scope), a tax invoice that reaches box 1 by emirate
//   F7  an asset in a closed year registers without posting into it (never silent)
//   bank accounts always have a ledger account; a credit card is a liability bank account
//   BASE_URL=http://localhost:5075 DATABASE_URL=... node tests/integration/phase9-teardown7-t4.test.mjs

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
// the last day of the previous month, and days before it: every date below is in the past and in one open period
const pmEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0));
const pm = ymd(pmEnd);
const pmd = (k) => ymd(new Date(pmEnd.getTime() - k * 86400000));
const pmNext = ymd(new Date(pmEnd.getTime() + 86400000));
let db;

async function newCompany(label, { emirate = "dubai", trn = true } = {}) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: trn ? { trnVatNumber: "100123456700003", vatRegistered: true, emirate } : { emirate } });
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
  const invoice = async ({ date = day(-5), dueDate = day(2), unitPrice = 1000, vatRate = 0, name = "Gulf Horizon", currency, exchangeRate, extra = {} } = {}) => {
    const r2 = await post(`/api/companies/${cid}/invoices`, { customerName: name, date, dueDate, ...(currency ? { currency } : {}), ...(exchangeRate ? { exchangeRate } : {}), ...extra, lines: [{ description: "svc", quantity: 1, unitPrice, vatRate }] });
    if (!r2.json?.id) throw new Error("invoice failed " + r2.status + " " + r2.text.slice(0, 200));
    await api("PATCH", `/api/invoices/${r2.json.id}/status`, { token, body: { status: "sent" } });
    return r2.json;
  };
  return { token, cid, userId, accounts, acct, get, post, balances, bankAccount, importCsv, txns, journal, invoice };
}

const firstOf = (r) => r.json?.asset ?? r.json;
const lineByDesc = async (A, re) => (await A.txns(A._bank)).find((t) => re.test(t.description));
const jeLines = async (entryId) => (await db.query(
  `SELECT a.code, jl.debit::float8 AS d, jl.credit::float8 AS c, jl.foreign_currency AS fc, jl.foreign_debit::float8 AS fd, jl.foreign_credit::float8 AS fcr, jl.exchange_rate::float8 AS rate
     FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1 ORDER BY jl.debit DESC, a.code`, [entryId])).rows;
const recon = (A, bankId, asOf, bal) => A.get(`/api/companies/${A.cid}/bank-statements/reconciliation-report?bankAccountId=${bankId}&asOf=${asOf}${bal !== undefined ? `&statementBalance=${bal}` : ""}`);

// ─────────────── F1 + F2: foreign-currency receipts and bank revaluation ───────────────
async function fxSection() {
  const A = await newCompany("fx");
  await A.post(`/api/companies/${A.cid}/exchange-rates`, { fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: pmd(60) });
  await A.post(`/api/companies/${A.cid}/exchange-rates`, { fromCurrency: "USD", toCurrency: "AED", rate: 3.6735, effectiveDate: pmd(12) });
  const usd = await A.bankAccount({ nameEn: "FAB USD", currency: "USD", createLedgerAccount: true });
  A._bank = usd.id;
  const inv1 = await A.invoice({ date: pmd(40), dueDate: pmd(-10), unitPrice: 5000, currency: "USD", exchangeRate: 3.6725 });
  ok("f1: setup: a USD invoice at 3.6725", inv1.currency === "USD" && close(inv1.exchangeRate, 3.6725), { c: inv1.currency, r: inv1.exchangeRate });
  await A.importCsv(usd.id, [`${pmd(10)},WIRE FROM GULF HORIZON,,5000.00,5000.00`]);
  const line1 = (await A.txns(usd.id))[0];

  let r = await A.post(`/api/companies/${A.cid}/bank-statements/${line1.id}/match`, { matchedType: "invoice", matchedId: inv1.id });
  ok("f1: matching the USD line to the USD invoice succeeds", r.status === 200 && !!r.json?.journalEntryId, { s: r.status, j: r.json });
  let jl = await jeLines(r.json?.journalEntryId);
  const bankLine = jl.find((l) => l.code === usd.glAccountCode || n(l.fd) > 0);
  ok("f1: the bank is debited AED 18,367.50 (USD 5,000 at the receipt-date rate 3.6735), A/R credited 18,362.50 (invoice rate), 4090 credited 5.00",
    jl.some((l) => close(l.d, 18367.5)) && jl.some((l) => l.code === "1040" && close(l.c, 18362.5)) && jl.some((l) => l.code === "4090" && close(l.c, 5)), jl);
  ok("f1: the bank line carries USD 5,000 at 3.6735, so the USD ledger is exactly the statement", bankLine?.fc === "USD" && close(bankLine?.fd, 5000) && close(bankLine?.rate, 3.6735), jl);
  let rep = await recon(A, usd.id, pm, 5000);
  ok("f1: the USD reconciliation balances: ledger USD 5,000, difference 0, nothing behind it", close(rep.json?.ledgerBalance, 5000) && close(rep.json?.difference, 0) && !rep.json?.items?.depositsInTransit?.length && !rep.json?.items?.unreconciledCredits?.length, rep.json);

  // an editable rate: the receipt-date rate is only the default
  const inv2 = await A.invoice({ date: pmd(40), dueDate: pmd(-10), unitPrice: 1000, currency: "USD", exchangeRate: 3.6725 });
  await A.importCsv(usd.id, [`${pmd(9)},WIRE 2,,1000.00,6000.00`]);
  const line2 = (await A.txns(usd.id)).find((t) => /WIRE 2/.test(t.description));
  r = await A.post(`/api/companies/${A.cid}/bank-statements/${line2.id}/match`, { matchedType: "invoice", matchedId: inv2.id, exchangeRate: 3.67 });
  jl = r.json?.journalEntryId ? await jeLines(r.json.journalEntryId) : [];
  ok("f1: an edited receipt rate 3.67 books the bank at 3,670.00 and a realised LOSS of 2.50 to 5140", r.status === 200 && jl.some((l) => close(l.d, 3670)) && jl.some((l) => l.code === "5140" && close(l.d, 2.5)) && jl.some((l) => l.code === "1040" && close(l.c, 3672.5)), { s: r.status, j: r.json, jl });
  r = await A.post(`/api/companies/${A.cid}/bank-statements/${line2.id}/match`, { matchedType: "invoice", matchedId: inv2.id, exchangeRate: -1 });
  ok("f1: a non-positive rate is refused (400)", r.status === 400 || r.status === 409, { s: r.status });

  // one receipt over two invoices books both at the receipt-date rate
  const inv3 = await A.invoice({ date: pmd(40), dueDate: pmd(-10), unitPrice: 1000, currency: "USD", exchangeRate: 3.6725 });
  const inv4 = await A.invoice({ date: pmd(40), dueDate: pmd(-10), unitPrice: 1000, currency: "USD", exchangeRate: 3.6725 });
  await A.importCsv(usd.id, [`${pmd(8)},WIRE 3,,2000.00,8000.00`]);
  const line3 = (await A.txns(usd.id)).find((t) => /WIRE 3/.test(t.description));
  r = await A.post(`/api/companies/${A.cid}/bank-statements/${line3.id}/match`, { matchedType: "invoices", allocations: [{ invoiceId: inv3.id }, { invoiceId: inv4.id }] });
  ok("f1: one USD receipt over two invoices is matched", r.status === 200, { s: r.status, j: r.json });
  const fxGain = (await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::float8 AS g FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '4090'`, [A.cid])).rows[0].g;
  ok("f1: realised FX over all receipts: +5.00 and +2.00 (two invoices) less the 2.50 loss in 5140 (4090 holds 7.00)", close(fxGain, 7), fxGain);
  rep = await recon(A, usd.id, pm, 8000);
  ok("f1: after three receipts the USD account still reconciles: ledger 8,000, difference 0", close(rep.json?.ledgerBalance, 8000) && close(rep.json?.difference, 0), rep.json);

  // ───── F2: revaluation at the month end ─────
  await A.post(`/api/companies/${A.cid}/exchange-rates`, { fromCurrency: "USD", toCurrency: "AED", rate: 3.68, effectiveDate: pm });
  const carrying = (await db.query(`SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS b FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = $2`, [A.cid, usd.glAccountId])).rows[0].b;
  const prev = await A.get(`/api/companies/${A.cid}/bank-accounts/${usd.id}/revaluation?asOf=${pm}`);
  ok("f2: the preview shows the USD balance, the closing rate and the AED adjustment, and posts nothing",
    prev.status === 200 && close(prev.json?.foreignBalance, 8000) && close(prev.json?.closingRate, 3.68) && close(prev.json?.carryingAed, carrying) && close(prev.json?.adjustmentAed, 8000 * 3.68 - carrying), prev.json);
  r = await A.post(`/api/companies/${A.cid}/bank-accounts/${usd.id}/revalue`, { asOf: pm });
  ok("f2: revaluing the USD account at month end posts an unrealised gain and its automatic reversal", r.status === 201 && r.json?.posted === true && !!r.json?.journalEntryId && !!r.json?.reversalEntryId, { s: r.status, j: r.json });
  const adj = round2(8000 * 3.68 - carrying);
  jl = await jeLines(r.json?.journalEntryId);
  ok("f2: Dr USD bank / Cr 4095 (unrealised exchange gain/loss, apart from the realised 4090) for the AED difference; the bank line carries USD 0 (a rate difference, never a deposit)", jl.some((l) => l.code !== "4095" && close(l.d, adj) && l.fc === "USD" && close(l.fd, 0)) && jl.some((l) => l.code === "4095" && close(l.c, adj)) && !jl.some((l) => l.code === "4090"), { adj, jl });
  const acc4095 = (await db.query(`SELECT code, type, name_en FROM accounts WHERE company_id = $1 AND code = '4095'`, [A.cid])).rows[0];
  ok("f2: the account is created on demand: 4095, an income account named for unrealised exchange gain / loss", acc4095?.type === "income" && /unrealised/i.test(acc4095?.name_en ?? ""), acc4095);
  const entry = (await db.query(`SELECT source, source_id, date::text AS d FROM journal_entries WHERE id = $1`, [r.json?.journalEntryId])).rows[0];
  const rev = (await db.query(`SELECT source, date::text AS d, reversed_entry_id FROM journal_entries WHERE id = $1`, [r.json?.reversalEntryId])).rows[0];
  ok("f2: sources fx_revaluation_bank / fx_revaluation_bank_reversal, the reversal the next day", entry?.source === "fx_revaluation_bank" && rev?.source === "fx_revaluation_bank_reversal" && rev.d.slice(0, 10) === pmNext && rev.reversed_entry_id === r.json?.journalEntryId, { entry, rev });
  let again = await A.post(`/api/companies/${A.cid}/bank-accounts/${usd.id}/revalue`, { asOf: pm });
  ok("f2: the same date again is refused (409 REVALUATION_ALREADY_POSTED), nothing posted twice", again.status === 409 && again.json?.code === "REVALUATION_ALREADY_POSTED", { s: again.status, j: again.json });
  const count = (await db.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'fx_revaluation_bank' AND status = 'posted'`, [A.cid])).rows[0].c;
  ok("f2: exactly one revaluation entry for the date", count === 1, count);
  rep = await recon(A, usd.id, pm, 8000);
  ok("f2: the USD reconciliation at the month end is unchanged by the revaluation: difference 0, no deposit in transit", close(rep.json?.ledgerBalance, 8000) && close(rep.json?.difference, 0) && !rep.json?.items?.depositsInTransit?.length && !rep.json?.items?.unreconciledCredits?.length && !rep.json?.items?.unreconciledDebits?.length, rep.json);
  rep = await recon(A, usd.id, today, 8000);
  ok("f2: and after the reversal day too", close(rep.json?.difference, 0) && !rep.json?.items?.depositsInTransit?.length, rep.json);
  // a revaluation keyed by hand (Dr bank / Cr 4090, AED only) is a rate difference as well
  const manualDate = pmd(3);
  const m = await A.journal(manualDate, [{ accountId: usd.glAccountId, debit: 17.5, credit: 0 }, { accountId: A.acct("4090").id, debit: 0, credit: 17.5 }], { description: "month-end USD revaluation (by hand)" });
  ok("f2: setup: a hand-keyed revaluation journal", m.status === 201 || m.status === 200, { s: m.status, j: m.json });
  rep = await recon(A, usd.id, pm, 8000);
  ok("f2: a hand-keyed Dr bank / Cr 4090 is not a USD deposit in transit: difference 0 and no phantom items", close(rep.json?.difference, 0) && !rep.json?.items?.depositsInTransit?.length && close(rep.json?.ledgerBalance, 8000), rep.json);
  // refusals
  const aed = await A.bankAccount({ nameEn: "AED acc", currency: "AED", createLedgerAccount: true });
  r = await A.post(`/api/companies/${A.cid}/bank-accounts/${aed.id}/revalue`, { asOf: pm });
  ok("f2: an AED account has nothing to revalue (422 BANK_ACCOUNT_NOT_FOREIGN)", r.status === 422 && r.json?.code === "BANK_ACCOUNT_NOT_FOREIGN", { s: r.status, j: r.json });
  r = await A.post(`/api/companies/${A.cid}/bank-accounts/${usd.id}/revalue`, { asOf: day(5) });
  ok("f2: a future date is refused (422)", r.status === 422 || r.status === 400, { s: r.status, j: r.json });
  const eur = await A.bankAccount({ nameEn: "FAB EUR", currency: "EUR", createLedgerAccount: true });
  await A.journal(pmd(5), [{ accountId: eur.glAccountId, debit: 1000, credit: 0, foreignCurrency: "EUR", foreignDebit: 270, exchangeRate: 3.7037 }, { accountId: A.acct("3010")?.id ?? A.acct("4010").id, debit: 0, credit: 1000 }], { description: "eur" });
  r = await A.post(`/api/companies/${A.cid}/bank-accounts/${eur.id}/revalue`, { asOf: pm });
  ok("f2: no rate for the currency on the date: 422 FX_RATE_MISSING (never a guessed rate)", r.status === 422 && r.json?.code === "FX_RATE_MISSING", { s: r.status, j: r.json });
  // month-end checklist item
  const cl = await A.get(`/api/companies/${A.cid}/month-end/checklist?period=${pm.slice(0, 7)}`);
  const item = (cl.json?.checklist ?? cl.json ?? []).find?.((i) => /revalu/i.test(i.title));
  ok("f2: the month-end checklist has a foreign-currency revaluation item; the EUR account is not revalued so it is incomplete", !!item && item.status === "incomplete" && /EUR|FAB/.test(item.details ?? ""), item ?? cl.json);
  await A.post(`/api/companies/${A.cid}/exchange-rates`, { fromCurrency: "EUR", toCurrency: "AED", rate: 4.0, effectiveDate: pm });
  r = await A.post(`/api/companies/${A.cid}/bank-accounts/revalue`, { asOf: pm });
  ok("f2: revalue-all revalues the foreign accounts that are not done yet (EUR) and skips the one that is (USD)", r.status === 201 && r.json?.results?.some((x) => x.bankAccountId === eur.id && x.posted) && r.json?.results?.some((x) => x.bankAccountId === usd.id && !x.posted && x.reason === "REVALUATION_ALREADY_POSTED"), { s: r.status, j: r.json });
  const cl2 = await A.get(`/api/companies/${A.cid}/month-end/checklist?period=${pm.slice(0, 7)}`);
  const item2 = (cl2.json?.checklist ?? cl2.json ?? []).find?.((i) => /revalu/i.test(i.title));
  ok("f2: with every foreign account revalued the item is complete", item2?.status === "complete", item2);

  // the open-document revaluation (invoices and bills) uses the same unrealised account; 4090 stays realised only
  const open1 = await A.invoice({ date: pmd(40), dueDate: pmd(-10), unitPrice: 1000, currency: "USD", exchangeRate: 3.6725 });
  const gain4090Before = (await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0)::float8 AS g FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '4090'`, [A.cid])).rows[0].g;
  r = await A.post(`/api/companies/${A.cid}/exchange-rates/revalue`, { asOf: pm });
  const docEntry = r.json?.journalEntryId ? await jeLines(r.json.journalEntryId) : [];
  ok("f2: the open USD invoice revalued at the closing rate posts its gain to 4095 (7.50), not 4090", r.status === 201 && docEntry.some((l) => l.code === "4095" && close(l.c, 7.5)) && !docEntry.some((l) => l.code === "4090" || l.code === "5140"), { s: r.status, j: r.json, docEntry });
  const gain4090After = (await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0)::float8 AS g FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '4090'`, [A.cid])).rows[0].g;
  ok("f2: the revaluations leave 4090 alone: it holds the realised 7.00 and the 17.50 keyed by hand, unchanged", close(gain4090Before, 24.5) && close(gain4090After, gain4090Before), { gain4090Before, gain4090After });
  void open1;
  const rpt = await A.get(`/api/companies/${A.cid}/reports/fx-gains-losses?from=${pmd(60)}&to=${today}`);
  ok("f2: the FX gains and losses report lists realised and unrealised lines", rpt.status === 200, { s: rpt.status });
}
function round2(v) { return Math.round(v * 100) / 100; }

const jeCount = async (cid) => (await db.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE company_id = $1`, [cid])).rows[0].c;
const mkBill = async (C, no, lines) => {
  const b = await C.post(`/api/companies/${C.cid}/bills`, { vendor_name: "Van Seller LLC", bill_number: no, bill_date: day(-20), due_date: day(10), line_items: lines });
  if (!b.json?.id) throw new Error("bill failed " + b.status + " " + b.text.slice(0, 200));
  const ap = await C.post(`/api/bills/${b.json.id}/approve`, {});
  if (ap.status >= 300) throw new Error("approve failed " + ap.status + " " + ap.text.slice(0, 200));
  return (await C.get(`/api/bills/${b.json.id}`)).json;
};
const register = (C, asOf = today) => C.get(`/api/companies/${C.cid}/fixed-assets/register?asOf=${asOf}`);

// ─────────────── F3: an asset is recorded in the books by the bill or journal that bought it ───────────────
async function linkSection() {
  const C = await newCompany("link");
  const bank = C.acct("1020");
  await C.journal(day(-60), [{ accountId: bank.id, debit: 300000, credit: 0 }, { accountId: C.acct("3010")?.id ?? C.acct("4010").id, debit: 0, credit: 300000 }], { description: "capital" });
  const cost1290 = C.acct("1290").id;
  const bill = await mkBill(C, "AFM-778", [{ description: "Toyota Hiace van", quantity: 1, unit_price: 80000, vat_rate: 5, account_id: cost1290 }]);
  const mk = async (body) => api("POST", `/api/companies/${C.cid}/fixed-assets`, { token: C.token, body: { depreciationMethod: "straight_line", category: "vehicles", salvageValue: 0, usefulLifeYears: 5, purchaseDate: day(-20), ...body } });

  let r = await mk({ assetName: "Van FA-0001", purchaseCost: 80000 });
  const van = r.json;
  ok("f3: setup: an asset registered with no payment account is not in the books yet", r.status === 200 && van?.needs_capitalization_je === true, { s: r.status, j: r.json });
  let reg = await register(C);
  ok("f3: the register shows it apart with a warning, outside the totals, and does not tie", reg.json?.unlinked?.count === 1 && close(reg.json?.unlinked?.cost, 80000) && close(reg.json?.totals?.cost, 0) && reg.json?.warnings?.includes("ASSETS_NOT_RECORDED_IN_BOOKS") && !close(reg.json?.glTie?.difference, 0), { u: reg.json?.unlinked, t: reg.json?.totals, w: reg.json?.warnings, d: reg.json?.glTie?.difference });
  const before = await jeCount(C.cid);
  r = await C.post(`/api/fixed-assets/${van.id}/link`, { billId: bill.id });
  ok("f3: linking the asset to the bill succeeds, names the document and returns the updated asset (so the register can refresh)", r.status === 200 && r.json?.linkedDocument?.type === "bill" && r.json?.linkedDocument?.number === "AFM-778" && r.json?.needs_capitalization_je === false && r.json?.asset?.id === van.id && r.json?.asset?.needs_capitalization_je === false, { s: r.status, j: r.json });
  ok("f3: linking posts nothing (no double posting)", (await jeCount(C.cid)) === before, { before, after: await jeCount(C.cid) });
  reg = await register(C);
  const row = reg.json?.rows?.find((x) => x.assetId === van.id);
  ok("f3: the register now counts its cost (80,000 from the bill), shows the bill, and ties to 1290 less 1240 (difference 0)", close(reg.json?.totals?.cost, 80000) && close(reg.json?.glTie?.difference, 0) && row?.linked === true && row?.linkedDocument?.type === "bill" && reg.json?.unlinked?.count === 0 && !reg.json?.warnings?.length, { t: reg.json?.totals, d: reg.json?.glTie, row, u: reg.json?.unlinked });
  r = await C.post(`/api/fixed-assets/${van.id}/link`, { billId: bill.id });
  ok("f3: linking twice is refused (409)", r.status === 409 && r.json?.code === "ASSET_ALREADY_LINKED", { s: r.status, j: r.json });

  const dup = (await mk({ assetName: "Second van", purchaseCost: 80000 })).json;
  r = await C.post(`/api/fixed-assets/${dup.id}/link`, { billId: bill.id });
  ok("f3: a line already linked to one asset cannot be linked to a second (409 LINE_ALREADY_LINKED)", r.status === 409 && r.json?.code === "LINE_ALREADY_LINKED", { s: r.status, j: r.json });
  const cand = await C.get(`/api/companies/${C.cid}/fixed-assets/linkable-lines`);
  ok("f3: the candidate list leaves linked lines out (the van's 80,000 line is not offered)", cand.status === 200 && Array.isArray(cand.json) && !cand.json.some((l) => l.billId === bill.id), { s: cand.status, j: cand.json });
  const bill2 = await mkBill(C, "AFM-779", [{ description: "Forklift", quantity: 1, unit_price: 20000, vat_rate: 5, account_id: cost1290 }, { description: "Pallet jack", quantity: 1, unit_price: 5000, vat_rate: 5, account_id: cost1290 }]);
  r = await C.post(`/api/fixed-assets/${dup.id}/link`, { billId: bill2.id });
  ok("f3: but it can link to a bill whose line still holds its cost (the 20,000 line is too small for 80,000)", r.status === 422, { s: r.status });
  await db.query(`DELETE FROM fixed_assets WHERE id = $1`, [dup.id]);

  const before2 = await jeCount(C.cid);
  const jack = bill2.line_items.find((l) => /jack/i.test(l.description));
  r = await mk({ assetName: "Pallet jack", purchaseCost: 5000, usefulLifeYears: 4, billId: bill2.id, billLineId: jack.id });
  ok("f3: an asset created from a bill line is recorded in the books at once, and nothing is posted for it", r.status === 200 && r.json?.needs_capitalization_je === false && r.json?.linkedDocument?.type === "bill" && (await jeCount(C.cid)) === before2, { s: r.status, j: r.json });
  reg = await register(C);
  ok("f3: the register totals 85,000; the ledger holds the forklift's 20,000 too (a line of the same bill nobody registered), so it differs by exactly that", close(reg.json?.totals?.cost, 85000) && close(reg.json?.glTie?.difference, -20000) && reg.json?.rows?.length === 2, { t: reg.json?.totals, d: reg.json?.glTie });
  r = await mk({ assetName: "Paid and linked", purchaseCost: 100, billId: bill2.id, paymentAccountId: bank.id });
  ok("f3: a bill link together with a payment account is refused (422 LINK_AND_PAYMENT_ACCOUNT): the cost would post twice", r.status === 422 && r.json?.code === "LINK_AND_PAYMENT_ACCOUNT", { s: r.status, j: r.json });
  const forklift = bill2.line_items.find((l) => /forklift/i.test(l.description));
  r = await mk({ assetName: "Too dear", purchaseCost: 99999, billId: bill2.id, billLineId: forklift.id });
  ok("f3: a cost above the bill line is refused (422 LINK_INVALID)", r.status === 422 && r.json?.code === "LINK_INVALID", { s: r.status, j: r.json });
  r = await mk({ assetName: "Second jack", purchaseCost: 100, billId: bill2.id, billLineId: jack.id });
  ok("f3: creating a second asset from a bill line that already funds one is refused (409 LINE_ALREADY_LINKED)", r.status === 409 && r.json?.code === "LINE_ALREADY_LINKED", { s: r.status, j: r.json });

  // a journal line on 1290 (an opening balance, a card purchase)
  const jr = await C.journal(day(-15), [{ accountId: cost1290, debit: 3000, credit: 0 }, { accountId: bank.id, debit: 0, credit: 3000 }], { description: "Drill bought by card" });
  const drill = (await mk({ assetName: "Drill", purchaseCost: 3000, usefulLifeYears: 3 })).json;
  r = await C.post(`/api/fixed-assets/${drill.id}/link`, { journalEntryId: jr.json?.id });
  ok("f3: an asset links to a posted journal entry that debits 1290", r.status === 200 && r.json?.linkedDocument?.type === "journal", { s: r.status, j: r.json, jr: jr.status });
  const plain = await C.journal(day(-14), [{ accountId: C.acct("5130")?.id ?? C.acct("5000").id, debit: 10, credit: 0 }, { accountId: bank.id, debit: 0, credit: 10 }], { description: "plain expense" });
  const pen = (await mk({ assetName: "Pen", purchaseCost: 10, usefulLifeYears: 1 })).json;
  r = await C.post(`/api/fixed-assets/${pen.id}/link`, { journalEntryId: plain.json?.id });
  ok("f3: a journal that puts nothing on a fixed-asset account cannot be linked (422 NO_FIXED_ASSET_LINE)", r.status === 422 && r.json?.details?.reason === "NO_FIXED_ASSET_LINE", { s: r.status, j: r.json });
  r = await C.post(`/api/fixed-assets/${pen.id}/link`, { journalEntryId: "00000000-0000-4000-8000-000000000000" });
  ok("f3: a journal id of nowhere is refused, not trusted (422)", r.status === 422 && r.json?.code === "LINK_INVALID", { s: r.status, j: r.json });
  // an asset capitalized by its own entry is already in the books
  const own = (await mk({ assetName: "Paid in cash", purchaseCost: 500, usefulLifeYears: 2, paymentAccountId: bank.id })).json;
  r = await C.post(`/api/fixed-assets/${own.id}/link`, { billId: bill2.id });
  ok("f3: an asset with a capitalization entry of its own cannot be linked (it would count twice)", r.status === 422 && r.json?.details?.reason === "ALREADY_CAPITALIZED", { s: r.status, j: r.json });
  reg = await register(C);
  const ownRow = reg.json?.rows?.find((x) => x.assetId === own.id);
  ok("f3: such an asset shows its capitalization entry as the document", ownRow?.linked === true && ownRow?.linkedDocument?.type === "journal", ownRow);
  // another company's bill is not a document of this one
  const other = await newCompany("linkx");
  const foreignBill = await mkBill(other, "OTH-1", [{ description: "x", quantity: 1, unit_price: 100, vat_rate: 0, account_id: other.acct("1290").id }]);
  r = await C.post(`/api/fixed-assets/${pen.id}/link`, { billId: foreignBill.id });
  ok("f3: another company's bill is refused (tenant scoping)", r.status === 422 && r.json?.details?.reason === "BILL_NOT_FOUND", { s: r.status, j: r.json });
  // unlink and relink
  r = await api("DELETE", `/api/fixed-assets/${van.id}/link`, { token: C.token });
  reg = await register(C);
  ok("f3: unlinking returns the updated asset and puts it back among the unlinked ones", r.status === 200 && r.json?.needs_capitalization_je === true && r.json?.asset?.needs_capitalization_je === true && reg.json?.rows?.find((x) => x.assetId === van.id)?.linked === false && reg.json?.unlinked?.cost >= 80000, { s: r.status, u: reg.json?.unlinked });
  r = await C.post(`/api/fixed-assets/${van.id}/link`, { billId: bill.id });
  ok("f3: and it can be linked again", r.status === 200, { s: r.status, j: r.json });
  r = await other.post(`/api/fixed-assets/${van.id}/link`, { billId: foreignBill.id });
  ok("f3: another company cannot link my asset (403)", r.status === 403, { s: r.status });
}

// ─────────────── F4: disposal stops depreciation at the disposal date ───────────────
async function disposalDepreciationSection() {
  const D = await newCompany("disp");
  const bank = D.acct("1020");
  await D.journal(day(-400), [{ accountId: bank.id, debit: 500000, credit: 0 }, { accountId: D.acct("3010")?.id ?? D.acct("4010").id, debit: 0, credit: 500000 }], { description: "capital" });
  const mkAsset = async (body) => firstOf(await D.post(`/api/companies/${D.cid}/fixed-assets`, { paymentAccountId: bank.id, depreciationMethod: "straight_line", category: "equipment", salvageValue: 0, ...body }));
  const dm = pmEnd.getUTCMonth() + 1, dy = pmEnd.getUTCFullYear();
  const dim = pmEnd.getUTCDate();
  const firstOfMonth = (back) => ymd(new Date(Date.UTC(dy, dm - 1 - back, 1)));
  const dispDate = `${dy}-${String(dm).padStart(2, "0")}-15`;
  const half = round2(1000 * 15 / dim);

  // A: the full disposal month has already been run (the tester's case)
  const fork = await mkAsset({ assetName: "Forklift", purchaseDate: firstOfMonth(3), purchaseCost: 36000, usefulLifeYears: 3 });
  let r = await D.post(`/api/fixed-assets/${fork.id}/depreciate`, { month: dm, year: dy, confirmBackdated: true });
  ok("f4: setup: depreciation was run through the disposal month (4 full months)", r.status === 200, { s: r.status, j: r.json });
  const accBefore = (await db.query(`SELECT COALESCE(SUM(amount),0)::float8 AS a FROM depreciation_schedules WHERE asset_id = $1`, [fork.id])).rows[0].a;
  ok("f4: setup: accumulated 4,000 before the disposal", close(accBefore, 4000), accBefore);
  const prev = await D.get(`/api/fixed-assets/${fork.id}/dispose-preview?date=${dispDate}&amount=40000&vatTreatment=standard`);
  ok("f4: the preview shows depreciation to the disposal date (days pro rata), VAT 2,000, book value and gain", prev.status === 200 && close(prev.json?.accumulatedAfter, 3000 + half) && close(prev.json?.nbv, 36000 - 3000 - half) && close(prev.json?.vatAmount, 2000) && close(prev.json?.total, 42000) && close(prev.json?.gainLoss, 40000 - (36000 - 3000 - half)) && close(prev.json?.depreciationReversed, 1000 - half), prev.json);
  r = await D.post(`/api/fixed-assets/${fork.id}/dispose`, { disposalDate: dispDate, disposalAmount: 40000, proceedsAccountId: bank.id });
  ok("f4: the disposal succeeds", r.status === 200 && !!r.json?.journalEntryId, { s: r.status, j: r.json });
  ok("f4: depreciation stops at the disposal date: accumulated 3,000 + 15/month-days of 1,000; the rest of the posted month is reversed", close(r.json?.accumulatedAtDisposal, 3000 + half) && close(r.json?.depreciationReversed, round2(1000 - half)), { acc: r.json?.accumulatedAtDisposal, rev: r.json?.depreciationReversed, half });
  ok("f4: gain / loss uses the book value at the disposal date", close(r.json?.netBookValueAtDisposal, 36000 - 3000 - half) && close(r.json?.gainLoss, 40000 - (36000 - 3000 - half)) && r.json?.gainLossType === "gain", r.json);
  let bal = await D.balances();
  const exp5100 = round2(3000 + half);
  ok("f4: the P&L carries 3,000 + the part month, not the full month: 5100 net debit", close(bal["5100"], exp5100) && close(bal["1240"], 0) && close(bal["1290"], 0), { b5100: bal["5100"], exp5100, b1240: bal["1240"], b1290: bal["1290"] });
  const rowDm = (await db.query(`SELECT amount::float8 AS a FROM depreciation_schedules WHERE asset_id = $1 AND period_year = $2 AND period_month = $3`, [fork.id, dy, dm])).rows[0];
  ok("f4: the schedule row of the disposal month now says the part month", close(rowDm?.a, half), rowDm);

  // B: the disposal month was never run: the disposal posts the months before it and the part month
  const lift = await mkAsset({ assetName: "Lift", purchaseDate: firstOfMonth(3), purchaseCost: 36000, usefulLifeYears: 3 });
  r = await D.post(`/api/fixed-assets/${lift.id}/dispose`, { disposalDate: dispDate, disposalAmount: 30000, proceedsAccountId: bank.id });
  ok("f4: an asset never depreciated is brought to the disposal date (3 full months + the part month), nothing after it", r.status === 200 && close(r.json?.accumulatedAtDisposal, 3000 + half) && close(r.json?.depreciationReversed, 0), { s: r.status, j: r.json });
  const total5100 = (await D.balances())["5100"];
  ok("f4: both assets together: 5100 is exactly 2 x (3,000 + part month)", close(total5100, 2 * exp5100), { total5100, exp5100 });
  const reg = await register(D, today);
  ok("f4: the register ties to the ledger after the disposals", close(reg.json?.glTie?.difference, 0), reg.json?.glTie);

  // C: a disposal in the acquisition month: from the acquisition day
  const acq = await mkAsset({ assetName: "Compressor", purchaseDate: `${dy}-${String(dm).padStart(2, "0")}-11`, purchaseCost: 12000, usefulLifeYears: 1 });
  r = await D.post(`/api/fixed-assets/${acq.id}/dispose`, { disposalDate: `${dy}-${String(dm).padStart(2, "0")}-20`, disposalAmount: 12000, proceedsAccountId: bank.id });
  ok("f4: disposed in its acquisition month: only the days from the acquisition day (10 of the month's days) are charged", r.status === 200 && close(r.json?.accumulatedAtDisposal, round2(1000 * 10 / dim), 0.02), { s: r.status, acc: r.json?.accumulatedAtDisposal, exp: round2(1000 * 10 / dim) });
  // a disposal on the first day of a month costs one day
  const tiny = await mkAsset({ assetName: "Tiny", purchaseDate: firstOfMonth(2), purchaseCost: 3600, usefulLifeYears: 1 });
  r = await D.post(`/api/fixed-assets/${tiny.id}/dispose`, { disposalDate: `${dy}-${String(dm).padStart(2, "0")}-01`, disposalAmount: 0 });
  ok("f4: disposed on the 1st: two whole months + 1 day of the disposal month", r.status === 200 && close(r.json?.accumulatedAtDisposal, round2(600 + 300 / dim), 0.02), { s: r.status, acc: r.json?.accumulatedAtDisposal });
}

// ─────────────── F5: disposal with a buyer and VAT ───────────────
async function disposalVatSection() {
  const V = await newCompany("dvat");
  const bank = V.acct("1020");
  const aed = await V.bankAccount({ nameEn: "FAB AED", currency: "AED", createLedgerAccount: true });
  await V.journal(day(-100), [{ accountId: aed.glAccountId, debit: 400000, credit: 0 }, { accountId: V.acct("3010")?.id ?? V.acct("4010").id, debit: 0, credit: 400000 }], { description: "capital" });
  const mkLand = async (name, cost) => firstOf(await V.post(`/api/companies/${V.cid}/fixed-assets`, { assetName: name, category: "land", purchaseDate: day(-90), purchaseCost: cost, paymentAccountId: aed.glAccountId, depreciationMethod: "straight_line" }));
  const balNow = async () => await V.balances();
  const invOf = async (id) => (await db.query(`SELECT i.id, i.number, i.status, i.emirate, i.currency, i.subtotal::float8 AS subtotal, i.vat_amount::float8 AS vat, i.total::float8 AS total, i.invoice_type FROM invoices i WHERE i.id = $1`, [id])).rows[0];
  const linesOf = async (id) => (await db.query(`SELECT vat_rate::float8 AS vr, vat_supply_type AS st, a.code FROM invoice_lines l LEFT JOIN accounts a ON a.id = l.revenue_account_id WHERE l.invoice_id = $1`, [id])).rows;

  // standard-rated, paid into the bank at once
  const plot = await mkLand("Plot 12", 30000);
  let r = await V.post(`/api/fixed-assets/${plot.id}/dispose`, { disposalDate: day(-5), disposalAmount: 40000, vatTreatment: "standard", buyerName: "Gulf Builders LLC", emirate: "sharjah", proceedsAccountId: aed.glAccountId });
  ok("f5: a standard-rated disposal succeeds and returns the VAT, the total and the invoice", r.status === 200 && close(r.json?.vatAmount, 2000) && close(r.json?.total, 42000) && !!r.json?.disposalInvoiceId && r.json?.vatTreatment === "standard" && r.json?.invoicePaid === true, { s: r.status, j: r.json });
  const inv = await invOf(r.json?.disposalInvoiceId);
  ok("f5: a sales invoice to the buyer: subtotal 40,000, VAT 2,000, total 42,000, in the buyer's emirate (sharjah), fully paid", close(inv?.subtotal, 40000) && close(inv?.vat, 2000) && close(inv?.total, 42000) && inv?.emirate === "sharjah" && inv?.status === "paid", inv);
  const lines = await linesOf(inv.id);
  ok("f5: its revenue line is standard-rated 5% and credits 4080 (gain on disposal), not sales revenue", lines.length === 1 && close(lines[0].vr, 0.05) && lines[0].st === "standard_rated" && lines[0].code === "4080", lines);
  let bal = await balNow();
  ok("f5: output VAT 2,000 is on 2020; 4080 holds the gain 10,000 (40,000 less cost 30,000); the sale is not revenue (4010 = 0); the land is gone; the bank got 42,000", close(-bal["2020"], 2000) && close(-bal["4080"], 10000) && close(bal["4010"] ?? 0, 0) && close(bal["1290"], 0) && close(bal["1040"] ?? 0, 0), { b2020: bal["2020"], b4080: bal["4080"], b4010: bal["4010"], b1290: bal["1290"], b1040: bal["1040"] });
  const bankNet = (await db.query(`SELECT COALESCE(SUM(debit - credit),0)::float8 AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = $2`, [V.cid, aed.glAccountId])).rows[0].n;
  ok("f5: the bank holds the capital + 42,000 - the land cost 30,000", close(bankNet, 400000 - 30000 + 42000), bankNet);
  const asset = (await db.query(`SELECT disposal_vat_treatment, disposal_vat_amount::float8 AS v, disposal_buyer_name, disposal_invoice_id FROM fixed_assets WHERE id = $1`, [plot.id])).rows[0];
  ok("f5: the asset keeps the buyer, the treatment, the VAT and the invoice", asset?.disposal_vat_treatment === "standard" && close(asset?.v, 2000) && asset?.disposal_buyer_name === "Gulf Builders LLC" && asset?.disposal_invoice_id === inv.id, asset);

  // buyer from the contacts: the contact's emirate is used when none is given; the invoice stays open until the bank line is matched
  const contact = await V.post(`/api/companies/${V.cid}/customer-contacts`, { name: "Ajman Trading", email: `aj_${rnd}@example.com`, emirate: "ajman" });
  const plot2 = await mkLand("Plot 13", 30000);
  r = await V.post(`/api/fixed-assets/${plot2.id}/dispose`, { disposalDate: day(-4), disposalAmount: 10000, vatTreatment: "standard", buyerId: contact.json?.id });
  const inv2 = await invOf(r.json?.disposalInvoiceId);
  ok("f5: a buyer chosen from the contacts: the invoice takes the contact's emirate (ajman) and, unpaid, stays open (sent)", r.status === 200 && r.json?.invoicePaid === false && inv2?.emirate === "ajman" && inv2?.status === "sent", { s: r.status, j: r.json, inv2 });
  bal = await balNow();
  ok("f5: a loss (10,000 against a book value of 30,000) goes to 5130 and 4080 nets to zero for this sale; 2020 now 2,500", close(bal["5130"] ?? 0, 20000) && close(-bal["2020"], 2500), { b5130: bal["5130"], b2020: bal["2020"], b4080: bal["4080"] });
  await V.importCsv(aed.id, [`${day(-3)},TT FROM AJMAN TRADING,,10500.00,`]);
  const line = (await V.txns(aed.id)).find((t) => /AJMAN/.test(t.description));
  const sugg = await V.get(`/api/companies/${V.cid}/bank-statements/${line.id}/suggestions`);
  ok("f5: the 10,500 bank line is suggested against the disposal invoice", (sugg.json ?? []).some((x) => x.kind === "invoice" && x.targetId === inv2.id), sugg.json?.slice?.(0, 3));
  r = await V.post(`/api/companies/${V.cid}/bank-statements/${line.id}/match`, { matchedType: "invoice", matchedId: inv2.id });
  ok("f5: matching it pays the invoice", r.status === 200 && (await invOf(inv2.id)).status === "paid", { s: r.status, j: r.json });

  // zero-rated and exempt: an invoice without VAT, nothing on 2020
  const plot3 = await mkLand("Plot 14", 5000);
  r = await V.post(`/api/fixed-assets/${plot3.id}/dispose`, { disposalDate: day(-3), disposalAmount: 8000, vatTreatment: "zero_rated", buyerName: "Export Buyer FZE" });
  const inv3 = await invOf(r.json?.disposalInvoiceId);
  const l3 = await linesOf(inv3.id);
  ok("f5: zero-rated: an invoice at 0% marked zero-rated, VAT 0, total 8,000", r.status === 200 && close(r.json?.vatAmount, 0) && close(inv3?.total, 8000) && l3[0]?.st === "zero_rated" && l3[0]?.code === "4080", { s: r.status, j: r.json, l3 });
  const plot4 = await mkLand("Plot 15", 5000);
  r = await V.post(`/api/fixed-assets/${plot4.id}/dispose`, { disposalDate: day(-3), disposalAmount: 6000, vatTreatment: "exempt", buyerName: "Residential Buyer" });
  const l4 = await linesOf(r.json?.disposalInvoiceId);
  ok("f5: exempt: an invoice marked exempt with no VAT", r.status === 200 && close(r.json?.vatAmount, 0) && l4[0]?.st === "exempt", { s: r.status, j: r.json, l4 });
  ok("f5: 2020 is still only the 2,500 from the standard-rated sales", close(-(await balNow())["2020"], 2500), (await balNow())["2020"]);

  // not a supply: the price goes straight to the bank, as before
  const plot5 = await mkLand("Plot 16", 5000);
  r = await V.post(`/api/fixed-assets/${plot5.id}/dispose`, { disposalDate: day(-2), disposalAmount: 5500, vatTreatment: "none", proceedsAccountId: aed.glAccountId });
  ok("f5: treatment none raises no invoice and no VAT", r.status === 200 && r.json?.disposalInvoiceId === null && close(r.json?.vatAmount, 0) && !r.json?.warnings?.length, { s: r.status, j: r.json });
  const plot6 = await mkLand("Plot 17", 5000);
  r = await V.post(`/api/fixed-assets/${plot6.id}/dispose`, { disposalDate: day(-2), disposalAmount: 5500 });
  ok("f5: a VAT-registered company that gives no treatment is warned, never silent (VAT_TREATMENT_NOT_SET)", r.status === 200 && r.json?.warnings?.some((w) => w.code === "VAT_TREATMENT_NOT_SET"), { s: r.status, j: r.json });

  // refusals leave nothing behind
  const plot7 = await mkLand("Plot 18", 5000);
  const jeBefore = await jeCount(V.cid);
  r = await V.post(`/api/fixed-assets/${plot7.id}/dispose`, { disposalDate: day(-2), disposalAmount: 5000, vatTreatment: "standard" });
  ok("f5: a taxable sale with no buyer is refused (422 BUYER_REQUIRED); the asset is still active and nothing was posted", r.status === 422 && r.json?.code === "BUYER_REQUIRED" && (await jeCount(V.cid)) === jeBefore && (await db.query(`SELECT status FROM fixed_assets WHERE id = $1`, [plot7.id])).rows[0].status !== "disposed", { s: r.status, j: r.json });
  r = await V.post(`/api/fixed-assets/${plot7.id}/dispose`, { disposalDate: day(-2), disposalAmount: 5000, vatTreatment: "standard", buyerName: "X", emirate: "narnia" });
  ok("f5: an unknown emirate is refused (422 EMIRATE_INVALID)", r.status === 422 && r.json?.code === "EMIRATE_INVALID", { s: r.status, j: r.json });
  r = await V.post(`/api/fixed-assets/${plot7.id}/dispose`, { disposalDate: day(-2), disposalAmount: 5000, vatTreatment: "reduced", buyerName: "X" });
  ok("f5: an unknown treatment is refused (422 VAT_TREATMENT_INVALID)", r.status === 422 && r.json?.code === "VAT_TREATMENT_INVALID", { s: r.status, j: r.json });
  const stranger = await newCompany("dvatx");
  r = await V.post(`/api/fixed-assets/${plot7.id}/dispose`, { disposalDate: day(-2), disposalAmount: 5000, vatTreatment: "standard", buyerId: contact.json?.id });
  ok("f5: a buyer is found in this company's contacts and nowhere else", r.status === 200, { s: r.status, j: r.json });
  const plot8 = await mkLand("Plot 19", 5000);
  r = await V.post(`/api/fixed-assets/${plot8.id}/dispose`, { disposalDate: day(-2), disposalAmount: 5000, vatTreatment: "standard", buyerId: "00000000-0000-4000-8000-000000000000" });
  ok("f5: a buyer id of nowhere is refused (422 BUYER_NOT_FOUND)", r.status === 422 && r.json?.code === "BUYER_NOT_FOUND", { s: r.status, j: r.json });
  r = await stranger.post(`/api/fixed-assets/${plot8.id}/dispose`, { disposalDate: day(-2), disposalAmount: 5000 });
  ok("f5: another company cannot dispose of my asset (403)", r.status === 403, { s: r.status });
  const plain = await newCompany("dvatn", { trn: false });
  const pl = firstOf(await plain.post(`/api/companies/${plain.cid}/fixed-assets`, { assetName: "Plot", category: "land", purchaseDate: day(-90), purchaseCost: 1000, depreciationMethod: "straight_line" }));
  r = await plain.post(`/api/fixed-assets/${pl.id}/dispose`, { disposalDate: day(-2), disposalAmount: 1200, vatTreatment: "standard", buyerName: "B" });
  ok("f5: a company with no TRN cannot charge VAT (422 VAT_NOT_REGISTERED)", r.status === 422 && r.json?.code === "VAT_NOT_REGISTERED", { s: r.status, j: r.json });
  r = await plain.post(`/api/fixed-assets/${pl.id}/dispose`, { disposalDate: day(-2), disposalAmount: 1200 });
  ok("f5: ...but can dispose of an asset with no treatment, and is not warned", r.status === 200 && !r.json?.warnings?.length, { s: r.status, j: r.json });

  // the invoice of a disposal reaches the VAT return by emirate (S7's return reads invoices)
  const gen = await V.post(`/api/companies/${V.cid}/vat-returns/generate`, { periodStart: `${Y}-01-01`, periodEnd: `${Y}-12-31` });
  const vr = gen.json?.vatReturn ?? gen.json;
  ok("f5: the VAT return shows the disposals in box 1 by emirate: Sharjah 40,000 / 2,000 and Ajman 15,000 / 750 (10,000 and 5,000)", gen.status < 300 && close(vr?.box1cSharjahAmount, 40000) && close(vr?.box1cSharjahVat, 2000) && close(vr?.box1dAjmanAmount, 15000) && close(vr?.box1dAjmanVat, 750), { s: gen.status, keys: Object.keys(vr ?? {}).filter((k) => /box1[cd]/.test(k)).map((k) => [k, vr[k]]), msg: gen.text?.slice(0, 200) });
}

// ─────────────── F7: an asset bought in a closed year ───────────────
async function closedYearSection() {
  const E = await newCompany("cyear");
  const bank = E.acct("1020");
  const cap = E.acct("3010")?.id ?? E.acct("4010").id;
  await E.journal(`${Y - 3}-12-01`, [{ accountId: bank.id, debit: 100000, credit: 0 }, { accountId: cap, debit: 0, credit: 100000 }], { description: "capital" });
  const jr = await E.journal(`${Y - 2}-03-15`, [{ accountId: E.acct("1290").id, debit: 7000, credit: 0 }, { accountId: bank.id, debit: 0, credit: 7000 }], { description: "Press bought in March" });
  let r = await E.post(`/api/companies/${E.cid}/year-end/close`, { yearStart: `${Y - 2}-01-01` });
  ok("f7: setup: the financial year two years back is closed", r.status === 200 || r.status === 201, { s: r.status, j: r.json });
  const mk = (body) => E.post(`/api/companies/${E.cid}/fixed-assets`, { category: "equipment", depreciationMethod: "straight_line", salvageValue: 0, usefulLifeYears: 5, ...body });
  const before = await jeCount(E.cid);
  r = await mk({ assetName: "Old van", purchaseDate: `${Y - 2}-03-15`, purchaseCost: 12000 });
  ok("f7: an asset with no payment account in the closed year registers (2xx), is not in the books yet, and says why", r.status === 200 && r.json?.id && r.json?.needs_capitalization_je === true && r.json?.warnings?.some((w) => w.code === "ASSET_IN_CLOSED_YEAR" && w.year === Y - 2), { s: r.status, j: r.json });
  ok("f7: nothing was posted into the closed year", (await jeCount(E.cid)) === before, { before, after: await jeCount(E.cid) });
  r = await mk({ assetName: "Old truck", purchaseDate: `${Y - 2}-03-15`, purchaseCost: 12000, paymentAccountId: bank.id });
  ok("f7: with a payment account (a capitalization journal in the closed year) it is refused with a code the screen can show: 422 ASSET_IN_CLOSED_YEAR and the year", r.status === 422 && r.json?.code === "ASSET_IN_CLOSED_YEAR" && r.json?.details?.year === Y - 2 && /closed financial year/i.test(r.json?.message ?? ""), { s: r.status, j: r.json });
  const row = (await db.query(`SELECT COUNT(*)::int AS c FROM fixed_assets WHERE company_id = $1 AND asset_name = 'Old truck'`, [E.cid])).rows[0];
  ok("f7: the refused asset was not saved", row.c === 0, row);
  r = await mk({ assetName: "Press", purchaseDate: `${Y - 2}-03-15`, purchaseCost: 7000, journalEntryId: jr.json?.id });
  ok("f7: an asset linked to the journal that bought it (also in the closed year) registers and is in the books", r.status === 200 && r.json?.needs_capitalization_je === false && r.json?.linkedDocument?.type === "journal", { s: r.status, j: r.json });
  const reg = await register(E, `${Y - 1}-12-31`);
  ok("f7: the register shows the linked press at cost 7,000 and the old van apart", close(reg.json?.totals?.cost, 7000) && reg.json?.unlinked?.count === 1, { t: reg.json?.totals, u: reg.json?.unlinked });
  // a locked month behaves the same way
  const lockEnd = pmd(40);
  await E.post(`/api/companies/${E.cid}/month-end/lock-period`, { periodEnd: ymd(new Date(Date.UTC(Number(lockEnd.slice(0, 4)), Number(lockEnd.slice(5, 7)), 0))) });
  r = await mk({ assetName: "Locked month asset", purchaseDate: lockEnd, purchaseCost: 500 });
  ok("f7: a purchase date in a locked month registers without posting and carries a warning", r.status === 200 && r.json?.warnings?.some((w) => w.code === "ASSET_PERIOD_LOCKED_NO_POSTING"), { s: r.status, j: r.json });
  r = await mk({ assetName: "Locked month paid", purchaseDate: lockEnd, purchaseCost: 500, paymentAccountId: bank.id });
  ok("f7: ...but with a payment account the locked month still refuses the journal (403, the period named)", r.status === 403 && /locked period/i.test(r.json?.message ?? ""), { s: r.status, j: r.json });
}

// ─────────────── bank accounts always have a ledger account; a credit card is a liability ───────────────
async function bankAccountSection() {
  const F = await newCompany("bk");
  const cap = F.acct("3010")?.id ?? F.acct("4010").id;
  let r = await F.post(`/api/companies/${F.cid}/bank-accounts`, { nameEn: "Plain account", bankName: "FAB", currency: "AED" });
  ok("bank: a bank account created with no ledger choice gets its own ledger account", r.status === 201 && !!r.json?.glAccountId && r.json?.accountKind === "bank", { s: r.status, j: r.json });
  // an account that has none (an older one, or one created by another path) gets one when the list is read
  const orphan = (await db.query(`INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, is_active) VALUES ($1, 'Imported orphan', 'FAB', 'AED', true) RETURNING id`, [F.cid])).rows[0];
  const list = await F.get(`/api/companies/${F.cid}/bank-accounts`);
  const healed = (list.json ?? []).find((b) => b.id === orphan.id);
  ok("bank: an account that has no ledger account gets one when the accounts are read (so it is offered on payments)", !!healed?.glAccountId && (await db.query(`SELECT type FROM accounts WHERE id = $1`, [healed.glAccountId])).rows[0]?.type === "asset", healed);
  ok("bank: every active bank account of the company now has a ledger account", (list.json ?? []).every((b) => !!b.glAccountId), list.json?.map?.((b) => [b.nameEn, b.glAccountId]));

  // a credit card
  r = await F.post(`/api/companies/${F.cid}/bank-accounts`, { nameEn: "Visa Business", bankName: "Mashreq", currency: "AED", kind: "credit_card" });
  const card = r.json;
  const cardGl = (await db.query(`SELECT code, type, sub_type FROM accounts WHERE id = $1`, [card?.glAccountId])).rows[0];
  ok("bank: a credit card is a bank-type account whose ledger account is a liability (2xxx)", r.status === 201 && card?.accountKind === "credit_card" && cardGl?.type === "liability" && /^2\d{3}$/.test(cardGl?.code), { s: r.status, card, cardGl });
  const lst = await F.get(`/api/companies/${F.cid}/bank-accounts`);
  ok("bank: the list tells the screens it is a credit card", lst.json?.find((b) => b.id === card.id)?.accountKind === "credit_card", lst.json?.find((b) => b.id === card.id));
  const asset = (await F.get(`/api/companies/${F.cid}/accounts`)).json.find((a) => a.code === "5130" || a.code === "5000");
  await F.importCsv(card.id, [`${day(-9)},DEWA UTILITIES,-150.00,,-150.00`, `${day(-8)},CAREEM RIDES,-50.00,,-200.00`, `${day(-7)},PAYMENT THANK YOU,,100.00,-100.00`]);
  let t = await F.txns(card.id);
  ok("bank: a card statement imports: purchases negative, the payment positive", t.length === 3 && t.some((x) => /DEWA/.test(x.description) && close(x.amount, -150)) && t.some((x) => /PAYMENT/.test(x.description) && close(x.amount, 100)), t.map((x) => [x.description, x.amount]));
  const dewa = t.find((x) => /DEWA/.test(x.description));
  r = await F.post(`/api/companies/${F.cid}/bank-statements/${dewa.id}/create-entry`, { accountId: asset.id });
  const dl = r.json?.journalEntry?.id ? await jeLines(r.json.journalEntry.id) : [];
  ok("bank: a card purchase posts Dr expense / Cr the card (liability up)", r.status === 201 && dl.some((l) => l.code === asset.code && close(l.d, 150)) && dl.some((l) => l.code === cardGl.code && close(l.c, 150)), { s: r.status, dl, j: r.json });
  const careem = t.find((x) => /CAREEM/.test(x.description));
  await F.post(`/api/companies/${F.cid}/bank-statements/${careem.id}/create-entry`, { accountId: asset.id });
  const plainBank = (await F.get(`/api/companies/${F.cid}/bank-accounts`)).json.find((b) => b.nameEn === "Plain account");
  await F.journal(day(-30), [{ accountId: plainBank.glAccountId, debit: 5000, credit: 0 }, { accountId: cap, debit: 0, credit: 5000 }], { description: "capital" });
  const pay = t.find((x) => /PAYMENT/.test(x.description));
  r = await F.post(`/api/companies/${F.cid}/bank-statements/${pay.id}/create-entry`, { accountId: plainBank.glAccountId });
  const pl = r.json?.journalEntry?.id ? await jeLines(r.json.journalEntry.id) : [];
  ok("bank: a payment to the card posts Dr the card / Cr the bank (liability down)", r.status === 201 && pl.some((l) => l.code === cardGl.code && close(l.d, 100)), { s: r.status, pl, j: r.json });
  const bal = await F.balances();
  ok("bank: the card ledger is -100 (100 owed, a credit balance)", close(bal[cardGl.code], -100), bal[cardGl.code]);
  let rep = await recon(F, card.id, today, -100);
  ok("bank: the card statement reconciles against its ledger: ledger -100, difference 0, nothing open", close(rep.json?.ledgerBalance, -100) && close(rep.json?.difference, 0) && !rep.json?.items?.depositsInTransit?.length && !rep.json?.items?.outstandingPayments?.length, rep.json);
  r = await F.post(`/api/companies/${F.cid}/bank-reconciliations`, { bankAccountId: card.id, statementDate: today, statementBalance: -100 });
  ok("bank: the card reconciliation can be completed", r.status === 201, { s: r.status, j: r.json });
  // bill payment with the card; invoice payment into a managed bank account
  const bill = await mkBill(F, "CARD-1", [{ description: "Software", quantity: 1, unit_price: 300, vat_rate: 0 }]);
  r = await F.post(`/api/bills/${bill.id}/payments`, { amount: 300, payment_account_id: card.glAccountId });
  ok("bank: a bill can be paid with the credit card (the card is credited)", r.status < 300, { s: r.status, j: r.json });
  const inv = await F.invoice({ unitPrice: 400 });
  r = await F.post(`/api/companies/${F.cid}/invoices/${inv.id}/payments`, { amount: 400, paymentAccountId: plainBank.glAccountId });
  ok("bank: Record Payment accepts a managed bank account (1021 and up), not only the system cash and bank accounts", r.status === 200 || r.status === 201, { s: r.status, j: r.json });
  const dep = await db.query(`SELECT COUNT(*)::int AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1 AND jl.account_id = $2 AND jl.debit = 400`, [F.cid, plainBank.glAccountId]);
  ok("bank: the 400 landed on that bank's ledger account", dep.rows[0].c === 1, dep.rows[0]);
  r = await F.post(`/api/companies/${F.cid}/bank-accounts`, { nameEn: "Bad card", bankName: "FAB", kind: "credit_card", glAccountId: F.acct("2020").id });
  ok("bank: the VAT account cannot be a card's ledger account (422)", r.status === 422, { s: r.status, j: r.json });
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await fxSection();
    await linkSection();
    await disposalDepreciationSection();
    await disposalVatSection();
    await closedYearSection();
    await bankAccountSection();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
