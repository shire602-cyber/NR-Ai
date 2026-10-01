/**
 * What the public landing page ("/") and pricing page (/pricing) may say.
 *
 * Guards three things:
 *  1. Forbidden claims never come back in either language (accreditation,
 *     data residency, bank feeds, storefront sync, ZATCA, ...).
 *  2. Prices, limits, plan gates and the trial shown publicly equal what the
 *     server enforces (client/src/lib/plan-catalog.ts is the one source for
 *     both pages; this test pins it to featureGate.ts and billing-plan.ts).
 *  3. The landing page never hardcodes a price: it reads the same catalog.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PLAN_PRICES as SHARED_PLAN_PRICES } from "../../shared/plan-prices";
import { readSourceWithMessages } from "../helpers/read-source";

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/stripe.service", () => ({
  isStripeConfigured: () => false,
  subscriptionLimitFields: () => ({}),
}));

import { messages as landingMessages } from "../../client/src/pages/MuhasibLanding.i18n";
import { messages as pricingMessages } from "../../client/src/pages/Pricing.i18n";
import {
  FEATURE_MIN_PLAN,
  PLAN_IDS,
  PLAN_LIMITS,
  PLAN_PRICES,
  TRIAL_DAYS,
  TRIAL_PLAN_ID,
  planIncludes,
  type GatedFeature,
} from "../../client/src/lib/plan-catalog";
import { getTierFeatures, getTierLimits } from "../../server/middleware/featureGate";
import { TRIAL_DAYS as SERVER_TRIAL_DAYS, TRIAL_PLAN } from "../../server/services/billing-plan";

const repoRoot = process.cwd();

const pages = [
  { name: "landing", messages: landingMessages, file: "client/src/pages/MuhasibLanding.tsx" },
  { name: "pricing", messages: pricingMessages, file: "client/src/pages/Pricing.tsx" },
] as const;

// Claims that must not appear on the public pages. English first, then the
// Arabic equivalents of the same claims.
const forbiddenClaims: ReadonlyArray<readonly [string, RegExp]> = [
  ["accredited", /accredited/i],
  ["approved provider", /approved provider/i],
  ["FTA-certified", /FTA[-\s]?certified/i],
  ["hosted in the UAE", /hosted in the (UAE|United Arab Emirates)/i],
  ["UAE-hosted", /UAE[-\s]hosted/i],
  ["data residency", /data[-\s]residency/i],
  ["bank feed", /bank[-\s]feeds?/i],
  ["live bank connection", /live (bank )?(feed|connection|sync)/i],
  ["Shopify", /Shopify/i],
  ["WooCommerce", /WooCommerce/i],
  ["ZATCA", /ZATCA/i],
  ["Saudi", /Saudi/i],
  ["public API", /public API|API access/i],
  ["money-back guarantee", /money[-\s]back/i],
  // Arabic
  ["معتمد (accredited / approved)", /معتمد/],
  ["مزود معتمد (approved provider)", /مزود(ة)? معتمد/],
  ["مصدّق / معتمد من الهيئة (FTA-certified)", /(معتمد|مصدّق|مصدق|مرخّص|مرخص) من الهيئة/],
  ["مستضاف في الإمارات (hosted in the UAE)", /(مستضاف|استضافة|تُستضاف)[^.]*الإمارات/],
  ["إقامة البيانات (data residency)", /إقامة البيانات|توطين البيانات/],
  ["ربط بنكي مباشر (live bank feed)", /ربط بنكي مباشر|تغذية بنكية|تدفق بنكي مباشر/],
  ["شوبيفاي (Shopify)", /شوبيفاي/],
  ["ووكومرس (WooCommerce)", /ووكومرس/],
  ["زاتكا (ZATCA)", /زاتكا|هيئة الزكاة/],
  ["السعودية (Saudi)", /السعودية/],
  ["ضمان استرداد (money-back)", /ضمان استرداد/],
];

function allText(table: Record<string, string>): string[] {
  return Object.values(table);
}

describe("public pages: forbidden claims", () => {
  for (const page of pages) {
    for (const locale of ["en", "ar"] as const) {
      const strings = allText(page.messages.tables[locale]);

      it(`${page.name} (${locale}) contains none of the forbidden claims`, () => {
        for (const [label, pattern] of forbiddenClaims) {
          const hit = strings.find((text) => pattern.test(text));
          expect(hit, `${page.name}/${locale} contains "${label}": ${hit}`).toBeUndefined();
        }
      });
    }

    it(`${page.name} source has none of the forbidden English claims`, () => {
      const source = readSourceWithMessages(repoRoot, page.file);
      for (const [label, pattern] of forbiddenClaims.slice(0, 14)) {
        expect(pattern.test(source), `${page.file} contains "${label}"`).toBe(false);
      }
    });
  }

  it("says 'e-invoice ready (PINT-AE)' on both pages, in English", () => {
    for (const page of pages) {
      const joined = allText(page.messages.tables.en).join("\n");
      expect(joined, page.name).toMatch(/e-invoice ready \(PINT-AE\)/i);
    }
  });

  it("keeps the no-fabricated-testimonials guard in the landing source", () => {
    const source = readSourceWithMessages(repoRoot, "client/src/pages/MuhasibLanding.tsx");
    expect(source).toContain("Testimonial section removed");
  });
});

describe("public pages: prices, limits and plan gates equal the server", () => {
  it("lists the four plans in the order the server uses", () => {
    expect(PLAN_IDS).toEqual(["free", "starter", "professional", "enterprise"]);
  });

  it("usage limits equal the server's TIER_LIMITS", () => {
    for (const plan of PLAN_IDS) {
      const server = getTierLimits(plan);
      const shown = PLAN_LIMITS[plan];
      expect(shown.maxUsers, `${plan} users`).toBe(server.maxUsers);
      expect(shown.maxCompanies, `${plan} companies`).toBe(server.maxCompanies);
      expect(shown.maxInvoicesPerMonth, `${plan} invoices`).toBe(server.maxInvoicesPerMonth);
      expect(shown.maxReceiptsPerMonth, `${plan} receipts`).toBe(server.maxReceiptsPerMonth);
    }
  });

  it("only the plans the server allows are shown as 'unlimited users'", () => {
    const unlimitedUsers = PLAN_IDS.filter((plan) => PLAN_LIMITS[plan].maxUsers === -1);
    expect(unlimitedUsers).toEqual(["enterprise"]);
    expect(getTierLimits("enterprise").maxUsers).toBe(-1);
  });

  it("every advertised feature unlocks on the same plan as the server gate", () => {
    for (const plan of PLAN_IDS) {
      const server = getTierFeatures(plan);
      for (const feature of Object.keys(FEATURE_MIN_PLAN) as GatedFeature[]) {
        expect(planIncludes(plan, feature), `${feature} on ${plan}`).toBe(server[feature] === true);
      }
    }
  });

  it("the server gates nothing the pricing page silently omits", () => {
    // invoicePayment is a declared gate for a feature that is not offered yet,
    // so it is deliberately not advertised. webhooks is the same gate as
    // apiAccess in practice (the webhooks routes check apiAccess) and is
    // advertised as "Outbound webhooks" through that row.
    const deliberatelyUnadvertised = new Set(["invoicePayment", "webhooks"]);
    const serverFeatures = Object.keys(getTierFeatures("free"));
    const missing = serverFeatures.filter(
      (feature) => !(feature in FEATURE_MIN_PLAN) && !deliberatelyUnadvertised.has(feature)
    );
    expect(missing).toEqual([]);
  });

  it("the trial shown publicly is the trial the server grants", () => {
    expect(TRIAL_DAYS).toBe(SERVER_TRIAL_DAYS);
    expect(TRIAL_PLAN_ID).toBe(TRIAL_PLAN);
  });

  it("every 'N-day' trial figure in either page, either language, equals the real trial length", () => {
    for (const page of pages) {
      for (const text of allText(page.messages.tables.en).filter((t) => /trial/i.test(t))) {
        for (const match of text.matchAll(/(\d+)[-\s]day/gi)) {
          expect(Number(match[1]), `${page.name}: ${text}`).toBe(TRIAL_DAYS);
        }
      }
      for (const text of allText(page.messages.tables.ar).filter((t) => /تجرب/.test(t))) {
        for (const match of text.matchAll(/(\d+)\s*يوم/g)) {
          expect(Number(match[1]), `${page.name}: ${text}`).toBe(TRIAL_DAYS);
        }
      }
    }
  });

  it("states the trial is on the plan the server uses (Professional), not Starter", () => {
    expect(TRIAL_PLAN).toBe("professional");
    const startTrialMentions = allText(pricingMessages.tables.en).filter((text) =>
      /trial/i.test(text)
    );
    for (const text of startTrialMentions) {
      expect(text, text).not.toMatch(/Starter and Professional|both the Starter/i);
    }
  });
});

describe("public pages: landing prices equal pricing-page prices", () => {
  it("neither i18n table hardcodes a plan price", () => {
    const priceLiterals = [
      ...new Set(
        PLAN_IDS.flatMap((plan) => [PLAN_PRICES[plan].monthly, PLAN_PRICES[plan].yearly])
      ),
    ].filter((price) => price > 0);
    // Also catch the numbers an older server table used.
    const staleLiterals = [99, 129, 249];
    const pattern = new RegExp(
      `AED\\s*(${[...priceLiterals, ...staleLiterals].join("|")})(?![\\d,.])`,
      "i"
    );
    for (const page of pages) {
      for (const locale of ["en", "ar"] as const) {
        for (const text of allText(page.messages.tables[locale])) {
          expect(text, `${page.name}/${locale}`).not.toMatch(pattern);
        }
      }
    }
  });

  it("both pages read prices from the shared catalog, never from literals", () => {
    const landing = readSourceWithMessages(repoRoot, "client/src/pages/MuhasibLanding.tsx");
    const pricing = readSourceWithMessages(repoRoot, "client/src/pages/Pricing.tsx");

    for (const [name, source] of [
      ["landing", landing],
      ["pricing", pricing],
    ] as const) {
      expect(source, name).toContain('from "@/lib/plan-catalog"');
      expect(source, name).toContain("PLAN_PRICES");
      expect(source, name).not.toMatch(/monthlyPrice:\s*\d/);
      expect(source, name).not.toMatch(/yearlyPrice:\s*\d/);
      expect(source, name).not.toMatch(/AED\s+\d{2,3}\s*(\/|per)/);
    }
  });

  it("the free plan is free and paid prices rise with the plan", () => {
    expect(PLAN_PRICES.free).toEqual({ monthly: 0, yearly: 0 });
    const monthly = PLAN_IDS.map((plan) => PLAN_PRICES[plan].monthly);
    expect([...monthly].sort((a, b) => a - b)).toEqual(monthly);
    for (const plan of PLAN_IDS) {
      expect(PLAN_PRICES[plan].yearly).toBeLessThanOrEqual(PLAN_PRICES[plan].monthly);
    }
  });

  it("the billing API reads the same price table as the public pages", () => {
    const gate = readFileSync(resolve(__dirname, "../../server/middleware/featureGate.ts"), "utf8");
    expect(gate).toContain('from "../../shared/plan-prices"');
    // No second copy of the numbers anywhere in the gate.
    expect(gate).not.toMatch(/professional:\s*\{\s*monthly:\s*\d/);
    expect(PLAN_PRICES).toBe(SHARED_PLAN_PRICES);
  });
});
