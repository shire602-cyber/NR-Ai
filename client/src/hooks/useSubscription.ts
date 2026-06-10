import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { useDefaultCompany } from "./useDefaultCompany";

interface SubscriptionData {
  subscription: {
    id: string;
    planId: string;
    planName: string;
    status: string;
    billingCycle: string;
    currentPeriodEnd: string;
    stripeCustomerId: string | null;
    invoicesCreatedThisMonth: number;
    receiptsCreatedThisMonth: number;
    aiCreditsUsedThisMonth: number;
  };
  limits: Record<string, number>;
}

interface UsageData {
  plan: string;
  usage: {
    invoices: { used: number; limit: number };
    receipts: { used: number; limit: number };
    aiCredits: { used: number; limit: number };
    users: { used: number; limit: number };
    storage: { used: number; limit: number };
  };
}

const TIER_FEATURES: Record<string, Record<string, boolean>> = {
  free: {
    quotes: false, creditNotes: false, purchaseOrders: false, invoiceTemplates: false,
    bankImport: false, bulkOps: false, advancedReports: false, apiAccess: false,
    invoicePayment: false, recurringInvoices: false, multiCurrency: false,
    payroll: false, webhooks: false, fixedAssets: false, costCenters: false,
  },
  starter: {
    quotes: true, creditNotes: true, purchaseOrders: false, invoiceTemplates: true,
    bankImport: true, bulkOps: false, advancedReports: false, apiAccess: false,
    invoicePayment: true, recurringInvoices: true, multiCurrency: true,
    payroll: false, webhooks: false, fixedAssets: false, costCenters: false,
  },
  professional: {
    quotes: true, creditNotes: true, purchaseOrders: true, invoiceTemplates: true,
    bankImport: true, bulkOps: true, advancedReports: true, apiAccess: false,
    invoicePayment: true, recurringInvoices: true, multiCurrency: true,
    payroll: true, webhooks: false, fixedAssets: true, costCenters: true,
  },
  enterprise: {
    quotes: true, creditNotes: true, purchaseOrders: true, invoiceTemplates: true,
    bankImport: true, bulkOps: true, advancedReports: true, apiAccess: true,
    invoicePayment: true, recurringInvoices: true, multiCurrency: true,
    payroll: true, webhooks: true, fixedAssets: true, costCenters: true,
  },
};

const FEATURE_MIN_TIER: Record<string, string> = {
  quotes: 'starter', creditNotes: 'starter', purchaseOrders: 'professional',
  invoiceTemplates: 'starter', bankImport: 'starter', bulkOps: 'professional',
  advancedReports: 'professional', apiAccess: 'enterprise', invoicePayment: 'starter',
  recurringInvoices: 'starter', multiCurrency: 'starter',
  payroll: 'professional', webhooks: 'enterprise',
  fixedAssets: 'professional', costCenters: 'professional',
};

export function useSubscription() {
  const { companyId } = useDefaultCompany();

  const { data: subData, isLoading: subLoading, isError: subError } = useQuery<SubscriptionData>({
    queryKey: ["/api/companies", companyId, "billing", "subscription"],
    // 404 = billing module not deployed in this environment; resolve null
    // instead of erroring so the UI fails open without retry noise.
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/billing/subscription`).catch((err: any) => {
        if (err?.status === 404) return null;
        throw err;
      }),
    enabled: !!companyId,
    staleTime: 30000,
    retry: 1,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery<UsageData>({
    queryKey: ["/api/companies", companyId, "billing", "usage"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/billing/usage`).catch((err: any) => {
        if (err?.status === 404) return null;
        throw err;
      }),
    enabled: !!companyId,
    staleTime: 30000,
  });

  // No billing system deployed (endpoint missing/erroring) means features
  // must fail OPEN — a paywall with a dead upgrade button is worse than no
  // paywall. Gates only apply once the API reports a real plan.
  const billingUnavailable = (subError || subData === null) && !subData;
  const tierName = subData?.subscription?.planId || "free";
  const isFreeTier = !billingUnavailable && tierName === "free";

  function canAccess(feature: string): boolean {
    if (billingUnavailable) return true;
    const features = TIER_FEATURES[tierName] || TIER_FEATURES.free;
    return !!features[feature];
  }

  function getRequiredTier(feature: string): string {
    return FEATURE_MIN_TIER[feature] || "starter";
  }

  return {
    subscription: subData?.subscription,
    usage: usageData?.usage,
    limits: subData?.limits,
    tierName,
    isFreeTier,
    canAccess,
    getRequiredTier,
    isLoading: subLoading || usageLoading,
  };
}
