// End-to-end accounting flow against a real server + real Postgres.
// Builds a deterministic fixture ("Al Noor Trading LLC", Dubai) and asserts the
// exact VAT 201 figures, GL balance, financial statements, and tenant isolation.
//
// Fixture:
//   Invoice A: AED 10,000 standard-rated (5%)            -> VAT 500
//   Invoice B: AED 5,000 standard (5%) + AED 3,000 zero  -> VAT 250
//   Both issued.
// Expected VAT 201 (Dubai):
//   standard-rated supplies 15,000 ; output VAT 750 ; zero-rated 3,000
//   Box 8 output VAT 750 ; Box 12 due 750 ; Box 14 payable 750
// Expected P&L revenue: 18,000 (15,000 standard + 3,000 zero-rated)

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + " :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
};
async function api(method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 8) + "01";
const n = (v) => Number(v ?? 0);
const close = (a, b, t = 0.01) => Math.abs(n(a) - n(b)) <= t;

async function main() {
  // ── signup + company setup ─────────────────────────────────
  let r = await api("POST", "/api/auth/register", { body: { name: "Al Noor Owner", email: `alnoor_${rnd}@example.com`, password: "Password123!" } });
  ok("signup", r.status === 200 && !!r.json?.token, r.status);
  const token = r.json.token, companyId = r.json.company.id;

  r = await api("PATCH", `/api/companies/${companyId}`, { token, body: { name: "Al Noor Trading LLC", trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  ok("company: TRN + emirate set", r.status === 200 && r.json?.trnVatNumber === "100123456700003", { status: r.status });

  const accounts = (await api("GET", `/api/companies/${companyId}/accounts`, { token })).json;
  ok("chart of accounts seeded", Array.isArray(accounts) && accounts.length > 40, `count=${accounts?.length}`);

  // ── contact ────────────────────────────────────────────────
  r = await api("POST", `/api/companies/${companyId}/customer-contacts`, { token, body: { name: "Gulf Buyer LLC", trnNumber: "100999888700003", type: "customer" } });
  ok("contact: valid 15-digit TRN accepted", r.status === 200 || r.status === 201, { status: r.status });
  r = await api("POST", `/api/companies/${companyId}/customer-contacts`, { token, body: { name: "Bad TRN Co", trnNumber: "123", type: "customer" } });
  ok("contact: malformed TRN rejected (422)", r.status === 422 && r.json?.code === "INVALID_TRN", { status: r.status, code: r.json?.code });

  // ── invoices ───────────────────────────────────────────────
  r = await api("POST", `/api/companies/${companyId}/invoices`, {
    token, body: { customerName: "Gulf Buyer LLC", date: today, dueDate: today, lines: [{ description: "Consulting", quantity: 1, unitPrice: 10000, vatRate: 5 }] },
  });
  const invA = r.json;
  ok("invoice A: totals (10,000 net / 500 VAT / 10,500)", close(invA?.subtotal, 10000) && close(invA?.vatAmount, 500) && close(invA?.total, 10500), { s: invA?.subtotal, v: invA?.vatAmount, t: invA?.total });

  r = await api("POST", `/api/companies/${companyId}/invoices`, {
    token, body: { customerName: "Gulf Buyer LLC", date: today, dueDate: today, lines: [
      { description: "Services", quantity: 1, unitPrice: 5000, vatRate: 5 },
      { description: "Export", quantity: 1, unitPrice: 3000, vatRate: 0 },
    ] },
  });
  const invB = r.json;
  ok("invoice B: totals (8,000 net / 250 VAT / 8,250)", close(invB?.subtotal, 8000) && close(invB?.vatAmount, 250) && close(invB?.total, 8250), { s: invB?.subtotal, v: invB?.vatAmount, t: invB?.total });

  // draft must not hit the ledger
  let je = (await api("GET", `/api/companies/${companyId}/journal`, { token })).json;
  const jeCount0 = (Array.isArray(je) ? je : je?.entries || []).length;
  ok("GL: drafts do not post", jeCount0 === 0, `entries=${jeCount0}`);

  // issue both
  await api("PATCH", `/api/invoices/${invA.id}/status`, { token, body: { status: "sent" } });
  await api("PATCH", `/api/invoices/${invB.id}/status`, { token, body: { status: "sent" } });

  je = (await api("GET", `/api/companies/${companyId}/journal`, { token })).json;
  const entries = Array.isArray(je) ? je : je?.entries || [];
  ok("GL: issuing posts one entry per invoice", entries.length === 2, `entries=${entries.length}`);

  // each entry balanced
  let allBalanced = true, arTotal = 0;
  for (const e of entries) {
    const d = (await api("GET", `/api/journal/${e.id}`, { token })).json;
    const lines = d?.lines || [];
    const dr = lines.reduce((s, l) => s + n(l.debit), 0);
    const cr = lines.reduce((s, l) => s + n(l.credit), 0);
    if (!close(dr, cr)) allBalanced = false;
    arTotal += dr;
  }
  ok("GL: every journal entry is balanced (Dr=Cr)", allBalanced, { arTotal });
  ok("GL: AR debited = 18,750 total (10,500 + 8,250)", close(arTotal, 18750), { arTotal });

  // ── trial balance ──────────────────────────────────────────
  r = await api("GET", `/api/companies/${companyId}/reports/trial-balance`, { token });
  const rows = r.json?.rows || [];
  const tbDr = rows.reduce((s, x) => s + n(x.debit ?? x.totalDebit), 0);
  const tbCr = rows.reduce((s, x) => s + n(x.credit ?? x.totalCredit), 0);
  ok("report: trial balance balances", close(tbDr, tbCr, 0.02), { tbDr, tbCr });

  // ── P&L ────────────────────────────────────────────────────
  r = await api("GET", `/api/companies/${companyId}/financial-statements/profit-loss?startDate=${monthStart}&endDate=${today}`, { token });
  ok("report: P&L revenue = 18,000", close(r.json?.revenue, 18000), { revenue: r.json?.revenue });

  // ── balance sheet balances ─────────────────────────────────
  r = await api("GET", `/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${today}`, { token });
  const A = n(r.json?.assets?.total ?? r.json?.totalAssets);
  const L = n(r.json?.liabilities?.total ?? r.json?.totalLiabilities);
  const E = n(r.json?.equity?.total ?? r.json?.totalEquity);
  ok("report: balance sheet A = L + E", close(A, L + E, 0.02), { A, L, E });

  // ── VAT 201: exact figures ─────────────────────────────────
  r = await api("POST", `/api/companies/${companyId}/vat-returns/generate`, { token, body: { periodStart: monthStart, periodEnd: today } });
  const v = r.json;
  ok("VAT: generates", r.status === 200 || r.status === 201, { status: r.status });
  ok("VAT: Box 1 (Dubai) standard-rated = 15,000", close(v?.box1bDubaiAmount, 15000), { box1bDubaiAmount: v?.box1bDubaiAmount });
  ok("VAT: Box 1 (Dubai) output VAT = 750", close(v?.box1bDubaiVat, 750), { box1bDubaiVat: v?.box1bDubaiVat });
  ok("VAT: Box 4 zero-rated = 3,000", close(v?.box4ZeroRatedAmount, 3000), { box4: v?.box4ZeroRatedAmount });
  ok("VAT: Box 8 total output VAT = 750", close(v?.box8TotalVat, 750), { box8TotalVat: v?.box8TotalVat });
  ok("VAT: Box 12 total due tax = 750", close(v?.box12TotalDueTax, 750), { box12: v?.box12TotalDueTax });
  ok("VAT: Box 14 payable = 750 (no input VAT)", close(v?.box14PayableTax, 750), { box14: v?.box14PayableTax });

  // VAT output VAT must reconcile with the GL VAT Payable (2020) credit balance
  const bs = (await api("GET", `/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${today}`, { token })).json;
  const vatLiab = (bs?.liabilities?.breakdown || []).find((x) => x.accountCode === "2020");
  ok("VAT: output VAT (750) ties to GL VAT Payable balance", close(vatLiab?.amount, 750), { glVat: vatLiab?.amount });

  // ── Input VAT: foreign-currency receipts must convert to AED ───
  // Regression guard. Receipts were summed at DOCUMENT-currency face value
  // while invoice lines and vendor bills were FX-converted, so a USD expense
  // under-claimed input VAT ~3.67x and the business overpaid the FTA.
  {
    const s = Math.random().toString(36).slice(2, 8);
    const reg = await api("POST", "/api/auth/register", { body: { name: "FX Input", email: `fx_${s}@example.com`, password: "Password123!" } });
    const tk = reg.json.token, cid = reg.json.company.id;
    await api("PATCH", `/api/companies/${cid}`, { token: tk, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
    const accs = (await api("GET", `/api/companies/${cid}/accounts`, { token: tk })).json;
    const expenseAcct = accs.find((a) => a.code === "5000") || accs.find((a) => a.type === "expense");
    const payAcct = accs.find((a) => a.code === "1020");

    // USD 1,000 net + USD 50 VAT at 3.6725 -> AED 3,672.50 base, AED 183.63 VAT
    const mk = await api("POST", `/api/companies/${cid}/receipts`, {
      token: tk,
      body: {
        merchant: "US Supplier", date: today, amount: 1000, vatAmount: 50,
        currency: "USD", exchangeRate: 3.6725, baseCurrencyAmount: 3672.5,
        category: "software", accountId: expenseAcct?.id, paymentAccountId: payAcct?.id,
      },
    });
    ok("FX receipt created", mk.status === 200 || mk.status === 201, { status: mk.status, msg: mk.json?.message });

    if (mk.json?.id) {
      const posted = await api("POST", `/api/receipts/${mk.json.id}/post`, {
        token: tk, body: { accountId: expenseAcct?.id, paymentAccountId: payAcct?.id },
      });
      ok("FX receipt posts to the GL", posted.status === 200 || posted.status === 201, { status: posted.status, msg: posted.json?.message });

      const v = await api("POST", `/api/companies/${cid}/vat-returns/generate`, {
        token: tk, body: { periodStart: monthStart, periodEnd: today },
      });
      ok("input VAT: Box 9 expenses converted to AED (3,672.50 not 1,000)",
        close(v.json?.box9ExpensesAmount, 3672.5, 0.02), { box9Amount: v.json?.box9ExpensesAmount });
      ok("input VAT: Box 9 VAT converted to AED (183.63 not 50)",
        close(v.json?.box9ExpensesVat, 183.63, 0.02), { box9Vat: v.json?.box9ExpensesVat });
      ok("input VAT: Box 13 recoverable reflects the AED figure",
        close(v.json?.box13RecoverableTax, 183.63, 0.02), { box13: v.json?.box13RecoverableTax });
    }
  }

  // ── H1: emirate must not be guessed ────────────────────────
  {
    const s = Math.random().toString(36).slice(2, 8);
    const reg = await api("POST", "/api/auth/register", { body: { name: "NoEmirate", email: `noem_${s}@example.com`, password: "Password123!" } });
    const tk = reg.json.token, cid = reg.json.company.id;
    // TRN set, emirate deliberately NOT set
    await api("PATCH", `/api/companies/${cid}`, { token: tk, body: { trnVatNumber: "100123456700003", vatRegistered: true } });
    const g = await api("POST", `/api/companies/${cid}/vat-returns/generate`, { token: tk, body: { periodStart: monthStart, periodEnd: today } });
    ok("H1 VAT 201 refuses when emirate is unset (no silent Dubai)", g.status === 422 && g.json?.code === "EMIRATE_NOT_SET", { status: g.status, code: g.json?.code });
    // once set, it generates
    await api("PATCH", `/api/companies/${cid}`, { token: tk, body: { emirate: "sharjah" } });
    const g2 = await api("POST", `/api/companies/${cid}/vat-returns/generate`, { token: tk, body: { periodStart: monthStart, periodEnd: today } });
    ok("H1 VAT 201 generates once the emirate is stated", g2.status === 200 || g2.status === 201, { status: g2.status });
  }

  // ── H2: filing status must be honest ───────────────────────
  {
    const gen = await api("POST", `/api/companies/${companyId}/vat-returns/generate`, { token, body: { periodStart: monthStart, periodEnd: today } });
    const id = gen.json?.id;
    // submit with no FTA reference -> finalised only, explicitly NOT transmitted
    const s1 = await api("POST", `/api/vat-returns/${id}/submit`, { token, body: { notes: "review" } });
    ok("H2 submit without an FTA reference does not claim to have filed",
      s1.status === 200 && s1.json?.status === "submitted" && s1.json?.filing?.transmittedByMuhasib === false,
      { status: s1.json?.status, filing: s1.json?.filing?.channel });
    ok("H2 response states Muhasib does not file with the FTA",
      /does NOT file|did not transmit/i.test(s1.json?.filing?.message || ""), { msg: s1.json?.filing?.message });
    // submit WITH a reference -> recorded as filed, still not transmitted by us
    const s2 = await api("POST", `/api/vat-returns/${id}/submit`, { token, body: { ftaReferenceNumber: "FTA-REF-99887766" } });
    ok("H2 an FTA reference promotes the return to filed",
      s2.status === 200 && s2.json?.status === "filed" && s2.json?.ftaReferenceNumber === "FTA-REF-99887766",
      { status: s2.json?.status, ref: s2.json?.ftaReferenceNumber });
    ok("H2 even when filed, we never claim Muhasib transmitted it",
      s2.json?.filing?.transmittedByMuhasib === false, { filing: s2.json?.filing });
  }

  // ── C7: PARTIAL credit notes must credit only what was asked ──
  // Was silently converting any partial request into a FULL credit note,
  // reversing all output VAT and under-declaring to the FTA.
  {
    const t = { token, cid: companyId };
    const invRes = await api("POST", `/api/companies/${t.cid}/invoices`, {
      token: t.token, body: { customerName: "Partial Co", date: today, dueDate: today, lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 5 }] },
    });
    ok("C7 setup: invoice created", invRes.status === 200 && !!invRes.json?.id, { status: invRes.status, body: JSON.stringify(invRes.json).slice(0, 200) });
    const inv = invRes.json;
    if (!inv?.id) throw new Error("C7 setup failed: " + invRes.status + " " + invRes.text.slice(0, 200));
    await api("PATCH", `/api/invoices/${inv.id}/status`, { token: t.token, body: { status: "sent" } });

    const cn = await api("POST", `/api/companies/${t.cid}/invoices/${inv.id}/credit-note`, {
      token: t.token, body: { reason: "partial return", lines: [{ description: "svc", quantity: 1, unitPrice: 400, vatRate: 5 }] },
    });
    ok("C7 partial credit note credits 400 not the whole 1,000",
      close(cn.json?.subtotal, -400) && close(cn.json?.vatAmount, -20) && close(cn.json?.total, -420),
      { subtotal: cn.json?.subtotal, vat: cn.json?.vatAmount, total: cn.json?.total });

    // a second partial that would exceed the remaining balance must be refused
    const over = await api("POST", `/api/companies/${t.cid}/invoices/${inv.id}/credit-note`, {
      token: t.token, body: { lines: [{ description: "svc", quantity: 1, unitPrice: 900, vatRate: 5 }] },
    });
    ok("C7 over-crediting is capped at the remaining balance",
      over.status === 409 && over.json?.code === "CREDIT_EXCEEDS_REMAINING", { status: over.status, code: over.json?.code });

    // full reversal (no lines) still works — the UI relies on it
    const inv2 = (await api("POST", `/api/companies/${t.cid}/invoices`, {
      token: t.token, body: { customerName: "Full Co", date: today, lines: [{ description: "svc", quantity: 1, unitPrice: 200, vatRate: 5 }] },
    })).json;
    await api("PATCH", `/api/invoices/${inv2.id}/status`, { token: t.token, body: { status: "sent" } });
    const full = await api("POST", `/api/companies/${t.cid}/invoices/${inv2.id}/credit-note`, { token: t.token, body: {} });
    ok("C7 omitting lines still performs a full reversal", close(full.json?.total, -210), { total: full.json?.total });
  }

  // ── C8: invoices cannot be dated in the future ────────────
  {
    const r = await api("POST", `/api/companies/${companyId}/invoices`, {
      token, body: { customerName: "Future", date: "2099-01-01", lines: [{ description: "d", quantity: 1, unitPrice: 10, vatRate: 5 }] },
    });
    ok("C8 future-dated invoice rejected", r.status === 422 && r.json?.code === "INVOICE_DATE_IN_FUTURE", { status: r.status, code: r.json?.code });
  }

  // ── C9: numeric overflow is a 422, not a 500 ──────────────
  {
    const r = await api("POST", `/api/companies/${companyId}/invoices`, {
      token, body: { customerName: "Huge", date: today, lines: [{ description: "d", quantity: 1e15, unitPrice: 1e15, vatRate: 5 }] },
    });
    ok("C9 absurd amount returns a clean 4xx (not 500)", r.status >= 400 && r.status < 500, { status: r.status, code: r.json?.code });
  }

  // ── C10: Small Business Relief ────────────────────────────
  {
    const s = Math.random().toString(36).slice(2, 8);
    const reg = await api("POST", "/api/auth/register", { body: { name: "SBR", email: `sbr_${s}@example.com`, password: "Password123!" } });
    if (reg.json?.token) {
      const tk = reg.json.token, cid = reg.json.company.id;
      await api("PATCH", `/api/companies/${cid}`, { token: tk, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
      const inv = (await api("POST", `/api/companies/${cid}/invoices`, { token: tk, body: { customerName: "C", date: today, lines: [{ description: "svc", quantity: 1, unitPrice: 1000000, vatRate: 0 }] } })).json;
      await api("PATCH", `/api/invoices/${inv.id}/status`, { token: tk, body: { status: "sent" } });
      const yStart = today.slice(0, 4) + "-01-01";
      const base = await api("GET", `/api/companies/${cid}/corporate-tax/calculate?periodStart=${yStart}&endDate=&periodEnd=${today}`, { token: tk });
      ok("C10 CT applies the AED 375,000 threshold (56,250 not 90,000)", close(base.json?.taxPayable, 56250, 1), { taxPayable: base.json?.taxPayable });
      ok("C10 Small Business Relief is reported and eligible at 1m revenue",
        base.json?.smallBusinessRelief?.eligible === true, { sbr: base.json?.smallBusinessRelief });
      const elected = await api("GET", `/api/companies/${cid}/corporate-tax/calculate?periodStart=${yStart}&periodEnd=${today}&sbrElected=true`, { token: tk });
      ok("C10 electing Small Business Relief yields 0 tax",
        elected.json?.taxPayable === 0 && elected.json?.smallBusinessRelief?.applied === true,
        { taxPayable: elected.json?.taxPayable, applied: elected.json?.smallBusinessRelief?.applied });
    }
  }

  // ── tenant isolation ───────────────────────────────────────
  const r2 = await api("POST", "/api/auth/register", { body: { name: "Other", email: `other_${rnd}@example.com`, password: "Password123!" } });
  const token2 = r2.json?.token;
  ok("tenant B registered", !!token2, r2.status);
  let x = await api("GET", `/api/companies/${companyId}/invoices`, { token: token2 });
  ok("SECURITY: tenant B cannot list tenant A invoices", x.status === 403 || x.status === 404, { status: x.status });
  x = await api("GET", `/api/invoices/${invA.id}`, { token: token2 });
  ok("SECURITY: tenant B cannot read tenant A invoice", x.status === 403 || x.status === 404, { status: x.status });
  x = await api("GET", `/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${today}`, { token: token2 });
  ok("SECURITY: tenant B cannot read tenant A balance sheet", x.status === 403 || x.status === 404, { status: x.status });
  x = await api("GET", `/api/companies/${companyId}/invoices`);
  ok("SECURITY: unauthenticated read blocked", x.status === 401, { status: x.status });

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error("CRASH", e); process.exit(2); });
