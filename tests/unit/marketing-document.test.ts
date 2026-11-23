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
});
