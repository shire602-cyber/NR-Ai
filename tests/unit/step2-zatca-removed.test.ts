// @vitest-environment jsdom
/**
 * STEP2: Saudi ZATCA is removed from the product, in English and Arabic.
 *
 * The scans below are source inspection on purpose: the absence of a feature across the whole
 * tree cannot be observed by calling one function; the catalog and file scans are the behaviour.
 * Everything else (shared validators, capabilities, rendered pages) is exercised directly.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  byTestId,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
const activeCompany = vi.hoisted(() => ({
  current: { addressCountry: "SA" } as { addressCountry: string },
}));
vi.mock("../../client/src/components/ActiveCompanyProvider", () => ({
  useActiveCompany: () => ({ isFirmContext: false, company: activeCompany.current }),
}));
// The provider and partner cards fetch their own state and are not under test here.
vi.mock("../../client/src/components/einvoice/EInvoiceProviderCard", () => ({
  EInvoiceProviderCard: () => null,
}));
vi.mock("../../client/src/components/einvoice/EInvoicePartnerCard", () => ({
  EInvoicePartnerCard: () => null,
}));
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscription: null,
    usage: null,
    limits: null,
    tierName: "enterprise",
    isFreeTier: false,
    canAccess: () => true,
    getRequiredTier: () => "starter",
    isLoading: false,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, "../..");
const BANNED = /zatca|fatoora|زاتكا|هيئة الزكاة/i;

/** Files that must name ZATCA to prove it is gone (and the removal tooling itself). */
const ALLOWED_FILES = new Set([
  "tests/unit/step2-zatca-removed.test.ts",
  "tests/db/step2-zatca-removed.test.ts",
  "scripts/qa/check-no-zatca-bundle.mjs",
  "scripts/qa/find-ksa-zatca-data.sql",
]);

