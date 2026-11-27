/**
 * Pure layout code for two W5 exports: the management-consolidation workbook sheets
 * (W5-C, R14-18) and the FTA Audit File text (W5-A, R12-08a). Figures are fixed inputs;
 * the DB suites (consolidation-groups, faf-export) check them against posted books.
 */
import { describe, expect, it } from "vitest";
import { consolidationSheets } from "../../server/services/consolidation/export";
import type {
  ConsolidatedLine,
  ConsolidatedStatements,
  StatementBlock,
} from "../../server/services/consolidation/engine";
import { FAF_LABEL, renderFafText, type FafFile } from "../../server/services/faf-export.service";

const lineOf = (code: string, total: number, byEntity: Record<string, number>): ConsolidatedLine =>
  ({
    key: code,
    accountCode: code,
    accountName: `Account ${code}`,
    byEntity,
    eliminations: total - Object.values(byEntity).reduce((s, v) => s + v, 0),
    total,
  }) as unknown as ConsolidatedLine;

const block = (total: number, byEntity: Record<string, number> = { p: total }): StatementBlock => ({
  total,
  lines: [lineOf("4000", total, byEntity)],
});

const rate = (r: string) => ({ rate: r, rateType: "closing", date: "2026-03-31" });

function statements(balanced: boolean): ConsolidatedStatements {
  return {
    basis: "management_consolidation",
    label: { en: "Management consolidation", ar: "توحيد إداري" },
    corporateTaxNote: { en: "Corporate tax remains per entity.", ar: "..." },
    group: { id: "g", name: "Group", parentCompanyId: "p", reportingCurrency: "AED" },
    period: { from: "2026-01-01", to: "2026-03-31", fiscalYearStart: "2026-01-01" },
    entities: [
      {
        companyId: "p",
        name: "Parent",
        functionalCurrency: "AED",
        ownershipPercent: 100,
        method: "full",
        included: true,
        effectiveFrom: null,
        effectiveTo: null,
        snapshot: {
          currency: "AED",
          profitAndLoss: { revenue: 100, totalIncome: 100, totalExpenses: 40, netProfit: 60 },
          balanceSheet: {
            totalAssets: 500,
            totalLiabilities: 100,
            totalEquity: 400,
            isBalanced: true,
          },
        },
        translated: {
          totalIncome: 100,
          totalExpenses: 40,
          netProfit: 60,
          totalAssets: 500,
          totalLiabilities: 100,
          capital: 300,
          retainedEarningsBroughtForward: 40,
          currentYearEarnings: 60,
          cta: 0,
          netAssets: 400,
        },
        warnings: [],
      },
      {
        companyId: "s",
        name: "Sub USD",
        functionalCurrency: "USD",
        ownershipPercent: 80,
        method: "full",
        included: false,
        excludedReason: "outside effective dates",
        effectiveFrom: "2027-01-01",
        effectiveTo: null,
        warnings: [],
      },
      {
        companyId: "x",
        name: "Excluded",
        functionalCurrency: "AED",
        ownershipPercent: 10,
        method: "none",
        included: false,
        effectiveFrom: null,
        effectiveTo: null,
        warnings: [],
      },
    ],
    eliminations: [
      {
        id: null,
        kind: "rule",
        mapId: "m",
        label: "Intercompany loan",
        date: "2026-03-31",
        amountA: 50,
        amountB: 48,
        unmatchedDifference: 2,
        lines: [
          {
            companyId: "p",
            companyName: "Parent",
            accountId: "a",
            accountCode: "1500",
            accountName: "Loan to sub",
            debit: 0,
            credit: 50,
          },
        ],
      },
      {
        id: "j1",
        kind: "manual",
        mapId: null,
        label: "Manual",
        date: "2026-03-31",
        lines: [],
      },
    ] as unknown as ConsolidatedStatements["eliminations"],
    translation: {
      reportingCurrency: "AED",
      method: "current_rate",
      rates: [
        {
          companyId: "s",
          currency: "USD",
          closing: rate("3.6725"),
          average: rate("3.67"),
          retainedEarnings: rate("3.6725"),
          historical: [{ date: "2026-01-15", ...rate("3.6725") }],
        },
        {
          companyId: "unknown",
          currency: "EUR",
          closing: rate("4"),
          average: rate("4"),
          retainedEarnings: rate("4"),
          historical: [],
        },
      ],
      cta: { total: 1.5, byEntity: [{ companyId: "s", amount: 1.5 }] },
    },
    consolidated: {
      profitAndLoss: {
        reportingCurrency: "AED",
        from: "2026-01-01",
        to: "2026-03-31",
        sections: {
          revenue: block(100),
          costOfSales: block(20),
          operatingExpenses: block(20),
          otherIncome: block(0),
          otherExpenses: block(0),
        },
        revenue: 100,
        costOfSales: 20,
        grossProfit: 80,
        operatingExpenses: 20,
        operatingProfit: 60,
        otherIncome: 0,
        otherExpenses: 0,
        totalIncome: 100,
        totalExpenses: 40,
        netProfit: 60,
        attributableToOwners: 60,
        attributableToNci: 0,
      },
      balanceSheet: {
        reportingCurrency: "AED",
        asOf: "2026-03-31",
        assets: { current: block(300), nonCurrent: block(200), total: 500 },
        liabilities: { current: block(100), nonCurrent: block(0), total: 100 },
        equity: {
          capital: block(300),
          retainedEarningsBroughtForward: 40,
          currentYearEarnings: 60,
          cumulativeTranslationAdjustment: 1.5,
          total: 400,
          attributableToOwners: 400,
          nonControllingInterest: 0,
        },
        totalAssets: 500,
        totalLiabilities: 100,
        totalEquity: 400,
        totalLiabilitiesAndEquity: balanced ? 500 : 499,
        isBalanced: balanced,
        difference: balanced ? 0 : 1,
      },
    },
    nci: { equity: 0, profit: 0, byEntity: [] },
    warnings: balanced ? [] : ["Unmatched intercompany difference AED 2.00"],
    generatedAt: "2026-04-01T00:00:00.000Z",
  } as ConsolidatedStatements;
}

