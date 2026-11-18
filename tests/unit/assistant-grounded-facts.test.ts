/**
 * AS1 (Fable sign-off 2, A1-A5): the Assistant answers from facts the app's own engines
 * compute, chosen by the question's topic and period; its text carries no citation markers and
 * its amounts are segments the client formats. The engines are stubbed here (behaviour of the
 * selection and formatting); tests/db/assistant-facts.test.ts checks the facts against the real
 * reports.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildAssistantFacts,
  detectIntent,
  factsToShow,
  periodRange,
  renderFactsBlock,
  vatPeriodContaining,
  type AssistantFactDeps,
} from "../../server/services/ai/assistant-facts";
import { segmentAnswer, stripFiller } from "../../server/services/ai/assistant-answer";
import enAssistant from "../../client/src/locales/en/assistant.json";
import arAssistant from "../../client/src/locales/ar/assistant.json";

const COMPANY = "11111111-1111-4111-8111-111111111111";
// 18 Nov 2026, 10:00 in Dubai.
const NOW = new Date("2026-11-18T06:00:00Z");

function stubDeps(over: Partial<AssistantFactDeps> = {}): AssistantFactDeps {
  const pl = (income: number, expenses: number) =>
    ({
      totalIncome: income,
      totalExpenses: expenses,
      netProfit: income - expenses,
      sections: {
        costOfSales: { total: 0, lines: [] },
        operatingExpenses: {
          total: expenses,
          lines: [
            {
              accountId: "a1",
              accountCode: "5010",
              accountName: "Rent",
              accountNameAr: "الإيجار",
              amount: expenses * 0.6,
            },
            {
              accountId: "a2",
              accountCode: "5020",
              accountName: "Salaries",
              accountNameAr: "الرواتب",
              amount: expenses * 0.4,
            },
          ],
        },
        otherExpenses: { total: 0, lines: [] },
      },
    }) as never;
  return {
    grounding: vi.fn(async () => ({
      companyName: "Report Audit Trading",
      period: { start: "2026-01-01", end: "2026-11-18" },
      figures: [
        {
          id: "F1",
          label: "Revenue (fiscal year to date)",
          value: 200000,
          unit: "AED" as const,
          source: "P&L",
        },
        {
          id: "F2",
          label: "Expenses (fiscal year to date)",
          value: 168339.15,
          unit: "AED" as const,
          source: "P&L",
        },
        {
          id: "F3",
          label: "Net profit (fiscal year to date)",
          value: 31660.85,
          unit: "AED" as const,
          source: "P&L",
        },
      ],
      missing: [],
      insufficientData: false,
    })),
    profitAndLoss: vi.fn(async ({ from }) =>
      from === "2026-11-01" ? pl(96638, 74711.22) : pl(1, 1)
    ),
    agedReceivables: vi.fn(async () => ({
      reportCurrency: "AED",
      asOf: "2026-11-18",
      type: "receivable",
      rows: [
        {
          id: "c1",
          name: "Gulf Foods",
          type: "receivable",
          current: 1000,
          days30: 9000,
          days60: 0,
          days90: 0,
          over90: 0,
          total: 10000,
          currency: "AED",
        },
        {
          id: "c2",
          name: "Desert Labs",
          type: "receivable",
          current: 45480.5,
          days30: 0,
          days60: 0,
          days90: 0,
          over90: 0,
          total: 45480.5,
          currency: "AED",
        },
      ],
      documents: [
        {
          documentId: "i3",
          number: "INV-2026-00003",
          name: "Gulf Foods",
          date: "2026-09-03",
          dueDate: "2026-10-03",
          currency: "AED",
          daysPastDue: 46,
          bucket: "days30",
          open: 9000,
        },
        {
          documentId: "i5",
          number: "INV-2026-00005",
          name: "Gulf Foods",
          date: "2026-10-18",
          dueDate: "2026-11-17",
          currency: "AED",
          daysPastDue: 1,
          bucket: "days30",
          open: 1000,
        },
        {
          documentId: "i7",
          number: "INV-2026-00007",
          name: "Desert Labs",
          date: "2026-11-10",
          dueDate: "2026-12-10",
          currency: "AED",
          daysPastDue: 0,
          bucket: "current",
          open: 45480.5,
        },
      ],
      totals: { current: 46480.5, days30: 9000, days60: 0, days90: 0, over90: 0, total: 55480.5 },
    })) as never,
    agedPayables: vi.fn(async () => ({ documents: [], rows: [], totals: { total: 0 } })) as never,
    cashAccounts: vi.fn(async () => [
      { accountName: "Emirates NBD current", accountCode: "1020", balance: 40250.75 },
      { accountName: "Petty cash", accountCode: "1010", balance: 500 },
    ]),
    vatCompany: vi.fn(async () => ({
      id: COMPANY,
      name: "Report Audit Trading",
      trn: "100000000000003",
      emirate: "dubai",
      frequency: "quarterly",
      startMonth: 1,
      exemptSupplyRatio: 0,
      partialExemptionEnabled: false,
      baseCurrency: "AED",
    })) as never,
    computeVat201: vi.fn(async ({ from, to }) => ({
      period: { from, to, dueDate: from === "2026-10-01" ? "2027-01-28" : "2026-10-28" },
      boxes:
        from === "2026-10-01"
          ? { box12TotalDueTax: 3232.5, box13RecoverableTax: 2692.5, box14PayableTax: 540 }
          : { box12TotalDueTax: 4100, box13RecoverableTax: 1100, box14PayableTax: 3000 },
      complete: true,
    })) as never,
    ctPreview: vi.fn(async () => ({
      liability: { accountingProfit: 31660.85, taxableIncome: 31660.85, taxPayable: 0 },
      sbrEligible: true,
    })) as never,
    query: vi.fn(async (sql: string) => {
      if (sql.includes("vat_returns")) return { rows: [{ status: "filed" }] };
      if (sql.includes("COUNT(*)")) return { rows: [{ n: 2, total: 735 }] };
      return {
        rows: [
          { id: "r1", merchant: "ADNOC", date: "2026-11-12", amount: 210 },
          { id: "r2", merchant: "Carrefour", date: "2026-11-02", amount: 525 },
        ],
      };
    }),
    ...over,
  };
}

const keysOf = (f: { facts: Array<{ key: string }> }) => f.facts.map((x) => x.key);

describe("AS1 intent: every suggested question has a topic", () => {
  const SUGGESTIONS = [
    "assistant.suggestOverdue",
    "assistant.suggestVat",
    "assistant.suggestTopExpenses",
    "assistant.suggestProfit",
    "assistant.suggestOwesMost",
    "assistant.suggestUnposted",
  ] as const;
  const EXPECTED = ["overdue_invoices", "vat", "expenses", "profit", "customers", "receipts"];

  it.each(["en", "ar"] as const)("%s chips map to the topic they promise", (lang) => {
    const catalog = (lang === "en" ? enAssistant : arAssistant) as Record<string, string>;
    SUGGESTIONS.forEach((key, i) => {
      expect(detectIntent(catalog[key]).topics, catalog[key]).toContain(EXPECTED[i]);
    });
    expect(detectIntent(catalog["assistant.suggestVat"]).period).toBe("this_quarter");
    expect(detectIntent(catalog["assistant.suggestProfit"]).period).toBe("this_year");
    // "How much VAT do I owe" is not a bills question.
    expect(detectIntent(catalog["assistant.suggestVat"]).topics).not.toContain("bills");
  });

  it("reads Fable's month question and other periods in both languages", () => {
    expect(detectIntent("كم ربحي هذا الشهر؟")).toEqual({
      topics: ["profit"],
      period: "this_month",
    });
    expect(detectIntent("What was my VAT last quarter?").period).toBe("last_quarter");
    expect(detectIntent("ما رصيدي في البنك؟").topics).toContain("cash");
    expect(detectIntent("How much corporate tax will I pay?").topics).toEqual(["corporate_tax"]);
    expect(detectIntent("Which bills are overdue?").topics).toEqual(["bills"]);
    expect(detectIntent("Tell me a joke").topics).toEqual([]);
  });

  it("resolves periods on the UAE calendar and the company's VAT stagger", () => {
    expect(periodRange("this_month", "2026-11-18", "2026-01-01")).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(periodRange("last_quarter", "2026-11-18", "2026-01-01")).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(periodRange("last_month", "2026-01-05", "2026-01-01")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(periodRange("this_year", "2026-11-18", "2026-04-01")).toEqual({
      from: "2026-04-01",
      to: "2026-11-18",
    });
    expect(vatPeriodContaining("2026-11-18", "quarterly", 1)).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
    });
    expect(vatPeriodContaining("2026-01-10", "quarterly", 2)).toEqual({
      from: "2025-11-01",
      to: "2026-01-31",
    });
    expect(vatPeriodContaining("2026-11-18", "monthly", 1)).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });
});

describe("AS1 facts are selected by topic and period", () => {
  it("VAT this quarter: computeVat201 for the current and the last VAT period", async () => {
    const deps = stubDeps();
    const f = await buildAssistantFacts(COMPANY, "How much VAT do I owe this quarter?", {
      now: NOW,
      deps,
    });
    expect(deps.computeVat201).toHaveBeenCalledWith({
      companyId: COMPANY,
      from: "2026-10-01",
      to: "2026-12-31",
    });
    expect(deps.computeVat201).toHaveBeenCalledWith({
      companyId: COMPANY,
      from: "2026-07-01",
      to: "2026-09-30",
    });
    const vat = f.facts.filter((x) => x.topic === "vat");
    expect(vat.map((x) => [x.key, x.value])).toEqual([
      ["vatOutput", 3232.5],
      ["vatInput", 2692.5],
      ["vatNet", 540],
      ["vatOutput", 4100],
      ["vatInput", 1100],
      ["vatNet", 3000],
    ]);
    expect(vat[2].params).toMatchObject({
      from: "2026-10-01",
      to: "2026-12-31",
      due: "2027-01-28",
    });
    expect(renderFactsBlock(f)).toMatch(
      /last VAT period 2026-07-01 to 2026-09-30, return status filed/
    );
    // Shown under the answer: the VAT facts, not the year-to-date summary.
    expect(factsToShow(f, new Set()).every((x) => x.topic === "vat")).toBe(true);
  });

  it("overdue invoices: the overdue documents with due dates, longest overdue first", async () => {
    const f = await buildAssistantFacts(COMPANY, "Which invoices are overdue?", {
      now: NOW,
      deps: stubDeps(),
    });
    const docs = f.facts.filter((x) => x.key === "invoiceOverdue");
    expect(docs.map((d) => d.params?.number)).toEqual(["INV-2026-00003", "INV-2026-00005"]);
    expect(docs[0].params).toMatchObject({ due: "2026-10-03", days: 46, name: "Gulf Foods" });
    expect(f.facts.find((x) => x.key === "overdueInvoicesTotal")?.value).toBe(10000);
    expect(f.facts.find((x) => x.key === "openInvoicesTotal")?.value).toBe(55480.5);
    expect(keysOf(f)).not.toContain("invoiceOpen");
  });

  it("profit this month: the P&L for the calendar month; this year reuses the summary", async () => {
    const deps = stubDeps();
    const month = await buildAssistantFacts(COMPANY, "كم ربحي هذا الشهر؟", { now: NOW, deps });
    expect(deps.profitAndLoss).toHaveBeenCalledWith({
      companyId: COMPANY,
      from: "2026-11-01",
      to: "2026-11-30",
    });
    const shown = factsToShow(month, new Set());
    expect(shown.map((x) => [x.key, x.value])).toEqual([
      ["income", 96638],
      ["expenses", 74711.22],
      ["netProfit", 21926.78],
    ]);
    const year = await buildAssistantFacts(COMPANY, "How much profit have I made this year?", {
      now: NOW,
      deps: stubDeps(),
    });
    const yearShown = factsToShow(year, new Set());
    expect(yearShown.find((x) => x.key === "netProfit")?.value).toBe(31660.85);
    expect(yearShown.filter((x) => x.key === "netProfit")).toHaveLength(1);
  });

  it("biggest expenses, customers, unposted receipts, cash and corporate tax", async () => {
    const exp = await buildAssistantFacts(COMPANY, "What are my biggest expenses this year?", {
      now: NOW,
      deps: stubDeps(),
    });
    expect(
      exp.facts.filter((x) => x.key === "expenseAccount").map((x) => x.params?.nameAr)
    ).toEqual(["الإيجار", "الرواتب"]);
    const cust = await buildAssistantFacts(COMPANY, "Which customers owe me the most?", {
      now: NOW,
      deps: stubDeps(),
    });
    expect(cust.facts.filter((x) => x.key === "customerOwes").map((x) => x.params?.name)).toEqual([
      "Desert Labs",
      "Gulf Foods",
    ]);
    const rc = await buildAssistantFacts(COMPANY, "Which receipts are not posted yet?", {
      now: NOW,
      deps: stubDeps(),
    });
    expect(rc.facts.filter((x) => x.key === "unpostedReceipt").map((x) => x.params?.name)).toEqual([
      "ADNOC",
      "Carrefour",
    ]);
    expect(rc.facts.find((x) => x.key === "unpostedReceiptsCount")?.value).toBe(2);
    const cash = await buildAssistantFacts(COMPANY, "How much cash do I have?", {
      now: NOW,
      deps: stubDeps(),
    });
    expect(cash.facts.find((x) => x.key === "cashTotal")?.value).toBe(40750.75);
    const ct = await buildAssistantFacts(COMPANY, "What is my corporate tax estimate?", {
      now: NOW,
      deps: stubDeps(),
    });
    expect(ct.facts.find((x) => x.key === "ctEstimate")?.value).toBe(0);
  });

  it("what cannot be answered says what is missing and where to add it", async () => {
    const deps = stubDeps({
      vatCompany: vi.fn(async () => ({
        trn: null,
        frequency: "quarterly",
        startMonth: 1,
      })) as never,
      cashAccounts: vi.fn(async () => []),
    });
    const vat = await buildAssistantFacts(COMPANY, "How much VAT do I owe?", { now: NOW, deps });
    expect(vat.missing).toEqual([
      expect.objectContaining({ key: "vatNotSetUp", href: "/settings/company" }),
    ]);
    const cash = await buildAssistantFacts(COMPANY, "What is my bank balance?", { now: NOW, deps });
    expect(cash.missing.map((m) => m.key)).toEqual(["noBankAccounts"]);
    const broken = await buildAssistantFacts(COMPANY, "VAT due?", {
      now: NOW,
      deps: stubDeps({ computeVat201: vi.fn(async () => Promise.reject(new Error("db down"))) }),
    });
    expect(broken.missing.map((m) => m.key)).toContain("vatIncomplete");
    const other = await buildAssistantFacts(COMPANY, "Tell me a joke", {
      now: NOW,
      deps: stubDeps(),
    });
    expect(other.missing.map((m) => m.key)).toEqual(["unknownTopic"]);
  });
});

describe("AS1 answer text: no markers, amounts as segments, no filler", () => {
  const facts = [
    { id: "F3", value: 31660.85, unit: "AED" as const },
    { id: "F6", value: 55480.5, unit: "AED" as const },
    { id: "F7", value: 5, unit: "count" as const },
  ];

  it("A2: citations after an amount are dropped; a lone marker becomes its figure", () => {
    const { segments, cited, plain } = segmentAnswer(
      "You have 5 open invoices [F7] worth AED 55,480.5 [F6, F7]. Profit so far is [F3].",
      facts
    );
    expect(cited).toEqual(["F7", "F6", "F3"]);
    expect(plain).not.toMatch(/\[F/);
    expect(segments).toEqual([
      { type: "text", text: "You have 5 open invoices worth " },
      { type: "money", value: 55480.5, currency: "AED" },
      { type: "text", text: ". Profit so far is " },
      { type: "money", value: 31660.85, currency: "AED" },
      { type: "text", text: "." },
    ]);
  });

  it("A3: Arabic amounts (currency after, Arabic-Indic digits) become money segments", () => {
    const { segments } = segmentAnswer("صافي ربحك ٣١٬٦٦٠٫٨٥ د.إ [F3] هذا العام.", facts);
    expect(segments).toContainEqual({ type: "money", value: 31660.85, currency: "AED" });
    expect(segments.map((s) => (s.type === "text" ? s.text : "#")).join("")).toBe(
      "صافي ربحك # هذا العام."
    );
    const aedFirst = segmentAnswer("الربح AED 31,660.85 [F3].", facts).segments;
    expect(aedFirst[1]).toEqual({ type: "money", value: 31660.85, currency: "AED" });
  });

  it("A5: closing filler and 'consult a professional' lines are removed", () => {
    expect(
      stripFiller(
        "Net profit is AED 10.00. For personalized professional advice, consult a qualified professional. Feel free to ask!"
      )
    ).toBe("Net profit is AED 10.00.");
    expect(stripFiller("الربح 10 د.إ. لا تتردد في السؤال!")).toBe("الربح 10 د.إ.");
  });

  it("invoice numbers and dates are not taken for amounts", () => {
    const { segments } = segmentAnswer("INV-2026-00003 was due 2026-10-03 (AED 9,000.00).", facts);
    expect(segments.filter((s) => s.type === "money")).toEqual([
      { type: "money", value: 9000, currency: "AED" },
    ]);
    expect((segments[0] as { text: string }).text).toContain("INV-2026-00003 was due 2026-10-03");
  });

  it("a second citation of a figure already given (after a date) adds no second amount", () => {
    const { segments } = segmentAnswer(
      "Net VAT payable is AED 540.00 [F3]. It is due to the FTA by 2027-01-28 [F3].",
      [{ id: "F3", value: 540, unit: "AED" }]
    );
    expect(segments.filter((s) => s.type === "money")).toHaveLength(1);
    expect(segments[segments.length - 1]).toEqual({
      type: "text",
      text: ". It is due to the FTA by 2027-01-28.",
    });
  });
});

describe("AS1 VAT: the last period is background", () => {
  it("is left out of 'this quarter' when it had no VAT, kept when asked for", async () => {
    const empty = stubDeps({
      computeVat201: vi.fn(async ({ from, to }) => ({
        period: { from, to, dueDate: "2027-01-28" },
        boxes:
          from === "2026-10-01"
            ? { box12TotalDueTax: 3232.5, box13RecoverableTax: 2692.5, box14PayableTax: 540 }
            : { box12TotalDueTax: 0, box13RecoverableTax: 0, box14PayableTax: 0 },
        complete: true,
      })) as never,
    });
    const now = await buildAssistantFacts(COMPANY, "VAT this quarter?", { now: NOW, deps: empty });
    expect(now.facts.filter((x) => x.topic === "vat").map((x) => x.params?.from)).toEqual([
      "2026-10-01",
      "2026-10-01",
      "2026-10-01",
    ]);
    const last = await buildAssistantFacts(COMPANY, "VAT last quarter?", { now: NOW, deps: empty });
    expect(last.facts.filter((x) => x.topic === "vat").map((x) => x.value)).toEqual([0, 0, 0]);
  });
});
