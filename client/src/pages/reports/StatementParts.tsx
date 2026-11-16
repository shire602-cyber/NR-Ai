/**
 * Small statement building blocks for the Reports page (W5-A):
 * - ProfitLossSections: renders the kernel's P&L `sections` split (revenue, cost of sales,
 *   gross profit, operating expenses, operating profit, other income/expenses, net profit).
 * - BalanceCheck: shows the kernel's `isBalanced` / `difference` flag.
 * - StatementDownloads: server-rendered PDF / Excel for a statement (R11-12).
 * - DataBasisBadge: "Indicator" badge for document/snapshot-based reports (R12-13).
 */
import { Download, FileText, ScrollText } from "lucide-react";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { apiUrl } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { formatMessage, useTranslation } from "@/lib/i18n";
import type { ReportDataBasis } from "@/lib/reportCatalog";

export interface PlSectionLine {
  accountId?: string;
  accountCode: string;
  accountName: string;
  accountNameAr?: string | null;
  amount: number;
}

export interface PlSection {
  total: number;
  lines: PlSectionLine[];
}

export interface PlSectionsPayload {
  sections?: {
    revenue: PlSection;
    costOfSales: PlSection;
    operatingExpenses: PlSection;
    otherIncome: PlSection;
    otherExpenses: PlSection;
  };
  grossProfit?: number;
  operatingProfit?: number;
  netProfit: number;
}

