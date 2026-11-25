/**
 * AS1 (Fable sign-off 2): the Assistant's facts equal the app's own reports, on the real app and
 * Postgres. The facts are built in-process (`buildAssistantFacts`, no AI call); the reports are
 * read through their routes. Also the accounting check on the VAT box map: a domestic
 * reverse-charge sale is reported by the supplier in Box 1 of its emirate, value only, no VAT.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, postJournalEntry, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
const BUYER_TRN = "100000000000011";

const isoDay = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
const daysFromToday = (n: number) => isoDay(new Date(Date.now() + n * 86_400_000));

async function vatTenant(columns: Record<string, unknown> = {}) {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      ...columns,
    },
  });
}

async function issuedInvoice(t: Tenant, body: Record<string, unknown>) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Gulf Foods LLC",
    placeOfSupplyEmirate: "dubai",
    ...body,
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string; number: string; total: number };
}

async function facts(t: Tenant, question: string) {
  const { buildAssistantFacts } = await import("../../server/services/ai/assistant-facts");
  return buildAssistantFacts(t.company.id, question);
}

const valueOf = (f: { facts: Array<{ key: string; value: number; topic: string }> }, key: string) =>
  f.facts.find((x) => x.key === key && x.topic !== "summary")?.value;

describe("AS1 Assistant facts equal the reports", () => {
  it("AS1-A1 VAT this quarter equals the VAT summary (computeVat201) for the current period", async () => {
    const t = await vatTenant();
    await issuedInvoice(t, {
      date: daysFromToday(0),
      dueDate: daysFromToday(30),
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 2000, vatRate: 5 }],
    });
    const f = await facts(t, "How much VAT do I owe this quarter?");
    const current = f.facts.find((x) => x.key === "vatOutput")!;
    const from = String(current.params!.from);
    const to = String(current.params!.to);
    const report = await t.as.get(
      `/api/companies/${t.company.id}/reports/vat-summary?from=${from}&to=${to}`
    );
    expect(report.status, report.text).toBe(200);
    expect(current.value).toBe(report.body.salesVAT);
    expect(current.value).toBe(100);
    expect(valueOf(f, "vatInput")).toBe(report.body.purchasesVAT);
    expect(valueOf(f, "vatNet")).toBe(report.body.netVATPayable);
    // The period is the company's own stagger and contains today.
    expect(from <= daysFromToday(0) && daysFromToday(0) <= to).toBe(true);
  });

  it("AS1-A1 overdue invoices and open totals equal aged receivables (settlement)", async () => {
    const t = await vatTenant();
    const late = await issuedInvoice(t, {
      date: daysFromToday(-40),
      dueDate: daysFromToday(-10),
      lines: [{ description: "Late", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    const bank = await accountByCode(t, "1020");
    const paidPart = await t.as.post(
      `/api/companies/${t.company.id}/invoices/${late.id}/payments`,
      { amount: 300, date: daysFromToday(-5), paymentAccountId: bank.id }
    );
    expect(paidPart.status, paidPart.text).toBe(201);
    await issuedInvoice(t, {
      customerName: "Desert Labs LLC",
      date: daysFromToday(0),
      dueDate: daysFromToday(30),
      lines: [{ description: "Not due", quantity: 1, unitPrice: 4000, vatRate: 5 }],
    });
    const f = await facts(t, "Which invoices are overdue?");
    const ar = await t.as.get(
      `/api/companies/${t.company.id}/reports/aged-receivables?asOf=${daysFromToday(0)}`
    );
    expect(ar.status, ar.text).toBe(200);
    expect(valueOf(f, "openInvoicesTotal")).toBe(ar.body.totals.total);
    const overdue = f.facts.filter((x) => x.key === "invoiceOverdue");
    expect(overdue.map((x) => x.params!.number)).toEqual([late.number]);
    const lateDoc = (ar.body.documents as Array<{ number: string; open: number }>).find(
      (d) => d.number === late.number
    )!;
    expect(overdue[0].value).toBe(lateDoc.open);
    // A part payment recorded through the settlement seam reduces the open amount.
    expect(overdue[0].value).toBe(750);
    expect(overdue[0].params).toMatchObject({ due: daysFromToday(-10), days: 10 });
    // Customers who owe the most: the aging rows, largest first.
    const c = await facts(t, "Which customers owe me the most?");
    expect(c.facts.filter((x) => x.key === "customerOwes").map((x) => x.value)).toEqual(
      (ar.body.rows as Array<{ total: number }>).map((r) => r.total).sort((a, b) => b - a)
    );
  });

  it("AS1-A1 profit this month and this year equal the P&L report for the same range", async () => {
    const t = await vatTenant();
    await issuedInvoice(t, {
      date: daysFromToday(0),
      dueDate: daysFromToday(30),
      lines: [{ description: "Work", quantity: 1, unitPrice: 5000, vatRate: 5 }],
    });
    for (const [q, key] of [
      ["How much profit did I make this month?", "this_month"],
      ["كم ربحت هذا العام؟", "this_year"],
    ] as const) {
      const f = await facts(t, q);
      expect(f.intent.period).toBe(key);
      const { factsToShow } = await import("../../server/services/ai/assistant-facts");
      const shown = factsToShow(f, new Set());
      const net = shown.find((x) => x.key === "netProfit")!;
      const pl = await t.as.get(
        `/api/companies/${t.company.id}/reports/profit-loss?from=${net.params!.from}&to=${net.params!.to}`
      );
      expect(pl.status, pl.text).toBe(200);
      expect(net.value).toBe(pl.body.netProfit);
      expect(shown.find((x) => x.key === "income")!.value).toBe(pl.body.totalIncome);
      expect(net.value).toBe(5000);
    }
  });

  it("AS1-A1 cash and bank equals the cash-accounts report; facts are tenant-scoped", async () => {
    const t = await vatTenant();
    const other = await vatTenant();
    await issuedInvoice(other, {
      date: daysFromToday(0),
      dueDate: daysFromToday(-1),
      lines: [{ description: "Other tenant", quantity: 1, unitPrice: 999, vatRate: 5 }],
    });
    await postJournalEntry(t, {
      date: daysFromToday(-1),
      description: "Owner capital",
      lines: [
        { code: "1020", debit: 12500.5 },
        { code: "3010", credit: 12500.5 },
      ],
    });
    const f = await facts(t, "How much cash do I have in the bank?");
    const cash = await t.as.get(
      `/api/companies/${t.company.id}/reports/cash-accounts?asOf=${daysFromToday(0)}`
    );
    expect(cash.status, cash.text).toBe(200);
    const rows = cash.body.accounts as Array<{ balance: number }>;
    const total = Math.round(rows.reduce((s, r) => s + r.balance, 0) * 100) / 100;
    expect(total).toBe(12500.5);
    expect(valueOf(f, "cashTotal")).toBe(total);
    // Another tenant's overdue invoice never reaches this company's facts.
    const inv = await facts(t, "Which invoices are overdue?");
    expect(inv.facts.some((x) => x.key === "invoiceOverdue")).toBe(false);
    expect(inv.missing.map((m) => m.key)).toContain("noOpenInvoices");
  });
});

describe("AS1 accounting check: domestic reverse-charge sales in the VAT 201", () => {
  it("AS1-RC a reverse-charge sale (Art. 48) is Box 1 of the emirate, value only, no output VAT", async () => {
    const t = await vatTenant();
    const inv = await issuedInvoice(t, {
      customerName: "Bullion Buyer LLC",
      customerTrn: BUYER_TRN,
      date: daysFromToday(0),
      dueDate: daysFromToday(30),
      reverseCharge: true,
      lines: [
        {
          description: "Gold bar",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0,
          vatSupplyType: "reverse_charge",
        },
      ],
    });
    expect(inv.total).toBe(1000);
    const { computeVat201, loadVatCompany } = await import("../../server/tax/vat-engine");
    const { periodContaining } = await import("../../server/tax/vat-periods");
    const company = await loadVatCompany(t.company.id);
    const p = periodContaining(daysFromToday(0), company.frequency, company.startMonth);
    const vat = await computeVat201({ companyId: t.company.id, ...p, allowIncomplete: true });
    // FTA VAT 201 guidance: the supplier reports the value of a domestic reverse-charge supply
    // in Box 1 for its emirate with no VAT; the recipient self-accounts in Box 3 (and Box 10).
    expect(vat.boxes.box1bDubaiAmount).toBe(1000);
    expect(vat.boxes.box1bDubaiVat).toBe(0);
    expect(vat.boxes.box3ReverseChargeAmount).toBe(0);
    expect(vat.boxes.box3ReverseChargeVat).toBe(0);
    expect(vat.boxes.box12TotalDueTax).toBe(0);

    // Settings > Tax rates shows the same mapping, read from the same engine functions.
    const rates = await t.as.get(`/api/companies/${t.company.id}/tax-rates`);
    expect(rates.status, rates.text).toBe(200);
    const rc = (
      rates.body.rows as Array<{ side: string; treatment: string; boxes: unknown[] }>
    ).find((r) => r.side === "sales" && r.treatment === "reverse_charge")!;
    expect(rc.boxes).toEqual([{ box: "1b", part: "amount", key: "box1bDubaiAmount" }]);
    const rcBuy = (
      rates.body.rows as Array<{ side: string; treatment: string; boxes: Array<{ box: string }> }>
    ).find((r) => r.side === "purchases" && r.treatment === "reverse_charge")!;
    expect(rcBuy.boxes.map((b) => b.box)).toEqual(["3", "3", "10", "10"]);
  });
});
