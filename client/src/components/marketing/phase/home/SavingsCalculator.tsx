import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { trialSignupPath } from "../route-content";
import type { SectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

export function SavingsCalculator({ locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="savings" data-testid="section-savings" className="mz-band mz-band--sand">
      <div className="phase-wrap">
        <SectionHead title={text("hxSavTitle")} lead={text("hxSavLead")} />
        <Link className="phase-button phase-primary" href={trialSignupPath}>
          {text("hxSavCta")} <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
