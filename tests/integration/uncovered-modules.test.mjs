// Live-server coverage for the five modules flagged as under-tested in the
// third and fourth teardowns: bank reconciliation, expense claims,
// cost centres, recurring invoices, and credit-note edge cases.
//
// Run:
//   RL_API_MAX=100000 RL_READ_MAX=100000 RL_AUTH_MAX=1000 npm start &
//   BASE_URL=http://127.0.0.1:5000 node tests/integration/uncovered-modules.test.mjs

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
let pass = 0,
  fail = 0,
  skipped = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (!cond && detail && (detail.status === 429 || detail.s === 429)) {
    skipped++;
    console.log("SKIP  " + name + "  (rate-limited)");
    return;
  }
  if (cond) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    fails.push(name + " :: " + JSON.stringify(detail));
    console.log("FAIL  " + name + "  " + JSON.stringify(detail));
  }
};
const note = (name, detail) => console.log("NOTE  " + name + "  " + JSON.stringify(detail));
async function api(m, p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = "Bearer " + o.token;
  const r = await fetch(BASE + p, {
    method: m,
    headers: h,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {}
  return { s: r.status, j, t };
}
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.02) => Math.abs(n(a) - n(b)) <= tol;
const today = new Date().toISOString().slice(0, 10);

let T,
  ACC = [];
const acct = (code) => ACC.find((a) => a.code === code);
async function tb() {
  const r = await api("GET", `/api/companies/${T.cid}/reports/trial-balance`, { token: T.token });
  const rows = r.j?.rows || [];
  const dr = rows.reduce((s, x) => s + n(x.debit ?? x.totalDebit), 0);
  const cr = rows.reduce((s, x) => s + n(x.credit ?? x.totalCredit), 0);
  return { dr: Math.round(dr * 100) / 100, cr: Math.round(cr * 100) / 100, bal: close(dr, cr, 0.02) };
}
async function makeIssuedInvoice(amount, desc) {
  const r = await api("POST", `/api/companies/${T.cid}/invoices`, {
    token: T.token,
    body: {
      customerName: desc || "CN Test Customer",
      date: today,
      dueDate: today,
      lines: [{ description: desc || "Service", quantity: 1, unitPrice: amount, vatRate: 0.05 }],
    },
  });
  if (r.s >= 400) return { err: r };
  const inv = r.j;
  const st = await api("PATCH", `/api/invoices/${inv.id}/status`, {
    token: T.token,
    body: { status: "sent" },
  });
  return { inv, st };
}

async function main() {
  const s = Math.random().toString(36).slice(2, 8);
  const reg = await api("POST", "/api/auth/register", {
    body: { name: "Uncov", email: `uncov_${s}@e.com`, password: "Password123!" },
  });
  if (!reg.j?.token) {
    console.log("SKIP: registration rate-limited");
    process.exit(0);
  }
  T = { token: reg.j.token, cid: reg.j.company.id };
  await api("PATCH", `/api/companies/${T.cid}`, {
    token: T.token,
    body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" },
  });
  ACC = (await api("GET", `/api/companies/${T.cid}/accounts`, { token: T.token })).j || [];
  const bankGl = acct("1020");
  const expenseGl = acct("5050") || ACC.find((a) => a.type === "expense");

  // ════════ 1. BANK RECONCILIATION ════════
  let r = await api("POST", `/api/companies/${T.cid}/bank-accounts`, {
    token: T.token,
    body: { nameEn: "Recon Test Account", bankName: "Emirates NBD", currency: "AED", glAccountId: bankGl?.id },
  });
  ok("bankrec: create account with GL link", r.s === 201 && !!r.j?.id, { s: r.s });
  const bankAccountId = r.j?.id;

  const csv = [
    "Date,Description,Debit,Credit,Balance",
    `${today},SALARY TRANSFER OUT,1500.00,,8500.00`,
    `${today},CUSTOMER DEPOSIT ALPHA,,2100.00,10600.00`,
    `${today},BANK FEE,52.50,,10547.50`,
  ].join("\n");
  r = await api("POST", `/api/companies/${T.cid}/bank-statements/import`, {
    token: T.token,
    body: { bankAccountId, csvContent: csv },
  });
  ok("bankrec: CSV import succeeds", r.s === 201 && n(r.j?.imported) === 3, {
    s: r.s,
    imported: r.j?.imported,
    fmt: r.j?.detectedFormat,
  });

  r = await api("POST", `/api/companies/${T.cid}/bank-statements/import`, {
    token: T.token,
    body: { bankAccountId, csvContent: csv },
  });
  ok(
    "bankrec: re-import dedupes (0 imported, 3 skipped)",
    r.s === 201 && n(r.j?.imported) === 0 && n(r.j?.skippedDuplicates) === 3,
    { s: r.s, imported: r.j?.imported, skipped: r.j?.skippedDuplicates }
  );

  r = await api("POST", `/api/companies/${T.cid}/bank-statements/import`, {
    token: T.token,
    body: { bankAccountId, csvContent: "this is not a csv at all" },
  });
  ok("bankrec: garbage CSV rejected cleanly (4xx not 500)", r.s >= 400 && r.s < 500, { s: r.s });

  r = await api("GET", `/api/companies/${T.cid}/bank-statements/unreconciled?bankAccountId=${bankAccountId}`, {
    token: T.token,
  });
  const unrec = Array.isArray(r.j) ? r.j : r.j?.transactions || [];
  ok("bankrec: unreconciled feed lists imported txns", unrec.length >= 3, { s: r.s, count: unrec.length });
  const feeTxn = unrec.find((t) => Math.abs(Math.abs(n(t.amount)) - 52.5) < 0.01);

  if (feeTxn && expenseGl) {
    r = await api("POST", `/api/companies/${T.cid}/bank-statements/${feeTxn.id}/create-entry`, {
      token: T.token,
      body: { accountId: expenseGl.id, memo: "Bank fee via reconciliation" },
    });
    ok("bankrec: create-entry posts a JE", r.s === 201 && !!r.j?.journalEntry, { s: r.s, j: r.j?.message });

    r = await api("POST", `/api/companies/${T.cid}/bank-statements/${feeTxn.id}/create-entry`, {
      token: T.token,
      body: { accountId: expenseGl.id, memo: "duplicate attempt" },
    });
    ok("bankrec: second create-entry on same txn → 409 (no double posting)", r.s === 409, { s: r.s });
  } else {
    ok("bankrec: create-entry posts a JE", false, { reason: "fee txn or expense account not found" });
  }

  // Match a deposit against a real issued invoice → records payment
  const dep = unrec.find((t) => n(t.amount) > 2000);
  const mkInv = await makeIssuedInvoice(2000, "Recon Match Customer");
  if (dep && mkInv.inv) {
    r = await api("POST", `/api/companies/${T.cid}/bank-statements/${dep.id}/match`, {
      token: T.token,
      body: { matchedType: "invoice", matchedId: mkInv.inv.id },
    });
    ok("bankrec: match deposit→invoice records payment", r.s === 200 && r.j?.matchStatus === "matched", {
      s: r.s,
      j: r.j?.message || r.j?.code,
    });
    const inv2 = await api("GET", `/api/invoices/${mkInv.inv.id}`, { token: T.token });
    ok(
      "bankrec: matched invoice becomes paid/partial",
      ["paid", "partial"].includes(inv2.j?.status),
      { status: inv2.j?.status }
    );
  } else {
    ok("bankrec: match deposit→invoice records payment", false, {
      reason: dep ? "invoice not created" : "deposit txn not found",
      inv: mkInv.err?.s,
    });
  }
  let t = await tb();
  ok("bankrec: trial balance balanced after reconciliation", t.bal, t);

  // ════════ 2. EXPENSE CLAIMS ════════
  r = await api("POST", `/api/companies/${T.cid}/expense-claims`, { token: T.token, body: {} });
  ok("claims: create without title → 400", r.s === 400, { s: r.s });

  r = await api("POST", `/api/companies/${T.cid}/expense-claims`, {
    token: T.token,
    body: { title: "Client trip Dubai", items: [] },
  });
  ok("claims: create draft", r.s === 200 && r.j?.status === "draft", { s: r.s, status: r.j?.status });
  const claimId = r.j?.id;

  r = await api("POST", `/api/expense-claims/${claimId}/submit`, { token: T.token, body: {} });
  ok("claims: submit with no items → 400", r.s === 400, { s: r.s });

  r = await api("PATCH", `/api/expense-claims/${claimId}`, {
    token: T.token,
    body: {
      items: [
        { expense_date: today, category: "taxi", description: "Airport taxi", amount: 105, vat_amount: 5 },
        { expense_date: today, category: "hotel", description: "One night", amount: 420, vat_amount: 20 },
      ],
    },
  });
  ok("claims: add items to draft", r.s === 200, { s: r.s, j: r.j?.message });

  r = await api("POST", `/api/expense-claims/${claimId}/approve`, { token: T.token, body: {} });
  ok("claims: approve straight from draft → 400 (must submit first)", r.s === 400, { s: r.s });

  r = await api("POST", `/api/expense-claims/${claimId}/submit`, { token: T.token, body: {} });
  ok("claims: submit", r.s === 200 && r.j?.status === "submitted", { s: r.s, status: r.j?.status });

  r = await api("POST", `/api/expense-claims/${claimId}/reject`, { token: T.token, body: {} });
  ok("claims: reject without notes → 400", r.s === 400, { s: r.s });

  const tbBefore = await tb();
  r = await api("POST", `/api/expense-claims/${claimId}/approve`, {
    token: T.token,
    body: { review_notes: "ok" },
  });
  ok("claims: approve", r.s === 200 && r.j?.status === "approved", { s: r.s, status: r.j?.status });

  t = await tb();
  ok("claims: approval reached the ledger (trial balance moved and balanced)", t.bal && t.dr > tbBefore.dr, {
    before: tbBefore.dr,
    after: t.dr,
    bal: t.bal,
  });

  r = await api("PATCH", `/api/expense-claims/${claimId}`, {
    token: T.token,
    body: { title: "should fail, not draft" },
  });
  ok("claims: edit after approval → 400", r.s === 400, { s: r.s });

  r = await api("POST", `/api/expense-claims/${claimId}/mark-paid`, {
    token: T.token,
    body: { payment_reference: "TT-123" },
  });
  ok("claims: mark-paid from approved", r.s === 200 && r.j?.status === "paid", { s: r.s, status: r.j?.status });
  const tbAfterPaid = await tb();
  if (close(tbAfterPaid.dr, t.dr)) {
    note("claims: mark-paid posts NO cash JE — reimbursement liability is never cleared (documented gap)", {
      drApprove: t.dr,
      drPaid: tbAfterPaid.dr,
    });
  }

  r = await api("POST", `/api/expense-claims/${claimId}/mark-paid`, { token: T.token, body: {} });
  ok("claims: mark-paid twice → 400", r.s === 400, { s: r.s });

  // ════════ 3. COST CENTRES ════════
  r = await api("POST", `/api/companies/${T.cid}/cost-centers`, {
    token: T.token,
    body: { code: "CC-DXB", name: "Dubai Branch" },
  });
  ok("costcentre: create", r.s === 201 && !!r.j?.id, { s: r.s });
  const ccId = r.j?.id;

  r = await api("POST", `/api/companies/${T.cid}/cost-centers`, {
    token: T.token,
    body: { code: "CC-DXB", name: "Duplicate Code" },
  });
  ok("costcentre: duplicate code rejected (4xx not 500)", r.s >= 400 && r.s < 500, { s: r.s });

  // Journal entry allocated to the cost centre
  const cash = acct("1000") || acct("1020");
  if (ccId && cash && expenseGl) {
    r = await api("POST", `/api/companies/${T.cid}/journal`, {
      token: T.token,
      body: {
        date: today,
        memo: "CC allocation test",
        status: "posted",
        lines: [
          { accountId: expenseGl.id, debit: 300, credit: 0, costCenterId: ccId },
          { accountId: cash.id, debit: 0, credit: 300 },
        ],
      },
    });
    ok("costcentre: journal line with costCenterId accepted", r.s < 300, { s: r.s, j: r.j?.message });

    r = await api("POST", `/api/companies/${T.cid}/journal`, {
      token: T.token,
      body: {
        date: today,
        memo: "bogus CC",
        lines: [
          { accountId: expenseGl.id, debit: 10, credit: 0, costCenterId: "00000000-0000-0000-0000-000000000000" },
          { accountId: cash.id, debit: 0, credit: 10 },
        ],
      },
    });
    ok("costcentre: unknown costCenterId → 400", r.s === 400, { s: r.s, code: r.j?.code });

    const yStart = today.slice(0, 4) + "-01-01";
    r = await api(
      "GET",
      `/api/companies/${T.cid}/cost-centers/profitability?startDate=${yStart}&endDate=${today}`,
      { token: T.token }
    );
    const ccRow = (r.j?.costCenters || []).find((c) => c.costCenterId === ccId);
    ok("costcentre: profitability report shows the allocated 300 expense", !!ccRow && close(ccRow.totalExpenses, 300), {
      s: r.s,
      row: ccRow,
    });

    r = await api("DELETE", `/api/cost-centers/${ccId}`, { token: T.token });
    ok("costcentre: delete blocked while journal lines reference it", r.s === 400, {
      s: r.s,
      count: r.j?.journalLineCount,
    });
  } else {
    ok("costcentre: journal line with costCenterId accepted", false, { reason: "prereq accounts missing" });
  }

  r = await api("POST", `/api/companies/${T.cid}/cost-centers`, {
    token: T.token,
    body: { code: "CC-TMP", name: "Unreferenced" },
  });
  const tmpCc = r.j?.id;
  r = await api("DELETE", `/api/cost-centers/${tmpCc}`, { token: T.token });
  ok("costcentre: delete unreferenced centre succeeds", r.s === 200, { s: r.s });

  // ════════ 4. RECURRING INVOICES ════════
  r = await api("POST", `/api/companies/${T.cid}/recurring-invoices`, {
    token: T.token,
    body: { customerName: "No Lines LLC", frequency: "monthly", startDate: today },
  });
  ok("recurring: missing lines → 400", r.s === 400, { s: r.s });

  r = await api("POST", `/api/companies/${T.cid}/recurring-invoices`, {
    token: T.token,
    body: {
      customerName: "Bad Freq LLC",
      frequency: "fortnightly",
      startDate: today,
      lines: [{ description: "Retainer", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
    },
  });
  ok("recurring: invalid frequency → 400", r.s === 400, { s: r.s });

  r = await api("POST", `/api/companies/${T.cid}/recurring-invoices`, {
    token: T.token,
    body: {
      customerName: "Steady Retainer LLC",
      frequency: "monthly",
      startDate: today,
      lines: [{ description: "Monthly retainer", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
    },
  });
  ok(
    "recurring: create schedule (nextRunDate = startDate, active)",
    r.s === 200 && r.j?.isActive === true && String(r.j?.nextRunDate).slice(0, 10) === today,
    { s: r.s, next: r.j?.nextRunDate, active: r.j?.isActive }
  );
  const recId = r.j?.id;

  r = await api("PATCH", `/api/recurring-invoices/${recId}/toggle`, { token: T.token, body: {} });
  ok("recurring: PATCH toggle deactivates", r.s === 200 && r.j?.isActive === false, {
    s: r.s,
    active: r.j?.isActive,
  });

  r = await api("PATCH", `/api/recurring-invoices/${recId}/toggle`, { token: T.token, body: {} });
  ok("recurring: PATCH toggle reactivates", r.s === 200 && r.j?.isActive === true, {
    s: r.s,
    active: r.j?.isActive,
  });

  r = await api("DELETE", `/api/recurring-invoices/${recId}`, { token: T.token });
  ok("recurring: delete", r.s === 200, { s: r.s });

  r = await api("GET", `/api/recurring-invoices/${recId}`, { token: T.token });
  ok("recurring: deleted schedule is gone (404)", r.s === 404, { s: r.s });

  // ════════ 5. CREDIT-NOTE EDGE CASES ════════
  const cnInv = await makeIssuedInvoice(1000, "CN Edge Customer");
  if (!cnInv.inv) {
    ok("cn: prerequisite invoice", false, { s: cnInv.err?.s });
  } else {
    const invId = cnInv.inv.id;

    r = await api("POST", `/api/companies/${T.cid}/invoices/${invId}/credit-note`, {
      token: T.token,
      body: { lines: [] },
    });
    ok("cn: empty lines array → 422 INVALID_CREDIT_LINES", r.s === 422, { s: r.s, code: r.j?.code });

    r = await api("POST", `/api/companies/${T.cid}/invoices/${invId}/credit-note`, {
      token: T.token,
      body: { lines: [{ description: "Over-credit", quantity: 1, unitPrice: 5000, vatRate: 0.05 }] },
    });
    ok("cn: over-credit → 409 CREDIT_EXCEEDS_REMAINING", r.s === 409, { s: r.s, code: r.j?.code });

    r = await api("POST", `/api/companies/${T.cid}/invoices/${invId}/credit-note`, {
      token: T.token,
      body: { lines: [{ description: "Weird VAT", quantity: 1, unitPrice: 100, vatRate: 0.12 }] },
    });
    ok("cn: non-UAE vat rate (12%) rejected", r.s >= 400 && r.s < 500, { s: r.s });

    r = await api("POST", `/api/companies/${T.cid}/invoices/${invId}/credit-note`, {
      token: T.token,
      body: { lines: [{ description: "Partial return", quantity: 1, unitPrice: 400, vatRate: 0.05 }] },
    });
    ok("cn: partial credit of 400 accepted", r.s === 201 && close(Math.abs(n(r.j?.total)), 420), {
      s: r.s,
      total: r.j?.total,
    });
    const cn1 = r.j;
    ok("cn: credit note totals are negative", n(cn1?.total) < 0 && n(cn1?.vatAmount) < 0, {
      total: cn1?.total,
      vat: cn1?.vatAmount,
    });

    // Full credit after a partial should only credit the REMAINDER (1050-420=630)
    r = await api("POST", `/api/companies/${T.cid}/invoices/${invId}/credit-note`, {
      token: T.token,
      body: {},
    });
    ok("cn: full credit after partial credits only the remaining 630", r.s === 201 && close(Math.abs(n(r.j?.total)), 630), {
      s: r.s,
      total: r.j?.total,
    });

    r = await api("POST", `/api/companies/${T.cid}/invoices/${invId}/credit-note`, {
      token: T.token,
      body: {},
    });
    ok("cn: further credit on fully-credited invoice → 409 FULLY_CREDITED", r.s === 409, {
      s: r.s,
      code: r.j?.code,
    });

    // Credit note of a credit note must be refused
    if (cn1?.id) {
      r = await api("POST", `/api/companies/${T.cid}/invoices/${cn1.id}/credit-note`, {
        token: T.token,
        body: {},
      });
      ok("cn: credit note of a credit note → 400 CN_OF_CN", r.s === 400, { s: r.s, code: r.j?.code });
    }

    // Standalone credit-note writes are retired
    r = await api("POST", `/api/companies/${T.cid}/credit-notes`, {
      token: T.token,
      body: { customerName: "X" },
    });
    ok("cn: standalone credit-note POST → 410 retired", r.s === 410, { s: r.s, code: r.j?.code });

    r = await api("GET", `/api/companies/${T.cid}/credit-notes`, { token: T.token });
    const cnList = Array.isArray(r.j) ? r.j : r.j?.creditNotes || [];
    ok("cn: read model lists both credit notes", cnList.length >= 2, { s: r.s, count: cnList.length });
  }

  // ════════ FINAL LEDGER INTEGRITY ════════
  t = await tb();
  ok("FINAL: trial balance balances after all five modules", t.bal, t);
  r = await api("GET", `/api/companies/${T.cid}/reports/balance-sheet`, { token: T.token });
  const bs = r.j || {};
  const assets = n(bs.totalAssets ?? bs.assets?.total);
  const liab = n(bs.totalLiabilities ?? bs.liabilities?.total);
  const eq = n(bs.totalEquity ?? bs.equity?.total);
  ok("FINAL: balance sheet A = L + E", close(assets, liab + eq, 0.05), { assets, liab, eq });

  console.log(`\n==== ${pass} passed, ${fail} failed, ${skipped} skipped ====`);
  if (fails.length) console.log("FAILURES:\n - " + fails.join("\n - "));
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
