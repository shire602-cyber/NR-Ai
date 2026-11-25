import { Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { PlanCard } from "../PlanCard";
import { PLANS, type BillingCycle } from "../plans";
import "./home/pricing.css";

/** The three plan cards for the chosen billing cycle (monthly unless the pricing page says yearly). */
export default function MonthlyPlans({ cycle = "monthly" }: { cycle?: BillingCycle }) {
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
          <PlanCard plan={plan} cycle={cycle} headingLevel="h3" showFeaturedCaption={false} />
        </div>
      ))}
    </>
  );
}
