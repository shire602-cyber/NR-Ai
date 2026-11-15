/**
 * Golden books: the two-year synthetic ledger from audit report 11
 * (11-financial-statement-correctness.md, sections 1 and 3), seeded through
 * the real API so every posting path (manual journals, invoice issue +
 * payment incl. realised FX, bill approve + payment) is exercised.
 *
 * This module only SEEDS. Statement assertions belong to W2-B; the hand
 * calculated expectations from report 11 are exported as GOLDEN_EXPECTED so
 * they live next to the data they describe.
 *
 * Dates stay on or before 2026-10-31 because the API rejects future-dated
 * journals (assertNotFutureDate).
 */
import { expect } from "vitest";
import { accountByCode, postJournalEntry, type Tenant } from "../harness";

export interface GoldenBooks {
  invoices: Record<string, { id: string; number: string }>;
  bills: Record<string, { id: string }>;
  journals: Record<string, { id: string }>;
}

/** Hand calculations from report 11 §3 (AED). */
export const GOLDEN_EXPECTED = {
  fy2025: {
    revenue: 30_000,
    expenses: 8_800,
    netIncome: 21_200,
    bank: 112_200,
    accountsReceivable: 13_000,
    inputVat: 400,
    accountsPayable: 2_100,
    outputVat: 1_500,
    accruedExpenses: 800,
    capital: 100_000,
    totalAssets: 125_600,
    totalLiabilities: 4_400,
    totalEquity: 121_200,
  },
  /** Balance sheet as of 2025-03-31 (both sides). */
  asOf20250331Total: 104_500,
  /** P&L for Q2 2025. */
  q2_2025: { revenue: 20_000, expenses: 2_000, netIncome: 18_000 },
  cumulative20261231: {
    totalAssets: 135_803.63,
    totalLiabilities: 8_873.38,
    totalEquity: 126_930.25,
  },
  fy2026: {
    netIncome: 5_730.25,
    usdInvoice: { ar: 7_712.25, revenue: 7_345, vat: 367.25, bankOnPayment: 7_770, fxGain: 57.75 },
    usdBill: { vat: 183.63, ap: 3_856.13 },
    netCashChange: 4_770,
  },
  arAgingTotal: 18_250,
} as const;

async function ok<T = any>(p: Promise<{ status: number; body: T; text: string }>, what: string) {
  const r = await p;
  expect(r.status, `${what}: ${r.text.slice(0, 300)}`).toBeLessThan(300);
  return r.body;
}

async function invoice(
  t: Tenant,
  input: {
    customerName: string;
    date: string;
    dueDate?: string;
    net: number;
    currency?: string;
    exchangeRate?: number;
  }
) {
  const created = await ok(
    t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: input.customerName,
      date: input.date,
      dueDate: input.dueDate,
      currency: input.currency ?? "AED",
      exchangeRate: input.exchangeRate,
      lines: [{ description: "Services", quantity: 1, unitPrice: input.net, vatRate: 5 }],
    }),
    `create invoice ${input.customerName}`
  );
  await ok(t.as.patch(`/api/invoices/${created.id}/status`, { status: "sent" }), "issue invoice");
  return { id: created.id as string, number: created.number as string };
}

