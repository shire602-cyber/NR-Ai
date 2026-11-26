import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { Link } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { audiences } from "./audiences";
import { features, tools } from "./content";
import { editorialPages } from "./editorial/pages";
import { metaText, type MetaKey } from "./meta-text";
import { demoTitle, featurePath, trialSignupPath } from "./route-content";
import type { SiteLocale } from "./routes";
import type { Translate } from "./shared";

type Item = { href: string; title: string };

export interface SiteHeaderProps {
  base: string;
  path: string;
  tr: Translate;
  /**
   * Pages outside the /en and /ar site (sign-in, legal, help) keep one URL for both languages:
   * they pass this and the language control switches the stored locale instead of navigating.
   */
  onSwitchLocale?: (locale: SiteLocale) => void;
}

/** The one public header: the homepage, every /en and /ar page and the legacy public pages. */
export function SiteHeader({ base, path, tr, onSwitchLocale }: SiteHeaderProps) {
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
  const toggleLabel = other === "ar" ? "العربية" : "EN · English";
  const toggle = onSwitchLocale ? (
    <button
      type="button"
      className="phase-lang"
      lang={other}
      aria-label={toggleLabel}
      data-testid="button-language-toggle"
      onClick={() => onSwitchLocale(other)}
    >
      {other === "ar" ? "العربية" : "EN"}
    </button>
  ) : (
    <Link href={`/${other}${languagePath}`} lang={other} hrefLang={other} aria-label={toggleLabel}>
      {other === "ar" ? "العربية" : "EN"}
    </Link>
  );
  const actions = (
    <>
      <Link className="phase-button phase-outline" href={`${base}/book-demo`}>
        {tr(demoTitle)}
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
