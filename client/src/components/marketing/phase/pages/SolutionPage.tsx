import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { FirmsBand } from "../home/FirmsBand";
import { Migration } from "../home/Migration";
import { SectionHead } from "../home/SectionHead";
import { useMarketingText } from "../home/text";
import type { LegacySectionProps } from "../home/types";
import "../home/home.css";
import "./pages.css";

/**
 * Extra bands below the feature cards of /solutions/<slug>. The homepage sections are reused as
 * they are: the accounting-firms band, the migration steps and a link to the interactive tour.
 */
export function SolutionPage({
  slug,
  base,
  locale,
  tr,
}: LegacySectionProps & { slug: "accounting-firms" | "small-business" }) {
  const text = useMarketingText(locale);
  const section = { base, locale, tr };
  return (
    <div data-testid={`solution-${slug}`}>
      {slug === "accounting-firms" ? (
        <FirmsBand {...section} />
      ) : (
        <section
          id="see-it"
          className="mz-band mz-band--dark mz-page-see"
          aria-labelledby="sol-see-title"
        >
          <div className="phase-wrap">
            <SectionHead
              id="sol-see-title"
              title={text("hxSolSeeTitle")}
              lead={text("hxSolSeeLead")}
            />
            <div className="phase-cta-row">
              <Link className="phase-button phase-primary" href={`${base}#tour`}>
                {text("hxSolSeeTour")}
              </Link>
              <Link className="phase-textlink" href={`${base}/product`}>
                {text("hxSolSeeFeatures")} <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      )}
      <Migration base={base} locale={locale} />
    </div>
  );
}

export default SolutionPage;