async function payInvoice(
  t: Tenant,
  invoiceId: string,
  input: { amount: number; date: string; exchangeRate?: number }
) {
  const bank = await accountByCode(t, "1020");
  await ok(
    t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/payments`, {
      amount: input.amount,
      date: input.date,
      method: "bank_transfer",
      paymentAccountId: bank.id,
      exchangeRate: input.exchangeRate,
    }),
    "invoice payment"
  );
}

async function bill(
  t: Tenant,
  input: {
    vendor: string;
    date: string;
    net: number;
    accountCode?: string;
    currency?: string;
    exchangeRate?: number;
  }
) {
  const accountId = input.accountCode ? (await accountByCode(t, input.accountCode)).id : undefined;
  const created = await ok(
    t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: input.vendor,
      bill_date: input.date,
      due_date: input.date,
      currency: input.currency ?? "AED",
      exchange_rate: input.exchangeRate,
      line_items: [
        {
          description: input.vendor,
          quantity: 1,
          unit_price: input.net,
          vat_rate: 5,
          account_id: accountId,
        },
      ],
    }),
    `create bill ${input.vendor}`
  );
  const id = (created.id ?? created.bill?.id) as string;
  await ok(t.as.post(`/api/bills/${id}/approve`, {}), `approve bill ${input.vendor}`);
  return { id };
}

async function payBill(t: Tenant, billId: string, amount: number, date: string) {
  await ok(
    t.as.post(`/api/bills/${billId}/payments`, {
      payment_date: date,
      amount,
      payment_method: "bank_transfer",
    }),
    "bill payment"
  );
}

/** Seed report 11's FY2025 + FY2026 books into `t` through the real API. */
export async function seedGoldenBooksFY2025_2026(t: Tenant): Promise<GoldenBooks> {
  const books: GoldenBooks = { invoices: {}, bills: {}, journals: {} };

  // VAT-registered UAE company (needed for VAT postings).
  await ok(
    t.as.patch(`/api/companies/${t.company.id}`, {
      trnVatNumber: "100123456700003",
      vatRegistered: true,
      emirate: "dubai",
    }),
    "company VAT profile"
  );

  // ── FY2025 ──
  books.journals.capital = await postJournalEntry(t, {
    date: "2025-01-02",
    description: "Share capital",
    lines: [
      { code: "1020", debit: 100_000 },
      { code: "3010", credit: 100_000 },
    ],
  });
  books.bills.rent = await bill(t, {
    vendor: "Rent",
    date: "2025-02-01",
    net: 6_000,
    accountCode: "5010",
  });
  await payBill(t, books.bills.rent.id, 6_300, "2025-02-10");

  books.invoices.inv2025a = await invoice(t, {
    customerName: "CustA",
    date: "2025-03-01",
    dueDate: "2025-03-31",
    net: 10_000,
  });
  await payInvoice(t, books.invoices.inv2025a.id, { amount: 10_500, date: "2025-03-05" });

  books.invoices.inv2025b = await invoice(t, {
    customerName: "CustB",
    date: "2025-04-01",
    dueDate: "2025-05-01",
    net: 20_000,
  });
  await payInvoice(t, books.invoices.inv2025b.id, { amount: 8_000, date: "2025-04-20" });

  books.bills.supplies = await bill(t, {
    vendor: "Supplies",
    date: "2025-06-01",
    net: 2_000,
    accountCode: "5050",
  });

  books.journals.accrual = await postJournalEntry(t, {
    date: "2025-12-31",
    description: "Utilities accrual",
    lines: [
      { code: "5030", debit: 800 },
      { code: "2040", credit: 800 },
    ],
  });

  // ── FY2026 ──
  books.invoices.inv2026a = await invoice(t, {
    customerName: "CustC",
    date: "2026-02-01",
    dueDate: "2026-03-03",
    net: 5_000,
  });

  books.invoices.usd = await invoice(t, {
    customerName: "USCustomer",
    date: "2026-03-01",
    dueDate: "2026-03-31",
    net: 2_000,
    currency: "USD",
    exchangeRate: 3.6725,
  });
  await payInvoice(t, books.invoices.usd.id, {
    amount: 2_100,
    date: "2026-04-01",
    exchangeRate: 3.7,
  });

  // Uncategorised USD bill (no account / category) — report 11's 5130 defect.
  books.bills.usd = await bill(t, {
    vendor: "USVendor",
    date: "2026-05-01",
    net: 1_000,
    currency: "USD",
    exchangeRate: 3.6725,
  });

  books.journals.salary = await postJournalEntry(t, {
    date: "2026-06-30",
    description: "Salaries",
    lines: [
      { code: "5020", debit: 3_000 },
      { code: "1020", credit: 3_000 },
    ],
  });

  return books;
}
