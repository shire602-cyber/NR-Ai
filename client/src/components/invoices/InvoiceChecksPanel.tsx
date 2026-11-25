import { Link } from "wouter";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatMessage, useTranslation } from "@/lib/i18n";
import type { InvoiceCheck } from "@/lib/invoice-checks";

/**
 * WQ1 (7.3b, 15.12): what is missing before the invoice can be finalised. Each item links to
 * the field (focus) or to the screen where it is fixed.
 */
export function InvoiceChecksPanel({
  checks,
  onFocusField,
  checking,
}: {
  checks: InvoiceCheck[];
  onFocusField: (field: string) => void;
  /** The e-invoice validator is running. */
  checking?: boolean;
}) {
  const { t, locale } = useTranslation();
  if (checks.length === 0) {
    return (
      <div
        className="flex items-start gap-2 rounded-lg border border-success/40 bg-success-subtle p-3 text-small text-success-subtle-foreground"
        role="status"
        data-testid="invoice-checks-ok"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        <p>{checking ? t["invoices.checks.running"] : t["invoices.checks.allGood"]}</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="invoice-checks-list">
      {checks.map((c) => {
        const text = formatMessage(t[c.messageKey] ?? c.messageKey, c.values ?? {});
        const detail = c.message
          ? (c.detailKey && t[c.detailKey]) ||
            (locale === "ar" ? t["einvoicing.validationFinding"] : c.message)
          : null;
        const Icon = c.severity === "error" ? AlertCircle : AlertTriangle;
        return (
          <li
            key={c.id}
            className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-small"
            data-testid={`invoice-check-${c.id}`}
            data-severity={c.severity}
          >
            <Icon
              className={
                c.severity === "error"
                  ? "mt-0.5 h-4 w-4 shrink-0 text-danger"
                  : "mt-0.5 h-4 w-4 shrink-0 text-warning"
              }
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-foreground">{text}</p>
              {detail && <p className="text-caption text-muted-foreground">{detail}</p>}
              {c.ruleId && (
                <p className="text-caption text-muted-foreground">
                  {t["einvoicing.validationRule"]}{" "}
                  <bdi dir="ltr" translate="no">
                    {c.ruleId}
                  </bdi>
                </p>
              )}
              {c.field ? (
                <button
                  type="button"
                  className="text-caption font-medium text-accent underline-offset-4 hover:underline"
                  onClick={() => onFocusField(c.field!)}
                  data-testid={`button-check-fix-${c.id}`}
                >
                  {t["invoices.checks.goToField"]}
                </button>
              ) : c.href ? (
                <Link
                  href={c.href}
                  className="text-caption font-medium text-accent underline-offset-4 hover:underline"
                >
                  {t["invoices.checks.fixElsewhere"]}
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
