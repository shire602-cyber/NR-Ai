// Reports > catalogue (spec 3.11): the report picker and the statements download list merged into
// one grouped catalogue. Each row: name, one-line description, "Open" and, where the server
// renders the report, a PDF / Excel download menu. Two columns of rows on desktop, one on mobile.
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiUrl } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { reportCatalogDataBasis } from "@/lib/reportCatalog";
import { DataBasisBadge } from "../StatementParts";
import { sentenceCase } from "../model/sentenceCase";
import type { ReportViewerGroup } from "../shared";

/** Catalog report id -> server statement kind (server/services/report-render STATEMENT_KINDS). */
const CATALOGUE_DOWNLOAD_KINDS: Record<string, string> = {
  "profit-loss": "profit-loss",
  "balance-sheet": "balance-sheet",
  "cash-flow": "cash-flow",
  "trial-balance": "trial-balance",
  "vat-summary": "vat-summary",
  "general-ledger": "general-ledger",
  "ar-aging": "ar-aging",
  "ap-aging": "ap-aging",
};

/** Statements the server renders that have no on-screen viewer: download-only rows. */
const DOWNLOAD_ONLY_STATEMENTS: Array<{ kind: string; labelKey: string; descKey: string }> = [
  {
    kind: "changes-in-equity",
    labelKey: "reportCenter.changesInEquity",
    descKey: "reportCenter.changesInEquityDesc",
  },
  {
    kind: "executive-summary",
    labelKey: "reportCenter.executiveSummary",
    descKey: "reportCenter.executiveSummaryDesc",
  },
];

function DownloadMenu({
  companyId,
  kind,
  range,
  label,
}: {
  companyId: string;
  kind: string;
  range: string;
  label: string;
}) {
  const { t } = useTranslation();
  const base = `/api/companies/${companyId}/reports/statements/${kind}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-muted-foreground hover:text-foreground"
          aria-label={`${t["reportCenter.download"]}: ${label}`}
          data-testid={`statement-downloads-${kind}`}
        >
          <Download className="h-4 w-4" aria-hidden />
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={apiUrl(`${base}?format=pdf${range}`)} download>
            <FileText className="h-4 w-4" aria-hidden />
            {t["reportCenter.downloadPdf"]}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={apiUrl(`${base}?format=xlsx${range}`)} download>
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            {t["reportCenter.downloadExcel"]}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({
  label,
  description,
  badge,
  open,
  download,
}: {
  label: string;
  description: string;
  badge?: React.ReactNode;
  open?: React.ReactNode;
  download?: React.ReactNode;
}) {
  return (
    <li className="flex min-h-14 items-center justify-between gap-3 border-b border-border/70 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="line-clamp-2 break-words text-body font-medium leading-snug text-foreground">
            {label}
          </span>
          {badge}
        </div>
        <p className="mt-0.5 line-clamp-1 text-caption text-muted-foreground" title={description}>
          {description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {download}
        {open}
      </div>
    </li>
  );
}

export function ReportCatalogue({
  groups,
  companyId,
  from,
  to,
  onOpen,
  ariaLabel,
}: {
  groups: ReportViewerGroup[];
  companyId: string | null | undefined;
  from?: string;
  to?: string;
  onOpen: (optionId: string) => void;
  ariaLabel: string;
}) {
  const { t, locale } = useTranslation();
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const range = qs.toString() ? `&${qs.toString()}` : "";
  return (
    <section className="space-y-8" aria-label={ariaLabel} data-testid="report-catalogue">
      {groups.map((group, index) => (
        <section key={group.category} aria-labelledby={`report-group-${index}`}>
          <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
            <h2 id={`report-group-${index}`} className="text-h3 font-semibold text-foreground">
              {sentenceCase(group.label, locale)}
            </h2>
            <span className="text-caption tabular-nums text-muted-foreground">
              {group.options.length}
            </span>
          </div>
          <ul className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
            {group.options.map((option) => {
              const kind = option.reportId ? CATALOGUE_DOWNLOAD_KINDS[option.reportId] : undefined;
              const openable = Boolean(option.href || option.tab);
              return (
                <Row
                  key={option.id}
                  label={sentenceCase(option.label, locale)}
                  description={option.description}
                  badge={
                    <DataBasisBadge
                      basis={option.reportId ? reportCatalogDataBasis(option.reportId) : undefined}
                    />
                  }
                  download={
                    kind && companyId ? (
                      <DownloadMenu
                        companyId={companyId}
                        kind={kind}
                        range={range}
                        label={option.label}
                      />
                    ) : null
                  }
                  open={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={!openable}
                      onClick={() => onOpen(option.id)}
                      aria-label={`${t["reportCenter.open"]}: ${option.label}`}
                      data-testid={`button-report-center-${option.id}`}
                    >
                      {t["reportCenter.open"]}
                    </Button>
                  }
                />
              );
            })}
            {group.category === "Financial Statements" && companyId
              ? DOWNLOAD_ONLY_STATEMENTS.map((s) => (
                  <Row
                    key={s.kind}
                    label={t[s.labelKey]}
                    description={t[s.descKey]}
                    download={
                      <DownloadMenu
                        companyId={companyId}
                        kind={s.kind}
                        range={range}
                        label={t[s.labelKey]}
                      />
                    }
                  />
                ))
              : null}
          </ul>
        </section>
      ))}
    </section>
  );
}
