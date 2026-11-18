import { Link, useLocation } from "wouter";
import { Lock } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { featureForRoute, planFeatureLabelKey } from "@/lib/plan-routes";
import { useSubscription } from "@/hooks/useSubscription";

/** Pages a read-only workspace still uses fully (choosing a plan, settings, help). */
const ALWAYS_OPEN = ["/subscription", "/settings", "/onboarding", "/help", "/profile"];

/**
 * The locked state of a module (WQ7): shown above the page, never instead of it, so the data
 * stays readable. Two cases:
 *   - the trial ended without a plan: the whole workspace is read-only;
 *   - the module is not in the company's plan: that module is read-only.
 * The server refuses the writes either way (server/middleware/featureGate.ts).
 */
export function PlanLockBanner() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { enforcement, entitlement, isReadOnly, getRequiredTier, canWrite } = useSubscription();
  if (!enforcement || !entitlement) return null;
  if (ALWAYS_OPEN.some((p) => location === p || location.startsWith(`${p}/`))) return null;

  const action = (
    <Button asChild size="sm" variant="outline">
      <Link href="/subscription" data-testid="plan-lock-upgrade">
        {t[isReadOnly ? "components.planLockChoosePlan" : "components.planLockUpgrade"]}
      </Link>
    </Button>
  );

  if (isReadOnly) {
    return (
      <div className="px-3 pt-3 md:px-6">
        <Alert
          tone="warning"
          icon={Lock}
          title={t["components.planLockTrialEndedTitle"]}
          action={action}
          data-testid="plan-lock-banner"
          data-lock="expired"
        >
          {t["components.planLockTrialEndedBody"]}
        </Alert>
      </div>
    );
  }

  const feature = featureForRoute(location);
  if (!feature || canWrite(feature)) return null;
  const plan = t[`marketing.prPlan_${getRequiredTier(feature)}`];
  return (
    <div className="px-3 pt-3 md:px-6">
      <Alert
        tone="info"
        icon={Lock}
        title={formatMessage(t["components.planLockModuleTitle"], {
          module: t[planFeatureLabelKey(feature)],
        })}
        action={action}
        data-testid="plan-lock-banner"
        data-lock={feature}
      >
        {formatMessage(t["components.planLockModuleBody"], { plan })}
      </Alert>
    </div>
  );
}
