import type { LegacySectionProps } from "./types";
import { AnnouncementBar } from "./AnnouncementBar";
import { ComparisonTable } from "./ComparisonTable";
import { DeadlineFinder } from "./DeadlineFinder";
import { Faq } from "./Faq";
import { FinalCta } from "./FinalCta";
import { FirmsBand } from "./FirmsBand";
import { Hero } from "./Hero";
import { Migration } from "./Migration";
import { PricingSection } from "./PricingSection";
import { ProductTour } from "./ProductTour";
import { SavingsCalculator } from "./SavingsCalculator";
import { Showcase } from "./Showcase";
import { TrustChips } from "./TrustChips";
import { TrustSecurity } from "./TrustSecurity";
import "./home.css";

/** The homepage: one file per section under `phase/home/`, in page order. */
export function Home({ base, locale, tr }: LegacySectionProps) {
  const section = { base, locale };
  return (
    <>
      <AnnouncementBar {...section} />
      <Hero {...section} />
      <TrustChips {...section} />
      <DeadlineFinder {...section} />
      <ProductTour {...section} />
      <SavingsCalculator {...section} />
      <ComparisonTable {...section} />
      <Showcase {...section} />
      <FirmsBand {...section} />
      <TrustSecurity {...section} />
      <Migration {...section} />
      <PricingSection {...section} tr={tr} />
      <Faq {...section} tr={tr} />
      <FinalCta {...section} />
    </>
  );
}
