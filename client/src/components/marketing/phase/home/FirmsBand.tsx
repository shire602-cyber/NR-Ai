import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { audiences } from "../audiences";
import type { LegacySectionProps } from "./types";
import { ProofPlaceholder } from "./ProofPlaceholder";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

export function FirmsBand({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="firms" data-testid="section-firms" className="mz-band mz-band--dark">
      <div className="phase-wrap">
        <SectionHead title={text("hxFirmTitle")} lead={text("hxFirmLead")} />
        <div className="phase-split">
          {audiences.map((a) => (
            <article className="phase-card" key={a.slug}>
              <h3>{tr(a.title)}</h3>
              <p>{tr(a.lead)}</p>
              <Link className="phase-textlink" href={`${base}/solutions/${a.slug}`}>
                {text("hxFirmExplore")} <ArrowRight aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
        <ProofPlaceholder locale={locale} variant="firm" />
        <Link className="phase-button phase-primary" href={`${base}/contact`}>
          {text("hxFirmCta")}
        </Link>
      </div>
    </section>
  );
}
