/**
 * Accounting round C1 (re-audit 2): one root cause, "the kernel trusted any sub-ledger source,
 * but those services also post accounts the caller chose". Real Postgres, through the public API
 * (and the ledger kernel directly for the gate itself):
 *
 *  C1   the kernel checks every control-account line on every source; only a service's own
 *       derived legs (controlLeg / systemVat, matching the account's ledger) pass
 *  RH1  a bill line coded to 1040 / 1050 / 1070 / 2010 / 2020 / 2036 is refused up front (422)
 *  RH2  a stock purchase's counter account cannot be 2020 / 1040 / 2010 (no VAT 201 Box 1 leak)
 *  RM1  fixed-asset payment / cost / proceeds accounts and debit-note lines refuse control accounts
 *  RM4  an opening trial balance needs the documents behind its control balances
 *  RM5  a firm VAT workpaper row posts as an invoice (aging ties), not as a bare journal on 1040
 *  RL1  a reconciliation rule refuses a control account when it is saved
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";

async function vatTenant(name?: string) {
  return h.createTenant({
    name,
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
}

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function bal(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0].n) / 100;
}

/** Lines of one entry as { code: [debit, credit] } (AED). */
async function linesOf(entryId: string) {
  const rows = await h.sql<{ code: string; d: string; c: string }>(
    `SELECT a.code, SUM(jl.debit)::text AS d, SUM(jl.credit)::text AS c
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 GROUP BY a.code ORDER BY a.code`,
    [entryId]
  );
  return Object.fromEntries(rows.map((r) => [r.code, [Number(r.d), Number(r.c)]]));
}

async function entryCount(t: Tenant): Promise<number> {
  const rows = await h.sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1`,
    [t.company.id]
  );
  return rows[0].n;
}

async function vat(t: Tenant, from: string, to: string) {
  const r = await t.as.get(`${base(t)}/vat/compute?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return r.body as { boxes: Record<string, number>; reconciliation: any };
}

async function checklistTie(t: Tenant, period: string, key: string) {
  const r = await t.as.get(`${base(t)}/month-end/checklist?period=${period}`);
  expect(r.status, r.text).toBe(200);
  const list = (r.body.checklist ?? r.body.items ?? r.body) as Array<Record<string, any>>;
  const step = list.find((i) => i.key === "control_accounts")!;
  return step.ties.find((x: any) => x.key === key);
}

function expectRefused(r: { status: number; text: string; body: any }, field?: string) {
  expect(r.status, r.text).toBe(422);
  expect(r.body.code).toBe("CONTROL_ACCOUNT_NOT_ALLOWED");
  if (field) expect(r.body.details.fields).toContain(field);
}

const CONTROL_CODES = ["1040", "1050", "1070", "2010", "2020", "2036"];

// ─── C1: the kernel gate ─────────────────────────────────────────────────────

describe("[C1] the kernel checks user-chosen lines on every source", () => {
  it("[C1] a sub-ledger source passes only the control legs it derived, on the matching ledger", async () => {
    const t = await h.createTenant({ name: "C1Kernel" });
    const { postJournal } = await import("../../server/ledger");
    const ar = await accountByCode(t, "1040");
    const ap = await accountByCode(t, "2010");
    const out = await accountByCode(t, "2020");
    const expense = await accountByCode(t, "5010");
    const post = (source: string, line: Record<string, unknown>) =>
      postJournal(
        {
          companyId: t.company.id,
          date: "2026-11-02",
          status: "posted",
          source,
          lines: [
            { debitFils: 10_000, ...line } as { accountId: string; debitFils: number },
            { accountId: expense.id, creditFils: 10_000 },
          ],
        },
        { actorId: t.user.id }
      );
    // Being a sub-ledger source no longer opens the gate: an unmarked line is the user's account.
    for (const source of ["bill", "invoice", "inventory", "fixed_asset", "opening_balance"]) {
      await expect(post(source, { accountId: ar.id }), source).rejects.toMatchObject({
        code: "CONTROL_ACCOUNT_MANUAL_POSTING",
        statusCode: 422,
      });
    }
    // The service's own leg passes; a leg marked for another ledger does not (a receivable
    // default pointed at 2020 cannot land output VAT).
    await expect(
      post("invoice", { accountId: ar.id, controlLeg: "receivables" })
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      post("invoice", { accountId: out.id, controlLeg: "receivables" })
    ).rejects.toMatchObject({ code: "CONTROL_ACCOUNT_MANUAL_POSTING" });
    await expect(
      post("bill", { accountId: ap.id, controlLeg: "receivables" })
    ).rejects.toMatchObject({
      code: "CONTROL_ACCOUNT_MANUAL_POSTING",
    });
    await expect(post("bill", { accountId: ap.id, controlLeg: "payables" })).resolves.toMatchObject(
      {
        replayed: false,
      }
    );
    // systemVat stays limited to the VAT ledger.
    await expect(post("bill", { accountId: ar.id, systemVat: true })).rejects.toMatchObject({
      code: "CONTROL_ACCOUNT_MANUAL_POSTING",
    });
  });
});

