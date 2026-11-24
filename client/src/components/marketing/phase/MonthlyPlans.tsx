import { Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { PlanCard } from "../PlanCard";
import { PLANS } from "../plans";
import "./home/pricing.css";

export default function MonthlyPlans() {
  const { t } = useTranslation();
  return (
    <>
      {PLANS.map((plan) => (
        <div
          key={plan.id}
          className="mz-price-slot"
          data-featured={plan.featured ? "true" : undefined}
        >
          <span className="mz-badge mz-price-badge" data-testid={`badge-einvoicing-${plan.id}`}>
            <Check aria-hidden="true" size={14} />
            {t["marketing.hxPriceBadge"]}
          </span>
          <PlanCard plan={plan} cycle="monthly" headingLevel="h3" showFeaturedCaption={false} />
        </div>
      ))}
    </>
  );
}
