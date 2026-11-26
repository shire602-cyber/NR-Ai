// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PricingPage } from "../../client/src/components/marketing/phase/pages/PricingPage";
import { SignupPlanStep } from "../../client/src/components/auth/SignupPlanStep";
import { formatMoneyText } from "../../client/src/lib/format-money";
import { loadNamespaces, t, useI18n } from "../../client/src/lib/i18n";
import { PAID_PLAN_IDS, PLAN_CURRENCY, TOP_PLAN_ID, planPrice } from "../../shared/plans";
import { TRIAL_DAYS } from "../../shared/trial";
import { findBankFeedMention } from "../e2e/lib/bank-feed-claims.mjs";

const repoRoot = resolve(__dirname, "../..");
const locales = ["en", "ar"] as const;
const removedPlatform = /\b(?:zatca|fatoora)\b|زاتكا|هيئة الزكاة/iu;
const saudi = /\b(?:saudi|ksa|sar|riyadh)\b|السعودي|الرياض/iu;
const bank =
  /\b(?:plaid|wio|(?:live|automatic|direct)[\s-]+(?:bank(?:[\s-]+account)?[\s-]+(?:sync\w*|connections?)|transaction[\s-]+imports?)|(?:connect|link|sync)\s+(?:(?:a|the|your)\s+)?bank accounts?)\b|بلايد|ويو(?!\p{L})|البنوك المفتوحة|(?:اتصال|ربط) مباشر بالبنك/iu;
const provider =
  /\b(?:a[\s\p{Pd}._]*cube|bee[\s\p{Pd}._]*aura|complyance|avalara|pagero|tradeshift|sovos|comarch|peppyrus|storecove|edicom|cleartax|unimaze)\b|كيوب|كو?مبل[اآ]?ي?[اآ]?ن[سز]|بي[\s\p{Pd}]*[اأإآ]?ورا|بيئورا|أفالارا|باغيرو|تريدشفت|سوفوس|كومارك|بيبيروس|ستوركوف/iu;

// Owner-approved Company Settings and Admin options. Exempt only these catalog entries,
// and only while they are unused by public code.
const countryAndCurrencyOptions = new Map<string, readonly string[]>([
  ["client/src/locales/en/adminConsole.json", ["adminConsole.curSAR"]],
  ["client/src/locales/ar/adminConsole.json", ["adminConsole.curSAR"]],
  ...locales.map(
    (locale) =>
      [
        `client/src/locales/${locale}/pageLabels.json`,
        [
          "pageLabels.sARSaudiRiyal",
          "pageLabels.companySettings.currency.SAR",
          "pageLabels.companySettings.country.SA",
        ],
      ] as const
  ),
]);

// Provider names are permitted in the private Settings cards and their catalogs, and in
// server implementation. Public catalog references into Settings are still checked.
const providerSettingsFiles = new Set([
  "client/src/components/einvoice/AcubeConnectCard.tsx",
  "client/src/components/einvoice/ComplyanceConnectCard.tsx",
  "client/src/components/einvoice/EInvoicePartnerCard.tsx",
  "client/src/components/einvoice/EInvoiceProviderCard.tsx",
  "client/src/components/einvoice/EInvoicingPartnerCard.tsx",
  "client/src/components/einvoice/ProviderCardParts.tsx",
  "client/src/locales/en/einvoicing.json",
  "client/src/locales/ar/einvoicing.json",
]);

const publicPages =
  /(?:pricing|compar(?:e|ison)|landing|register|login|sign(?:up|in)\w*|customeronboarding|forgotpassword|resetpassword|services|trustsecurity|helpcenter|migrationguides|demoworkspace|privacypolicy|termsofservice|cookiepolicy|publicnotfound)\.tsx?$/i;
const publicCatalogs =
  /^client\/src\/locales\/(en|ar)\/(?:marketing[^/]*|pricing|compare|landing|register|login|signup|onboarding|pages)\.json$/;

function* filesIn(directory: string): Generator<string> {
  for (const entry of readdirSync(join(repoRoot, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) yield* filesIn(path);
    if (entry.isFile()) yield path;
  }
}

type Copy = { file: string; location: string; value: string; public: boolean };

function* catalogStrings(value: unknown, key = ""): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [key, value];
  } else if (value && typeof value === "object") {
    for (const [child, entry] of Object.entries(value)) {
      yield* catalogStrings(entry, key ? `${key}.${child}` : child);
    }
  }
}

