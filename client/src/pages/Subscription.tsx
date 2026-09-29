import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSubscription } from "@/hooks/useSubscription";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  CreditCard,
  Check,
  Crown,
  Gem,
  Layers,
  Zap,
  ExternalLink,
  Loader2,
  Users,
  FileText,
  Receipt,
  Brain,
  HardDrive,
  Star,
  Clock,
} from "lucide-react";
import { messages as pageMessages } from "./Subscription.i18n";

interface BillingStatus {
  plan: string;
  status: string;
  trialEndsAt: string | null;
  daysLeft: number;
  enforcement: boolean;
}

/**
 * Trial banner: "X days left in your trial" / "Trial ended". Renders nothing
 * for paying, free, grandfathered and firm-managed companies.
 */
function TrialBanner({ companyId }: { companyId: string | null | undefined }) {
  const tr = pageMessages.useT();

  const { locale } = useTranslation();
  const isAr = locale === "ar";
  const { data } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status", companyId],
    queryFn: () => apiRequest("GET", `/api/billing/status?companyId=${companyId}`),
    enabled: Boolean(companyId),
  });

  if (!data || (data.status !== "trialing" && data.status !== "trial_expired")) return null;

  const expired = data.status === "trial_expired";
  const days = data.daysLeft;
  const message = expired
    ? tr("yourTrialHasEndedChooseA")
    : isAr
      ? days === 1
        ? "يوم واحد متبقٍ في فترتك التجريبية"
        : `${days} أيام متبقية في فترتك التجريبية`
      : `${days} ${days === 1 ? "day" : "days"} left in your trial`;

  return (
    <div
      role="status"
      data-testid="trial-banner"
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
        expired
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-primary/30 bg-primary/5 text-foreground"
      }`}
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span className="font-medium">{message}</span>
      {data.trialEndsAt && (
        <span className="ms-auto text-xs text-muted-foreground">
          {new Date(data.trialEndsAt).toLocaleDateString(isAr ? "ar-AE" : undefined)}
        </span>
      )}
    </div>
  );
}

const getPlans = () => [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    icon: Layers,
    description: pageMessages.t("getStartedWithBasicAccounting"),
    color: "from-gray-500 to-gray-600",
    features: [
      pageMessages.t("n1User"),
      pageMessages.t("n20InvoicesMonth"),
      pageMessages.t("n10ReceiptsMonth"),
      pageMessages.t("n10AiCreditsMonth"),
      pageMessages.t("basicDashboard"),
      pageMessages.t("vatReports"),
      pageMessages.t("emailSupport"),
    ],
    limits: {
      invoices: 20,
      receipts: 20,
      aiCredits: 10,
      users: 1,
    },
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 49,
    yearlyPrice: 39,
    icon: Zap,
    description: pageMessages.t("forFreelancersAndSmallTeams"),
    color: "from-blue-500 to-cyan-600",
    features: [
      pageMessages.t("n3Users"),
      pageMessages.t("n200InvoicesMonth"),
      pageMessages.t("n100ReceiptsMonth"),
      pageMessages.t("n50AiCreditsMonth"),
      pageMessages.t("ocrReceiptScanning"),
      pageMessages.t("bankImportsReconciliation"),
      pageMessages.t("eInvoicingXmlWorkflow"),
      pageMessages.t("quotesEstimates"),
      pageMessages.t("creditNotes"),
      pageMessages.t("recurringInvoices"),
      pageMessages.t("multiCurrency"),
      pageMessages.t("priorityEmailSupport"),
    ],
    limits: {
      invoices: 200,
      receipts: 100,
      aiCredits: 50,
      users: 3,
    },
  },
  {
    id: "professional",
    name: "Professional",
    monthlyPrice: 129,
    yearlyPrice: 99,
    icon: Crown,
    description: pageMessages.t("forGrowingBusinesses"),
    popular: true,
    color: "from-primary to-violet-600",
    features: [
      pageMessages.t("n10Users"),
      pageMessages.t("unlimitedInvoices"),
      pageMessages.t("unlimitedReceipts"),
      pageMessages.t("n500AiCreditsMonth"),
      pageMessages.t("everythingInStarter"),
      pageMessages.t("aiCfoFinancialAdvisor"),
      pageMessages.t("purchaseOrders"),
      pageMessages.t("advancedReports"),
      pageMessages.t("bulkOperations"),
      pageMessages.t("payrollIntegration"),
      pageMessages.t("inventoryManagement"),
      pageMessages.t("phoneChatSupport"),
    ],
    limits: {
      invoices: -1,
      receipts: -1,
      aiCredits: 500,
      users: 10,
    },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: 299,
    yearlyPrice: 249,
    icon: Gem,
    description: pageMessages.t("forLargeOrganizations"),
    color: "from-amber-500 to-orange-600",
    features: [
      pageMessages.t("unlimitedUsers"),
      pageMessages.t("unlimitedEverything"),
      pageMessages.t("unlimitedAiCredits"),
      pageMessages.t("everythingInProfessional"),
      pageMessages.t("apiAccess"),
      pageMessages.t("whiteLabelOptions"),
      pageMessages.t("dedicatedAccountant"),
      pageMessages.t("customIntegrations"),
      pageMessages.t("enterpriseSupportTerms"),
      pageMessages.t("multiCompanySupport"),
    ],
    limits: {
      invoices: -1,
      receipts: -1,
      aiCredits: -1,
      users: -1,
    },
  },
];

function UsageMeter({
  label,
  used,
  limit,
  icon: Icon,
}: {
  label: string;
  used: number;
  limit: number;
  icon: React.ElementType;
}) {
  const tr = pageMessages.useT();

  const isUnlimited = limit === -1;
  const percentage = isUnlimited ? 0 : Math.min((used / limit) * 100, 100);
  const isNearLimit = !isUnlimited && percentage >= 80;
  const isAtLimit = !isUnlimited && percentage >= 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span
          className={`text-sm ${isAtLimit ? "text-destructive font-semibold" : isNearLimit ? "text-warning" : "text-muted-foreground"}`}
        >
          {isUnlimited ? tr("used", { used }) : `${used} / ${limit}`}
        </span>
      </div>
      {!isUnlimited && (
        <Progress
          value={percentage}
          className={`h-2 ${isAtLimit ? "[&>div]:bg-destructive" : isNearLimit ? "[&>div]:bg-warning" : ""}`}
        />
      )}
      {isUnlimited && (
        <div className="h-2 rounded-full bg-secondary">
          <div className="h-full rounded-full bg-success/40 w-full" />
        </div>
      )}
    </div>
  );
}

export default function Subscription() {
  const tr = pageMessages.useT();

  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const { subscription, usage, tierName, isLoading } = useSubscription();
  const { companyId } = useDefaultCompany();

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
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlan = getPlans().find((p) => p.id === tierName) || getPlans()[0];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <PageHeader
        eyebrow={tr("settings")}
        title={tr("subscriptionBilling")}
        description={tr("manageYourPlanUsageAndBilling")}
      />

      <TrialBanner companyId={companyId} />

      {/* Current Plan & Usage */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Plan Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{tr("currentPlan")}</CardTitle>
              <Badge
                variant={tierName === "free" ? "secondary" : "default"}
                className={tierName !== "free" ? "" : ""}
              >
                <Star className="w-3 h-3 me-1" />
                {currentPlan.name}
              </Badge>
            </div>
            <CardDescription>{currentPlan.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {subscription?.status && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{tr("status")}</span>
                <Badge variant={subscription.status === "active" ? "default" : "destructive"}>
                  {subscription.status}
                </Badge>
              </div>
            )}
            {subscription?.billingCycle && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{tr("billingCycle")}</span>
                <span className="font-medium capitalize">{subscription.billingCycle}</span>
              </div>
            )}
            {subscription?.currentPeriodEnd && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{tr("currentPeriodEnds")}</span>
                <span className="font-medium">
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </span>
              </div>
            )}
            {subscription?.stripeCustomerId && (
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
              >
                {portalMutation.isPending ? (
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4 me-2" />
                )}
                {tr("manageBilling")}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Usage Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tr("usageThisMonth")}</CardTitle>
            <CardDescription>{tr("yourResourceConsumptionForTheCurrent")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <UsageMeter
              label={tr("invoices")}
              used={usage?.invoices?.used ?? 0}
              limit={usage?.invoices?.limit ?? currentPlan.limits.invoices}
              icon={FileText}
            />
            <UsageMeter
              label={tr("receipts")}
              used={usage?.receipts?.used ?? 0}
              limit={usage?.receipts?.limit ?? currentPlan.limits.receipts}
              icon={Receipt}
            />
            <UsageMeter
              label={tr("aiCredits")}
              used={usage?.aiCredits?.used ?? 0}
              limit={usage?.aiCredits?.limit ?? currentPlan.limits.aiCredits}
              icon={Brain}
            />
            <UsageMeter
              label={tr("teamMembers")}
              used={usage?.users?.used ?? 0}
              limit={usage?.users?.limit ?? currentPlan.limits.users}
              icon={Users}
            />
            {usage?.storage && (
              <UsageMeter
                label={tr("storage")}
                used={usage.storage.used}
                limit={usage.storage.limit}
                icon={HardDrive}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Billing Cycle Toggle */}
      <div className="flex items-center justify-center gap-4 pt-4">
        <span
          className={`text-sm font-medium ${billingCycle === "monthly" ? "text-foreground" : "text-muted-foreground"}`}
        >
          {tr("monthly")}
        </span>
        <Switch
          checked={billingCycle === "yearly"}
          onCheckedChange={(checked) => setBillingCycle(checked ? "yearly" : "monthly")}
        />
        <span
          className={`text-sm font-medium ${billingCycle === "yearly" ? "text-foreground" : "text-muted-foreground"}`}
        >
          {tr("yearly")}
        </span>
        {billingCycle === "yearly" && (
          <Badge variant="secondary" className="bg-success/10 text-success border-success/20">
            {tr("saveUpTo23")}
          </Badge>
        )}
      </div>

      {/* Plan Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {getPlans().map((plan) => {
          const isCurrent = plan.id === tierName;
          const price = billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
          const PlanIcon = plan.icon;

          return (
            <Card
              key={plan.id}
              className={`relative overflow-hidden transition-all duration-300 hover:-translate-y-1 ${
                plan.popular
                  ? "border-primary/50 shadow-lg shadow-primary/10"
                  : isCurrent
                    ? "border-primary/30 bg-primary/5"
                    : "border-border"
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 end-0 px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-es-lg">
                  {tr("mostPopular")}
                </div>
              )}

              <CardHeader className="pb-4">
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className={`w-10 h-10 rounded-lg ${plan.color} flex items-center justify-center`}
                  >
                    <PlanIcon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                  </div>
                </div>
                <CardDescription>{plan.description}</CardDescription>

                <div className="pt-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">
                      {price === 0 ? tr("free") : `AED ${price}`}
                    </span>
                    {price > 0 && <span className="text-muted-foreground text-sm">{tr("mo")}</span>}
                  </div>
                  {billingCycle === "yearly" && plan.monthlyPrice > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr("aedYearSaveAedYr", {
                        value: plan.yearlyPrice * 12,
                        value2: (plan.monthlyPrice - plan.yearlyPrice) * 12,
                      })}
                    </p>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <ul className="space-y-2.5">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-2">
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" disabled>
                      {tr("currentPlan")}
                    </Button>
                  ) : (
                    <Button
                      className={`w-full ${plan.popular ? "hover:" : ""}`}
                      variant={plan.popular ? "default" : "outline"}
                      onClick={() => checkoutMutation.mutate(plan.id)}
                      disabled={checkoutMutation.isPending}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="w-4 h-4 me-2 animate-spin" />
                      ) : (
                        <CreditCard className="w-4 h-4 me-2" />
                      )}
                      {plan.monthlyPrice === 0
                        ? tr("downgrade")
                        : getPlans().findIndex((p) => p.id === tierName) >
                            getPlans().findIndex((p) => p.id === plan.id)
                          ? tr("downgrade")
                          : tr("upgrade")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Feature Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>{tr("featureComparison")}</CardTitle>
          <CardDescription>{tr("seeWhatEachPlanIncludesAt")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-start py-3 pe-4 font-medium text-muted-foreground">
                    {tr("feature")}
                  </th>
                  {getPlans().map((plan) => (
                    <th key={plan.id} className="text-center py-3 px-4 font-medium">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: tr("invoicesMonth"),
                    values: ["20", "200", tr("unlimited"), tr("unlimited")],
                  },
                  {
                    label: tr("receiptsMonth"),
                    values: ["10", "100", tr("unlimited"), tr("unlimited")],
                  },
                  { label: tr("aiCreditsMonth"), values: ["5", "50", "500", tr("unlimited")] },
                  { label: tr("teamMembers2"), values: ["1", "3", "10", tr("unlimited")] },
                  { label: tr("ocrReceiptScanning"), values: [false, true, true, true] },
                  { label: tr("bankReconciliation"), values: [false, true, true, true] },
                  { label: tr("eInvoicing"), values: [false, true, true, true] },
                  { label: tr("quotesEstimates"), values: [false, true, true, true] },
                  { label: tr("creditNotes"), values: [false, true, true, true] },
                  { label: tr("recurringInvoices"), values: [false, true, true, true] },
                  { label: tr("multiCurrency"), values: [false, true, true, true] },
                  { label: tr("purchaseOrders"), values: [false, false, true, true] },
                  { label: tr("advancedReports"), values: [false, false, true, true] },
                  { label: tr("bulkOperations"), values: [false, false, true, true] },
                  { label: tr("aiCfoAdvisor"), values: [false, false, true, true] },
                  { label: tr("payrollIntegration"), values: [false, false, true, true] },
                  { label: tr("inventoryManagement"), values: [false, false, true, true] },
                  { label: tr("apiAccess"), values: [false, false, false, true] },
                  { label: tr("whiteLabel"), values: [false, false, false, true] },
                  { label: tr("dedicatedAccountant"), values: [false, false, false, true] },
                  { label: tr("enterpriseSupportTerms"), values: [false, false, false, true] },
                ].map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <td className="py-3 pe-4 text-muted-foreground">{row.label}</td>
                    {row.values.map((value, i) => (
                      <td key={i} className="text-center py-3 px-4">
                        {typeof value === "boolean" ? (
                          value ? (
                            <Check className="w-4 h-4 text-success mx-auto" />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )
                        ) : (
                          <span className="font-medium">{value}</span>
                        )}
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
  );
}
