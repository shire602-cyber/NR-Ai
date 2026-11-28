import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoneyParts } from "@/lib/format-money";
import { useTranslation } from "@/lib/i18n";
import {
  PLANS,
  planAudienceKey,
  planNameKey,
  planPrice,
  type BillingCycle,
  type Plan,
  type PlanId,
} from "@/components/marketing/plans";

/*
 * STEP4: the plan radio cards of the sign-up plan step. A radiogroup of native radios inside
 * labels (arrow keys, Space and screen readers work natively and mirror in RTL). Prices, names,
 * audiences and bullets all come from components/marketing/plans.ts (one price list, never typed
 * here). The selected card opens to show what the plan includes; one card is open at a time.
 */

function PlanChoicePrice({ plan, cycle, id }: { plan: Plan; cycle: BillingCycle; id: string }) {
  const { t, locale } = useTranslation();
  const parts = formatMoneyParts(planPrice(plan, cycle), "AED", locale, { fractionDigits: 0 });
  const code = (
    <span className="text-caption font-medium text-muted-foreground">{parts.currency}</span>
  );
  return (
    <p
      id={id}
      className="flex flex-none flex-col items-end text-end"
      data-testid={`plan-price-${plan.id}`}
    >
      <span className="flex items-baseline gap-1">
        {parts.currencyPosition === "start" && code}
        <bdi>
          <strong
            className="money text-[1.375rem] font-semibold leading-7 tracking-[-0.02em] tabular-nums"
            dir="ltr"
          >
            {parts.amount}
          </strong>
        </bdi>
        {parts.currencyPosition === "end" && code}
      </span>
      <span className="text-caption text-muted-foreground">
        {t[cycle === "yearly" ? "marketing.pricingPerYear" : "marketing.pricingPerMonth"]}
      </span>
    </p>
  );
}

export interface PlanChoiceListProps {
  value: PlanId;
  cycle: BillingCycle;
  onChange: (id: PlanId) => void;
  /** id of the element that names the group (the step title). */
  labelledBy: string;
  /** Extra line under the selected Enterprise card. */
  enterpriseNote?: string;
}

export function PlanChoiceList({
  value,
  cycle,
  onChange,
  labelledBy,
  enterpriseNote,
}: PlanChoiceListProps) {
  const { t } = useTranslation();
  const uid = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="flex flex-col gap-3"
      data-testid="signup-plan-list"
    >
      {PLANS.map((plan, index) => {
        const selected = value === plan.id;
        const priceId = `${uid}-price-${plan.id}`;
        const audienceId = `${uid}-aud-${plan.id}`;
        const nameId = `${uid}-name-${plan.id}`;
        const popularId = `${uid}-pop-${plan.id}`;
        const includesId = `${uid}-inc-${plan.id}`;
        return (
          <label
            key={plan.id}
            data-testid={`signup-plan-${plan.id}`}
            data-selected={selected ? "true" : undefined}
            className={cn(
              "relative block min-h-[4.5rem] cursor-pointer rounded-xl border bg-card p-4 transition-colors duration-fast",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
              selected
                ? "border-primary bg-brand-50 ring-1 ring-primary dark:bg-neutral-800"
                : "border-border hover:border-neutral-300 dark:hover:border-neutral-600"
            )}
          >
            <input
              type="radio"
              name={`${uid}-plan`}
              value={plan.id}
              checked={selected}
              onChange={() => onChange(plan.id)}
              aria-labelledby={nameId}
              aria-describedby={`${priceId}${plan.featured ? ` ${popularId}` : ""} ${audienceId}`}
              aria-controls={selected ? includesId : undefined}
              aria-posinset={index + 1}
              aria-setsize={PLANS.length}
              className="peer sr-only"
              data-testid={`radio-plan-${plan.id}`}
            />
            <span className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border-2",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-neutral-400"
                )}
              >
                {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                {plan.featured ? (
                  <span
                    id={popularId}
                    className="mb-0.5 block text-caption font-semibold uppercase tracking-[0.08em] text-brand-700 rtl:normal-case rtl:tracking-normal dark:text-brand-300"
                  >
                    {t["marketing.pricingMostPopular"]}
                  </span>
                ) : null}
                <span
                  id={nameId}
                  className="block text-[0.9375rem] font-semibold leading-[1.375rem] text-foreground"
                >
                  {t[planNameKey(plan.id)]}
                </span>
                <span
                  id={audienceId}
                  className="block text-[0.8125rem] leading-5 text-muted-foreground"
                >
                  {t[planAudienceKey(plan.id)]}
                </span>
              </span>
              <PlanChoicePrice plan={plan} cycle={cycle} id={priceId} />
            </span>
            {selected ? (
              <span
                id={includesId}
                aria-live="off"
                className="mt-4 block border-t border-border pt-4 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none"
                data-testid={`signup-plan-includes-${plan.id}`}
              >
                <span className="block text-caption font-medium text-muted-foreground">
                  {t[plan.inheritsKey ?? "marketing.signupIncludes"]}
                </span>
                <span className="mt-3 block space-y-2 text-[0.8125rem] leading-5">
                  {plan.bulletKeys.map((key) => (
                    <span key={key} className="flex items-start gap-2.5">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 flex-none text-brand-600 dark:text-brand-400"
                      />
                      <span>{t[key]}</span>
                    </span>
                  ))}
                </span>
                {plan.id === "enterprise" && enterpriseNote ? (
                  <span className="mt-3 block text-caption text-muted-foreground">
                    {enterpriseNote}
                  </span>
                ) : null}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
