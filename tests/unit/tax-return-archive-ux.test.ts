// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { act } from "react";
import ar from "../../client/src/locales/ar/compliance.json";
import corporateTaxAr from "../../client/src/locales/ar/corporateTax.json";
import en from "../../client/src/locales/en/compliance.json";
import firmAr from "../../client/src/locales/ar/firm.json";
import {
  byTestId,
  click,
  COMPANY_ID,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  pickDate,
  renderPage,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import TaxReturnArchive from "../../client/src/pages/TaxReturnArchive";
import { apiRequest, queryClient } from "../../client/src/lib/queryClient";

/** When set, replaces the fixture-backed archive loader so a test can control each response. */
const archive = vi.hoisted(() => ({ load: null as null | (() => Promise<unknown>) }));

/** When `missing`, the company lookup has no company cached (loading, or paused when offline). */
const companyLookup = vi.hoisted(() => ({ missing: false, paused: false }));

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  // The app's own Arabic catalog (base keys plus every namespace), so a shared key the page
  // reads renders as in production, and an absent one renders nothing.
  await actual.loadLocale("ar");
  return { ...actual, useTranslation: () => ({ t: actual.t.ar, locale: "ar" }) };
});
vi.mock("../../client/src/lib/queryClient", () => {
  const mock = formHarnessQueryClientMock();
  const fromFixtures = mock.getQueryFn();
  return {
    ...mock,
    getQueryFn: () => (context: { queryKey: readonly unknown[] }) =>
      archive.load ? archive.load() : fromFixtures(context),
  };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => {
  const base = formHarnessCompanyMock();
  return {
    useDefaultCompany: () => {
      const company = base.useDefaultCompany();
      return companyLookup.missing
        ? {
            ...company,
            company: undefined,
            companyId: undefined,
            companies: [],
            isLoading: !companyLookup.paused,
            isPaused: companyLookup.paused,
          }
        : { ...company, isPaused: false };
    },
  };
});

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

const buttonLabelled = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
const addFirstButton = () => buttonLabelled(ar["compliance.taxArchiveAddYourFirstReturn"]);

async function refresh() {
  await act(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["/api/companies", COMPANY_ID, "tax-returns-archive"],
      exact: true,
    });
  });
  await flush();
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("tax return archive page (Arabic)", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(async () => {
    await unmountPage();
    onlineManager.setOnline(true);
    archive.load = null;
    companyLookup.missing = false;
    companyLookup.paused = false;
    vi.unstubAllGlobals();
  });

  it("shows waiting instead of the skeleton while the company lookup is paused", async () => {
    const load = vi.fn(async () => [row({})]);
    archive.load = load;
    companyLookup.missing = true;
    companyLookup.paused = true;
    await renderPage(TaxReturnArchive);
    expect(byTestId("tax-archive-waiting")?.textContent).toContain(
      ar["compliance.taxArchiveWaitingTitle"]
    );
    expect(document.querySelector(".skeleton-shimmer")).toBeNull();
    expect(byTestId("button-add-return")).toBeNull();
    expect(addFirstButton()).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps the skeleton while the company lookup is loading and not paused", async () => {
    companyLookup.missing = true;
    await renderPage(TaxReturnArchive);
    expect(byTestId("tax-archive-waiting")).toBeNull();
    expect(document.querySelector(".skeleton-shimmer")).not.toBeNull();
  });

  it("keeps cached rows usable and shows waiting when a refresh is paused", async () => {
    archive.load = async () => [row({ fileUrl: "/uploads/a.pdf", fileName: "a.pdf" })];
    await renderPage(TaxReturnArchive);
    onlineManager.setOnline(false);
    await refresh();
    expect(byTestId("tax-archive-waiting")?.textContent).toContain(
      ar["compliance.taxArchiveWaitingTitle"]
    );
    expect(byTestId("row-return-r1")).not.toBeNull();
    expect(byTestId("input-search-returns")).not.toBeNull();
    expect(byTestId("button-view-r1")).not.toBeNull();
    expect(byTestId("button-download-r1")).not.toBeNull();

    archive.load = async () => [row({ periodLabel: "Q2 2026" })];
    await act(async () => onlineManager.setOnline(true));
    await flush();
    expect(byTestId("tax-archive-waiting")).toBeNull();
    expect(document.body.textContent).toContain("Q2 2026");
  });

  it("hides 'add your first return' after a first save until the paused refresh resolves", async () => {
    archive.load = async () => [];
    await renderPage(TaxReturnArchive);
    expect(addFirstButton()).toBeDefined();

    await click(byTestId("button-add-return"));
    await type(byTestId("input-period-label"), "Q1 2026");
    await pickDate(byTestId("input-period-start"), 1);
    await pickDate(byTestId("input-period-end"), 28);
    await pickDate(byTestId("input-filing-date"), 28);
    // The save succeeds, then the connection drops before the refresh can start.
    vi.mocked(apiRequest).mockImplementationOnce(async () => {
      onlineManager.setOnline(false);
      return new Response(JSON.stringify({ id: "r1" }));
    });
    await click(byTestId("button-confirm-add"));
    expect(apiRequest).toHaveBeenCalledWith("POST", URL, expect.anything());
    // The save completed: the dialog closed even though the refresh is paused.
    expect(byTestId("input-period-label")).toBeNull();

    expect(byTestId("tax-archive-waiting")).not.toBeNull();
    expect(addFirstButton()).toBeUndefined();
    expect(document.querySelector("table")).toBeNull();

    // Back online: the resumed GET is in flight, so the list is still unresolved.
    let finish!: (rows: unknown[]) => void;
    archive.load = () => new Promise((resolve) => (finish = resolve));
    await act(async () => onlineManager.setOnline(true));
    await flush();
    expect(byTestId("tax-archive-waiting")).toBeNull();
    expect(addFirstButton()).toBeUndefined();

    await act(async () => finish([row({ periodLabel: "Saved return" })]));
    await flush();
    expect(addFirstButton()).toBeUndefined();
    expect(document.body.textContent).toContain("Saved return");
  });

  it("shows waiting (no add-first CTA) when offline, then loads on reconnect", async () => {
    const load = vi.fn(async () => [row({})]);
    archive.load = load;
    onlineManager.setOnline(false);
    await renderPage(TaxReturnArchive);
    expect(byTestId("tax-archive-waiting")?.textContent).toContain(
      ar["compliance.taxArchiveWaitingTitle"]
    );
    expect(addFirstButton()).toBeUndefined();
    expect(document.querySelector("table")).toBeNull();
    expect(load).not.toHaveBeenCalled();

    await act(async () => onlineManager.setOnline(true));
    await flush();
    expect(byTestId("tax-archive-waiting")).toBeNull();
    expect(document.body.textContent).toContain("Q1 2026");
  });

  it("recovers from an initial load error through Retry", async () => {
    archive.load = async () => {
      throw httpError(500);
    };
    await renderPage(TaxReturnArchive);
    expect(byTestId("tax-archive-load-error")).not.toBeNull();
    expect(addFirstButton()).toBeUndefined();

    archive.load = async () => [row({})];
    await click(buttonLabelled(firmAr["firm.retry"])!);
    expect(byTestId("tax-archive-load-error")).toBeNull();
    expect(document.body.textContent).toContain("Q1 2026");
  });

  it("offers 'add your first return' for a successful empty result", async () => {
    archive.load = async () => [];
    await renderPage(TaxReturnArchive);
    expect(addFirstButton()).toBeDefined();
    expect(document.querySelector("table")).toBeNull();
    // A label shared with another namespace: empty here if its key goes missing.
    expect(byTestId("button-add-return")?.textContent?.trim()).toBe(
      corporateTaxAr["corporateTax.externalAdd"]
    );
  });

  it("keeps cached rows, filters and file actions after a failed refresh", async () => {
    archive.load = async () => [row({ fileUrl: "/uploads/a.pdf", fileName: "a.pdf" })];
    await renderPage(TaxReturnArchive);
    archive.load = async () => {
      throw httpError(500);
    };
    await refresh();
    expect(byTestId("tax-archive-refresh-error")?.textContent).toContain(
      ar["compliance.taxArchiveRefreshFailed"]
    );
    expect(byTestId("tax-archive-load-error")).toBeNull();
    expect(byTestId("row-return-r1")?.textContent).toContain("مارس");
    expect(byTestId("input-search-returns")).not.toBeNull();
    expect(byTestId("select-type-filter")).not.toBeNull();
    expect(byTestId("button-view-r1")).not.toBeNull();
    expect(byTestId("button-download-r1")).not.toBeNull();
    expect(document.body.textContent).toContain(ar["compliance.taxArchiveTotalTaxPaid"]);

    archive.load = async () => [row({ periodLabel: "Q2 2026" })];
    await click(byTestId("button-retry-refresh"));
    expect(byTestId("tax-archive-refresh-error")).toBeNull();
    expect(document.body.textContent).toContain("Q2 2026");
  });

  it("does not present a cached empty list as current after a failed refresh", async () => {
    archive.load = async () => [];
    await renderPage(TaxReturnArchive);
    archive.load = async () => {
      throw httpError(500);
    };
    await refresh();
    expect(byTestId("tax-archive-refresh-error")).not.toBeNull();
    expect(addFirstButton()).toBeUndefined();
    expect(document.querySelector("table")).toBeNull();
  });

  it("replaces cached rows with access denied on a 403", async () => {
    archive.load = async () => [row({ fileUrl: "/uploads/a.pdf" })];
    await renderPage(TaxReturnArchive);
    archive.load = async () => {
      throw httpError(403);
    };
    await refresh();
    expect(byTestId("tax-archive-load-error")?.textContent).toContain(
      firmAr["firm.loadForbiddenTitle"]
    );
    expect(byTestId("row-return-r1")).toBeNull();
    expect(byTestId("button-view-r1")).toBeNull();
    expect(byTestId("button-download-r1")).toBeNull();
    expect(byTestId("tax-archive-refresh-error")).toBeNull();
    expect(buttonLabelled(firmAr["firm.retry"])).toBeUndefined();
    expect(document.body.textContent).not.toContain(ar["compliance.taxArchiveTotalTaxPaid"]);
  });

  it("shows a no-match state (not 'add your first return') and clears filters", async () => {
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
    expect(addFirstButton()).toBeUndefined();
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
