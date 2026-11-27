// @vitest-environment jsdom
/**
 * Loop2: the journal "posted" toast and Google Sheets report export names follow the user's language,
 * and export names never contain characters reserved in file names.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  byTestId,
  click,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  COMPANY_ID,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";
import {
  reportExportBaseName,
  safeExportFileName,
  type ExportNameReport,
} from "../../client/src/lib/export-file-name";

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }), toast }));
vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
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

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
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
  queryClient.clear();
  toast.mockClear();
  useI18n.setState({ locale: "en" });
});
afterEach(async () => {
  await unmountPage();
  window.history.replaceState({}, "", "/");
});

const DRAFT = { id: "j1", status: "draft", lifecycleStatus: "draft", lines: [] };

async function postDraftAndGetToast(locale: "en" | "ar") {
  useI18n.setState({ locale });
  setFixtures({ [`/api/companies/${COMPANY_ID}/journal`]: [DRAFT] });
  const { default: Journal } = await import("../../client/src/pages/Journal");
  await renderPage(Journal);
  await flushUntil(() => !!byTestId("button-post-journal-j1"));
  await click(byTestId("button-post-journal-j1"));
  await flushUntil(() => toast.mock.calls.length > 0);
  return toast.mock.calls[0][0] as { title: string; description: string };
}

describe("journal posted toast", { timeout: 60_000 }, () => {
  it("shows English copy in en", async () => {
    const t = await postDraftAndGetToast("en");
    expect(t.title).toBe("Entry posted");
    expect(t.description).toContain("immutable");
  });
  it("shows Arabic copy in ar (no English leaks)", async () => {
    const t = await postDraftAndGetToast("ar");
    expect(t.title).toMatch(/[؀-ۿ]/);
    expect(t.description).toMatch(/[؀-ۿ]/);
    expect(t.title).not.toMatch(/posted/i);
    expect(t.description).not.toMatch(/immutable/i);
  });
});

describe("report export names", () => {
  const RESERVED = /[\\/:*?"<>|]/;
  const IDS: ExportNameReport[] = ["ar-aging", "ap-aging", "invoice-status", "balance-reports"];

  it("English names are filesystem-safe and use the catalog label", () => {
    useI18n.setState({ locale: "en" });
    const names = IDS.map(reportExportBaseName);
    expect(names).toEqual(["A-R Aging", "A-P Aging", "Invoice Status", "Balance Reports"]);
    for (const n of names) expect(n).not.toMatch(RESERVED);
  });
  it("Arabic names come from the Arabic catalog and are filesystem-safe", () => {
    useI18n.setState({ locale: "ar" });
    const names = IDS.map(reportExportBaseName);
    expect(names).toEqual([
      "أعمار الذمم المدينة",
      "أعمار الذمم الدائنة",
      "حالة الفواتير",
      "تقارير الأرصدة",
    ]);
    for (const n of names) expect(n).not.toMatch(RESERVED);
  });
  it("replaces every reserved character", () => {
    const input = ["a", "b/c:d*e?f", '"g<h>i|j'].join(String.fromCharCode(92));
    expect(safeExportFileName(input)).toBe("a-b-c-d-e-f-g-h-i-j");
  });
});
