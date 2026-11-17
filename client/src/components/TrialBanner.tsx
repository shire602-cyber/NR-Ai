import { Clock } from "lucide-react";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useSubscription } from "@/hooks/useSubscription";
import { UPGRADE_CONTACT_EMAIL, type TrialState } from "@shared/trial";

/**
 * Free-trial banner for the dashboard and the subscription page (shared/trial.ts). While the trial
 * runs it counts the days left; once it has ended it asks the customer to contact us. Nothing is
 * locked either way. Pass `trial` to render without the subscription query (tests).
 */
export function TrialBanner({
  trial: given,
  className = "",
}: {
  trial?: TrialState | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const { trial: fetched } = useSubscription();
  const trial = given === undefined ? fetched : given;
  if (!trial) return null;
  const subject = encodeURIComponent("Muhasib.ai plan request");
  return (
    <div
      role="note"
      data-testid="trial-banner"
      data-trial-state={trial.ended ? "ended" : "active"}
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
        trial.ended ? "border-warning/40 bg-warning/10" : "border-primary/30 bg-primary/5"
      } ${className}`}
    >
      <Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1">
        {trial.ended
          ? t["marketing.trialEnded"]
          : formatMessage(t["marketing.trialDaysLeft"], { count: trial.daysLeft })}
      </p>
      {trial.ended && (
        <a
          className="font-medium underline underline-offset-4"
          href={`mailto:${UPGRADE_CONTACT_EMAIL}?subject=${subject}`}
          data-testid="trial-contact-us"
        >
          {t["marketing.trialContactUs"]}
        </a>
      )}
    </div>
  );
}
