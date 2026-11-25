import { Suspense, lazy } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { starterPrice } from "../content";
import { trialSignupPath } from "../route-content";
import type { SectionProps } from "./types";
import { useMarketingText } from "./text";
import { metaText } from "../meta-text";
import "./hero.css";
import "./hero-depth.css";

const HeroStage = lazy(() => import("./HeroStage"));

/** Same box as the live stage (size comes from hero.css), so swapping them shifts nothing. */
function StagePlaceholder({ locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <div
      className="mz-stage mz-stage--placeholder"
      role="img"
      aria-label={text("hxHeroImageAlt")}
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
    >
      <span className="mz-stage-sample">{text("hxHeroCaption")}</span>
    </div>
  );
}

export function Hero({ base, locale }: SectionProps) {
  // The h1, lead and CTA labels come from the statically imported marketingMeta catalog (the one
  // the server renders from), so a cold visit never swaps the server-rendered heading for an empty
  // one while the lazy marketing chunks load.
  const copy = (key: Parameters<typeof metaText>[1]) =>
    metaText(locale, key, { price: starterPrice });
  return (
    <section id="hero" data-testid="section-hero" className="mz-band mz-band--dark mz-hero">
      <div className="mz-hero-aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="phase-wrap">
        <div className="mz-hero-copy">
          <p className="mz-hero-eyebrow">{copy("hxHeroEyebrow")}</p>
          <h1 className="mz-display">{copy("hxHeroTitle")}</h1>
          <p className="mz-lead">{copy("hxHeroSub")}</p>
          <div className="mz-hero-cta">
            <div className="mz-hero-primary">
              <Link
                className="phase-button phase-primary"
                href={trialSignupPath}
                data-testid="button-hero-start"
              >
                {copy("hxHeroCtaPrimary")} <ArrowUpRight aria-hidden="true" />
              </Link>
              <small>{copy("hxHeroCtaMicro")}</small>
            </div>
            <a className="phase-button phase-outline" href="#tour">
              {copy("hxHeroCtaTour")}
            </a>
            <Link className="phase-textlink" href="/demo">
              {copy("hxHeroCtaSample")}
            </Link>
            <Link
              className="phase-textlink"
              href={`${base}/book-demo`}
              data-testid="button-hero-demo"
            >
              {copy("hxHeroCtaDemo")}
            </Link>
          </div>
        </div>
        <div className="mz-hero-visual">
          <Suspense fallback={<StagePlaceholder base={base} locale={locale} />}>
            <HeroStage locale={locale} />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
