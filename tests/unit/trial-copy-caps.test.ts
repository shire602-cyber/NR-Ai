/**
 * Trial copy must not promise more than TRIAL_LIMITS gives (shared/plans.ts): broad standalone
 * claims state the caps, nothing about the trial says "every/all/full/unlimited" without them, and
 * the expired state is called read-only. Reads the locale catalogs, which are the copy itself.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRIAL_LIMITS } from "../../shared/plans";
import { formatMessage } from "../../client/src/lib/i18n";

const LOCALES = ["en", "ar"] as const;
type Locale = (typeof LOCALES)[number];
const root = path.resolve(process.cwd(), "client/src/locales");

const readCatalog = (locale: Locale, file: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(root, locale, file), "utf8"));
const catalogFiles = (locale: Locale) =>
  readdirSync(path.join(root, locale))
    .filter((f) => f.endsWith(".json"))
    .sort();
const messages = (locale: Locale): Record<string, string> =>
  Object.assign({}, ...catalogFiles(locale).map((f) => readCatalog(locale, f)));

const { maxCompanies, aiCreditsPerMonth, maxStorageMb } = TRIAL_LIMITS;
const storageGb = maxStorageMb / 1024;

const CAPS: Record<Locale, string[]> = {
  en: [`${maxCompanies} companies`, `${aiCreditsPerMonth} AI credits per month`, `${storageGb} GB`],
  ar: [
    `${maxCompanies} شركات`,
    `${aiCreditsPerMonth} من أرصدة الذكاء الاصطناعي شهريًا`,
    `${storageGb} غيغابايت`,
  ],
};
const disclosesCaps = (locale: Locale, value: string) =>
  CAPS[locale].every((cap) => new RegExp(`(?<![\\d,.])${cap}`).test(value));

/** Strings that talk about the trial or the no-card offer ("تجريبي" alone also means "demo"). */
const TRIAL_TALK: Record<Locale, RegExp> = {
  en: /\btrial\b|\bno card\b/i,
  ar: /تجربة|تجربت|الفترة التجريبية|فترتك التجريبية|دون بطاقة/,
};
/** Unlimited users is true during the trial, so it is not listed here. */
const OVERCLAIM: Record<Locale, RegExp> = {
  en: /\b(every|all) (features?|modules?)\b|\bfull\b[^.]*\bplan\b|\beverything\b|\bunlimited (companies|AI|storage)\b/i,
  ar: /(كل|جميع) (الميزات|المزايا|الوحدات)|(المؤسسات|الباقة|الخطة) كاملة|كل شيء|(شركات|تخزين|أرصدة)[^.،]{0,30}(بلا حد|غير محدود)/,
};

describe("trial copy states the trial's real limits", () => {
  it.each(LOCALES)("standalone trial claims disclose the caps (%s)", (locale) => {
    const all = messages(locale);
    for (const key of [
      "marketing.prBodyTrial",
      "marketing.prFaqTrialTopA",
      "onboarding.trialStartedNote",
    ]) {
      const copy = all[key] ?? "";
      const values = { companies: maxCompanies, credits: aiCreditsPerMonth, storageGb };
      for (const name of Object.keys(values)) {
        expect(copy, `${locale} ${key}`).toContain(`{${name}}`);
      }
      const rendered = formatMessage(copy, values);
      expect(disclosesCaps(locale, rendered), `${locale} ${key}: ${rendered}`).toBe(true);
    }
  });

  it.each(LOCALES)("no trial string overclaims without stating the caps (%s)", (locale) => {
    const offenders = Object.entries(messages(locale)).filter(
      ([, value]) =>
        TRIAL_TALK[locale].test(value) &&
        OVERCLAIM[locale].test(value) &&
        !disclosesCaps(locale, value)
    );
    expect(offenders).toEqual([]);
  });

  it.each(LOCALES)("the signup caps line keeps its placeholders (%s)", (locale) => {
    // Argument names of both simple ({credits}) and ICU ({companies, plural, ...}) placeholders.
    const names = Array.from(
      (messages(locale)["marketing.signupTrialCaps"] ?? "").matchAll(/\{(\w+)(?=[,}])/g),
      (match) => match[1]
    ).sort();
    expect(names).toEqual(["companies", "credits", "storage"]);
  });

  it("labels the expired state read-only", () => {
    expect(messages("en")["pages.subscriptionStateReadOnly"]).toBe("Read-only");
    expect(messages("ar")["pages.subscriptionStateReadOnly"]).toBe("للقراءة فقط");
  });

  it("keeps the same EN and AR keys and placeholders in the trial catalogs", () => {
    for (const file of [
      "marketing.json",
      "marketingHome.json",
      "marketingMeta.json",
      "onboarding.json",
      "pages.json",
    ]) {
      expect(Object.keys(readCatalog("ar", file)).sort(), file).toEqual(
        Object.keys(readCatalog("en", file)).sort()
      );
    }
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const key of ["marketing.signupPlanLead", "onboarding.trialStartedNote"]) {
      expect(placeholders(messages("ar")[key]), key).toEqual(placeholders(messages("en")[key]));
    }
  });
});
