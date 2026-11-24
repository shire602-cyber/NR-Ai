import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import type { SectionProps } from "./types";
import { SHOW_DATA_RESIDENCY } from "./flags";
import { ProofPlaceholder } from "./ProofPlaceholder";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

export function TrustSecurity({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="trust" data-testid="section-trust" className="mz-band mz-band--light">
      <div className="phase-wrap">
        <SectionHead title={text("hxTrustTitle")} lead={text("hxTrustLead")} />
        {SHOW_DATA_RESIDENCY && <p>{text("hxTrustResidency")}</p>}
        <ProofPlaceholder locale={locale} variant="stories" />
        <Link className="phase-textlink" href={`${base}/trust`}>
          {text("hxTrustLink")} <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
