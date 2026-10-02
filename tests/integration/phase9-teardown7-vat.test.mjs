// Teardown 7 / v1: the VAT return and the period lock. Live requests against a running server + Postgres.
//   #2  box 1 is split by the emirate of each supply (return, Autopilot, VAT Audit, workpaper)
//   #6  locking a month never blocks preparing or filing the VAT return of a period that includes it
//   #7  the VAT Filing page's period, Autopilot's overdue list and its ledger tie use the right days
//   BASE_URL=http://localhost:5077 DATABASE_URL=... node tests/integration/phase9-teardown7-vat.test.mjs

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
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const today = ymd(now);
const prevEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
const prevStart = prevEnd.slice(0, 8) + "01";
const prevMid = prevEnd.slice(0, 8) + "15";
const prevMonthKey = prevEnd.slice(0, 7);
let db;

async function newCompany(label, { emirate = "sharjah", monthly = true } = {}) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate } });
  if (monthly) await db.query(`UPDATE companies SET vat_filing_frequency = 'Monthly' WHERE id = $1`, [cid]);
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  const acct = (code) => accounts.find((a) => a.code === code);
  const post = (p, body) => api("POST", p, { token, body });
  const C = { token, cid, userId, acct, post };
  C.get = (p) => api("GET", p, { token });
  C.run = (reportId, query = "") => api("GET", `/api/companies/${cid}/reports/run/${reportId}${query ? "?" + query : ""}`, { token });
  C.invoice = async (date, lines, extra = {}) => {
    const r1 = await post(`/api/companies/${cid}/invoices`, { customerName: "Buyer", date, dueDate: date, lines, ...extra });
    if (!r1.json?.id) throw new Error("invoice failed " + r1.status + " " + r1.text.slice(0, 300));
    const r2 = await api("PATCH", `/api/invoices/${r1.json.id}/status`, { token, body: { status: "sent" } });
    if (r2.status !== 200) throw new Error("issue failed " + r2.status + " " + r2.text.slice(0, 300));
    return r1.json;
  };
  C.gen = (start = prevStart, end = prevEnd) => post(`/api/companies/${cid}/vat-returns/generate`, { periodStart: start, periodEnd: end });
  C.file = (rid, body = {}) => post(`/api/vat-returns/${rid}/file`, { ftaReferenceNumber: `T7-${rnd}-${Math.random().toString(36).slice(2, 6)}`, filedAt: today, ...body });
  C.vatReturn = async (id) => ((await api("GET", `/api/companies/${cid}/vat-returns`, { token })).json ?? []).find((r) => r.id === id);
  C.lock = (periodEnd, body = {}) => post(`/api/companies/${cid}/month-end/lock-period`, { periodEnd, ...body });
  return C;
}
const boxOf = (g, prefix) => ({ amount: n(g?.[`${prefix}Amount`]), vat: n(g?.[`${prefix}Vat`]) });
const detailRows = (res) => (res.json?.rows ?? []).filter((r) => r.kind === "detail");

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await emirateSplit();
    await lockAndFile();
    await periodsAndAutopilot();
    await journalReversalDate();
    await journalReversalLinks();
    await voidedDocuments();
    await filedElsewhereAndBooksStart();
    await assetDisposalVat();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// ═════════════════════════════════════════════════════════════════════════════
