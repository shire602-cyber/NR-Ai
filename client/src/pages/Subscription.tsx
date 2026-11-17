import { PageHeader } from "@/components/ui/page-header";
import { PlanCard } from "@/components/marketing/PlanCard";
import { PLANS as MARKETING_PLANS, planNameKey } from "@/components/marketing/plans";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { T } from "@/components/layout/T";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";
import { useSubscription } from "@/hooks/useSubscription";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoneyText } from "@/lib/format-money";
import { formatDate as formatDisplayDate } from "@/lib/format-date";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { TrialBanner } from "@/components/TrialBanner";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/queryClient";
import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";
import {
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
      "pages.subscription20ReceiptsMonth",
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
      "pages.subscription200ReceiptsMonth",
      "pages.subscription50AiCreditsMonth",
      "pages.subscriptionOcrComingSoon",
      "pages.subscriptionBankImportsReconciliation",
      "pages.subscriptionInventoryManagement",
      "pages.subscriptionQuotesEstimates",
      "pages.subscriptionCreditNotes",
      "pages.subscriptionRecurringInvoices",
      "pages.subscriptionMultiCurrency",
      "pages.subscriptionPriorityEmailSupport",
    ],
    limits: {
      invoices: 200,
      receipts: 200,
      aiCredits: 50,
      users: 3,
    },
  },
  {
    id: "professional",
    name: "pages.subscriptionProfessional",
    monthlyPrice: 149,
    yearlyPrice: 119,
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
      "pages.subscriptionEInvoicingWithProvider",
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
    yearlyPrice: 239,
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

/** "Contact us to upgrade" link while online checkout is not configured. */
function contactHref(planName?: string): string {
  const subject = encodeURIComponent(`Muhasib.ai upgrade${planName ? `: ${planName}` : ""}`);
  return `mailto:${UPGRADE_CONTACT_EMAIL}?subject=${subject}`;
}

function UsageMeter({
  label,
  used,
  limit,
  icon: Icon,
  onUpgrade,
  unit,
  postOfferLimit,
  canUpgrade = true,
  checkoutAvailable = true,
}: {
  label: string;
  used: number;
  limit: number;
  icon: React.ElementType;
  onUpgrade?: () => void;
  /** Suffix for used / limit figures (storage: "MB"). */
  unit?: string;
  /** Launch offer: this limit is not enforced yet; the figure is the limit after the offer. */
  postOfferLimit?: number;
  canUpgrade?: boolean;
  checkoutAvailable?: boolean;
}) {
  const notEnforcedYet = postOfferLimit !== undefined;
  if (notEnforcedYet) limit = -1;
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
        <span className="flex items-center gap-3">
          <span
            className={`text-sm tabular-nums ${isAtLimit ? "text-destructive font-semibold" : isNearLimit ? "text-warning" : "text-muted-foreground"}`}
          >
            {isUnlimited
              ? formatMessage(t["pages.subscriptionUsedCount"], { used })
              : `${used}${unit ? ` ${unit}` : ""} / ${limit}${unit ? ` ${unit}` : ""}`}
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
      {notEnforcedYet && (
        <p className="text-xs text-muted-foreground" data-testid="usage-offer-note">
          {formatMessage(t["pages.subscriptionNoLimitDuringOffer"], {
            limit: `${postOfferLimit}${unit ? ` ${unit}` : ""}`,
          })}
        </p>
      )}
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
  const { subscription, usage, tierName, isLoading, enforcement, checkoutAvailable } =
    useSubscription();
  const { companyId } = useDefaultCompany();
  const { can } = useCompanyPermission();
  const { toast } = useToast();
  // Trial period: invoices, receipts and seats are metered but not limited until billing enforcement
  // starts; AI credits, storage and companies are cost caps and always show their limit.
  const offerOpen = !enforcement;
  const canManageBilling = can("billing.manage");

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlan = PLANS.find((p) => p.id === tierName) || PLANS[0];
  const scrollToPlans = () =>
    document.getElementById("subscription-plans")?.scrollIntoView({ behavior: "smooth" });
  const isDowngrade = (planId: string) =>
    planId === "free" ||
    PLANS.findIndex((p) => p.id === tierName) > PLANS.findIndex((p) => p.id === planId);
  const upgradeProps = {
    onUpgrade: scrollToPlans,
    canUpgrade: canManageBilling,
    checkoutAvailable,
  };
  /** During the launch offer a limit is shown only as the post-offer figure; -1 = unlimited. */
  const offerNote = (limit: number): number | undefined =>
    offerOpen && limit !== -1 ? limit : undefined;

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow={t["pages.companyProfileEyebrow"]}
          title={t["pages.subscriptionPageTitle"]}
          description={t["pages.subscriptionPageDescription"]}
        />

        <TrialBanner />

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
                  <Star className="w-3 h-3 me-1" />
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
                  <Badge dot variant={subscription.status === "active" ? "success" : "danger"}>
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
                    {tierName === "free" ? (
                      <T k="pages.subscriptionRenewal" />
                    ) : (
                      <T k="pageLabels.currentPeriodEnds" />
                    )}
                  </span>
                  <span className="font-medium">
                    {tierName === "free"
                      ? t["pages.subscriptionNoRenewal"]
                      : formatDisplayDate(subscription.currentPeriodEnd, locale)}
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
                postOfferLimit={offerNote(usage?.invoices?.limit ?? currentPlan.limits.invoices)}
                icon={FileText}
                {...upgradeProps}
              />
              <UsageMeter
                label={t["pages.subscriptionUsageReceipts"]}
                used={usage?.receipts?.used ?? 0}
                limit={usage?.receipts?.limit ?? currentPlan.limits.receipts}
                postOfferLimit={offerNote(usage?.receipts?.limit ?? currentPlan.limits.receipts)}
                icon={Receipt}
                {...upgradeProps}
              />
              <UsageMeter
                label={t["pages.subscriptionUsageAiCredits"]}
                used={usage?.aiCredits?.used ?? 0}
                limit={usage?.aiCredits?.limit ?? currentPlan.limits.aiCredits}
                icon={Brain}
                {...upgradeProps}
              />
              <UsageMeter
                label={t["pages.subscriptionUsageTeamMembers"]}
                used={usage?.users?.used ?? 0}
                limit={usage?.users?.limit ?? currentPlan.limits.users}
                postOfferLimit={offerNote(usage?.users?.limit ?? currentPlan.limits.users)}
                icon={Users}
                {...upgradeProps}
              />
              {usage?.storage && usage.storage.used != null && (
                <UsageMeter
                  label={t["pages.subscriptionUsageStorage"]}
                  used={usage.storage.used}
                  limit={usage.storage.limit}
                  unit="MB"
                  icon={HardDrive}
                  {...upgradeProps}
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
        <div
          id="subscription-plans"
          className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4 scroll-mt-4"
        >
          {/* WP-E (spec 3.15): the plan grid reuses the site's PlanCard so the app and the
              pricing page show plans the same way; only the action differs here. */}
          {MARKETING_PLANS.map((plan) => {
            const isCurrent = plan.id === tierName;
            const planName = t[planNameKey(plan.id)];
            const action = isCurrent ? (
              <Button variant="outline" className="h-10 w-full" disabled>
                <T k="pageLabels.currentPlan" />
              </Button>
            ) : !checkoutAvailable && canManageBilling ? (
              <Button
                className="h-10 w-full"
                variant={plan.featured ? "default" : "outline"}
                asChild
                data-testid={`plan-contact-${plan.id}`}
              >
                <a href={contactHref(planName)}>
                  {isDowngrade(plan.id)
                    ? t["pages.subscriptionContactUs"]
                    : t["pages.subscriptionContactToUpgrade"]}
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
                  : t["pages.subscriptionUpgrade"]}
              </Button>
            );
            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                cycle={billingCycle}
                action={action}
                headingLevel="h3"
                className={isCurrent ? "ring-1 ring-primary/40" : undefined}
              />
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
                    <th className="text-start py-3 pe-4 font-medium text-muted-foreground">
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
                        "20",
                        "200",
                        "pages.subscriptionUnlimited",
                        "pages.subscriptionUnlimited",
                      ],
                    },
                    {
                      label: "pages.subscriptionAiCreditsMonth",
                      values: ["10", "50", "500", "pages.subscriptionUnlimited"],
                    },
                    {
                      label: "pages.subscriptionTeamMembers",
                      values: ["1", "3", "10", "pages.subscriptionUnlimited"],
                    },
                    {
                      label: "pages.subscriptionOcrReceiptScanning",
                      values: [
                        false,
                        "pages.subscriptionComingSoon",
                        "pages.subscriptionComingSoon",
                        "pages.subscriptionComingSoon",
                      ],
                    },
                    {
                      label: "pages.subscriptionBankReconciliation",
                      values: [true, true, true, true],
                    },
                    {
                      label: "pages.subscriptionEInvoicing",
                      values: [
                        false,
                        false,
                        "pages.subscriptionWithProvider",
                        "pages.subscriptionWithProvider",
                      ],
                    },
                    {
                      label: "pages.subscriptionQuotesEstimates",
                      values: [false, true, true, true],
                    },
                    { label: "pages.subscriptionCreditNotes", values: [false, true, true, true] },
                    {
                      label: "pages.subscriptionRecurringInvoices",
                      values: [false, true, true, true],
                    },
                    { label: "pages.subscriptionMultiCurrency", values: [false, true, true, true] },
                    {
                      label: "pages.subscriptionPurchaseOrders",
                      values: [false, false, true, true],
                    },
                    {
                      label: "pages.subscriptionAdvancedReports",
                      values: [false, false, true, true],
                    },
                    {
                      label: "pages.subscriptionBulkOperations",
                      values: [false, false, true, true],
                    },
                    { label: "pages.subscriptionAiCfoAdvisor", values: [false, false, true, true] },
                    {
                      label: "pages.subscriptionPayrollIntegration",
                      values: [false, false, true, true],
                    },
                    {
                      label: "pages.subscriptionInventoryManagement",
                      values: [false, true, true, true],
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
                      <td className="py-3 pe-4 text-muted-foreground">{t[row.label]}</td>
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