describe("consolidation workbook sheets", () => {
  it("lays out summary, statements, eliminations, translation and entities", () => {
    const sheets = consolidationSheets(statements(true));
    expect(sheets.map((s) => s.sheetName)).toEqual([
      "Summary",
      "Profit and loss",
      "Balance sheet",
      "Eliminations",
      "Translation",
      "Entities",
    ]);
    const pl = sheets[1];
    // Only included entities get a column.
    expect(pl.columns.map((c) => c.key)).toContain("e_p");
    expect(pl.columns.map((c) => c.key)).not.toContain("e_s");
    expect(pl.rows.find((r) => r.section === "Net profit")?.total).toBe(60);
    const elim = sheets[3].rows;
    expect(elim).toHaveLength(2);
    expect(elim[1]).toMatchObject({ label: "Intercompany loan (match)", unmatched: 2 });
    const translation = sheets[4].rows;
    expect(translation[0]).toMatchObject({ company: "Sub USD", closing: 3.6725, cta: 1.5 });
    expect(translation[1]).toMatchObject({ company: "unknown", cta: 0, historical: "" });
    const entities = sheets[5].rows;
    expect(entities.map((e) => e.included)).toEqual(["yes", "outside effective dates", "no"]);
    expect(sheets[0].rows.find((r) => r.item === "Balanced")?.value).toBe("yes");
  });

  it("reports an unbalanced roll-up and its warnings", () => {
    const summary = consolidationSheets(statements(false))[0].rows;
    expect(summary.find((r) => r.item === "Balanced")?.value).toBe("no (1)");
    expect(summary.find((r) => r.item === "Warning 1")?.value).toMatch(/Unmatched/);
  });
});

