import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  existingCompanyPatch,
  newCompanyPayload,
} from "../../client/src/pages/onboarding/company-payload";

describe("onboarding new-company payload", () => {
  it("creates an Arabic company when the owner signs up in Arabic", () => {
    const body = newCompanyPayload({ name: "شركة" }, "ar");
    expect(body).toMatchObject({ locale: "ar", baseCurrency: "AED", companyType: "customer" });
  });
  it("defaults to English and always AED / customer", () => {
    expect(newCompanyPayload({ name: "Co" }, "en")).toMatchObject({
      locale: "en",
      baseCurrency: "AED",
      companyType: "customer",
    });
    expect(newCompanyPayload({ name: "Co" }, "fr").locale).toBe("en");
  });
});

describe("onboarding wizard PATCH for an already-provisioned company", () => {
  it("moves an English-provisioned company to Arabic when the owner is in Arabic", () => {
    expect(existingCompanyPatch({ name: "شركة" }, "en", "ar")).toEqual({
      name: "شركة",
      locale: "ar",
    });
  });
  it("does not touch the locale otherwise", () => {
    expect(existingCompanyPatch({ name: "Co" }, "ar", "ar")).not.toHaveProperty("locale");
    expect(existingCompanyPatch({ name: "Co" }, "ar", "en")).not.toHaveProperty("locale");
    expect(existingCompanyPatch({ name: "Co" }, "en", "en")).not.toHaveProperty("locale");
  });
  it("is what CustomerOnboarding sends (source check: the component is too heavy to render here)", () => {
    const src = readFileSync("client/src/pages/onboarding/CustomerOnboarding.tsx", "utf8");
    expect(src).toMatch(/existingCompanyPatch\(payload, saved\.locale, locale\)/);
  });
});
