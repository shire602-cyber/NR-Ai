/**
 * X6a: launch fixes from the CTO council launch review (scratchpad/council/COUNCIL-LAUNCH.md).
 * REQUIRED 1 header accounts, REQUIRED 2 no VAT without a TRN, REQUIRED 7 bank vs GL,
 * e-invoicing pre-switch-on items 2/3/5 and beat item 6 (input VAT without a supplier TRN).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { accountByCode, ledgerTotals, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

function vatTenant(name: string, columns: Record<string, unknown> = {}) {
  return h.createTenant({
    name,
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      ...columns,
    },
  });
}

async function subAccount(t: Tenant, parentCode: string, code: string) {
  const parent = await accountByCode(t, parentCode);
  const [p] = await h.sql<{ type: string; sub_type: string | null }>(
    `SELECT type, sub_type FROM accounts WHERE id = $1`,
    [parent.id]
  );
  const r = await t.as.post(`${base(t)}/accounts`, {
    code,
    nameEn: `Sub of ${parentCode}`,
    type: p.type,
    subType: p.sub_type,
    parentId: parent.id,
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body as { id: string; code: string };
}

async function draftInvoice(t: Tenant, lines: Array<Record<string, unknown>>) {
  const r = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Gulf Retail LLC",
    date: "2026-08-10",
    lines,
  });
  expect(r.status, r.text).toBe(200);
  return r.body as { id: string; number: string };
}

async function issue(id: string, t: Tenant) {
  return t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
}

async function approvedBill(t: Tenant, over: Record<string, unknown> = {}) {
  const b = await t.as.post(`${base(t)}/bills`, {
    vendor_name: "Emirates Office Supplies",
    vendor_trn: TRN,
    bill_number: `EOS-${Math.random().toString(36).slice(2, 8)}`,
    bill_date: "2026-08-12",
    due_date: "2026-09-12",
    line_items: [{ description: "Stationery", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    ...over,
  });
  expect(b.status, b.text).toBe(200);
  const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
  expect(a.status, a.text).toBe(200);
  return a.body as { id: string };
}

/** Net debit - credit on an account code across posted entries. */
async function net(t: Tenant, code: string): Promise<number> {
  const [r] = await h.sql<{ n: string | null }>(
    `SELECT SUM(jl.debit - jl.credit)::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(r?.n ?? 0);
}

describe("[X6a REQUIRED 1] sub-accounts under system posting accounts keep posting working", () => {
  it("with sub-accounts under 4010, 1040, 2020, 1050 and 1010: invoice issue, bill approval, payments, payroll approval and VAT postings succeed", async () => {
    const t = await vatTenant("X6aHeaders");
    await subAccount(t, "4010", "4011");
    await subAccount(t, "1040", "1041");
    await subAccount(t, "2020", "2021");
    await subAccount(t, "1050", "1051");
    await subAccount(t, "2010", "2011");
    const cashLeaf = await subAccount(t, "1010", "1011");

    // Invoice issue posts Dr 1040 / Cr 4010 / Cr 2020 to the parents.
    const inv = await draftInvoice(t, [
      { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    const issued = await issue(inv.id, t);
    expect(issued.status, issued.text).toBe(200);
    expect(await net(t, "4010")).toBe(-1000);
    expect(await net(t, "2020")).toBe(-50);
    expect(await net(t, "1040")).toBe(1050);

    // Invoice payment into the bank.
    const invPay = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
      amount: 1050,
      date: "2026-08-20",
      paymentAccountId: (await accountByCode(t, "1020")).id,
    });
    expect(invPay.status, invPay.text).toBeLessThan(300);
    expect(await net(t, "1040")).toBe(0);

    // Bill approval posts Dr expense + Dr 1050 / Cr 2010.
    const bill = await approvedBill(t);
    expect(await net(t, "1050")).toBe(50);
    expect(await net(t, "2010")).toBe(-1050);

    // A cash payment with no account chosen: 1010 is now a cash header, so it lands on a leaf.
    const cashPay = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-08-21",
      amount: 500,
      payment_method: "cash",
    });
    expect(cashPay.status, cashPay.text).toBeLessThan(300);
    // Paying explicitly from the cash leaf works; paying from the cash header is refused.
    const leafPay = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-08-21",
      amount: 100,
      payment_account_id: cashLeaf.id,
    });
    expect(leafPay.status, leafPay.text).toBeLessThan(300);
    expect(await net(t, "1011")).toBe(-100);
    const header = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-08-21",
      amount: 100,
      payment_account_id: (await accountByCode(t, "1010")).id,
    });
    expect(header.status).toBe(422);
    expect(header.body.code).toBe("ACCOUNT_IS_HEADER");

    // Payroll approval (accrual) and payment from the bank.
    const emp = await t.as.post(`${base(t)}/employees`, {
      fullName: "Header Test",
      nationality: "IN",
      joinDate: "2024-01-01",
      basicSalary: "5000.00",
    });
    expect(emp.status, emp.text).toBe(201);
    const run = await t.as.post(`${base(t)}/payroll-runs`, { periodMonth: 8, periodYear: 2026 });
    expect(run.status, run.text).toBeLessThan(300);
    const calc = await t.as.post(`/api/payroll-runs/${run.body.id}/calculate`, {});
    expect(calc.status, calc.text).toBe(200);
    const approve = await t.as.post(`/api/payroll-runs/${run.body.id}/approve`, {});
    expect(approve.status, approve.text).toBe(200);
    const pay = await t.as.post(`/api/payroll-runs/${run.body.id}/pay`, {
      paymentAccountId: cashLeaf.id,
      paymentDate: "2026-08-31",
    });
    expect(pay.status, pay.text).toBe(200);

    // A VAT posting straight to 2020: bad-debt relief on a six-month-old invoice.
    const old = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Slow Payer LLC",
      date: "2026-01-10",
      dueDate: "2026-02-09",
      lines: [{ description: "Job", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(old.status, old.text).toBe(200);
    expect((await issue(old.body.id, t)).status).toBe(200);
    const relief = await t.as.post(`${base(t)}/vat/bad-debt-relief`, {
      invoiceId: old.body.id,
      claimDate: "2026-08-20",
      writtenOff: true,
      customerNotified: true,
      customerNotifiedAt: "2026-08-19",
    });
    expect(relief.status, relief.text).toBe(201);
    // Output VAT: 50 + 50 issued, 50 relieved.
    expect(await net(t, "2020")).toBe(-50);

    // A fixed-asset disposal for cash with no proceeds account: 1010 is a cash header now, so
    // the proceeds land on a postable cash/bank leaf instead of being refused.
    const fa = await t.as.post(`${base(t)}/fixed-assets`, {
      assetName: "Laptop",
      category: "Computer Equipment",
      purchaseDate: "2026-01-15",
      purchaseCost: 12000,
      usefulLifeYears: 5,
      paymentAccountId: (await accountByCode(t, "1020")).id,
    });
    expect(fa.status, fa.text).toBe(201);
    const disposed = await t.as.post(`/api/fixed-assets/${fa.body.id}/dispose`, {
      disposalDate: "2026-08-10",
      disposalAmount: 9000,
      buyerName: "Second Hand LLC",
    });
    expect(disposed.status, disposed.text).toBe(200);
    expect(await net(t, "1010")).toBe(0);

    const totals = await ledgerTotals(t.company.id);
    expect(totals.debit).toBe(totals.credit);
  });

  it("the GL account behind a managed bank account cannot get sub-accounts", async () => {
    const t = await vatTenant("X6aBankGl");
    const bank = await t.as.post(`${base(t)}/bank-accounts`, {
      nameEn: "Emirates NBD",
      bankName: "Emirates NBD",
    });
    expect(bank.status, bank.text).toBe(201);
    const r = await t.as.post(`${base(t)}/accounts`, {
      code: "1029",
      nameEn: "Under the bank GL",
      type: "asset",
      subType: "bank",
      parentId: bank.body.glAccountId,
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ACCOUNT_PARENT_POSTING");
  });

  it("the read-only pre-deploy check lists parent/child pairs with the verdict", async () => {
    const t = await vatTenant("X6aPrecheck");
    await subAccount(t, "4010", "4011");
    await subAccount(t, "1010", "1011");
    const sqlText = readFileSync(
      resolve(__dirname, "../../scripts/qa/find-header-accounts.sql"),
      "utf8"
    );
    const select = sqlText.slice(
      sqlText.indexOf("SELECT"),
      sqlText.lastIndexOf(";", sqlText.indexOf("COMMIT"))
    );
    const rows = await h.sql<{ company_id: string; parent_code: string; verdict: string }>(select);
    const mine = rows
      .filter((r) => r.company_id === t.company.id)
      .map((r) => [r.parent_code, r.verdict]);
    expect(mine).toEqual([
      ["1010", "header_refused"],
      ["4010", "posting_parent_ok"],
    ]);
  });
});

describe("[X6a REQUIRED 2] no VAT without a supplier TRN", () => {
  it("a company with no TRN and no filing frequency cannot issue an invoice charging VAT; 0% out of scope issues as an Invoice", async () => {
    const t = await h.createTenant({ name: "X6aNoTrn", vatRegistered: false });
    const vat = await draftInvoice(t, [
      { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    const blocked = await issue(vat.id, t);
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("SUPPLIER_TRN_REQUIRED");
    expect(await net(t, "2020")).toBe(0);
    const [still] = await h.sql<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [
      vat.id,
    ]);
    expect(still.status).toBe("draft");

    const plain = await draftInvoice(t, [
      {
        description: "Consulting",
        quantity: 1,
        unitPrice: 1000,
        vatRate: 0,
        vatSupplyType: "out_of_scope",
      },
    ]);
    const ok = await issue(plain.id, t);
    expect(ok.status, ok.text).toBe(200);
    expect(await net(t, "2020")).toBe(0);

    const pdf = await t.as.get(`/api/invoices/${plain.id}/pdf`);
    expect(pdf.status).toBe(200);
  });

  it("a company with a filing frequency but no TRN is refused too; adding the TRN unblocks it", async () => {
    const t = await h.createTenant({
      name: "X6aFreqNoTrn",
      vatRegistered: false,
      companyColumns: { vat_filing_frequency: "Quarterly" },
    });
    const vat = await draftInvoice(t, [
      { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    expect((await issue(vat.id, t)).body.code).toBe("SUPPLIER_TRN_REQUIRED");
    await h.sql(`UPDATE companies SET trn_vat_number = $2 WHERE id = $1`, [t.company.id, TRN]);
    const ok = await issue(vat.id, t);
    expect(ok.status, ok.text).toBe(200);
    expect(await net(t, "2020")).toBe(-50);
  });

  it("invoices already issued by a company without a TRN are left as they are", async () => {
    const t = await h.createTenant({ name: "X6aLegacy", vatRegistered: false });
    const vat = await draftInvoice(t, [
      { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    // Simulate an invoice issued before this release (no data migration rewrites it).
    await h.sql(`UPDATE invoices SET status = 'sent' WHERE id = $1`, [vat.id]);
    const got = await t.as.get(`/api/invoices/${vat.id}`);
    expect(got.status).toBe(200);
    expect(Number(got.body.vatAmount)).toBe(50);
  });
});

describe("[X6a beat item 6] VAT 201 warns about input VAT without a supplier TRN", () => {
  it("lists the bill with no supplier TRN as a warning; the return stays complete and generates", async () => {
    const t = await vatTenant("X6aInputTrn");
    const noTrn = await approvedBill(t, {
      vendor_name: "Corner Shop",
      vendor_trn: undefined,
      bill_number: "NOTRN-1",
    });
    await approvedBill(t, { bill_number: "WITHTRN-1" });
    const c = await t.as.get(`${base(t)}/vat/compute?from=2026-07-01&to=2026-09-30`);
    expect(c.status, c.text).toBe(200);
    const warnings = (c.body.issues as Array<Record<string, unknown>>).filter(
      (i) => i.code === "INPUT_VAT_NO_SUPPLIER_TRN"
    );
    expect(warnings).toEqual([
      expect.objectContaining({
        severity: "warning",
        documentType: "bill",
        documentId: noTrn.id,
        reference: "NOTRN-1",
      }),
    ]);
    expect(c.body.complete).toBe(true);
    // Both bills' input VAT is still in Box 9 (the warning asks for review; it changes no box).
    expect(c.body.boxes.box9ExpensesVat).toBe(100);
    const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    expect(gen.status, gen.text).toBeLessThan(300);
    expect(
      (gen.body.reconciliationSnapshot.issues as Array<{ code: string }>).map((i) => i.code)
    ).toContain("INPUT_VAT_NO_SUPPLIER_TRN");
  });
});

describe("[X6a e-invoicing item 5] pre-flight validate and generate run one rule set", () => {
  const SELLER = {
    trn_vat_number: "100123456700003",
    legal_name: "Pearl Trading L.L.C.",
    address_street: "Office 1204, Al Saqr Tower",
    address_city: "Dubai",
    address_country: "AE",
    emirate: "dubai",
    trade_licence_no: "CN-1234567",
    trade_licence_authority: "Dubai Department of Economy and Tourism",
  };
  const BUYER_TRN = "100765432100003";

  async function issuedFor(t: Tenant, withAddress: boolean) {
    const c = await t.as.post(`${base(t)}/customer-contacts`, {
      name: "Acme Gulf FZ-LLC",
      trnNumber: BUYER_TRN,
      ...(withAddress
        ? { address: "Building 7, Dubai Internet City", city: "Dubai", emirate: "dubai" }
        : {}),
      country: "AE",
    });
    expect(c.status, c.text).toBeLessThan(300);
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Acme Gulf FZ-LLC",
      customerTrn: BUYER_TRN,
      contactId: c.body.id,
      date: new Date().toISOString().slice(0, 10),
      paymentTerms: "net30",
      lines: [{ description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    expect((await issue(inv.body.id, t)).status).toBe(200);
    return inv.body.id as string;
  }

  for (const withAddress of [true, false]) {
    it(`the validate report is exactly generate's verdict (${withAddress ? "valid" : "invalid"} buyer)`, async () => {
      const t = await h.createTenant({ name: "X6aPreflight", companyColumns: SELLER });
      const id = await issuedFor(t, withAddress);
      const v = await t.as.get(`/api/invoices/${id}/einvoice/validate`);
      expect(v.status, v.text).toBe(200);
      const g = await t.as.post(`/api/invoices/${id}/generate-einvoice`, {});
      expect(g.status === 200).toBe(v.body.valid);
      if (v.body.document === null) {
        // Data-level issues: generate refuses with exactly the same fix-it list.
        expect(g.body.code).toBe("EINVOICE_VALIDATION_FAILED");
        expect(v.body.issues.map((i: { field: string }) => i.field)).toEqual(
          g.body.issues.map((i: { field: string }) => i.field)
        );
      } else {
        // Same layers, same findings: the pre-flight document summary equals generate's.
        const strip = (x: Record<string, { errors: Array<{ id: string }> }>) =>
          ["xsd", "schematron", "rules"].map((l) => x[l].errors.map((e) => e.id).sort());
        expect(strip(v.body.document)).toEqual(strip(g.body.validation));
      }
      if (g.status === 200) {
        // After generating, validating again reuses the stored UUID and still agrees.
        const again = await t.as.get(`/api/invoices/${id}/einvoice/validate`);
        expect(again.body.valid).toBe(true);
        expect(again.body.stored.valid).toBe(true);
      }
    });
  }
});

