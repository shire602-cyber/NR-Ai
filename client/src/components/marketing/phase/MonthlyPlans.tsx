import { PlanCard } from "../PlanCard";
import { PLANS } from "../plans";

export default function MonthlyPlans() {
  return (
    <>
      {PLANS.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          cycle="monthly"
          headingLevel="h3"
          showFeaturedCaption={false}
        />
      ))}
    </>
  );
}
