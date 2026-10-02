// Integration tests for the sixth round of review fixes (defects proved with live requests):
//   D1  a fully credited invoice is settled: no payment, no chasing, not in A/R; credited status
//   D2  FX revaluation posts (uuid source), counts posted/outstanding documents only, is idempotent
//   D3  recurring invoices in a foreign currency use the rate of the day (never 1); no rate = skipped
// Drives real HTTP against a running server + Postgres.
//   BASE_URL=http://127.0.0.1:5056 DATABASE_URL=... node tests/integration/review-fixes-6.test.mjs

import pg from "pg";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
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
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const today = ymd(0);
const n = (v) => Number(v ?? 0);
const close = (a, b, t = 0.005) => Math.abs(n(a) - n(b)) <= t;
const here = path.dirname(fileURLToPath(import.meta.url));

async function freshCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  const bank = accounts.find((a) => a.code === "1020");
  const mk = (extra) => api("POST", `/api/companies/${cid}/invoices`, {
    token,
    body: { customerName: "Credit Co", date: ymd(-45), dueDate: ymd(-15), lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }], ...extra },
  });
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });
  const get = async (id) => (await api("GET", `/api/invoices/${id}`, { token })).json;
  const creditNote = (invId, body = {}) => api("POST", `/api/companies/${cid}/invoices/${invId}/credit-note`, { token, body });
  const pay = (invId, amount, extra = {}) => api("POST", `/api/companies/${cid}/invoices/${invId}/payments`, { token, body: { amount, date: today, method: "cash", paymentAccountId: bank.id, ...extra } });
  const setStatus = (id, status, extra = {}) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status, ...extra } });
  const addRate = (body) => api("POST", `/api/companies/${cid}/exchange-rates`, { token, body });
  const aging = async () => (await api("GET", `/api/reports/${cid}/aging`, { token })).json ?? [];
  const arOpen = async () => (await aging()).filter((r) => r.type === "receivable").reduce((s, r) => s + n(r.total), 0);
  const stats = async () => (await api("GET", `/api/companies/${cid}/dashboard/stats`, { token })).json;
  const queueIds = async () => ((await api("GET", `/api/chasing/queue/${cid}`, { token })).json?.queue ?? []).map((q) => q.invoice.id);
  const overdueIds = async () => ((await api("GET", `/api/chasing/overdue/${cid}`, { token })).json?.rows ?? []).map((q) => q.invoice.id);
  return { token, cid, bank, mk, issue, get, creditNote, pay, setStatus, addRate, aging, arOpen, stats, queueIds, overdueIds };
}

