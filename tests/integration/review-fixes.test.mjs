// Integration tests for the adversarial-review fixes (VAT supply type, posted
// invoice edits, credit-note remainders, foreign-currency reversals, numeric
// limits, line normalisation, atomic credit notes).
// Drives real HTTP against a running server + Postgres.
//   BASE_URL=http://127.0.0.1:5056 node tests/integration/review-fixes.test.mjs
// The atomicity test also talks to Postgres directly (DATABASE_URL, default the
// local e2e database) to force a failure inside the journal insert.

import pg from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const DB_URL = process.env.DATABASE_URL;
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
const SQL_LEAK = /insert into|update "|select .* from|params:|failed query|\$1/i;

// A fresh company (own user) with the default chart.
async function freshCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token })).json;
  const byCode = (c) => accounts.find((a) => a.code === c);
  // net debit-minus-credit per account code, from the posted journal
  const balances = async () => {
    const j = (await api("GET", `/api/companies/${cid}/journal`, { token })).json ?? [];
    const out = {};
    for (const e of j) {
      if (e.status && e.status !== "posted") continue;
      for (const l of e.lines ?? []) {
        const code = l.account?.code;
        out[code] = Math.round(((out[code] ?? 0) + n(l.debit) - n(l.credit)) * 100) / 100;
      }
    }
    return out;
  };
  const mk = (extra) => api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "Review Co", date: today, ...extra } });
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });
  return { token, cid, byCode, balances, mk, issue };
}

