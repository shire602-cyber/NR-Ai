import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import type { SectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

export function ComparisonTable({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="compare" data-testid="section-compare" className="mz-band mz-band--light">
      <div className="phase-wrap">
        <SectionHead title={text("hxCmpTitle")} lead={text("hxCmpLead")} />
        <Link className="phase-textlink" href={`${base}/compare`}>
          {text("hxCmpLink")} <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
