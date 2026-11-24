import { Suspense, lazy } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { starterPrice } from "../content";
import { trialSignupPath } from "../route-content";
import type { SectionProps } from "./types";
import { useMarketingText } from "./text";
import "./hero.css";

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
  const text = useMarketingText(locale);
  return (
    <section id="hero" data-testid="section-hero" className="mz-band mz-band--dark mz-hero">
      <div className="phase-wrap">
        <div className="mz-hero-copy">
          <h1 className="mz-display">{text("hxHeroTitle")}</h1>
          <p className="mz-lead">{text("hxHeroSub", { price: starterPrice })}</p>
          <div className="mz-hero-cta">
            <div className="mz-hero-primary">
              <Link
                className="phase-button phase-primary"
                href={trialSignupPath}
                data-testid="button-hero-start"
              >
                {text("hxHeroCtaPrimary")} <ArrowUpRight aria-hidden="true" />
              </Link>
              <small>{text("hxHeroCtaMicro")}</small>
            </div>
            <a className="phase-button phase-outline" href="#tour">
              {text("hxHeroCtaTour")}
            </a>
            <Link className="phase-textlink" href="/demo">
              {text("hxHeroCtaSample")}
            </Link>
            <Link
              className="phase-textlink"
              href={`${base}/book-demo`}
              data-testid="button-hero-demo"
            >
              {text("hxHeroCtaDemo")}
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
