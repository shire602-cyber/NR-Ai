/** Workbook sheets for a management consolidation (xlsx / csv via server/reporting/http). */
import type { GenericExportSheet } from "../excel-export.service";
import type { ConsolidatedLine, ConsolidatedStatements, StatementBlock } from "./engine";

export function consolidationSheets(s: ConsolidatedStatements): GenericExportSheet[] {
  const included = s.entities.filter((e) => e.included);
  const entityCols = included.map((e) => ({
    header: `${e.name} (${s.group.reportingCurrency})`,
    key: `e_${e.companyId}`,
    width: 18,
  }));
  const lineColumns = [
    { header: "Section", key: "section", width: 22 },
    { header: "Code", key: "code", width: 10 },
    { header: "Account", key: "account", width: 34 },
    ...entityCols,
    { header: "Eliminations", key: "eliminations", width: 16 },
    { header: "Consolidated", key: "total", width: 18 },
  ];
  const lineRow = (section: string, l: ConsolidatedLine) => ({
    section,
    code: l.accountCode,
    account: l.accountName,
    ...Object.fromEntries(included.map((e) => [`e_${e.companyId}`, l.byEntity[e.companyId] ?? 0])),
    eliminations: l.eliminations,
    total: l.total,
  });
  const totalRow = (label: string, total: number) => ({ section: label, total });
  const block = (label: string, b: StatementBlock) => [
    ...b.lines.map((l) => lineRow(label, l)),
    totalRow(`Total ${label.toLowerCase()}`, b.total),
  ];

  const pl = s.consolidated.profitAndLoss;
  const bs = s.consolidated.balanceSheet;
  return [
    {
      sheetName: "Summary",
      columns: [
        { header: "Item", key: "item", width: 40 },
        { header: "Value", key: "value", width: 60 },
      ],
      rows: [
        { item: "Basis", value: s.label.en },
        { item: "Group", value: s.group.name },
        { item: "Reporting currency", value: s.group.reportingCurrency },
        { item: "Period", value: `${s.period.from} to ${s.period.to}` },
        { item: "Corporate tax", value: s.corporateTaxNote.en },
        { item: "Translation method", value: s.translation.method },
        { item: "Net profit", value: pl.netProfit },
        { item: "Attributable to owners", value: pl.attributableToOwners },
        { item: "Attributable to non-controlling interest", value: pl.attributableToNci },
        { item: "Total assets", value: bs.totalAssets },
        { item: "Total equity", value: bs.totalEquity },
        {
          item: "Cumulative translation adjustment",
          value: bs.equity.cumulativeTranslationAdjustment,
        },
        { item: "Non-controlling interest", value: bs.equity.nonControllingInterest },
        { item: "Balanced", value: bs.isBalanced ? "yes" : `no (${bs.difference})` },
        { item: "Generated at", value: s.generatedAt },
        ...s.warnings.map((w, i) => ({ item: `Warning ${i + 1}`, value: w })),
      ],
    },
    {
      sheetName: "Profit and loss",
      columns: lineColumns,
      rows: [
        ...block("Revenue", pl.sections.revenue),
        ...block("Cost of sales", pl.sections.costOfSales),
        totalRow("Gross profit", pl.grossProfit),
        ...block("Operating expenses", pl.sections.operatingExpenses),
        totalRow("Operating profit", pl.operatingProfit),
        ...block("Other income", pl.sections.otherIncome),
        ...block("Other expenses", pl.sections.otherExpenses),
        totalRow("Net profit", pl.netProfit),
        totalRow("Attributable to owners of the parent", pl.attributableToOwners),
        totalRow("Attributable to non-controlling interest", pl.attributableToNci),
      ],
    },
    {
      sheetName: "Balance sheet",
      columns: lineColumns,
      rows: [
        ...block("Current assets", bs.assets.current),
        ...block("Non-current assets", bs.assets.nonCurrent),
        totalRow("Total assets", bs.totalAssets),
        ...block("Current liabilities", bs.liabilities.current),
        ...block("Non-current liabilities", bs.liabilities.nonCurrent),
        totalRow("Total liabilities", bs.totalLiabilities),
        ...block("Capital", bs.equity.capital),
        totalRow("Retained earnings brought forward", bs.equity.retainedEarningsBroughtForward),
        totalRow("Current year earnings", bs.equity.currentYearEarnings),
        totalRow("Cumulative translation adjustment", bs.equity.cumulativeTranslationAdjustment),
        totalRow("Total equity", bs.totalEquity),
        totalRow("Attributable to owners of the parent", bs.equity.attributableToOwners),
        totalRow("Non-controlling interest", bs.equity.nonControllingInterest),
        totalRow("Total liabilities and equity", bs.totalLiabilitiesAndEquity),
      ],
    },
    {
      sheetName: "Eliminations",
      columns: [
        { header: "Kind", key: "kind", width: 10 },
        { header: "Label", key: "label", width: 32 },
        { header: "Date", key: "date", width: 12 },
        { header: "Company", key: "company", width: 26 },
        { header: "Code", key: "code", width: 10 },
        { header: "Account", key: "account", width: 30 },
        { header: "Debit", key: "debit", width: 14 },
        { header: "Credit", key: "credit", width: 14 },
        { header: "Side A", key: "amountA", width: 14 },
        { header: "Side B", key: "amountB", width: 14 },
        { header: "Unmatched difference", key: "unmatched", width: 18 },
      ],
      rows: s.eliminations.flatMap((e) => [
        ...e.lines.map((l) => ({
          kind: e.kind,
          label: e.label,
          date: e.date,
          company: l.companyName,
          code: l.accountCode,
          account: l.accountName,
          debit: l.debit,
          credit: l.credit,
        })),
        ...(e.kind === "rule"
          ? [
              {
                kind: e.kind,
                label: `${e.label} (match)`,
                date: e.date,
                amountA: e.amountA,
                amountB: e.amountB,
                unmatched: e.unmatchedDifference,
              },
            ]
          : []),
      ]),
    },
    {
      sheetName: "Translation",
      columns: [
        { header: "Company", key: "company", width: 28 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Closing rate", key: "closing", width: 14 },
        { header: "Closing date", key: "closingDate", width: 12 },
        { header: "Average rate", key: "average", width: 14 },
        { header: "Average date", key: "averageDate", width: 12 },
        { header: "RE b/f rate", key: "re", width: 14 },
        { header: "Historical rates", key: "historical", width: 40 },
        { header: "CTA", key: "cta", width: 14 },
      ],
      rows: s.translation.rates.map((r) => ({
        company: s.entities.find((e) => e.companyId === r.companyId)?.name ?? r.companyId,
        currency: r.currency,
        closing: Number(r.closing.rate),
        closingDate: r.closing.date,
        average: Number(r.average.rate),
        averageDate: r.average.date,
        re: Number(r.retainedEarnings.rate),
        historical: r.historical.map((h) => `${h.date}: ${h.rate}`).join("; "),
        cta: s.translation.cta.byEntity.find((c) => c.companyId === r.companyId)?.amount ?? 0,
      })),
    },
    {
      sheetName: "Entities",
      columns: [
        { header: "Company", key: "name", width: 28 },
        { header: "Functional currency", key: "currency", width: 12 },
        { header: "Ownership %", key: "ownership", width: 12 },
        { header: "Method", key: "method", width: 10 },
        { header: "Included", key: "included", width: 10 },
        { header: "Net profit (functional)", key: "np", width: 18 },
        { header: "Total assets (functional)", key: "ta", width: 18 },
        { header: "Net profit (reporting)", key: "npT", width: 18 },
        { header: "Net assets (reporting)", key: "naT", width: 18 },
      ],
      rows: s.entities.map((e) => ({
        name: e.name,
        currency: e.functionalCurrency,
        ownership: e.ownershipPercent,
        method: e.method,
        included: e.included ? "yes" : (e.excludedReason ?? "no"),
        np: e.snapshot?.profitAndLoss.netProfit,
        ta: e.snapshot?.balanceSheet.totalAssets,
        npT: e.translated?.netProfit,
        naT: e.translated?.netAssets,
      })),
    },
  ];
}
