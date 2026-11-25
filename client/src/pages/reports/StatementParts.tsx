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
import { Money } from "@/components/ui/money";
import { formatMessage, useTranslation } from "@/lib/i18n";
import {
  pdfLanguageOptions,
  statementDownloadPath,
  statementLang,
} from "./model/statementDownloads";
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
    /** A3 (H3): income tax expense, shown after profit before tax. */
    incomeTax?: PlSection;
    /** A3 (H11): items of other comprehensive income. */
    otherComprehensiveIncome?: PlSection;
  };
  grossProfit?: number;
  operatingProfit?: number;
  profitBeforeTax?: number;
  netProfit: number;
  totalComprehensiveIncome?: number;
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
              <TableCell className="tabular-nums text-xs text-muted-foreground">
                {item.accountCode || "-"}
              </TableCell>
              <TableCell>
                {locale === "ar" && item.accountNameAr ? item.accountNameAr : item.accountName}
              </TableCell>
              <TableCell data-numeric className=" font-medium">
                <Money amount={item.amount ?? 0} currency={"AED"} />
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2">
            <TableCell colSpan={2} className="font-semibold">
              <T k={totalKey} />
            </TableCell>
            <TableCell data-numeric className=" font-semibold">
              <Money amount={section.total} currency={"AED"} />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function ResultLine({ labelKey, value }: { labelKey: string; value: number; locale?: string }) {
  return (
    <div className="flex justify-between items-center border-t pt-3 font-semibold">
      <span>
        <T k={labelKey} />
      </span>
      <span className={`tabular-nums ${value >= 0 ? "text-success" : "text-destructive"}`}>
        <Money amount={value} currency={"AED"} />
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
      {s.incomeTax && (s.incomeTax.lines.length > 0 || s.incomeTax.total !== 0) ? (
        <>
          <ResultLine
            labelKey="reportCenter.profitBeforeTax"
            value={report.profitBeforeTax ?? report.netProfit + s.incomeTax.total}
            locale={locale}
          />
          <SectionTable
            titleKey="reportCenter.incomeTaxExpense"
            section={s.incomeTax}
            totalKey="reportCenter.totalIncomeTax"
            locale={locale}
            tone="destructive"
          />
        </>
      ) : null}
      <div className="border-t-4 pt-4">
        <div className="flex justify-between items-center text-lg font-semibold">
          <span>
            <T k="reportCenter.netProfit" />
          </span>
          <span
            className={`tabular-nums ${report.netProfit >= 0 ? "text-success" : "text-destructive"}`}
          >
            <Money amount={report.netProfit} currency={"AED"} />
          </span>
        </div>
      </div>
      {s.otherComprehensiveIncome && s.otherComprehensiveIncome.lines.length > 0 ? (
        <>
          <SectionTable
            titleKey="reportCenter.otherComprehensiveIncome"
            section={s.otherComprehensiveIncome}
            totalKey="reportCenter.totalOtherComprehensiveIncome"
            locale={locale}
            tone="muted"
          />
          <ResultLine
            labelKey="reportCenter.totalComprehensiveIncome"
            value={
              report.totalComprehensiveIncome ?? report.netProfit + s.otherComprehensiveIncome.total
            }
            locale={locale}
          />
        </>
      ) : null}
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
  compact = false,
}: {
  companyId: string | null | undefined;
  kind: string;
  from?: string;
  to?: string;
  /** Quiet ghost buttons for dense statement lists. */
  compact?: boolean;
}) {
  const { t, locale } = useTranslation();
  if (!companyId) return null;
  const base = `/api/companies/${companyId}/reports/statements/${kind}`;
  const range = toQuery({ from, to });
  const variant = compact ? "ghost" : "outline";
  // E3: the PDF comes in Arabic and English (the reader's language first); dense lists keep one.
  const pdfOptions = pdfLanguageOptions(locale).slice(0, compact ? 1 : 2);
  return (
    <div
      className={compact ? "flex shrink-0 gap-1" : "flex flex-wrap gap-2"}
      data-testid={`statement-downloads-${kind}`}
    >
      {pdfOptions.map((option) => (
        <Button
          key={option.lang}
          asChild
          variant={variant}
          size="sm"
          className={compact ? "h-8 px-2.5" : undefined}
        >
          <a
            href={apiUrl(statementDownloadPath(base, "pdf", option.lang, range))}
            download
            data-testid={`link-pdf-${kind}-${option.lang}`}
          >
            <FileText className="w-4 h-4 me-1.5" aria-hidden />
            {compact ? t["reportCenter.downloadPdf"] : t[option.labelKey]}
          </a>
        </Button>
      ))}
      <Button asChild variant={variant} size="sm" className={compact ? "h-8 px-2.5" : undefined}>
        <a
          href={apiUrl(statementDownloadPath(base, "xlsx", statementLang(locale), range))}
          download
        >
          <Download className="w-4 h-4 me-1.5" aria-hidden />
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
      variant="neutral"
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

/**
 * R18-10 / spec 3.11: files and packs above the catalogue (the per-statement PDF / Excel rows moved
 * into the catalogue itself): accountant pack, FTA Audit File, statements of account, and the
 * advanced reporting tools.
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
  const { t, locale } = useTranslation();
  if (!companyId) return null;
  const range = toQuery({ from, to }).replace(/^&/, "");
  return (
    <section
      className="rounded-xl border border-border bg-card px-5 py-4 shadow-card-soft"
      aria-labelledby="statements-quick-title"
      data-testid="statements-quick-panel"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 id="statements-quick-title" className="text-h3 font-semibold text-foreground">
            <T k="reportCenter.filesAndPacks" />
          </h2>
          <p className="mt-0.5 text-small text-muted-foreground">
            <T k="reportCenter.ftaAuditFileHint" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a
              href={apiUrl(
                `/api/companies/${companyId}/reports/share-pack?${range ? `${range}&` : ""}lang=${statementLang(locale)}`
              )}
              download
              data-testid="link-accountant-share-pack"
            >
              <Download className="h-4 w-4" aria-hidden />
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
                <FileText className="h-4 w-4" aria-hidden />
                <T k="reportCenter.ftaAuditFile" />
              </a>
            </Button>
          ) : null}
          {/* S4 (R12-09): statements of account per customer / supplier (W4-D service). */}
          <Button asChild size="sm" variant="outline">
            <Link
              href="/reports/statements-of-account"
              title={t["reportCenter.partyStatementsHint"]}
              data-testid="link-party-statements"
            >
              <ScrollText className="h-4 w-4" aria-hidden />
              <T k="reportCenter.partyStatementsTitle" />
            </Link>
          </Button>
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
      </div>
    </section>
  );
}
