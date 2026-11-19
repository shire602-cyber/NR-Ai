import { PageHeader } from "@/components/ui/page-header";
import { PlanCard } from "@/components/marketing/PlanCard";
import { Segmented } from "@/components/marketing/Segmented";
import {
  COMPARE_GROUPS,
  PLANS,
  YEARLY_FREE,
  planNameKey,
  type BillingCycle,
  type Cell,
  type CompareRow,
} from "@/components/marketing/plans";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { T } from "@/components/layout/T";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";
import { usePlanChoiceActions, useSubscription, type ChosenPlan } from "@/hooks/useSubscription";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMoneyText, formatAmountDigits } from "@/lib/format-money";
import { formatDate as formatDisplayDate } from "@/lib/format-date";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { planPhase, planPhraseKey } from "@/lib/plan-state";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/queryClient";
import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";
import {
  TOP_PLAN_ID,
  TRIAL_LIMITS,
  isBillingCycle,
  isPaidPlanId,
  planRank,
  type PaidPlanId,
} from "@shared/plans";
import {
  Check,
  ExternalLink,
  Loader2,
  Users,
  FileText,
  Receipt,
  Brain,
  HardDrive,
  Lock,
  Clock,
} from "lucide-react";

/*
 * Settings › Billing (WQ7). Plans, prices and limits come from shared/plans.ts through the
 * marketing plan list, so this page, /pricing, GET /api/billing/plans and the server gates agree.
 * Status card: trial (days left), active plan, or trial ended (read-only until a plan is chosen).
 * While online checkout is not configured, choosing a plan writes to us and an NR admin sets it.
 */

/** "Contact us to upgrade" link while online checkout is not configured. */
function contactHref(planName?: string): string {
  const subject = encodeURIComponent(`Muhasib.ai plan${planName ? `: ${planName}` : ""}`);
  return `mailto:${UPGRADE_CONTACT_EMAIL}?subject=${subject}`;
}

function UsageMeter({
  label,
  used,
  limit,
  icon: Icon,
  onUpgrade,
  unit,
  canUpgrade = true,
  checkoutAvailable = true,
  testId,
}: {
  label: string;
  used: number;
  limit: number;
  icon: React.ElementType;
  onUpgrade?: () => void;
  /** Suffix for used / limit figures (storage: "MB"). */
  unit?: string;
  canUpgrade?: boolean;
  checkoutAvailable?: boolean;
  testId?: string;
}) {
  const isUnlimited = limit === -1;
  const percentage = isUnlimited ? 0 : limit === 0 ? 100 : Math.min((used / limit) * 100, 100);
  const isNearLimit = !isUnlimited && percentage >= 80;
  const isAtLimit = !isUnlimited && percentage >= 100;
  const { t } = useTranslation();
  const fig = (n: number) =>
    `${formatAmountDigits(n, Number.isInteger(n) ? 0 : 1)}${unit ? ` ${unit}` : ""}`;

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-sm font-medium">{label}</span>
        </div>
        <span className="flex items-center gap-3">
          <span
            dir="ltr"
            className={`text-sm tabular-nums ${isAtLimit ? "font-semibold text-destructive" : isNearLimit ? "text-warning" : "text-muted-foreground"}`}
          >
            {isUnlimited
              ? formatMessage(t["pages.subscriptionUsedOfUnlimited"], { used: fig(used) })
              : `${fig(used)} / ${fig(limit)}`}
          </span>
          {isAtLimit && onUpgrade && !checkoutAvailable && canUpgrade && (
            <Button type="button" size="sm" variant="outline" asChild data-testid="usage-upgrade">
              <a href={contactHref()}>{t["pages.subscriptionContactToUpgrade"]}</a>
            </Button>
          )}
          {isAtLimit && onUpgrade && (checkoutAvailable || !canUpgrade) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onUpgrade}
              disabled={!canUpgrade}
              title={!canUpgrade ? t["common.noPermission"] : undefined}
              data-testid="usage-upgrade"
            >
              {t["pages.subscriptionUpgrade"]}
            </Button>
          )}
        </span>
      </div>
      {!isUnlimited ? (
        <Progress
          value={percentage}
          aria-label={label}
          className={`h-2 ${isAtLimit ? "[&>div]:bg-destructive" : isNearLimit ? "[&>div]:bg-warning" : ""}`}
        />
      ) : (
        <div className="h-2 rounded-full bg-secondary" aria-hidden>
          <div className="h-full w-full rounded-full bg-success/40" />
        </div>
      )}
    </div>
  );
}

