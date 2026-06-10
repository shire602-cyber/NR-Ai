import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { useLocation } from "wouter";

interface UpgradePromptProps {
  feature: string;
  requiredTier: string;
  title?: string;
  description?: string;
}

const FEATURE_LABELS: Record<string, string> = {
  quotes: "Quotes & Estimates",
  creditNotes: "Credit Notes",
  purchaseOrders: "Purchase Orders",
  invoiceTemplates: "Invoice Templates",
  bankImport: "Bank Statement Import",
  bulkOps: "Bulk Operations",
  advancedReports: "Advanced Reports",
  apiAccess: "API Access",
  invoicePayment: "Online Invoice Payments",
  recurringInvoices: "Recurring Invoices",
  multiCurrency: "Multi-Currency",
  payroll: "Payroll & WPS",
  webhooks: "Webhooks & Integrations",
  fixedAssets: "Fixed Assets & Depreciation",
  costCenters: "Cost Centers",
};

export function UpgradePrompt({ feature, requiredTier, title, description }: UpgradePromptProps) {
  const [, setLocation] = useLocation();
  const featureLabel = FEATURE_LABELS[feature] || feature;

  return (
    <Card className="border-dashed border-2 border-muted-foreground/25">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">
          {title || `Unlock ${featureLabel}`}
        </CardTitle>
        <CardDescription>
          {description || `This feature is available on the ${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} plan and above.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <Button onClick={() => setLocation("/subscription")} size="lg">
          Upgrade to {requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)}
        </Button>
      </CardContent>
    </Card>
  );
}
