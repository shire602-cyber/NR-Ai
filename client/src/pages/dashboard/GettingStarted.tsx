import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { saveOnboardingProgress, useOnboardingProgress } from "../onboarding/first-task";
import { useEInvoiceReadiness } from "@/components/einvoice/use-einvoice";
import type { DashboardModel } from "./useCustomerDashboardModel";

const dismissKey = (companyId: string) => `muhasib.gettingStarted.dismissed.${companyId}`;
/** The card stays until this many steps are done (spec 3.4). */
const DONE_THRESHOLD = 3;

type StepId = "invoice" | "customer" | "bank" | "bill" | "vat" | "einvoice";

/** Typical minutes each step takes (the time chip on a step that is not done yet). */
const STEP_MINUTES: Record<StepId, number> = {
  invoice: 3,
  customer: 2,
  bank: 5,
  bill: 2,
  vat: 1,
  einvoice: 5,
};

interface Step {
  id: StepId;
  done: boolean;
  href: string;
  title: string;
  hint: string;
  testId?: string;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

const FIRST_TASK_STEP: Record<string, StepId> = {
  invoice: "invoice",
  bank: "bank",
  bill: "bill",
};

/**
 * Getting started (spec 3.4 / 3.6): five first steps with ticks derived from the company's
 * real records, so a tick can never be claimed before the work exists. It replaces the old
 * first-invoice banner, keeps that banner's test id and deep link, and hides itself once
 * three steps are done or the owner dismisses it.
 */
export function GettingStarted({
  m,
  alwaysShow = false,
}: {
  m: DashboardModel;
  alwaysShow?: boolean;
}) {
  const { t, selectedCompanyId: companyId, recentInvoices, company } = m;
  const tt = t as Record<string, string>;
  const enabled = Boolean(companyId);
  const { data: contacts } = useQuery<unknown[]>({
    queryKey: ["/api/companies", companyId, "customer-contacts"],
    enabled,
  });
  // 3.3: the bank step is done when a statement line exists, not just an account.
  const { data: bankLines } = useQuery<unknown[] | { transactions?: unknown[] }>({
    queryKey: ["/api/companies", companyId, "bank-transactions"],
    enabled,
  });
  const bankLineCount = Array.isArray(bankLines)
    ? bankLines.length
    : (bankLines?.transactions?.length ?? 0);
  const einvoice = useEInvoiceReadiness(companyId);
  const mandate = einvoice.data?.mandate;
  // Only when the e-invoicing mandate applies to this company.
  const einvoiceApplies = !!mandate && mandate.scope !== "none";
  const einvoiceReady =
    !!einvoice.data && einvoice.data.total > 0 && einvoice.data.done === einvoice.data.total;
  const progress = useOnboardingProgress(companyId);
  const { data: bills } = useQuery<unknown[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    enabled,
  });
  const { data: receipts } = useQuery<unknown[]>({
    queryKey: ["/api/companies", companyId, "receipts"],
    enabled,
  });
  const [dismissedHere, setDismissed] = useState(
    () => Boolean(companyId) && readStorage(dismissKey(companyId!)) === "1"
  );
  // Dismissal is saved on the server too, so it holds on every device.
  const dismissed = dismissedHere || progress.data?.dismissedGettingStarted === true;

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [
      {
        id: "invoice",
        done: (recentInvoices?.length ?? 0) > 0,
        href: "/invoices?new=1",
        title: tt["dashboard.gsInvoice"],
        hint: tt["dashboard.gsInvoiceHint"],
        testId: "button-first-invoice",
      },
      {
        id: "customer",
        done: (contacts?.length ?? 0) > 0,
        href: "/contacts",
        title: tt["dashboard.gsCustomer"],
        hint: tt["dashboard.gsCustomerHint"],
      },
      {
        id: "bank",
        done: bankLineCount > 0,
        href: "/bank-accounts",
        title: tt["dashboard.gsBankLines"],
        hint: tt["dashboard.gsBankLinesHint"],
      },
      {
        id: "bill",
        done: (bills?.length ?? 0) + (receipts?.length ?? 0) > 0,
        href: "/receipts",
        title: tt["dashboard.gsBill"],
        hint: tt["dashboard.gsBillHint"],
      },
      {
        id: "vat",
        done: Boolean(company?.trnVatNumber),
        href: "/settings/company",
        title: tt["dashboard.gsVat"],
        hint: tt["dashboard.gsVatHint"],
      },
    ];
    if (einvoiceApplies) {
      list.push({
        id: "einvoice",
        done: einvoiceReady,
        href: "/settings/einvoicing",
        title: tt["dashboard.gsEinvoice"],
        hint: tt["dashboard.gsEinvoiceHint"],
      });
    }
    // The first task chosen in onboarding (saved on the server) is listed first.
    const first = FIRST_TASK_STEP[progress.data?.firstTask ?? ""];
    if (!first) return list;
    return [...list.filter((s) => s.id === first), ...list.filter((s) => s.id !== first)];
  }, [
    tt,
    progress.data?.firstTask,
    einvoiceApplies,
    einvoiceReady,
    recentInvoices,
    contacts,
    bankLineCount,
    bills,
    receipts,
    company?.trnVatNumber,
  ]);

  const doneCount = steps.filter((s) => s.done).length;
  if (!alwaysShow && (dismissed || doneCount >= DONE_THRESHOLD)) return null;

  const dismiss = () => {
    try {
      if (companyId) window.localStorage.setItem(dismissKey(companyId), "1");
    } catch {
      // Storage blocked: the card simply hides for this visit.
    }
    setDismissed(true);
    if (companyId) {
      void saveOnboardingProgress(companyId, { dismissedGettingStarted: true }).catch(
        () => undefined
      );
    }
  };

  return (
    <Card className="overflow-hidden" data-testid="card-first-invoice-guide">
      <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="text-h3 text-foreground">{tt["dashboard.gettingStartedTitle"]}</h2>
          <p className="mt-0.5 text-small text-muted-foreground">
            {formatMessage(tt["dashboard.gettingStartedProgress"], {
              done: doneCount,
              total: steps.length,
            })}
          </p>
        </div>
        {!alwaysShow && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-me-2 text-muted-foreground hover:text-foreground"
            onClick={dismiss}
            aria-label={tt["dashboard.gettingStartedHide"]}
            title={tt["dashboard.gettingStartedHide"]}
            data-testid="button-hide-getting-started"
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
      {/* One 2px progress line, no step dots. */}
      <div className="mx-5 h-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-base ease-out"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>
      <ol className="mt-2 divide-hairline">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              href={step.href}
              className="group flex min-h-11 items-center gap-3 px-5 py-2.5 transition-colors duration-fast hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              data-testid={step.testId ?? `getting-started-${step.id}`}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  step.done
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border-strong bg-card"
                )}
                aria-hidden
              >
                {step.done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-small font-medium",
                    step.done ? "text-muted-foreground line-through" : "text-foreground"
                  )}
                >
                  {step.title}
                  {step.done ? <span className="sr-only"> · {tt["dashboard.gsDone"]}</span> : null}
                </span>
                <span className="hidden truncate text-caption text-muted-foreground sm:block">
                  {step.hint}
                </span>
              </span>
              {!step.done ? (
                <span
                  className="shrink-0 rounded-full border border-border px-2 py-0.5 text-caption tabular-nums text-muted-foreground"
                  title={formatMessage(tt["dashboard.gsMinutesLabel"], {
                    count: STEP_MINUTES[step.id],
                  })}
                  data-testid={`getting-started-minutes-${step.id}`}
                >
                  {formatMessage(tt["dashboard.gsMinutes"], { count: STEP_MINUTES[step.id] })}
                </span>
              ) : null}
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
