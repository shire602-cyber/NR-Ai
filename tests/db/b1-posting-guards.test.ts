/**
 * Accounting round B1 (re-audit): posting guards and sub-ledgers, against real Postgres. Every
 * scenario posts through the public API (or the ledger kernel for the generic sources) and
 * asserts the exact journal lines and the report / VAT 201 figures:
 *
 *  NC1  the ledger kernel refuses control-account lines from every non-sub-ledger source
 *       (bank-line entries, templates, imports, AI postings, ...) unless the entry is a reasoned
 *       control-account adjustment by a permitted role; the VAT a bank line derives still posts
 *  NH1  a bank-line entry with any VAT treatment (exempt included) or a disposal is refused in a
 *       filed VAT quarter, and so is unmatching one; settlements are never refused (NL1)
 *  NH2  /api/journal/:id/reverse and /void refuse a document's journal (409 SUBLEDGER_ENTRY)
 *  NH3  an asset sold on credit is billed with a sales tax invoice: aging, VAT and receipt tie
 *  M3   an asset's category picks its cost account (1220 furniture, 1230 computers, ...)
 *  NM3  the 2036 gratuity tie counts the provision released on final settlement
 *  NM5  the inventory tie (1070 vs stock valuation) and the opening trial balance import
 */
import { describe, expect, it } from "vitest";
import { accountByCode, postJournalEntry, useHarness, type Tenant } from "./harness";

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

async function entryIdOf(t: Tenant, source: string, sourceId: string): Promise<string> {
  const rows = await h.sql<{ id: string }>(
    `SELECT id FROM journal_entries WHERE company_id = $1 AND source = $2 AND source_id = $3
        AND entry_kind <> 'reversal' ORDER BY created_at LIMIT 1`,
    [t.company.id, source, sourceId]
  );
  expect(rows[0], `${source} entry`).toBeTruthy();
  return rows[0].id;
}

