import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Section eyebrows are passed as English literals across ~65 pages; mapping
// them to i18n keys HERE gives every page Arabic section labels from one
// place. Unknown eyebrows render as passed.
const EYEBROW_KEYS: Record<string, string> = {
  Settings: "eyebrowSettings",
  Accounting: "eyebrowAccounting",
  Firm: "eyebrowFirm",
  Admin: "eyebrowAdmin",
  Sales: "eyebrowSales",
  Workspace: "eyebrowWorkspace",
  Insights: "eyebrowInsights",
  Compliance: "eyebrowCompliance",
  Purchases: "eyebrowPurchases",
  Operations: "eyebrowOperations",
  Reports: "eyebrowReports",
  "HR & Payroll": "eyebrowPayroll",
  "AI hub": "eyebrowAi",
};

export interface PageHeaderProps {
  /** Short uppercase context label rendered above the title, e.g. "Sales" */
  eyebrow?: string;
  title: ReactNode;
  /** One line, max 80 characters (spec 2.4). */
  description?: ReactNode;
  /**
   * Spec 2.4: the ONE primary button of the page (a `<Button>`; default variant).
   */
  primaryAction?: ReactNode;
  /** At most two secondary buttons (`variant="outline"` or `"ghost"`). */
  secondaryActions?: ReactNode;
  /**
   * Everything else: `DropdownMenuItem`s rendered in a ⋯ menu at the inline end.
   */
  overflow?: ReactNode;
  overflowLabel?: string;
  overflowTestId?: string;
  /**
   * Legacy free-form actions slot. Prefer `primaryAction` / `secondaryActions` / `overflow`;
   * when both are given, `actions` renders first.
   */
  actions?: ReactNode;
  /** @deprecated Spec G5: no icon tiles in headers. Accepted so screens compile; not rendered. */
  icon?: LucideIcon;
  /** Optional back link rendered above the eyebrow (detail pages). */
  backHref?: string;
  backLabel?: string;
  className?: string;
  testId?: string;
}

/**
 * Page header — D2 design system. Every authenticated screen starts with one:
 * optional back link, eyebrow (section), title (text-h1), description, and an
 * actions slot (one primary Button + outline/ghost secondaries). Actions wrap
 * under the title on narrow screens; logical properties keep it RTL-correct.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  primaryAction,
  secondaryActions,
  overflow,
  overflowLabel,
  overflowTestId,
  backHref,
  backLabel,
  className,
  testId,
}: PageHeaderProps) {
  const { t } = useTranslation();
  const translatedEyebrow =
    eyebrow && EYEBROW_KEYS[eyebrow]
      ? ((t as Record<string, string>)[EYEBROW_KEYS[eyebrow]] ?? eyebrow)
      : eyebrow;
  const hasActions = Boolean(actions || primaryAction || secondaryActions || overflow);
  return (
    <header
      className={cn(
        "flex flex-col gap-stack sm:flex-row sm:items-end sm:justify-between sm:gap-8",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        {backHref && (
          <Link
            href={backHref}
            className="mb-2 inline-flex min-h-11 items-center sm:min-h-8 gap-1.5 rounded-md text-small font-medium text-muted-foreground transition-colors duration-fast hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            {backLabel ?? t["components.back"]}
          </Link>
        )}
        {eyebrow && <div className="eyebrow mb-2 text-accent">{translatedEyebrow}</div>}
        <h1
          className="min-w-0 break-words text-h1 text-foreground"
          data-testid={testId ?? "text-page-title"}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-prose text-body text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {hasActions && (
        <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
          {actions}
          {secondaryActions}
          {overflow && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={overflowLabel ?? t["components.rowMoreActions"]}
                  title={overflowLabel ?? t["components.rowMoreActions"]}
                  data-testid={overflowTestId ?? "page-header-overflow"}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                {overflow}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {primaryAction}
        </div>
      )}
    </header>
  );
}
