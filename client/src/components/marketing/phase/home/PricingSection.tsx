import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Plans } from "../shared";
import type { LegacySectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

export function PricingSection({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  return (
    <section
      id="pricing"
      data-testid="section-pricing"
      className="mz-band mz-band--light phase-features"
    >
      <div className="phase-wrap">
        <SectionHead title={text("hxPriceTitle")} lead={text("hxPriceLead")} />
        <Plans tr={tr} intro={false} />
        <Link className="phase-textlink" href={`${base}/pricing`}>
          {text("hxPriceCompare")} <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