async function main() {
  const AR = "1040", VAT = "2020", REV = "4010", SVC = "4020", ZERO = "4060";

  // ───────────────────────── Defect 1: the rate decides the supply type ─────────────────────────
  {
    const c = await freshCompany("d1");
    const now = new Date();
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const pStart = prevMonthStart.toISOString().slice(0, 10), pEnd = prevMonthEnd.toISOString().slice(0, 10);
    const midPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString().slice(0, 10);

    let r = await c.mk({ date: midPrev, lines: [{ description: "taxed but tagged exempt", quantity: 1, unitPrice: 1000, vatRate: 0.05, vatSupplyType: "exempt" }] });
    ok("D1: invoice 1000 @5% sent as exempt is accepted", r.status === 200, { s: r.status, m: r.json?.message });
    const inv = r.json;
    r = await api("GET", `/api/invoices/${inv.id}`, { token: c.token });
    ok("D1: stored line is standard_rated", r.json?.lines?.[0]?.vatSupplyType === "standard_rated", r.json?.lines);
    await c.issue(inv.id);
    const ret = await api("POST", `/api/companies/${c.cid}/vat-returns/generate`, { token: c.token, body: { periodStart: pStart, periodEnd: pEnd } });
    ok("D1: VAT 201 for the closed month generates", ret.status === 200 || ret.status === 201, { s: ret.status, m: ret.json?.message });
    ok("D1: VAT 201 shows 50 output VAT (Dubai box 1b)", close(ret.json?.box1bDubaiVat, 50) && close(ret.json?.box1bDubaiAmount, 1000), { vat: ret.json?.box1bDubaiVat, amt: ret.json?.box1bDubaiAmount });
    ok("D1: VAT 201 shows nothing in the exempt box for it", close(ret.json?.box5ExemptAmount ?? 0, 0), { exempt: ret.json?.box5ExemptAmount });
    const b = await c.balances();
    ok("D1: ledger VAT payable also 50 (return and ledger agree)", close(b[VAT], -50), b);

    // edit of a draft that was exempt @0% to 5%: the stale type must not survive
    r = await c.mk({ lines: [{ description: "rent", quantity: 1, unitPrice: 100, vatRate: 0, vatSupplyType: "exempt" }] });
    const draft = r.json;
    r = await api("GET", `/api/invoices/${draft.id}`, { token: c.token });
    ok("D1: 0% + exempt keeps exempt", r.json?.lines?.[0]?.vatSupplyType === "exempt", r.json?.lines);
    r = await api("PUT", `/api/invoices/${draft.id}`, { token: c.token, body: { customerName: "Review Co", date: today, lines: [{ description: "rent", quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "exempt" }] } });
    r = await api("GET", `/api/invoices/${draft.id}`, { token: c.token });
    ok("D1: edited to 5% with the stale exempt type -> standard_rated", r.json?.lines?.[0]?.vatSupplyType === "standard_rated", r.json?.lines);
    r = await c.mk({ lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 0, vatSupplyType: "standard_rated" }] });
    r = await api("GET", `/api/invoices/${r.json.id}`, { token: c.token });
    ok("D1: 0% + standard_rated -> zero_rated", r.json?.lines?.[0]?.vatSupplyType === "zero_rated", r.json?.lines);

    // quote -> invoice
    r = await api("POST", `/api/companies/${c.cid}/quotes`, { token: c.token, body: { customerName: "Q", date: today, lines: [{ description: "q", quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "exempt" }] } });
    const quote = r.json;
    ok("D1: quote line at 5% stored standard_rated", quote?.lines?.[0]?.vatSupplyType === "standard_rated", quote?.lines);
    r = await api("POST", `/api/quotes/${quote.id}/convert-to-invoice`, { token: c.token, body: {} });
    const conv = (await api("GET", `/api/invoices/${r.json?.invoice?.id}`, { token: c.token })).json;
    ok("D1: converted invoice line standard_rated", conv?.lines?.[0]?.vatSupplyType === "standard_rated", conv?.lines);

    // recurring template normalises on save
    r = await api("POST", `/api/companies/${c.cid}/recurring-invoices`, { token: c.token, body: { customerName: "Rec", frequency: "monthly", startDate: today, lines: [{ description: "r", quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "exempt" }] } });
    const stored = JSON.parse(r.json?.linesJson ?? "[]");
    ok("D1: recurring template line at 5% stored standard_rated", stored[0]?.vatSupplyType === "standard_rated", stored);
  }

  // ───────────────────────── Defect 2: posted invoice, amounts per account ─────────────────────────
  {
    const c = await freshCompany("d2");
    const svc = c.byCode(SVC);
    const body = (a, b) => ({ customerName: "Review Co", date: today, lines: [
      { description: "A", quantity: 1, unitPrice: a, vatRate: 0.05, revenueAccountId: svc.id },
      { description: "B", quantity: 1, unitPrice: b, vatRate: 0.05 } ] });
    let r = await c.mk(body(100, 900).lines ? { lines: body(100, 900).lines } : {});
    const inv = r.json;
    await c.issue(inv.id);
    r = await api("PUT", `/api/invoices/${inv.id}`, { token: c.token, body: body(900, 100) });
    ok("D2: swapping amounts between revenue accounts on a posted invoice is refused (422)", r.status === 422 && r.json?.code === "INVOICE_POSTED_REVENUE_ACCOUNT_LOCKED", { s: r.status, j: r.json });
    r = await api("PUT", `/api/invoices/${inv.id}`, { token: c.token, body: { customerName: "Renamed", date: today, lines: [
      { description: "B", quantity: 9, unitPrice: 100, vatRate: 0.05 },
      { description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: svc.id } ] } });
    ok("D2: an edit that keeps every account amount is still allowed", r.status === 200, { s: r.status, j: r.json });
    r = await api("PUT", `/api/invoices/${inv.id}`, { token: c.token, body: { customerName: "Review Co", date: today, lines: [
      { description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: svc.id },
      { description: "B", quantity: 1, unitPrice: 800, vatRate: 0.05 },
      { description: "C", quantity: 1, unitPrice: 100, vatRate: 0 } ] } });
    ok("D2: changing the VAT treatment / amounts of a posted invoice is refused", r.status === 422, { s: r.status, j: r.json?.code });
    r = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: c.token, body: { status: "void" } });
    ok("D2: void ok", r.status === 200, { s: r.status, j: r.json });
    const b = await c.balances();
    ok("D2: after void 4010 and 4020 are both exactly 0", close(b[REV], 0) && close(b[SVC], 0) && close(b[AR], 0) && close(b[VAT], 0), b);
  }

  // ───────────────────────── Defect 3: partial then full credit note ─────────────────────────
  {
    const c = await freshCompany("d3");
    const svc = c.byCode(SVC);
    let r = await c.mk({ lines: [
      { description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: svc.id },
      { description: "B", quantity: 1, unitPrice: 100, vatRate: 0.05 } ] });
    const inv = r.json;
    await c.issue(inv.id);
    const full = (await api("GET", `/api/invoices/${inv.id}`, { token: c.token })).json;
    const lineA = full.lines.find((l) => l.description === "A");
    // partial credit for A only, naming the original line id
    r = await api("POST", `/api/companies/${c.cid}/invoices/${inv.id}/credit-note`, { token: c.token, body: { lines: [{ description: "whatever the client typed", quantity: 1, unitPrice: 100, vatRate: 0.05, originalLineId: lineA.id }] } });
    ok("D3: partial credit note (by original line id) issued", r.status === 201, { s: r.status, j: r.json });
    let b = await c.balances();
    ok("D3: after the partial, 4020 is back to 0 and 4010 still holds 100", close(b[SVC], 0) && close(b[REV], -100), b);
    r = await api("POST", `/api/companies/${c.cid}/invoices/${inv.id}/credit-note`, { token: c.token, body: {} });
    ok("D3: full credit note after the partial issued", r.status === 201, { s: r.status, j: r.json });
    b = await c.balances();
    ok("D3: every account ends at exactly 0 (4020, 4010, VAT, AR)", close(b[SVC], 0) && close(b[REV], 0) && close(b[VAT], 0) && close(b[AR], 0), b);
    const cnLines = (await api("GET", `/api/invoices/${r.json.id}`, { token: c.token })).json?.lines ?? [];
    ok("D3: the capped credit note's document lines are the remaining B line only", cnLines.length === 1 && /B/.test(cnLines[0].description) && close(-cnLines[0].quantity * cnLines[0].unitPrice, 100), cnLines);
    r = await api("POST", `/api/companies/${c.cid}/invoices/${inv.id}/credit-note`, { token: c.token, body: {} });
    ok("D3: a further credit note is refused (fully credited)", r.status === 409, { s: r.status, j: r.json?.code });

    // unknown original line id
    const c2 = await freshCompany("d3b");
    r = await c2.mk({ lines: [{ description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05 }] });
    await c2.issue(r.json.id);
    r = await api("POST", `/api/companies/${c2.cid}/invoices/${r.json.id}/credit-note`, { token: c2.token, body: { lines: [{ description: "A", quantity: 1, unitPrice: 10, vatRate: 0.05, originalLineId: "00000000-0000-4000-8000-000000000000" }] } });
    ok("D3: an originalLineId that is not on the invoice is a 400", r.status === 400 && r.json?.code === "INVALID_ORIGINAL_LINE", { s: r.status, j: r.json });

    // description fallback (no id) still resolves the account
    const c3 = await freshCompany("d3c");
    const svc3 = c3.byCode(SVC);
    r = await c3.mk({ lines: [
      { description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: svc3.id },
      { description: "B", quantity: 1, unitPrice: 100, vatRate: 0.05 } ] });
    const inv3 = r.json;
    await c3.issue(inv3.id);
    await api("POST", `/api/companies/${c3.cid}/invoices/${inv3.id}/credit-note`, { token: c3.token, body: { lines: [{ description: "A", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
    await api("POST", `/api/companies/${c3.cid}/invoices/${inv3.id}/credit-note`, { token: c3.token, body: {} });
    b = await c3.balances();
    ok("D3: description-matched partial then full also ends every account at 0", close(b[SVC], 0) && close(b[REV], 0) && close(b[VAT], 0) && close(b[AR], 0), b);
  }

  // ───────────────────────── Defect 4: foreign-currency void / credit note ─────────────────────────
  {
    const usd = { currency: "USD", exchangeRate: 3.6725, lines: [{ description: "usd svc", quantity: 1, unitPrice: 100, vatRate: 0.05 }] };
    // (a) void
    let c = await freshCompany("d4a");
    let pre = await c.balances();
    let r = await c.mk(usd);
    ok("D4: USD invoice created", r.status === 200, { s: r.status, j: r.json?.message });
    const inv = r.json;
    await c.issue(inv.id);
    let b = await c.balances();
    ok("D4: posts AR 385.61 / revenue 367.25 / VAT 18.36 in AED", close(b[AR], 385.61) && close(b[REV], -367.25) && close(b[VAT], -18.36), b);
    r = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: c.token, body: { status: "void" } });
    ok("D4: void ok", r.status === 200, { s: r.status, j: r.json });
    b = await c.balances();
    ok("D4: void returns AR, revenue and VAT payable to their pre-invoice balances", close(b[AR] ?? 0, pre[AR] ?? 0) && close(b[REV] ?? 0, pre[REV] ?? 0) && close(b[VAT] ?? 0, pre[VAT] ?? 0), { b, pre });

    // (b) partial credit note 40 USD, then full credit note
    c = await freshCompany("d4b");
    pre = await c.balances();
    r = await c.mk(usd);
    const inv2 = r.json;
    await c.issue(inv2.id);
    r = await api("POST", `/api/companies/${c.cid}/invoices/${inv2.id}/credit-note`, { token: c.token, body: { lines: [{ description: "usd svc", quantity: 1, unitPrice: 40, vatRate: 0.05 }] } });
    ok("D4: partial credit note (USD 40) issued", r.status === 201, { s: r.status, j: r.json });
    const cn1 = r.json;
    ok("D4: the credit note stores the invoice's currency and rate", cn1?.currency === "USD" && close(cn1?.exchangeRate, 3.6725, 1e-6), { cur: cn1?.currency, rate: cn1?.exchangeRate });
    b = await c.balances();
    ok("D4: partial reverses AED amounts at the invoice rate (146.90 revenue)", close(b[REV], -367.25 + 146.9), b);
    r = await api("POST", `/api/companies/${c.cid}/invoices/${inv2.id}/credit-note`, { token: c.token, body: {} });
    ok("D4: final credit note issued", r.status === 201, { s: r.status, j: r.json });
    ok("D4: the final credit note stores the rate too", close(r.json?.exchangeRate, 3.6725, 1e-6), { rate: r.json?.exchangeRate });
    b = await c.balances();
    ok("D4: AR, revenue and VAT payable return to pre-invoice balances to the fils", close(b[AR] ?? 0, pre[AR] ?? 0, 0.001) && close(b[REV] ?? 0, pre[REV] ?? 0, 0.001) && close(b[VAT] ?? 0, pre[VAT] ?? 0, 0.001), { b, pre });
    const ret = await api("POST", `/api/companies/${c.cid}/vat-returns/generate`, { token: c.token, body: { periodStart: today.slice(0, 8) + "01", periodEnd: today } });
    ok("D4: VAT 201 nets the USD invoice and its credit notes to ~0 (credit notes converted at the stored rate)", close(ret.json?.box1bDubaiAmount ?? 0, 0, 0.05) && close(ret.json?.box1bDubaiVat ?? 0, 0, 0.05), { amt: ret.json?.box1bDubaiAmount, vat: ret.json?.box1bDubaiVat, s: ret.status });
  }

  // ───────────────────────── Defect 5: quantity overflow, no SQL leak ─────────────────────────
  {
    const c = await freshCompany("d5");
    let r = await c.mk({ lines: [{ description: "big", quantity: 2e11, unitPrice: 0.01, vatRate: 0.05 }] });
    ok("D5: quantity 2e11 is a 400, not a 500", r.status === 400, { s: r.status, t: r.text.slice(0, 200) });
    ok("D5: response has no SQL text or parameters", !SQL_LEAK.test(r.text), r.text.slice(0, 300));
    ok("D5: message names the quantity limit", /quantity is too large/i.test(r.text), r.text.slice(0, 300));
    r = await c.mk({ lines: [{ description: "big", quantity: 1, unitPrice: 1e13, vatRate: 0.05 }] });
    ok("D5: unit price 1e13 is a 400 with a clear message", r.status === 400 && /unit price is too large/i.test(r.text) && !SQL_LEAK.test(r.text), { s: r.status, t: r.text.slice(0, 200) });
    r = await c.mk({ lines: [{ description: "max", quantity: 9999999999.9999, unitPrice: 0.01, vatRate: 0 }] });
    ok("D5: the largest storable quantity is accepted", r.status === 200, { s: r.status, t: r.text.slice(0, 200) });
    r = await api("POST", `/api/companies/${c.cid}/quotes`, { token: c.token, body: { customerName: "Q", date: today, lines: [{ description: "big", quantity: 2e11, unitPrice: 0.01, vatRate: 0.05 }] } });
    ok("D5: quote with quantity 2e11 is a 400", r.status === 400 && !SQL_LEAK.test(r.text), { s: r.status, t: r.text.slice(0, 200) });
    const poBody = (q) => ({ number: "PO-" + rnd + "-" + q, vendorName: "S", date: today, lines: [{ description: "big", quantity: q, unitPrice: 0.01, vatRate: 0.05 }] });
    r = await api("POST", `/api/companies/${c.cid}/purchase-orders`, { token: c.token, body: poBody(2) });
    ok("D5: a normal purchase order is accepted", r.status === 201, { s: r.status, t: r.text.slice(0, 200) });
    r = await api("POST", `/api/companies/${c.cid}/purchase-orders`, { token: c.token, body: poBody(2e11) });
    ok("D5: purchase order with quantity 2e11 is a 400 (validation, not a DB error)", r.status === 400 && /quantity is too large/i.test(r.text) && !SQL_LEAK.test(r.text), { s: r.status, t: r.text.slice(0, 200) });
    r = await api("POST", `/api/companies/${c.cid}/recurring-invoices`, { token: c.token, body: { customerName: "R", frequency: "monthly", startDate: today, lines: [{ description: "big", quantity: 2e11, unitPrice: 0.01, vatRate: 0.05 }] } });
    ok("D5: recurring template with quantity 2e11 is a 400", r.status === 400 && !SQL_LEAK.test(r.text), { s: r.status, t: r.text.slice(0, 200) });
    r = await api("GET", `/api/invoices/not-a-uuid`, { token: c.token });
    ok("D5: a malformed id is a clean 4xx without SQL", r.status >= 400 && r.status < 500 && !SQL_LEAK.test(r.text), { s: r.status, t: r.text.slice(0, 200) });
  }

  // ───────────────────────── Defect 6: input normalised to stored precision ─────────────────────────
  {
    const c = await freshCompany("d6");
    let r = await c.mk({ lines: [{ description: "tiny price", quantity: 1000000, unitPrice: 0.0000005, vatRate: 0 }] });
    ok("D6: 1,000,000 x 0.0000005 accepted", r.status === 200, { s: r.status, t: r.text.slice(0, 200) });
    ok("D6: subtotal equals what is stored (1.00), not the unrounded 0.50", close(r.json?.subtotal, 1) && close(r.json?.total, 1), { sub: r.json?.subtotal, tot: r.json?.total });
    const stored = (await api("GET", `/api/invoices/${r.json.id}`, { token: c.token })).json?.lines?.[0];
    ok("D6: stored line is 1,000,000 x 0.000001", close(stored?.quantity, 1000000, 1e-6) && close(stored?.unitPrice, 0.000001, 1e-9), stored);
    ok("D6: stored line value matches the document subtotal", close(n(stored?.quantity) * n(stored?.unitPrice), n(r.json?.subtotal), 0.005), { stored, sub: r.json?.subtotal });
    r = await c.mk({ lines: [{ description: "rounds to zero", quantity: 1, unitPrice: 0.0000004, vatRate: 0 }] });
    ok("D6: a price that rounds to 0 is rejected", r.status === 400, { s: r.status });
  }

  // ───────────────────────── Defect 9: credit note and journal are atomic ─────────────────────────
  {
    const c = await freshCompany("d9");
    let r = await c.mk({ lines: [{ description: "atomic", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
    const inv = r.json;
    await c.issue(inv.id);
    const peek = async () => (await api("GET", `/api/companies/${c.cid}/invoices/next-number?docType=credit_note`, { token: c.token })).json?.number;
    const countCreditNotes = async () => ((await api("GET", `/api/companies/${c.cid}/invoices`, { token: c.token })).json ?? []).filter((i) => i.invoiceType === "credit_note").length;
    const numberBefore = await peek();

    const client = new pg.Client({ connectionString: DB_URL });
    let connected = false;
    try { await client.connect(); connected = true; } catch (e) { console.log("SKIP  D9: cannot reach Postgres at DATABASE_URL (" + e.message + ")"); }
    if (connected) {
      const fn = "review_fixes_block_cn_je_" + rnd;
      try {
        await client.query(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
          IF NEW.reversal_reason = 'Credit note issued' AND NEW.company_id = '${c.cid}' THEN RAISE EXCEPTION 'forced failure'; END IF;
          RETURN NEW; END $$ LANGUAGE plpgsql`);
        await client.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
        r = await api("POST", `/api/companies/${c.cid}/invoices/${inv.id}/credit-note`, { token: c.token, body: {} });
        ok("D9: a journal failure fails the credit note request", r.status >= 400, { s: r.status });
        ok("D9: the failure does not leak SQL", !SQL_LEAK.test(r.text), r.text.slice(0, 300));
        ok("D9: no credit note row remains", (await countCreditNotes()) === 0, {});
        ok("D9: no credit-note number was consumed", (await peek()) === numberBefore, { before: numberBefore, after: await peek() });
      } finally {
        await client.query(`DROP TRIGGER IF EXISTS ${fn} ON journal_entries`).catch(() => {});
        await client.query(`DROP FUNCTION IF EXISTS ${fn}()`).catch(() => {});
        await client.end();
      }
      r = await api("POST", `/api/companies/${c.cid}/invoices/${inv.id}/credit-note`, { token: c.token, body: {} });
      ok("D9: once the fault is gone the credit note is issued with the number that was never burned", r.status === 201 && r.json?.number === numberBefore, { s: r.status, num: r.json?.number, expected: numberBefore });
      const b = await c.balances();
      ok("D9: and its journal entry exists (accounts back to 0)", close(b[AR], 0) && close(b[REV], 0) && close(b[VAT], 0), b);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(fails.join("\n")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