describe("FAF text layout", () => {
  const faf: FafFile = {
    label: FAF_LABEL,
    company: {
      name: 'Acme "Trading", LLC',
      trn: "100000000000003",
      taxAgencyName: "",
      taxAgentName: "",
      periodStart: "01/01/2026",
      periodEnd: "31/03/2026",
      fafCreationDate: "01/04/2026",
      productVersion: "Muhasib.ai",
      fafVersion: "FAFv1.0.0",
    },
    purchases: [
      {
        supplierName: "Supplier\nTwo lines",
        supplierTrn: "",
        invoiceDate: "02/01/2026",
        invoiceNo: "B-1",
        permitNo: "",
        transactionId: "t1",
        lineNo: 1,
        productDescription: "Paper",
        purchaseValueFils: 10000,
        vatValueFils: 500,
        taxCode: "SR",
        fcyCode: "AED",
      },
    ],
    supplies: [
      {
        customerName: "Client",
        customerTrn: "100000000000011",
        invoiceDate: "03/01/2026",
        invoiceNo: "INV-1",
        permitNo: "",
        transactionId: "t2",
        lineNo: 1,
        productDescription: "Advice",
        supplyValueFils: 20000,
        vatValueFils: 1000,
        taxCode: "SR",
        country: "AE",
        fcyCode: "AED",
      },
    ],
    generalLedger: [
      {
        transactionDate: "03/01/2026",
        accountId: "4000",
        accountName: "Sales",
        transactionDescription: "Invoice INV-1",
        name: "Client",
        transactionId: "t2",
        sourceDocumentId: "INV-1",
        sourceType: "invoice",
        debitFils: 0,
        creditFils: 20000,
        balanceFils: -20000,
      },
    ],
    totals: {
      purchaseTotalFils: 10000,
      purchaseVatTotalFils: 500,
      purchaseCount: 1,
      supplyTotalFils: 20000,
      supplyVatTotalFils: 1000,
      supplyCount: 1,
      glDebitTotalFils: 0,
      glCreditTotalFils: 20000,
      glCount: 1,
      glCurrency: "AED",
    },
    reconciliation: {
      vat201OutputVatFils: 1000,
      vat201RecoverableVatFils: 500,
      listedSupplyVatFils: 1000,
      listedPurchaseVatFils: 500,
      adjustmentsOutputVatFils: 0,
      adjustmentsRecoverableVatFils: 0,
      supplyVatDifferenceFils: 0,
      purchaseVatDifferenceFils: 0,
      vatComplete: true,
    },
  };

  it("emits the FTA section markers, AED amounts and CSV quoting", () => {
    const text = renderFafText(faf);
    for (const marker of [
      "CompInfoStart",
      "CompInfoEnd",
      "PurcDataStart",
      "PurcDataEnd",
      "SuppDataStart",
      "SuppDataEnd",
      "GLDataStart",
      "GLDataEnd",
    ]) {
      expect(text).toContain(marker);
    }
    expect(text).toContain('"Acme ""Trading"", LLC"');
    expect(text).toContain('"Supplier\nTwo lines"');
    expect(text).toContain("100.00,5.00,SR");
    expect(text).toContain("200.00,10.00,SR");
    expect(text).toContain("-200.00");
  });

  it("S05: guards formula-leading names/descriptions but keeps negative amounts numeric", () => {
    const evil = '=HYPERLINK("http://x","y")';
    const text = renderFafText({
      ...faf,
      purchases: [{ ...faf.purchases[0], supplierName: evil }],
      generalLedger: [{ ...faf.generalLedger[0], transactionDescription: "@SUM(A1)" }],
    });
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(text).toContain("'@SUM(A1)");
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(text).toContain("-200.00");
    expect(text).not.toContain("'-200.00");
  });
});
