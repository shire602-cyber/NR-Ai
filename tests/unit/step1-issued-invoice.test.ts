// @vitest-environment jsdom
/**
 * Step 1 / S1: an issued invoice opens as a read-only document (status, PDF, share, record
 * payment, credit note, make recurring) with only the fields the server lets it change; every
 * failed call reads in the user's language and never shows raw server English or a field id.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  apiCalls,
  byTestId,
  click,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import {
  failedResponseMessage,
  localizeApiError,
  localizeApiErrorByStatus,
} from "../../client/src/lib/validation-messages";

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

const C = `/api/companies/${COMPANY_ID}`;
const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

const ISSUED = {
  id: "e0000000-0000-4000-8000-0000000000aa",
  companyId: COMPANY_ID,
  number: "INV-2026-00001",
  customerName: "Gulf Retail LLC",
  customerTrn: "100123456700003",
  placeOfSupplyEmirate: "dubai",
  paymentTerms: "net30",
  date: "2026-03-01",
  dueDate: "2026-03-31",
  currency: "AED",
  status: "sent",
  invoiceType: "invoice",
  subtotal: 1000,
  vatAmount: 50,
  total: 1050,
  notes: "Thank you",
  lines: [
    {
      description: "Consulting",
      quantity: 1,
      unitPrice: 1000,
      vatRate: 0.05,
      vatSupplyType: "standard_rated",
    },
  ],
};

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
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
  useI18n.setState({ locale: "en" });
  window.history.replaceState({}, "", "/");
});
afterEach(async () => {
  await unmountPage();
  useI18n.setState({ locale: "en" });
  window.history.replaceState({}, "", "/");
});

async function openIssued() {
  setFixtures({
    [`${C}/invoices?limit=50`]: { items: [ISSUED], nextCursor: null },
    [`/api/invoices/${ISSUED.id}`]: ISSUED,
    [`${C}/einvoicing/compliance`]: { items: [] },
    [`${C}/einvoicing/documents`]: { items: [] },
  });
  window.history.replaceState({}, "", `/invoices?open=${ISSUED.id}`);
  const { default: Invoices } = await import("../../client/src/pages/Invoices");
  await renderPage(Invoices);
  await flushUntil(() => !!byTestId("issued-invoice-actions"));
}

describe("S1 an issued invoice is a read-only document", () => {
  it("shows the document and the actions, and none of the locked inputs", async () => {
    await openIssued();
    expect(byTestId("issued-invoice-locked")).not.toBeNull();
    await flushUntil(
      () => !!byTestId("issued-invoice-document")?.textContent?.includes("Consulting")
    );
    expect(byTestId("issued-invoice-document")?.textContent).toContain("INV-2026-00001");
    expect(byTestId("issued-invoice-document")?.textContent).toContain("Consulting");
    for (const id of [
      "button-issued-download-pdf",
      "button-issued-share",
      "button-issued-add-payment",
      "button-issued-credit-note",
      "button-issued-make-recurring",
    ]) {
      expect(byTestId(id), id).not.toBeNull();
    }
    // Customer, date, currency and lines are not editable.
    for (const id of [
      "input-customer-name",
      "input-customer-trn",
      "button-date-picker",
      "input-line-description-0",
      "button-add-line",
      "select-invoice-contact",
    ]) {
      expect(byTestId(id), id).toBeNull();
    }
    // The allowed edits stay.
    expect(byTestId("input-invoice-notes")).not.toBeNull();
    expect((byTestId("button-submit-invoice") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves only notes, terms, due date and language (never a locked field)", async () => {
    await openIssued();
    await type(byTestId("input-invoice-notes"), "Pay within 14 days");
    expect((byTestId("button-submit-invoice") as HTMLButtonElement).disabled).toBe(false);
    await submit(byTestId("button-submit-invoice"));
    const puts = apiCalls("PUT").filter((c) => c.url === `/api/invoices/${ISSUED.id}`);
    expect(puts).toHaveLength(1);
    const body = JSON.parse(JSON.stringify(puts[0].body));
    expect(Object.keys(body).sort()).toEqual([
      "documentLanguage",
      "dueDate",
      "notes",
      "paymentTerms",
    ]);
    expect(body.notes).toContain("Pay within 14 days");
  });

  it("the actions open the seeded editors", async () => {
    await openIssued();
    await click(byTestId("button-issued-credit-note"));
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      `/credit-notes/new?invoiceId=${ISSUED.id}`
    );
  });
});

describe("S1 server errors read in the user's language", () => {
  const body409 = {
    code: "INVOICE_ISSUED_IMMUTABLE",
    message: "An issued invoice cannot be changed. Issue a credit note instead.",
    details: { fields: ["customerName"], hint: "Issue a credit note" },
  };

  it("the issued-invoice 409 has catalog copy in Arabic with no field id", () => {
    useI18n.setState({ locale: "ar" });
    const text = localizeApiError(body409)!;
    expect(text).toMatch(ARABIC);
    expect(text).not.toContain("customerName");
    expect(text).not.toMatch(LATIN_WORD);
  });

  it("an unmapped code falls back to a sentence for its status, never raw English", () => {
    useI18n.setState({ locale: "ar" });
    for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500, 503, 418]) {
      const text = localizeApiErrorByStatus(status, "Some raw server English")!;
      expect(text, String(status)).toMatch(ARABIC);
      expect(text, String(status)).not.toMatch(LATIN_WORD);
    }
    // Arabic server text passes through; English mode keeps the server text.
    expect(localizeApiErrorByStatus(409, "نص عربي")).toBeUndefined();
    useI18n.setState({ locale: "en" });
    expect(localizeApiErrorByStatus(409, "Some raw server English")).toBeUndefined();
  });

  it("a failed file download is localised too", async () => {
    useI18n.setState({ locale: "ar" });
    const text = await failedResponseMessage(
      404,
      { message: "Invoice not found" },
      "Invoice not found"
    );
    expect(text).toMatch(ARABIC);
    expect(text).not.toMatch(LATIN_WORD);
    expect(await failedResponseMessage(409, body409, body409.message)).not.toContain(
      "customerName"
    );
  });
});