function sourceCopy(file: string, text: string, isPublic: boolean): Copy[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const entries: Copy[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateLiteralToken(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      entries.push({ file, location: String(line), value: node.text, public: isPublic });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return entries;
}

function readCopy(): Copy[] {
  const source: Copy[] = [];
  const catalogs: Copy[] = [];
  for (const directory of ["client/src", "shared", "server"]) {
    for (const file of filesIn(directory)) {
      if (/\.(?:test|spec)\.[^.]+$/.test(file)) continue;
      if (file.endsWith(".json")) {
        const data: unknown = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
        for (const [location, value] of catalogStrings(data)) {
          catalogs.push({ file, location, value, public: publicCatalogs.test(file) });
        }
      } else if (/\.[cm]?[jt]sx?$/.test(file)) {
        const isPublic =
          /^client\/src\/(?:components\/(?:marketing|auth)|pages\/legal)\//.test(file) ||
          (file.startsWith("client/src/pages/") && publicPages.test(file.split("/").at(-1)!)) ||
          file === "client/src/PublicApp.tsx" ||
          /^shared\/marketing-[^/]+\.ts$/.test(file);
        const text = readFileSync(join(repoRoot, file), "utf8");
        // Non-public code only needs the removed-platform scan. Skip parsing unrelated files.
        if (isPublic || removedPlatform.test(normalized(text)) || /\\[ux]/.test(text)) {
          source.push(...sourceCopy(file, text, isPublic));
        }
      }
    }
  }

  const publicKeys = new Set(source.filter((copy) => copy.public).map((copy) => copy.value));
  for (const copy of catalogs) {
    copy.public ||= publicKeys.has(copy.location);
  }
  return [...source, ...catalogs];
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u0640|[\u064b-\u065f]|\u0670|[\u00ad\u200b-\u200d\u2060]/gu, "")
    .trim();
}

describe("launch copy rules", () => {
  let copy: Copy[];
  beforeAll(() => {
    // Inspect shipped strings as well as rendered copy so dormant catalog entries, metadata,
    // and copy behind interactive states or API calls are covered.
    copy = readCopy();
  }, 120_000);

  it("omits retired invoicing platforms from client, shared, and server copy", () => {
    expect(matches(copy, (value) => removedPlatform.test(value))).toEqual([]);
  });

  it("keeps public marketing focused on the UAE", () => {
    expect(
      matches(copy, (value, { public: isPublic, file, location }) => {
        const isOption = countryAndCurrencyOptions.get(file)?.includes(location);
        return (
          (isPublic || (countryAndCurrencyOptions.has(file) && !isOption)) && saudi.test(value)
        );
      })
    ).toEqual([]);
  });

  it("describes banking using CSV import terminology", () => {
    expect(
      matches(
        copy,
        (value, entry) => entry.public && (bank.test(value) || !!findBankFeedMention(value))
      )
    ).toEqual([]);
  });

  it("keeps provider brands off public pages", () => {
    expect(
      matches(copy, (value, { public: isPublic, file }) => {
        const privateProviderCopy = file.startsWith("server/") || providerSettingsFiles.has(file);
        return (
          (isPublic || (!privateProviderCopy && file.startsWith("client/src/locales/"))) &&
          provider.test(value)
        );
      })
    ).toEqual([]);
  });
});

function matches(copy: Copy[], violates: (value: string, entry: Copy) => boolean): string[] {
  return copy
    .filter((entry) => violates(normalized(entry.value), entry))
    .map(({ file, location, value }) => `${file}:${location} ${value.trim()}`);
}

const monthlyPrices = { starter: 59, professional: 119, enterprise: 229 } as const;
const planIds = Object.keys(monthlyPrices) as (keyof typeof monthlyPrices)[];
const wording = {
  en: {
    money: (price: number) => `AED${price}per month`,
    month: /\ba month\b/i,
    badge: /^e[-\s]invoicing included$/i,
    feature: /^e[-\s]invoicing\b/i,
    included: /^included$/i,
    trial: [
      /\benterprise\b/i,
      /\b14[-\s]+days?\b/i,
      /\b(?:no|without (?:a|needing a|entering)) (?:credit |payment )?card\b/i,
    ],
  },
  ar: {
    money: (price: number) => `${price}د.إشهريًا`,
    month: /شهريا/u,
    badge: /^الفوترة الالكترونية مشمولة$/u,
    feature: /^الفوترة الالكترونية/u,
    included: /^مشمول$/u,
    trial: [
      /باقة المؤسسات/u,
      /(?<!\p{Nd})(?:14|١٤) يوما/u,
      /(?:دون|بدون) (?:الحاجة الى |ادخال بيانات )?(?:ال)?بطاقة/u,
    ],
  },
};

function assertTrialCopy(value: string | null | undefined, locale: (typeof locales)[number]) {
  const text = normalized(value ?? "").replace(/[إأ]/gu, "ا");
  for (const phrase of wording[locale].trial) expect(text).toMatch(phrase);
}

describe("the public pricing and signup offer", () => {
  it("pins the owner-approved currency, monthly prices, and Enterprise trial", () => {
    expect(PLAN_CURRENCY).toBe("AED");
    expect(PAID_PLAN_IDS).toEqual(planIds);
    expect(Object.fromEntries(planIds.map((id) => [id, planPrice(id, "monthly")]))).toEqual(
      monthlyPrices
    );
    expect(TOP_PLAN_ID).toBe("enterprise");
    expect(TRIAL_DAYS).toBe(14);
  });

  it.each(locales)(
    "renders monthly AED prices and the full offer in %s",
    async (locale) => {
      await loadNamespaces(locale, ["marketing", "marketingHome", "marketingMeta"]);
      await import("../../client/src/components/marketing/phase/MonthlyPlans");
      useI18n.setState({ locale });
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const container = document.createElement("div");
      const root = createRoot(container);
      const expected = wording[locale];
      try {
        await act(async () => {
          root.render(
            createElement(PricingPage, {
              base: `/${locale}`,
              locale,
              tr: (pair) => pair[locale === "en" ? 0 : 1],
            })
          );
        });
        await vi.waitFor(
          async () => {
            await act(async () => {});
            expect(container.querySelectorAll('[data-testid^="card-plan-"]')).toHaveLength(
              planIds.length
            );
          },
          { timeout: 5_000 }
        );
        for (const id of planIds) {
          const price = planPrice(id, "monthly");
          const card = container.querySelector(`[data-testid="card-plan-${id}"] .mk-tier__price`);
          expect(card?.textContent, id).toBe(expected.money(price));
          const column = container.querySelector(
            `[data-testid="plan-matrix"] th[data-plan="${id}"] small`
          );
          expect(column?.textContent, id).toContain(
            formatMoneyText(price, "AED", locale, { fractionDigits: 0 })
          );
          expect(normalized(column?.textContent ?? ""), id).toMatch(expected.month);
          const badge = container.querySelector(`[data-testid="badge-einvoicing-${id}"]`);
          expect(normalized(badge?.textContent ?? "").replace(/[إأ]/gu, "ا"), id).toMatch(
            expected.badge
          );
        }
        const row = container.querySelector('[data-row="marketing.prEveryEinvoiceTitle"]');
        expect(
          normalized(row?.querySelector("th")?.textContent ?? "").replace(/[إأ]/gu, "ا")
        ).toMatch(expected.feature);
        const cells = Array.from(row?.querySelectorAll("td .sr-only") ?? []);
        expect(cells).toHaveLength(planIds.length);
        for (const cell of cells)
          expect(normalized(cell.textContent ?? "")).toMatch(expected.included);
        assertTrialCopy(
          container.querySelector('[data-testid="price-trial-note"]')?.textContent,
          locale
        );

        await act(async () => {
          root.render(
            createElement(SignupPlanStep, {
              planId: "starter",
              cycle: "monthly",
              onPlanChange: vi.fn(),
              onCycleChange: vi.fn(),
              onContinue: vi.fn(),
            })
          );
        });
        assertTrialCopy(
          container.querySelector('[data-testid="signup-plan-step"] header')?.textContent,
          locale
        );
        for (const key of ["signupTrialOffer", "hxCmpTrialMuhasib", "hxFaqCardA"]) {
          assertTrialCopy(t[locale][`marketing.${key}`], locale);
        }
      } finally {
        act(() => root.unmount());
        vi.unstubAllGlobals();
      }
    },
    30_000
  );
});
