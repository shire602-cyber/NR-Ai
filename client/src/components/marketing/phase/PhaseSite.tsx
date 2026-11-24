import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { usePageMeta } from "../hooks";
import { useI18n } from "@/lib/i18n";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";
import { Link, useLocation } from "wouter";
import { featureBySlug, features, tools, type Bilingual } from "./content";
import { DemoRequest, FreeTool } from "./Forms";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { isLocaleSwitch, siteLocale, type SiteLocale } from "./routes";
import { editorialPages, editorialPath, launchPagePath, launchPages } from "./editorial/pages";
import { LaunchPages } from "./LaunchPages";
import { audiences } from "./audiences";
import { Home } from "./home/Home";
import { FinalCta } from "./home/FinalCta";
import { SiteFooter } from "./home/SiteFooter";
import { PricingPage } from "./pages/PricingPage";
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
  trialSignupPath,
} from "./route-content";
import "@fontsource/noto-sans-arabic/arabic-400.css";
import "@fontsource/noto-sans-arabic/arabic-700.css";
import "./phase.css";
import "./pages/pages.css";

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
type Item = { href: string; title: string };

function Header({ base, path, tr }: { base: string; path: string; tr: Translate }) {
  const [open, setOpen] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const other = base === "/ar" ? "en" : "ar";
  const languagePath = path.slice(base.length).replace(/^\/$/, "");
  const locale = base === "/ar" ? "ar" : "en";
  const nav = (key: MetaKey) => metaText(locale, key);
  const groups: { id: string; title: string; items: readonly Item[] }[] = [
    {
      id: "product",
      title: nav("hxNavProduct"),
      items: [
        { title: nav("hxNavProductOverview"), href: `${base}/product` },
        ...features.map((f) => ({ title: tr(f.title), href: base + featurePath(f.slug) })),
      ],
    },
    {
      id: "solutions",
      title: nav("hxNavSolutions"),
      items: audiences.map((a) => ({ title: tr(a.title), href: `${base}/solutions/${a.slug}` })),
    },
    {
      id: "tools",
      title: nav("hxNavTools"),
      items: [
        { title: nav("hxNavAllTools"), href: `${base}/tools` },
        ...tools.map((tool) => ({ title: tr(tool.title), href: `${base}/tools/${tool.slug}` })),
        {
          title: nav("hxNavSampleInvoice"),
          href: `${base}/tools/invoice-template`,
        },
      ],
    },
    {
      id: "resources",
      title: nav("hxNavResources"),
      items: [
        { title: tr(editorialPages["/resources"].title), href: `${base}/resources` },
        {
          title: nav("hxNavEinvoicingGuide"),
          href: base + featurePath("e-invoicing"),
        },
        { title: tr(editorialPages["/compare"].title), href: `${base}/compare` },
        { title: tr(editorialPages["/migration-guides"].title), href: `${base}/migration-guides` },
        { title: tr(editorialPages["/trust"].title), href: `${base}/trust` },
        { title: nav("hxNavHelp"), href: "/help" },
        { title: nav("hxNavSampleWorkspace"), href: "/demo" },
      ],
    },
  ];
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!navigation.current?.contains(event.target as Node)) setOpen(undefined);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const signIn = <Link href="/login">{nav("hxNavSignIn")}</Link>;
  const toggle = (
    <Link
      href={`/${other}${languagePath}`}
      lang={other}
      hrefLang={other}
      aria-label={other === "ar" ? "العربية" : "EN · English"}
    >
      {other === "ar" ? "العربية" : "EN"}
    </Link>
  );
  const actions = (
    <>
      <Link className="phase-button phase-outline" href={`${base}/book-demo`}>
        {tr(demo)}
      </Link>
      <Link className="phase-button phase-primary" href={trialSignupPath}>
        {nav("hxNavStart")}
      </Link>
    </>
  );
  function group(g: (typeof groups)[number], mobile: boolean) {
    const id = `phase-${mobile ? "drawer" : "nav"}-${g.id}`;
    const links = g.items.map((item) => (
      <Link key={item.href} href={item.href}>
        {item.title}
      </Link>
    ));
    if (mobile)
      return (
        <details key={g.id}>
          <summary>
            {g.title} <ChevronDown aria-hidden="true" />
          </summary>
          <div>{links}</div>
        </details>
      );
    return (
      <div className="phase-menu" key={g.id}>
        <button
          type="button"
          aria-expanded={open === g.id}
          aria-controls={id}
          onClick={() => setOpen(open === g.id ? undefined : g.id)}
        >
          {g.title} <ChevronDown aria-hidden="true" />
        </button>
        <div
          id={id}
          className="phase-popover"
          data-wide={g.id === "product"}
          hidden={open !== g.id}
        >
          {links}
        </div>
      </div>
    );
  }
  const services = <Link href={`${base}/services`}>{nav("hxNavServices")}</Link>;
  const plans = <Link href={`${base}/pricing`}>{nav("hxNavPricing")}</Link>;
  return (
    <header className="phase-header">
      <div className="phase-wrap phase-header-inner">
        <Link className="phase-brand" href={base} translate="no">
          <BrandMark size="sm" />
          <bdi>{MARKETING_BRAND.name[base === "/ar" ? "ar" : "en"]}</bdi>
        </Link>
        <nav
          className="phase-desktop"
          ref={navigation}
          aria-label={nav("hxNavMain")}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setOpen(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              navigation.current
                ?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
                ?.focus();
              setOpen(undefined);
            }
          }}
        >
          {group(groups[0], false)}
          {group(groups[1], false)}
          {services}
          {group(groups[2], false)}
          {group(groups[3], false)}
          {plans}
        </nav>
        <div className="phase-header-actions">
          <span className="phase-signin">{signIn}</span>
          {toggle}
          <div className="phase-desktop-actions">{actions}</div>
          <button
            className="phase-menu-toggle"
            type="button"
            aria-haspopup="dialog"
            aria-label={nav("hxNavOpen")}
            onClick={() => dialog.current?.showModal()}
          >
            <Menu aria-hidden="true" />
          </button>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="phase-drawer"
        aria-labelledby="phase-drawer-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="phase-drawer-inner">
          <div className="phase-drawer-head">
            <strong id="phase-drawer-title">{nav("hxNavMenu")}</strong>
            <button
              type="button"
              aria-label={nav("hxNavClose")}
              onClick={() => dialog.current?.close()}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <nav
            aria-label={nav("hxNavMain")}
            onClick={(e) => {
              if ((e.target as Element).closest("a")) dialog.current?.close();
            }}
          >
            {group(groups[0], true)}
            {group(groups[1], true)}
            {services}
            {group(groups[2], true)}
            {group(groups[3], true)}
            {plans}
            {signIn}
            {actions}
          </nav>
        </div>
      </dialog>
    </header>
  );
}

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
      <Header key={path} base={base} tr={tr} path={path} />
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
                {lead && <p className="phase-lead">{lead}</p>}
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
