import { Link } from "wouter";
import { Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { useSubscription, type ChosenPlan } from "@/hooks/useSubscription";
import type { TrialState } from "@shared/trial";

/** The trial banner goes to the warning tone this many days before the end. */
const WARN_DAYS = 3;

/**
 * Free-trial banner for the dashboard (shared/trial.ts). While the trial runs it counts the days
 * left and, when the customer chose a plan at sign-up (STEP4), names it ("then Professional");
 * in the last days it asks to activate that plan; once the trial has ended it says the workspace
 * is read-only and offers "Activate <plan>" (or "Choose a plan" with no choice). Data stays
 * readable and nothing is deleted (shared/plans.ts). Pass `trial` / `chosen` to render without
 * the subscription query (tests).
 */
export function TrialBanner({
  trial: given,
  chosen: givenChosen,
  className = "",
}: {
  trial?: TrialState | null;
  chosen?: ChosenPlan | null;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const { trial: fetched, chosenPlan } = useSubscription();
  const trial = given === undefined ? fetched : given;
  const chosen = givenChosen === undefined ? chosenPlan : givenChosen;
  if (!trial) return null;
  const planName = chosen ? t[`marketing.prPlan_${chosen.planId}`] : "";
  const warn = !trial.ended && trial.daysLeft <= WARN_DAYS;
  const urgent = trial.ended || warn;
  const Icon = trial.ended ? Lock : Clock;
  const text = trial.ended
    ? t["marketing.trialEndedReadOnly"]
    : warn && chosen
      ? formatMessage(t["marketing.trialEndsActivate"], {
          date: formatDate(trial.endsAt, locale),
          plan: planName,
        })
      : chosen
        ? formatMessage(t["marketing.trialThenPlan"], { count: trial.daysLeft, plan: planName })
        : formatMessage(t["marketing.trialDaysLeft"], { count: trial.daysLeft });
  const hint = !trial.ended && !chosen ? t["marketing.trialChooseForAfter"] : null;
  return (
    <div
      role="note"
      data-testid="trial-banner"
      data-trial-state={trial.ended ? "ended" : "active"}
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
        urgent ? "border-warning/40 bg-warning/10" : "border-primary/30 bg-primary/5"
      } ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1">
        {text}
        {hint ? <span className="block text-muted-foreground">{hint}</span> : null}
      </p>
      {urgent && chosen ? (
        <Button asChild size="sm">
          <Link href="/subscription#after-trial" data-testid="trial-activate">
            {formatMessage(t["components.planLockActivate"], { plan: planName })}
          </Link>
        </Button>
      ) : (
        <Link
          className="font-medium underline underline-offset-4"
          href={chosen ? "/subscription#after-trial" : "/subscription"}
          data-testid={trial.ended ? "trial-contact-us" : "trial-see-plans"}
        >
          {chosen && !trial.ended
            ? t["marketing.trialSeePlan"]
            : t[trial.ended ? "components.planLockChoosePlan" : "marketing.trialSeePlans"]}
        </Link>
      )}
    </div>
  );
}