/**
 * STEP4: where the customer stands after the trial, one of four states of lib/plan-state.ts (the
 * banners read the same rule). Each has one call to action and dates that are true for it:
 *   running + no choice   "Choose the plan you want after your trial."        -> See plans
 *   running + chosen      "You chose X. Choosing it doesn't keep you working..." -> Activate X (+ Change)
 *   ended   + chosen      "Your trial ended on D. Activate X to add records."  -> Activate X (+ Change)
 *   *       + requested   "Activation requested on D. We'll confirm by email." -> nothing to press
 */
function AfterTrialBlock({
  planName,
  chosenPlan,
  activationRequestedAt,
  endsAt,
  trialEnded,
  canManage,
  pending,
  onActivate,
  onChange,
}: {
  planName: string | null;
  chosenPlan: ChosenPlan | null;
  activationRequestedAt: string | null;
  endsAt: string | null;
  trialEnded: boolean;
  canManage: boolean;
  pending: boolean;
  onActivate: () => void;
  onChange: () => void;
}) {
  const { t, locale } = useTranslation();
  const date = endsAt ? formatDisplayDate(endsAt, locale) : "";
  const phase = planPhase({ trialEnded, chosen: !!chosenPlan, activationRequestedAt });
  return (
    <div
      id="after-trial"
      className="scroll-mt-4 space-y-3 rounded-lg border border-border p-4"
      data-testid="subscription-chosen-plan"
      data-plan-phase={phase.key}
    >
      {chosenPlan && planName ? (
        <>
          <p className="font-medium">
            {formatMessage(t["pages.subscriptionChosenTitle"], { plan: planName })}{" "}
            <span className="font-normal text-muted-foreground">
              {trialEnded
                ? formatMessage(t["pages.subscriptionChosenEnded"], { date, plan: planName })
                : phase.choice === "chosen"
                  ? formatMessage(t["pages.subscriptionChosenRunning"], { date })
                  : null}
            </span>
          </p>
          <p className="text-muted-foreground">
            {formatMessage(t["pages.subscriptionChosenPrice"], {
              price: formatMoneyText(chosenPlan.price, "AED", locale, { fractionDigits: 0 }),
              billed: t[`pages.subscriptionBilled_${chosenPlan.billingCycle}`],
            })}
          </p>
          {activationRequestedAt ? (
            <div data-testid="activation-requested">
              <Badge dot variant="info" className="h-auto whitespace-normal py-1">
                {formatMessage(t["marketing.trialActivationRequested"], {
                  date: formatDisplayDate(activationRequestedAt, locale),
                })}
              </Badge>
              <p className="mt-2 text-muted-foreground">
                {trialEnded
                  ? t["marketing.trialRequestedReadOnly"]
                  : formatMessage(t["pages.subscriptionActivationNext"], { date })}
              </p>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground">{t["pages.subscriptionNothingCharged"]}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={onActivate}
                  disabled={pending || !canManage}
                  title={!canManage ? t["common.noPermission"] : undefined}
                  data-testid="button-activate-plan"
                >
                  {pending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                  {formatMessage(t["pages.subscriptionActivatePlan"], { plan: planName })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onChange}
                  data-testid="button-change-plan"
                >
                  {t["pages.subscriptionChangePlan"]}
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <p>{t["pages.subscriptionNoChoice"]}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={onChange}
            data-testid="button-see-plans-choice"
          >
            {t["pages.subscriptionSeePlans"]}
          </Button>
        </>
      )}
    </div>
  );
}

function CompareCell({ cell, unit }: { cell: Cell; unit?: CompareRow["unit"] }) {
  const { t } = useTranslation();
  if (cell === true) {
    return (
      <>
        <Check className="mx-auto h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden />
        <span className="sr-only">{t["marketing.prIncluded"]}</span>
      </>
    );
  }
  if (cell === false) {
    return (
      <>
        <span className="text-muted-foreground" aria-hidden>
          {"–"}
        </span>
        <span className="sr-only">{t["marketing.pricingNotIncluded"]}</span>
      </>
    );
  }
  if (typeof cell === "number") {
    return (
      <span className="font-medium tabular-nums">
        {unit === "gb"
          ? formatMessage(t["marketing.prValGb"], { n: formatAmountDigits(cell, 0) })
          : formatAmountDigits(cell, 0)}
      </span>
    );
  }
  return <span className="font-medium">{t[cell]}</span>;
}

export default function Subscription() {
  const { t, locale } = useTranslation();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(() => {
    if (typeof window === "undefined") return "monthly";
    const c = new URLSearchParams(window.location.search).get("cycle");
    return isBillingCycle(c) ? c : "monthly";
  });
  const {
    subscription,
    usage,
    entitlement,
    planState,
    trial,
    isLoading,
    checkoutAvailable,
    chosenPlan,
    activationRequestedAt,
  } = useSubscription();
  const { choose, activate } = usePlanChoiceActions();
  // STEP4: /subscription?choose=<plan>&cycle=<cycle> (a signed-in visitor who followed a plan link).
  const [highlight] = useState<PaidPlanId | null>(() => {
    if (typeof window === "undefined") return null;
    const id = new URLSearchParams(window.location.search).get("choose");
    return isPaidPlanId(id) ? id : null;
  });
  const inTrialFlow = (planState === "trial" || planState === "expired") && !checkoutAvailable;
  const { companyId } = useDefaultCompany();
  const { can } = useCompanyPermission();
  const { toast } = useToast();
  const canManageBilling = can("billing.manage");
  /** The paid plan the company is on (null during the trial and after it). */
  const paidPlan: PaidPlanId | null = planState === "active" ? (entitlement?.planId ?? null) : null;

  const checkoutMutation = useMutation({
    mutationFn: (planId: string) => {
      if (!companyId) throw new Error("No company selected");
      return apiRequest("POST", `/api/companies/${companyId}/billing/checkout`, {
        planId,
        billingCycle,
      });
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      const unavailable = error instanceof ApiError && error.status === 503;
      toast({
        title: t["pages.subscriptionCheckoutFailed"],
        description: unavailable ? t["pages.subscriptionCheckoutUnavailable"] : error.message,
        variant: "destructive",
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("No company selected");
      return apiRequest("POST", `/api/companies/${companyId}/billing/portal`);
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({
        title: t["pages.subscriptionPortalFailed"],
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (isLoading) return;
    if (highlight) {
      document.getElementById("subscription-plans")?.scrollIntoView({ block: "center" });
      document
        .querySelector<HTMLElement>(
          `[data-testid="plan-choose-${highlight}"], [data-testid="plan-upgrade-${highlight}"]`
        )
        ?.focus();
    } else if (window.location.hash === "#after-trial") {
      document.getElementById("after-trial")?.scrollIntoView({ block: "center" });
    }
  }, [isLoading, highlight]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const scrollToPlans = () =>
    document.getElementById("subscription-plans")?.scrollIntoView({ behavior: "smooth" });
  const isDowngrade = (planId: PaidPlanId) =>
    paidPlan !== null && planRank(paidPlan) > planRank(planId);
  const upgradeProps = {
    onUpgrade: scrollToPlans,
    canUpgrade: canManageBilling,
    checkoutAvailable,
  };

  const phase = planPhase({
    trialEnded: planState === "expired",
    chosen: !!chosenPlan,
    activationRequestedAt,
  });
  const chosenPhrase = chosenPlan ? t[planPhraseKey(chosenPlan.planId)] : "";

  const statusTitle =
    planState === "trial"
      ? formatMessage(t["pages.subscriptionTrialOf"], { plan: t[planNameKey(TOP_PLAN_ID)] })
      : planState === "expired"
        ? t["pages.subscriptionNoPlan"]
        : paidPlan
          ? t[planNameKey(paidPlan)]
          : t["pages.subscriptionFirmBilled"];

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow={t["pages.companyProfileEyebrow"]}
          title={t["pages.subscriptionPageTitle"]}
          description={t["pages.subscriptionPlanPageDescription"]}
        />

        {planState === "expired" ? (
          <Alert
            tone="warning"
            icon={Lock}
            title={t["components.planLockTrialEndedTitle"]}
            data-testid="trial-banner"
            data-trial-state="ended"
            data-plan-phase={phase.key}
            action={
              // One CTA per state: with the plan block below (checkout not configured) the
              // alert only informs; with checkout it is the only "Choose a plan" button.
              !inTrialFlow ? (
                <Button size="sm" onClick={scrollToPlans} data-testid="button-choose-plan">
                  {t["components.planLockChoosePlan"]}
                </Button>
              ) : undefined
            }
          >
            {phase.choice === "requested"
              ? `${formatMessage(t["marketing.trialActivationRequested"], {
                  date: activationRequestedAt
                    ? formatDisplayDate(activationRequestedAt, locale)
                    : "",
                })} ${t["components.planUntilThenReadable"]}`
              : phase.choice === "chosen"
                ? formatMessage(t["components.planLockBodyChosen"], { plan: chosenPhrase })
                : t["components.planLockTrialEndedBody"]}
          </Alert>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Current plan */}
          <Card data-testid="card-current-plan" data-plan-state={planState ?? undefined}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardDescription>
                    <T k="pageLabels.currentPlan" />
                  </CardDescription>
                  <CardTitle className="mt-1 text-lg" data-testid="text-current-plan">
                    {statusTitle}
                  </CardTitle>
                </div>
                {planState === "trial" ? (
                  <Badge dot variant="info">
                    {t["pages.subscriptionStateTrial"]}
                  </Badge>
                ) : planState === "expired" ? (
                  <Badge dot variant="warning">
                    {t["pages.subscriptionStateReadOnly"]}
                  </Badge>
                ) : subscription?.status ? (
                  <Badge dot variant={subscription.status === "active" ? "success" : "danger"}>
                    {t[`pages.subscriptionStatus_${subscription.status}`] ?? subscription.status}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {planState === "trial" && trial ? (
                <>
                  <div
                    className="flex items-center gap-2"
                    data-testid="trial-banner"
                    data-trial-state="active"
                  >
                    <Clock className="h-4 w-4 text-primary" aria-hidden />
                    <span>
                      {formatMessage(t["marketing.trialDaysLeft"], { count: trial.daysLeft })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t["pages.subscriptionTrialEnds"]}
                    </span>
                    <span className="font-medium">{formatDisplayDate(trial.endsAt, locale)}</span>
                  </div>
                  <p className="text-muted-foreground">
                    {
                      t[
                        phase.choice === "none"
                          ? "pages.subscriptionTrialExplain"
                          : "pages.subscriptionTrialOpen"
                      ]
                    }
                  </p>
                  <p className="text-muted-foreground" data-testid="trial-caps">
                    {formatMessage(t["marketing.signupTrialCaps"], {
                      companies: TRIAL_LIMITS.maxCompanies,
                      credits: formatAmountDigits(TRIAL_LIMITS.aiCreditsPerMonth, 0),
                      storage: formatMessage(t["marketing.prValGb"], {
                        n: formatAmountDigits(TRIAL_LIMITS.maxStorageMb / 1024, 0),
                      }),
                    })}
                  </p>
                </>
              ) : null}
              {planState === "expired" ? (
                <p className="text-muted-foreground">
                  {
                    t[
                      phase.choice === "none"
                        ? "pages.subscriptionExpiredExplain"
                        : "pages.subscriptionExpiredSafe"
                    ]
                  }
                </p>
              ) : null}
              {paidPlan && subscription?.billingCycle ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    <T k="pageLabels.billingCycle" />
                  </span>
                  <span className="font-medium">
                    {t[`pages.subscriptionCycle_${subscription.billingCycle}`] ??
                      subscription.billingCycle}
                  </span>
                </div>
              ) : null}
              {paidPlan && subscription?.currentPeriodEnd && subscription.stripeCustomerId ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    <T k="pageLabels.currentPeriodEnds" />
                  </span>
                  <span className="font-medium">
                    {formatDisplayDate(subscription.currentPeriodEnd, locale)}
                  </span>
                </div>
              ) : null}
              {inTrialFlow ? (
                <AfterTrialBlock
                  planName={chosenPlan ? chosenPhrase : null}
                  chosenPlan={chosenPlan}
                  activationRequestedAt={activationRequestedAt ?? null}
                  endsAt={trial?.endsAt ?? entitlement?.trialEndsAt ?? null}
                  trialEnded={planState === "expired"}
                  canManage={canManageBilling}
                  pending={activate.isPending}
                  onActivate={() =>
                    activate.mutate(undefined, {
                      onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
                    })
                  }
                  onChange={scrollToPlans}
                />
              ) : null}
              <p className="text-muted-foreground">{t["pages.subscriptionUnlimitedUsersNote"]}</p>
              {subscription?.stripeCustomerId ? (
                <Button
                  variant="outline"
                  className="mt-2 w-full"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                >
                  {portalMutation.isPending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="me-2 h-4 w-4" />
                  )}
                  {t["pages.subscriptionManageBilling"]}
                </Button>
              ) : planState === "trial" && !inTrialFlow ? (
                <Button
                  className="mt-2 w-full"
                  variant="outline"
                  onClick={scrollToPlans}
                  data-testid="button-see-plans"
                >
                  {t["pages.subscriptionChooseAPlan"]}
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {/* Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pageLabels.usageThisMonth" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.yourResourceConsumptionForTheCurrent" />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <UsageMeter
                label={t["pages.subscriptionUsageInvoices"]}
                used={usage?.invoices?.used ?? 0}
                limit={usage?.invoices?.limit ?? -1}
                icon={FileText}
                testId="usage-invoices"
                {...upgradeProps}
              />
              <UsageMeter
                label={t["pages.subscriptionUsageReceipts"]}
                used={usage?.receipts?.used ?? 0}
                limit={usage?.receipts?.limit ?? -1}
                icon={Receipt}
                testId="usage-receipts"
                {...upgradeProps}
              />
              <UsageMeter
                label={t["pages.subscriptionUsageAiCredits"]}
                used={usage?.aiCredits?.used ?? 0}
                limit={usage?.aiCredits?.limit ?? -1}
                icon={Brain}
                testId="usage-ai"
                {...upgradeProps}
              />
              <UsageMeter
                label={t["pages.subscriptionUsageTeamMembers"]}
                used={usage?.users?.used ?? 0}
                limit={-1}
                icon={Users}
                testId="usage-users"
              />
              {usage?.storage && usage.storage.used != null && (
                <UsageMeter
                  label={t["pages.subscriptionUsageStorage"]}
                  used={usage.storage.used}
                  limit={usage.storage.limit}
                  unit="MB"
                  icon={HardDrive}
                  testId="usage-storage"
                  {...upgradeProps}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {companyId && <BillingDocuments companyId={companyId} />}

        {/* Plans */}
        <section aria-labelledby="subscription-plans-title" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="subscription-plans-title" className="text-h3 font-semibold">
                {t["pages.subscriptionChooseAPlan"]}
              </h2>
              <p className="text-small text-muted-foreground">
                {formatMessage(t["marketing.prYearlyNote"], { months: YEARLY_FREE })}
              </p>
            </div>
            <Segmented
              value={billingCycle}
              onChange={setBillingCycle}
              label={t["marketing.pricingBillingPeriod"]}
              testId="subscription-cycle"
              optionTestId={(c) => `subscription-cycle-${c}`}
              options={[
                { value: "monthly", label: t["marketing.prCycleMonthly"] },
                { value: "yearly", label: t["marketing.prCycleYearly"] },
              ]}
            />
          </div>
          <div
            id="subscription-plans"
            className="grid scroll-mt-4 items-stretch gap-4 md:grid-cols-3"
          >
            {/* Spec 3.15: the plan grid reuses the site's PlanCard; only the action differs. */}
            {PLANS.map((plan) => {
              const isCurrent = plan.id === paidPlan;
              const planName = t[planPhraseKey(plan.id)];
              const isChosen = inTrialFlow && chosenPlan?.planId === plan.id;
              const action = isCurrent ? (
                <Button variant="outline" className="h-10 w-full" disabled>
                  <T k="pageLabels.currentPlan" />
                </Button>
              ) : isChosen ? (
                <Button
                  variant="outline"
                  className="h-10 w-full"
                  disabled
                  data-testid={`plan-chosen-${plan.id}`}
                >
                  <Check className="me-1.5 h-4 w-4" aria-hidden />
                  {t["pages.subscriptionYourChoice"]}
                </Button>
              ) : inTrialFlow ? (
                <Button
                  className="h-10 w-full"
                  variant={plan.featured ? "default" : "outline"}
                  disabled={choose.isPending || !canManageBilling}
                  title={!canManageBilling ? t["common.noPermission"] : undefined}
                  onClick={() =>
                    choose.mutate(
                      { planId: plan.id, billingCycle },
                      {
                        onSuccess: () =>
                          toast({
                            title: formatMessage(t["pages.subscriptionChoiceSaved"], {
                              plan: planName,
                            }),
                          }),
                        onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
                      }
                    )
                  }
                  data-testid={`plan-choose-${plan.id}`}
                >
                  {formatMessage(t["pages.subscriptionChooseForAfterTrial"], { plan: planName })}
                </Button>
              ) : !checkoutAvailable && canManageBilling ? (
                <Button
                  className="h-10 w-full"
                  variant={plan.featured ? "default" : "outline"}
                  asChild
                  data-testid={`plan-contact-${plan.id}`}
                >
                  <a href={contactHref(planName)}>
                    {formatMessage(t["pages.subscriptionChoosePlanContact"], { plan: planName })}
                  </a>
                </Button>
              ) : (
                <Button
                  className="h-10 w-full"
                  variant={plan.featured ? "default" : "outline"}
                  onClick={() => checkoutMutation.mutate(plan.id)}
                  disabled={checkoutMutation.isPending || !canManageBilling}
                  title={!canManageBilling ? t["common.noPermission"] : undefined}
                  data-testid={`plan-upgrade-${plan.id}`}
                >
                  {checkoutMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                  {isDowngrade(plan.id)
                    ? t["pages.subscriptionDowngrade"]
                    : paidPlan
                      ? t["pages.subscriptionUpgrade"]
                      : formatMessage(t["pages.subscriptionChoosePlanNamed"], { plan: planName })}
                </Button>
              );
              return (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  cycle={billingCycle}
                  action={action}
                  headingLevel="h3"
                  className={
                    isCurrent || isChosen || highlight === plan.id
                      ? "ring-1 ring-primary/40"
                      : undefined
                  }
                />
              );
            })}
          </div>
          {!checkoutAvailable ? (
            <p className="text-small text-muted-foreground" data-testid="checkout-contact-note">
              {t["pages.subscriptionContactNote"]}
            </p>
          ) : null}
        </section>

        {/* Comparison: the pricing page's rows (shared/plans.ts), so the two never disagree. */}
        <Card>
          <CardHeader>
            <CardTitle>
              <T k="pageLabels.featureComparison" />
            </CardTitle>
            <CardDescription>{t["pages.subscriptionCompareHelp"]}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="subscription-compare">
                <thead>
                  <tr className="border-b">
                    <th className="py-3 pe-4 text-start font-medium text-muted-foreground">
                      <T k="pageLabels.feature" />
                    </th>
                    {PLANS.map((plan) => (
                      <th key={plan.id} className="px-4 py-3 text-center font-medium">
                        {t[planNameKey(plan.id)]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_GROUPS.flatMap((g) => g.rows).map((row) => (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="py-3 pe-4 text-muted-foreground">{t[row.key]}</td>
                      {PLANS.map((plan) => (
                        <td key={plan.id} className="px-4 py-3 text-center">
                          <CompareCell cell={row.cells[plan.id]} unit={row.unit} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </SettingsLayout>
  );
}

// ─── W5-B (R19-16): VAT-inclusive subscription invoices and receipts ──────────

const DOC_COPY = {
  en: {
    title: "Billing documents",
    help: "Tax invoices and receipts for your subscription. Prices include 5% UAE VAT.",
    none: "No paid invoices yet.",
    invoice: "Tax invoice",
    receipt: "Receipt",
    vat: "VAT",
    total: "Total",
  },
  ar: {
    title: "مستندات الفوترة",
    help: "الفواتير الضريبية والإيصالات لاشتراكك. الأسعار تشمل ضريبة القيمة المضافة 5%.",
    none: "لا توجد فواتير مدفوعة بعد.",
    invoice: "فاتورة ضريبية",
    receipt: "إيصال",
    vat: "الضريبة",
    total: "الإجمالي",
  },
};

function BillingDocuments({ companyId }: { companyId: string }) {
  const { locale } = useI18n();
  const c = DOC_COPY[locale === "ar" ? "ar" : "en"];
  const { data } = useQuery<
    Array<{
      id: string;
      kind: "invoice" | "receipt";
      number: string;
      vatFils: number;
      totalFils: number;
      currency: string;
      issuedAt: string;
    }>
  >({ queryKey: ["/api/companies", companyId, "billing", "documents"], retry: false });
  const money = (fils: number, cur: string) => formatMoneyText(Number(fils) / 100, cur, locale);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{c.title}</CardTitle>
        <CardDescription>{c.help}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!data?.length ? (
          <p className="text-muted-foreground">{c.none}</p>
        ) : (
          data.map((d) => (
            <div key={d.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
              <span>
                {d.kind === "invoice" ? c.invoice : c.receipt} · {d.number}
              </span>
              <span className="text-muted-foreground">
                {c.vat} {money(d.vatFils, d.currency)} · {c.total} {money(d.totalFils, d.currency)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
