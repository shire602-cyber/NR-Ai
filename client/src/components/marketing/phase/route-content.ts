import { MARKETING_BRAND } from "../../../../../shared/marketing-brand";
import { features, starterPrice, tools, type Bilingual } from "./content";
import { editorialPages, launchPages } from "./editorial/pages";
import { siteLocale } from "./routes";

export const trialSignupPath = "/register?step=account";

// These two stay `[en, ar]` tuples because the server imports this file to render the h1, title
// and meta description of the homepage. They must match marketing.hxHeroTitle / hxHeroSub in
// locales/{en,ar}/marketing.json (tests/unit/public-site-design.test.ts checks they do).
export const homeTitle: Bilingual = [
  "Your books. Your VAT. Your e-invoices. Done.",
  "دفاترك. ضريبتك. فواتيرك الإلكترونية. كلها منجزة.",
];
export const homeLead: Bilingual = [
  `Bilingual tax invoices, AI receipt capture, VAT 201 ready for EmaraTax and e-invoicing on every plan, from AED ${starterPrice} a month.`,
  `فواتير ضريبية بالعربية والإنجليزية، والتقاط الإيصالات بالذكاء الاصطناعي، وإقرار VAT 201 جاهز لـ EmaraTax، وفوترة إلكترونية مشمولة في كل باقة، من ${starterPrice} درهمًا شهريًا.`,
];

export const demoTitle: Bilingual = ["Request a demo", "اطلب عرضًا توضيحيًا"];
export const demoLead: Bilingual = [
  "Request a callback to arrange a walkthrough for your UAE business or accounting firm.",
  "اطلب اتصالًا لترتيب عرض توضيحي لشركتك أو مكتب المحاسبة في الإمارات.",
];
export const pricingTitle: Bilingual = [
  "UAE accounting plans from AED " + starterPrice + " a month",
  "خطط محاسبية تبدأ من " + starterPrice + " درهمًا شهريًا",
];
export const pricingLead: Bilingual = [
  "Compare Starter, Professional and Enterprise. Try Enterprise free for 14 days with no card.",
  "قارن باقات المبتدئ والاحترافية والمؤسسات. جرّب باقة المؤسسات مجانًا لمدة 14 يومًا دون بطاقة دفع.",
];

// The UAE e-invoicing hub is the SEO landing page. Like the homepage pair above these stay
// `[en, ar]` tuples because the server imports this file for the h1, title and meta description;
// they must match marketing.hxHubH1 / hxHubLead in locales/{en,ar}/marketing.json
// (tests/unit/marketing-pages.test.ts checks they do).
export const hubTitle: Bilingual = [
  "UAE e-invoicing, built into your accounting",
  "الفوترة الإلكترونية في الإمارات، مدمجة في محاسبتك",
];
export const hubLead: Bilingual = [
  "See your deadline, how e-invoices are exchanged through an accredited service provider, and check your readiness. Included on every plan.",
  "اعرف موعدك النهائي وكيف تُتبادل الفواتير الإلكترونية عبر مزوّد خدمة معتمد، وتحقّق من جاهزيتك. مشمولة في كل باقة.",
];

const pages = new Map<string, { title: Bilingual; lead?: Bilingual }>([
  ["", { title: homeTitle, lead: homeLead }],
  ["/pricing", { title: pricingTitle, lead: pricingLead }],
  ["/book-demo", { title: demoTitle, lead: demoLead }],
  [
    "/solutions/small-business",
    {
      title: ["Small and medium businesses", "الشركات الصغيرة والمتوسطة"],
      lead: [
        "Send invoices, capture expenses and collaborate with your accountant.",
        "أرسل الفواتير وسجّل المصروفات وتعاون مع محاسبك.",
      ],
    },
  ],
  [
    "/solutions/accounting-firms",
    {
      title: ["Accounting firms", "مكاتب المحاسبة"],
      lead: [
        "Work across client companies and share invoices and statements through the client portal.",
        "اعمل عبر شركات عملائك وشارك الفواتير وكشوف الحساب عبر بوابة العملاء.",
      ],
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
