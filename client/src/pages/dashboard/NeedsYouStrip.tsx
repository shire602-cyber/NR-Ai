import { useRef } from "react";
import { uaeToday } from "@shared/uae-date";
import { useQuery } from "@tanstack/react-query";
import { canPerform, companyAccessQueryKey, type CompanyAccess } from "@/lib/auth";
import { useEdgeFade } from "@/components/ui/use-scroll-fade";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { classifyLoadError } from "@/lib/loadError";
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
  // The payroll list answers 403 to roles without payroll access (companyRolePolicy
  // PAYROLL_READ): ask only once the role is known to hold one of those permissions.
  const access = useQuery<CompanyAccess>({
    queryKey: companyAccessQueryKey(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const known = !!access.data && Array.isArray(access.data.permissions);
  const canReadPayroll =
    known &&
    (canPerform(access.data, "payroll.manage") || canPerform(access.data, "payroll.approve"));
  const payroll = useQuery<PayrollRunLike[]>({
    queryKey: ["/api/companies", companyId, "payroll-runs"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/payroll-runs`),
    enabled: !!companyId && canReadPayroll,
    retry: false,
    staleTime: 60_000,
  });
  if (!companyId || invoices === undefined) return null;
  // A list the role cannot read (403) contributes no chip; any other failure means the strip
  // cannot say "nothing needs you", so it must not show the all-clear.
  const failedRead = [bank, payroll].find(
    (q) => q.isError && classifyLoadError(q.error) !== "forbidden"
  );
  const retryFailed = () => {
    if (bank.isError) void bank.refetch();
    if (payroll.isError) void payroll.refetch();
  };
  const chips = buildNeedsYouChips(
    {
      invoices,
      bankLines: bank.data,
      payrollRuns: payroll.data,
      vatStatus: compliance?.vatStatus ?? null,
      todayIso: uaeToday(),
    },
    tt
  );

  return (
    // Phones: one scrolling row with a fade on the clipped edge (spec 3.6 / G4).
    <nav
      ref={stripRef}
      style={fade}
      aria-label={tt["dashboard.needsYouLabel"]}
      className="-mx-gutter flex snap-x items-center gap-3 overflow-x-auto px-gutter pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:snap-start"
      data-testid="dashboard-needs-you"
    >
      {chips.length === 0 && failedRead ? (
        <LoadErrorState
          compact
          error={failedRead.error}
          onRetry={retryFailed}
          retrying={bank.isFetching || payroll.isFetching}
          forbiddenDescription={tt["dashboard.loadForbiddenBody"]}
          testId="needs-you-load-error"
        />
      ) : chips.length === 0 ? (
        <span
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-small text-muted-foreground shadow-card-soft"
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
              className="card-interactive group inline-flex h-10 shrink-0 items-center gap-2.5 rounded-full border border-border bg-card ps-3.5 pe-4 text-small font-medium text-foreground shadow-card-soft transition-[border-color,box-shadow,transform] duration-base ease-out hover:border-border-strong hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`needs-you-${chip.id}`}
            >
              <span aria-hidden className={cn("h-2 w-2 rounded-full", TONE_DOT[chip.tone])} />
              <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="whitespace-nowrap">{chip.label}</span>
              <ArrowRight
                className="nudge-on-hover h-3.5 w-3.5 text-muted-foreground opacity-60 group-hover:opacity-100 rtl:[scale:-1_1]"
                aria-hidden
              />
            </Link>
          );
        })
      )}
      {chips.length > 0 && failedRead && (
        <button
          type="button"
          onClick={retryFailed}
          className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-warning/30 bg-warning-subtle px-4 text-small text-warning-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="needs-you-partial"
        >
          {tt["dashboard.needsPartial"]}
          <span className="font-medium">{tt["components.errorRetry"]}</span>
        </button>
      )}
    </nav>
  );
}
