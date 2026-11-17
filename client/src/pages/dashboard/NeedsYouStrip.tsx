import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEdgeFade } from "@/components/ui/use-scroll-fade";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import {
  buildNeedsYouChips,
  type BankLineLike,
  type InvoiceLike,
  type NeedsYouChip,
  type PayrollRunLike,
  type VatStatusLike,
} from "./needsYou";

const TONE_DOT: Record<NeedsYouChip["tone"], string> = {
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
};

function uaeTodayIso(): string {
  // Asia/Dubai calendar date (UTC+4, no DST), matching the server's uaeToday().
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Linked action chips under the period tabs (replaces the one-line insight sentence).
 * Reads data the dashboard already caches (invoices, compliance overview) plus the bank lines
 * and payroll runs lists; a list the user cannot read simply contributes no chip.
 */
export function NeedsYouStrip({
  companyId,
  invoices,
  compliance,
}: {
  companyId: string | null | undefined;
  invoices: InvoiceLike[] | undefined;
  compliance: { vatStatus?: VatStatusLike | null } | null | undefined;
}) {
  const stripRef = useRef<HTMLElement>(null);
  const fade = useEdgeFade(stripRef);
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const bank = useQuery<BankLineLike[]>({
    queryKey: ["/api/companies", companyId, "bank-statements", "transactions"],
    enabled: !!companyId,
    retry: false,
    staleTime: 60_000,
  });
  const payroll = useQuery<PayrollRunLike[]>({
    queryKey: ["/api/companies", companyId, "payroll-runs"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/payroll-runs`),
    enabled: !!companyId,
    retry: false,
    staleTime: 60_000,
  });
  if (!companyId || invoices === undefined) return null;
  const chips = buildNeedsYouChips(
    {
      invoices,
      bankLines: bank.data,
      payrollRuns: payroll.data,
      vatStatus: compliance?.vatStatus ?? null,
      todayIso: uaeTodayIso(),
    },
    tt
  );

  return (
    // Phones: one scrolling row with a fade on the clipped edge (spec 3.6 / G4).
    <nav
      ref={stripRef}
      style={fade}
      aria-label={tt["dashboard.needsYouLabel"]}
      className="-mx-4 flex snap-x items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:snap-start"
      data-testid="dashboard-needs-you"
    >
      {chips.length === 0 ? (
        <span
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-small text-muted-foreground"
          data-testid="needs-you-clear"
        >
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          {tt["dashboard.needsNothing"]}
        </span>
      ) : (
        chips.map((chip) => {
          const Icon = chip.icon;
          return (
            <Link
              key={chip.id}
              href={chip.href}
              className="group inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-border bg-card ps-2.5 pe-3 text-small font-medium text-foreground shadow-xs transition-colors duration-fast hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`needs-you-${chip.id}`}
            >
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[chip.tone])} />
              <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="whitespace-nowrap">{chip.label}</span>
              <ArrowRight
                className="h-3.5 w-3.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 rtl:-scale-x-100"
                aria-hidden
              />
            </Link>
          );
        })
      )}
    </nav>
  );
}
