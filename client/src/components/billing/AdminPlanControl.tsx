import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
  const [plan, setPlan] = useState<Choice>("starter");
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [result, setResult] = useState<PlanResult | null>(null);

  const apply = useMutation({
    mutationFn: (body: Record<string, unknown>): Promise<PlanResult> =>
      apiRequest("PUT", `/api/admin/companies/${companyId}/plan`, body),
    onSuccess: (r) => {
      setResult(r);
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
        <Button
          type="button"
          size="sm"
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