// ─── RH1 ─────────────────────────────────────────────────────────────────────

describe("[C1][RH1] bill lines", () => {
  it("[RH1] a bill line coded to a control account is refused when the bill is saved; the right coding posts Dr 5010 / Dr 1050 / Cr 2010", async () => {
    const t = await vatTenant("C1RH1");
    const bill = (accountId: string, n: string) =>
      t.as.post(`${base(t)}/bills`, {
        vendor_name: "Vend H",
        vendor_trn: "100555666700111",
        bill_number: `BC-${n}`,
        bill_date: "2026-11-02",
        place_of_supply: "dubai",
        line_items: [
          {
            description: `to ${n}`,
            quantity: 1,
            unit_price: 100,
            vat_rate: 5,
            account_id: accountId,
          },
        ],
      });
    const before = await entryCount(t);
    for (const code of CONTROL_CODES) {
      const r = await bill((await accountByCode(t, code)).id, code);
      expectRefused(r, "line_items[0].account_id");
      expect(r.body.details.accounts[0].code).toBe(code);
    }
    const stored = await h.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM vendor_bills WHERE company_id = $1`,
      [t.company.id]
    );
    expect(stored[0].n).toBe(0);
    expect(await entryCount(t)).toBe(before);

    const ok = await bill((await accountByCode(t, "5010")).id, "rent");
    expect(ok.status, ok.text).toBe(200);
    const ap = await t.as.post(`/api/bills/${ok.body.id}/approve`, {});
    expect(ap.status, ap.text).toBe(200);
    expect(await linesOf(ap.body.journal_entry_id)).toEqual({
      "1050": [5, 0],
      "2010": [0, 105],
      "5010": [100, 0],
    });

    // Defence in depth: a line stored with a control account before this fix (written straight
    // to the table) is still refused by the kernel when the bill is approved.
    const legacy = await bill((await accountByCode(t, "5010")).id, "legacy");
    expect(legacy.status, legacy.text).toBe(200);
    await h.sql(`UPDATE bill_line_items SET account_id = $2 WHERE bill_id = $1`, [
      legacy.body.id,
      (await accountByCode(t, "1040")).id,
    ]);
    const refused = await t.as.post(`/api/bills/${legacy.body.id}/approve`, {});
    expect(refused.status, refused.text).toBe(422);
    expect(refused.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");
    expect(await bal(t, "1040")).toBe(0);
  });

  it("[RH1] recurring bill templates and purchase-order lines refuse control accounts too", async () => {
    const t = await vatTenant("C1RH1b");
    const ar = (await accountByCode(t, "1040")).id;
    const rec = await t.as.post(`${base(t)}/recurring-bills`, {
      name: "Monthly",
      frequency: "monthly",
      next_run_on: "2026-12-01",
      template: {
        vendor_name: "Vend R",
        line_items: [{ description: "Fee", quantity: 1, unit_price: 100, account_id: ar }],
      },
    });
    expectRefused(rec, "template.line_items[0].account_id");
    const po = await t.as.post(`${base(t)}/purchase-orders`, {
      vendorName: "Vend P",
      date: "2026-11-02",
      lines: [{ description: "Thing", quantity: 1, unitPrice: 100, accountId: ar }],
    });
    expectRefused(po, "lines[0].accountId");
  });
});

// ─── RH2 ─────────────────────────────────────────────────────────────────────

describe("[C1][RH2] stock-movement counter account", () => {
  it("[RH2] a purchase movement cannot credit 2020 / 1040 / 2010; VAT 201 stays empty; GRNI and the bank still work", async () => {
    const t = await vatTenant("C1RH2");
    const p = await t.as.post(`${base(t)}/products`, {
      name: "Thing",
      sku: "TH-1",
      unitPrice: 200,
      costPrice: 100,
      vatRate: 0.05,
      unit: "pcs",
    });
    expect(p.status, p.text).toBe(200);
    const move = (counterAccountId?: string) =>
      t.as.post(`/api/products/${p.body.id}/movements`, {
        type: "purchase",
        quantity: 1,
        unitCost: 10000,
        date: "2026-11-05",
        ...(counterAccountId ? { counterAccountId } : {}),
      });
    for (const code of ["2020", "1040", "2010"]) {
      expectRefused(await move((await accountByCode(t, code)).id), "counterAccountId");
    }
    const stock = await h.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE company_id = $1`,
      [t.company.id]
    );
    expect(stock[0].n).toBe(0);
    const q4 = await vat(t, "2026-10-01", "2026-12-31");
    expect(q4.boxes.box12TotalDueTax ?? 0).toBe(0);

    // D1 (N7): no GRNI default and no GRNI counter (no purchase order line could clear it).
    const none = await move();
    expect(none.status, none.text).toBe(422);
    expect(none.body.code).toBe("COUNTER_ACCOUNT_REQUIRED");
    const grniAccount = await h.sql<{ id: string }>(
      `SELECT id FROM accounts WHERE company_id = $1 AND code = '2015'`,
      [t.company.id]
    );
    if (grniAccount[0]) expectRefused(await move(grniAccount[0].id), "counterAccountId");
    const bank = await move((await accountByCode(t, "1020")).id);
    expect(bank.status, bank.text).toBe(200);
    expect(await linesOf(bank.body.journalEntryId)).toEqual({
      "1020": [0, 10000],
      "1070": [10000, 0],
    });
    expect(await bal(t, "2020")).toBe(0);
    expect(await bal(t, "1040")).toBe(0);
  });
});

