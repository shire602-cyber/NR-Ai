// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  byTestId,
  click,
  COMPANY_ID,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import DocumentVault from "../../client/src/pages/DocumentVault";

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const dict = (await import("../../client/src/locales/ar/documentsEvidence.json")).default;
  return { ...actual, useTranslation: () => ({ t: dict as Record<string, string>, locale: "ar" }) };
});
vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

const doc = (over: Record<string, unknown>) => ({
  id: "d1",
  companyId: COMPANY_ID,
  name: "Trade licence 2026",
  nameAr: "الرخصة التجارية ٢٠٢٦",
  category: "trade_license",
  description: null,
  fileUrl: "/api/documents/00000000-0000-4000-8000-000000000001/download",
  fileName: "licence.pdf",
  fileSize: 10,
  mimeType: "application/pdf",
  expiryDate: null,
  reminderDays: 30,
  reminderSent: false,
  tags: null,
  isArchived: false,
  uploadedBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("document vault search", () => {
  afterEach(async () => {
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("matches the Arabic name, announces no matches in Arabic, and clears filters", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [`/api/companies/${COMPANY_ID}/documents`]: [doc({})] });
    await renderPage(DocumentVault);
    const search = byTestId("input-search-documents") as HTMLInputElement;

    await type(search, "الرخصة");
    expect(document.querySelector("tbody")?.textContent).toContain("licence.pdf");

    await type(search, "zzz");
    expect(document.querySelector("tbody")).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe("لا توجد مستندات مطابقة");
    expect(document.body.textContent).not.toContain("Upload your first document");

    await click(byTestId("button-clear-document-filters"));
    expect(document.querySelector("tbody")?.textContent).toContain("licence.pdf");
  });

  it("shows the first-run empty state when every document is archived", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [`/api/companies/${COMPANY_ID}/documents`]: [doc({ isArchived: true })] });
    await renderPage(DocumentVault);
    expect(byTestId("button-upload-first-document")).toBeTruthy();
    expect(byTestId("input-search-documents")).toBeNull();
  });
});
