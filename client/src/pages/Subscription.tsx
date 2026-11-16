import { PageHeader } from "@/components/ui/page-header";
import { T } from "@/components/layout/T";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";
import { useSubscription } from "@/hooks/useSubscription";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
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
} from "lucide-react";

// R18-02: plan names, descriptions and features are translation keys (pages namespace).
const PLANS = [
  {
    id: "free",
    name: "pages.subscriptionFree",
    monthlyPrice: 0,
    yearlyPrice: 0,
    icon: Layers,
    description: "pages.subscriptionGetStartedWithBasicAccounting",
    color: "from-gray-500 to-gray-600",
    features: [
      "pages.subscription1User",
      "pages.subscription20InvoicesMonth",
      "pages.subscription10ReceiptsMonth",
      "pages.subscription10AiCreditsMonth",
      "pages.subscriptionBasicDashboard",
      "pages.subscriptionVatReports",
      "pages.subscriptionEmailSupport",
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
    name: "pages.subscriptionStarter",
    monthlyPrice: 49,
    yearlyPrice: 39,
    icon: Zap,
    description: "pages.subscriptionForFreelancersAndSmallTeams",
    color: "from-blue-500 to-cyan-600",
    features: [
      "pages.subscription3Users",
      "pages.subscription200InvoicesMonth",
      "pages.subscription100ReceiptsMonth",
      "pages.subscription50AiCreditsMonth",
      "pages.subscriptionOcrReceiptScanning",
      "pages.subscriptionBankImportsReconciliation",
      "pages.subscriptionEInvoicingXmlWorkflow",
      "pages.subscriptionQuotesEstimates",
      "pages.subscriptionCreditNotes",
      "pages.subscriptionRecurringInvoices",
      "pages.subscriptionMultiCurrency",
      "pages.subscriptionPriorityEmailSupport",
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
    name: "pages.subscriptionProfessional",
    monthlyPrice: 129,
    yearlyPrice: 99,
    icon: Crown,
    description: "pages.subscriptionForGrowingBusinesses",
    popular: true,
    color: "from-primary to-violet-600",
    features: [
      "pages.subscription10Users",
      "pages.subscriptionUnlimitedInvoices",
      "pages.subscriptionUnlimitedReceipts",
      "pages.subscription500AiCreditsMonth",
      "pages.subscriptionEverythingInStarter",
      "pages.subscriptionAiCfoFinancialAdvisor",
      "pages.subscriptionPurchaseOrders",
      "pages.subscriptionAdvancedReports",
      "pages.subscriptionBulkOperations",
      "pages.subscriptionPayrollIntegration",
      "pages.subscriptionInventoryManagement",
      "pages.subscriptionPhoneChatSupport",
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
    name: "pages.subscriptionEnterprise",
    monthlyPrice: 299,
    yearlyPrice: 249,
    icon: Gem,
    description: "pages.subscriptionForLargeOrganizations",
    color: "from-amber-500 to-orange-600",
    features: [
      "pages.subscriptionUnlimitedUsers",
      "pages.subscriptionUnlimitedEverything",
      "pages.subscriptionUnlimitedAiCredits",
      "pages.subscriptionEverythingInProfessional",
      "pages.subscriptionApiAccess",
      "pages.subscriptionWhiteLabelOptions",
      "pages.subscriptionDedicatedAccountant",
      "pages.subscriptionCustomIntegrations",
      "pages.subscriptionEnterpriseSupportTerms",
      "pages.subscriptionMultiCompanySupport",
    ],
    limits: {
      invoices: -1,
      receipts: -1,
      aiCredits: -1,
      users: -1,
    },
  },
];

/** Whole-number price in AED for the active locale ("AED 49" / "‏49 د.إ.‏"). */
function formatCurrency0(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(amount);
}

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
  const isUnlimited = limit === -1;
  const percentage = isUnlimited ? 0 : Math.min((used / limit) * 100, 100);
  const isNearLimit = !isUnlimited && percentage >= 80;
  const isAtLimit = !isUnlimited && percentage >= 100;
  const { t } = useTranslation();

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
          {isUnlimited
            ? formatMessage(t["pages.subscriptionUsedCount"], { used })
            : `${used} / ${limit}`}
        </span>
      </div>
      {!isUnlimited && (
        <Progress
          value={percentage}
          aria-label={label}
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
  const { t, locale } = useTranslation();
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

  const currentPlan = PLANS.find((p) => p.id === tierName) || PLANS[0];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <PageHeader
        eyebrow={t["pages.companyProfileEyebrow"]}
        title={t["pages.subscriptionPageTitle"]}
        description={t["pages.subscriptionPageDescription"]}
      />

      {/* Current Plan & Usage */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Plan Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                <T k="pageLabels.currentPlan" />
              </CardTitle>
              <Badge
                variant={tierName === "free" ? "secondary" : "default"}
                className={tierName !== "free" ? "" : ""}
              >
                <Star className="w-3 h-3 mr-1" />
                {t[currentPlan.name]}
              </Badge>
            </div>
            <CardDescription>{t[currentPlan.description]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {subscription?.status && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  <T k="banking.common.status" />
                </span>
                <Badge variant={subscription.status === "active" ? "default" : "destructive"}>
                  {t[`pages.subscriptionStatus_${subscription.status}`] ?? subscription.status}
                </Badge>
              </div>
            )}
            {subscription?.billingCycle && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  <T k="pageLabels.billingCycle" />
                </span>
                <span className="font-medium capitalize">
                  {t[`pages.subscriptionCycle_${subscription.billingCycle}`] ??
                    subscription.billingCycle}
                </span>
              </div>
            )}
            {subscription?.currentPeriodEnd && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  <T k="pageLabels.currentPeriodEnds" />
                </span>
                <span className="font-medium">
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString(
                    locale === "ar" ? "ar-AE" : "en-AE"
                  )}
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
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-2" />
                )}
                {t["pages.subscriptionManageBilling"]}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Usage Card */}
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
              limit={usage?.invoices?.limit ?? currentPlan.limits.invoices}
              icon={FileText}
            />
            <UsageMeter
              label={t["pages.subscriptionUsageReceipts"]}
              used={usage?.receipts?.used ?? 0}
              limit={usage?.receipts?.limit ?? currentPlan.limits.receipts}
              icon={Receipt}
            />
            <UsageMeter
              label={t["pages.subscriptionUsageAiCredits"]}
              used={usage?.aiCredits?.used ?? 0}
              limit={usage?.aiCredits?.limit ?? currentPlan.limits.aiCredits}
              icon={Brain}
            />
            <UsageMeter
              label={t["pages.subscriptionUsageTeamMembers"]}
              used={usage?.users?.used ?? 0}
              limit={usage?.users?.limit ?? currentPlan.limits.users}
              icon={Users}
            />
            {usage?.storage && usage.storage.used != null && (
              <UsageMeter
                label={t["pages.subscriptionUsageStorage"]}
                used={usage.storage.used}
                limit={usage.storage.limit}
                icon={HardDrive}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {companyId && <BillingDocuments companyId={companyId} />}

      {/* Billing Cycle Toggle */}
      <div className="flex items-center justify-center gap-4 pt-4">
        <span
          className={`text-sm font-medium ${billingCycle === "monthly" ? "text-foreground" : "text-muted-foreground"}`}
        >
          <T k="firm.cycleMonthly" />
        </span>
        <Switch
          aria-label={t["pages.subscriptionYearlyBilling"]}
          checked={billingCycle === "yearly"}
          onCheckedChange={(checked) => setBillingCycle(checked ? "yearly" : "monthly")}
        />
        <span
          className={`text-sm font-medium ${billingCycle === "yearly" ? "text-foreground" : "text-muted-foreground"}`}
        >
          <T k="pageLabels.subscriptionYearly" />
        </span>
        {billingCycle === "yearly" && (
          <Badge variant="secondary" className="bg-success/10 text-success border-success/20">
            {t["pages.subscriptionSaveUpTo"]}
          </Badge>
        )}
      </div>

      {/* Plan Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => {
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
                <div className="absolute top-0 right-0 px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-bl-lg">
                  <T k="pageLabels.mostPopular" />
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
                    <CardTitle className="text-lg">{t[plan.name]}</CardTitle>
                  </div>
                </div>
                <CardDescription>{t[plan.description]}</CardDescription>

                <div className="pt-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">
                      {price === 0 ? t["pages.subscriptionFree"] : formatCurrency0(price, locale)}
                    </span>
                    {price > 0 && (
                      <span className="text-muted-foreground text-sm">
                        {t["pages.subscriptionPerMonth"]}
                      </span>
                    )}
                  </div>
                  {billingCycle === "yearly" && plan.monthlyPrice > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatMessage(t["pages.subscriptionYearlyNote"], {
                        total: formatCurrency0(plan.yearlyPrice * 12, locale),
                        saving: formatCurrency0(
                          (plan.monthlyPrice - plan.yearlyPrice) * 12,
                          locale
                        ),
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
                      <span>{t[feature]}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-2">
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" disabled>
                      <T k="pageLabels.currentPlan" />
                    </Button>
                  ) : (
                    <Button
                      className={`w-full ${plan.popular ? "hover:" : ""}`}
                      variant={plan.popular ? "default" : "outline"}
                      onClick={() => checkoutMutation.mutate(plan.id)}
                      disabled={checkoutMutation.isPending}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CreditCard className="w-4 h-4 mr-2" />
                      )}
                      {plan.monthlyPrice === 0
                        ? t["pages.subscriptionDowngrade"]
                        : PLANS.findIndex((p) => p.id === tierName) >
                            PLANS.findIndex((p) => p.id === plan.id)
                          ? t["pages.subscriptionDowngrade"]
                          : t["pages.subscriptionUpgrade"]}
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
          <CardTitle>
            <T k="pageLabels.featureComparison" />
          </CardTitle>
          <CardDescription>
            <T k="pageLabels.seeWhatEachPlanIncludesAt" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 pr-4 font-medium text-muted-foreground">
                    <T k="pageLabels.feature" />
                  </th>
                  {PLANS.map((plan) => (
                    <th key={plan.id} className="text-center py-3 px-4 font-medium">
                      {t[plan.name]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "pages.subscriptionInvoicesMonth",
                    values: [
                      "20",
                      "200",
                      "pages.subscriptionUnlimited",
                      "pages.subscriptionUnlimited",
                    ],
                  },
                  {
                    label: "pages.subscriptionReceiptsMonth",
                    values: [
                      "10",
                      "100",
                      "pages.subscriptionUnlimited",
                      "pages.subscriptionUnlimited",
                    ],
                  },
                  {
                    label: "pages.subscriptionAiCreditsMonth",
                    values: ["5", "50", "500", "pages.subscriptionUnlimited"],
                  },
                  {
                    label: "pages.subscriptionTeamMembers",
                    values: ["1", "3", "10", "pages.subscriptionUnlimited"],
                  },
                  {
                    label: "pages.subscriptionOcrReceiptScanning",
                    values: [false, true, true, true],
                  },
                  {
                    label: "pages.subscriptionBankReconciliation",
                    values: [false, true, true, true],
                  },
                  { label: "pages.subscriptionEInvoicing", values: [false, true, true, true] },
                  { label: "pages.subscriptionQuotesEstimates", values: [false, true, true, true] },
                  { label: "pages.subscriptionCreditNotes", values: [false, true, true, true] },
                  {
                    label: "pages.subscriptionRecurringInvoices",
                    values: [false, true, true, true],
                  },
                  { label: "pages.subscriptionMultiCurrency", values: [false, true, true, true] },
                  { label: "pages.subscriptionPurchaseOrders", values: [false, false, true, true] },
                  {
                    label: "pages.subscriptionAdvancedReports",
                    values: [false, false, true, true],
                  },
                  { label: "pages.subscriptionBulkOperations", values: [false, false, true, true] },
                  { label: "pages.subscriptionAiCfoAdvisor", values: [false, false, true, true] },
                  {
                    label: "pages.subscriptionPayrollIntegration",
                    values: [false, false, true, true],
                  },
                  {
                    label: "pages.subscriptionInventoryManagement",
                    values: [false, false, true, true],
                  },
                  { label: "pages.subscriptionApiAccess", values: [false, false, false, true] },
                  { label: "pages.subscriptionWhiteLabel", values: [false, false, false, true] },
                  {
                    label: "pages.subscriptionDedicatedAccountant",
                    values: [false, false, false, true],
                  },
                  {
                    label: "pages.subscriptionEnterpriseSupportTerms",
                    values: [false, false, false, true],
                  },
                ].map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <td className="py-3 pr-4 text-muted-foreground">{t[row.label]}</td>
                    {row.values.map((value, i) => (
                      <td key={i} className="text-center py-3 px-4">
                        {typeof value === "boolean" ? (
                          value ? (
                            <Check className="w-4 h-4 text-success mx-auto" />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )
                        ) : (
                          <span className="font-medium">{t[value] ?? value}</span>
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
  const money = (fils: number, cur: string) =>
    `${cur} ${(Number(fils) / 100).toLocaleString(locale === "ar" ? "ar-AE" : "en-AE", { minimumFractionDigits: 2 })}`;
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
