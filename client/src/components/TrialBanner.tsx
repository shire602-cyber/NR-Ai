import { Link } from "wouter";
import { Clock, Lock } from "lucide-react";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useSubscription } from "@/hooks/useSubscription";
import type { TrialState } from "@shared/trial";

/**
 * Free-trial banner for the dashboard (shared/trial.ts). While the trial runs it counts the days
 * left; once it has ended it says the workspace is read-only and links to choosing a plan
 * (shared/plans.ts: data stays readable, nothing is deleted). Pass `trial` to render without the
 * subscription query (tests).
 */
export function TrialBanner({
  trial: given,
  className = "",
  endedOnly = false,
}: {
  trial?: TrialState | null;
  className?: string;
  /** Show only once the trial has ended (settings pages that are read-only after the trial). */
  endedOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { trial: fetched } = useSubscription();
  const trial = given === undefined ? fetched : given;
  if (!trial || (endedOnly && !trial.ended)) return null;
  const Icon = trial.ended ? Lock : Clock;
  return (
    <div
      role="note"
      data-testid="trial-banner"
      data-trial-state={trial.ended ? "ended" : "active"}
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
        trial.ended ? "border-warning/40 bg-warning/10" : "border-primary/30 bg-primary/5"
      } ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1">
        {trial.ended
          ? t["marketing.trialEndedReadOnly"]
          : formatMessage(t["marketing.trialDaysLeft"], { count: trial.daysLeft })}
      </p>
      <Link
        className="font-medium underline underline-offset-4"
        href="/subscription"
        data-testid={trial.ended ? "trial-contact-us" : "trial-see-plans"}
      >
        {t[trial.ended ? "components.planLockChoosePlan" : "marketing.trialSeePlans"]}
      </Link>
    </div>
  );
}