describe("[X6a REQUIRED 7] bank vs GL on the dashboard", () => {
  async function statsFor(t: Tenant, bankId: string) {
    const stats = await t.as.get(`${base(t)}/dashboard/stats`);
    expect(stats.status, stats.text).toBe(200);
    return {
      acct: stats.body.bankVsGl.accounts.find(
        (a: { bankAccountId: string }) => a.bankAccountId === bankId
      ),
      statementTotal: stats.body.bankVsGl.statementTotal as number,
    };
  }

  it("with no statement imported there is no statement balance and no difference", async () => {
    const t = await h.createTenant({ name: "X6aNoStatement" });
    const bank = await t.as.post(`${base(t)}/bank-accounts`, {
      nameEn: "Emirates NBD",
      bankName: "Emirates NBD",
    });
    expect(bank.status, bank.text).toBe(201);
    // The J1 repro: a statement opening balance that is never posted to the GL.
    await h.sql(`UPDATE bank_accounts SET opening_balance = 10000 WHERE id = $1`, [bank.body.id]);
    const { acct, statementTotal } = await statsFor(t, bank.body.id);
    expect(acct).toMatchObject({
      hasStatement: false,
      statementBalance: null,
      statementDate: null,
      difference: null,
      glBalance: 0,
    });
    expect(statementTotal).toBe(0);
  });

  it("a USD bank account is compared in USD, not against its AED ledger amount", async () => {
    const t = await vatTenant("X6aUsdBank");
    const bank = await t.as.post(`${base(t)}/bank-accounts`, {
      nameEn: "ENBD USD",
      bankName: "Emirates NBD",
      currency: "USD",
    });
    expect(bank.status, bank.text).toBe(201);
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "US Client Inc",
      date: "2026-08-10",
      currency: "USD",
      exchangeRate: 3.6725,
      lines: [
        {
          description: "Export consulting",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    expect((await issue(inv.body.id, t)).status).toBe(200);
    const pay = await t.as.post(`${base(t)}/invoices/${inv.body.id}/payments`, {
      amount: 1000,
      date: "2026-08-14",
      paymentAccountId: bank.body.glAccountId,
      exchangeRate: 3.7,
    });
    expect(pay.status, pay.text).toBe(201);
    await h.sql(
      `INSERT INTO bank_transactions (company_id, bank_statement_account_id, bank_account_id,
              transaction_date, description, amount, balance, import_source)
       VALUES ($1, $2, $3, '2026-08-14', 'US Client Inc', 1000, 1000, 'csv')`,
      [t.company.id, bank.body.id, bank.body.glAccountId]
    );
    const { acct, statementTotal } = await statsFor(t, bank.body.id);
    expect(acct).toMatchObject({
      currency: "USD",
      isForeign: true,
      hasStatement: true,
      statementBalance: 1000,
      glBalance: 1000,
      difference: 0,
    });
    // USD amounts are not added to the AED statement total.
    expect(statementTotal).toBe(0);
  });
});
