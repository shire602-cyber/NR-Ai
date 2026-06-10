import { PageHeader } from '@/components/ui/page-header';
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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

const PLANS = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    icon: Layers,
    description: "Get started with basic accounting",
    color: "from-gray-500 to-gray-600",
    features: [
      "1 user",
      "20 invoices/month",
      "10 receipts/month",
      "10 AI credits/month",
      "Basic dashboard",
      "VAT reports",
      "Email support",
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
    description: "For freelancers and small teams",
    color: "from-blue-500 to-cyan-600",
    features: [
      "3 users",
      "200 invoices/month",
      "100 receipts/month",
      "50 AI credits/month",
      "OCR receipt scanning",
      "Bank feeds & reconciliation",
      "E-invoicing (FTA compliant)",
      "Quotes & estimates",
      "Credit notes",
      "Recurring invoices",
      "Multi-currency",
      "Priority email support",
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
    description: "For growing businesses",
    popular: true,
    color: "from-primary to-violet-600",
    features: [
      "10 users",
      "Unlimited invoices",
      "Unlimited receipts",
      "500 AI credits/month",
      "Everything in Starter",
      "AI CFO financial advisor",
      "Purchase orders",
      "Advanced reports",
      "Bulk operations",
      "Payroll integration",
      "Inventory management",
      "Phone & chat support",
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
    description: "For large organizations",
    color: "from-amber-500 to-orange-600",
    features: [
      "Unlimited users",
      "Unlimited everything",
      "Unlimited AI credits",
      "Everything in Professional",
      "API access",
      "White-label options",
      "Dedicated accountant",
      "Custom integrations",
      "SLA & 24/7 support",
      "Multi-company support",
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
        <span className={`text-sm ${isAtLimit ? "text-destructive font-semibold" : isNearLimit ? "text-amber-500" : "text-muted-foreground"}`}>
          {isUnlimited ? `${used} used` : `${used} / ${limit}`}
        </span>
      </div>
      {!isUnlimited && (
        <Progress
          value={percentage}
          className={`h-2 ${isAtLimit ? "[&>div]:bg-destructive" : isNearLimit ? "[&>div]:bg-amber-500" : ""}`}
        />
      )}
      {isUnlimited && (
        <div className="h-2 rounded-full bg-secondary">
          <div className="h-full rounded-full bg-green-500/40 w-full" />
        </div>
      )}
    </div>
  );
}

export default function Subscription() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const { subscription, usage, tierName, isLoading } = useSubscription();
  const { companyId } = useDefaultCompany();

  const checkoutMutation = useMutation({
    mutationFn: (planId: string) => {
      if (!companyId) throw new Error('No company selected');
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
      if (!companyId) throw new Error('No company selected');
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
        eyebrow="Settings"
        title="Subscription & Billing"
        description="Manage your plan, usage, and billing details"
      />

      {/* Current Plan & Usage */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Plan Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Current Plan</CardTitle>
              <Badge
                variant={tierName === "free" ? "secondary" : "default"}
                className={tierName !== "free" ? "bg-gradient-to-r from-primary to-violet-600" : ""}
              >
                <Star className="w-3 h-3 mr-1" />
                {currentPlan.name}
              </Badge>
            </div>
            <CardDescription>{currentPlan.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {subscription?.status && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={subscription.status === "active" ? "default" : "destructive"}>
                  {subscription.status}
                </Badge>
              </div>
            )}
            {subscription?.billingCycle && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Billing Cycle</span>
                <span className="font-medium capitalize">{subscription.billingCycle}</span>
              </div>
            )}
            {subscription?.currentPeriodEnd && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current Period Ends</span>
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
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-2" />
                )}
                Manage Billing
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Usage Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usage This Month</CardTitle>
            <CardDescription>Your resource consumption for the current billing period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <UsageMeter
              label="Invoices"
              used={usage?.invoices?.used ?? 0}
              limit={usage?.invoices?.limit ?? currentPlan.limits.invoices}
              icon={FileText}
            />
            <UsageMeter
              label="Receipts"
              used={usage?.receipts?.used ?? 0}
              limit={usage?.receipts?.limit ?? currentPlan.limits.receipts}
              icon={Receipt}
            />
            <UsageMeter
              label="AI Credits"
              used={usage?.aiCredits?.used ?? 0}
              limit={usage?.aiCredits?.limit ?? currentPlan.limits.aiCredits}
              icon={Brain}
            />
            <UsageMeter
              label="Team Members"
              used={usage?.users?.used ?? 0}
              limit={usage?.users?.limit ?? currentPlan.limits.users}
              icon={Users}
            />
            {usage?.storage && (
              <UsageMeter
                label="Storage"
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
        <span className={`text-sm font-medium ${billingCycle === "monthly" ? "text-foreground" : "text-muted-foreground"}`}>
          Monthly
        </span>
        <Switch
          checked={billingCycle === "yearly"}
          onCheckedChange={(checked) => setBillingCycle(checked ? "yearly" : "monthly")}
        />
        <span className={`text-sm font-medium ${billingCycle === "yearly" ? "text-foreground" : "text-muted-foreground"}`}>
          Yearly
        </span>
        {billingCycle === "yearly" && (
          <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20">
            Save up to 23%
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
                  ? "border-primary/50 bg-gradient-to-b from-primary/5 to-transparent shadow-lg shadow-primary/10"
                  : isCurrent
                  ? "border-primary/30 bg-primary/5"
                  : "border-border"
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 right-0 px-3 py-1 bg-gradient-to-r from-primary to-violet-600 text-white text-xs font-medium rounded-bl-lg">
                  Most Popular
                </div>
              )}

              <CardHeader className="pb-4">
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className={`w-10 h-10 rounded-lg bg-gradient-to-br ${plan.color} flex items-center justify-center`}
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
                      {price === 0 ? "Free" : `AED ${price}`}
                    </span>
                    {price > 0 && (
                      <span className="text-muted-foreground text-sm">/mo</span>
                    )}
                  </div>
                  {billingCycle === "yearly" && plan.monthlyPrice > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      AED {plan.yearlyPrice * 12}/year (save AED{" "}
                      {(plan.monthlyPrice - plan.yearlyPrice) * 12}/yr)
                    </p>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <ul className="space-y-2.5">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-2">
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" disabled>
                      Current Plan
                    </Button>
                  ) : (
                    <Button
                      className={`w-full ${
                        plan.popular
                          ? "bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90"
                          : ""
                      }`}
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
                        ? "Downgrade"
                        : PLANS.findIndex((p) => p.id === tierName) >
                          PLANS.findIndex((p) => p.id === plan.id)
                        ? "Downgrade"
                        : "Upgrade"}
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
          <CardTitle>Feature Comparison</CardTitle>
          <CardDescription>See what each plan includes at a glance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 pr-4 font-medium text-muted-foreground">Feature</th>
                  {PLANS.map((plan) => (
                    <th key={plan.id} className="text-center py-3 px-4 font-medium">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Invoices/month", values: ["20", "200", "Unlimited", "Unlimited"] },
                  { label: "Receipts/month", values: ["10", "100", "Unlimited", "Unlimited"] },
                  { label: "AI Credits/month", values: ["5", "50", "500", "Unlimited"] },
                  { label: "Team members", values: ["1", "3", "10", "Unlimited"] },
                  { label: "OCR receipt scanning", values: [false, true, true, true] },
                  { label: "Bank reconciliation", values: [false, true, true, true] },
                  { label: "E-invoicing", values: [false, true, true, true] },
                  { label: "Quotes & estimates", values: [false, true, true, true] },
                  { label: "Credit notes", values: [false, true, true, true] },
                  { label: "Recurring invoices", values: [false, true, true, true] },
                  { label: "Multi-currency", values: [false, true, true, true] },
                  { label: "Purchase orders", values: [false, false, true, true] },
                  { label: "Advanced reports", values: [false, false, true, true] },
                  { label: "Bulk operations", values: [false, false, true, true] },
                  { label: "AI CFO advisor", values: [false, false, true, true] },
                  { label: "Payroll integration", values: [false, false, true, true] },
                  { label: "Inventory management", values: [false, false, true, true] },
                  { label: "API access", values: [false, false, false, true] },
                  { label: "White-label", values: [false, false, false, true] },
                  { label: "Dedicated accountant", values: [false, false, false, true] },
                  { label: "SLA & 24/7 support", values: [false, false, false, true] },
                ].map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <td className="py-3 pr-4 text-muted-foreground">{row.label}</td>
                    {row.values.map((value, i) => (
                      <td key={i} className="text-center py-3 px-4">
                        {typeof value === "boolean" ? (
                          value ? (
                            <Check className="w-4 h-4 text-green-500 mx-auto" />
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
