import { Link } from "wouter";
import { trialSignupPath } from "../route-content";
import type { SectionProps } from "./types";
import { useMarketingText } from "./text";

export function FinalCta({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section
      id="final-cta"
      data-testid="section-final-cta"
      className="mz-band mz-band--dark mz-final"
    >
      <div className="phase-wrap">
        <h2 className="mz-h2">{text("hxCtaTitle")}</h2>
        <div className="phase-cta-row">
          <Link className="phase-button phase-primary" href={trialSignupPath}>
            {text("hxCtaPrimary")}
          </Link>
          <Link className="phase-button phase-outline" href={`${base}/book-demo`}>
            {text("hxCtaDemo")}
          </Link>
        </div>
      </div>
    </section>
  );
}
