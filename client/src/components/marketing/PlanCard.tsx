import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoneyParts, formatMoneyText } from "@/lib/format-money";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";
import {
  billedTotal,
  planAudienceKey,
  planNameKey,
  planPrice,
  type BillingCycle,
  type Plan,
} from "./plans";

/*
 * The one plan card (WP-B): /pricing, the landing pricing strip and the in-app billing page use
 * this component, so a plan reads the same everywhere. Styled with app tokens (Tailwind), not
 * the .mk-root scope, so it renders correctly inside the signed-in shell too.
 *
 * Anatomy, top to bottom: optional "Most popular" caption · name · audience (fixed 40 px block
 * so prices align across a row) · price line · billed-as line (or a spacer) · full-width CTA ·
 * hairline · "Includes" lead-in · up to six bullets. The featured plan is the inverse surface.
 */

/** Price line: currency code (caption) + figure + "per month"; mirrors for Arabic. */
export function PlanPrice({
  amount,
  className,
  inverse,
}: {
  amount: number;
  className?: string;
  inverse?: boolean;
}) {
  const { t, locale } = useTranslation();
  const parts = formatMoneyParts(amount, "AED", locale, { fractionDigits: 0 });
  const code = (
    <span
      className={cn(
        "text-caption font-medium",
        inverse ? "text-surface-inverse-muted" : "text-muted-foreground"
      )}
    >
      {parts.currency}
    </span>
  );
  return (
    <p className={cn("mk-tier__price flex items-baseline gap-1.5", className)}>
      {parts.currencyPosition === "start" && code}
      <strong
        className="money text-[2.75rem] font-semibold leading-[3rem] tracking-[-0.03em]"
        dir="ltr"
      >
        {parts.amount}
      </strong>
      {parts.currencyPosition === "end" && code}
      <span
        className={cn(
          "ms-1 text-small",
          inverse ? "text-surface-inverse-muted" : "text-muted-foreground"
        )}
      >
        {t["marketing.pricingPerMonth"]}
      </span>
    </p>
  );
}

export interface PlanCardProps {
  plan: Plan;
  cycle: BillingCycle;
  /** Replaces the default CTA (e.g. the billing page's "Current plan" / "Contact us"). */
  action?: ReactNode;
  /** Hide the bullets (the landing strip shows the header only). */
  compact?: boolean;
  headingLevel?: "h2" | "h3";
  className?: string;
}

export function PlanCard({
  plan,
  cycle,
  action,
  compact,
  headingLevel = "h2",
  className,
}: PlanCardProps) {
  const { t, locale } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const featured = !!plan.featured;
  const price = planPrice(plan, cycle);
  const total = billedTotal(plan, cycle);
  const Heading = headingLevel;
  const name = t[planNameKey(plan.id)];

  const defaultAction =
    plan.cta === "contact" ? (
      <Button asChild variant="outline" className={cn("h-10 w-full", featured && "border-0")}>
        <a
          href={`mailto:${UPGRADE_CONTACT_EMAIL}?subject=${encodeURIComponent(`Muhasib.ai ${name}`)}`}
          data-testid={`button-plan-${plan.id}`}
        >
          {t["marketing.pricingTalkToUs"]}
        </a>
      </Button>
    ) : (
      <Button asChild variant={featured ? "default" : "outline"} className="h-10 w-full">
        <Link href="/register" data-testid={`button-plan-${plan.id}`}>
          {t["marketing.startFreeTrial"]}
        </Link>
      </Button>
    );

  const extra = plan.bulletKeys.length > 4;

  return (
    <article
      className={cn(
        "plan-card flex h-full flex-col rounded-2xl p-6",
        featured
          ? "bg-surface-inverse text-surface-inverse-foreground dark:bg-neutral-800 dark:ring-1 dark:ring-brand-500"
          : "border border-border bg-card text-card-foreground",
        className
      )}
      data-featured={featured ? "true" : undefined}
      data-testid={`card-plan-${plan.id}`}
    >
      {/* Every card reserves the caption row so names and prices align across the row. */}
      <p
        className={cn(
          "mb-2 min-h-4 text-caption font-semibold uppercase tracking-[0.08em] text-brand-300 rtl:normal-case rtl:tracking-normal",
          !featured && "max-[719px]:hidden"
        )}
        aria-hidden={featured ? undefined : true}
      >
        {featured ? t["marketing.pricingMostPopular"] : null}
      </p>
      <Heading className="text-[0.9375rem] font-semibold leading-[1.375rem]">{name}</Heading>
      <p
        className={cn(
          "mt-1 line-clamp-2 min-h-10 text-small",
          featured ? "text-surface-inverse-muted" : "text-muted-foreground"
        )}
      >
        {t[planAudienceKey(plan.id)]}
      </p>
      <PlanPrice amount={price} inverse={featured} className="mt-4" />
      <p
        className={cn(
          "mk-tier__billed mt-1 min-h-4 text-caption",
          featured ? "text-surface-inverse-muted" : "text-muted-foreground"
        )}
      >
        {total > 0
          ? formatMessage(
              t[
                cycle === "yearly"
                  ? "marketing.pricingBilledYearly"
                  : "marketing.pricingBilledQuarterly"
              ],
              { amount: formatMoneyText(total, "AED", locale, { fractionDigits: 0 }) }
            )
          : " "}
      </p>
      <div className="mt-5">{action ?? defaultAction}</div>
      {compact ? null : (
        <>
          <hr
            className={cn(
              "my-5 border-t",
              featured ? "border-surface-inverse-border" : "border-border"
            )}
          />
          <p
            className={cn(
              "text-caption font-medium",
              featured ? "text-surface-inverse-muted" : "text-muted-foreground"
            )}
          >
            {t[plan.inheritsKey ?? "marketing.prIncludes"]}
          </p>
          <ul className="mt-3 space-y-2.5 text-small">
            {plan.bulletKeys.map((key, i) => (
              <li
                key={key}
                className={cn("flex items-start gap-2.5", i >= 4 && !expanded && "max-sm:hidden")}
              >
                <Check
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 h-4 w-4 flex-none",
                    featured ? "text-brand-300" : "text-brand-600 dark:text-brand-400"
                  )}
                />
                <span>{t[key]}</span>
              </li>
            ))}
          </ul>
          {extra && !expanded ? (
            <button
              type="button"
              className={cn(
                "mt-3 min-h-11 self-start text-small font-medium underline-offset-4 hover:underline sm:hidden",
                featured ? "text-brand-300" : "text-accent"
              )}
              onClick={() => setExpanded(true)}
            >
              {t["marketing.prShowAll"]}
            </button>
          ) : null}
        </>
      )}
    </article>
  );
}
