import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { useLocation } from "wouter";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { planNameKey } from "@/components/marketing/plans";
import { isPaidPlanId } from "@shared/plans";

interface UpgradePromptProps {
  feature: string;
  requiredTier: string;
  title?: string;
  description?: string;
}

export function UpgradePrompt({ feature, requiredTier, title, description }: UpgradePromptProps) {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const featureLabel =
    (t as Record<string, string>)[`components.upgradeFeature.${feature}`] || feature;
  const tier = requiredTier.toLowerCase();
  // The same localized plan names as /pricing and billing; an unknown id is shown as sent.
  const plan = isPaidPlanId(tier) ? (t as Record<string, string>)[planNameKey(tier)] : requiredTier;

  return (
    <Card className="border-dashed border-2 border-muted-foreground/25">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">
          {title || formatMessage(t["components.upgradeUnlock"], { feature: featureLabel })}
        </CardTitle>
        <CardDescription>
          {description || formatMessage(t["components.upgradeAvailableOn"], { plan })}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <Button onClick={() => setLocation("/subscription")} size="lg">
          {formatMessage(t["components.upgradeTo"], { plan })}
        </Button>
      </CardContent>
    </Card>
  );
}
