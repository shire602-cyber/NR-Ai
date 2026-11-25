import { forwardRef, useMemo } from "react";
import { Link } from "wouter";
import { CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/marketing/Segmented";
import { PlanChoiceList } from "@/components/billing/PlanChoiceList";
import { AUTH_BUTTON } from "./AuthBlocks";
import {
  BILLING_CYCLES,
  YEARLY_FREE,
  type BillingCycle,
  type PlanId,
} from "@/components/marketing/plans";
import { formatDate } from "@/lib/format-date";
import { formatAmountDigits, formatMoneyText } from "@/lib/format-money";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { TRIAL_LIMITS } from "@shared/plans";
import { TRIAL_DAYS } from "@shared/trial";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SignupPlanStepProps {
  planId: PlanId;
  cycle: BillingCycle;
  onPlanChange: (id: PlanId) => void;
  onCycleChange: (c: BillingCycle) => void;
  onContinue: () => void;
}

/**
 * STEP4, sign-up step 1 of 2: choose the plan. Every plan starts the same free trial of
 * everything, so the screen says what is due today (AED 0), when the trial ends, and that no card
 * is needed. The step needs no network call: plans and prices are static (shared/plans.ts).
 * The h1 takes focus when the step opens (the caller passes the ref).
 */
export const SignupPlanStep = forwardRef<HTMLHeadingElement, SignupPlanStepProps>(
  function SignupPlanStep({ planId, cycle, onPlanChange, onCycleChange, onContinue }, headingRef) {
    const { t, locale } = useTranslation();
    const trialEnd = useMemo(
      () => formatDate(new Date(Date.now() + TRIAL_DAYS * DAY_MS), locale),
      [locale]
    );
    const dueToday = formatMoneyText(0, "AED", locale, { fractionDigits: 0 });
    return (
      <div className="w-full" data-testid="signup-plan-step">
        <header className="mb-6">
          <p className="mb-2 text-caption text-muted-foreground" data-testid="signup-step-caption">
            {formatMessage(t["marketing.signupStep"], { n: 1 })}
          </p>
          <h1
            id="signup-plan-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-h1 text-foreground text-balance outline-none"
          >
            {t["marketing.signupPlanTitle"]}
          </h1>
          <p className="mt-2 text-small text-muted-foreground text-pretty">
            {formatMessage(t["marketing.signupPlanLead"], { days: TRIAL_DAYS })}
          </p>
        </header>

        <div
          className="mb-5 flex items-start gap-3 rounded-xl border border-border px-4 py-3"
          data-testid="signup-trial-callout"
        >
          <CalendarCheck
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 flex-none text-brand-600 dark:text-brand-400"
          />
          <p className="text-small">
            <span className="block font-medium text-foreground">
              {formatMessage(t["marketing.signupTrialUntil"], { date: trialEnd })}
            </span>
            <span className="block text-muted-foreground" data-testid="signup-due-today">
              {formatMessage(t["marketing.signupDueToday"], { amount: dueToday })}
            </span>
            <span className="block text-muted-foreground" data-testid="signup-trial-caps">
              {formatMessage(t["marketing.signupTrialCaps"], {
                companies: TRIAL_LIMITS.maxCompanies,
                credits: formatAmountDigits(TRIAL_LIMITS.aiCreditsPerMonth, 0),
                storage: formatMessage(t["marketing.prValGb"], {
                  n: formatAmountDigits(TRIAL_LIMITS.maxStorageMb / 1024, 0),
                }),
              })}
            </span>
          </p>
        </div>

        <div className="mb-5">
          <Segmented
            value={cycle}
            onChange={onCycleChange}
            label={t["marketing.signupCycleLabel"]}
            testId="signup-cycle"
            optionTestId={(c) => `signup-cycle-${c}`}
            options={BILLING_CYCLES.map((c) => ({
              value: c,
              label: t[c === "yearly" ? "marketing.prCycleYearly" : "marketing.prCycleMonthly"],
            }))}
          />
          <p className="mt-2 text-caption text-muted-foreground">
            {formatMessage(t["marketing.signupYearlyNote"], { months: YEARLY_FREE })}
          </p>
        </div>

        <PlanChoiceList
          value={planId}
          cycle={cycle}
          onChange={onPlanChange}
          labelledBy="signup-plan-title"
          enterpriseNote={t["marketing.signupEnterpriseNote"]}
        />

        <p className="mt-4 text-small">
          <Link
            href={`/${locale === "ar" ? "ar" : "en"}/pricing#compare`}
            className="inline-flex min-h-11 items-center font-medium text-accent hover:underline md:min-h-0"
            data-testid="link-compare-plans"
          >
            {t["marketing.signupCompare"]}
          </Link>
        </p>

        <div
          className="sticky bottom-0 z-10 mt-5 border-t border-border bg-background pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:-mx-[var(--gutter)] max-sm:px-[var(--gutter)]"
          data-testid="signup-continue-bar"
        >
          <Button
            type="button"
            className={AUTH_BUTTON}
            onClick={onContinue}
            data-testid="button-signup-continue"
          >
            {t["marketing.signupContinue"]}
          </Button>
          <p className="mt-3 text-caption text-muted-foreground">
            {t["marketing.signupChangeAnyTime"]}
          </p>
        </div>
      </div>
    );
  }
);
