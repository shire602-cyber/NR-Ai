import { Link, useLocation } from "wouter";
import { Lock } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { planPhraseKey } from "@/lib/plan-state";
import { PLAN_LOCK_ALWAYS_OPEN, featureForRoute, planFeatureLabelKey } from "@/lib/plan-routes";
import { useSubscription } from "@/hooks/useSubscription";

/** A module outside the paid plan stays readable and shows an upgrade prompt. */
export function PlanLockBanner() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { enforcement, planState, getRequiredTier, canWrite } = useSubscription();
  if (!enforcement || planState !== "active") return null;
  if (PLAN_LOCK_ALWAYS_OPEN.some((p) => location === p || location.startsWith(`${p}/`)))
    return null;

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
