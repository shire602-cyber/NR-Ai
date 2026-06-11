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
 * Editorial page header — emerald eyebrow, Instrument Serif display title,
 * muted description, and a right-aligned actions slot. Use at the top of
 * every workspace page so the app reads as one product.
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
    <header className={cn("flex items-end justify-between flex-wrap gap-4", className)}>
      <div className="flex-1 min-w-0">
        {backHref && (
          <Link href={backHref}>
            <span className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ArrowLeft className="w-3.5 h-3.5" />
              {backLabel ?? "Back"}
            </span>
          </Link>
        )}
        {eyebrow && (
          <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-accent">
            <span aria-hidden className="inline-block w-5 h-px bg-accent/60" />
            {translatedEyebrow}
          </div>
        )}
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent/10 ring-1 ring-accent/20 shrink-0">
              <Icon className="w-5 h-5 text-accent" strokeWidth={1.75} />
            </span>
          )}
          <h1
            className="font-display text-[28px] md:text-[34px] leading-[1.05] tracking-tight text-foreground"
            data-testid={testId ?? "text-page-title"}
          >
            {title}
          </h1>
        </div>
        {description && (
          <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}
