import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import type { SectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

export function DeadlineFinder({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section
      id="e-invoicing-deadlines"
      data-testid="section-e-invoicing-deadlines"
      className="mz-band mz-band--dark"
    >
      <div className="phase-wrap">
        <SectionHead
          eyebrow={text("hxDlEyebrow")}
          title={text("hxDlTitle")}
          lead={text("hxDlLead")}
        />
        <Link className="phase-button phase-primary" href={`${base}/tools/e-invoicing-readiness`}>
          {text("hxDlCta")} <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
