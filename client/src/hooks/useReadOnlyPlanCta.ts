import { formatMessage, useTranslation } from "@/lib/i18n";
import { planCta, planPhase, planPhraseKey } from "@/lib/plan-state";
import { useSubscription } from "@/hooks/useSubscription";

/**
 * In a read-only workspace (trial over, no active plan) a "New invoice" button leads to a locked
 * form. Pages that push a write action ask this hook first: it returns the plan action to show
 * instead (the same one the trial banner offers), or null while the workspace can write.
 */
export function useReadOnlyPlanCta(): { href: string; label: string } | null {
  const { t } = useTranslation();
  const { isReadOnly, enforcement, chosenPlan, activationRequestedAt } = useSubscription();
  if (!enforcement || !isReadOnly) return null;
  const phase = planPhase({ trialEnded: true, chosen: !!chosenPlan, activationRequestedAt });
  const cta = planCta(phase);
  if (cta === "choose") return { href: "/subscription", label: t["components.planLockChoosePlan"] };
  const href = "/subscription#after-trial";
  if (cta === "activate" && chosenPlan) {
    return {
      href,
      label: formatMessage(t["components.planLockActivate"], {
        plan: t[planPhraseKey(chosenPlan.planId)],
      }),
    };
  }
  return { href, label: t["marketing.trialSeePlan"] };
}