async function main() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const ledger = async (cid) => {
    const rows = (await db.query(
      `SELECT a.code, SUM(l.debit)::float8 AS d, SUM(l.credit)::float8 AS c
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
        WHERE e.company_id = $1 AND e.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const r of rows) out[r.code] = Math.round((n(r.d) - n(r.c)) * 100) / 100;
    return out;
  };
  try {
    // ───────── D1a: full credit note -> credited, nothing outstanding ─────────
    {
      const c = await freshCompany("d1a");
      let r = await c.mk();
      const inv = r.json;
      await c.issue(inv.id);
      ok("D1a: overdue invoice 1050 is in the chasing queue and A/R before the credit note", (await c.queueIds()).includes(inv.id) && close(await c.arOpen(), 1050), { q: await c.queueIds(), ar: await c.arOpen() });
      r = await c.creditNote(inv.id);
      ok("D1a: full credit note issued", r.status === 201, { s: r.status, j: r.json });
      const cn = r.json;
      const after = await c.get(inv.id);
      ok("D1a: invoice status is 'credited'", after?.status === "credited", after?.status);
      ok("D1a: invoice carries outstandingAmount 0 and isFullyCredited", close(after?.outstandingAmount, 0) && after?.isFullyCredited === true, { o: after?.outstandingAmount, f: after?.isFullyCredited });
      const list = (await api("GET", `/api/companies/${c.cid}/invoices`, { token: c.token })).json ?? [];
      const row = list.find((x) => x.id === inv.id);
      ok("D1a: the invoice list exposes outstandingAmount / isFullyCredited too", row && close(row.outstandingAmount, 0) && row.isFullyCredited === true, row);

      r = await c.pay(inv.id, 50);
      ok("D1a: a payment of 50 is refused 409 INVOICE_NOTHING_OUTSTANDING", r.status === 409 && r.json?.code === "INVOICE_NOTHING_OUTSTANDING", { s: r.status, j: r.json });
      r = await c.setStatus(inv.id, "paid", { paymentAccountId: c.bank.id });
      ok("D1a: PATCH status paid is refused 400 STATUS_DERIVED (paid comes from payments)", r.status === 400 && r.json?.code === "STATUS_DERIVED", { s: r.status, j: r.json });
      const payRows = (await db.query("SELECT count(*)::int AS c FROM invoice_payments WHERE invoice_id = $1", [inv.id])).rows[0].c;
      ok("D1a: no payment row was written", payRows === 0, payRows);
      r = await c.setStatus(inv.id, "credited");
      ok("D1a: 'credited' cannot be set by hand (422)", r.status === 422 && r.json?.code === "CREDITED_IS_AUTOMATIC", { s: r.status, j: r.json });
      r = await c.setStatus(inv.id, "void");
      ok("D1a: voiding a credited invoice is refused (credit notes exist)", r.status >= 400 && r.status < 500 && (await c.get(inv.id))?.status === "credited", { s: r.status, j: r.json });

      ok("D1a: absent from the A/R aging report", close(await c.arOpen(), 0), await c.aging());
      const summ = (await api("GET", `/api/companies/${c.cid}/reports/balance-summaries`, { token: c.token })).json;
      ok("D1a: absent from the customer balance summary", (summ?.customers ?? []).length === 0, summ?.customers);
      ok("D1a: the chasing queue and overdue list do not contain it", !(await c.queueIds()).includes(inv.id) && !(await c.overdueIds()).includes(inv.id), { q: await c.queueIds(), o: await c.overdueIds() });
      const st = await c.stats();
      ok("D1a: dashboard outstanding is 0", close(st?.outstanding, 0) && Object.values(st?.arAging ?? {}).every((v) => close(v, 0)), { o: st?.outstanding, a: st?.arAging });
      const led = await ledger(c.cid);
      ok("D1a: ledger A/R is 0.00", close(led["1040"] ?? 0, 0), led);

      // voiding the credit note reopens the invoice
      r = await c.setStatus(cn.id, "void");
      ok("D1a: the credit note can be voided", r.status === 200, { s: r.status, j: r.json });
      const reopened = await c.get(inv.id);
      ok("D1a: voiding the credit note returns the invoice to 'sent' with 1050 outstanding", reopened?.status === "sent" && close(reopened?.outstandingAmount, 1050) && reopened?.isFullyCredited === false, { s: reopened?.status, o: reopened?.outstandingAmount });
      ok("D1a: it is back in A/R and in the chasing queue", close(await c.arOpen(), 1050) && (await c.queueIds()).includes(inv.id), { ar: await c.arOpen() });
      r = await c.pay(inv.id, 50);
      ok("D1a: a payment of 50 is accepted again", r.status === 201, { s: r.status, j: r.json });
    }

    // ───────── D1b: partial credit, then over-remainder and exact-remainder payments ─────────
    {
      const c = await freshCompany("d1b");
      let r = await c.mk();
      const inv = r.json;
      await c.issue(inv.id);
      r = await c.creditNote(inv.id, { lines: [{ description: "returned goods", quantity: 1, unitPrice: 400, vatRate: 0.05 }] });
      ok("D1b: partial credit note (net 400 + VAT = 420) accepted", r.status === 201, { s: r.status, j: r.json });
      let cur = await c.get(inv.id);
      ok("D1b: invoice stays open with 630 outstanding (not credited)", cur?.status === "sent" && close(cur?.outstandingAmount, 630) && cur?.isFullyCredited === false, { s: cur?.status, o: cur?.outstandingAmount });
      ok("D1b: A/R aging shows the net 630", close(await c.arOpen(), 630), await c.aging());
      ok("D1b: dashboard outstanding is the net 630", close((await c.stats())?.outstanding, 630), (await c.stats())?.outstanding);
      const q = ((await api("GET", `/api/chasing/overdue/${c.cid}`, { token: c.token })).json?.rows ?? []).find((x) => x.invoice.id === inv.id);
      ok("D1b: chasing shows the net 630, not 1050", q && close(q.outstanding, 630), q?.outstanding);
      r = await c.pay(inv.id, 700);
      ok("D1b: a payment above the remainder (700 > 630) is rejected 422", r.status === 422 && r.json?.code === "PAYMENT_EXCEEDS_BALANCE", { s: r.status, j: r.json });
      r = await c.pay(inv.id, 630);
      ok("D1b: a payment of exactly 630 is accepted", r.status === 201, { s: r.status, j: r.json });
      cur = await c.get(inv.id);
      ok("D1b: the invoice is settled: status paid, outstanding 0", cur?.status === "paid" && close(cur?.outstandingAmount, 0), { s: cur?.status, o: cur?.outstandingAmount });
      r = await c.pay(inv.id, 10);
      ok("D1b: nothing more can be paid (409)", r.status === 409 && r.json?.code === "INVOICE_NOTHING_OUTSTANDING", { s: r.status, j: r.json });
      const led = await ledger(c.cid);
      ok("D1b: ledger A/R is 0.00 (1050 - 420 - 630)", close(led["1040"] ?? 0, 0), led);
    }

    // ───────── D1c: status -> paid records only the true remainder ─────────
    {
      const c = await freshCompany("d1c");
      let r = await c.mk();
      const inv = r.json;
      await c.issue(inv.id);
      await c.creditNote(inv.id, { lines: [{ description: "returned goods", quantity: 1, unitPrice: 400, vatRate: 0.05 }] });
      r = await c.pay(inv.id, 630);
      ok("D1c: paying the remainder of a partly credited invoice works", r.status === 201, { s: r.status, j: r.json });
      const pays = (await db.query("SELECT amount::float8 AS a FROM invoice_payments WHERE invoice_id = $1", [inv.id])).rows;
      ok("D1c: exactly one payment of 630 (not 1050) was recorded", pays.length === 1 && close(pays[0].a, 630), pays);
      const led = await ledger(c.cid);
      ok("D1c: ledger A/R is 0.00 and cash is +630", close(led["1040"] ?? 0, 0) && close(led["1020"] ?? 0, 630), led);
    }

    // ───────── D1d: partly paid + credit to zero outstanding = settled (paid) ─────────
    {
      const c = await freshCompany("d1d");
      let r = await c.mk();
      const inv = r.json;
      await c.issue(inv.id);
      await c.pay(inv.id, 420);
      r = await c.creditNote(inv.id, { lines: [{ description: "rest returned", quantity: 1, unitPrice: 600, vatRate: 0.05 }] });
      ok("D1d: credit note for the unpaid remainder (630) accepted", r.status === 201, { s: r.status, j: r.json });
      const cur = await c.get(inv.id);
      ok("D1d: 420 paid + 630 credited = settled: status 'paid', outstanding 0", cur?.status === "paid" && close(cur?.outstandingAmount, 0), { s: cur?.status, o: cur?.outstandingAmount });
      ok("D1d: not in A/R aging", close(await c.arOpen(), 0), await c.aging());
      r = await c.pay(inv.id, 5);
      ok("D1d: no further payment (409)", r.status === 409, { s: r.status, j: r.json });
    }

    // ───────── D1e: bank matching cannot settle a credited invoice or overpay ─────────
    {
      const c = await freshCompany("d1e");
      let r = await api("POST", `/api/companies/${c.cid}/bank-accounts`, { token: c.token, body: { nameEn: "Recon", bankName: "Emirates NBD", currency: "AED", glAccountId: c.bank.id } });
      const bankAccountId = r.json?.id;
      const csv = ["Date,Description,Debit,Credit,Balance", `${ymd(-6)},DEPOSIT ONE,,1050.00,10000.00`, `${ymd(-5)},DEPOSIT TWO,,1050.00,11050.00`].join("\n");
      r = await api("POST", `/api/companies/${c.cid}/bank-statements/import`, { token: c.token, body: { bankAccountId, csvContent: csv } });
      ok("D1e: two bank deposits imported", r.status === 201 && n(r.json?.imported) === 2, { s: r.status, j: r.json });
      const unrec = (await api("GET", `/api/companies/${c.cid}/bank-statements/unreconciled?bankAccountId=${bankAccountId}`, { token: c.token })).json;
      const list = Array.isArray(unrec) ? unrec : unrec?.transactions ?? [];
      const one = list.find((t) => /ONE/.test(t.description)), two = list.find((t) => /TWO/.test(t.description));

      const credited = (await c.mk({ date: ymd(-9) })).json;
      await c.issue(credited.id);
      await c.creditNote(credited.id);
      r = await api("POST", `/api/companies/${c.cid}/bank-statements/${one?.id}/match`, { token: c.token, body: { matchedType: "invoice", matchedId: credited.id } });
      ok("D1e: matching a bank deposit to a fully credited invoice is refused 409", r.status === 409 && r.json?.code === "INVOICE_NOTHING_OUTSTANDING", { s: r.status, j: r.json });

      const partial = (await c.mk({ date: ymd(-9) })).json;
      await c.issue(partial.id);
      await c.creditNote(partial.id, { lines: [{ description: "returned goods", quantity: 1, unitPrice: 400, vatRate: 0.05 }] });
      r = await api("POST", `/api/companies/${c.cid}/bank-statements/${two?.id}/match`, { token: c.token, body: { matchedType: "invoice", matchedId: partial.id } });
      ok("D1e: a 1050 deposit matched to a partly credited invoice is accepted", r.status === 200, { s: r.status, j: r.json });
      const pays = (await db.query("SELECT amount::float8 AS a FROM invoice_payments WHERE invoice_id = $1", [partial.id])).rows;
      ok("D1e: only the outstanding 630 was applied, not the whole 1050", pays.length === 1 && close(pays[0].a, 630), pays);
      ok("D1e: the invoice is settled (paid)", (await c.get(partial.id))?.status === "paid", (await c.get(partial.id))?.status);
    }

    // ───────── D2: FX revaluation ─────────
    {
      const c = await freshCompany("d2a");
      let r = await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: ymd(-40) });
      ok("D2: booking rate recorded", r.status === 201, { s: r.status, j: r.json });
      const usd = (extra = {}) => c.mk({ currency: "USD", date: ymd(-30), dueDate: ymd(30), lines: [{ description: "consulting", quantity: 1, unitPrice: 100, vatRate: 0.05 }], ...extra });
      r = await usd();
      const inv = r.json;
      ok("D2: USD invoice booked at 3.6725", (r.status === 201 || r.status === 200) && close(inv?.exchangeRate, 3.6725, 1e-6), { s: r.status, rate: inv?.exchangeRate });
      await c.issue(inv.id);
      const draft = (await usd()).json; // never issued
      ok("D2: a second USD invoice exists as a draft", draft?.status === "draft", draft?.status);
      r = await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.70, effectiveDate: ymd(-5) });
      ok("D2: later company rate 3.70 recorded", r.status === 201, { s: r.status, j: r.json });

      const rep = (await api("GET", `/api/companies/${c.cid}/reports/fx-gains-losses`, { token: c.token })).json;
      ok("D2: FX report lists only the issued invoice (draft excluded)", rep?.receivables?.length === 1 && rep.receivables[0].entityId === inv.id, rep?.receivables?.map((x) => x.entityId));
      ok("D2: FX report unrealised gain = 105 x (3.70 - 3.6725) = 2.89", close(rep?.receivables?.[0]?.unrealizedGainLoss, 2.89), rep?.receivables?.[0]);

      const asOf = ymd(-2);
      const future = await api("POST", `/api/companies/${c.cid}/exchange-rates/revalue`, { token: c.token, body: { asOf: ymd(3) } });
      ok("D2: a future as-of date is rejected (422)", future.status === 422, { s: future.status, j: future.json });

      r = await api("POST", `/api/companies/${c.cid}/exchange-rates/revalue`, { token: c.token, body: { asOf } });
      ok("D2: revaluation posts (201) instead of 400 INVALID_IDENTIFIER", r.status === 201 && r.json?.posted === true, { s: r.status, j: r.json });
      const entries = (await db.query(
        `SELECT e.id, e.source, e.source_id, e.date::date::text AS d, e.status,
                COALESCE(SUM(l.debit),0)::float8 AS dr, COALESCE(SUM(l.credit),0)::float8 AS cr
           FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
          WHERE e.company_id = $1 AND e.source IN ('fx_revaluation','fx_revaluation_reversal')
          GROUP BY e.id ORDER BY e.source`, [c.cid])).rows;
      const reval = entries.find((e) => e.source === "fx_revaluation");
      const rev = entries.find((e) => e.source === "fx_revaluation_reversal");
      ok("D2: one revaluation entry dated the as-of date, balanced, status posted", entries.filter((e) => e.source === "fx_revaluation").length === 1 && reval?.d === asOf && reval?.status === "posted" && close(reval?.dr, reval?.cr) && close(reval?.dr, 2.89), entries);
      ok("D2: its source_id is NULL (a date is not a uuid)", reval && reval.source_id === null, reval);
      ok("D2: the auto-reversal is dated the next day and balanced", rev && rev.d === ymd(-1) && close(rev.dr, rev.cr), rev);
      const lines = (await db.query(
        `SELECT a.code, l.debit::float8 AS d, l.credit::float8 AS c FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1`, [reval?.id])).rows;
      const ar = lines.find((l) => l.code === "1040"), fx = lines.find((l) => l.code === "4090");
      ok("D2: Dr Accounts Receivable 2.89, Cr FX gain 2.89 (only the issued invoice counted)", ar && close(ar.d, 2.89) && close(ar.c, 0) && fx && close(fx.c, 2.89) && lines.length === 2, lines);

      const again = await api("POST", `/api/companies/${c.cid}/exchange-rates/revalue`, { token: c.token, body: { asOf } });
      ok("D2: running it again for the same date is refused 409 REVALUATION_ALREADY_POSTED", again.status === 409 && again.json?.code === "REVALUATION_ALREADY_POSTED", { s: again.status, j: again.json });
      const cnt = (await db.query("SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'fx_revaluation'", [c.cid])).rows[0].c;
      ok("D2: still exactly one revaluation entry", cnt === 1, cnt);
    }

    {
      // partially paid: only the outstanding USD is revalued (report + posting)
      const c = await freshCompany("d2b");
      await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: ymd(-40) });
      let r = await c.mk({ currency: "USD", date: ymd(-30), dueDate: ymd(30), lines: [{ description: "consulting", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
      const inv = r.json;
      await c.issue(inv.id);
      r = await c.pay(inv.id, 50, { exchangeRate: 3.6725, date: ymd(-4) });
      ok("D2b: 50 USD part-payment accepted", r.status === 201, { s: r.status, j: r.json });
      await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.70, effectiveDate: ymd(-5) });
      const rep = (await api("GET", `/api/companies/${c.cid}/reports/fx-gains-losses`, { token: c.token })).json;
      const row = rep?.receivables?.[0];
      ok("D2b: FX report counts the 55 USD outstanding, not 105", row && close(row.foreignAmount, 55) && close(row.unrealizedGainLoss, 1.51), row);
      r = await api("POST", `/api/companies/${c.cid}/exchange-rates/revalue`, { token: c.token, body: { asOf: ymd(-2) } });
      ok("D2b: revaluation posts the gain on the outstanding part only (1.51)", r.status === 201 && close(r.json?.netGainLoss, 1.51), { s: r.status, j: r.json });
    }

    {
      // a missing FX account gives a clear 422 naming it
      const c = await freshCompany("d2c");
      await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: ymd(-40) });
      const r0 = await c.mk({ currency: "USD", date: ymd(-30), dueDate: ymd(30), lines: [{ description: "consulting", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
      await c.issue(r0.json.id);
      await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.70, effectiveDate: ymd(-5) });
      await db.query("DELETE FROM accounts WHERE company_id = $1 AND code = '4090'", [c.cid]);
      const r = await api("POST", `/api/companies/${c.cid}/exchange-rates/revalue`, { token: c.token, body: { asOf: ymd(-2) } });
      ok("D2c: a missing FX gain account is a 422 naming account 4090", r.status === 422 && /4090/.test(r.json?.message ?? ""), { s: r.status, j: r.json });
      const cnt = (await db.query("SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source LIKE 'fx_revaluation%'", [c.cid])).rows[0].c;
      ok("D2c: nothing was posted", cnt === 0, cnt);
    }

    // ───────── D3: recurring invoices use the rate of the day ─────────
    {
      const c = await freshCompany("d3a");
      await c.addRate({ fromCurrency: "USD", toCurrency: "AED", rate: 3.6725, effectiveDate: ymd(-40) });
      const tpl = (currency, name) => api("POST", `/api/companies/${c.cid}/recurring-invoices`, {
        token: c.token,
        body: { customerName: name, currency, frequency: "monthly", startDate: ymd(-1), lines: [{ description: "retainer", quantity: 1, unitPrice: 100, vatRate: 0.05 }] },
      });
      const usdT = (await tpl("USD", "Rate Co")).json;
      const chfT = (await tpl("CHF", "No Rate Co")).json;
      const aedT = (await tpl("AED", "Home Co")).json;
      ok("D3: three templates created (USD with a rate, CHF without, AED)", usdT?.id && chfT?.id && aedT?.id, { usdT, chfT, aedT });

      const env = { ...process.env, SESSION_SECRET: crypto.randomBytes(24).toString("hex"), JWT_SECRET: crypto.randomBytes(24).toString("hex"), NODE_ENV: "development", LOG_LEVEL: "error" };
      const run = spawnSync("npx", ["tsx", path.join(here, "helpers", "run-recurring.ts"), c.cid], { env, encoding: "utf8", cwd: path.join(here, "..", "..") });
      ok("D3: the generator ran", run.status === 0 && /RESULT/.test(run.stdout), { status: run.status, out: run.stdout?.slice(-300), err: run.stderr?.slice(-500) });

      const invs = (await db.query("SELECT id, currency, exchange_rate::float8 AS rate, base_currency_amount::float8 AS base, total::float8 AS total, status FROM invoices WHERE company_id = $1", [c.cid])).rows;
      const usdInv = invs.find((i) => i.currency === "USD");
      ok("D3: the USD template generated an invoice at 3.6725 (not 1)", usdInv && close(usdInv.rate, 3.6725, 1e-6), invs);
      ok("D3: its AED base amount is 105 x 3.6725 = 385.61", usdInv && close(usdInv.base, 385.61) && close(usdInv.total, 105), usdInv);
      ok("D3: the CHF template (no rate) generated NO invoice", !invs.some((i) => i.currency === "CHF"), invs);
      ok("D3: the AED template still generated, at rate 1", invs.some((i) => i.currency === "AED" && close(i.rate, 1)), invs);
      const tpls = (await db.query("SELECT id, total_generated, next_run_date::date::text AS nrd FROM recurring_invoices WHERE company_id = $1", [c.cid])).rows;
      const chfRow = tpls.find((t) => t.id === chfT.id), usdRow = tpls.find((t) => t.id === usdT.id);
      ok("D3: the CHF template was left due (nothing generated, date not advanced)", chfRow && chfRow.total_generated === 0 && chfRow.nrd === ymd(-1), chfRow);
      ok("D3: the USD template advanced", usdRow && usdRow.total_generated === 1, usdRow);
      const led = await ledger(c.cid);
      ok("D3: the ledger holds the USD invoice in AED (A/R 385.61 + 105.00 AED invoice)", close(led["1040"] ?? 0, 385.61 + 105), led);
      const note = (await db.query("SELECT count(*)::int AS c FROM notifications WHERE company_id = $1 AND type = 'recurring_invoice_failed'", [c.cid])).rows[0].c;
      ok("D3: the failure was surfaced as a notification to the company", note >= 1, note);
    }
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.map((f) => " - " + f).join("\n")); process.exit(1); }
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
