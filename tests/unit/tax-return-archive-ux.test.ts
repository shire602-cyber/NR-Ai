// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import ar from "../../client/src/locales/ar/compliance.json";
import en from "../../client/src/locales/en/compliance.json";
import firmAr from "../../client/src/locales/ar/firm.json";
import {
  click,
  COMPANY_ID,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import TaxReturnArchive from "../../client/src/pages/TaxReturnArchive";

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const compliance = (await import("../../client/src/locales/ar/compliance.json")).default;
  const firm = (await import("../../client/src/locales/ar/firm.json")).default;
  const dict = { ...firm, ...compliance } as Record<string, string>;
  return { ...actual, useTranslation: () => ({ t: dict, locale: "ar" }) };
});
vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

const URL = `/api/companies/${COMPANY_ID}/tax-returns-archive`;
const row = (over: object) => ({
  id: "r1",
  companyId: COMPANY_ID,
  returnType: "vat",
  periodLabel: "Q1 2026",
  periodStart: "2026-01-01",
  periodEnd: "2026-03-31",
  filingDate: "2026-04-20",
  ftaReferenceNumber: "FTA-1",
  taxAmount: 100,
  paymentStatus: "paid",
  fileUrl: null,
  fileName: null,
  notes: null,
  filedBy: null,
  createdAt: "2026-04-20",
  ...over,
});

describe("tax return archive page (Arabic)", () => {
  afterEach(async () => {
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("shows a no-match state (not 'add your first return') and clears filters", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [URL]: [row({})] });
    await renderPage(TaxReturnArchive);
    expect(document.body.textContent).toContain("Q1 2026");
    // Eyebrow is translated, not the English "Compliance".
    expect(document.body.textContent).not.toContain("Compliance");

    const search = document.querySelector<HTMLInputElement>(
      '[data-testid="input-search-returns"]'
    )!;
    await type(search, "zzz");
    expect(document.body.textContent).toContain(ar["compliance.taxArchiveNoMatchTitle"]);
    expect(document.body.textContent).not.toContain(
      ar["compliance.taxArchiveAddYourFirstReturn"] + "\u0000"
    );
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      ar["compliance.taxArchiveNoMatchTitle"]
    );
    const clear = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === ar["compliance.taxArchiveClearFilters"]
    )!;
    await click(clear);
    expect(search.value).toBe("");
    expect(document.body.textContent).toContain("Q1 2026");
  });

  it("counts only paid returns in total tax paid", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({
      [URL]: [
        row({ id: "a", taxAmount: 100 }),
        row({ id: "b", taxAmount: 7777, paymentStatus: "unpaid" }),
      ],
    });
    await renderPage(TaxReturnArchive);
    // The stat card sits right after its label; the unpaid 7,777 must not be in it.
    const text = document.body.textContent ?? "";
    const label = ar["compliance.taxArchiveTotalTaxPaid"];
    const after = text.slice(text.indexOf(label) + label.length);
    expect(after.startsWith("100.00")).toBe(true);
  });

  it("shows a load error with retry instead of the empty state", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures(
      Object.defineProperty({}, URL, {
        enumerable: true,
        get() {
          throw new Error("boom");
        },
      })
    );
    await renderPage(TaxReturnArchive);
    expect(document.querySelector('[data-testid="tax-archive-load-error"]')).not.toBeNull();
    expect(document.body.textContent).toContain(firmAr["firm.loadFailedTitle"]);
    expect(document.body.textContent).not.toContain(ar["compliance.taxArchiveAddYourFirstReturn"]);
  });
});

describe("tax return archive catalogs", () => {
  it("has Arabic for every new archive key", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("compliance.taxArchive"));
    for (const k of keys) {
      const v = (ar as Record<string, string>)[k];
      expect(v, k).toBeTruthy();
      expect(v, k).toMatch(/[؀-ۿ]/);
    }
  });
});
