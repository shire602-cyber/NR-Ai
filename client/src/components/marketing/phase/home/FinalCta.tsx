import { Link } from "wouter";
import { trialSignupPath } from "../route-content";
import type { SectionProps } from "./types";
import { useMarketingText } from "./text";
import "./final.css";

export function FinalCta({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section
      id="final-cta"
      data-testid="section-final-cta"
      className="mz-band mz-band--dark mz-final"
    >
      <div className="phase-wrap">
        <h2 className="mz-h2 mz-final-title">{text("hxCtaTitle")}</h2>
        <div className="phase-cta-row mz-final-actions">
          <Link
            className="phase-button phase-primary mz-final-primary"
            href={trialSignupPath}
            data-testid="button-final-trial"
          >
            {text("hxCtaPrimary")}
          </Link>
          <Link
            className="phase-button phase-outline"
            href={`${base}/book-demo`}
            data-testid="button-final-demo"
          >
            {text("hxCtaDemo")}
          </Link>
        </div>
        <p className="mz-final-micro">{text("hxCtaMicro")}</p>
      </div>
    </section>
  );
}
