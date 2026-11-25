// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  pickOption,
  renderPage,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import PartyStatements from "../../client/src/pages/reports/PartyStatements";

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const dict = (await import("../../client/src/locales/ar/reportCenter.json")).default;
  return { ...actual, useTranslation: () => ({ t: dict as Record<string, string>, locale: "ar" }) };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/lib/queryClient", async () => {
  const base = formHarnessQueryClientMock();
  const inner = base.apiRequest.getMockImplementation()!;
  return {
    ...base,
    apiRequest: vi.fn(async (method: string, url: string, body?: unknown) => {
      if (url.includes("/supplier-statements/")) throw new Error("boom: raw server detail");
      return inner(method, url, body);
    }),
  };
});

(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView ??= () => {};

const base = `/api/companies/${COMPANY_ID}`;

describe("party statements screen (Arabic)", () => {
  afterEach(async () => {
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("explains an empty customer list instead of an empty dropdown", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [`${base}/customer-contacts`]: [] });
    await renderPage(PartyStatements);
    expect(document.body.textContent).toContain("لا يوجد عملاء بعد");
  });

  it("labels opening/closing balances and shows a no-documents note for an empty period", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({
      [`${base}/customer-contacts`]: [{ id: "c1", name: "Al Noor" }],
      [`${base}/customer-statements/c1`]: {
        party: { id: "c1", name: "Al Noor", email: null },
        from: null,
        asOf: "2026-11-25",
        sections: [{ currency: "AED", openingBalance: 0, closingBalance: 0, lines: [] }],
      },
    });
    await renderPage(PartyStatements);
    await pickOption(document.querySelector('[data-testid="select-statement-party"]'), "Al Noor");
    await flushUntil(() => !!document.querySelector('[data-testid="card-party-statement"]'));
    const text = document.body.textContent ?? "";
    expect(text).toContain("الرصيد الافتتاحي");
    expect(text).toContain("الرصيد الختامي");
    expect(text).toContain("لا توجد مستندات لهذه الفترة");
    expect(document.querySelector("table")).toBeNull();
    expect(text).not.toContain("2026-11-25");
  });

  it("shows a translated retryable error, not the raw message, when the statement fails", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [`${base}/vendors`]: [{ id: "v1", name: "Gulf Supplies" }] });
    await renderPage(PartyStatements);
    await pickOption(document.querySelector('[data-testid="select-statement-kind"]'), "مورد");
    await pickOption(
      document.querySelector('[data-testid="select-statement-party"]'),
      "Gulf Supplies"
    );
    await flushUntil(() => !!document.querySelector('[data-testid="party-statement-error"]'));
    expect(document.body.textContent).not.toContain("raw server detail");
  });
});
