import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

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

interface PageHeaderProps {
  /** Short uppercase context label rendered above the title, e.g. "Sales" */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned action buttons */
  actions?: ReactNode;
  /** Optional icon rendered in a tile beside the title (v2). */
  icon?: LucideIcon;
  /** Optional back link rendered above the eyebrow (v2, for detail pages). */
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
  icon: Icon,
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
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        {backHref && (
          <Link
            href={backHref}
            className="mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground transition-colors duration-fast hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            {backLabel ?? t["components.back"]}
          </Link>
        )}
        {eyebrow && <div className="eyebrow mb-1.5 text-accent">{translatedEyebrow}</div>}
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-xs">
              <Icon className="h-5 w-5 text-accent" strokeWidth={1.75} aria-hidden />
            </span>
          )}
          <h1
            className="min-w-0 text-[1.5rem] font-semibold leading-8 tracking-[-0.02em] text-foreground md:text-h1"
            data-testid={testId ?? "text-page-title"}
          >
            {title}
          </h1>
        </div>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </header>
  );
}
