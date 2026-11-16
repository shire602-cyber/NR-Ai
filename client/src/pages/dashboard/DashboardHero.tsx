import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BarChart3, BookOpen, FileText, MoreHorizontal, Receipt, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { formatDateRange } from "@/lib/format-date";
import { currencyLabel } from "@/lib/format-money";
import { PeriodSelector } from "./PeriodSelector";
import { NeedsYouStrip } from "./NeedsYouStrip";
import type { DashboardModel } from "./useCustomerDashboardModel";

/**
 * Dashboard header (D2b, CTO 4/12): the company name as the title, the resolved period
 * and currency as the summary ("1–16 Nov 2026 · AED"), one primary action, one outline
 * secondary and the rest in a ⋯ menu. The period selector and the one-line insight sit
 * directly under it, so the figures below need no headline of their own.
 */
export function DashboardHero({ m }: { m: DashboardModel }) {
  const { t, locale, stats, periodChoice, setPeriodChoice } = m;
  const companyName = m.companyName;
  const tt = t as Record<string, string>;
  const currency = currencyLabel("AED", locale);
  const range = stats ? formatDateRange(stats.period.from, stats.period.to, locale) : "";

  return (
    <header className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1
            className="text-h2 text-foreground md:text-h1"
            dir="auto"
            data-testid="dashboard-title"
          >
            {tt["dashboard.overviewTitle"]}
          </h1>
          <p
            className="mt-1 truncate text-small text-muted-foreground"
            data-testid="dashboard-period-summary"
          >
            {range ? (
              <>
                {/* On phones the company name is already in the top bar. */}
                {companyName ? (
                  <span className="hidden sm:inline">
                    <span dir="auto" className="font-medium text-foreground">
                      {companyName}
                    </span>
                    {" · "}
                  </span>
                ) : null}
                {`${range} · ${currency}`}
              </>
            ) : (
              <span className="invisible">—</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" data-testid="button-quick-receipt">
            <Link href="/receipts">
              <Receipt aria-hidden />
              {(t as any).scanReceipt ?? "Scan Receipt"}
            </Link>
          </Button>
          <Button asChild className="flex-1 sm:flex-none" data-testid="button-quick-invoice">
            <Link href="/invoices?new=1">
              <FileText aria-hidden />
              {(t as any).newInvoice ?? "New Invoice"}
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                aria-label={tt["dashboard.moreActions"]}
                title={tt["dashboard.moreActions"]}
                data-testid="button-dashboard-more-actions"
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem asChild>
                <Link href="/journal?new=1">
                  <BookOpen aria-hidden />
                  {tt["dashboard.quickJournalEntry"]}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/reports">
                  <BarChart3 aria-hidden />
                  {tt["dashboard.quickViewReports"]}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/ai?tab=cfo">
                  <Sparkles aria-hidden />
                  {tt["dashboard.talkToCfo"]}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <PeriodSelector choice={periodChoice} onChange={setPeriodChoice} locale={locale} />
        {/* R3 (CTO 16): linked "needs you" chips replace the one-line insight sentence. */}
        <NeedsYouStrip
          companyId={m.selectedCompanyId}
          invoices={m.recentInvoices}
          compliance={m.compliance}
        />
      </div>
    </header>
  );
}
