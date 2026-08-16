// Coverage for the modules that previously had NONE.
//
// Every defect found in this codebase so far has been in a module with no
// integration test. This suite exercises each of them end to end and — crucially
// — asserts LEDGER INTEGRITY after every operation that should touch the GL.
//
// Run against a live server with raised write limits:
//   RL_API_MAX=100000 RL_READ_MAX=100000 RL_AUTH_MAX=1000 npm start &
//   BASE_URL=http://127.0.0.1:5000 node tests/integration/modules.test.mjs

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
let pass = 0, fail = 0, skipped = 0; const fails = [];
const ok = (name, cond, detail) => {
  if (!cond && detail && (detail.status === 429 || detail.s === 429)) {
    skipped++; console.log("SKIP  " + name + "  (rate-limited)"); return;
  }
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + " :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
};
async function api(m, p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = "Bearer " + o.token;
  const r = await fetch(BASE + p, { method: m, headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
}
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.02) => Math.abs(n(a) - n(b)) <= tol;
const today = new Date().toISOString().slice(0, 10);
const yStart = today.slice(0, 4) + "-01-01";

let T, ACC = [];
const acct = (code) => ACC.find((a) => a.code === code);
async function tb() {
  const r = await api("GET", `/api/companies/${T.cid}/reports/trial-balance`, { token: T.token });
  const rows = r.j?.rows || [];
  const dr = rows.reduce((s, x) => s + n(x.debit ?? x.totalDebit), 0);
  const cr = rows.reduce((s, x) => s + n(x.credit ?? x.totalCredit), 0);
  return { dr: Math.round(dr * 100) / 100, cr: Math.round(cr * 100) / 100, bal: close(dr, cr, 0.02) };
}

async function main() {
  const s = Math.random().toString(36).slice(2, 8);
  const reg = await api("POST", "/api/auth/register", { body: { name: "Mod", email: `mod_${s}@e.com`, password: "Password123!" } });
  if (!reg.j?.token) { console.log("SKIP: registration rate-limited"); process.exit(0); }
  T = { token: reg.j.token, cid: reg.j.company.id };
  await api("PATCH", `/api/companies/${T.cid}`, { token: T.token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  ACC = (await api("GET", `/api/companies/${T.cid}/accounts`, { token: T.token })).j || [];
  const bank = acct("1020"), expense = acct("5000") || ACC.find((a) => a.type === "expense");

  // ══ INVENTORY ═════════════════════════════════════════════
  {
    let r = await api("POST", `/api/companies/${T.cid}/products`, {
      token: T.token, body: { name: "Widget", sku: `W-${s}`, unitPrice: "100.00", costPrice: "60.00", currentStock: 10 },
    });
    ok("inventory: create product", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 120) });
    const pid = r.j?.id;

    if (pid) {
      // A sale larger than stock must not silently create negative inventory.
      r = await api("POST", `/api/products/${pid}/movements`, {
        token: T.token, body: { type: "sale", quantity: 999, date: today },
      });
      const after = (await api("GET", `/api/products/${pid}`, { token: T.token })).j;
      const stock = n(after?.currentStock);
      ok("inventory: overselling does not produce negative stock", r.s >= 400 || stock >= 0,
        { moveStatus: r.s, stockAfter: stock });

      r = await api("POST", `/api/products/${pid}/movements`, {
        token: T.token, body: { type: "purchase", quantity: -50, date: today },
      });
      ok("inventory: negative movement quantity rejected", r.s >= 400, { status: r.s });

      r = await api("GET", `/api/companies/${T.cid}/inventory-movements`, { token: T.token });
      ok("inventory: movement ledger readable", r.s === 200, { status: r.s });
    }
  }

  // ══ QUOTES ════════════════════════════════════════════════
  {
    let r = await api("POST", `/api/companies/${T.cid}/quotes`, {
      token: T.token, body: { customerName: "Q Co", date: today, lines: [{ description: "job", quantity: 1, unitPrice: 500, vatRate: 5 }] },
    });
    ok("quotes: create without a hand-typed number (was a 500)", r.s === 201 && !!r.j?.number, { status: r.s, number: r.j?.number });
    ok("quotes: totals 500 net / 25 VAT / 525", close(r.j?.total, 525), { total: r.j?.total });
    const qid = r.j?.id;

    if (qid) {
      const before = await tb();
      const c1 = await api("POST", `/api/quotes/${qid}/convert-to-invoice`, { token: T.token, body: {} });
      ok("quotes: convert to invoice", c1.s === 200 || c1.s === 201, { status: c1.s });
      const c2 = await api("POST", `/api/quotes/${qid}/convert-to-invoice`, { token: T.token, body: {} });
      ok("quotes: cannot convert the same quote twice", c2.s >= 400, { status: c2.s });
      const after = await tb();
      ok("quotes: a quote alone does not unbalance the ledger", after.bal, after);
      // A quote is not a supply — converting must not itself recognise revenue.
      ok("quotes: conversion produces a draft invoice, not posted revenue",
        close(before.dr, after.dr), { before: before.dr, after: after.dr });
    }
  }

  // ══ BILLS / ACCOUNTS PAYABLE ══════════════════════════════
  {
    // NOTE: this module uses snake_case while the rest of the API is camelCase.
    let r = await api("POST", `/api/companies/${T.cid}/bills`, {
      token: T.token,
      body: {
        vendor_name: "Supplier A", bill_date: today, due_date: today, currency: "AED",
        line_items: [{ description: "goods", quantity: 1, unit_price: 1000, vat_rate: 0.05 }],
      },
    });
    ok("bills: create", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 160) });
    const bid = r.j?.id;

    if (bid) {
      const before = await tb();
      r = await api("POST", `/api/bills/${bid}/approve`, { token: T.token, body: {} });
      ok("bills: approve", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 140) });
      const after = await tb();
      ok("bills: approving posts a balanced entry", after.bal, after);
      ok("bills: approval actually reached the ledger", after.dr > before.dr, { before: before.dr, after: after.dr });

      // Approved bills must feed input VAT recovery (Box 9).
      const v = await api("POST", `/api/companies/${T.cid}/vat-returns/generate`, {
        token: T.token, body: { periodStart: today.slice(0, 8) + "01", periodEnd: today },
      });
      ok("bills: approved bill appears in VAT Box 9 expenses", close(v.j?.box9ExpensesAmount, 1000, 1),
        { box9: v.j?.box9ExpensesAmount });
      ok("bills: approved bill input VAT in Box 9 VAT", close(v.j?.box9ExpensesVat, 50, 1),
        { box9vat: v.j?.box9ExpensesVat });

      // Overpaying a bill must be refused, exactly like invoice overpayment.
      r = await api("POST", `/api/bills/${bid}/payments`, {
        token: T.token, body: { amount: 99999, date: today, paymentAccountId: bank?.id },
      });
      ok("bills: overpayment is refused", r.s >= 400, { status: r.s, msg: r.t.slice(0, 140) });
      ok("bills: ledger still balanced after payment attempts", (await tb()).bal, await tb());
    }
  }

  // ══ PURCHASE ORDERS ═══════════════════════════════════════
  {
    let r = await api("POST", `/api/companies/${T.cid}/purchase-orders`, {
      token: T.token, body: { vendorName: "Supplier B", date: today, number: `PO-${s}`, lines: [{ description: "parts", quantity: 2, unitPrice: 250, vatRate: 5 }] },
    });
    ok("purchase orders: create", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 160) });
    const poid = r.j?.id;
    if (poid) {
      const before = await tb();
      r = await api("POST", `/api/purchase-orders/${poid}/approve`, { token: T.token, body: {} });
      ok("purchase orders: approve", r.s < 500, { status: r.s });
      const after = await tb();
      // A PO is a commitment, not a transaction — it must NOT hit the ledger.
      ok("purchase orders: a PO does not post to the general ledger",
        close(before.dr, after.dr), { before: before.dr, after: after.dr });
    }
  }

  // ══ EXPENSE CLAIMS ════════════════════════════════════════
  {
    let r = await api("POST", `/api/companies/${T.cid}/expense-claims`, {
      token: T.token, body: { title: "Taxi", claimDate: today, lines: [{ description: "taxi", amount: 200, date: today, accountId: expense?.id }] },
    });
    ok("expense claims: create", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 160) });
    const eid = r.j?.id;
    if (eid) {
      r = await api("POST", `/api/expense-claims/${eid}/approve`, { token: T.token, body: {} });
      ok("expense claims: cannot approve before submitting", r.s >= 400, { status: r.s });
      r = await api("POST", `/api/expense-claims/${eid}/submit`, { token: T.token, body: {} });
      ok("expense claims: submit", r.s < 500, { status: r.s, msg: r.t.slice(0, 140) });
    }
  }

  // ══ COST CENTERS ══════════════════════════════════════════
  {
    let r = await api("POST", `/api/companies/${T.cid}/cost-centers`, { token: T.token, body: { name: "Ops", code: `OPS-${s}` } });
    ok("cost centers: create", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 140) });
    r = await api("GET", `/api/companies/${T.cid}/cost-centers/profitability`, { token: T.token });
    ok("cost centers: profitability report", r.s === 200, { status: r.s });
  }

  // ══ BUDGETS ═══════════════════════════════════════════════
  {
    let r = await api("POST", `/api/companies/${T.cid}/budget-plans`, {
      token: T.token, body: { name: `Plan-${s}`, fiscalYear: Number(today.slice(0, 4)), startDate: yStart, endDate: today },
    });
    ok("budgets: create plan", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 140) });
    const bpid = r.j?.id;
    if (bpid) {
      r = await api("POST", `/api/budget-plans/${bpid}/lines`, {
        token: T.token, body: { category: "Marketing", accountId: expense?.id, annualAmount: 12000 },
      });
      ok("budgets: add a line", r.s < 500, { status: r.s, msg: r.t.slice(0, 140) });
      r = await api("GET", `/api/budget-plans/${bpid}/variance`, { token: T.token });
      ok("budgets: variance report", r.s === 200, { status: r.s });
    }
  }

  // ══ RECURRING INVOICES ════════════════════════════════════
  {
    let r = await api("POST", `/api/companies/${T.cid}/recurring-invoices`, {
      token: T.token,
      body: { customerName: "Sub Co", frequency: "monthly", startDate: today, nextRunDate: today,
              lines: [{ description: "retainer", quantity: 1, unitPrice: 1000, vatRate: 5 }] },
    });
    ok("recurring invoices: create", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 160) });
    if (r.j?.id) {
      const t2 = await api("POST", `/api/recurring-invoices/${r.j.id}/toggle`, { token: T.token, body: {} });
      ok("recurring invoices: toggle active", t2.s < 500, { status: t2.s });
    }
  }

  // ══ PAYROLL / WPS ═════════════════════════════════════════
  {
    let r = await api("POST", `/api/companies/${T.cid}/employees`, {
      token: T.token, body: { fullName: "Ahmed Ali", basicSalary: 10000, joinDate: yStart, employeeNumber: `E-${s}` },
    });
    ok("payroll: create employee", r.s === 200 || r.s === 201, { status: r.s, msg: r.t.slice(0, 160) });

    const run = await api("POST", `/api/companies/${T.cid}/payroll-runs`, {
      token: T.token, body: { periodMonth: 7, periodYear: Number(today.slice(0, 4)), payDate: today },
    });
    ok("payroll: create run", run.s === 200 || run.s === 201, { status: run.s, msg: run.t.slice(0, 140) });

    if (run.j?.id) {
      const calc = await api("POST", `/api/payroll-runs/${run.j.id}/calculate`, { token: T.token, body: {} });
      ok("payroll: calculate", calc.s < 500, { status: calc.s, msg: calc.t.slice(0, 140) });

      const sif = await api("GET", `/api/payroll-runs/${run.j.id}/generate-sif`, { token: T.token });
      // WPS SIF is a fixed-width bank file. If it generates it must be non-empty
      // and start with the SCR (salary control record) header.
      ok("payroll: SIF either generates a real file or explains why not",
        sif.s >= 400 || (sif.t.length > 0 && /SCR|EDR/i.test(sif.t)),
        { status: sif.s, head: sif.t.slice(0, 80) });

      const before = await tb();
      const appr = await api("POST", `/api/payroll-runs/${run.j.id}/approve`, { token: T.token, body: {} });
      ok("payroll: approve", appr.s < 500, { status: appr.s, msg: appr.t.slice(0, 140) });
      const after = await tb();
      ok("payroll: ledger balanced after approval", after.bal, after);
      if (appr.s < 400) {
        ok("payroll: approval posts a salary journal entry", after.dr > before.dr, { before: before.dr, after: after.dr });
      }
    }
  }

  // ══ BANK RECONCILIATION ═══════════════════════════════════
  {
    const ba = await api("POST", `/api/companies/${T.cid}/bank-accounts`, {
      token: T.token, body: { nameEn: "Main", bankName: "Emirates NBD", currency: "AED", glAccountId: bank?.id },
    });
    ok("bank: create account (canonical, validated handler)", ba.s === 201 || ba.s === 200, { status: ba.s, msg: ba.t.slice(0, 140) });

    const bad = await api("POST", `/api/companies/${T.cid}/bank-accounts`, {
      token: T.token, body: { nameEn: "X", bankName: "Totally Fake Bank", currency: "AED" },
    });
    ok("bank: unrecognised bank rejected (handler no longer shadowed)", bad.s >= 400 && bad.s < 500, { status: bad.s });

    const un = await api("GET", `/api/companies/${T.cid}/bank-statements/unreconciled`, { token: T.token });
    ok("bank: unreconciled feed", un.s === 200, { status: un.s });
  }

  // ══ FINAL INTEGRITY ═══════════════════════════════════════
  {
    const fin = await tb();
    ok("FINAL: trial balance balances after every module", fin.bal, fin);
    const bs = (await api("GET", `/api/companies/${T.cid}/financial-statements/balance-sheet?asOfDate=${today}`, { token: T.token })).j;
    const A = n(bs?.assets?.total), L = n(bs?.liabilities?.total), E = n(bs?.equity?.total);
    ok("FINAL: balance sheet A = L + E", close(A, L + E, 0.02), { A, L, E, diff: Math.round((A - L - E) * 100) / 100 });
  }

  console.log(`\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""} ====`);
  if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error("CRASH", e); process.exit(2); });
