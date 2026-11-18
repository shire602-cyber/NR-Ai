import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { PLAN_LIMIT_EVENT, type PlanLimitDetail } from "@/lib/plan-limit";
import { planFeatureLabelKey } from "@/lib/plan-routes";
import { useSubscription } from "@/hooks/useSubscription";
import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";
import type { PlanFeature } from "@shared/plans";

/**
 * The upgrade prompt for a write the server refused because of the plan (402 / 403 with
 * PLAN_REQUIRED, TIER_LOCKED, USAGE_LIMIT_REACHED, STORAGE_LIMIT_REACHED or
 * COMPANY_LIMIT_REACHED). Mounted once in the app shell; any API call announces the refusal
 * (lib/plan-limit.ts), so every locked action explains itself the same way, in both languages.
 */
export function PlanLimitDialog() {
  const { t } = useTranslation();
  const { checkoutAvailable } = useSubscription();
  const [detail, setDetail] = useState<PlanLimitDetail | null>(null);

  useEffect(() => {
    const onLimit = (e: Event) => setDetail((e as CustomEvent<PlanLimitDetail>).detail);
    window.addEventListener(PLAN_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, onLimit);
  }, []);

  if (!detail) return null;
  const plan = detail.requiredPlan ? t[`marketing.prPlan_${detail.requiredPlan}`] : undefined;
  const module = detail.feature ? t[planFeatureLabelKey(detail.feature as PlanFeature)] : undefined;

  const title =
    detail.code === "PLAN_REQUIRED"
      ? t["components.planLimitTrialEndedTitle"]
      : detail.code === "TIER_LOCKED"
        ? formatMessage(t["components.planLimitLockedTitle"], {
            module: module ?? t["components.planLimitThisModule"],
          })
        : t["components.planLimitReachedTitle"];

  const body =
    detail.code === "PLAN_REQUIRED"
      ? t["components.planLimitTrialEndedBody"]
      : detail.code === "TIER_LOCKED"
        ? formatMessage(t["components.planLimitLockedBody"], { plan: plan ?? "" })
        : detail.code === "STORAGE_LIMIT_REACHED"
          ? t["components.planLimitStorageBody"]
          : detail.code === "COMPANY_LIMIT_REACHED"
            ? t["components.planLimitCompaniesBody"]
            : (t[`components.planLimitUsageBody_${detail.resource ?? "default"}`] ??
              t["components.planLimitUsageBody_default"]);

  const subject = encodeURIComponent(`Muhasib.ai plan${plan ? `: ${plan}` : ""}`);

  return (
    <Dialog open onOpenChange={(open) => (!open ? setDetail(null) : undefined)}>
      <DialogContent size="sm" data-testid="plan-limit-dialog" data-code={detail.code}>
        <DialogHeader>
          <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <p className="text-small text-muted-foreground">{t["components.planLimitDataSafe"]}</p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setDetail(null)}>
            {t["components.planLimitNotNow"]}
          </Button>
          {checkoutAvailable ? (
            <Button asChild onClick={() => setDetail(null)}>
              <Link href="/subscription" data-testid="plan-limit-see-plans">
                {t["components.planLimitSeePlans"]}
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <a
                href={`mailto:${UPGRADE_CONTACT_EMAIL}?subject=${subject}`}
                data-testid="plan-limit-contact"
              >
                {t["components.planLimitContactUs"]}
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
