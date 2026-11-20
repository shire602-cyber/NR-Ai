import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Menu,
  X,
  ScanLine,
  Landmark,
  ClipboardCheck,
  PanelsTopLeft,
  ArrowRight,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { usePageMeta } from "../hooks";
import { useI18n } from "@/lib/i18n";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";
import { Link, useLocation } from "wouter";
import {
  bankCopy,
  featureBySlug,
  features,
  starterPrice,
  tools,
  vatCopy,
  type Bilingual,
} from "./content";
import { DemoRequest, FreeTool } from "./Forms";
import { marketingBrand, supportEmail } from "@shared/marketing-brand";
import { siteLocale, type SiteLocale } from "./routes";
import { editorialPages, editorialPath } from "./editorial/pages";
import "@fontsource/noto-sans-arabic/arabic-400.css";
import "@fontsource/noto-sans-arabic/arabic-700.css";
import "./phase.css";

const MonthlyPlans = lazy(() => import("./MonthlyPlans"));
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
const demo = ["Book a demo", "احجز عرضًا توضيحيًا"] as const;
const pricing = ["Pricing", "الأسعار"] as const;
const workflows = [
  { feature: "receipt-scanning", label: ["Scan a receipt", "امسح إيصالًا"], icon: ScanLine },
  {
    feature: "bank-reconciliation",
    label: ["Reconcile a bank CSV", "طابق كشفًا بنكيًا بصيغة CSV"],
    icon: Landmark,
  },
  { feature: "vat", label: ["Review VAT 201", "راجع إقرار VAT 201"], icon: ClipboardCheck },
  { feature: "client-portal", label: ["Client portal", "بوابة العملاء"], icon: PanelsTopLeft },
] as const;
const audiences = [
  {
    slug: "small-business",
    title: ["Small and medium businesses", "الشركات الصغيرة والمتوسطة"],
    lead: [
      "Send your invoices, capture expenses and give your accountant access to the same books.",
      "أرسل فواتيرك وسجّل مصروفاتك وامنح محاسبك وصولاً إلى الدفاتر نفسها.",
    ],
    links: ["invoicing", "receipt-scanning", "vat", "bank-reconciliation"],
  },
  {
    slug: "accounting-firms",
    title: ["Accounting firms", "مكاتب المحاسبة"],
    lead: [
      "Work across client companies, review their books and invite clients to the portal.",
      "اعمل عبر شركات عملائك وراجع دفاترهم وادعهم إلى بوابة العملاء.",
    ],
    links: ["bookkeeping", "reporting", "vat", "client-portal"],
  },
] as const;
type Translate = (text: Bilingual) => string;
type Item = { href: string; title: Bilingual };

