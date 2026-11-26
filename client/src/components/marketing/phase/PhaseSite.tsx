import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ComponentType,
} from "react";
import { useLightPublicTheme, usePageMeta } from "../hooks";
import { useI18n } from "@/lib/i18n";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";
import { Link, useLocation } from "wouter";
import { featureBySlug, features, tools, type Bilingual } from "./content";
import { DemoRequest, FreeTool } from "./Forms";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { isLocaleSwitch, siteLocale, type SiteLocale } from "./routes";
import { editorialPages, editorialPath, launchPagePath, launchPages } from "./editorial/pages";
import { LaunchPages } from "./LaunchPages";
import { SiteHeader } from "./SiteHeader";
import { audiences } from "./audiences";
import { Home } from "./home/Home";
import { FinalCta } from "./home/FinalCta";
import { SiteFooter } from "./home/SiteFooter";
import { PricingLead, PricingPage } from "./pages/PricingPage";
import { Picture, type Translate } from "./shared";
import { metaText, type MetaKey } from "./meta-text";
import { fragmentId } from "./fragment";
import {
  canonicalMarketingPath,
  demoTitle,
  featurePath,
  homeLead,
  homeTitle,
  hubLead,
  hubTitle,
  marketingMetadata,
  pricingLead,
} from "./route-content";
import "@fontsource/noto-sans-arabic/arabic-400.css";
import "@fontsource/noto-sans-arabic/arabic-700.css";
import "./phase.css";
import "./pages/pages.css";
// Last on purpose: layers elevation and micro-interactions over the section files above.
import "./home/depth.css";

const EditorialContent = lazy(() =>
  loadWithChunkRetry(() => import("./editorial/EditorialContent"), {
    key: "marketing-editorial",
    reload: false,
  }).catch(() => ({ default: EditorialUnavailable }))
);

/** The inner pages load on demand so the homepage chunk does not grow. */
function lazyPage<P extends object>(
  key: string,
  load: { (): Promise<{ default: ComponentType<P> }> }
) {
  return lazy(() =>
    loadWithChunkRetry(load, { key, reload: false }).catch(() => ({
      default: EditorialUnavailable as unknown as ComponentType<P>,
    }))
  );
}

type CompareProps = ComponentProps<typeof import("./pages/ComparePage").CompareTop>;
const EinvoicingHub = lazyPage("marketing-einvoicing-hub", () => import("./pages/EinvoicingHub"));
const ToolsIndex = lazyPage("marketing-tools-index", () => import("./pages/ToolsIndex"));
const SolutionPage = lazyPage("marketing-solution", () => import("./pages/SolutionPage"));
const CompareTop = lazyPage<CompareProps>("marketing-compare", () =>
  import("./pages/ComparePage").then((m) => ({ default: m.CompareTop }))
);
const CompareAll = lazyPage<Omit<CompareProps, "vendor">>("marketing-compare-all", () =>
  import("./pages/ComparePage").then((m) => ({ default: m.CompareAll }))
);
const CompareMigration = lazyPage<CompareProps>("marketing-compare-migration", () =>
  import("./pages/ComparePage").then((m) => ({ default: m.CompareMigration }))
);

function EditorialUnavailable({ locale }: { locale: SiteLocale }) {
  const ar = locale === "ar";
  return (
    <div className="phase-editorial">
      <p role="alert">{ar ? "تعذّر تحميل محتوى الصفحة." : "This page’s content couldn’t load."}</p>
      <button
        className="phase-button phase-primary"
        type="button"
        onClick={() => window.location.reload()}
      >
        {ar ? "أعِد المحاولة" : "Retry"}
      </button>
    </div>
  );
}

const demo = demoTitle;
const pricing: Bilingual = [metaText("en", "hxNavPricing"), metaText("ar", "hxNavPricing")];

