import { Briefcase, FileText, Landmark, Wallet, type LucideIcon } from "lucide-react";
import { formatMessage } from "@/lib/i18n";

/* Pure builders for the dashboard "needs you" chips (R3, CTO 16); rendered by NeedsYouStrip. */

export interface NeedsYouChip {
  id: "overdue-invoices" | "bank-review" | "vat-return" | "payroll-approval";
  href: string;
  tone: "danger" | "warning" | "info";
  label: string;
  icon: LucideIcon;
}

export interface InvoiceLike {
  status?: string | null;
  dueDate?: string | null;
  due_date?: string | null;
}

export interface BankLineLike {
  isReconciled?: boolean | null;
}

export interface PayrollRunLike {
  status?: string | null;
}

export interface VatStatusLike {
  filingStatus?: "up_to_date" | "due_soon" | "overdue" | string | null;
  dueInDays?: number | null;
  overdueCount?: number | null;
}

const OPEN_INVOICE_STATUSES = new Set(["sent", "partial"]);

/** Sent / part-paid invoices whose due date is before `todayIso` (same rule as ?status=overdue). */
export function countOverdueInvoices(invoices: InvoiceLike[] | undefined, todayIso: string) {
  if (!Array.isArray(invoices)) return 0;
  return invoices.filter((inv) => {
    const due = (inv.dueDate ?? inv.due_date ?? "").slice(0, 10);
    return OPEN_INVOICE_STATUSES.has(String(inv.status ?? "")) && !!due && due < todayIso;
  }).length;
}

/**
 * Build the dashboard "needs you" chips (R3, CTO 16): at most four linked actions, each only
 * when there is something to do. Pure so it can be unit tested without rendering.
 */
export function buildNeedsYouChips(
  input: {
    invoices?: InvoiceLike[];
    bankLines?: BankLineLike[];
    payrollRuns?: PayrollRunLike[];
    vatStatus?: VatStatusLike | null;
    todayIso: string;
  },
  tt: Record<string, string>
): NeedsYouChip[] {
  const chips: NeedsYouChip[] = [];
  const overdue = countOverdueInvoices(input.invoices, input.todayIso);
  if (overdue > 0) {
    chips.push({
      id: "overdue-invoices",
      href: "/invoices?status=overdue",
      tone: "danger",
      icon: FileText,
      label: formatMessage(
        overdue === 1
          ? tt["dashboard.needsOverdueInvoicesOne"]
          : tt["dashboard.needsOverdueInvoices"],
        { count: overdue }
      ),
    });
  }
  const bankToReview = Array.isArray(input.bankLines)
    ? input.bankLines.filter((line) => !line.isReconciled).length
    : 0;
  if (bankToReview > 0) {
    chips.push({
      id: "bank-review",
      href: "/bank-reconciliation",
      tone: "warning",
      icon: Landmark,
      label: formatMessage(
        bankToReview === 1 ? tt["dashboard.needsBankLinesOne"] : tt["dashboard.needsBankLines"],
        { count: bankToReview }
      ),
    });
  }
  const vat = input.vatStatus;
  if (vat?.filingStatus === "overdue") {
    chips.push({
      id: "vat-return",
      href: "/vat-filing",
      tone: "danger",
      icon: Wallet,
      label: tt["dashboard.needsVatOverdue"],
    });
  } else if (vat?.filingStatus === "due_soon") {
    const days = typeof vat.dueInDays === "number" ? Math.max(0, vat.dueInDays) : null;
    chips.push({
      id: "vat-return",
      href: "/vat-filing",
      tone: "warning",
      icon: Wallet,
      label:
        days === null
          ? tt["dashboard.needsVatDueSoon"]
          : formatMessage(tt["dashboard.needsVatDueIn"], { count: days }),
    });
  }
  const payrollToApprove = Array.isArray(input.payrollRuns)
    ? input.payrollRuns.filter((run) => run.status === "calculated").length
    : 0;
  if (payrollToApprove > 0) {
    chips.push({
      id: "payroll-approval",
      href: "/payroll",
      tone: "info",
      icon: Briefcase,
      label: formatMessage(
        payrollToApprove === 1 ? tt["dashboard.needsPayrollOne"] : tt["dashboard.needsPayroll"],
        { count: payrollToApprove }
      ),
    });
  }
  return chips.slice(0, 4);
}
