import { Link, useLocation } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { MARKETING_BRAND, supportEmail } from "@shared/marketing-brand";
import { features, tools } from "../content";
import { featurePath } from "../route-content";
import type { LegacySectionProps } from "./types";
import { SHOW_WHATSAPP } from "./flags";
import { useMarketingText, type MarketingKey } from "./text";
import "./footer.css";

// TODO(owner): confirm number. Only rendered when SHOW_WHATSAPP is true (flags.ts).
const WHATSAPP_HREF = "https://wa.me/";

/** Language names are shown in their own language (autonyms), not translated. */
const LANGUAGE_NAME = { en: "English", ar: "العربية" } as const;

interface FooterLink {
  href: string;
  label: string;
}

function Column({ title, links }: { title: string; links: readonly FooterLink[] }) {
  return (
    <div className="mz-foot-col">
      <p className="mz-foot-title">{title}</p>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter({
  base,
  locale,
  tr,
  onSwitchLocale,
}: LegacySectionProps & {
  /** Pages with one URL for both languages switch the stored locale instead of navigating. */
  onSwitchLocale?: (locale: "en" | "ar") => void;
}) {
  const text = useMarketingText(locale);
  const [path] = useLocation();
  const brand = MARKETING_BRAND.name[locale];
  const other = locale === "ar" ? "en" : "ar";
  // Same page under the other locale prefix (the header toggle does the same).
  const samePage = path.slice(base.length).replace(/^\/$/, "");

  const label = (key: MarketingKey, vars?: Record<string, string>) => text(key, vars);
  const productLinks: FooterLink[] = [
    { href: `${base}/uae-e-invoicing`, label: label("hxFootEinvoicing") },
    ...features
      .filter((feature) => feature.slug !== "e-invoicing")
      .map((feature) => ({
        href: `${base}${featurePath(feature.slug)}`,
        label: tr(feature.title),
      })),
    { href: `${base}/pricing`, label: label("navPricing") },
  ];
  const toolLinks: FooterLink[] = [
    { href: `${base}/tools`, label: label("hxFootToolsAll") },
    ...tools.map((tool) => ({ href: `${base}/tools/${tool.slug}`, label: tr(tool.title) })),
    { href: `${base}/tools/invoice-template`, label: label("hxFootInvoiceTemplate") },
  ];
  const compareLinks: FooterLink[] = [
    { href: `${base}/compare`, label: label("hxFootCompareAll") },
    { href: `${base}/compare/wafeq`, label: label("hxFootCompareWafeq", { brand }) },
    { href: `${base}/compare/zoho`, label: label("hxFootCompareZoho", { brand }) },
  ];
  const companyLinks: FooterLink[] = [
    { href: `${base}/about`, label: label("hxFootAbout") },
    { href: `${base}/contact`, label: label("hxFootContact") },
    { href: `${base}/trust`, label: label("hxFootTrust") },
  ];
  // Legacy app pages: not under a locale prefix.
  const legalLinks: FooterLink[] = [
    { href: "/cookies", label: label("hxFootCookies") },
    { href: "/privacy", label: label("hxFootPrivacy") },
    { href: "/terms", label: label("hxFootTerms") },
    { href: "/help", label: label("hxFootHelp") },
  ];

  return (
    <footer id="footer" data-testid="section-footer" className="phase-footer mz-foot">
      <div className="mz-foot-wrap">
        <div className="mz-foot-brand">
          <Link className="phase-brand" href={base} translate="no">
            <BrandMark size="sm" />
            <bdi>{brand}</bdi>
          </Link>
          <p>{text("footerTagline")}</p>
          <p className="mz-foot-contact">
            <span>{text("hxFootSupport")}</span>
            <a href={`mailto:${supportEmail}`} dir="ltr" data-testid="link-foot-support">
              {supportEmail}
            </a>
            {SHOW_WHATSAPP && (
              <a href={WHATSAPP_HREF} rel="noopener noreferrer" data-testid="link-foot-whatsapp">
                {text("hxFootWhatsapp")}
              </a>
            )}
          </p>
          <p className="mz-foot-lang">
            <span>{text("hxFootLanguage")}</span>
            {onSwitchLocale ? (
              <button
                type="button"
                className="mz-foot-langbtn"
                lang={other}
                data-testid="link-foot-language"
                onClick={() => onSwitchLocale(other)}
              >
                {LANGUAGE_NAME[other]}
              </button>
            ) : (
              <Link
                href={`/${other}${samePage}`}
                lang={other}
                hrefLang={other}
                data-testid="link-foot-language"
              >
                {LANGUAGE_NAME[other]}
              </Link>
            )}
          </p>
        </div>
        <nav className="mz-foot-nav" aria-label={text("hxFootLabel")}>
          <Column title={text("hxFootProduct")} links={productLinks} />
          <Column title={text("hxFootFreeTools")} links={toolLinks} />
          <Column title={text("hxFootCompare")} links={compareLinks} />
          <Column title={text("hxFootCompany")} links={companyLinks} />
          <Column title={text("hxFootLegal")} links={legalLinks} />
        </nav>
      </div>
    </footer>
  );
}
