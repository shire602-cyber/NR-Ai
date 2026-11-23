import { PRODUCT_NAME } from "./product-brand";

const domain = "muhasib.ai";

export const MARKETING_BRAND = {
  name: { en: PRODUCT_NAME, ar: "محاسب" },
  domain,
  origin: `https://${domain}`,
  supportEmail: `support@${domain}`,
  contactEmail: `hello@${domain}`,
  legalEmail: `legal@${domain}`,
  privacyEmail: `privacy@${domain}`,
  securityEmail: `security@${domain}`,
} as const;

export const marketingBrand = MARKETING_BRAND.name.en;
export const supportEmail = MARKETING_BRAND.supportEmail;