// ─── RM1 ─────────────────────────────────────────────────────────────────────

describe("[C1][RM1] fixed assets and debit notes", () => {
  it("[RM1] payment, cost and cash-proceeds accounts refuse control accounts; a bank-paid asset still capitalises", async () => {
    const t = await vatTenant("C1RM1");
    const bank = (await accountByCode(t, "1020")).id;
    const asset = (over: Record<string, unknown>) =>
      t.as.post(`${base(t)}/fixed-assets`, {
        assetName: "Desk",
        category: "equipment",
        purchaseDate: "2026-11-03",
        purchaseCost: 1000,
        usefulLifeYears: 5,
        depreciationMethod: "straight_line",
        ...over,
      });
    for (const code of ["2010", "1040", "2020"]) {
      expectRefused(
        await asset({ paymentAccountId: (await accountByCode(t, code)).id }),
        "paymentAccountId"
      );
    }
    for (const code of ["1040", "1070"]) {
      expectRefused(
        await asset({ paymentAccountId: bank, costAccountId: (await accountByCode(t, code)).id }),
        "costAccountId"
      );
    }
    const stored = await h.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM fixed_assets WHERE company_id = $1`,
      [t.company.id]
    );
    expect(stored[0].n).toBe(0);

    // Registered without payment, then capitalised from a control account: refused.
    const draft = await asset({});
    expect(draft.status, draft.text).toBe(201);
    const cap = await t.as.post(`/api/fixed-assets/${draft.body.id}/capitalize`, {
      paymentAccountId: (await accountByCode(t, "2010")).id,
    });
    expectRefused(cap, "paymentAccountId");
    const capOk = await t.as.post(`/api/fixed-assets/${draft.body.id}/capitalize`, {
      paymentAccountId: bank,
    });
    expect(capOk.status, capOk.text).toBe(200);
    expect(await linesOf(capOk.body.capitalizationJournalEntryId)).toEqual({
      "1020": [0, 1000],
      "1210": [1000, 0],
    });

    // A cash disposal books its proceeds on a cash / bank account, never on 1040 without an
    // invoice (that is the on-credit disposal).
    const sold = await asset({ assetName: "Van", purchaseCost: 2000, paymentAccountId: bank });
    expect(sold.status, sold.text).toBe(201);
    const disp = await t.as.post(`/api/fixed-assets/${sold.body.id}/dispose`, {
      disposalDate: "2026-11-05",
      disposalAmount: 1500,
      proceedsAccountId: (await accountByCode(t, "1040")).id,
      vatTreatment: "standard",
    });
    expectRefused(disp, "proceedsAccountId");
    expect(await bal(t, "1040")).toBe(0);
    const [still] = await h.sql<{ status: string }>(
      `SELECT status FROM fixed_assets WHERE id = $1`,
      [sold.body.id]
    );
    expect(still.status).not.toBe("disposed");
  });

  it("[RM1] a vendor debit-note line cannot credit a control account", async () => {
    const t = await vatTenant("C1RM1dn");
    const r = await t.as.post(`${base(t)}/debit-notes`, {
      vendor_name: "Vend D",
      note_date: "2026-11-06",
      reason: "Return",
      lines: [
        {
          description: "Credit",
          amount: 10000,
          vat_rate: 0,
          account_id: (await accountByCode(t, "1040")).id,
        },
      ],
    });
    expectRefused(r, "lines[0].account_id");
    expect(await bal(t, "1040")).toBe(0);
    expect(await bal(t, "2010")).toBe(0);
  });
});

// ─── RL1 ─────────────────────────────────────────────────────────────────────

describe("[C1][RL1] reconciliation rules", () => {
  it("[RL1] a rule to a control account is refused when it is created or edited", async () => {
    const t = await vatTenant("C1RL1");
    const rule = (accountId: string) =>
      t.as.post(`${base(t)}/reconciliation-rules`, {
        name: "Customer receipts",
        matchType: "contains",
        matchValue: "CUST",
        accountId,
        vatTreatment: "none",
      });
    for (const code of ["1040", "2010", "2020"]) {
      expectRefused(await rule((await accountByCode(t, code)).id), "accountId");
    }
    const ok = await rule((await accountByCode(t, "5010")).id);
    expect(ok.status, ok.text).toBe(201);
    const edit = await t.as.put(`/api/reconciliation-rules/${ok.body.id}`, {
      accountId: (await accountByCode(t, "1040")).id,
    });
    expectRefused(edit, "accountId");
  });
});

// ─── RM4 ─────────────────────────────────────────────────────────────────────

describe("[C1][RM4] opening trial balance control balances", () => {
  const tbCsv = (rows: string[]) => ["Account,Debit,Credit", ...rows].join("\n");
  async function preview(t: Tenant, csv: string, arApMode: "balance" | "documents") {
    const p = await t.as.post(`${base(t)}/imports/preview`, {
      kind: "trial_balance",
      sourceSystem: "xero",
      csv,
      cutOverDate: "2025-12-31",
      arApMode,
    });
    expect(p.status, p.text).toBe(201);
    const v = await t.as.post(`${base(t)}/imports/${p.body.id}/validate`);
    expect(v.status, v.text).toBe(200);
    return { id: p.body.id as string, v: v.body };
  }

  it("[RM4] a balance-mode TB with A/R, A/P, gratuity and VAT balances is refused with guidance and posts nothing", async () => {
    const t = await h.createTenant({ name: "C1RM4" });
    const run = await preview(
      t,
      tbCsv([
        "Bank (1020),20000.00,",
        "Accounts Receivable (1040),10500.00,",
        "Accounts Payable (2010),,5250.00",
        "End-of-Service Gratuity Provision (2036),,7000.00",
        "VAT Payable (Output VAT) (2020),,1250.00",
        "Share Capital (3010),,17000.00",
      ]),
      "balance"
    );
    expect(run.v.status).toBe("previewed");
    const codes = run.v.issues.map((i: { code: string }) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "V_AR_WITHOUT_DOCUMENTS",
        "V_AP_WITHOUT_DOCUMENTS",
        "V_GRATUITY_WITHOUT_EMPLOYEES",
        "V_VAT_IN_OPENING",
      ])
    );
    const commit = await t.as.post(`${base(t)}/imports/${run.id}/commit`);
    expect(commit.status).toBe(422);
    expect(await entryCount(t)).toBe(0);
  });

  it("[RM4] with the documents behind them (open invoices, open bills, employees' opening provisions) the same balances import and every tie holds", async () => {
    const t = await h.createTenant({ name: "C1RM4ok" });
    const emp = await t.as.post(`${base(t)}/employees`, {
      fullName: "Long Server",
      nationality: "IN",
      joinDate: "2020-01-01",
      basicSalary: "10000.00",
      openingGratuityProvision: "7000.00",
      openingGratuityAsOf: "2025-12-31",
    });
    expect(emp.status, emp.text).toBe(201);
    const run = await preview(
      t,
      tbCsv([
        "Bank (1020),20000.00,",
        "Accounts Receivable (1040),10500.00,",
        "Accounts Payable (2010),,5250.00",
        "End-of-Service Gratuity Provision (2036),,7000.00",
        "Share Capital (3010),,18250.00",
      ]),
      "documents"
    );
    expect(run.v.status, JSON.stringify(run.v.issues)).toBe("validated");
    const c = await t.as.post(`${base(t)}/imports/${run.id}/commit`);
    expect(c.status, c.text).toBe(200);
    const docs = async (
      kind: "open_invoices" | "open_bills",
      sourceSystem: "xero" | "quickbooks",
      csv: string
    ) => {
      const p = await t.as.post(`${base(t)}/imports/preview`, {
        kind,
        sourceSystem,
        csv,
        cutOverDate: "2025-12-31",
      });
      expect(p.status, p.text).toBe(201);
      const v = await t.as.post(`${base(t)}/imports/${p.body.id}/validate`);
      expect(v.body.status, JSON.stringify(v.body.issues)).toBe("validated");
      const cm = await t.as.post(`${base(t)}/imports/${p.body.id}/commit`);
      expect(cm.status, cm.text).toBe(200);
    };
    await docs(
      "open_invoices",
      "xero",
      [
        "*ContactName,*InvoiceNumber,*InvoiceDate,*DueDate,Total,AmountDue,Currency",
        "Cust A,INV-0001,01/12/2025,15/01/2026,10500.00,10500.00,AED",
      ].join("\n")
    );
    await docs(
      "open_bills",
      "quickbooks",
      [
        "Date,Num,Vendor,Due Date,Amount,Open Balance",
        "12/05/2025,BILL-0001,Vend B,01/05/2026,5250.00,5250.00",
      ].join("\n")
    );
    expect(await bal(t, "1040")).toBe(10500);
    expect(await bal(t, "2010")).toBe(-5250);
    expect(await bal(t, "2036")).toBe(-7000);
    expect(await bal(t, "3040")).toBe(0);
    for (const key of ["receivables", "payables", "gratuity"]) {
      const tie = await checklistTie(t, "2025-12", key);
      expect(tie, key).toMatchObject({ reconciled: true });
    }
  });
});

// ─── RM5 ─────────────────────────────────────────────────────────────────────

describe("[C1][RM5] firm VAT workpaper rows post through invoices and bills", () => {
  it("[RM5] a manual sales row issues an invoice (Dr 1040 / Cr 4010 / Cr 2020); the aging ties and a pull does not count it twice", async () => {
    const t = await vatTenant("C1RM5");
    const wp = await t.as.post(`${base(t)}/vat-workpapers`, {
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
    });
    expect(wp.status, wp.text).toBe(201);
    const wpBase = `${base(t)}/vat-workpapers/${wp.body.id}`;
    const row = await t.as.post(`${wpBase}/rows`, {
      rowCategory: "standard_sale",
      invoiceNumber: "EXT-1",
      documentDate: "2026-11-10",
      counterpartyName: "Walk-in Customer",
      emirate: "dubai",
      taxableAmount: 1000,
      vatAmount: 50,
    });
    expect(row.status, row.text).toBe(201);
    const posted = await t.as.post(`${wpBase}/rows/${row.body.id}/post`, {});
    expect(posted.status, posted.text).toBe(200);
    expect(posted.body).toMatchObject({ documentType: "invoice", status: "posted" });
    const je = await h.sql<{ source: string }>(`SELECT source FROM journal_entries WHERE id = $1`, [
      posted.body.journalEntryId,
    ]);
    expect(je[0].source).toBe("invoice");
    expect(await linesOf(posted.body.journalEntryId)).toEqual({
      "1040": [1050, 0],
      "2020": [0, 50],
      "4010": [0, 1000],
    });
    const bare = await h.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source = 'vat_workpaper_row'`,
      [t.company.id]
    );
    expect(bare[0].n).toBe(0);
    const tie = await checklistTie(t, "2026-11", "receivables");
    expect(tie).toMatchObject({ glBalance: 1050, subledgerBalance: 1050, reconciled: true });
    const q4 = await vat(t, "2026-10-01", "2026-12-31");
    expect(q4.reconciliation.hasUnexplainedDifference).toBe(false);

    const pull = await t.as.post(`${wpBase}/pull-from-books`, {});
    expect(pull.status, pull.text).toBe(200);
    expect(pull.body.created).toBe(0);
    const again = await t.as.post(`${wpBase}/rows/${row.body.id}/post`, {});
    expect(again.status).toBe(409);
  });

  it("[RM5] a manual purchase row creates the supplier bill pending approval; nothing reaches 2010 before the bill is approved", async () => {
    const t = await vatTenant("C1RM5p");
    const wp = await t.as.post(`${base(t)}/vat-workpapers`, {
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
    });
    const wpBase = `${base(t)}/vat-workpapers/${wp.body.id}`;
    const row = await t.as.post(`${wpBase}/rows`, {
      rowCategory: "standard_expense",
      invoiceNumber: "SUP-9",
      documentDate: "2026-11-12",
      counterpartyName: "Supplier S",
      emirate: "dubai",
      taxableAmount: 400,
      vatAmount: 20,
    });
    expect(row.status, row.text).toBe(201);
    const posted = await t.as.post(`${wpBase}/rows/${row.body.id}/post`, {});
    expect(posted.status, posted.text).toBe(200);
    expect(posted.body).toMatchObject({ documentType: "bill", status: "pending_approval" });
    expect(await bal(t, "2010")).toBe(0);
    const ap = await t.as.post(`/api/bills/${posted.body.documentId}/approve`, {});
    expect(ap.status, ap.text).toBe(200);
    expect(await linesOf(ap.body.journal_entry_id)).toEqual({
      "1050": [20, 0],
      "2010": [0, 420],
      "5000": [400, 0],
    });
    const tie = await checklistTie(t, "2026-11", "payables");
    expect(tie).toMatchObject({ reconciled: true });
    // The row stays while its bill is live.
    const del = await t.as.delete(`${wpBase}/rows/${row.body.id}`);
    expect(del.status).toBe(409);
  });
});
