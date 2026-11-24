import { ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { starterPrice } from "../content";
import { trialSignupPath } from "../route-content";
import { Picture } from "../shared";
import type { SectionProps } from "./types";
import { useMarketingText } from "./text";

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
        <figure className="mz-hero-visual">
          <Picture image="dashboard" locale={locale} alt={text("hxHeroImageAlt")} high />
          <figcaption>{text("hxHeroCaption")}</figcaption>
        </figure>
      </div>
    </section>
  );
}
