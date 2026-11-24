import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Plans, type Translate } from "../shared";
import type { BillingCycle } from "../../plans";
import type { LegacySectionProps, SectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";
import "./pricing.css";

/**
 * The three plan cards (prices from shared/plans.ts through the shared PlanCard, each with the
 * e-invoicing badge) plus the trial note and links under them. Used by the homepage section and
 * by the /pricing page.
 */
export function PlanCards({
  base,
  locale,
  tr,
  immediate = false,
  cycle = "monthly",
}: SectionProps & { tr: Translate; immediate?: boolean; cycle?: BillingCycle }) {
  const text = useMarketingText(locale);
  return (
    <div className="mz-price-cards">
      <Plans tr={tr} intro={false} immediate={immediate} cycle={cycle} />
      <p className="mz-price-note" data-testid="price-trial-note">
        {text("hxPriceTrialNote")}
      </p>
      <p className="mz-price-links">
        <a href="#compare" data-testid="link-price-compare">
          {text("hxPriceCompareLink")}
        </a>
        <Link href={`${base}/pricing`} data-testid="link-price-full">
          {text("hxPriceCompare")} <ArrowRight aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}

export function PricingSection({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="pricing" data-testid="section-pricing" className="mz-band mz-band--light mz-price">
      <div className="phase-wrap">
        <SectionHead title={text("hxPriceTitle")} lead={text("hxPriceLead")} />
        <PlanCards base={base} locale={locale} tr={tr} />
      </div>
    </section>
  );
}