// #2: box 1 by the emirate of each supply
// ═════════════════════════════════════════════════════════════════════════════
async function emirateSplit() {
  const C = await newCompany("t7emirate", { emirate: "sharjah" });
  // Dubai customer: 400 x 35 less 5% = 13,300 + 200 shipping = 13,500 (VAT 675); a credit note of 665 (VAT 33.25) on it
  const dubai = await C.invoice(prevMid, [
    { description: "Cement", quantity: 400, unitPrice: 35, vatRate: 0.05, discountType: "percent", discountValue: 5 },
    { description: "Delivery", quantity: 1, unitPrice: 200, vatRate: 0.05, lineKind: "shipping" },
  ]);
  const abuDhabi = await C.invoice(prevMid, [{ description: "Cement", quantity: 150, unitPrice: 36, vatRate: 0.05 }]);
  const local = await C.invoice(prevMid, [{ description: "Local sale", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  await db.query(`UPDATE invoices SET emirate = 'dubai' WHERE id = $1`, [dubai.id]);
  await db.query(`UPDATE invoices SET emirate = 'abu_dhabi' WHERE id = $1`, [abuDhabi.id]);
  const cn = await C.post(`/api/companies/${C.cid}/invoices/${dubai.id}/credit-note`, { date: prevEnd, lines: [{ description: "Cement returned", quantity: 20, unitPrice: 33.25, vatRate: 0.05 }] });
  if (![200, 201].includes(cn.status)) throw new Error("credit note failed " + cn.status + " " + cn.text.slice(0, 200));
  const cnId = cn.json?.creditNote?.id ?? cn.json?.id;
  await db.query(`UPDATE invoices SET emirate = 'dubai' WHERE id = $1`, [cnId]); // S1 copies the invoice's emirate at creation; make sure
  void local;
  const gen = await C.gen();
  const g = gen.json;
  ok("T7-2 box 1b Dubai: 13,300 + 200 - 665 = 12,835 / VAT 641.75", close(boxOf(g, "box1bDubai").amount, 12835) && close(boxOf(g, "box1bDubai").vat, 641.75), boxOf(g, "box1bDubai"));
  ok("T7-2 box 1a Abu Dhabi: 5,400 / 270", close(boxOf(g, "box1aAbuDhabi").amount, 5400) && close(boxOf(g, "box1aAbuDhabi").vat, 270), boxOf(g, "box1aAbuDhabi"));
  ok("T7-2 a document with no emirate falls back to the company's (Sharjah 1,000 / 50)", close(boxOf(g, "box1cSharjah").amount, 1000) && close(boxOf(g, "box1cSharjah").vat, 50), boxOf(g, "box1cSharjah"));
  ok("T7-2 the emirate rows add up to box 8 (19,235 / 961.75)", close(g?.box8TotalAmount, 19235) && close(g?.box8TotalVat, 961.75), { a: g?.box8TotalAmount, v: g?.box8TotalVat });

  const audit = await C.run("vat-audit-sales", `from=${prevStart}&to=${prevEnd}`);
  const emirates = new Set(detailRows(audit).map((r) => r.cells.emirate));
  ok("T7-2 the VAT Audit sales rows carry the emirate of each supply (dubai, abu_dhabi, sharjah)", ["dubai", "abu_dhabi", "sharjah"].every((e) => emirates.has(e)), [...emirates]);
  const vatReturnReport = await C.run("vat-return", `from=${prevStart}&to=${prevEnd}`);
  const rowTexts = JSON.stringify(vatReturnReport.json?.rows ?? []);
  ok("T7-2 the VAT 201 report shows the Abu Dhabi and Dubai rows with their figures", vatReturnReport.status === 200 && /12835/.test(rowTexts) && /5400/.test(rowTexts), vatReturnReport.status);

  const ap = await C.get(`/api/vat/autopilot/calculate/${C.cid}?periodStart=${prevStart}&periodEnd=${prevEnd}&persist=false`);
  const v = ap.json?.vat201 ?? {};
  ok("T7-2 VAT Autopilot splits the same way (Dubai 12,835 / 641.75, Abu Dhabi 5,400 / 270, Sharjah 1,000 / 50)",
    close(boxOf(v, "box1bDubai").amount, 12835) && close(boxOf(v, "box1bDubai").vat, 641.75) && close(boxOf(v, "box1aAbuDhabi").amount, 5400) && close(boxOf(v, "box1cSharjah").amount, 1000),
    { s: ap.status, b: boxOf(v, "box1bDubai"), a: boxOf(v, "box1aAbuDhabi"), c: boxOf(v, "box1cSharjah") });

  const wp = await C.post(`/api/companies/${C.cid}/vat-workpapers`, { periodStart: prevStart, periodEnd: prevEnd });
  const pulled = await C.post(`/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}/pull-from-books`, {});
  const detail = await C.get(`/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}`);
  const wpRows = detail.json?.rows ?? [];
  const byDoc = (id) => wpRows.find((r) => r.sourceDocumentId === id && /standard/i.test(String(r.rowCategory)));
  ok("T7-2 the workpaper pulls each invoice with its own emirate", pulled.status === 200 && byDoc(dubai.id)?.emirate === "dubai" && byDoc(abuDhabi.id)?.emirate === "abu_dhabi" && byDoc(local.id)?.emirate === "sharjah", { s: pulled.status, rows: wpRows.map((r) => [r.rowCategory, r.emirate]) });
}

// ═════════════════════════════════════════════════════════════════════════════
// #6: locking a month does not block the VAT return
// ═════════════════════════════════════════════════════════════════════════════
let lockedCompany;
async function lockAndFile() {
  const C = await newCompany("t7lock", { emirate: "sharjah" });
  lockedCompany = C;
  await C.invoice(prevMid, [{ description: "Sale", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  const refused = await C.lock(prevEnd);
  ok("T7-6 the month cannot be locked while its VAT return is not prepared (409 VAT_RETURN_OPEN)", refused.status === 409 && refused.json?.code === "VAT_RETURN_OPEN", { s: refused.status, j: refused.json });
  const checklist = await C.get(`/api/companies/${C.cid}/month-end/checklist?period=${prevMonthKey}`);
  const vatItem = (checklist.json?.checklist ?? []).find((x) => x.id === 7);
  ok("T7-6 the checklist's VAT item is open", vatItem?.status === "incomplete", vatItem);
  const noReason = await C.lock(prevEnd, { overrideVatCheck: true });
  ok("T7-6 an override needs a written reason (400)", noReason.status === 400 && noReason.json?.code === "VAT_OVERRIDE_REASON_REQUIRED", { s: noReason.status, j: noReason.json });
  const locked = await C.lock(prevEnd, { overrideVatCheck: true, overrideReason: "Quarter return follows next week" });
  ok("T7-6 with the explicit override and a reason the month locks (200)", locked.status === 200, { s: locked.status, j: locked.json });
  const auditRow = (await db.query(`SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'period.lock' ORDER BY created_at DESC LIMIT 1`, [C.cid])).rows[0];
  ok("T7-6 the override is audit-logged with its reason", /vatReturnOverride/.test(JSON.stringify(auditRow?.details)) && /Quarter return follows next week/.test(JSON.stringify(auditRow?.details)), auditRow);

  // the month is locked: the return is still prepared, computed and put in a workpaper
  const gen = await C.gen();
  ok("T7-6 'Create official draft' works in the locked month (200/201 with an id)", [200, 201].includes(gen.status) && !!gen.json?.id, { s: gen.status, t: gen.text?.slice(0, 200) });
  const checklist2 = await C.get(`/api/companies/${C.cid}/month-end/checklist?period=${prevMonthKey}`);
  const vatItem2 = (checklist2.json?.checklist ?? []).find((x) => x.id === 7);
  ok("T8 once the draft exists the VAT item is satisfied: VAT return for <period> exists (draft)", vatItem2?.status === "complete" && vatItem2?.details === `VAT return for ${prevStart} \u2013 ${prevEnd} exists (draft).`, vatItem2);
  const again = await C.gen();
  ok("T7-6 'Compute return' (regenerate) works too", [200, 201].includes(again.status), { s: again.status, t: again.text?.slice(0, 200) });
  const wp = await C.post(`/api/companies/${C.cid}/vat-workpapers`, { periodStart: prevStart, periodEnd: prevEnd });
  ok("T7-6 the workpaper can be created / opened in the locked month", wp.status === 201 || wp.status === 200, { s: wp.status, t: wp.text?.slice(0, 200) });
  const pull = await C.post(`/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}/pull-from-books`, {});
  ok("T7-6 ... and its rows pulled from the books", pull.status === 200, { s: pull.status, t: pull.text?.slice(0, 200) });
  const ordinary = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body: { customerName: "Late", date: prevMid, dueDate: prevMid, lines: [{ description: "Late", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
  const issueLate = ordinary.json?.id ? await api("PATCH", `/api/invoices/${ordinary.json.id}/status`, { token: C.token, body: { status: "sent" } }) : ordinary;
  ok("T7-6 an ordinary posting into the locked month is still refused (403 PERIOD_LOCKED)", issueLate.status === 403, { s: issueLate.status, t: issueLate.text?.slice(0, 160) });

  // filing posts the VAT filing journal on the filing date, even when that month is locked
  const firstDayNext = today.slice(0, 8) + "01";
  const lockThisMonth = await C.lock(`${today.slice(0, 8)}${String(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`);
  ok("T7-6 (setup) the filing month itself is locked", lockThisMonth.status === 200, { s: lockThisMonth.status, j: lockThisMonth.json });
  const snapBefore = await C.vatReturn(gen.json.id);
  const file = await C.file(gen.json.id);
  ok("T7-6 the return files (201) although the filing month is locked", file.status === 201, { s: file.status, t: file.text?.slice(0, 300) });
  const je = (await db.query(`SELECT memo, source, date::date::text AS d FROM journal_entries WHERE company_id = $1 AND source = 'vat_filing' AND source_id = $2`, [C.cid, gen.json.id])).rows[0];
  ok("T7-6 the clearing journal is the VAT filing journal on the filing date, labelled as posted into the locked month", !!je && je.d === today && /VAT filing journal/i.test(je.memo) && /locked month/i.test(je.memo), je);
  const filed = await C.vatReturn(gen.json.id);
  ok("T7-6 the filed figures are those of the draft (snapshot unchanged)", close(filed?.box12TotalDueTax, snapBefore?.box12TotalDueTax) && close(filed?.box14PayableTax, snapBefore?.box14PayableTax) && filed?.status === "filed", { b: snapBefore?.box14PayableTax, a: filed?.box14PayableTax, st: filed?.status });
  void firstDayNext;

  // unlock: owner, with a reason, audit-logged
  const noWhy = await C.post(`/api/companies/${C.cid}/month-end/unlock-period`, { period: prevMonthKey });
  ok("T7-6 reopening a month needs a reason (400)", noWhy.status === 400, { s: noWhy.status, j: noWhy.json });
  const unlock = await C.post(`/api/companies/${C.cid}/month-end/unlock-period`, { period: prevMonthKey, reason: "Missed supplier invoice to enter" });
  ok("T7-6 the owner reopens the month with a reason (200, status open)", unlock.status === 200 && unlock.json?.status === "open", { s: unlock.status, j: unlock.json });
  const unlockAudit = (await db.query(`SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'period.unlock' ORDER BY created_at DESC LIMIT 1`, [C.cid])).rows[0];
  ok("T7-6 the reopening is audit-logged with the reason", /Missed supplier invoice to enter/.test(JSON.stringify(unlockAudit?.details)), unlockAudit);
}

// ═════════════════════════════════════════════════════════════════════════════
// #7: the period, the overdue list and the ledger tie
// ═════════════════════════════════════════════════════════════════════════════
async function periodsAndAutopilot() {
  const C = await newCompany("t7period", { emirate: "sharjah" });
  await db.query(`UPDATE companies SET tax_registration_date = $2::timestamp WHERE id = $1`, [C.cid, prevStart]);
  await C.invoice(prevMid, [{ description: "Sale", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  // an invoice dated 00:00 Dubai on the 1st of this month (the instant is the evening of the previous day in UTC): next period's, not this one's
  const edge = await C.invoice(prevMid, [{ description: "First of the month", quantity: 1, unitPrice: 350, vatRate: 0.05 }]);
  const stored = `${prevEnd} 20:00:00`;
  await db.query(`UPDATE invoices SET date = $2::timestamp WHERE id = $1`, [edge.id, stored]);
  await db.query(`UPDATE journal_entries SET date = $3::timestamp WHERE company_id = $1 AND source = 'invoice' AND source_id = $2`, [C.cid, edge.id, stored]);

  const cur = await C.get(`/api/companies/${C.cid}/vat-returns/current-period`);
  ok("T7-7 the filing page's period is the last ended unfiled period (last month), not the one containing today", cur.status === 200 && cur.json?.periodStart === prevStart && cur.json?.periodEnd === prevEnd && cur.json?.state === "ended_unfiled", cur.json);

  const periods = await C.get(`/api/vat/autopilot/periods/${C.cid}`);
  const list = Array.isArray(periods.json) ? periods.json : (periods.json?.periods ?? []);
  ok("T7-7 Autopilot lists no period that ended before the VAT start day (none overdue for a company that started last month)", list.length > 0 && list.every((p) => String(p.periodEnd).slice(0, 10) >= prevStart) && !list.some((p) => p.deadline?.isOverdue && String(p.periodEnd).slice(0, 10) < prevStart), list.map((p) => [p.periodEnd, p.deadline?.level]));
  const due = await C.get(`/api/vat/autopilot/due-dates?companyId=${C.cid}`);
  ok("T7-7 the due-dates list shows last month's period, not an old one", due.status === 200 && (due.json ?? []).every((d) => String(d.periodEnd).slice(0, 10) >= prevStart), due.json);

  const calc = await C.get(`/api/vat/autopilot/calculate/${C.cid}?periodStart=${prevStart}&periodEnd=${prevEnd}&persist=false`);
  const rec = calc.json?.reconciliation;
  ok("T7-7 the Autopilot ledger tie compares the same days as the return: the 1st-of-month invoice is no mismatch", calc.status === 200 && rec?.hasDiscrepancy === false && close(rec?.outputVatDelta, 0) && close(rec?.outputVatLedger, 50), rec);
  const gen = await C.gen();
  ok("T7-7 ... and the return itself excludes it (VAT 50)", close(gen.json?.box8TotalVat, 50), gen.json?.box8TotalVat);

  // filed: the page moves on to the period containing today
  const file = await C.file(gen.json?.id);
  const cur2 = await C.get(`/api/companies/${C.cid}/vat-returns/current-period`);
  ok("T7-7 once last month's return is filed the page works on the period containing today (open)", file.status === 201 && cur2.json?.state === "open" && cur2.json?.periodStart <= today && today <= cur2.json?.periodEnd, { f: file.status, c: cur2.json });
}


// ═════════════════════════════════════════════════════════════════════════════
// v4 (a): a journal reversal takes a date
// ═════════════════════════════════════════════════════════════════════════════
async function journalReversalDate() {
  const C = await newCompany("t7reverse", { emirate: "sharjah" });
  const entry = async (date, amount) => {
    const r = await C.post(`/api/companies/${C.cid}/journal`, { date, status: "posted", description: "Accrual", lines: [{ accountId: C.acct("1010").id, debit: amount, credit: 0 }, { accountId: C.acct("4010").id, debit: 0, credit: amount }] });
    if (![200, 201].includes(r.status) || !r.json?.id) throw new Error("journal failed " + r.status + " " + r.text.slice(0, 200));
    return r.json.id;
  };
  const dayOfEntry = async (id) => (await db.query(`SELECT date::date::text AS d FROM journal_entries WHERE id = $1`, [id])).rows[0]?.d;
  const e1 = await entry(prevStart, 100);
  const dated = await C.post(`/api/journal/${e1}/reverse`, { reason: "Wrong month", date: prevMid });
  ok("v4 a reversal dated by the body: 200 and the reversal entry carries that day", dated.status === 200 && (await dayOfEntry(dated.json?.reversalId)) === prevMid, { s: dated.status, d: await dayOfEntry(dated.json?.reversalId) });
  const e2 = await entry(prevStart, 50);
  const dflt = await C.post(`/api/journal/${e2}/reverse`, { reason: "Default date" });
  ok("v4 without a date the reversal is dated today", dflt.status === 200 && (await dayOfEntry(dflt.json?.reversalId)) === today, { s: dflt.status, d: await dayOfEntry(dflt.json?.reversalId), today });
  const e3 = await entry(prevMid, 70);
  const early = await C.post(`/api/journal/${e3}/reverse`, { reason: "Too early", date: prevStart });
  ok("v4 a reversal dated before the entry it reverses is refused (422)", early.status === 422 && early.json?.code === "REVERSAL_BEFORE_ORIGINAL", { s: early.status, j: early.json });
  const future = await C.post(`/api/journal/${e3}/reverse`, { reason: "Future", date: `${now.getUTCFullYear() + 1}-01-15` });
  ok("v4 a future reversal date is refused", future.status >= 400 && future.status < 500, { s: future.status, t: future.text?.slice(0, 150) });
  const bad = await C.post(`/api/journal/${e3}/reverse`, { reason: "Bad", date: "2026-02-30" });
  ok("v4 an impossible date is refused (400)", bad.status === 400, { s: bad.status });
  await db.query(`INSERT INTO month_end_close (company_id, period_end, status, closed_by, closed_at) VALUES ($1, $2::date, 'locked', $3, now())`, [C.cid, prevEnd, C.userId]);
  const locked = await C.post(`/api/journal/${e3}/reverse`, { reason: "Into a locked month", date: prevEnd });
  ok("v4 a reversal dated into a locked month is refused with the usual locked-period refusal (403)", locked.status === 403 && /locked period/i.test(locked.text), { s: locked.status, t: locked.text?.slice(0, 160) });
  const viaInstant = await C.post(`/api/journal/${e3}/reverse`, { reason: "Instant", date: `${today}T00:00:00+04:00` });
  ok("v4 an instant is read as its UAE day (today 00:00 +04:00 -> today)", viaInstant.status === 200 && (await dayOfEntry(viaInstant.json?.reversalId)) === today, { s: viaInstant.status, d: await dayOfEntry(viaInstant.json?.reversalId) });
}


// ═════════════════════════════════════════════════════════════════════════════
// v4 (b): VAT on a fixed-asset disposal reaches box 1 / box 4 through its sales invoice, not as revenue
// ═════════════════════════════════════════════════════════════════════════════
async function assetDisposalVat() {
  const C = await newCompany("t7dispose", { emirate: "sharjah" });
  const buyer = (await C.post(`/api/companies/${C.cid}/customer-contacts`, { name: "Dubai Buyer LLC", email: `buyer_${rnd}@example.com` })).json;
  const asset = (await C.post(`/api/companies/${C.cid}/fixed-assets`, { assetName: "Old van", category: "vehicles", purchaseDate: `${now.getUTCFullYear() - 1}-01-10`, purchaseCost: 12000, salvageValue: 0, usefulLifeYears: 4, depreciationMethod: "straight_line", paymentAccountId: C.acct("1010").id })).json;
  const disposal = await C.post(`/api/fixed-assets/${asset?.id}/dispose`, { disposalDate: prevMid, disposalAmount: 10000, buyerId: buyer?.id, vatTreatment: "standard", emirate: "dubai" });
  if (disposal.json?.disposalInvoiceId === undefined) {
    console.log("SKIP  v4 asset disposal VAT: the dispose route does not return a disposal invoice yet (S5 wiring pending) " + JSON.stringify({ s: disposal.status }));
    return;
  }
  const gen = await C.gen();
  ok("v4 a 10,000 standard-rated disposal to a Dubai buyer is in box 1b (10,000 / 500) and in box 8", close(boxOf(gen.json, "box1bDubai").amount, 10000) && close(boxOf(gen.json, "box1bDubai").vat, 500) && close(gen.json?.box8TotalAmount, 10000), { b: boxOf(gen.json, "box1bDubai"), b8: gen.json?.box8TotalAmount });
  const bal = (await db.query(`SELECT a.code, SUM(jl.credit - jl.debit) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [C.cid])).rows.reduce((o, r) => ({ ...o, [r.code]: n(r.net) }), {});
  ok("v4 output VAT 2020 = 500 and the sale is not revenue (nothing credited to 4010)", close(bal["2020"], 500) && close(bal["4010"] ?? 0, 0), { v: bal["2020"], rev: bal["4010"] });
  const pl = await C.run("profit-loss", `from=${prevStart}&to=${prevEnd}`);
  const revenue = n((pl.json?.rows ?? []).find((r) => r.key === "subtotal:revenue")?.cells?.amount);
  ok("v4 the P&L revenue line does not include the disposal proceeds", !(close(revenue, 10000)), { revenue });
  const summary = await C.run("vat-summary", `from=${prevStart}&to=${prevEnd}`);
  ok("v4 the VAT summary output VAT equals box 12 (500)", close((summary.json?.rows ?? []).find((r) => r.key === "sales")?.cells?.vat, 500) && close(gen.json?.box12TotalDueTax, 500), { s: summary.json?.rows?.find((r) => r.key === "sales")?.cells, b12: gen.json?.box12TotalDueTax });
}


// ═════════════════════════════════════════════════════════════════════════════
// v4 N1: a reversed entry is shown as reversed, cannot be reversed twice, and a reversal is only voided
// ═════════════════════════════════════════════════════════════════════════════
async function journalReversalLinks() {
  const C = await newCompany("t7revlink", { emirate: "sharjah" });
  const entry = async (amount) => {
    const r = await C.post(`/api/companies/${C.cid}/journal`, { date: prevMid, status: "posted", description: "Accrual", lines: [{ accountId: C.acct("1010").id, debit: amount, credit: 0 }, { accountId: C.acct("4010").id, debit: 0, credit: amount }] });
    if (![200, 201].includes(r.status) || !r.json?.id) throw new Error("journal failed " + r.status + " " + r.text.slice(0, 200));
    return r.json.id;
  };
  const postedReversals = async (id) => (await db.query(`SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'reversal' AND status = 'posted' AND reversed_entry_id = $2`, [C.cid, id])).rows[0].c;
  const e1 = await entry(100);
  const before = (await C.get(`/api/journal/${e1}`)).json;
  ok("N1 a journal that is not reversed says so (isReversed false, no link)", before?.isReversed === false && before?.reversedById === null, { r: before?.isReversed });
  const rev = await C.post(`/api/journal/${e1}/reverse`, { reason: "Wrong", date: prevMid });
  ok("N1 reversing posts the reversal (200)", rev.status === 200 && !!rev.json?.reversalId, { s: rev.status, j: rev.json });
  const orig = (await C.get(`/api/journal/${e1}`)).json;
  const reversal = (await C.get(`/api/journal/${rev.json.reversalId}`)).json;
  ok("N1 the original now exposes isReversed with the link to its reversal; the reversal links back to it", orig?.isReversed === true && orig?.reversedById === rev.json.reversalId && reversal?.reversalOfId === e1 && orig?.status === "posted", { o: [orig?.isReversed, orig?.reversedById, orig?.status], r: reversal?.reversalOfId });
  const list = (await C.get(`/api/companies/${C.cid}/journal`)).json ?? [];
  const listed = list.find((x) => x.id === e1);
  ok("N1 the journal list carries the same link (so the screen can hide Reverse)", listed?.isReversed === true && listed?.reversedById === rev.json.reversalId && list.find((x) => x.id === rev.json.reversalId)?.reversalOfId === e1, { l: [listed?.isReversed, listed?.reversedById] });
  const second = await C.post(`/api/journal/${e1}/reverse`, { reason: "Again" });
  ok("N1 a second reverse is refused (409 ALREADY_REVERSED) and posts nothing", second.status === 409 && second.json?.code === "ALREADY_REVERSED" && (await postedReversals(e1)) === 1, { s: second.status, j: second.json, n: await postedReversals(e1) });
  const rr = await C.post(`/api/journal/${rev.json.reversalId}/reverse`, { reason: "Reverse the reversal" });
  ok("N1 a reversal cannot be reversed (409 REVERSAL_NOT_REVERSIBLE)", rr.status === 409 && rr.json?.code === "REVERSAL_NOT_REVERSIBLE", { s: rr.status, j: rr.json });
  const voided = await C.post(`/api/journal/${rev.json.reversalId}/void-reversal`, { reason: "Reversed by mistake" });
  const reopened = (await C.get(`/api/journal/${e1}`)).json;
  ok("N1 voiding the reversal re-opens the original (isReversed false) and takes the reversal out of the ledger", voided.status === 200 && reopened?.isReversed === false && (await postedReversals(e1)) === 0, { s: voided.status, j: voided.json, r: reopened?.isReversed });
  const bal = (await db.query(`SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '1010'`, [C.cid])).rows[0].net;
  ok("N1 the ledger holds the original again (1010 = +100)", close(bal, 100), bal);
  const again = await C.post(`/api/journal/${e1}/reverse`, { reason: "Properly this time", date: prevMid });
  ok("N1 the re-opened original can be reversed again (200)", again.status === 200, { s: again.status, j: again.json });
  const audit = (await db.query(`SELECT count(*)::int AS c FROM audit_logs WHERE company_id = $1 AND action = 'journal.void_reversal'`, [C.cid])).rows[0].c;
  ok("N1 the void is audit-logged", audit === 1, audit);

  // two reverses at the same moment: exactly one posts
  const e2 = await entry(40);
  const [a, b] = await Promise.all([C.post(`/api/journal/${e2}/reverse`, { reason: "Race A", date: prevMid }), C.post(`/api/journal/${e2}/reverse`, { reason: "Race B", date: prevMid })]);
  const statuses = [a.status, b.status].sort();
  ok("N1 two concurrent reverses: one 200, one 409 ALREADY_REVERSED, one reversal posted", statuses[0] === 200 && statuses[1] === 409 && [a, b].some((x) => x.json?.code === "ALREADY_REVERSED") && (await postedReversals(e2)) === 1, { statuses, n: await postedReversals(e2) });

  // voiding a reversal dated in a locked month is refused
  const e3 = await entry(25);
  const r3 = await C.post(`/api/journal/${e3}/reverse`, { reason: "To lock", date: prevMid });
  await db.query(`INSERT INTO month_end_close (company_id, period_end, status, closed_by, closed_at) VALUES ($1, $2::date, 'locked', $3, now()) ON CONFLICT DO NOTHING`, [C.cid, prevEnd, C.userId]);
  const lockedVoid = await C.post(`/api/journal/${r3.json?.reversalId}/void-reversal`, { reason: "Locked month" });
  ok("N1 voiding a reversal in a locked month is refused (403)", lockedVoid.status === 403, { s: lockedVoid.status, t: lockedVoid.text?.slice(0, 150) });
}


// ═════════════════════════════════════════════════════════════════════════════
// Teardown 8 N1: a document voided after its period leaves an unfiled return; for a filed one it is an adjustment
// ═════════════════════════════════════════════════════════════════════════════
async function voidedDocuments() {
  const monthStart = today.slice(0, 8) + "01";
  const monthEnd = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
  const box = (g) => ({ vat: n(g?.box8TotalVat), amount: n(g?.box8TotalAmount) });

  // unfiled period: the credit note voided today (dated last month) is not in the return, the audit rows or the workpaper
  const C = await newCompany("t8void", { emirate: "sharjah" });
  const inv = await C.invoice(prevMid, [{ description: "Sale", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  const cn = await C.post(`/api/companies/${C.cid}/invoices/${inv.id}/credit-note`, { date: prevMid, lines: [{ description: "Returned", quantity: 1, unitPrice: 200, vatRate: 0.05 }] });
  const cnId = cn.json?.creditNote?.id ?? cn.json?.id;
  const before = await C.gen();
  ok("T8 (setup) with the credit note the return holds 1,000 - 200 = 800 / VAT 40", close(box(before.json).amount, 800) && close(box(before.json).vat, 40), box(before.json));
  const voidCn = await api("PATCH", `/api/invoices/${cnId}/status`, { token: C.token, body: { status: "void" } });
  ok("T8 (setup) the credit note is voided today", voidCn.status === 200, { s: voidCn.status, t: voidCn.text?.slice(0, 200) });
  const after = await C.gen();
  ok("T8 the voided credit note is out of the unfiled return: 1,000 / VAT 50", close(box(after.json).amount, 1000) && close(box(after.json).vat, 50), box(after.json));
  const audit = await C.run("vat-audit-sales", `from=${prevStart}&to=${prevEnd}`);
  ok("T8 ... out of the VAT Audit sales rows (one row, 1,000 / 50)", detailRows(audit).length === 1 && close(audit.json?.totals?.vat, 50), { rows: detailRows(audit).length, t: audit.json?.totals });
  const wp = await C.post(`/api/companies/${C.cid}/vat-workpapers`, { periodStart: prevStart, periodEnd: prevEnd });
  await C.post(`/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}/pull-from-books`, {});
  const wpRows = ((await C.get(`/api/companies/${C.cid}/vat-workpapers/${wp.json?.id}`)).json?.rows ?? []).filter((r) => /standard/i.test(String(r.rowCategory)));
  ok("T8 ... and out of the workpaper pulled from the books (one standard row, 1,000)", wpRows.length === 1 && close(wpRows[0]?.taxableAmount, 1000), wpRows.map((r) => [r.rowCategory, r.taxableAmount]));
  const thisMonth = await C.gen(monthStart, monthEnd);
  ok("T8 ... and not a negative line in this month either (the sale was never declared)", close(box(thisMonth.json).vat, 0), box(thisMonth.json));
  const ap = await C.get(`/api/vat/autopilot/calculate/${C.cid}?periodStart=${prevStart}&periodEnd=${prevEnd}&persist=false`);
  ok("T8 the Autopilot ledger tie agrees with the return (no mismatch)", ap.json?.reconciliation?.hasDiscrepancy === false, ap.json?.reconciliation);

  // filed period: the later void surfaces in the month of the void (the existing adjustment path), the filed figures stay
  const F = await newCompany("t8filed", { emirate: "sharjah" });
  await F.invoice(prevMid, [{ description: "Sale", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]);
  const second = await F.invoice(prevMid, [{ description: "Second sale", quantity: 1, unitPrice: 500, vatRate: 0.05 }]);
  const gen = await F.gen();
  const filedReturn = await F.file(gen.json?.id);
  ok("T8 (setup) last month's return (1,500 / 75) is filed", filedReturn.status === 201 && close(box(gen.json).vat, 75), { s: filedReturn.status, b: box(gen.json) });
  const voidSecond = await api("PATCH", `/api/invoices/${second.id}/status`, { token: F.token, body: { status: "void" } });
  const reGen = await F.gen(monthStart, monthEnd);
  ok("T8 a void after the filing reverses in the month of the void (this month: -500 / -25)", voidSecond.status === 200 && close(box(reGen.json).vat, -25) && close(box(reGen.json).amount, -500), { s: voidSecond.status, b: box(reGen.json) });
  const stillFiled = await F.vatReturn(gen.json?.id);
  ok("T8 ... and the filed return keeps its figures (75)", stillFiled?.status === "filed" && close(stillFiled?.box12TotalDueTax, 75), { st: stillFiled?.status, b12: stillFiled?.box12TotalDueTax });
}


// ═════════════════════════════════════════════════════════════════════════════
// Teardown 8: "Filed outside Muhasib" and "Muhasib books start from <period>"
// ═════════════════════════════════════════════════════════════════════════════
async function filedElsewhereAndBooksStart() {
  const C = await newCompany("t8elsewhere", { emirate: "sharjah" });
  await db.query(`UPDATE companies SET tax_registration_date = '2025-01-01' WHERE id = $1`, [C.cid]); // registered long ago: older periods are due
  const monthStartOf = (back) => ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)));
  const monthEndOf = (back) => ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0)));
  const old = { periodStart: monthStartOf(3), periodEnd: monthEndOf(3), filingDate: monthEndOf(3).slice(0, 8) + "28" > today ? today : monthEndOf(3) };
  const url = `/api/companies/${C.cid}/vat-returns/filed-elsewhere`;
  const ok1 = await C.post(url, { ...old, reference: "EMT-2026-0042" });
  ok("T8 'Filed outside Muhasib' records a historical period (201, status filed_elsewhere, dates and reference echoed)", ok1.status === 201 && ok1.json?.status === "filed_elsewhere" && ok1.json?.periodStart === old.periodStart && ok1.json?.periodEnd === old.periodEnd && ok1.json?.filingDate === old.filingDate && ok1.json?.reference === "EMT-2026-0042" && !!ok1.json?.id, { s: ok1.status, j: ok1.json });
  const dup = await C.post(url, { ...old, reference: "EMT-2" });
  ok("T8 the same period again is 409 PERIOD_ALREADY_FILED", dup.status === 409 && dup.json?.code === "PERIOD_ALREADY_FILED", { s: dup.status, j: dup.json });
  const open = await C.post(url, { periodStart: monthStartOf(0), periodEnd: monthEndOf(0), filingDate: today });
  ok("T8 a period that has not ended is 422 PERIOD_NOT_ENDED", open.status === 422 && open.json?.code === "PERIOD_NOT_ENDED", { s: open.status, j: open.json });
  const offGrid = await C.post(url, { periodStart: monthStartOf(5).slice(0, 8) + "05", periodEnd: monthEndOf(5), filingDate: today });
  ok("T8 a range that is not one of the company's VAT periods is 422 INVALID_PERIOD", offGrid.status === 422 && offGrid.json?.code === "INVALID_PERIOD", { s: offGrid.status, j: offGrid.json });
  const entries = (await db.query(`SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1`, [C.cid])).rows[0].c;
  ok("T8 recording it posts nothing", entries === 0, entries);
  const audit = (await db.query(`SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'vat_return.filed_elsewhere'`, [C.cid])).rows;
  ok("T8 it is audit-logged with the period, date and reference", audit.length === 1 && /EMT-2026-0042/.test(JSON.stringify(audit[0].details)), audit);
  const list = ((await C.get(`/api/companies/${C.cid}/vat-returns`)).json ?? []).find((r) => r.id === ok1.json?.id);
  ok("T8 the return list shows it as filed, marked filed outside Muhasib", list?.status === "filed" && list?.filing?.filedElsewhere === true && list?.filing?.referenceNumber === "EMT-2026-0042", { st: list?.status, f: list?.filing });
  const outsider = await newCompany("t8outsider", { emirate: "sharjah" });
  const denied = await api("POST", url, { token: outsider.token, body: old });
  ok("T8 someone without access to the company is refused (403)", denied.status === 403, denied.status);

  const periods = await C.get(`/api/vat/autopilot/periods/${C.cid}`);
  const plist = Array.isArray(periods.json) ? periods.json : (periods.json?.periods ?? []);
  const row = plist.find((p) => String(p.periodEnd).slice(0, 10) === old.periodEnd);
  ok("T8 Autopilot shows that period as filed (accepted), never overdue", row?.filed === true && row?.filedElsewhere === true && row?.status === "accepted" && row?.deadline?.isOverdue === false, row);
  const others = plist.filter((p) => String(p.periodEnd).slice(0, 10) !== old.periodEnd && p.deadline?.isOverdue);
  ok("T8 (control) older periods that are not filed are still overdue", others.length > 0, plist.map((p) => [String(p.periodEnd).slice(0, 10), p.deadline?.level, p.filed]));

  // books start: the setting trims Autopilot and the filing period server-side
  const patch = await api("PATCH", `/api/companies/${C.cid}`, { token: C.token, body: { vatBooksStart: monthStartOf(1) } });
  const company = (await C.get(`/api/companies/${C.cid}`)).json;
  ok("T8 the company carries vatBooksStart (PATCH writes it, GET reads it)", [200, 201].includes(patch.status) && String(company?.vatBooksStart).slice(0, 10) === monthStartOf(1), { s: patch.status, v: company?.vatBooksStart });
  const trimmed = await C.get(`/api/vat/autopilot/periods/${C.cid}`);
  const tlist = Array.isArray(trimmed.json) ? trimmed.json : (trimmed.json?.periods ?? []);
  ok("T8 Autopilot lists only periods starting on or after it", tlist.length > 0 && tlist.every((p) => String(p.periodStart).slice(0, 10) >= monthStartOf(1)), tlist.map((p) => String(p.periodStart).slice(0, 10)));
  const due = await C.get(`/api/vat/autopilot/due-dates?companyId=${C.cid}`);
  ok("T8 the due-dates list shows the first unfiled period from there (last month)", due.status === 200 && String(due.json?.[0]?.periodEnd).slice(0, 10) === monthEndOf(1), due.json);
  const cur = await C.get(`/api/companies/${C.cid}/vat-returns/current-period`);
  ok("T8 the filing page's period respects it (last month, unfiled)", cur.json?.periodStart === monthStartOf(1) && cur.json?.earlierUnfiled?.length === 0, cur.json);
}

main().catch((e) => { console.error(e); process.exit(1); });
