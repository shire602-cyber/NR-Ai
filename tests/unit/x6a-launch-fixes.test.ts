// @vitest-environment jsdom
/**
 * X6a: launch fixes from the CTO council launch review. Behaviour tests for the client pieces
 * and the pure server rules; the DB-backed flows are in tests/db/x6a-launch-fixes.test.ts.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { InvoicePreview } from "../../client/src/components/invoices/InvoicePreview";
import {
  blankInvoiceLine,
  isUntouchedBlankLine,
  isVatRegisteredCompany,
} from "../../client/src/lib/invoice-defaults";
import { VatInputTrnWarnings } from "../../client/src/components/vat/VatInputTrnWarnings";
import { CashMovement } from "../../client/src/pages/dashboard/PlanningWidgets";
import {
  DELIVERY_TONE,
  errorKey,
  deliveryLabelKey,
} from "../../client/src/components/einvoice/einvoice-meta";
import { complyanceDocumentBelongsTo } from "../../server/services/einvoice/providers/complyance";
import {
  blockingIssues,
  inputVatWithoutSupplierTrn,
  type VatContribution,
} from "../../server/tax/vat-engine";
import { legacyFromTracks, isDeliveryInFlight } from "../../server/services/einvoice/tracks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The cash chart's ResponsiveContainer needs a ResizeObserver (jsdom has none).
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let container: HTMLDivElement;
let root: Root;
beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
});
beforeEach(() => {
  useI18n.setState({ locale: "en" } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});
const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
};

const catalog = (locale: string, ns: string) =>
  JSON.parse(
    readFileSync(resolve(__dirname, `../../client/src/locales/${locale}/${ns}.json`), "utf8")
  ) as Record<string, string>;

describe("[X6a REQUIRED 2] a company without a TRN is not VAT registered", () => {
  it("new invoice lines start at 0% out of scope without a TRN and at 5% standard with one", () => {
    expect(isVatRegisteredCompany({ trnVatNumber: null })).toBe(false);
    expect(isVatRegisteredCompany({ trnVatNumber: "  " })).toBe(false);
    expect(isVatRegisteredCompany({ trnVatNumber: "100000000000003" })).toBe(true);
    expect(blankInvoiceLine(false)).toMatchObject({ vatRate: 0, vatSupplyType: "out_of_scope" });
    expect(blankInvoiceLine(true)).toMatchObject({
      vatRate: 0.05,
      vatSupplyType: "standard_rated",
    });
    expect(isUntouchedBlankLine(blankInvoiceLine(true))).toBe(true);
    expect(isUntouchedBlankLine({ description: "Consulting", unitPrice: 0 })).toBe(false);
  });

  const props = {
    sellerName: "Synthetic Trading LLC",
    number: null,
    date: new Date("2026-03-15T00:00:00Z"),
    customerName: "Gulf Horizon Logistics",
    customerTrn: null,
    placeOfSupply: "Dubai",
    currency: "AED",
    lines: [
      { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0, lineTotal: 1000 },
    ],
    subtotal: 1000,
    vatAmount: 0,
    total: 1000,
    ratesLabel: "0%",
  };

  it("the live preview is titled 'Invoice' (فاتورة) without a seller TRN, 'Tax invoice' with one", async () => {
    await render(createElement(InvoicePreview, { ...props, sellerTrn: null }));
    const text = container.textContent ?? "";
    expect(text).toContain("Invoice");
    expect(text).toContain("فاتورة");
    expect(text).not.toContain("Tax invoice");
    expect(text).not.toContain("فاتورة ضريبية");
    await render(createElement(InvoicePreview, { ...props, sellerTrn: "100000000000003" }));
    expect(container.textContent).toContain("Tax invoice");
  });

  it("the refusal toast copy exists in English and Arabic and does not claim VAT registration", () => {
    const en = catalog("en", "invoices");
    const ar = catalog("ar", "invoices");
    expect(en["invoices.noTrnVatBody"]).toMatch(/cannot charge VAT/);
    expect(en["invoices.noTrnVatBody"]).not.toMatch(/is VAT registered/);
    expect(ar["invoices.noTrnVatBody"]).toMatch(/[؀-ۿ]/);
  });
});

describe("[X6a REQUIRED 7] bank vs GL card", () => {
  const stats = (accounts: unknown[]) =>
    ({
      cashInOut: [],
      bankVsGl: { glCashTotal: 0, statementTotal: 0, accounts },
    }) as never;

  it("says 'No statement imported' and shows no difference badge when no statement exists", async () => {
    await render(
      createElement(CashMovement, {
        stats: stats([
          {
            bankAccountId: "b1",
            name: "Emirates NBD",
            currency: "AED",
            hasStatement: false,
            statementBalance: null,
            glBalance: 2835,
            difference: null,
          },
        ]),
        loading: false,
        locale: "en",
      })
    );
    const row = container.querySelector('[data-testid="bank-vs-gl-no-statement-b1"]');
    expect(row?.textContent).toBe("No statement imported");
    expect(
      container.querySelector('[data-testid="dashboard-bank-vs-gl"]')?.textContent
    ).not.toMatch(/\+/);
  });

  it("shows a USD account in USD", async () => {
    await render(
      createElement(CashMovement, {
        stats: stats([
          {
            bankAccountId: "u1",
            name: "ENBD USD",
            currency: "USD",
            hasStatement: true,
            statementBalance: 1000,
            glBalance: 1000,
            difference: 0,
          },
        ]),
        loading: false,
        locale: "en",
      })
    );
    const card = container.querySelector('[data-testid="dashboard-bank-vs-gl"]')!;
    expect(card.textContent).toContain("USD");
    expect(card.textContent).not.toContain("AED");
  });
});

describe("[X6a e-invoicing 2] Complyance link: the document must be this company's", () => {
  const me = {
    tin: "1001234567",
    trn: "100123456700003",
    connectCompanyId: "66b9f0a1c2d3e4f567890123",
    sourceName: "muhasib-abc",
  };

  it("accepts a document whose source matches and refuses another tenant's source", () => {
    expect(complyanceDocumentBelongsTo({ source: "muhasib-abc:v1" }, me).ok).toBe(true);
    const other = complyanceDocumentBelongsTo({ source: "muhasib-xyz:v1" }, me);
    expect(other).toMatchObject({ ok: false, mismatched: ["source"] });
  });

  it("checks the Connect company and seller tax ids when present; every identity must match", () => {
    expect(
      complyanceDocumentBelongsTo(
        { attribution: { companyId: me.connectCompanyId }, seller: { tin: "0235:1001234567" } },
        me
      ).ok
    ).toBe(true);
    expect(
      complyanceDocumentBelongsTo(
        {
          source: "muhasib-abc:v1",
          invoice: { parties: { seller: { taxIds: ["100999999900003"] } } },
        },
        me
      )
    ).toMatchObject({ ok: false, mismatched: ["sellerTaxId"] });
  });

  it("refuses a document that names no seller at all", () => {
    expect(complyanceDocumentBelongsTo({ documentNumber: "INV-1" }, me)).toMatchObject({
      ok: false,
      checked: [],
    });
  });
});

describe("[X6a e-invoicing 3] 'needs link' is its own delivery state", () => {
  it("is in flight for legacy readers (never retried or resent), amber, and localised", () => {
    expect(legacyFromTracks("needs_link", "pending")).toBe("submitted");
    expect(isDeliveryInFlight("needs_link")).toBe(true);
    expect(DELIVERY_TONE.needs_link).toBe("warning");
    expect(errorKey("EINVOICE_NEEDS_LINK")).toBe("einvoicing.err_EINVOICE_NEEDS_LINK");
    for (const locale of ["en", "ar"]) {
      const c = catalog(locale, "einvoicing");
      for (const k of [
        deliveryLabelKey("needs_link"),
        "einvoicing.err_EINVOICE_NEEDS_LINK",
        "einvoicing.needsLinkTitle",
        "einvoicing.needsLinkBody",
      ]) {
        expect(c[k], `${locale} ${k}`).toBeTruthy();
        if (locale === "ar") expect(c[k]).toMatch(/[؀-ۿ]/);
      }
      expect(c["einvoicing.needsLinkBody"]).toContain("{provider}");
      expect(c["einvoicing.needsLinkBody"]).toContain(locale === "en" ? "portal" : "بوابة");
    }
  });
});

describe("[X6a beat 6] input VAT without a supplier TRN", () => {
  const contribution = (over: Partial<VatContribution>): VatContribution => ({
    sourceType: "bill",
    sourceId: "b1",
    reference: "B-1",
    date: "2026-08-12",
    counterparty: "Corner Shop",
    counterpartyTrn: null,
    emirate: null,
    family: "purchase",
    boxes: { box9ExpensesVat: 5000 },
    category: "purchases",
    inLedger: true,
    ...over,
  });

  it("warns for bills and receipts claiming Box 9 VAT with no valid TRN, once per document", () => {
    const issues = inputVatWithoutSupplierTrn([
      contribution({}),
      contribution({}),
      contribution({ sourceId: "b2", counterpartyTrn: "100000000000003" }),
      contribution({ sourceId: "b3", counterpartyTrn: "12345" }),
      contribution({ sourceId: "r1", sourceType: "receipt" }),
      contribution({ sourceId: "b4", boxes: { box9ExpensesVat: 0 } }),
      contribution({ sourceId: "i1", sourceType: "invoice" }),
    ]);
    expect(issues.map((i) => i.documentId)).toEqual(["b1", "b3", "r1"]);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(blockingIssues(issues)).toEqual([]);
  });

  it("the VAT 201 card lists them in English and Arabic", async () => {
    const issues = [
      {
        code: "INPUT_VAT_NO_SUPPLIER_TRN",
        severity: "warning" as const,
        documentType: "bill",
        documentId: "b1",
        reference: "NOTRN-1",
      },
      { code: "NO_EXCHANGE_RATE", documentId: "x" },
    ];
    await render(createElement(VatInputTrnWarnings, { issues }));
    const box = container.querySelector('[data-testid="vat-input-trn-warnings"]')!;
    expect(box.textContent).toContain("Input VAT claimed without a supplier TRN (1)");
    expect(box.textContent).toContain("Bill NOTRN-1");
    useI18n.setState({ locale: "ar" } as never);
    await render(createElement(VatInputTrnWarnings, { issues: [...issues] }));
    expect(container.textContent).toContain("فاتورة مشتريات NOTRN-1");
    await render(createElement(VatInputTrnWarnings, { issues: [] }));
    expect(container.querySelector('[data-testid="vat-input-trn-warnings"]')).toBeNull();
  });
});
