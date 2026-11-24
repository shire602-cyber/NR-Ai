import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { featureBySlug } from "../content";
import { featurePath } from "../route-content";
import type { LegacySectionProps } from "./types";
import { SectionHead } from "./SectionHead";
import { useMarketingText } from "./text";

const SLUGS = [
  "invoicing",
  "receipt-scanning",
  "vat",
  "reporting",
  "payroll",
  "bank-reconciliation",
] as const;

export function Showcase({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  return (
    <section
      id="features"
      data-testid="section-features"
      className="mz-band mz-band--sand phase-features"
    >
      <div className="phase-wrap">
        <SectionHead title={text("hxShowTitle")} lead={text("hxShowLead")} />
        <div className="phase-feature-grid">
          {SLUGS.map((slug) => {
            const f = featureBySlug(slug);
            return (
              <Link
                className="phase-card phase-feature-card"
                key={f.slug}
                href={`${base}${featurePath(f.slug)}`}
              >
                <h3>
                  {tr(f.title)} <ArrowUpRight aria-hidden="true" />
                </h3>
                <p>{tr(f.lead)}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
