import { MARKETING_BRAND } from "../shared/marketing-brand";
import { marketingMetadata } from "../client/src/components/marketing/phase/route-content";

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (value) => entities[value]);

export function renderMarketingDocument(html: string, pathname: string) {
  const meta = marketingMetadata(pathname === "/" ? "/en" : pathname);
  if (!meta) return html;
  const { locale, canonical, en, ar } = meta;
  const arabic = locale === "ar";
  const title = escapeHtml(meta.title);
  const heading = escapeHtml(meta.heading);
  const description = escapeHtml(meta.description);
  const brand = escapeHtml(MARKETING_BRAND.name[locale]);
  const languageLinks = [
    `<link rel="canonical" href="${canonical}">`,
    `<link rel="alternate" hreflang="en-AE" href="${en}">`,
    `<link rel="alternate" hreflang="ar-AE" href="${ar}">`,
    `<link rel="alternate" hreflang="x-default" href="${en}">`,
  ].join("\n    ");

  const pageMeta: Record<string, string> = {
    description,
    "og:title": title,
    "og:description": description,
    "og:site_name": brand,
    "og:locale": arabic ? "ar_AE" : "en_AE",
    "og:locale:alternate": arabic ? "en_AE" : "ar_AE",
    "twitter:title": title,
    "twitter:description": description,
    author: brand,
  };

  return html
    .replace(/<html[^>]*>/, `<html lang="${locale}" dir="${arabic ? "rtl" : "ltr"}">`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace(/<meta\s+(name|property)="([^"]+)"[^>]*>/g, (tag, attribute, key: string) =>
      Object.hasOwn(pageMeta, key)
        ? `<meta ${attribute}="${key}" content="${pageMeta[key]}" />`
        : tag
    )
    .replace("</head>", () => `    ${languageLinks}\n  </head>`)
    .replace(
      '<div id="root"></div>',
      () =>
        `<div id="root"><main class="phase-site"><section class="phase-section phase-subpage"><div class="phase-wrap">` +
        `<h1>${heading}</h1><p class="phase-lead">${description}</p>` +
        `<noscript><a href="/${locale}/product">${arabic ? "المنتج" : "Product"}</a> · ` +
        `<a href="/${locale}/pricing">${arabic ? "الأسعار" : "Pricing"}</a> · ` +
        `<a href="/${locale}/contact">${arabic ? "تواصل معنا" : "Contact"}</a></noscript>` +
        `</div></section></main></div>`
    );
}
