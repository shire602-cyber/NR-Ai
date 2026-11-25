import { describe, expect, it } from "vitest";
import { MARKETING_BRAND } from "../../shared/marketing-brand";
import { documentStatus } from "../../server/vite";
import { renderMarketingDocument } from "../../server/marketing-document";

const shell =
  '<html lang="en"><head><title>Default</title><meta name="description" content="Default"></head><body><div id="root"></div></body></html>';

describe("localized marketing documents", () => {
  it.each([
    "/product",
    "/tools",
    "/tools/invoice-template",
    "/about",
    "/contact",
    "/book-demo",
    "/uae-e-invoicing",
  ])("serves and pairs %s in both languages", (path) => {
    const origin = MARKETING_BRAND.origin;
    const ar = renderMarketingDocument(shell, "/ar" + path);
    const en = renderMarketingDocument(shell, "/en" + path);
    expect(documentStatus("/en" + path)).toBe(200);
    expect(documentStatus("/ar" + path)).toBe(200);
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(ar).toContain(`rel="canonical" href="${origin}/ar${path}"`);
    expect(ar).toContain(`hreflang="en-AE" href="${origin}/en${path}"`);
    expect(en).toContain(`hreflang="ar-AE" href="${origin}/ar${path}"`);
    expect(en).toContain(`hreflang="x-default" href="${origin}/en${path}"`);
    expect(ar).toMatch(/<h1>[^<]*[\u0600-\u06ff]/);
    expect(en).not.toContain("Default");
  });

  it("keeps old links and uses the spec’s new slugs as canonical", () => {
    expect(documentStatus("/en/book-a-demo")).toBe(200);
    expect(renderMarketingDocument(shell, "/en/book-a-demo")).toContain(
      `rel="canonical" href="${MARKETING_BRAND.origin}/en/book-demo"`
    );
    expect(documentStatus("/ar/product/missing")).toBe(404);
    expect(renderMarketingDocument(shell, "/ar/product/missing")).toBe(shell);
  });

  it.each([
    ["/e-invoicing", "/uae-e-invoicing"],
    ["/compare/zoho-books", "/compare/zoho"],
    ["/free-tools", "/tools"],
    ["/accounting-firms", "/solutions/accounting-firms"],
    ["/small-business", "/solutions/small-business"],
  ])("serves the alias %s with the canonical of %s", (alias, target) => {
    const origin = MARKETING_BRAND.origin;
    for (const locale of ["en", "ar"]) {
      expect(documentStatus(`/${locale}${alias}`)).toBe(200);
      const html = renderMarketingDocument(shell, `/${locale}${alias}`);
      expect(html).toContain(`rel="canonical" href="${origin}/${locale}${target}"`);
      expect(html).toContain(`hreflang="en-AE" href="${origin}/en${target}"`);
      expect(html).toContain(`hreflang="ar-AE" href="${origin}/ar${target}"`);
      expect(html).toContain(`hreflang="x-default" href="${origin}/en${target}"`);
      expect(html).not.toContain(`href="${origin}/${locale}${alias}"`);
      expect(html).toBe(renderMarketingDocument(shell, `/${locale}${target}`));
    }
  });

  it("lists the pages but not their aliases in the sitemap, and still 404s unknown routes", async () => {
    const { serveSitemap } = await import("../../server/vite");
    let body = "";
    const res = { type: () => res, send: (xml: string) => (body = xml) };
    serveSitemap({} as never, res as never);
    expect(body).toContain(`${MARKETING_BRAND.origin}/en/uae-e-invoicing<`);
    expect(body).toContain(`${MARKETING_BRAND.origin}/ar/compare/zoho<`);
    for (const alias of [
      "/e-invoicing",
      "/compare/zoho-books",
      "/free-tools",
      "/accounting-firms",
      "/small-business",
    ]) {
      expect(body).not.toContain(`/en${alias}<`);
      expect(body).not.toContain(`/ar${alias}<`);
    }
    for (const missing of [
      "/en/e-invoicing/extra",
      "/ar/compare/zoho-books/x",
      "/en/free-tools2",
      "/en/small-business/x",
    ]) {
      expect(documentStatus(missing)).toBe(404);
    }
  });
});
