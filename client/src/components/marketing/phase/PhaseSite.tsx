import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { usePageMeta } from "../hooks";
import { useI18n } from "@/lib/i18n";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";
import { Link, useLocation } from "wouter";
import { featureBySlug, features, tools, type Bilingual } from "./content";
import { DemoRequest, FreeTool } from "./Forms";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { siteLocale, type SiteLocale } from "./routes";
import { editorialPages, editorialPath, launchPagePath, launchPages } from "./editorial/pages";
import { LaunchPages } from "./LaunchPages";
import { audiences } from "./audiences";
import { Home } from "./home/Home";
import { FinalCta } from "./home/FinalCta";
import { SiteFooter } from "./home/SiteFooter";
import { useMarketingText } from "./home/text";
import { Picture, Plans, type Translate } from "./shared";
import {
  demoTitle,
  featurePath,
  homeLead,
  homeTitle,
  marketingMetadata,
  trialSignupPath,
} from "./route-content";
import "@fontsource/noto-sans-arabic/arabic-400.css";
import "@fontsource/noto-sans-arabic/arabic-700.css";
import "./phase.css";

const EditorialContent = lazy(() =>
  loadWithChunkRetry(() => import("./editorial/EditorialContent"), {
    key: "marketing-editorial",
    reload: false,
  }).catch(() => ({ default: EditorialUnavailable }))
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

const start = ["Start free trial", "ابدأ التجربة المجانية"] as const;
const demo = demoTitle;
const pricing = ["Pricing", "الأسعار"] as const;
type Item = { href: string; title: Bilingual };

function Header({ base, path, tr }: { base: string; path: string; tr: Translate }) {
  const [open, setOpen] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const other = base === "/ar" ? "en" : "ar";
  const languagePath = path.slice(base.length).replace(/^\/$/, "");
  const groups: { id: string; title: Bilingual; items: readonly Item[] }[] = [
    {
      id: "product",
      title: ["Product", "المنتج"],
      items: [
        { title: ["Product overview", "نظرة عامة على المنتج"], href: `${base}/product` },
        ...features.map((f) => ({ title: f.title, href: base + featurePath(f.slug) })),
      ],
    },
    {
      id: "solutions",
      title: ["Solutions", "الحلول"],
      items: audiences.map((a) => ({ title: a.title, href: `${base}/solutions/${a.slug}` })),
    },
    {
      id: "tools",
      title: ["Free tools", "أدوات مجانية"],
      items: [
        { title: ["All free tools", "جميع الأدوات المجانية"], href: `${base}/tools` },
        ...tools.map((tool) => ({ title: tool.title, href: `${base}/tools/${tool.slug}` })),
        {
          title: ["Sample tax invoice", "نموذج فاتورة ضريبية"],
          href: `${base}/tools/invoice-template`,
        },
      ],
    },
    {
      id: "resources",
      title: ["Resources", "الموارد"],
      items: [
        { title: editorialPages["/resources"].title, href: `${base}/resources` },
        { title: editorialPages["/compare"].title, href: `${base}/compare` },
        { title: editorialPages["/migration-guides"].title, href: `${base}/migration-guides` },
        { title: editorialPages["/trust"].title, href: `${base}/trust` },
        { title: ["Help centre", "مركز المساعدة"], href: "/help" },
        { title: ["Sample workspace", "مساحة عمل تجريبية"], href: "/demo" },
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

  const signIn = <Link href="/login">{tr(["Sign in", "تسجيل الدخول"])}</Link>;
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
        {tr(start)}
      </Link>
    </>
  );
  function group(g: (typeof groups)[number], mobile: boolean) {
    const id = `phase-${mobile ? "drawer" : "nav"}-${g.id}`;
    const links = g.items.map((item) => (
      <Link key={item.href} href={item.href}>
        {tr(item.title)}
      </Link>
    ));
    if (mobile)
      return (
        <details key={g.id}>
          <summary>
            {tr(g.title)} <ChevronDown aria-hidden="true" />
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
          {tr(g.title)} <ChevronDown aria-hidden="true" />
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
  const services = <Link href={`${base}/services`}>{tr(["Services", "الخدمات"])}</Link>;
  const plans = <Link href={`${base}/pricing`}>{tr(pricing)}</Link>;
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
          aria-label={tr(["Main navigation", "القائمة الرئيسية"])}
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
            aria-label={tr(["Open navigation", "افتح القائمة"])}
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
            <strong id="phase-drawer-title">{tr(["Navigation", "القائمة"])}</strong>
            <button
              type="button"
              aria-label={tr(["Close navigation", "أغلق القائمة"])}
              onClick={() => dialog.current?.close()}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <nav
            aria-label={tr(["Main navigation", "القائمة الرئيسية"])}
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
    previousPath.current = path;
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [path]);
  useEffect(() => {
    // "#product" is the old id of the homepage tour section.
    const id = decodeURIComponent(window.location.hash.slice(1));
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
  const text = useMarketingText(locale);
  const base = `/${locale}`;
  const [, , route, slug, extra] = path.replace(/\/$/, "").split("/");
  const section = extra ? "404" : route;
  const localPath = path.slice(base.length).replace(/\/$/, "");
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
  const booking = (section === "book-demo" || section === "book-a-demo") && !slug;
  const plans = section === "pricing" && !slug;
  const title = tr(
    home
      ? homeTitle
      : (feature?.title ??
          audience?.title ??
          tool?.title ??
          page?.title ??
          (booking ? demo : plans ? pricing : ["Page not found", "الصفحة غير موجودة"]))
  );
  const lead = tr(home ? homeLead : (feature?.lead ?? audience?.lead ?? page?.lead ?? ["", ""]));
  const meta = marketingMetadata(home ? base : path);
  usePageMeta(
    meta?.title ?? `${title} | ${MARKETING_BRAND.name[locale]}`,
    meta?.description ?? lead,
    meta
  );
  return (
    <div className="phase-site" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <a className="phase-skip" href="#phase-main">
        {tr(["Skip to content", "انتقل إلى المحتوى"])}
      </a>
      <Header key={path} base={base} tr={tr} path={path} />
      <main ref={main} id="phase-main" tabIndex={-1}>
        {home ? (
          <Home base={base} locale={locale} tr={tr} />
        ) : (
          <section className="phase-section phase-subpage">
            <div className="phase-wrap">
              <nav className="phase-breadcrumb" aria-label={tr(["Breadcrumb", "مسار التنقل"])}>
                <Link className="phase-textlink" href={base}>
                  {tr(["Home", "الرئيسية"])}
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
              {feature && (
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
              {feature?.slug === "e-invoicing" && (
                <div className="phase-form">
                  <h2>{tr(["PDFs and structured invoices", "ملفات PDF والفواتير المهيكلة"])}</h2>
                  <p>{text("einvPageStructured", { brand: MARKETING_BRAND.name[locale] })}</p>
                  <p>{text("einvPageIncluded")}</p>
                  <a
                    className="phase-textlink"
                    href="https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/"
                  >
                    {text("einvPageSource")}
                  </a>
                  <Link className="phase-textlink" href={`${base}/tools/e-invoicing-readiness`}>
                    {tr(["Review the setup checklist", "راجع قائمة خطوات الإعداد"])}
                  </Link>
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
              {editorial && (
                <Suspense fallback={null}>
                  <EditorialContent path={editorial} locale={locale} />
                </Suspense>
              )}
              {tool && <FreeTool key={tool.slug} slug={tool.slug} tr={tr} locale={locale} />}
              {booking && <DemoRequest tr={tr} />}
              {plans && (
                <>
                  <Plans tr={tr} immediate />
                  <p>
                    {tr([
                      "When your trial ends, your workspace becomes read-only until you activate a paid plan. You can still view and export your books.",
                      "عند انتهاء التجربة، تصبح مساحة العمل للقراءة فقط حتى تفعّل باقة مدفوعة. يمكنك مواصلة الاطلاع على دفاترك وتصديرها.",
                    ])}
                  </p>
                  <Link className="phase-textlink" href="/pricing">
                    {tr(["View the full plan comparison", "اطّلع على المقارنة الكاملة للباقات"])}
                  </Link>
                </>
              )}
            </div>
          </section>
        )}
        {(feature || audience || plans) && <FinalCta base={base} locale={locale} />}
      </main>
      <SiteFooter base={base} locale={locale} tr={tr} />
    </div>
  );
}
