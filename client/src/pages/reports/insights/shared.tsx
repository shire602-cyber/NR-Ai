// Insights (spec 3.11): shared controls, period windows and chart styling for the four views.
// Every figure on these views comes from the server (server/reporting, budget variance); the UI
// only picks a window, formats and draws.
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiUrl } from "@/lib/api";
import { ChartTooltipContent, type ChartTooltipContentProps } from "@/components/ui/chart-theme";
import { useTranslation } from "@/lib/i18n";
import { INSIGHTS_PERIODS, type InsightsPeriod } from "./model";

/** Shared chart tooltip (popover surface, label + Money rows); labels come through the views. */
export function InsightsTooltip({
  seriesLabel,
  labelFormatter,
  ...props
}: Omit<ChartTooltipContentProps, "seriesLabel" | "labelFormatter"> & {
  seriesLabel: (key: string) => string;
  labelFormatter?: (label: string) => string;
}) {
  return (
    <ChartTooltipContent
      {...props}
      currency="AED"
      seriesLabel={seriesLabel}
      labelFormatter={labelFormatter ? (label) => labelFormatter(String(label ?? "")) : undefined}
    />
  );
}

export function PeriodSelect({
  value,
  onChange,
  testId = "select-insights-period",
}: {
  value: InsightsPeriod;
  onChange: (value: InsightsPeriod) => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const label: Record<InsightsPeriod, string> = {
    month: t["analytics.periodThisMonth"],
    quarter: t["analytics.periodThisQuarter"],
    year: t["analytics.periodThisYear"],
  };
  return (
    <Select value={value} onValueChange={(v) => onChange(v as InsightsPeriod)}>
      <SelectTrigger
        className="w-full sm:w-44"
        aria-label={t["analytics.periodLabel"]}
        data-testid={testId}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {INSIGHTS_PERIODS.map((p) => (
          <SelectItem key={p} value={p}>
            {label[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface ExportLink {
  label: string;
  href: string;
  format: "pdf" | "xlsx";
}

/** Export menu at the end of a controls row: server-rendered PDF / Excel downloads. */
export function ExportMenu({ links, testId }: { links: ExportLink[]; testId: string }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid={testId}>
          <Download className="h-4 w-4" aria-hidden />
          {t["analytics.export"]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {links.map((link) => (
          <DropdownMenuItem key={link.href} asChild>
            <a href={apiUrl(link.href)} download>
              {link.format === "pdf" ? (
                <FileText className="h-4 w-4" aria-hidden />
              ) : (
                <FileSpreadsheet className="h-4 w-4" aria-hidden />
              )}
              {link.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Controls row: period (and other filters) at the start, Export at the end. */
export function ControlsRow({ start, end }: { start: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">{start}</div>
      {end ? <div className="flex shrink-0 justify-end">{end}</div> : null}
    </div>
  );
}

/** Card that holds one chart and the table behind it. */
export function ChartCard({
  title,
  description,
  action,
  children,
  testId,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="rounded-xl border border-border bg-card shadow-card-soft"
      data-testid={testId}
    >
      <div className="flex flex-col gap-2 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-h3 font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-small text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="px-5 pb-5 pt-4">{children}</div>
    </section>
  );
}

/** One-line empty state inside a card (spec 2.6 `sm`). */
export function SmallEmpty({ text }: { text: string }) {
  return <EmptyState size="sm" title={text} testId="insights-empty-sm" />;
}

/** Skeleton that matches the view: four tiles, one chart, three table rows. */
export function InsightsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