export default function PhaseSite() {
  const [location] = useLocation();
  const path = location.split(/[?#]/, 1)[0] || "/";
  const previousPath = useRef(path);
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (previousPath.current === path) return;
    const switchedLanguage = isLocaleSwitch(previousPath.current, path);
    previousPath.current = path;
    // The language toggle shows the same page in the other language: keep the reader's place.
    if (switchedLanguage) return;
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [path]);
  useEffect(() => {
    // "#product" is the old id of the homepage tour section.
    const id = fragmentId(window.location.hash);
    if (id) document.getElementById(id === "product" ? "tour" : id)?.scrollIntoView();
  }, [path]);
  useLightPublicTheme();
  const preference = useI18n((state) => state.locale);
  const explicitLocale = siteLocale(path);
  const locale = explicitLocale ?? preference;
  useEffect(() => {
    if (explicitLocale && useI18n.getState().locale !== explicitLocale) {
      useI18n.getState().setLocale(explicitLocale);
    }
  }, [explicitLocale]);
  const tr: Translate = (content) => content[locale === "ar" ? 1 : 0];
  const nav = (key: MetaKey) => metaText(locale, key);
  const base = `/${locale}`;
  // Alias URLs (/e-invoicing, /free-tools, /compare/zoho-books ...) render their target page; the
  // server gives them the target's canonical URL (see `aliases` in route-content.ts).
  const localPath = canonicalMarketingPath(path.slice(base.length).replace(/\/+$/, ""));
  const [, route, slug, extra] = localPath.split("/");
  const section = extra ? "404" : route;
  const editorial = editorialPath(localPath);
  const launchPage = launchPagePath(localPath);
  const page = editorial
    ? editorialPages[editorial]
    : launchPage
      ? launchPages[launchPage]
      : undefined;
  const parent = editorial && slug ? editorialPath(`/${section}`) : undefined;
  const feature = features.find(
    (f) => localPath === featurePath(f.slug) || localPath === `/product/${f.slug}`
  );
  const audience = section === "solutions" ? audiences.find((a) => a.slug === slug) : undefined;
  const tool = section === "tools" ? tools.find((t) => t.slug === slug) : undefined;
  const home = !section;
  const booking = section === "book-demo" && !slug;
  const plans = section === "pricing" && !slug;
  const hub = feature?.slug === "e-invoicing";
  const toolsIndex = launchPage === "/tools";
  const vendor =
    editorial === "/compare/wafeq" ? "wafeq" : editorial === "/compare/zoho" ? "zoho" : undefined;
  const rich = hub || toolsIndex || plans || !!audience || !!vendor;
  const title = tr(
    home
      ? homeTitle
      : hub
        ? hubTitle
        : (feature?.title ??
          audience?.title ??
          tool?.title ??
          page?.title ??
          (booking
            ? demo
            : plans
              ? pricing
              : [metaText("en", "hxNavNotFound"), metaText("ar", "hxNavNotFound")]))
  );
  const lead = tr(
    home
      ? homeLead
      : hub
        ? hubLead
        : plans
          ? pricingLead
          : (feature?.lead ?? audience?.lead ?? page?.lead ?? ["", ""])
  );
  const meta = marketingMetadata(home ? base : path);
  usePageMeta(
    meta?.title ?? `${title} | ${MARKETING_BRAND.name[locale]}`,
    meta?.description ?? lead,
    meta
  );
  return (
    <div className="phase-site" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <a className="phase-skip" href="#phase-main">
        {nav("hxNavSkip")}
      </a>
      <SiteHeader key={path} base={base} tr={tr} path={path} />
      <main ref={main} id="phase-main" tabIndex={-1}>
        {home ? (
          <Home base={base} locale={locale} tr={tr} />
        ) : (
          <>
            <section
              className={
                rich ? "phase-section phase-subpage mz-page-head" : "phase-section phase-subpage"
              }
            >
              <div className="phase-wrap">
                <nav className="phase-breadcrumb" aria-label={nav("hxNavBreadcrumb")}>
                  <Link className="phase-textlink" href={base}>
                    {nav("hxNavHome")}
                  </Link>
                  {parent && (
                    <>
                      <span aria-hidden="true">/</span>
                      <Link className="phase-textlink" href={`${base}${parent}`}>
                        {tr(editorialPages[parent].title)}
                      </Link>
                    </>
                  )}
                </nav>
                <h1>{title}</h1>
                {plans ? (
                  <PricingLead locale={locale} fallback={lead} />
                ) : (
                  lead && <p className="phase-lead">{lead}</p>
                )}
                {feature && !hub && (
                  <div
                    className={
                      feature.image ? "phase-split phase-product-detail" : "phase-product-detail"
                    }
                  >
                    <div>
                      <h2>{tr(["How it works", "طريقة العمل"])}</h2>
                      <ol>
                        {feature.steps.map((step) => (
                          <li key={step[0]}>{tr(step)}</li>
                        ))}
                      </ol>
                    </div>
                    {feature.image && (
                      <Picture image={feature.image} locale={locale} alt={title} high />
                    )}
                  </div>
                )}
                {feature?.slug === "invoicing" && (
                  <Link className="phase-textlink" href={`${base}/tools/invoice-template`}>
                    {tr(["View a sample tax invoice", "اطّلع على نموذج فاتورة ضريبية"])}
                  </Link>
                )}
                {feature?.slug === "vat" && (
                  <Link className="phase-textlink" href={`${base}/tools/vat-calculator`}>
                    {tr(["Try the VAT calculator", "جرّب حاسبة ضريبة القيمة المضافة"])}
                  </Link>
                )}
                {audience && (
                  <div className="phase-split phase-product-detail">
                    {audience.links.map((link) => {
                      const f = featureBySlug(link);
                      return (
                        <Link
                          className="phase-card phase-feature-card"
                          key={f.slug}
                          href={`${base}${featurePath(f.slug)}`}
                        >
                          <h3>{tr(f.title)}</h3>
                          <p>{tr(f.lead)}</p>
                        </Link>
                      );
                    })}
                  </div>
                )}
                {launchPage && <LaunchPages path={launchPage} base={base} tr={tr} />}
                {editorial && !vendor && (
                  <Suspense fallback={null}>
                    <EditorialContent path={editorial} locale={locale} />
                  </Suspense>
                )}
                {tool && <FreeTool key={tool.slug} slug={tool.slug} tr={tr} locale={locale} />}
                {booking && <DemoRequest tr={tr} />}
              </div>
            </section>
            <Suspense fallback={null}>
              {hub && <EinvoicingHub base={base} locale={locale} tr={tr} />}
              {toolsIndex && <ToolsIndex base={base} locale={locale} tr={tr} />}
              {audience && (
                <SolutionPage slug={audience.slug} base={base} locale={locale} tr={tr} />
              )}
              {editorial === "/compare" && <CompareAll base={base} locale={locale} />}
              {vendor && editorial && (
                <>
                  <CompareTop base={base} locale={locale} vendor={vendor} />
                  <section className="phase-section">
                    <div className="phase-wrap">
                      <EditorialContent path={editorial} locale={locale} />
                    </div>
                  </section>
                  <CompareMigration base={base} locale={locale} vendor={vendor} />
                </>
              )}
            </Suspense>
            {plans && <PricingPage base={base} locale={locale} tr={tr} />}
          </>
        )}
        {(feature || audience || plans || toolsIndex || vendor) && (
          <FinalCta base={base} locale={locale} />
        )}
      </main>
      <SiteFooter base={base} locale={locale} tr={tr} />
    </div>
  );
}
