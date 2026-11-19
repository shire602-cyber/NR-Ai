import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { apiRequest } from "@/lib/queryClient";
import { PAID_PLAN_IDS, TRIAL_LIMITS } from "@shared/plans";
import { TRIAL_DAYS } from "@shared/trial";

type Choice = (typeof PAID_PLAN_IDS)[number] | "none";

interface PlanDetail {
  state: "trial" | "active" | "expired" | "firm";
  planId: string | null;
  trialEndsAt: string | null;
  chosenPlan: {
    planId: (typeof PAID_PLAN_IDS)[number];
    billingCycle: "monthly" | "yearly";
    source: string | null;
    chosenAt: string | null;
  } | null;
  activationRequestedAt: string | null;
}

interface PlanResult {
  state: "trial" | "active" | "expired" | null;
  planId: string | null;
  storedPlanId: string;
  trialEndsAt: string | null;
}

/**
 * NR admin: set a company's plan (WQ7). While online checkout is not configured, a customer who
 * chooses a plan writes to us and an admin applies it here (PUT /api/admin/companies/:id/plan,
 * audited). "No plan" puts the company back on its trial if it has not ended, else read-only.
 */
export function AdminPlanControl({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  // The customer's choice preselects the controls until the admin changes them.
  const [planPick, setPlan] = useState<Choice | null>(null);
  const [cyclePick, setCycle] = useState<"monthly" | "yearly" | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);
  const queryClient = useQueryClient();

  // STEP4: what the customer chose (and asked for), so the admin applies it in one click.
  const detail = useQuery<PlanDetail>({
    queryKey: ["/api/admin/companies", companyId, "plan"],
    queryFn: () => apiRequest("GET", `/api/admin/companies/${companyId}/plan`),
    retry: false,
  });
  const chosen = detail.data?.chosenPlan ?? null;
  const plan: Choice = planPick ?? chosen?.planId ?? "starter";
  const cycle: "monthly" | "yearly" = cyclePick ?? chosen?.billingCycle ?? "monthly";

  const apply = useMutation({
    mutationFn: (body: Record<string, unknown>): Promise<PlanResult> =>
      apiRequest("PUT", `/api/admin/companies/${companyId}/plan`, body),
    onSuccess: (r) => {
      setResult(r);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", companyId, "plan"] });
      toast({ title: translateNow("adminConsole.planSaved") });
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.error"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const stateText = (r: PlanResult) =>
    r.state === "active" && r.planId
      ? t[`marketing.prPlan_${r.planId}`]
      : r.state === "trial"
        ? formatMessage(t["adminConsole.planTrialUntil"], {
            date: r.trialEndsAt ? formatDate(r.trialEndsAt, locale) : "",
          })
        : t["adminConsole.planReadOnly"];

  return (
    <section
      className="mt-6 space-y-3 border-t border-border pt-4"
      aria-labelledby={`admin-plan-${companyId}`}
      data-testid="admin-plan-control"
    >
      <h3 id={`admin-plan-${companyId}`} className="text-small font-semibold">
        {t["adminConsole.planTitle"]}
      </h3>
      <p className="text-caption text-muted-foreground">{t["adminConsole.planHelp"]}</p>
      {detail.data ? (
        <div className="space-y-1 text-small" data-testid="admin-plan-choice">
          <p>
            {formatMessage(t["adminConsole.planNow"], {
              state: stateText({
                state: detail.data.state === "firm" ? null : detail.data.state,
                planId: detail.data.planId,
                storedPlanId: detail.data.planId ?? "free",
                trialEndsAt: detail.data.trialEndsAt,
              }),
            })}
          </p>
          <p data-testid="admin-plan-customer-choice">
            {chosen
              ? formatMessage(t["adminConsole.planCustomerChoice"], {
                  plan: t[`marketing.prPlan_${chosen.planId}`],
                  cycle:
                    t[
                      `marketing.pr${chosen.billingCycle === "yearly" ? "CycleYearly" : "CycleMonthly"}`
                    ],
                  date: chosen.chosenAt ? formatDate(chosen.chosenAt, locale) : "",
                  source: t[`adminConsole.planSource_${chosen.source ?? "settings"}`] ?? "",
                })
              : t["adminConsole.planNoChoice"]}
          </p>
          {detail.data.activationRequestedAt ? (
            <p className="font-medium text-warning" data-testid="admin-plan-activation">
              {formatMessage(t["adminConsole.planActivationRequested"], {
                date: formatDate(detail.data.activationRequestedAt, locale),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`admin-plan-select-${companyId}`}>{t["adminConsole.planLabel"]}</Label>
          <Select value={plan} onValueChange={(v) => setPlan(v as Choice)}>
            <SelectTrigger id={`admin-plan-select-${companyId}`} data-testid="admin-plan-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAID_PLAN_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {t[`marketing.prPlan_${id}`]}
                </SelectItem>
              ))}
              <SelectItem value="none">{t["adminConsole.planNone"]}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`admin-cycle-select-${companyId}`}>{t["adminConsole.planCycle"]}</Label>
          <Select value={cycle} onValueChange={(v) => setCycle(v as "monthly" | "yearly")}>
            <SelectTrigger id={`admin-cycle-select-${companyId}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">{t["marketing.prCycleMonthly"]}</SelectItem>
              <SelectItem value="yearly">{t["marketing.prCycleYearly"]}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {chosen ? (
          <Button
            type="button"
            size="sm"
            disabled={apply.isPending}
            onClick={() =>
              apply.mutate({ planId: chosen.planId, billingCycle: chosen.billingCycle })
            }
            data-testid="admin-plan-apply-chosen"
          >
            {formatMessage(t["adminConsole.planApplyChosen"], {
              plan: t[`marketing.prPlan_${chosen.planId}`],
              cycle:
                t[
                  `marketing.pr${chosen.billingCycle === "yearly" ? "CycleYearly" : "CycleMonthly"}`
                ],
            })}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={chosen ? "outline" : "default"}
          disabled={apply.isPending}
          onClick={() =>
            apply.mutate(
              plan === "none" ? { planId: "none" } : { planId: plan, billingCycle: cycle }
            )
          }
          data-testid="admin-plan-apply"
        >
          {t["adminConsole.planApply"]}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={apply.isPending}
          onClick={() =>
            apply.mutate({
              planId: "none",
              trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
              note: `trial extended (${TRIAL_LIMITS.aiCreditsPerMonth} AI credits)`,
            })
          }
          data-testid="admin-plan-extend-trial"
        >
          {formatMessage(t["adminConsole.planExtendTrial"], { days: TRIAL_DAYS })}
        </Button>
      </div>
      {result ? (
        <p className="text-small" role="status" data-testid="admin-plan-result">
          {formatMessage(t["adminConsole.planNow"], { state: stateText(result) })}
        </p>
      ) : null}
    </section>
  );
}
