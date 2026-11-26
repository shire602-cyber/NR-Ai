import { MARKETING_BRAND } from "../../../../../shared/marketing-brand";
import { features, starterPrice, tools, type Bilingual } from "./content";
import { editorialPages, launchPages } from "./editorial/pages";
import { metaPair } from "./meta-text";
import { siteLocale } from "./routes";

export const trialSignupPath = "/register?step=account";

// The server imports this file to render the h1, title and meta description. The copy is read from
// the marketingMeta catalog (locales/{en,ar}/marketingMeta.json), the same file the client store
// loads, so the server-rendered text cannot drift from the page.
export const homeTitle: Bilingual = metaPair("hxHeroTitle");
export const homeLead: Bilingual = metaPair("hxHeroSub", { price: starterPrice });

export const demoTitle: Bilingual = metaPair("hxMetaDemoTitle");
export const demoLead: Bilingual = metaPair("hxMetaDemoLead");
export const pricingTitle: Bilingual = metaPair("hxMetaPricingTitle", { price: starterPrice });
export const pricingLead: Bilingual = metaPair("hxMetaPricingLead");

export const hubTitle: Bilingual = metaPair("hxHubH1");
export const hubLead: Bilingual = metaPair("hxHubLead");

const pages = new Map<string, { title: Bilingual; lead?: Bilingual }>([
  ["", { title: homeTitle, lead: homeLead }],
  ["/pricing", { title: pricingTitle, lead: pricingLead }],
  ["/book-demo", { title: demoTitle, lead: demoLead }],
  [
    "/solutions/small-business",
    {
      title: metaPair("hxMetaSmbTitle"),
      lead: metaPair("hxMetaSmbLead"),
    },
  ],
  [
    "/solutions/accounting-firms",
    {
      title: metaPair("hxMetaFirmsTitle"),
      lead: metaPair("hxMetaFirmsLead"),
    },
  ],
  ...Object.entries(editorialPages),
  ...Object.entries(launchPages),
]);
for (const feature of features) pages.set(featurePath(feature.slug), feature);
pages.set(featurePath("e-invoicing"), { title: hubTitle, lead: hubLead });
for (const tool of tools) pages.set(`/tools/${tool.slug}`, tool);

/**
 * Alternative URLs that serve the same page as their target. `marketingMetadata` resolves them to
 * the target, so they get 200, the target's title/description and a canonical pointing at the
 * target. They are not in `pages`, so `marketingPaths` (and the sitemap) never list them.
 */
const aliases = new Map([
  ["/book-a-demo", "/book-demo"],
  ["/e-invoicing", "/uae-e-invoicing"],
  ["/compare/zoho-books", "/compare/zoho"],
  ["/free-tools", "/tools"],
  ["/accounting-firms", "/solutions/accounting-firms"],
  ["/small-business", "/solutions/small-business"],
  ["/product/e-invoicing", "/uae-e-invoicing"],
  ["/product/reporting", "/product/accounting-reports"],
  ["/product/receipt-scanning", "/product/ai-document-scanning"],
]);

export function canonicalMarketingPath(path: string) {
  return aliases.get(path) ?? path;
}

export function featurePath(slug: string): string {
  switch (slug) {
    case "e-invoicing":
      return "/uae-e-invoicing";
    case "reporting":
      return "/product/accounting-reports";
    case "receipt-scanning":
      return "/product/ai-document-scanning";
    default:
      return `/product/${slug}`;
  }
}

export const marketingPaths = [...pages.keys()];

export function marketingMetadata(path: string) {
  const locale = siteLocale(path);
  if (!locale) return undefined;
  const pagePath = canonicalMarketingPath(path.slice(3).replace(/\/+$/, ""));
  const page = pages.get(pagePath);
  if (!page) return undefined;
  const index = locale === "ar" ? 1 : 0;
  return {
    locale,
    title: `${page.title[index]} | ${MARKETING_BRAND.name[locale]}`,
    heading: page.title[index],
    description: page.lead?.[index] ?? page.title[index],
    canonical: `${MARKETING_BRAND.origin}/${locale}${pagePath}`,
    en: `${MARKETING_BRAND.origin}/en${pagePath}`,
    ar: `${MARKETING_BRAND.origin}/ar${pagePath}`,
  };
}
