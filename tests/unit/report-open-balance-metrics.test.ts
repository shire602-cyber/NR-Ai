/**
 * F10: receivable/payable comparison metrics use the server open balances (invoice
 * `openBalanceBase`, bill `open_balance_base`, both from server/reporting/settlement.ts) so a
 * part-paid or credit-note-settled document counts at its remaining balance, not its full total.
 */
import { describe, expect, it } from "vitest";
import { buildComparisonRows } from "../../client/src/pages/reports/comparisons/buildComparisonRows";
import type { ComparisonRowsInput } from "../../client/src/pages/reports/comparisons/buildComparisonRows";
import { buildComparisonRowsFixture } from "./helpers/comparison-rows-fixture";

const inv = (id: string, total: number, status: string, openBalanceBase: number) => ({
  id,
  number: id,
  customerName: "C " + id,
  date: "2026-04-10",
  dueDate: "2026-05-10",
  currency: "AED",
  baseCurrencyAmount: total,
  total,
  status,
  reminderCount: 0,
  lastReminderSentAt: null,
  invoiceType: "invoice",
  openBalanceBase,
});
const bill = (id: string, total: number, paid: number, open: number, status = "partial") => ({
  id,
  vendor_name: "V",
  bill_date: "2026-04-12",
  due_date: "2026-05-12",
  currency: "AED",
  total_amount: total,
  amount_paid: paid,
  exchange_rate: 1,
  status,
  open_balance: open,
  open_balance_base: open,
});
const row = (rows: ReturnType<typeof buildComparisonRows>, id: string) =>
  rows.find((r) => r.id === id)!;

describe("F10 server open balances in comparison metrics", () => {
  const overrides: Partial<ComparisonRowsInput> = {
    invoices: [
      inv("part", 1000, "partial", 400), // 600 paid
      inv("cn", 500, "sent", 0), // settled by a credit-note invoice, status still "sent"
      inv("full", 300, "sent", 300),
      inv("paid", 200, "paid", 0),
    ],
    vendorBills: [
      bill("b-part", 800, 300, 500),
      bill("b-settled", 200, 0, 0, "approved"), // settled by a vendor credit application
    ],
  };
  const rows = buildComparisonRows(buildComparisonRowsFixture(overrides));

  it("open receivables equal the sum of server open balances", () => {
    expect(row(rows, "open-receivables").current).toBe(700);
    expect(row(rows, "open-invoice-count").current).toBe(2);
    expect(row(rows, "overdue-receivables").current).toBe(700);
    expect(row(rows, "average-open-invoice-value").current).toBe(350);
  });

  it("open payables equal the sum of server open balances", () => {
    expect(row(rows, "open-payables").current).toBe(500);
    expect(row(rows, "open-bill-count").current).toBe(1);
  });

  it("gap and working-capital metrics follow the server figures", () => {
    expect(row(rows, "open-cash-gap").current).toBe(500 - 700);
    expect(row(rows, "working-capital-proxy").current).toBe(700 - 500);
  });
});