function SectionTable({
  titleKey,
  section,
  totalKey,
  locale,
  tone,
}: {
  titleKey: string;
  section: PlSection;
  totalKey: string;
  locale: string;
  tone: "success" | "destructive" | "muted";
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "";
  if (section.lines.length === 0 && section.total === 0) return null;
  return (
    <div>
      <h3 className={`font-semibold mb-3 ${toneClass}`}>
        <T k={titleKey} />
      </h3>
      <Table>
        <TableBody>
          {section.lines.map((item, index) => (
            <TableRow key={item.accountId ?? `${item.accountCode}-${index}`}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {item.accountCode || "-"}
              </TableCell>
              <TableCell>
                {locale === "ar" && item.accountNameAr ? item.accountNameAr : item.accountName}
              </TableCell>
              <TableCell className="text-right font-mono font-medium">
                {formatCurrency(item.amount ?? 0, "AED", locale)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2">
            <TableCell colSpan={2} className="font-semibold">
              <T k={totalKey} />
            </TableCell>
            <TableCell className="text-right font-mono font-semibold">
              {formatCurrency(section.total, "AED", locale)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function ResultLine({
  labelKey,
  value,
  locale,
}: {
  labelKey: string;
  value: number;
  locale: string;
}) {
  return (
    <div className="flex justify-between items-center border-t pt-3 font-semibold">
      <span>
        <T k={labelKey} />
      </span>
      <span className={`font-mono ${value >= 0 ? "text-success" : "text-destructive"}`}>
        {formatCurrency(value, "AED", locale)}
      </span>
    </div>
  );
}

/** Renders the sectioned P&L; returns null when the payload has no `sections` (legacy). */
export function ProfitLossSections({ report }: { report: PlSectionsPayload | undefined }) {
  const { locale } = useTranslation();
  const s = report?.sections;
  if (!report || !s) return null;
  return (
    <div className="space-y-6" data-testid="pl-sections">
      <SectionTable
        titleKey="reportCenter.revenue"
        section={s.revenue}
        totalKey="reportCenter.totalOperatingRevenue"
        locale={locale}
        tone="success"
      />
      <SectionTable
        titleKey="statements.costOfSales"
        section={s.costOfSales}
        totalKey="reportCenter.totalCostOfSales"
        locale={locale}
        tone="destructive"
      />
      <ResultLine
        labelKey="statements.grossProfit"
        value={report.grossProfit ?? s.revenue.total - s.costOfSales.total}
        locale={locale}
      />
      <SectionTable
        titleKey="reportCenter.operatingExpenses"
        section={s.operatingExpenses}
        totalKey="reportCenter.totalOperatingExpenses"
        locale={locale}
        tone="destructive"
      />
      <ResultLine
        labelKey="reportCenter.operatingProfit"
        value={
          report.operatingProfit ??
          s.revenue.total - s.costOfSales.total - s.operatingExpenses.total
        }
        locale={locale}
      />
      <SectionTable
        titleKey="statements.otherIncome"
        section={s.otherIncome}
        totalKey="reportCenter.totalOtherIncome"
        locale={locale}
        tone="success"
      />
      <SectionTable
        titleKey="reportCenter.otherExpenses"
        section={s.otherExpenses}
        totalKey="reportCenter.totalOtherExpenses"
        locale={locale}
        tone="destructive"
      />
      <div className="border-t-4 pt-4">
        <div className="flex justify-between items-center text-lg font-semibold">
          <span>
            <T k="reportCenter.netProfit" />
          </span>
          <span
            className={`font-mono ${report.netProfit >= 0 ? "text-success" : "text-destructive"}`}
          >
            {formatCurrency(report.netProfit, "AED", locale)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The kernel's balance check (`isBalanced`, `difference`) for a statement. */
export function BalanceCheck({
  isBalanced,
  difference,
  testId,
}: {
  isBalanced?: boolean;
  difference?: number;
  testId?: string;
}) {
  const { t, locale } = useTranslation();
  if (isBalanced === undefined) return null;
  if (isBalanced) {
    return (
      <Badge variant="success" data-testid={testId ?? "statement-balanced"}>
        <T k="statements.balanced" />
      </Badge>
    );
  }
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
      data-testid={testId ?? "statement-not-balanced"}
    >
      {formatMessage(t["statements.outOfBalance"] ?? "Not balanced: {amount}", {
        amount: formatCurrency(difference ?? 0, "AED", locale),
      })}
    </div>
  );
}

function toQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `&${s}` : "";
}

/** Server-rendered PDF and Excel downloads for one statement. */
export function StatementDownloads({
  companyId,
  kind,
  from,
  to,
}: {
  companyId: string | null | undefined;
  kind: string;
  from?: string;
  to?: string;
}) {
  if (!companyId) return null;
  const base = `/api/companies/${companyId}/reports/statements/${kind}`;
  const range = toQuery({ from, to });
  return (
    <div className="flex flex-wrap gap-2" data-testid={`statement-downloads-${kind}`}>
      <Button asChild variant="outline" size="sm">
        <a href={apiUrl(`${base}?format=pdf${range}`)} download>
          <FileText className="w-4 h-4 mr-2" />
          <T k="reportCenter.downloadPdf" />
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={apiUrl(`${base}?format=xlsx${range}`)} download>
          <Download className="w-4 h-4 mr-2" />
          <T k="reportCenter.downloadExcel" />
        </a>
      </Button>
    </div>
  );
}

/** "Indicator" badge for reports and metrics that are not posted-ledger figures. */
export function DataBasisBadge({ basis }: { basis: ReportDataBasis | undefined }) {
  const { t } = useTranslation();
  if (!basis || basis === "ledger") return null;
  return (
    <Badge
      variant="warning"
      data-testid="data-basis-indicator"
      title={
        basis === "documents"
          ? t["reportCenter.indicatorDocumentsHint"]
          : t["reportCenter.indicatorSnapshotHint"]
      }
    >
      <T k="reportCenter.indicator" />
    </Badge>
  );
}

const QUICK_STATEMENTS: Array<{ kind: string; labelKey: string }> = [
  { kind: "profit-loss", labelKey: "reportCenter.profitAndLossShort" },
  { kind: "balance-sheet", labelKey: "reportCenter.balanceSheetShort" },
  { kind: "cash-flow", labelKey: "reportCenter.cashFlowShort" },
  { kind: "trial-balance", labelKey: "reportCenter.trialBalanceShort" },
  { kind: "changes-in-equity", labelKey: "reportCenter.changesInEquity" },
  { kind: "vat-summary", labelKey: "reportCenter.vatSummaryShort" },
  { kind: "executive-summary", labelKey: "reportCenter.executiveSummary" },
];

/**
 * R18-10: the default Report Center starts with statements and tax (server PDF/Excel), the
 * accountant pack and the FTA Audit File; role/automation tooling is behind "Advanced".
 */
export function StatementsQuickPanel({
  companyId,
  from,
  to,
  onShowAdvanced,
}: {
  companyId: string | null | undefined;
  from?: string;
  to?: string;
  onShowAdvanced: () => void;
}) {
  const { t } = useTranslation();
  if (!companyId) return null;
  const range = toQuery({ from, to }).replace(/^&/, "");
  return (
    <section
      className="space-y-3 rounded-lg border border-border/70 bg-card p-4 shadow-sm"
      aria-labelledby="statements-quick-title"
      data-testid="statements-quick-panel"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="statements-quick-title" className="text-lg font-semibold">
            <T k="reportCenter.statementsAndTax" />
          </h2>
          <p className="text-sm text-muted-foreground">
            <T k="reportCenter.statementsAndTaxHint" />
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onShowAdvanced}
          data-testid="button-reports-advanced-tools"
        >
          <T k="reportCenter.advancedTools" />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {QUICK_STATEMENTS.map((s) => (
          <div
            key={s.kind}
            className="flex items-center justify-between gap-2 rounded-md border p-2"
          >
            <span className="text-sm font-medium">
              <T k={s.labelKey} />
            </span>
            <StatementDownloads companyId={companyId} kind={s.kind} from={from} to={to} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a
            href={apiUrl(
              `/api/companies/${companyId}/reports/share-pack${range ? `?${range}` : ""}`
            )}
            download
            data-testid="link-accountant-share-pack"
          >
            <Download className="w-4 h-4 mr-2" />
            <T k="reportCenter.accountantPack" />
          </a>
        </Button>
        {from && to ? (
          <Button asChild size="sm" variant="outline">
            <a
              href={apiUrl(`/api/companies/${companyId}/reports/faf?${range}`)}
              download
              title={t["reportCenter.ftaAuditFileHint"]}
              data-testid="link-fta-audit-file"
            >
              <FileText className="w-4 h-4 mr-2" />
              <T k="reportCenter.ftaAuditFile" />
            </a>
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          <T k="reportCenter.ftaAuditFileHint" />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* S4 (R12-09): statements of account per customer / supplier (W4-D service). */}
        <Button asChild size="sm" variant="outline">
          <Link href="/reports/statements-of-account" data-testid="link-party-statements">
            <ScrollText className="w-4 h-4 me-2" />
            <T k="reportCenter.partyStatementsTitle" />
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          <T k="reportCenter.partyStatementsHint" />
        </span>
      </div>
    </section>
  );
}
