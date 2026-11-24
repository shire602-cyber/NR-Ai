import { describe, expect, it } from "vitest";
import { newCompanyPayload } from "../../client/src/pages/onboarding/company-payload";

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