async function vat(t: Tenant, from: string, to: string) {
  const r = await t.as.get(`${base(t)}/vat/compute?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return r.body as { boxes: Record<string, number>; reconciliation: any };
}

async function fileReturn(t: Tenant, periodStart: string, periodEnd: string) {
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, { periodStart, periodEnd });
  expect(gen.status, gen.text).toBe(201);
  const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
    ftaReferenceNumber: "FTA-B1",
  });
  expect(sub.status, sub.text).toBe(200);
  return gen.body as { id: string };
}

async function issuedInvoice(t: Tenant, date: string, unitPrice = 1000) {
  const c = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Cust X",
    customerTrn: "100000000000011",
    date,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Sale", quantity: 1, unitPrice, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string };
}

/** Import bank lines and return them by description. */
async function bankLines(t: Tenant, rows: string[]) {
  const ba = await t.as.post(`${base(t)}/bank-accounts`, {
    nameEn: "ENBD",
    bankName: "Emirates NBD",
    currency: "AED",
  });
  expect(ba.status, ba.text).toBe(201);
  const imp = await t.as.post(`${base(t)}/bank-statements/import`, {
    bankAccountId: ba.body.id,
    csvContent: ["Date,Description,Debit,Credit", ...rows].join("\n"),
    acknowledgeAmbiguity: true,
  });
  expect(imp.status, imp.text).toBe(201);
  const txns = await t.as.get(
    `${base(t)}/bank-statements/transactions?bankAccountId=${ba.body.id}`
  );
  expect(txns.status, txns.text).toBe(200);
  const by = new Map<string, { id: string }>();
  for (const l of txns.body as Array<{ id: string; description: string }>) by.set(l.description, l);
  return { by, bankAccount: ba.body as { id: string; glAccountId: string } };
}

async function checklistTie(t: Tenant, period: string, key: string) {
  const r = await t.as.get(`${base(t)}/month-end/checklist?period=${period}`);
  expect(r.status, r.text).toBe(200);
  const list = (r.body.checklist ?? r.body.items ?? r.body) as Array<Record<string, any>>;
  const step = list.find((i) => i.key === "control_accounts")!;
  return { step, tie: step.ties.find((x: any) => x.key === key) };
}

// ─── NC1 ─────────────────────────────────────────────────────────────────────

describe("[B1][NC1] control accounts take lines only from their sub-ledger", () => {
  it("[NC1] bank-statement create-entry refuses 1040 and 2020 and names the sub-ledger path; a VAT-inclusive fee still posts its derived VAT", async () => {
    const t = await vatTenant("B1NC1");
    const { by } = await bankLines(t, [
      "2026-11-03,CUST X PAYMENT,,500.00",
      "2026-11-04,VAT PAYMENT FTA,300.00,",
      "2026-11-05,BANK FEE,26.25,",
    ]);
    const ar = await accountByCode(t, "1040");
    const vatPayable = await accountByCode(t, "2020");

    const toAr = await t.as.post(
      `${base(t)}/bank-statements/${by.get("CUST X PAYMENT")!.id}/create-entry`,
      { accountId: ar.id }
    );
    expect(toAr.status, toAr.text).toBe(422);
    expect(toAr.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");
    expect(toAr.body.details.accounts).toEqual([
      { accountId: ar.id, code: "1040", ledger: "receivables" },
    ]);
    expect(toAr.body.details.paths[0]).toMatchObject({ ledger: "receivables" });

    const toVat = await t.as.post(
      `${base(t)}/bank-statements/${by.get("VAT PAYMENT FTA")!.id}/create-entry`,
      { accountId: vatPayable.id }
    );
    expect(toVat.status, toVat.text).toBe(422);
    expect(toVat.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");
    expect(toVat.body.details.paths[0]).toMatchObject({
      ledger: "vat",
      endpoint: "POST /api/vat-returns/:id/settlement",
    });

    // Nothing reached the ledger: AR aging ties and the VAT return has no adjustment.
    expect(await bal(t, "1040")).toBe(0);
    expect(await bal(t, "2020")).toBe(0);
    const fee = await t.as.post(
      `${base(t)}/bank-statements/${by.get("BANK FEE")!.id}/create-entry`,
      { accountId: (await accountByCode(t, "5110")).id, vatTreatment: "standard" }
    );
    expect(fee.status, fee.text).toBe(201);
    const q4 = await vat(t, "2026-10-01", "2026-12-31");
    expect(q4.boxes).toMatchObject({
      box1bDubaiAdj: 0,
      box9ExpensesAmount: 25,
      box9ExpensesVat: 1.25,
      box9ExpensesAdj: 0,
      box14PayableTax: -1.25,
    });
    expect(q4.reconciliation.hasUnexplainedDifference).toBe(false);
  });

  it("[NC1] the kernel gate covers every generic source; sub-ledger sources pass; a reasoned adjustment needs a permitted role and is stamped", async () => {
    const t = await h.createTenant({ name: "B1Kernel" });
    const { postJournal } = await import("../../server/ledger");
    const ar = await accountByCode(t, "1040");
    const inventory = await accountByCode(t, "1070");
    const bank = await accountByCode(t, "1020");
    const post = (
      source: string,
      accountId: string,
      ctx: Record<string, unknown> = {},
      status: "posted" | "draft" = "posted"
    ) =>
      postJournal(
        {
          companyId: t.company.id,
          date: "2026-11-02",
          status,
          source,
          lines: [
            { accountId, debitFils: 10_000 },
            { accountId: bank.id, creditFils: 10_000 },
          ],
        },
        { actorId: t.user.id, ...ctx }
      );
    for (const source of [
      "manual",
      "journal_template",
      "bank_reconciliation",
      "firm_bulk_import",
      "ai_gl",
      "receipt",
      "something_new",
    ]) {
      await expect(post(source, ar.id), source).rejects.toMatchObject({
        code: "CONTROL_ACCOUNT_MANUAL_POSTING",
        statusCode: 422,
      });
      await expect(post(source, inventory.id, {}, "draft"), source).rejects.toMatchObject({
        code: "CONTROL_ACCOUNT_MANUAL_POSTING",
      });
    }
    // A sub-ledger source posts (the invoice service, here exercised directly).
    await expect(post("invoice", ar.id)).resolves.toMatchObject({ replayed: false });

    // A reasoned adjustment: refused for a viewer, posted and stamped for an accountant.
    await expect(
      post("bank_reconciliation", ar.id, {
        controlAdjustment: { reason: "Agreed balance correction", role: "viewer" },
      })
    ).rejects.toMatchObject({ code: "CONTROL_ADJUSTMENT_ROLE_REQUIRED", statusCode: 403 });
    await expect(
      post("ai_gl", ar.id, { controlAdjustment: { reason: "x", role: "accountant" } })
    ).rejects.toMatchObject({ code: "CONTROL_ADJUSTMENT_REASON_REQUIRED" });
    const ok = await post("ai_gl", ar.id, {
      controlAdjustment: { reason: "Agreed balance correction", role: "accountant" },
    });
    const [row] = await h.sql<{ r: string; by: string }>(
      `SELECT control_adjustment_reason AS r, control_adjustment_by AS by FROM journal_entries WHERE id = $1`,
      [ok.entry.id]
    );
    expect(row).toEqual({ r: "Agreed balance correction", by: t.user.id });

    // A line the service derived from a VAT treatment may sit on a VAT account; the same account
    // chosen by the user may not.
    const input = await accountByCode(t, "1050");
    const expense = await accountByCode(t, "5110");
    const derived = await postJournal(
      {
        companyId: t.company.id,
        date: "2026-11-02",
        status: "posted",
        source: "bank_reconciliation",
        lines: [
          { accountId: expense.id, debitFils: 2_500 },
          { accountId: input.id, debitFils: 125, systemVat: true },
          { accountId: bank.id, creditFils: 2_625 },
        ],
      },
      { actorId: t.user.id }
    );
    expect(await linesOf(derived.entry.id)).toEqual({
      "1020": [0, 26.25],
      "1050": [1.25, 0],
      "5110": [25, 0],
    });
    await expect(
      postJournal(
        {
          companyId: t.company.id,
          date: "2026-11-02",
          status: "posted",
          source: "bank_reconciliation",
          lines: [
            { accountId: input.id, debitFils: 125 },
            { accountId: bank.id, creditFils: 125 },
          ],
        },
        { actorId: t.user.id }
      )
    ).rejects.toMatchObject({ code: "CONTROL_ACCOUNT_MANUAL_POSTING" });
  });

  it("[NC1] editing a draft onto a control account is refused without the adjustment; the manual reasoned path still works", async () => {
    const t = await h.createTenant({ name: "B1Draft" });
    const ar = await accountByCode(t, "1040");
    const bank = await accountByCode(t, "1020");
    const expense = await accountByCode(t, "5110");
    const draft = await t.as.post(`${base(t)}/journal`, {
      date: "2026-11-02",
      status: "draft",
      memo: "Draft",
      lines: [
        { accountId: expense.id, debit: 100, credit: 0 },
        { accountId: bank.id, debit: 0, credit: 100 },
      ],
    });
    expect(draft.status, draft.text).toBe(200);
    const id = draft.body.id ?? draft.body.entry?.id;
    const edit = await t.as.put(`/api/journal/${id}`, {
      date: "2026-11-02",
      memo: "Draft",
      lines: [
        { accountId: ar.id, debit: 100, credit: 0 },
        { accountId: bank.id, debit: 0, credit: 100 },
      ],
    });
    expect(edit.status, edit.text).toBe(422);
    expect(edit.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");
    const reasoned = await t.as.put(`/api/journal/${id}`, {
      date: "2026-11-02",
      memo: "Draft",
      controlAdjustment: { reason: "Customer balance agreed with auditor" },
      status: "posted",
      lines: [
        { accountId: ar.id, debit: 100, credit: 0 },
        { accountId: bank.id, debit: 0, credit: 100 },
      ],
    });
    expect(reasoned.status, reasoned.text).toBe(200);
    const [row] = await h.sql<{ r: string; status: string }>(
      `SELECT control_adjustment_reason AS r, status FROM journal_entries WHERE id = $1`,
      [id]
    );
    expect(row).toEqual({ r: "Customer balance agreed with auditor", status: "posted" });
  });
});

// ─── NH1 / NL1 ───────────────────────────────────────────────────────────────

describe("[B1][NH1] a filed VAT period refuses every posting that would change its boxes", () => {
  it("[NH1] exempt and zero-rated bank-line entries, unmatching a treated line and an exempt disposal are refused in a filed quarter; an untreated line is not", async () => {
    const t = await vatTenant("B1NH1");
    const { by, bankAccount } = await bankLines(t, [
      "2026-03-10,INTEREST MAR,,12.50",
      "2026-03-15,EXEMPT INCOME,,40.00",
      "2026-03-16,EXPORT RECEIPT,,60.00",
      "2026-03-17,OWNER TOP UP,,70.00",
    ]);
    const income = await accountByCode(t, "4010");
    const capital = await accountByCode(t, "3010");
    await issuedInvoice(t, "2026-02-15", 2000);
    // Before filing: exempt interest in Box 5.
    const interest = await t.as.post(
      `${base(t)}/bank-statements/${by.get("INTEREST MAR")!.id}/create-entry`,
      { accountId: income.id, vatTreatment: "exempt" }
    );
    expect(interest.status, interest.text).toBe(201);
    // 1020 is now the header of the bank account's own GL leaf.
    const bank = { id: bankAccount.glAccountId };
    const asset = await t.as.post(`${base(t)}/fixed-assets`, {
      assetName: "Old printer",
      category: "equipment",
      purchaseDate: "2026-01-01",
      purchaseCost: 1000,
      usefulLifeYears: 5,
      paymentAccountId: bank.id,
    });
    expect(asset.status, asset.text).toBe(201);
    await fileReturn(t, "2026-01-01", "2026-03-31");
    const before = await vat(t, "2026-01-01", "2026-03-31");
    expect(before.boxes).toMatchObject({ box1bDubaiAmount: 2000, box5ExemptAmount: 12.5 });

    const exempt = await t.as.post(
      `${base(t)}/bank-statements/${by.get("EXEMPT INCOME")!.id}/create-entry`,
      { accountId: income.id, vatTreatment: "exempt" }
    );
    expect(exempt.status, exempt.text).toBe(409);
    expect(exempt.body.code).toBe("VAT_PERIOD_FILED");
    const zero = await t.as.post(
      `${base(t)}/bank-statements/${by.get("EXPORT RECEIPT")!.id}/create-entry`,
      { accountId: income.id, vatTreatment: "zero_rated" }
    );
    expect(zero.status, zero.text).toBe(409);
    // No VAT treatment: the VAT return does not read the entry, so it posts.
    const plain = await t.as.post(
      `${base(t)}/bank-statements/${by.get("OWNER TOP UP")!.id}/create-entry`,
      { accountId: capital.id }
    );
    expect(plain.status, plain.text).toBe(201);
    // Unmatching the reported interest would take it out of the filed Box 5.
    const un = await t.as.delete(`${base(t)}/bank-statements/${by.get("INTEREST MAR")!.id}/match`);
    expect(un.status, un.text).toBe(409);
    expect(un.body.code).toBe("VAT_PERIOD_FILED");
    // An exempt disposal dated in the filed quarter (Box 5 too).
    const disp = await t.as.post(`/api/fixed-assets/${asset.body.id}/dispose`, {
      disposalDate: "2026-03-20",
      disposalAmount: 300,
      proceedsAccountId: bank.id,
      vatTreatment: "exempt",
    });
    expect(disp.status, disp.text).toBe(409);
    expect(disp.body.code).toBe("VAT_PERIOD_FILED");

    const after = await vat(t, "2026-01-01", "2026-03-31");
    expect(after.boxes).toMatchObject({
      box1bDubaiAmount: 2000,
      box4ZeroRatedAmount: 0,
      box5ExemptAmount: 12.5,
    });
  });

  it("[NL1] a VAT settlement and its reversal are not refused once a later quarter is filed", async () => {
    const t = await vatTenant("B1NL1");
    const bank = await accountByCode(t, "1020");
    await issuedInvoice(t, "2026-02-01", 2000);
    const q1 = await fileReturn(t, "2026-01-01", "2026-03-31");
    const paid = await t.as.post(`/api/vat-returns/${q1.id}/settlement`, {
      date: "2026-04-20",
      paymentAccountId: bank.id,
    });
    expect(paid.status, paid.text).toBe(201);
    expect(await linesOf(paid.body.journalEntryId)).toEqual({
      "1020": [0, 100],
      "2020": [100, 0],
    });
    await fileReturn(t, "2026-04-01", "2026-06-30");
    const rev = await t.as.post(`/api/vat-returns/${q1.id}/settlement/reverse`, {
      date: "2026-07-10",
      reason: "Bank rejected the payment",
    });
    expect(rev.status, rev.text).toBe(200);
    expect(await bal(t, "2020")).toBe(-100);
    // Q2's filed boxes are unchanged (settlements are never in a period's boxes).
    expect((await vat(t, "2026-04-01", "2026-06-30")).boxes.box14PayableTax).toBe(0);
  });
});

// ─── NH2 ─────────────────────────────────────────────────────────────────────

describe("[B1][NH2] the generic reverse / void routes refuse a document's journal", () => {
  it("[NH2] invoice and bill journals: 409 SUBLEDGER_ENTRY naming the document; manual journals still reverse", async () => {
    const t = await vatTenant("B1NH2");
    const inv = await issuedInvoice(t, "2026-11-02", 1000);
    const invJe = await entryIdOf(t, "invoice", inv.id);
    const rev = await t.as.post(`/api/journal/${invJe}/reverse`, {
      date: "2026-11-03",
      reason: "bypass test",
    });
    expect(rev.status, rev.text).toBe(409);
    expect(rev.body.code).toBe("SUBLEDGER_ENTRY");
    expect(rev.body.details).toMatchObject({ document: "invoice", documentId: inv.id });
    const voided = await t.as.post(`/api/journal/${invJe}/void`, { reason: "bypass" });
    expect(voided.status, voided.text).toBe(409);

    const b = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Supplier LLC",
      vendor_trn: "100000000000029",
      bill_number: "B-NH2",
      bill_date: "2026-11-02",
      due_date: "2026-12-31",
      line_items: [{ description: "Supplies", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const billJe = await entryIdOf(t, "bill", b.body.id);
    const vb = await t.as.post(`/api/journal/${billJe}/void`, { reason: "bypass" });
    expect(vb.status, vb.text).toBe(409);
    expect(vb.body.details).toMatchObject({ document: "bill", documentId: b.body.id });

    // Both documents still tie: AR 1,050 = GL 1040, AP 1,050 = GL 2010, VAT reconciled.
    for (const [kind, code] of [
      ["receivables", "1040"],
      ["payables", "2010"],
    ] as const) {
      const a = await t.as.get(`${base(t)}/reports/aged-${kind}?asOf=2026-11-30`);
      expect(a.status, a.text).toBe(200);
      expect(a.body.reconciliation).toMatchObject({ controlAccountCode: code, isReconciled: true });
      expect(Number(a.body.totals.total)).toBe(1050);
    }
    expect((await vat(t, "2026-10-01", "2026-12-31")).reconciliation.hasUnexplainedDifference).toBe(
      false
    );

    // A manual journal is the user's own and still reverses.
    const manual = await postJournalEntry(t, {
      date: "2026-11-04",
      description: "Accrual",
      lines: [
        { code: "5110", debit: 50 },
        { code: "1020", credit: 50 },
      ],
    });
    const ok = await t.as.post(`/api/journal/${manual.id}/reverse`, { date: "2026-11-05" });
    expect(ok.status, ok.text).toBe(200);
  });
});

// ─── NH3 / M3 ────────────────────────────────────────────────────────────────

describe("[B1][NH3][M3] fixed assets: category accounts and disposals on credit", () => {
  it("[M3] the category picks the cost account; accumulated depreciation stays on 1240", async () => {
    const t = await h.createTenant({ name: "B1M3" });
    const bank = await accountByCode(t, "1020");
    const expected: Array<[string, string]> = [
      ["computers", "1230"],
      ["Furniture", "1220"],
      ["Vehicles", "1250"],
      ["Equipment", "1210"],
      ["Electronics", "1230"],
      ["Building", "1290"],
    ];
    for (const [category, code] of expected) {
      const r = await t.as.post(`${base(t)}/fixed-assets`, {
        assetName: `${category} asset`,
        category,
        purchaseDate: "2026-01-01",
        purchaseCost: 1200,
        usefulLifeYears: 1,
        paymentAccountId: bank.id,
      });
      expect(r.status, r.text).toBe(201);
      expect(await linesOf(r.body.capitalizationJournalEntryId), category).toEqual({
        "1020": [0, 1200],
        [code]: [1200, 0],
      });
      const dep = await t.as.post(`/api/fixed-assets/${r.body.id}/depreciate`, {
        month: 1,
        year: 2026,
      });
      expect(dep.status, dep.text).toBe(200);
      expect(await linesOf(dep.body.journalEntryId)).toEqual({
        "1240": [0, 100],
        "5100": [100, 0],
      });
    }
    expect(await bal(t, "1220")).toBe(1200);
    expect(await bal(t, "1230")).toBe(2400);
    expect(await bal(t, "1290")).toBe(1200);
  });

  it("[NH3] a disposal on credit issues a tax invoice: AR aging ties, Box 1 reports the VAT once, the buyer pays the invoice", async () => {
    const t = await vatTenant("B1NH3");
    const bank = await accountByCode(t, "1020");
    const a = await t.as.post(`${base(t)}/fixed-assets`, {
      assetName: "Office furniture",
      category: "furniture",
      purchaseDate: "2026-10-01",
      purchaseCost: 10000,
      usefulLifeYears: 5,
      paymentAccountId: bank.id,
    });
    expect(a.status, a.text).toBe(201);
    const d = await t.as.post(`/api/fixed-assets/${a.body.id}/dispose`, {
      disposalDate: "2026-10-20",
      disposalAmount: 4000,
      onCredit: true,
      buyerName: "Scrap Buyer LLC",
      vatTreatment: "standard",
    });
    expect(d.status, d.text).toBe(200);
    expect(d.body).toMatchObject({ gainLoss: -6000, gainLossType: "loss" });
    expect(d.body.invoiceId).toBeTruthy();

    // The invoice: Dr 1040 4,200 / Cr 4010 4,000 / Cr 2020 200.
    const invJe = await entryIdOf(t, "invoice", d.body.invoiceId);
    expect(await linesOf(invJe)).toEqual({
      "1040": [4200, 0],
      "2020": [0, 200],
      "4010": [0, 4000],
    });
    // The disposal moves the invoiced proceeds out of revenue; no AR or VAT line of its own.
    expect(await linesOf(d.body.journalEntryId)).toEqual({
      "1220": [0, 10000],
      "4010": [4000, 0],
      "5130": [6000, 0],
    });
    expect(await bal(t, "4010")).toBe(0);
    expect(await bal(t, "1040")).toBe(4200);

    const aging = await t.as.get(`${base(t)}/reports/aged-receivables?asOf=2026-10-31`);
    expect(aging.status, aging.text).toBe(200);
    expect(Number(aging.body.totals.total)).toBe(4200);
    expect(aging.body.reconciliation).toMatchObject({ glBalance: 4200, isReconciled: true });

    const q4 = await vat(t, "2026-10-01", "2026-12-31");
    expect(q4.boxes).toMatchObject({ box1bDubaiAmount: 4000, box1bDubaiVat: 200 });
    expect(q4.reconciliation.hasUnexplainedDifference).toBe(false);

    const pl = await t.as.get(
      `${base(t)}/financial-statements/profit-loss?startDate=2026-10-01&endDate=2026-10-31`
    );
    expect(pl.status, pl.text).toBe(200);
    expect(Number(pl.body.statement.revenue)).toBe(0);

    // The invoice is the receivable: it is paid like any invoice, and cannot be voided alone.
    const voided = await t.as.patch(`/api/invoices/${d.body.invoiceId}/status`, {
      status: "void",
    });
    expect(voided.status, voided.text).toBe(409);
    expect(voided.body.code).toBe("INVOICE_BILLS_ASSET_DISPOSAL");
    const pay = await t.as.post(`${base(t)}/invoices/${d.body.invoiceId}/payments`, {
      amount: 4200,
      date: "2026-10-25",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    expect(await bal(t, "1040")).toBe(0);
    const [fa] = await h.sql<{ inv: string; status: string }>(
      `SELECT disposal_invoice_id AS inv, status FROM fixed_assets WHERE id = $1`,
      [a.body.id]
    );
    expect(fa).toEqual({ inv: d.body.invoiceId, status: "disposed" });
  });
});

// ─── NM3 / NM5 / M12 ─────────────────────────────────────────────────────────

describe("[B1][NM3][NM5] month-end sub-ledger ties", () => {
  it("[NM3] the gratuity tie counts the provision released on final settlement", async () => {
    const t = await h.createTenant({ name: "B1NM3" });
    const emp = await t.as.post(`${base(t)}/employees`, {
      fullName: "Leaver",
      nationality: "IN",
      joinDate: "2021-01-01",
      basicSalary: "10000.00",
      openingGratuityProvision: "50000.00",
      openingGratuityAsOf: "2026-09-30",
    });
    expect(emp.status, emp.text).toBe(201);
    // The go-live provision is booked as a reasoned adjustment (Dr 3020 / Cr 2036).
    await postJournalEntry(t, {
      date: "2026-09-30",
      description: "Opening gratuity provision",
      lines: [
        { code: "3020", debit: 50000 },
        { code: "2036", credit: 50000 },
      ],
    });
    const s = await t.as.post(`${base(t)}/payroll/settlements`, {
      employeeId: emp.body.id,
      terminationDate: "2026-10-31",
      reason: "Resignation",
    });
    expect(s.status, s.text).toBe(201);
    const [row] = await h.sql<{ used: string; je: string; breakdown: any }>(
      `SELECT gratuity_provision_used::text AS used, journal_entry_id AS je, breakdown
         FROM payroll_settlements WHERE id = $1`,
      [s.body.id ?? s.body.settlement?.id]
    );
    const lines = await linesOf(row.je);
    // The whole provision is cleared: the gratuity is paid from it and the excess released.
    expect(lines["2036"]).toEqual([50000, 0]);
    const released = lines["5028"][1];
    expect(released).toBeGreaterThan(0);
    expect(Number(row.used) + released).toBeCloseTo(50000, 2);
    expect(await bal(t, "2036")).toBe(0);

    const { tie } = await checklistTie(t, "2026-10", "gratuity");
    expect(tie).toMatchObject({
      glBalance: 0,
      subledgerBalance: 0,
      difference: 0,
      reconciled: true,
    });
  });

  it("[NM5][M12] the inventory tie: stock with value ties; 1070 with no stock behind it fails the close", async () => {
    const t = await h.createTenant({ name: "B1NM5" });
    const p = await t.as.post(`${base(t)}/products`, {
      name: "Widget",
      unitPrice: 150,
      costPrice: 100,
      currentStock: 10,
      openingStockDate: "2026-10-01",
    });
    expect(p.status, p.text).toBe(200);
    expect(await bal(t, "1070")).toBe(1000);
    const ok = await checklistTie(t, "2026-10", "inventory");
    expect(ok.tie).toMatchObject({
      accountCode: "1070",
      glBalance: 1000,
      subledgerBalance: 1000,
      reconciled: true,
    });

    // A balance put on 1070 with no stock (a reasoned adjustment here; S8 did it by an import).
    await postJournalEntry(t, {
      date: "2026-10-15",
      description: "Unsupported inventory balance",
      lines: [
        { code: "1070", debit: 4000 },
        { code: "3040", credit: 4000 },
      ],
    });
    const broken = await checklistTie(t, "2026-10", "inventory");
    expect(broken.tie).toMatchObject({
      glBalance: 5000,
      subledgerBalance: 1000,
      difference: 4000,
      reconciled: false,
    });
    expect(broken.step.status).toBe("incomplete");
    expect(broken.step.details).toContain("1070 (4000.00)");

    // The valuation is read at the period end: a purchase today (November) is not in October's
    // tie, on either side.
    const move = await t.as.post(`/api/products/${p.body.id}/movements`, {
      type: "purchase",
      quantity: 5,
      unitCost: 100,
    });
    expect(move.status, move.text).toBe(200);
    const oct = await checklistTie(t, "2026-10", "inventory");
    expect(oct.tie).toMatchObject({ glBalance: 5000, subledgerBalance: 1000 });
  });

  it("[NM5] an opening trial balance with inventory needs the opening stock behind it", async () => {
    const t = await h.createTenant({ name: "B1NM5Import" });
    const csv = [
      "Account,Debit,Credit",
      "Bank (1020),6000.00,",
      "Inventory (1070),4000.00,",
      "Share Capital (3010),,10000.00",
    ].join("\n");
    const preview = async () => {
      const p = await t.as.post(`${base(t)}/imports/preview`, {
        kind: "trial_balance",
        sourceSystem: "xero",
        csv,
        cutOverDate: "2025-12-31",
        arApMode: "balance",
      });
      expect(p.status, p.text).toBe(201);
      const v = await t.as.post(`${base(t)}/imports/${p.body.id}/validate`);
      expect(v.status, v.text).toBe(200);
      return { id: p.body.id as string, v: v.body };
    };
    const refused = await preview();
    expect(refused.v.status).toBe("previewed");
    expect(refused.v.issues.map((i: { code: string }) => i.code)).toContain(
      "V_INVENTORY_WITHOUT_STOCK"
    );
    const commit = await t.as.post(`${base(t)}/imports/${refused.id}/commit`);
    expect(commit.status).toBe(422);

    // Record the opening stock (40 x 100), then the same trial balance imports and ties.
    const prod = await t.as.post(`${base(t)}/products`, {
      name: "Stock item",
      unitPrice: 150,
      costPrice: 100,
      currentStock: 40,
      openingStockDate: "2025-12-31",
    });
    expect(prod.status, prod.text).toBe(200);
    const okRun = await preview();
    expect(okRun.v.status, JSON.stringify(okRun.v.issues)).toBe("validated");
    const c = await t.as.post(`${base(t)}/imports/${okRun.id}/commit`);
    expect(c.status, c.text).toBe(200);
    expect(await bal(t, "1070")).toBe(4000);
    expect(await bal(t, "3040")).toBe(0);
    expect(await bal(t, "1020")).toBe(6000);
    expect(await bal(t, "3010")).toBe(-10000);
    const { tie } = await checklistTie(t, "2025-12", "inventory");
    expect(tie).toMatchObject({ glBalance: 4000, subledgerBalance: 4000, reconciled: true });
  });
});
