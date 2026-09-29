// Integration tests for the exchange-rate tenancy + direction fix:
//   * a rate entered by one company is never used by another company
//   * "1 CHF = 4.1 AED" is stored and looked up as CHF->AED 4.1 (not reversed)
//   * the inverse entry "1 AED = 0.25 CHF" is honoured (CHF->AED 4)
//   * bad input is rejected with 400
//   * quote -> invoice conversion uses the company's own rate
//   * the API can never touch system rows or another company's rows
// Drives real HTTP against a running server + Postgres.
//   BASE_URL=http://127.0.0.1:5057 node tests/integration/review-fixes-4.test.mjs

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

async function freshCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const addRate = (body) => api("POST", `/api/companies/${cid}/exchange-rates`, { token, body });
  const chfInvoice = (extra = {}) => api("POST", `/api/companies/${cid}/invoices`, {
    token,
    body: { customerName: "Swiss Co", date: today, currency: "CHF", lines: [{ description: "svc", quantity: 1, unitPrice: 100, vatRate: 0.05 }], ...extra },
  });
  return { token, cid, addRate, chfInvoice };
}

async function main() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    // leftovers from earlier runs of this file
    await db.query("DELETE FROM exchange_rates WHERE company_id IS NULL AND base_currency IN ('SEK','NOK') AND target_currency = 'AED'");

    // ───────── A enters 1 CHF = 4.1 AED; A's invoice uses it ─────────
    const A = await freshCompany("fxa");
    const B = await freshCompany("fxb");
    const DIST = 4.123457; // distinctive so a leak is unmistakable
    let r = await A.addRate({ fromCurrency: "CHF", toCurrency: "AED", rate: 4.1, effectiveDate: ymd(-5) });
    ok("A: '1 CHF = 4.1 AED' accepted (201)", r.status === 201, { s: r.status, j: r.json });
    ok("A: response echoes the same direction", r.json?.fromCurrency === "CHF" && r.json?.toCurrency === "AED" && close(r.json?.rate, 4.1, 1e-9) && r.json?.scope === "company", r.json);
    const stored = (await db.query("SELECT base_currency, target_currency, rate::float8 AS rate, company_id, is_trusted FROM exchange_rates WHERE id = $1", [r.json?.id])).rows[0];
    ok("A: stored as base=CHF target=AED, company-scoped, trusted", stored?.base_currency === "CHF" && stored?.target_currency === "AED" && close(stored?.rate, 4.1, 1e-9) && stored?.company_id === A.cid && stored?.is_trusted === true, stored);

    r = await A.chfInvoice();
    ok("A: CHF invoice with no explicit rate is created", r.status === 201 || r.status === 200, { s: r.status, j: r.json });
    ok("A: booked at 4.1", close(r.json?.exchangeRate, 4.1, 1e-6), { rate: r.json?.exchangeRate });
    ok("A: AED total = 105 x 4.1 = 430.50", close(r.json?.baseCurrencyAmount, 430.5), { base: r.json?.baseCurrencyAmount, total: r.json?.total });

    // ───────── B never sees A's rate ─────────
    r = await A.addRate({ fromCurrency: "CHF", toCurrency: "AED", rate: DIST, effectiveDate: today });
    ok("A: a newer distinctive rate 4.123457 recorded", r.status === 201, { s: r.status, j: r.json });
    const distId = r.json?.id;
    r = await A.chfInvoice();
    ok("A: next CHF invoice uses A's newest rate", close(r.json?.exchangeRate, DIST, 1e-6), { rate: r.json?.exchangeRate });
    r = await B.chfInvoice();
    ok("B: CHF invoice does NOT pick up A's rate (422 NO_EXCHANGE_RATE)", r.status === 422 && r.json?.code === "NO_EXCHANGE_RATE", { s: r.status, j: r.json });
    ok("B: nothing was booked at A's rate", !close(r.json?.exchangeRate, DIST, 1e-4), r.json);
    r = await api("GET", `/api/companies/${B.cid}/exchange-rates`, { token: B.token });
    ok("B: rates list does not contain A's rows", r.status === 200 && Array.isArray(r.json) && !r.json.some((x) => x.id === distId || close(x.rate, DIST, 1e-6)), { s: r.status, n: r.json?.length });
    r = await api("GET", `/api/companies/${B.cid}/exchange-rates/convert?from=CHF&to=AED&amount=10`, { token: B.token });
    ok("B: converter finds no CHF rate (404)", r.status === 404, { s: r.status, j: r.json });
    r = await api("GET", `/api/companies/${A.cid}/exchange-rates`, { token: B.token });
    ok("B: cannot list A's rates through A's URL (403)", r.status === 403, { s: r.status });

    // ───────── B cannot read / update / delete A's row by id ─────────
    r = await api("GET", `/api/companies/${B.cid}/exchange-rates/${distId}`, { token: B.token });
    ok("B: GET A's rate by id -> 404", r.status === 404 || r.status === 403, { s: r.status });
    r = await api("PUT", `/api/companies/${B.cid}/exchange-rates/${distId}`, { token: B.token, body: { fromCurrency: "CHF", toCurrency: "AED", rate: 9, effectiveDate: today } });
    ok("B: PUT A's rate by id -> 404", r.status === 404 || r.status === 403, { s: r.status });
    r = await api("DELETE", `/api/companies/${B.cid}/exchange-rates/${distId}`, { token: B.token });
    ok("B: DELETE A's rate by id -> 404", r.status === 404 || r.status === 403, { s: r.status });
    r = await api("PUT", `/api/companies/${A.cid}/exchange-rates/${distId}`, { token: B.token, body: { fromCurrency: "CHF", toCurrency: "AED", rate: 9, effectiveDate: today } });
    ok("B: PUT A's rate through A's URL -> 403", r.status === 403, { s: r.status });
    r = await api("DELETE", `/api/companies/${A.cid}/exchange-rates/${distId}`, { token: B.token });
    ok("B: DELETE A's rate through A's URL -> 403", r.status === 403, { s: r.status });
    const after = (await db.query("SELECT rate::float8 AS rate, company_id FROM exchange_rates WHERE id = $1", [distId])).rows[0];
    ok("A's row is unchanged after B's attempts", after && close(after.rate, DIST, 1e-9) && after.company_id === A.cid, after);

    // ───────── A can edit and delete its own row ─────────
    r = await A.addRate({ fromCurrency: "CHF", toCurrency: "AED", rate: 4.2, effectiveDate: today });
    ok("A: same pair + same day twice -> 409 (edit the existing rate instead)", r.status === 409, { s: r.status, j: r.json });
    r = await api("PUT", `/api/companies/${A.cid}/exchange-rates/${distId}`, { token: A.token, body: { fromCurrency: "CHF", toCurrency: "AED", rate: 4.3, effectiveDate: today } });
    ok("A: PUT own rate -> 200 and value changed", r.status === 200 && close(r.json?.rate, 4.3, 1e-9), { s: r.status, j: r.json });
    r = await A.chfInvoice();
    ok("A: next invoice uses the edited rate 4.3", close(r.json?.exchangeRate, 4.3, 1e-6), { rate: r.json?.exchangeRate });
    r = await api("DELETE", `/api/companies/${A.cid}/exchange-rates/${distId}`, { token: A.token });
    ok("A: DELETE own rate -> 200/204", r.status === 200 || r.status === 204, { s: r.status });
    r = await A.chfInvoice();
    ok("A: after deleting the newer rate the older 4.1 applies again", close(r.json?.exchangeRate, 4.1, 1e-6), { rate: r.json?.exchangeRate });

    // ───────── inverse entry: 1 AED = 0.25 CHF -> CHF invoice at 4.0 ─────────
    {
      const C = await freshCompany("fxc");
      r = await C.addRate({ fromCurrency: "AED", toCurrency: "CHF", rate: 0.25, effectiveDate: ymd(-1) });
      ok("C: '1 AED = 0.25 CHF' accepted", r.status === 201, { s: r.status, j: r.json });
      r = await C.chfInvoice();
      ok("C: CHF invoice with no explicit rate is booked at 4.0", close(r.json?.exchangeRate, 4, 1e-6), { s: r.status, rate: r.json?.exchangeRate, j: r.json?.message });
      ok("C: AED total = 105 x 4 = 420", close(r.json?.baseCurrencyAmount, 420), { base: r.json?.baseCurrencyAmount });
      r = await api("GET", `/api/companies/${C.cid}/exchange-rates/convert?from=CHF&to=AED&amount=10`, { token: C.token });
      ok("C: converter CHF->AED 10 = 40 AED", r.status === 200 && close(r.json?.convertedAmount, 40) && close(r.json?.rate, 4, 1e-6), { s: r.status, j: r.json });
      r = await api("GET", `/api/companies/${C.cid}/exchange-rates/convert?from=AED&to=CHF&amount=40`, { token: C.token });
      ok("C: converter AED->CHF 40 = 10 CHF", r.status === 200 && close(r.json?.convertedAmount, 10), { s: r.status, j: r.json });
    }

    // ───────── bad input -> 400 ─────────
    {
      const D = await freshCompany("fxd");
      const bad = [
        ["rate 0", { fromCurrency: "CHF", toCurrency: "AED", rate: 0 }],
        ["negative rate", { fromCurrency: "CHF", toCurrency: "AED", rate: -3 }],
        ["NaN rate (string)", { fromCurrency: "CHF", toCurrency: "AED", rate: "NaN" }],
        ["null rate", { fromCurrency: "CHF", toCurrency: "AED", rate: null }],
        ["same currency both sides", { fromCurrency: "CHF", toCurrency: "CHF", rate: 1 }],
        ["AED to AED", { fromCurrency: "AED", toCurrency: "AED", rate: 1 }],
        ["absurdly large (1 CHF = 5,000,000 AED)", { fromCurrency: "CHF", toCurrency: "AED", rate: 5000000 }],
        ["absurdly small (1 CHF = 0.000001 AED)", { fromCurrency: "CHF", toCurrency: "AED", rate: 0.000001 }],
        ["unknown currency code", { fromCurrency: "QQZ", toCurrency: "AED", rate: 4 }],
        ["malformed currency code", { fromCurrency: "CH", toCurrency: "AED", rate: 4 }],
        ["cross rate not involving AED", { fromCurrency: "USD", toCurrency: "EUR", rate: 0.9 }],
        ["invalid date", { fromCurrency: "CHF", toCurrency: "AED", rate: 4, effectiveDate: "not-a-date" }],
      ];
      for (const [label, body] of bad) {
        r = await D.addRate(body);
        ok(`D: ${label} -> 400`, r.status === 400, { s: r.status, j: r.json });
      }
      const cnt = (await db.query("SELECT count(*)::int AS c FROM exchange_rates WHERE company_id = $1", [D.cid])).rows[0].c;
      ok("D: none of the rejected rates was stored", cnt === 0, { cnt });
    }

    // ───────── quote -> invoice conversion uses the company's own rate ─────────
    {
      const E = await freshCompany("fxe");
      const F = await freshCompany("fxf");
      r = await E.addRate({ fromCurrency: "CHF", toCurrency: "AED", rate: 4.1, effectiveDate: ymd(-2) });
      ok("E: rate recorded", r.status === 201, { s: r.status, j: r.json });
      const mkQuote = (co) => api("POST", `/api/companies/${co.cid}/quotes`, { token: co.token, body: { customerName: "Swiss Quote", date: today, currency: "CHF", lines: [{ description: "consulting", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
      let q = await mkQuote(E);
      ok("E: CHF quote created", q.status === 200 || q.status === 201, { s: q.status, j: q.json });
      r = await api("POST", `/api/quotes/${q.json?.id}/convert-to-invoice`, { token: E.token });
      ok("E: conversion succeeds", r.status === 200, { s: r.status, j: r.json });
      ok("E: converted invoice booked at E's rate 4.1 (AED 430.50)", close(r.json?.invoice?.exchangeRate, 4.1, 1e-6) && close(r.json?.invoice?.baseCurrencyAmount, 430.5), { inv: r.json?.invoice });
      q = await mkQuote(F);
      r = await api("POST", `/api/quotes/${q.json?.id}/convert-to-invoice`, { token: F.token });
      ok("F: conversion in CHF without a rate of its own is refused (422 NO_EXCHANGE_RATE)", r.status === 422 && r.json?.code === "NO_EXCHANGE_RATE", { s: r.status, j: r.json });
    }

    // ───────── FX revaluation report reads the same convention ─────────
    {
      const G = await freshCompany("fxg");
      let r0 = await G.addRate({ fromCurrency: "CHF", toCurrency: "AED", rate: 4.0, effectiveDate: ymd(-10) });
      ok("G: 4.0 recorded", r0.status === 201, { s: r0.status, j: r0.json });
      r0 = await G.chfInvoice();
      ok("G: invoice booked at 4.0", close(r0.json?.exchangeRate, 4.0, 1e-6), r0.json?.exchangeRate);
      // The FX report counts ISSUED documents only (a draft has never been posted): issue it first.
      r0 = await api("PATCH", `/api/invoices/${r0.json.id}/status`, { token: G.token, body: { status: "sent" } });
      ok("G: invoice issued", r0.status === 200, { s: r0.status, j: r0.json });
      r0 = await G.addRate({ fromCurrency: "CHF", toCurrency: "AED", rate: 4.4, effectiveDate: today });
      ok("G: 4.4 recorded for today", r0.status === 201, { s: r0.status, j: r0.json });
      r0 = await api("GET", `/api/companies/${G.cid}/reports/fx-gains-losses`, { token: G.token });
      const row = r0.json?.receivables?.[0];
      ok("G: FX report: current rate 4.4, unrealised gain = 105 x 0.4 = 42", r0.status === 200 && close(row?.currentRate, 4.4, 1e-6) && close(row?.unrealizedGainLoss, 42), { s: r0.status, row });
    }

    // ───────── system rows: visible to all, never writable through the API ─────────
    {
      const H = await freshCompany("fxh");
      const I = await freshCompany("fxi");
      const ins = (base, rate, trusted, cid = null) => db.query(
        "INSERT INTO exchange_rates (company_id, base_currency, target_currency, rate, date, source, is_trusted) VALUES ($1,$2,'AED',$3, now() - interval '3 days', 'fta', $4) RETURNING id",
        [cid, base, rate, trusted]);
      const sek = (await ins("SEK", 0.35, true)).rows[0].id;
      await ins("NOK", 0.34, false); // untrusted: must be ignored
      const inv = (co, cur) => api("POST", `/api/companies/${co.cid}/invoices`, { token: co.token, body: { customerName: "X", date: today, currency: cur, lines: [{ description: "svc", quantity: 1, unitPrice: 100, vatRate: 0.05 }] } });
      r = await inv(H, "SEK");
      ok("H: with no rate of its own a SEK invoice uses the system rate 0.35", close(r.json?.exchangeRate, 0.35, 1e-6), { s: r.status, j: r.json?.message, rate: r.json?.exchangeRate });
      r = await api("GET", `/api/companies/${H.cid}/exchange-rates`, { token: H.token });
      const sysRow = (r.json ?? []).find((x) => x.id === sek);
      ok("H: list includes the system row flagged scope=system", sysRow?.scope === "system", { sysRow });
      ok("H: list hides the untrusted row", !(r.json ?? []).some((x) => x.fromCurrency === "NOK"), r.json?.map?.((x) => x.fromCurrency));
      r = await inv(H, "NOK");
      ok("H: an untrusted (pre-existing) row is ignored -> 422 NO_EXCHANGE_RATE", r.status === 422 && r.json?.code === "NO_EXCHANGE_RATE", { s: r.status, j: r.json });
      r = await api("PUT", `/api/companies/${H.cid}/exchange-rates/${sek}`, { token: H.token, body: { fromCurrency: "SEK", toCurrency: "AED", rate: 9, effectiveDate: today } });
      ok("H: PUT a system row -> 404 (cannot modify)", r.status === 404 || r.status === 403, { s: r.status });
      r = await api("DELETE", `/api/companies/${H.cid}/exchange-rates/${sek}`, { token: H.token });
      ok("H: DELETE a system row -> 404 (cannot delete)", r.status === 404 || r.status === 403, { s: r.status });
      const sysAfter = (await db.query("SELECT rate::float8 AS rate FROM exchange_rates WHERE id = $1", [sek])).rows[0];
      ok("H: system row unchanged", sysAfter && close(sysAfter.rate, 0.35, 1e-9), sysAfter);
      // H's own rate overrides the system rate for H only
      r = await H.addRate({ fromCurrency: "SEK", toCurrency: "AED", rate: 0.4, effectiveDate: ymd(-4) });
      ok("H: own SEK rate recorded", r.status === 201, { s: r.status, j: r.json });
      r = await inv(H, "SEK");
      ok("H: own rate beats the (newer) system rate", close(r.json?.exchangeRate, 0.4, 1e-6), r.json?.exchangeRate);
      r = await inv(I, "SEK");
      ok("I: other company still gets the system rate", close(r.json?.exchangeRate, 0.35, 1e-6), r.json?.exchangeRate);
      // the legacy global endpoints cannot create system rows for ordinary users
      const before = (await db.query("SELECT count(*)::int AS c FROM exchange_rates WHERE company_id IS NULL")).rows[0].c;
      r = await api("POST", "/api/exchange-rates", { token: H.token, body: { baseCurrency: "CHF", targetCurrency: "AED", rate: 99, source: "fta" } });
      ok("H: POST /api/exchange-rates is not available to users", r.status >= 400 && r.status < 500, { s: r.status });
      r = await api("POST", "/api/exchange-rates/fta/bulk", { token: H.token, body: { baseCurrency: "CHF", rates: [{ targetCurrency: "AED", rate: 99, date: today }] } });
      ok("H: POST /api/exchange-rates/fta/bulk is refused for a non-admin (403)", r.status === 403, { s: r.status });
      const afterCnt = (await db.query("SELECT count(*)::int AS c FROM exchange_rates WHERE company_id IS NULL")).rows[0].c;
      ok("H: no system rows were created by those attempts", afterCnt === before, { before, afterCnt });
    }
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.map((f) => " - " + f).join("\n")); process.exit(1); }
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
