import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { useLocation } from "wouter";
import { messages as pageMessages } from "./UpgradePrompt.i18n";

interface UpgradePromptProps {
  feature: string;
  requiredTier: string;
  title?: string;
  description?: string;
}

const getFeatureLabels = (): Record<string, string> => ({
  quotes: pageMessages.t("quotesEstimates"),
  creditNotes: pageMessages.t("creditNotes"),
  purchaseOrders: pageMessages.t("purchaseOrders"),
  invoiceTemplates: pageMessages.t("invoiceTemplates"),
  bankImport: pageMessages.t("bankStatementImport"),
  bulkOps: pageMessages.t("bulkOperations"),
  advancedReports: pageMessages.t("advancedReports"),
  apiAccess: pageMessages.t("apiAccess"),
  invoicePayment: pageMessages.t("onlineInvoicePayments"),
  recurringInvoices: pageMessages.t("recurringInvoices"),
  multiCurrency: pageMessages.t("multiCurrency"),
  payroll: pageMessages.t("payrollWps"),
  webhooks: pageMessages.t("webhooksIntegrations"),
  fixedAssets: pageMessages.t("fixedAssetsDepreciation"),
  costCenters: pageMessages.t("costCenters"),
  projects: pageMessages.t("projects"),
  approvals: pageMessages.t("approvals"),
});

export function UpgradePrompt({ feature, requiredTier, title, description }: UpgradePromptProps) {
  const tr = pageMessages.useT();

  const [, setLocation] = useLocation();
  const featureLabel = getFeatureLabels()[feature] || feature;

  return (
    <Card className="border-dashed border-2 border-muted-foreground/25">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">{title || tr("unlock", { featureLabel })}</CardTitle>
        <CardDescription>
          {description ||
            tr("thisFeatureIsAvailableOnThe", {
              value: requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1),
            })}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <Button onClick={() => setLocation("/subscription")} size="lg">
          {tr("upgradeTo")} {requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)}
        </Button>
      </CardContent>
    </Card>
  );
}
