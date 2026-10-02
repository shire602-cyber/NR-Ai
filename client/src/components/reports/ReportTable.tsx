import { useMemo } from "react";
import { Link } from "wouter";
import type { ReportColumn, ReportResult, ReportRow } from "@shared/report-result";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { localizeEnumCell } from "@/lib/enum-labels";
import { cn } from "@/lib/utils";
import { drillHref, type DrillContext } from "@/lib/report-drill";
import {
  formatCell,
  isNegativeCell,
  isNumericColumn,
  linkColumnIndex,
  sectionHeading,
} from "@/lib/report-format";
import { messages as pageMessages } from "./ReportTable.i18n";

interface Props {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportResult["totals"];
  total?: number;
  drillContext?: DrillContext;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

const INDENT_PX = 16;

function labelOf(column: ReportColumn, locale: string): string {
  return locale === "ar" ? column.label.ar || column.label.en : column.label.en;
}

function CellValue({
  value,
  column,
  locale,
}: {
  value: string | number | null | undefined;
  column: ReportColumn;
  locale: string;
}) {
  const tr = pageMessages.useT();
  if ((value === null || value === undefined) && column.type === "percent") {
    return <span className="text-muted-foreground">{tr("notAvailable")}</span>;
  }
  // Status-like and emirate columns come as slugs ("sharjah", "draft"): show them in the reader's language.
  const shown = column.type === "text" ? localizeEnumCell(column.key, value, locale) : value;
  const text = formatCell(shown, column.type, locale);
  if (!isNumericColumn(column.type)) return <>{text}</>;
  // Numbers read left to right in both languages; the cell itself aligns to the end edge.
  return (
    <span
      dir="ltr"
      className={cn("tabular-nums", isNegativeCell(value, column.type) && "text-destructive")}
    >
      {text}
    </span>
  );
}

export function ReportTable({
  columns,
  rows,
  totals,
  total,
  drillContext,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: Props) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const labelColumn = useMemo(() => linkColumnIndex(columns), [columns]);
  const firstTextColumn = useMemo(
    () =>
      Math.max(
        0,
        columns.findIndex((c) => c.type === "text")
      ),
    [columns]
  );

  if (rows.length === 0) {
    return (
      <p
        className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
        data-testid="report-empty"
      >
        {tr("noRows")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border" data-testid="report-table">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn("whitespace-nowrap", isNumericColumn(column.type) && "text-end")}
                >
                  {labelOf(column, locale)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const linkCell = row.cells[columns[labelColumn]?.key];
              const href = drillHref(row.drill, {
                ...drillContext,
                label: linkCell === null || linkCell === undefined ? undefined : String(linkCell),
              });
              if (row.kind === "section") {
                return (
                  <TableRow
                    key={row.key}
                    className="bg-muted/50 hover:bg-muted/50"
                    data-testid="report-section-row"
                  >
                    <TableCell colSpan={columns.length} className="font-semibold">
                      {sectionHeading(row, columns)}
                    </TableCell>
                  </TableRow>
                );
              }
              const isSubtotal = row.kind === "subtotal";
              return (
                <TableRow
                  key={row.key}
                  className={cn(
                    isSubtotal && "border-t-2 bg-muted/30 font-semibold hover:bg-muted/30"
                  )}
                  data-testid={isSubtotal ? "report-subtotal-row" : "report-detail-row"}
                >
                  {columns.map((column, index) => {
                    const value = row.cells[column.key];
                    const isLabel = index === labelColumn;
                    const isFirst = index === firstTextColumn;
                    const content = <CellValue value={value} column={column} locale={locale} />;
                    return (
                      <TableCell
                        key={column.key}
                        className={cn(
                          isNumericColumn(column.type) && "text-end",
                          column.type === "text" && "max-w-[28rem]"
                        )}
                        style={
                          isFirst && row.depth
                            ? { paddingInlineStart: `${row.depth * INDENT_PX + 16}px` }
                            : undefined
                        }
                      >
                        {isLabel &&
                        href &&
                        value !== null &&
                        value !== undefined &&
                        value !== "" ? (
                          <Link
                            href={href}
                            className="text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid"
                            aria-label={tr("openRecord", { name: String(value) })}
                            data-testid="report-drill-link"
                          >
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            {totals ? (
              <TableRow
                className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40"
                data-testid="report-totals-row"
              >
                {columns.map((column, index) => {
                  const value = totals[column.key];
                  const hasValue = value !== null && value !== undefined && value !== "";
                  return (
                    <TableCell
                      key={column.key}
                      className={cn(isNumericColumn(column.type) && "text-end")}
                    >
                      {index === firstTextColumn && !hasValue ? (
                        tr("total")
                      ) : hasValue ? (
                        <CellValue value={value} column={column} locale={locale} />
                      ) : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        {total !== undefined ? (
          <span dir="auto" data-testid="report-row-count">
            {tr("showing", { shown: rows.length, total })}
          </span>
        ) : (
          <span />
        )}
        {hasMore ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            data-testid="button-load-more"
          >
            {isLoadingMore ? tr("loadingMore") : tr("loadMore")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
