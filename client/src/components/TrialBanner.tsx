import { Link } from "wouter";
import { useContext } from "react";
import { Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { planCta, planPhase, planPhraseKey } from "@/lib/plan-state";
import { useSubscription, type ChosenPlan } from "@/hooks/useSubscription";
import type { TrialState } from "@shared/trial";
import { TrialReadOnlyContext } from "@/lib/trial-access";

/** The trial banner goes to the warning tone this many days before the end. */
const WARN_DAYS = 3;

/**
 * Free-trial banner for the dashboard (shared/trial.ts). One of six states (lib/plan-state.ts),
 * each with one call to action and dates that are true for it:
 *   running + no choice   days left, "choose a plan, then activate it"        -> See plans
 *   running + chosen      days left + "You chose X. Activate it before D"     -> See plan / Activate X (last days)
 *   running + requested   days left + "Activation requested on D. We'll confirm by email."  -> See plan
 *   ended   + no choice   locked until a plan is active                     -> Choose a plan
 *   ended   + chosen      "Your trial ended on D. Locked until X is activated"  -> Activate X
 *   ended   + requested   "Activation requested on D..." + still locked    -> See plan
 * Data is kept (shared/plans.ts). Pass `trial` / `chosen` /
 * `activationRequestedAt` to render without the subscription query (tests).
 */
export function TrialBanner({
  trial: given,
  chosen: givenChosen,
  activationRequestedAt: givenRequested,
  className = "",
  endedOnly = false,
}: {
  trial?: TrialState | null;
  chosen?: ChosenPlan | null;
  activationRequestedAt?: string | null;
  className?: string;
  /** Show only once the trial has ended (settings pages that show the trial status). */
  endedOnly?: boolean;
}) {
  const { t, locale } = useTranslation();
  const readOnly = useContext(TrialReadOnlyContext);
  const { trial: fetched, chosenPlan, activationRequestedAt } = useSubscription();
  const trial = given === undefined ? fetched : given;
  const chosen = givenChosen === undefined ? chosenPlan : givenChosen;
  const requestedAt = givenRequested === undefined ? activationRequestedAt : givenRequested;
  if (readOnly || !trial || (endedOnly && !trial.ended)) return null;
  const phase = planPhase({
    trialEnded: trial.ended,
    chosen: !!chosen,
    activationRequestedAt: requestedAt,
  });
  const cta = planCta(phase);
  const plan = chosen ? t[planPhraseKey(chosen.planId)] : "";
  const endDate = formatDate(trial.endsAt, locale);
  const requestedDate = requestedAt ? formatDate(requestedAt, locale) : "";
  const warn = !trial.ended && trial.daysLeft <= WARN_DAYS;
  const urgent = trial.ended || (warn && phase.choice !== "requested");
  const Icon = trial.ended ? Lock : Clock;
  const daysLeft = formatMessage(t["marketing.trialDaysLeft"], { count: trial.daysLeft });
  const requestedLine = formatMessage(t["marketing.trialActivationRequested"], {
    date: requestedDate,
  });

  let text: string;
  let detail: string | null = null;
  switch (phase.key) {
    case "ended-none":
      text = t["marketing.trialEndedReadOnly"];
      break;
    case "ended-chosen":
      text = formatMessage(t["marketing.trialEndedChosen"], { date: endDate, plan });
      break;
    case "ended-requested":
      text = requestedLine;
      detail = t["marketing.trialRequestedReadOnly"];
      break;
    case "running-requested":
      text = daysLeft;
      detail = requestedLine;
      break;
    case "running-chosen":
      if (warn) {
        text = formatMessage(t["marketing.trialEndsActivate"], { date: endDate, plan });
      } else {
        text = daysLeft;
        detail = formatMessage(t["marketing.trialChosenLine"], { date: endDate, plan });
      }
      break;
    default:
      text = daysLeft;
      detail = t["marketing.trialChooseForAfter"];
  }

  // One CTA: a button when the customer has something to do now, otherwise a quiet link.
  const primary = cta === "activate" && (trial.ended || warn);
  const href = cta === "choose" ? "/subscription" : "/subscription#after-trial";
  const label =
    cta === "activate" && primary
      ? formatMessage(t["components.planLockActivate"], { plan })
      : cta === "choose"
        ? t[trial.ended ? "components.planLockChoosePlan" : "marketing.trialSeePlans"]
        : t["marketing.trialSeePlan"];
  const testId = primary ? "trial-activate" : trial.ended ? "trial-contact-us" : "trial-see-plans";

  return (
    <div
      role="note"
      data-testid="trial-banner"
      data-trial-state={trial.ended ? "ended" : "active"}
      data-plan-phase={phase.key}
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
        urgent ? "border-warning/40 bg-warning/10" : "border-primary/30 bg-primary/5"
      } ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1">
        {text}
        {detail ? <span className="block text-muted-foreground">{detail}</span> : null}
      </p>
      {primary ? (
        <Button asChild size="sm">
          <Link href={href} data-testid={testId}>
            {label}
          </Link>
        </Button>
      ) : (
        <Link className="font-medium underline underline-offset-4" href={href} data-testid={testId}>
          {label}
        </Link>
      )}
    </div>
  );
}