function Picture({
  image,
  locale,
  alt,
  high = false,
}: {
  image: string;
  locale: string;
  alt: string;
  high?: boolean;
}) {
  // React 18 forwards this HTML attribute verbatim.
  const priority = high ? { fetchpriority: "high" } : undefined;
  return (
    <img
      className="phase-shot"
      src={`/product/${image}-${locale}.webp`}
      srcSet={
        image === "dashboard"
          ? `/product/dashboard-${locale}-small.webp 720w, /product/dashboard-${locale}.webp 1280w`
          : undefined
      }
      sizes={image === "dashboard" ? "(max-width: 760px) calc(100vw - 34px), 56vw" : undefined}
      alt={alt}
      width={1280}
      height={800}
      loading={high ? "eager" : "lazy"}
      {...priority}
    />
  );
}

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
      items: features.map((f) => ({ title: f.title, href: `${base}/product/${f.slug}` })),
    },
    {
      id: "solutions",
      title: ["Solutions", "الحلول"],
      items: audiences.map((a) => ({ title: a.title, href: `${base}/solutions/${a.slug}` })),
    },
    {
      id: "tools",
      title: ["Free tools", "أدوات مجانية"],
      items: tools.map((tool) => ({ title: tool.title, href: `${base}/tools/${tool.slug}` })),
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
      <Link className="phase-button phase-outline" href={`${base}/book-a-demo`}>
        {tr(demo)}
      </Link>
      <Link className="phase-button phase-primary" href="/register">
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
          <bdi>{marketingBrand}</bdi>
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

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="phase-heading">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

function Workflows({ base, locale, tr }: { base: string; locale: string; tr: Translate }) {
  const [selected, setSelected] = useState(0);
  const tabList = useRef<HTMLDivElement>(null);
  return (
    <section id="product" className="phase-section phase-workflow">
      <div className="phase-wrap">
        <Heading title={tr(["See how it works", "تعرّف على طريقة العمل"])} />
        <div className="phase-workbench">
          <div
            className="phase-tabs"
            role="tablist"
            aria-label={tr(["Product workflows", "مسارات العمل"])}
            ref={tabList}
            onKeyDown={(e) => {
              const last = workflows.length - 1;
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? last
                    : e.key === "ArrowRight"
                      ? (selected + (locale === "ar" ? last : 1)) % workflows.length
                      : e.key === "ArrowLeft"
                        ? (selected + (locale === "ar" ? 1 : last)) % workflows.length
                        : undefined;
              if (next === undefined) return;
              e.preventDefault();
              setSelected(next);
              tabList.current?.querySelectorAll("button")[next]?.focus();
            }}
          >
            {workflows.map((w, i) => (
              <button
                key={w.feature}
                id={`phase-tab-${i}`}
                type="button"
                role="tab"
                aria-controls={`phase-panel-${i}`}
                aria-selected={i === selected}
                tabIndex={i === selected ? 0 : -1}
                onClick={() => setSelected(i)}
              >
                <w.icon aria-hidden="true" />
                {tr(w.label)}
              </button>
            ))}
          </div>
          {workflows.map((w, i) => {
            const f = featureBySlug(w.feature);
            return (
              <div
                key={w.feature}
                id={`phase-panel-${i}`}
                role="tabpanel"
                aria-labelledby={`phase-tab-${i}`}
                className="phase-workflow-panel"
                hidden={i !== selected}
              >
                {i === selected && (
                  <>
                    <div>
                      <h3>{tr(w.label)}</h3>
                      <p>{tr(f.lead)}</p>
                      <Link className="phase-textlink" href={`${base}/product/${f.slug}`}>
                        {tr(["Explore feature", "استكشف الميزة"])} <ArrowRight aria-hidden="true" />
                      </Link>
                    </div>
                    {f.image && <Picture image={f.image} locale={locale} alt={tr(f.title)} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Plans({ tr, immediate = false }: { tr: Translate; immediate?: boolean }) {
  const grid = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const showPlans = immediate || visible || typeof IntersectionObserver === "undefined";
  useEffect(() => {
    if (showPlans) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px" }
    );
    if (grid.current) observer.observe(grid.current);
    return () => observer.disconnect();
  }, [showPlans]);
  return (
    <div className="phase-plan-grid" ref={grid}>
      <div className="phase-plan-intro">
        <p>{tr(["14 days free. No card required.", "١٤ يومًا مجاناً. دون بطاقة مصرفية."])}</p>
      </div>
      {showPlans && (
        <Suspense fallback={null}>
          <MonthlyPlans />
        </Suspense>
      )}
    </div>
  );
}

function Closing({ base, tr }: { base: string; tr: Translate }) {
  return (
    <section className="phase-section phase-closing">
      <div className="phase-wrap">
        <h2>
          {tr([
            "See what your books look like in one place.",
            "اطّلع على دفاترك مجتمعةً في مكان واحد.",
          ])}
        </h2>
        <div className="phase-cta-row">
          <Link className="phase-button phase-white" href="/register">
            {tr(start)}
          </Link>
          <Link className="phase-button phase-light-outline" href={`${base}/book-a-demo`}>
            {tr(demo)}
          </Link>
        </div>
      </div>
    </section>
  );
}

const homeTitle = [
  "Accounting and VAT for UAE businesses",
  "المحاسبة وضريبة القيمة المضافة للشركات في الإمارات",
] as const;
const homeLead = [
  "Send bilingual invoices, scan receipts with AI, prepare your VAT return and give your accountant access to your books.",
  "أرسل فواتير ثنائية اللغة، وامسح الإيصالات بالذكاء الاصطناعي، وأعدّ إقرار ضريبة القيمة المضافة، وامنح محاسبك وصولاً إلى دفاترك.",
] as const;
const faqs: readonly [Bilingual, Bilingual][] = [
  [
    ["How do I reconcile my bank account?", "كيف أطابق حسابي البنكي؟"],
    [`${bankCopy[0]}.`, `${bankCopy[1]}.`],
  ],
  [["How do I file my VAT return?", "كيف أقدّم إقرار ضريبة القيمة المضافة؟"], vatCopy],
  [
    ["Do I need a card to try it?", "هل أحتاج إلى بطاقة مصرفية للتجربة؟"],
    [
      "No. Start a 14-day free trial without entering card details.",
      "يمكنك بدء تجربة مجانية لمدة ١٤ يومًا دون إدخال بيانات البطاقة.",
    ],
  ],
  [
    ["Can I bring my existing records?", "هل يمكنني نقل سجلاتي الحالية؟"],
    [
      "Use CSV imports for supported records and keep a copy of your previous system’s exports for reference.",
      "استورد السجلات المدعومة بصيغة CSV واحتفظ بنسخة من ملفات التصدير من نظامك السابق للرجوع إليها.",
    ],
  ],
  [
    ["Who handles e-invoice transmission?", "من يتولى إرسال الفواتير الإلكترونية؟"],
    [
      "The accredited provider configured for your deployment handles transmission after its setup is complete.",
      "يتولى مزوّد الخدمة المعتمد المُعدّ لنسخة التطبيق لديك إرسال الفواتير بعد اكتمال إعداده.",
    ],
  ],
];

function Home({ base, locale, tr }: { base: string; locale: string; tr: Translate }) {
  return (
    <>
      <section className="phase-hero">
        <div className="phase-wrap phase-hero-grid">
          <div>
            <h1>{tr(homeTitle)}</h1>
            <p>{tr(homeLead)}</p>
            <div className="phase-cta-row">
              <Link
                className="phase-button phase-primary"
                href="/register"
                data-testid="button-hero-start"
              >
                {tr(start)} <ArrowUpRight aria-hidden="true" />
              </Link>
              <Link
                className="phase-button phase-outline"
                href={`${base}/book-a-demo`}
                data-testid="button-hero-demo"
              >
                {tr(demo)}
              </Link>
            </div>
            <p className="phase-trial">
              {tr([
                `From AED ${starterPrice}/month, 14-day free trial, no card`,
                `ابتداءً من ${starterPrice} درهماً شهريًا، تجربة مجانية لمدة ١٤ يومًا، دون بطاقة مصرفية`,
              ])}
            </p>
          </div>
          <figure className="phase-hero-image">
            <Picture
              image="dashboard"
              locale={locale}
              alt={tr([
                "Accounting dashboard with demo balances and financial charts",
                "لوحة المحاسبة بأرصدة تجريبية ورسوم بيانية مالية",
              ])}
              high
            />
            <figcaption>
              {tr(["Product screenshot with sample data", "لقطة من التطبيق ببيانات تجريبية"])}
            </figcaption>
          </figure>
        </div>
      </section>
      <Workflows base={base} locale={locale} tr={tr} />
      <section className="phase-section phase-einvoice">
        <div className="phase-wrap phase-split">
          <div>
            <Heading
              title={tr(["Get ready for UAE e-invoicing", "استعد للفوترة الإلكترونية في الإمارات"])}
            >
              {tr(featureBySlug("e-invoicing").lead)}
            </Heading>
            <Link
              className="phase-button phase-primary"
              href={`${base}/tools/e-invoicing-readiness`}
            >
              {tr(["Check your readiness", "تحقّق من جاهزيتك"])}
            </Link>
          </div>
          <div className="phase-partners">
            <p>
              {tr([
                "One accredited provider per deployment",
                "مزوّد خدمة معتمد واحد لكل نسخة من التطبيق",
              ])}
            </p>
            <div>
              {["A-Cube", "Complyance"].map((provider) => (
                <bdi key={provider} lang="en" translate="no">
                  {provider}
                </bdi>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="phase-section">
        <div className="phase-wrap">
          <Heading
            title={tr(["Built for the way you work", "لأعمالك ومكتب المحاسبة الذي يدعمك"])}
          />
          <div className="phase-split">
            {audiences.map((a) => (
              <article className="phase-card" key={a.slug}>
                <h3>{tr(a.title)}</h3>
                <p>{tr(a.lead)}</p>
                <Link className="phase-textlink" href={`${base}/solutions/${a.slug}`}>
                  {tr(["Explore solution", "استكشف الحل"])} <ArrowRight aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="phase-section phase-features">
        <div className="phase-wrap">
          <Heading
            title={tr(["From the first invoice to month-end", "من أول فاتورة إلى إقفال الشهر"])}
          />
          <div className="phase-feature-grid">
            {(
              [
                "invoicing",
                "receipt-scanning",
                "vat",
                "reporting",
                "payroll",
                "bank-reconciliation",
              ] as const
            ).map((slug) => {
              const f = featureBySlug(slug);
              return (
                <Link
                  className="phase-card phase-feature-card"
                  key={f.slug}
                  href={`${base}/product/${f.slug}`}
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
      <section className="phase-section">
        <div className="phase-wrap phase-split phase-migration">
          <div>
            <Heading title={tr(["Bring your books with you", "انقل دفاترك معك"])}>
              {tr([
                "Plan your cutover, import supported CSV records and verify opening balances before you start posting.",
                "خطّط للانتقال، واستورد السجلات المدعومة بصيغة CSV، وتحقّق من الأرصدة الافتتاحية قبل بدء الترحيل.",
              ])}
            </Heading>
            <Link className="phase-textlink" href={`${base}/migration-guides`}>
              {tr(["Read migration guides", "اقرأ أدلة الانتقال"])}{" "}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <ul>
            {(
              [
                ["excel", ["Excel", "إكسل"]],
                ["wafeq", ["Wafeq", "وافق"]],
                ["mazeed", ["Mazeed", "مزيد"]],
                ["zoho", ["Zoho Books", "زوهو بوكس"]],
              ] as const
            ).map(([source, name]) => (
              <li key={source}>
                <Link href={`${base}/migration-guides/${source}`}>{tr(name)}</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="phase-section phase-features">
        <div className="phase-wrap">
          <Heading title={tr(["Three plans, priced in AED", "ثلاث باقات بالدرهم الإماراتي"])} />
          <Plans tr={tr} />
          <Link className="phase-textlink" href={`${base}/pricing`}>
            {tr(["Compare plans", "قارن الباقات"])} <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>
      <section className="phase-section">
        <div className="phase-wrap phase-split phase-faq">
          <Heading title={tr(["Frequently asked questions", "الأسئلة الشائعة"])} />
          <div>
            {faqs.map(([q, a]) => (
              <details key={q[0]}>
                <summary>
                  {tr(q)} <ChevronDown aria-hidden="true" />
                </summary>
                <p>{tr(a)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
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
    if (window.location.hash === "#product") {
      document.getElementById("product")?.scrollIntoView();
    }
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
  const base = `/${locale}`;
  const [, , route, slug, extra] = path.replace(/\/$/, "").split("/");
  const section = extra ? "404" : route;
  const editorial = editorialPath(path.slice(base.length).replace(/\/$/, ""));
  const page = editorial && editorialPages[editorial];
  const parent = editorial && slug ? editorialPath(`/${section}`) : undefined;
  const feature = section === "product" ? features.find((f) => f.slug === slug) : undefined;
  const audience = section === "solutions" ? audiences.find((a) => a.slug === slug) : undefined;
  const tool = section === "tools" ? tools.find((t) => t.slug === slug) : undefined;
  const home = !section;
  const booking = section === "book-a-demo" && !slug;
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
  usePageMeta(`${title} | ${marketingBrand}`, lead);
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
              {audience && (
                <div className="phase-split phase-product-detail">
                  {audience.links.map((link) => {
                    const f = featureBySlug(link);
                    return (
                      <Link
                        className="phase-card phase-feature-card"
                        key={f.slug}
                        href={`${base}/product/${f.slug}`}
                      >
                        <h3>{tr(f.title)}</h3>
                        <p>{tr(f.lead)}</p>
                      </Link>
                    );
                  })}
                </div>
              )}
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
                  <Link className="phase-textlink" href="/pricing">
                    {tr(["View the full plan comparison", "اطّلع على المقارنة الكاملة للباقات"])}
                  </Link>
                </>
              )}
            </div>
          </section>
        )}
        {(home || feature || audience || plans) && <Closing base={base} tr={tr} />}
      </main>
      <footer className="phase-footer">
        <div className="phase-wrap">
          <Link className="phase-brand" href={base} translate="no">
            <BrandMark size="sm" />
            <bdi>{marketingBrand}</bdi>
          </Link>
          <nav aria-label={tr(["Footer", "روابط التذييل"])}>
            <Link href={`${base}/trust`}>{tr(editorialPages["/trust"].title)}</Link>
            <Link href="/privacy">{tr(["Privacy", "الخصوصية"])}</Link>
            <Link href="/terms">{tr(["Terms", "الشروط"])}</Link>
            <Link href="/help">{tr(["Help", "المساعدة"])}</Link>
            <a href={`mailto:${supportEmail}`} dir="ltr">
              {supportEmail}
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
