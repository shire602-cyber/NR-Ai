import { Link } from "wouter";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { ComparisonTable } from "./ComparisonTable";
import { VENDOR_NAME } from "../home/comparison";
import { useMarketingText } from "../home/text";
import type { SectionProps } from "../home/types";
import { trialSignupPath } from "../route-content";
import "../home/home.css";
import "./pages.css";

export type CompareVendor = "wafeq" | "zoho";

interface CompareProps extends SectionProps {
  vendor: CompareVendor;
}

/** "Muhasib vs X" strip and the two-column table; sits between the page heading and the guide. */
export function CompareTop({ base, locale, vendor }: CompareProps) {
  const text = useMarketingText(locale);
  const brand = MARKETING_BRAND.name[locale];
  const name = VENDOR_NAME[vendor];
  return (
    <div data-testid="compare-top">
      <section
        className="mz-band mz-band--sand mz-page-vs"
        aria-label={text("hxCmpPageAria", { brand, vendor: name })}
      >
        <div className="phase-wrap">
          <h2 className="mz-page-vs-title">
            <bdi translate="no">{brand}</bdi>
            <span className="mz-page-vs-word">{text("hxCmpPageVs")}</span>
            <bdi translate="no">{name}</bdi>
          </h2>
          <p className="mz-lead">{text("hxCmpPageHeroLead")}</p>
          <p className="mz-page-note">{text("hxCmpPageFair")}</p>
        </div>
      </section>
      <ComparisonTable base={base} locale={locale} focus={vendor} />
    </div>
  );
}

/** The three-way table on the /compare hub. */
export function CompareAll({ base, locale }: SectionProps) {
  return <ComparisonTable base={base} locale={locale} />;
}

/** Closing migration call to action for a compare page. */
export function CompareMigration({ base, locale, vendor }: CompareProps) {
  const text = useMarketingText(locale);
  const vars = { brand: MARKETING_BRAND.name[locale], vendor: VENDOR_NAME[vendor] };
  return (
    <section
      className="mz-band mz-band--sand mz-page-migrate"
      aria-labelledby="cmp-migrate-title"
      data-testid="compare-migration"
    >
      <div className="phase-wrap">
        <h2 className="mz-h2" id="cmp-migrate-title">
          {text("hxCmpPageMigTitle", vars)}
        </h2>
        <p className="mz-lead">{text("hxCmpPageMigLead", vars)}</p>
        <div className="phase-cta-row">
          <Link className="phase-button phase-primary" href={`${base}/migration-guides/${vendor}`}>
            {text("hxCmpPageMigCta", vars)}
          </Link>
          <Link className="phase-button phase-outline" href={trialSignupPath}>
            {text("hxCtaPrimary")}
          </Link>
        </div>
      </div>
    </section>
  );
}

export default CompareTop;
