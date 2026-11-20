/**
 * Audit-readiness checks from /compliance/overview (S4): the action for each
 * stable `checks[].key` and its translated explanation. Never match on the
 * server's English explanation text.
 */
import { formatMessage } from "@/lib/i18n";

/** One audit-readiness check from /compliance/overview (server/routes/compliance-dashboard.routes.ts). */
export interface AuditReadinessCheck {
  key: string;
  label: string;
  labelAr?: string;
  weight: number;
  score: number;
  status: "pass" | "partial" | "fail" | "not_applicable";
  explanation: string;
  explanationKey?: string;
  explanationParams?: Record<string, string | number>;
}

interface CheckAction {
  href: string;
  ctaKey: string;
}

/**
 * Maps audit-readiness checks to the screen that resolves them. Keyed on the
 * stable `checks[].key`, never on English explanation text (S4).
 */
export const CHECK_ACTIONS: Record<string, (check: AuditReadinessCheck) => CheckAction> = {
  bank_reconciliation: () => ({
    href: "/bank-reconciliation",
    ctaKey: "dashboard.actionReconcileBank",
  }),
  vat_returns: () => ({ href: "/vat-filing", ctaKey: "dashboard.actionFileVat" }),
  period_locks: () => ({ href: "/month-end", ctaKey: "dashboard.actionCloseMonth" }),
  unposted_documents: (check) => {
    const p = check.explanationParams ?? {};
    if (Number(p.invoices) > 0) {
      return { href: "/invoices?status=draft", ctaKey: "dashboard.actionReviewDrafts" };
    }
    if (Number(p.receipts) > 0)
      return { href: "/receipts", ctaKey: "dashboard.actionPostReceipts" };
    return { href: "/journal", ctaKey: "dashboard.actionPostEntry" };
  },
  corporate_tax_returns: () => ({
    href: "/corporate-tax",
    ctaKey: "dashboard.actionFileCorporateTax",
  }),
};

/** Checks that still cost points (failed or partial), in server order. */
export function openAuditChecks(
  auditReadiness: { checks?: AuditReadinessCheck[] } | null | undefined
): AuditReadinessCheck[] {
  return (auditReadiness?.checks ?? []).filter(
    (c) => c.status === "fail" || c.status === "partial"
  );
}

/** Translated explanation of a check; falls back to the server's English text. */
export function auditCheckExplanation(
  check: AuditReadinessCheck,
  catalog: Record<string, string>
): string {
  const template = check.explanationKey
    ? catalog[`dashboard.auditCheck.${check.explanationKey}`]
    : undefined;
  return template ? formatMessage(template, check.explanationParams ?? {}) : check.explanation;
}
