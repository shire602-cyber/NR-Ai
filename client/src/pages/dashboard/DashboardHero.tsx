import { Button } from "@/components/ui/button";
import { FileText, Receipt } from "lucide-react";
import { Link } from "wouter";
import type { DashboardModel } from "./useCustomerDashboardModel";

/**
 * Dashboard page header (D2): the month, a calm greeting, and the two actions
 * people reach for most. The figures live in the KPI strip right below, so the
 * header carries no numbers of its own.
 */
export function DashboardHero({ m }: { m: DashboardModel }) {
  const { t, monthLabel } = m;
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="eyebrow text-accent">{monthLabel}</div>
        <h1 className="mt-1.5 text-[1.5rem] font-semibold leading-8 tracking-[-0.02em] text-foreground md:text-h1">
          {(t as any).welcomeBack ?? "Welcome back"}
        </h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {(t as any).financialOverview ??
            "Your financial overview — revenue, expenses, and outstanding receivables."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" data-testid="button-quick-receipt">
          <Link href="/receipts">
            <Receipt aria-hidden />
            {(t as any).scanReceipt ?? "Scan Receipt"}
          </Link>
        </Button>
        <Button asChild data-testid="button-quick-invoice">
          <Link href="/invoices">
            <FileText aria-hidden />
            {(t as any).newInvoice ?? "New Invoice"}
          </Link>
        </Button>
      </div>
    </header>
  );
}
