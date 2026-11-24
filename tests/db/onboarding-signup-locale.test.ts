/**
 * Onboarding first run: an Arabic self-signup provisions an Arabic company (the register route
 * used to hard-code locale "en"), and an unknown locale is refused by the strict body.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

async function register(locale?: string) {
  const slug = `loc_${randomBytes(4).toString("hex")}`;
  const email = `${slug}@harness.test`;
  const res = await h.anon.post("/api/auth/register", {
    name: "Locale Person",
    email,
    password: `Harness${randomBytes(4).toString("hex")}A1!`,
    ...(locale ? { locale } : {}),
  });
  const rows = await h.sql<{ locale: string; base_currency: string; company_type: string }>(
    `SELECT c.locale, c.base_currency, c.company_type FROM companies c
       JOIN company_users cu ON cu.company_id = c.id JOIN users u ON u.id = cu.user_id
      WHERE u.email = $1`,
    [email]
  );
  return { res, company: rows[0] };
}

describe("onboarding signup locale", () => {
  it("[ONB-signup-locale-ar] an Arabic signup creates an Arabic AED customer company", async () => {
    const { res, company } = await register("ar");
    expect(res.status, res.text).toBe(200);
    expect(company).toMatchObject({ locale: "ar", base_currency: "AED", company_type: "customer" });
  });

  it("[ONB-signup-locale-en] no locale (or en) stays English", async () => {
    expect((await register()).company.locale).toBe("en");
    expect((await register("en")).company.locale).toBe("en");
  });

  it("[ONB-signup-locale-invalid] an unsupported locale is rejected", async () => {
    const slug = `loc_${randomBytes(4).toString("hex")}`;
    const res = await h.anon.post("/api/auth/register", {
      name: "X Person",
      email: `${slug}@harness.test`,
      password: `Harness${randomBytes(4).toString("hex")}A1!`,
      locale: "fr",
    });
    expect(res.status).toBe(400);
  });
});
