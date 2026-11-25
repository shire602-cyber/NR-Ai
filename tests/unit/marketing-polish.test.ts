import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { brandNodes, stripBrandMarks } from "../../client/src/components/marketing/phase/home/text";
import { isLocaleSwitch } from "../../client/src/components/marketing/phase/routes";
import { marketingMetadata } from "../../client/src/components/marketing/phase/route-content";

describe("language toggle keeps the reader's place", () => {
  it("treats a path that differs only by locale prefix as a language switch", () => {
    expect(isLocaleSwitch("/en", "/ar")).toBe(true);
    expect(isLocaleSwitch("/ar/pricing", "/en/pricing")).toBe(true);
    expect(isLocaleSwitch("/en/compare/wafeq", "/ar/compare/wafeq")).toBe(true);
  });

  it("scrolls to the top for real navigation", () => {
    expect(isLocaleSwitch("/en", "/en/pricing")).toBe(false);
    expect(isLocaleSwitch("/en/pricing", "/ar/tools")).toBe(false);
    expect(isLocaleSwitch("/en", "/en")).toBe(false);
  });
});

describe("vendor and plan names inside Arabic sentences", () => {
  it("renders marked names as untranslated English islands", () => {
    const html = renderToStaticMarkup(
      createElement("p", null, brandNodes("{x} باقة ⟦Elite⟧ سنويًا".replace("{x}", "280")))
    );
    expect(html).toContain('<bdi lang="en" translate="no">Elite</bdi>');
    expect(html).not.toContain("⟦");
  });

  it("strips the markers for plain-text consumers", () => {
    expect(stripBrandMarks("باقة ⟦Zoho Books Professional⟧ سنويًا")).toBe(
      "باقة Zoho Books Professional سنويًا"
    );
  });
});

describe("home metadata", () => {
  it.each(["/en", "/ar"])("%s mentions e-invoicing on every plan and AED pricing", (base) => {
    const meta = marketingMetadata(base);
    expect(meta?.title).toBeTruthy();
    expect(meta?.description).toMatch(base === "/ar" ? /59/ : /AED 59/);
    expect(meta?.description).toMatch(base === "/ar" ? /فوترة إلكترونية/ : /e-invoicing/i);
  });
});
