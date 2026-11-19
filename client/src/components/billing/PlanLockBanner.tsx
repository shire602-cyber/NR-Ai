import { Link, useLocation } from "wouter";
import { Lock } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { planCta, planPhase, planPhraseKey } from "@/lib/plan-state";
import { PLAN_LOCK_ALWAYS_OPEN, featureForRoute, planFeatureLabelKey } from "@/lib/plan-routes";
import { useSubscription } from "@/hooks/useSubscription";

/**
 * The locked state of a module (WQ7): shown above the page, never instead of it, so the data
 * stays readable. Two cases:
 *   - the trial ended without a plan: the whole workspace is read-only;
 *   - the module is not in the company's plan: that module is read-only.
 * The server refuses the writes either way (server/middleware/featureGate.ts).
 */
export function PlanLockBanner() {
  const { t, locale } = useTranslation();
  const [location] = useLocation();
  const {
    enforcement,
    entitlement,
    isReadOnly,
    getRequiredTier,
    canWrite,
    chosenPlan,
    activationRequestedAt,
  } = useSubscription();
  if (!enforcement || !entitlement) return null;
  if (PLAN_LOCK_ALWAYS_OPEN.some((p) => location === p || location.startsWith(`${p}/`)))
    return null;

  if (isReadOnly) {
    // One state rule (lib/plan-state.ts): the trial ended; the customer has no choice, has
    // chosen, or has asked us to activate. Each state has one call to action.
    const phase = planPhase({
      trialEnded: true,
      chosen: !!chosenPlan,
      activationRequestedAt,
    });
    const cta = planCta(phase);
    const plan = chosenPlan ? t[planPhraseKey(chosenPlan.planId)] : "";
    const body =
      phase.choice === "requested"
        ? `${formatMessage(t["marketing.trialActivationRequested"], {
            date: activationRequestedAt ? formatDate(activationRequestedAt, locale) : "",
          })} ${t["components.planUntilThenReadable"]}`
        : phase.choice === "chosen"
          ? formatMessage(t["components.planLockBodyChosen"], { plan })
          : t["components.planLockTrialEndedBody"];
    return (
      <div className="px-3 pt-3 md:px-6">
        <Alert
          tone="warning"
          icon={Lock}
          title={t["components.planLockTrialEndedTitle"]}
          action={
            <Button asChild size="sm" variant="outline">
              <Link
                href={cta === "choose" ? "/subscription" : "/subscription#after-trial"}
                data-testid="plan-lock-upgrade"
              >
                {cta === "activate"
                  ? formatMessage(t["components.planLockActivate"], { plan })
                  : cta === "see-plan"
                    ? t["marketing.trialSeePlan"]
                    : t["components.planLockChoosePlan"]}
              </Link>
            </Button>
          }
          data-testid="plan-lock-banner"
          data-lock="expired"
          data-plan-phase={phase.key}
        >
          {body}
        </Alert>
      </div>
    );
  }

  const feature = featureForRoute(location);
  if (!feature || canWrite(feature)) return null;
  const plan = t[planPhraseKey(getRequiredTier(feature))];
  return (
    <div className="px-3 pt-3 md:px-6">
      <Alert
        tone="info"
        icon={Lock}
        title={formatMessage(t["components.planLockModuleTitle"], {
          module: t[planFeatureLabelKey(feature)],
        })}
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/subscription" data-testid="plan-lock-upgrade">
              {t["components.planLockUpgrade"]}
            </Link>
          </Button>
        }
        data-testid="plan-lock-banner"
        data-lock={feature}
      >
        {formatMessage(t["components.planLockModuleBody"], { plan })}
      </Alert>
    </div>
  );
}