function trackedFiles(dirs: string[]): string[] {
  const out = execFileSync("git", ["ls-files", "--", ...dirs], { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !ALLOWED_FILES.has(f))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

describe("STEP2: no ZATCA left in the tree", () => {
  it("no file path under server, shared, client, tests or scripts mentions ZATCA or Fatoora", () => {
    const hits = trackedFiles(["server", "shared", "client/src", "tests", "scripts"]).filter((f) =>
      /zatca|fatoora/i.test(f)
    );
    expect(hits).toEqual([]);
  });

  it("no source text in server, shared or client/src mentions ZATCA, Fatoora or the Arabic names", () => {
    const hits: string[] = [];
    for (const f of trackedFiles(["server", "shared", "client/src"])) {
      if (!/\.(ts|tsx|js|mjs|cjs|json|css|html|sql|md|txt|xml|xsl|xslt|sch)$/i.test(f)) continue;
      const full = path.join(ROOT, f);
      if (fs.statSync(full).size > 4_000_000) continue;
      if (BANNED.test(fs.readFileSync(full, "utf8"))) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("no env example, package manifest or runbook line sets up the ZATCA environment", () => {
    for (const f of [".env.example", "package.json", "docs/release/SELF-HOSTING.md"]) {
      expect(fs.readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/ZATCA_|xml-crypto/);
    }
  });
});

function loadCatalog(dir: string): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  const base = path.join(ROOT, "client/src/locales", dir);
  for (const f of fs.readdirSync(base).filter((n) => n.endsWith(".json"))) {
    const json = JSON.parse(fs.readFileSync(path.join(base, f), "utf8")) as Record<string, string>;
    for (const [k, v] of Object.entries(json)) out.push([`${dir}/${f}`, k, String(v)]);
  }
  return out;
}

describe("STEP2: the catalogs (en, ar and the report overlay)", () => {
  const rows = ["en", "ar", "ar-catalog"].flatMap(loadCatalog);

  it("no key or value mentions ZATCA, Fatoora, the Arabic names or a standalone KSA", () => {
    const bad = rows.filter(([, k, v]) => BANNED.test(k) || BANNED.test(v) || /\bKSA\b/.test(v));
    expect(bad.map(([f, k]) => `${f}:${k}`)).toEqual([]);
  });

  it("no value pairs a 15% rate with Saudi Arabia", () => {
    const bad = rows.filter(
      ([, , v]) => /15\s?%|١٥\s?٪/.test(v) && /\bSaudi\b|KSA|السعودي/i.test(v)
    );
    expect(bad.map(([f, k]) => `${f}:${k}`)).toEqual([]);
  });

  it("Saudi appears only for the SAR currency and the legacy stored country", () => {
    const allowed = new Set([
      "pageLabels.sARSaudiRiyal",
      "pageLabels.companySettings.currency.SAR",
      "pageLabels.companySettings.country.SA",
      "adminConsole.curSAR",
    ]);
    const found = rows.filter(([, , v]) => /\bSaudi\b|السعود/.test(v)).map(([, k]) => k);
    expect(found.filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("the server issue slugs for the single UAE rate exist in en and ar", () => {
    for (const lang of ["en", "ar"]) {
      const json = JSON.parse(
        fs.readFileSync(path.join(ROOT, `client/src/locales/${lang}/serverErrors.json`), "utf8")
      ) as Record<string, string>;
      expect(json["serverErrors.issue.vat_rate_must_be_0_or_5"], lang).toBeTruthy();
      expect(json["serverErrors.issue.vat_rate_must_be_0_or_5_uae"], lang).toBeTruthy();
    }
  });
});

describe("STEP2: one VAT jurisdiction", () => {
  it("shared/vat-classification has no jurisdiction API", async () => {
    const vc = (await import("../../shared/vat-classification")) as Record<string, unknown>;
    expect(vc).not.toHaveProperty("STANDARD_VAT_RATES");
    expect(vc).not.toHaveProperty("vatJurisdictionForCountry");
    expect(vc).not.toHaveProperty("normaliseSupportedVatRate");
    expect(vc.UAE_STANDARD_VAT_RATE).toBe(0.05);
  });

  it("the invoice VAT rate validator refuses 15 and 0.15 and keeps 0 and 5", async () => {
    const { zInvoiceVatRate } = await import("../../shared/validators/invoices");
    expect(zInvoiceVatRate.safeParse(15).success).toBe(false);
    expect(zInvoiceVatRate.safeParse(0.15).success).toBe(false);
    expect(zInvoiceVatRate.safeParse(5)).toMatchObject({ success: true, data: 0.05 });
    expect(zInvoiceVatRate.safeParse(0)).toMatchObject({ success: true, data: 0 });
  });

  it("a KSA VAT number is refused as a company TRN; a UAE TRN is accepted", async () => {
    const { updateCompanyBody } = await import("../../shared/validators/companies");
    expect(updateCompanyBody.safeParse({ trnVatNumber: "300000000000003" }).success).toBe(false);
    expect(updateCompanyBody.safeParse({ trnVatNumber: "100000000000003" }).success).toBe(true);
  });

  it("the capability snapshot has no zatca capability", async () => {
    const { getCapabilitySnapshot } = await import("../../shared/capabilities");
    const snap = getCapabilitySnapshot();
    expect(snap.capabilities.map((c: { id: string }) => c.id)).not.toContain("zatca");
  });
});

let locale: "en" | "ar" = "en";
beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any;
});
beforeEach(() => {
  resetHarness();
});
afterEach(async () => {
  await unmountPage();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.setState({ locale: "en" });
});

async function setLocale(l: "en" | "ar") {
  locale = l;
  const { useI18n } = await import("../../client/src/lib/i18n");
  await act(async () => useI18n.setState({ locale: l }));
  await flush();
}

/** Open a Radix Select from the keyboard and return its option labels, then close it. */
async function optionsOf(trigger: Element | null): Promise<string[]> {
  if (!trigger) throw new Error("select trigger not found");
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
  });
  await flush();
  const labels = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();
  return labels;
}

describe.each(["en", "ar"] as const)("STEP2 rendered pages (%s)", (lang) => {
  it("the tax-rates page shows no Saudi note even for a legacy Saudi response", async () => {
    const { TaxRatesView } = await import("../../client/src/pages/settings/TaxRates");
    await setLocale(lang);
    const data = {
      standardRate: 0.05,
      emirate: "dubai",
      jurisdiction: "SA",
      rows: [
        { side: "sales", treatment: "standard", rate: 0.05, boxes: [] },
        { side: "purchases", treatment: "standard", rate: 0.05, boxes: [] },
      ],
    };
    await renderPage(TaxRatesView as never, { data });
    expect(document.querySelector('[role="note"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/KSA|Saudi|السعود|15\s?%|١٥/);
    expect(document.body.textContent).not.toMatch(BANNED);
    expect(locale).toBe(lang);
  });

  it("company settings (UAE company): no Saudi country and the default VAT offers only 0% and 5%", async () => {
    const { default: CompanySettings } = await import("../../client/src/pages/CompanySettings");
    setFixtures({
      [`/api/companies/${COMPANY_ID}`]: {
        id: COMPANY_ID,
        name: "Synthetic Trading",
        addressCountry: "AE",
        defaultVatRate: 0.05,
        locale: "en",
      },
    });
    await renderPage(CompanySettings);
    await setLocale(lang);
    const vat = await optionsOf(byTestId("select-default-vat-rate"));
    expect(vat).toHaveLength(2);
    expect(vat.join(" ")).toMatch(lang === "ar" ? /0/ : /0%/);
    expect(vat.join(" ")).not.toMatch(/15|١٥/);
    const countries = await optionsOf(byTestId("select-address-country"));
    expect(countries.length).toBeGreaterThan(3);
    expect(countries.join("|")).not.toMatch(/Saudi|السعود/);
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("company settings preserves the stored Saudi label while omitting it from the country options", async () => {
    const { default: CompanySettings } = await import("../../client/src/pages/CompanySettings");
    setFixtures({
      [`/api/companies/${COMPANY_ID}`]: {
        id: COMPANY_ID,
        name: "Synthetic Trading",
        addressCountry: "SA",
        defaultVatRate: 0.15,
        locale: "en",
      },
    });
    await renderPage(CompanySettings);
    await setLocale(lang);
    const vat = await optionsOf(byTestId("select-default-vat-rate"));
    expect(vat).toHaveLength(2);
    expect(vat.join(" ")).not.toMatch(/15|١٥/);
    const country = byTestId("select-address-country");
    expect(country?.textContent).toContain(
      lang === "ar" ? "المملكة العربية السعودية" : "Saudi Arabia"
    );
    const countries = await optionsOf(country);
    expect(countries.join("|")).not.toMatch(/Saudi|السعود/);
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("the e-invoicing settings page has no ZATCA link or text for a Saudi-address company", async () => {
    const { default: EInvoicingSettings } =
      await import("../../client/src/pages/EInvoicingSettings");
    activeCompany.current = { addressCountry: "SA" };
    setFixtures({
      [`/api/companies/${COMPANY_ID}/einvoicing/settings`]: {
        identity: {
          trn: "100000000000003",
          peppolParticipantId: null,
          peppolScheme: "0235",
          participantIdFallback: null,
          tradeLicenceNo: null,
          tradeLicenceAuthority: null,
          einvoicePayeeIban: null,
          einvoicePaymentMeansCode: null,
        },
        scope: {
          scope: null,
          band: null,
          goLiveDate: null,
          appointAspBy: null,
          mandatory: false,
          daysToGoLive: null,
        },
        asp: {
          capability: { status: "requires_external", externalAction: { en: "x", ar: "x" } },
          configured: false,
          connected: false,
          provider: { name: null, environment: null, error: null },
        },
        inbound: { enabled: false, endpoint: "" },
        validation: { xsd: true, schematron: true, schematronVersion: "2026.5" },
      },
    });
    await renderPage(EInvoicingSettings);
    await setLocale(lang);
    expect(document.querySelector('a[href="/settings/zatca"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(BANNED);
  });
});

describe("STEP2: routes", () => {
  it("the client route table and nav have no /settings/zatca", () => {
    for (const f of ["client/src/App.tsx", "client/src/components/layout/nav-config.ts"]) {
      expect(fs.readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/settings\/zatca/);
    }
  });
});
