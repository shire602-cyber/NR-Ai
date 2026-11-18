// @vitest-environment jsdom
/**
 * D5b: create/edit forms were re-laid-out (SectionCard groups, two-column grid,
 * error summary, sticky save bar, bilingual invoice preview). Layout only — each
 * test fills a form with a fixed sample and asserts the request body is exactly
 * what the form sent before the redesign (bodies captured on base de28f72).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY,
  COMPANY_ID,
  apiCalls,
  editorPage,
  byTestId,
  buttonByText,
  click,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  inputByLabel,
  pickDate,
  pickOption,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { act } from "react";
import { loadLocale } from "../../client/src/lib/i18n";

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
const ASSET_BODY = {
  assetName: "Delivery van",
  assetNameAr: "شاحنة توصيل",
  assetNumber: "FA-014",
  category: "Vehicles",
  purchaseDate: "2026-02-01",
  purchaseCost: 96000,
  salvageValue: 12000,
  usefulLifeYears: 6,
  depreciationMethod: "straight_line",
  location: "Dubai warehouse",
  serialNumber: "VIN-7781",
  notes: "Financed in full",
  paymentAccountId: null,
};
const JOURNAL_BODY = {
  date: "2026-03-15",
  memo: "March office rent",
  lines: [
    { accountId: "a0000000-0000-4000-8000-000000000510", debit: 7500, credit: 0 },
    { accountId: "a0000000-0000-4000-8000-000000000102", debit: 0, credit: 7500 },
  ],
};
const BUDGET_BODY = {
  name: "FY 2026 operating budget",
  fiscalYear: 2026,
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  notes: "Board approved draft",
};
const COST_CENTER_BODY = {
  code: "CC-110",
  name: "Retail branch",
  nameAr: "فرع التجزئة",
  type: "cost_centre",
  description: "Mall kiosk",
  parentId: null,
  isActive: true,
};
// CL-B: company settings and company profile are one page; one PATCH carries every field.
const COMPANY_BODY = {
  name: "Synthetic Trading Group",
  legalName: "Synthetic Trading L.L.C.",
  trnVatNumber: "100000000000003",
  baseCurrency: "AED",
  fiscalYearStartMonth: 1,
  defaultVatRate: 0.05,
  addressStreet: "Office 1204, Bay Square",
  addressCity: "Abu Dhabi",
  emirate: "dubai",
  addressCountry: "AE",
  contactPhone: "+971 4 555 0100",
  contactEmail: "finance@synthetic.example",
  industry: "Trading",
  logoUrl: "",
  dateFormat: "DD/MM/YYYY",
  locale: "en",
  legalStructure: "LLC",
  registrationNumber: "CN-1234567",
  businessAddress: "Office 1204, Bay Square, Dubai",
  websiteUrl: "https://group.synthetic.example",
  taxRegistrationType: "Standard",
  vatFilingFrequency: "Quarterly",
  // X5 (J1 L2): the form also saves the VAT stagger (default January).
  vatPeriodStartMonth: 1,
  taxRegistrationDate: "2024-01-01T00:00:00.000Z",
  corporateTaxId: "CT-998877",
};
const PRODUCT_BODY = {
  name: "A4 copier paper",
  nameAr: "ورق نسخ A4",
  sku: "PAP-A4-500",
  description: "500 sheets, 80 gsm",
  unitPrice: 24.5,
  costPrice: 17.25,
  vatRate: 0.05,
  unit: "pcs",
  lowStockThreshold: 15,
  reorderPoint: 20,
};

beforeAll(async () => {
  await loadLocale("en");
  // jsdom gaps used by Radix / virtualizers
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
});
afterEach(async () => {
  await unmountPage();
  vi.useRealTimers();
});

const body = (method: string, url: string) => {
  const c = apiCalls(method).filter((x) => x.url === url);
  expect(c, `${method} ${url} calls: ${JSON.stringify(apiCalls())}`).toHaveLength(1);
  // Compare what goes over the wire (JSON drops undefined keys).
  return JSON.parse(JSON.stringify(c[0].body ?? null));
};

describe("[D5b] invoice form payload unchanged", () => {
  it("POSTs the same invoice body", async () => {
    setFixtures({ [`${C}/invoices?limit=50`]: { items: [], nextCursor: null } });
    const { default: Invoices } = await import("../../client/src/pages/Invoices");
    await renderPage(Invoices);
    await click(byTestId("button-create-invoice"));
    await type(byTestId("input-customer-name"), "Gulf Horizon Logistics");
    await type(byTestId("input-customer-trn"), "100123456700003");
    await type(byTestId("input-line-description-0"), "Consulting");
    await type(byTestId("input-line-quantity-0"), "2");
    await type(byTestId("input-line-price-0"), "1500.255");
    await type(byTestId("input-line-discount-0"), "10");
    await submit(byTestId("button-submit-invoice"));
    expect(body("POST", `${C}/invoices`)).toEqual({
      customerName: "Gulf Horizon Logistics",
      customerTrn: "100123456700003",
      date: "2026-03-15",
      // WQ1 (7.2b, 7.2g, 7.21): terms give the due date (net 30 by default); empty notes and the
      // company-default language are sent as null.
      paymentTerms: "net30",
      dueDate: "2026-04-14",
      notes: null,
      documentLanguage: null,
      currency: "AED",
      lines: [
        {
          description: "Consulting",
          quantity: 2,
          unitPrice: 1500.26,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
          discountType: "percent",
          discountValue: 10,
        },
      ],
    });
  });
});

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
/** The open form surface: a dialog, or the editor page for documents with line items. */
const surface = () => (document.querySelector('[role="dialog"]') as HTMLElement) ?? editorPage();
const named = (name: string) => surface().querySelector(`[name="${name}"]`);
const numberInputs = () => [...surface().querySelectorAll('input[type="number"]')];

describe("[D5b] quote form payload unchanged", () => {
  it("POSTs the same quote body", async () => {
    const { default: Quotes } = await import("../../client/src/pages/Quotes");
    await renderPage(Quotes);
    await click(buttonByText(/new quote/i));
    await type(named("customerName"), "Harbor Design Studio");
    await type(named("customerTrn"), "100234567800003");
    await type(named("notes"), "Valid 30 days");
    await type(named("lines.0.description"), "Brand workshop");
    await type(numberInputs()[0], "3");
    await type(numberInputs()[1], "200.5");
    await submit(editorPage().querySelector('button[type="submit"]'));
    expect(body("POST", `${C}/quotes`)).toEqual({
      customerName: "Harbor Design Studio",
      customerTrn: "100234567800003",
      date: "2026-03-15",
      expiryDate: "2026-04-14",
      currency: "AED",
      notes: "Valid 30 days",
      lines: [
        {
          description: "Brand workshop",
          quantity: 3,
          unitPrice: 200.5,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
      ],
    });
  });
});

describe("[D5b] recurring invoice form payload unchanged", () => {
  it("POSTs the same recurring template body", async () => {
    const { default: RecurringInvoices } = await import("../../client/src/pages/RecurringInvoices");
    await renderPage(RecurringInvoices);
    await click(buttonByText(/new recurring invoice/i));
    await type(named("customerName"), "Noor Retail Trading");
    await type(named("customerTrn"), "100345678900003");
    await type(named("lines.0.description"), "Monthly retainer");
    await type(named("lines.0.quantity"), "1");
    await type(named("lines.0.unitPrice"), "4500");
    await submit(editorPage().querySelector('button[type="submit"]'));
    expect(body("POST", `${C}/recurring-invoices`)).toEqual({
      customerName: "Noor Retail Trading",
      customerTrn: "100345678900003",
      currency: "AED",
      frequency: "monthly",
      startDate: "2026-03-15",
      endDate: null,
      lines: [
        {
          description: "Monthly retainer",
          quantity: 1,
          unitPrice: 4500,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
      ],
      autoIssue: true,
      autoSend: false,
      sendToEmail: null,
    });
  });
});

describe("[D5b] bill form payload unchanged", () => {
  it("POSTs the same vendor bill body", async () => {
    setFixtures({ [`${C}/bills/summary`]: null, [`${C}/bills/aging`]: null });
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    await renderPage(BillPay);
    await click(buttonByText(/new bill/i));
    await type(named("vendor_name"), "Atlas Office Supplies");
    await type(named("vendor_trn"), "100456789000003");
    await type(named("bill_number"), "AOS-2291");
    await type(named("notes"), "Quarterly stationery");
    await type(named("line_items.0.description"), "Printer paper");
    await type(named("line_items.0.quantity"), "10");
    await type(named("line_items.0.unit_price"), "24.5");
    await submit(editorPage().querySelector('button[type="submit"]'));
    // WQ2: the supplier record link (null for free text) and the line item are part of the body.
    expect(body("POST", `${C}/bills`)).toEqual({
      vendor_id: null,
      vendor_name: "Atlas Office Supplies",
      vendor_trn: "100456789000003",
      bill_number: "AOS-2291",
      bill_date: "2026-03-15",
      due_date: null,
      currency: "AED",
      exchange_rate: null,
      reverse_charge: false,
      is_import: false,
      customs_declaration_no: null,
      import_vat_amount: null,
      place_of_supply: null,
      category: null,
      notes: "Quarterly stationery",
      line_items: [
        {
          description: "Printer paper",
          quantity: 10,
          unit_price: 24.5,
          vat_supply_type: "standard_rated",
          vat_rate: 5,
          account_id: null,
          cost_center_id: null,
          product_id: null,
        },
      ],
    });
  });
});

describe("[D5b] purchase order form payload unchanged", () => {
  it("POSTs the same purchase order body", async () => {
    const { default: PurchaseOrders } = await import("../../client/src/pages/PurchaseOrders");
    await renderPage(PurchaseOrders);
    await click(buttonByText(/new purchase order/i));
    await type(named("vendorName"), "Blue Palm Services LLC");
    await type(named("vendorTrn"), "100567890100003");
    await type(named("notes"), "Deliver to warehouse 2");
    await type(named("lines.0.description"), "Pallet racking");
    await type(numberInputs()[0], "6");
    await type(numberInputs()[1], "850");
    await submit(editorPage().querySelector('button[type="submit"]'));
    expect(body("POST", `${C}/purchase-orders`)).toEqual({
      vendorName: "Blue Palm Services LLC",
      vendorTrn: "100567890100003",
      date: "2026-03-15",
      expectedDeliveryDate: "2026-03-29",
      currency: "AED",
      notes: "Deliver to warehouse 2",
      lines: [{ description: "Pallet racking", quantity: 6, unitPrice: 850, vatRate: 0.05 }],
    });
  });
});

/** Radix Select keeps a hidden native <select> inside forms; change it to pick a value. */
async function pickNative(index: number, value: string, scope: ParentNode | null = dialog()) {
  const selects = [...scope!.querySelectorAll("select")];
  await type(selects[index], value);
}

describe("[D5b] expense claim form payload unchanged", () => {
  it("POSTs the same expense claim body", async () => {
    const { default: ExpenseClaims } = await import("../../client/src/pages/ExpenseClaims");
    await renderPage(ExpenseClaims);
    await click(buttonByText(/new (expense )?claim/i));
    await type(named("title"), "Client visit Abu Dhabi");
    await type(named("description"), "Taxi and lunch");
    await type(named("items.0.merchant_name"), "Careem");
    await type(named("items.0.description"), "Taxi to client");
    await type(named("items.0.amount"), "120");
    await type(named("items.0.vat_amount"), "6");
    await type(named("items.0.supplier_trn"), "100678901200003");
    await pickNative(0, "Transport", surface());
    await submit(editorPage().querySelector('button[type="submit"]'));
    expect(body("POST", `${C}/expense-claims`)).toEqual({
      title: "Client visit Abu Dhabi",
      description: "Taxi and lunch",
      items: [
        {
          expense_date: "2026-03-15",
          category: "Transport",
          description: "Taxi to client",
          amount: 120,
          vat_amount: 6,
          merchant_name: "Careem",
          receipt_url: null,
          // WQ2 (8.7): the uploaded receipt (none on this item).
          receipt_ref: null,
          receipt_name: null,
          supplier_trn: "100678901200003",
          has_tax_invoice: true,
        },
      ],
    });
  });
});

describe("[D5b] contact form payload unchanged", () => {
  it("POSTs the same contact body", async () => {
    const { default: CustomerContacts } = await import("../../client/src/pages/CustomerContacts");
    await renderPage(CustomerContacts);
    await click(byTestId("button-add-contact"));
    await type(byTestId("input-contact-name"), "Gulf Horizon Logistics");
    await type(byTestId("input-contact-email"), "ap@gulfhorizon.example");
    await type(byTestId("input-contact-phone"), "+971-4-555-0101");
    await type(byTestId("input-contact-trn"), "100123456700003");
    // Place of supply is the shared Select (Radix): open it and choose Ajman.
    await pickOption(byTestId("select-contact-emirate"), /ajman/i);
    await type(byTestId("input-contact-payment-terms"), "45");
    await type(byTestId("input-contact-address"), "Unit 4, Al Jurf");
    await type(byTestId("input-contact-city"), "Ajman");
    await submit(byTestId("button-save-contact"));
    expect(body("POST", `${C}/customer-contacts`)).toEqual({
      name: "Gulf Horizon Logistics",
      email: "ap@gulfhorizon.example",
      phone: "+971-4-555-0101",
      trnNumber: "100123456700003",
      address: "Unit 4, Al Jurf",
      city: "Ajman",
      country: "United Arab Emirates",
      emirate: "ajman",
      paymentTerms: 45,
      // WQ5: one record for customer and/or supplier, typed registrations, structured address,
      // buyer ID and defaults (the legacy fields above keep their values).
      nameAr: null,
      taxRegistrations: [{ type: "vat", number: "100123456700003" }],
      addressStreet: "Unit 4, Al Jurf",
      addressBuilding: null,
      addressDistrict: null,
      postalCode: null,
      isCustomer: true,
      isSupplier: false,
      partyType: "business",
      freeZone: false,
      legalIdType: null,
      legalId: null,
      legalIdCountry: null,
      defaultRevenueAccountId: null,
      defaultExpenseAccountId: null,
      defaultVatTreatment: null,
      defaultCostCenterId: null,
    });
  });
});

describe("[D5b] vendor form payload unchanged", () => {
  it("POSTs the same vendor body", async () => {
    setFixtures({ [`${C}/vendors/aging`]: null });
    const { default: Vendors } = await import("../../client/src/pages/Vendors");
    await renderPage(Vendors);
    await click(buttonByText(/^\s*new supplier\s*$/i));
    const byId = (id: string) => document.getElementById(id);
    await type(byId("vendor-name"), "Atlas Office Supplies");
    await type(byId("vendor-name_ar"), "أطلس للوازم المكتبية");
    await type(byId("vendor-trn"), "100456789000003");
    await type(byId("vendor-email"), "billing@atlas.example");
    await type(byId("vendor-phone"), "+971 4 555 0199");
    await type(byId("vendor-payment_terms_days"), "60");
    await type(byId("vendor-iban"), "AE070331234567890123456");
    await type(byId("vendor-bank_name"), "Emirates NBD");
    await submit([...dialog().querySelectorAll("button:not(.absolute)")].pop()!);
    expect(body("POST", `${C}/vendors`)).toEqual({
      name: "Atlas Office Supplies",
      name_ar: "أطلس للوازم المكتبية",
      trn: "100456789000003",
      email: "billing@atlas.example",
      phone: "+971 4 555 0199",
      payment_terms_days: 60,
      currency: "AED",
      iban: "AE070331234567890123456",
      bank_name: "Emirates NBD",
    });
  });
});

describe("[D5b] manual expense (receipt) form payload unchanged", () => {
  it("POSTs the same receipt body", async () => {
    const { default: Receipts } = await import("../../client/src/pages/Receipts");
    await renderPage(Receipts);
    await click(byTestId("button-add-manual-expense"));
    await type(byTestId("input-manual-merchant"), "Careem");
    // X3: the date is the shared DatePicker (no native mm/dd/yyyy); pick the 10th of the open month.
    await click(byTestId("input-manual-date"));
    const day10 = [...document.querySelectorAll<HTMLButtonElement>('button[name="day"]')].find(
      (b) => b.textContent?.trim() === "10"
    );
    await click(day10!);
    await type(byTestId("input-manual-amount"), "84");
    await type(byTestId("input-manual-vat"), "4");
    await type(byTestId("input-manual-category"), "Transport");
    await submit(byTestId("button-submit-manual-expense"));
    expect(body("POST", `${C}/receipts`)).toEqual({
      merchant: "Careem",
      date: "2026-03-10",
      amount: 84,
      vatAmount: 4,
      category: "Transport",
      currency: "AED",
    });
  });
});

describe("[D5b] product form payload unchanged", () => {
  it("POSTs the same product body", async () => {
    const { default: Inventory } = await import("../../client/src/pages/Inventory");
    await renderPage(Inventory);
    await click(buttonByText(/add product/i));
    await type(named("name"), "A4 copier paper");
    await type(named("nameAr"), "ورق نسخ A4");
    await type(named("sku"), "PAP-A4-500");
    await type(named("description"), "500 sheets, 80 gsm");
    await type(named("unitPrice"), "24.5");
    await type(named("costPrice"), "17.25");
    await type(named("reorderPoint"), "20");
    await type(named("lowStockThreshold"), "15");
    await submit(dialog().querySelector('button[type="submit"]'));
    expect(body("POST", `${C}/products`)).toStrictEqual(PRODUCT_BODY);
  });
});

describe("[D5b] fixed asset form payload unchanged", () => {
  it("POSTs the same fixed asset body", async () => {
    setFixtures({ [`${C}/fixed-assets/summary`]: null });
    const { default: FixedAssets } = await import("../../client/src/pages/FixedAssets");
    await renderPage(FixedAssets);
    await click(buttonByText(/add asset/i));
    await type(named("assetName"), "Delivery van");
    await type(named("assetNameAr"), "شاحنة توصيل");
    await type(named("assetNumber"), "FA-014");
    // The purchase date is the shared DatePicker (opens on March 2026): back one month, the 1st.
    await pickDate(inputByLabel(/purchase date/i), 1, 1);
    await type(named("purchaseCost"), "96000");
    await type(named("salvageValue"), "12000");
    await type(named("usefulLifeYears"), "6");
    await type(named("location"), "Dubai warehouse");
    await type(named("serialNumber"), "VIN-7781");
    await type(named("notes"), "Financed in full");
    await pickNative(0, "Vehicles");
    await submit(dialog().querySelector('button[type="submit"]'));
    expect(body("POST", `${C}/fixed-assets`)).toStrictEqual(ASSET_BODY);
  });
});

const ACCOUNTS = [
  {
    id: "a0000000-0000-4000-8000-000000000102",
    code: "1020",
    nameEn: "Bank",
    type: "asset",
    subType: "bank",
    isActive: true,
  },
  {
    id: "a0000000-0000-4000-8000-000000000510",
    code: "5100",
    nameEn: "Rent",
    type: "expense",
    isActive: true,
  },
];

describe("[D5b] journal entry form payload unchanged", () => {
  it("POSTs the same journal body", async () => {
    setFixtures({ [`${C}/accounts`]: ACCOUNTS });
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await click(byTestId("button-create-entry"));
    await type(byTestId("input-memo"), "March office rent");
    // WP-D (spec 3.10): the journal entry is a full-page editor, not a dialog.
    await pickNative(0, "a0000000-0000-4000-8000-000000000510", document);
    await pickNative(1, "a0000000-0000-4000-8000-000000000102", document);
    await type(byTestId("input-debit-0"), "7500");
    await type(byTestId("input-credit-1"), "7500");
    await submit(byTestId("button-submit-entry"));
    expect(body("POST", `${C}/journal`)).toStrictEqual(JOURNAL_BODY);
  });
});

describe("[D5b] bank account form payload unchanged", () => {
  it("POSTs the same bank account body", async () => {
    setFixtures({ [`${C}/bank-accounts/bank-name-suggestions`]: { suggestions: [] } });
    const { default: BankAccounts } = await import("../../client/src/pages/BankAccounts");
    await renderPage(BankAccounts);
    await click(byTestId("button-add-bank-account"));
    const byId = (id: string) => document.getElementById(id);
    await type(byId("ba-name"), "Operating account");
    await type(byId("ba-bank"), "Emirates NBD");
    await type(byId("ba-number"), "1012345678901");
    await type(byId("ba-iban"), "AE070331234567890123456");
    await type(byId("ba-ob"), "25000.50");
    // The opening date is the shared DatePicker (opens on March 2026): back two months, the 1st.
    await pickDate(byId("ba-obd"), 1, 2);
    await submit([...dialog().querySelectorAll("button:not(.absolute)")].pop()!);
    expect(body("POST", `${C}/bank-accounts`)).toStrictEqual({
      nameEn: "Operating account",
      bankName: "Emirates NBD",
      accountNumber: "1012345678901",
      iban: "AE070331234567890123456",
      currency: "AED",
      openingBalance: "25000.50",
      openingBalanceDate: "2026-01-01",
    });
  });
});

describe("[D5b] employee form payload unchanged", () => {
  it("POSTs the same employee body", async () => {
    const { EmployeesTab } = await import("../../client/src/pages/payroll/EmployeesTab");
    await renderPage(EmployeesTab, { companyId: COMPANY_ID });
    await click(byTestId("button-add-employee"));
    const byId = (id: string) => document.getElementById(id);
    await type(byId("emp-fullName"), "Layla Haddad");
    await type(byId("emp-email"), "layla@synthetic.example");
    await type(byId("emp-emiratesId"), "784-1990-1234567-1");
    await type(byId("emp-iban"), "AE070331234567890123456");
    await type(byId("emp-joinDate"), "2025-09-01");
    await type(byId("emp-basicSalary"), "12000");
    await type(byId("emp-housingAllowance"), "4000");
    await submit([...dialog().querySelectorAll("button:not(.absolute)")].pop()!);
    expect(body("POST", `${C}/employees`)).toStrictEqual({
      fullName: "Layla Haddad",
      email: "layla@synthetic.example",
      emiratesId: "784-1990-1234567-1",
      iban: "AE070331234567890123456",
      joinDate: "2025-09-01",
      salaryCurrency: "AED",
      basicSalary: "12000",
      housingAllowance: "4000",
    });
  });
});

describe("[D5b] payroll run form payload unchanged", () => {
  it("POSTs the same payroll run body", async () => {
    const { RunsTab } = await import("../../client/src/pages/payroll/RunsTab");
    await renderPage(RunsTab, { companyId: COMPANY_ID });
    await click(byTestId("button-new-run"));
    await type(document.getElementById("run-year"), "2026");
    await submit([...dialog().querySelectorAll("button:not(.absolute)")].pop()!);
    expect(body("POST", `${C}/payroll-runs`)).toStrictEqual({ periodMonth: 3, periodYear: 2026 });
  });
});

/** Open a DatePicker, move `months` from the open month and pick a day (react-day-picker v8). */
async function pickDay(testId: string, months: number, day: string) {
  await click(byTestId(testId));
  const nav = months < 0 ? "previous-month" : "next-month";
  for (let i = 0; i < Math.abs(months); i++) {
    await click(document.querySelector<HTMLButtonElement>(`button[name="${nav}"]`)!);
  }
  const target = [...document.querySelectorAll<HTMLButtonElement>('button[name="day"]')].find(
    (b) => b.textContent?.trim() === day && !b.className.includes("day_outside")
  );
  await click(target!);
}

describe("[D5b] budget plan form payload unchanged", () => {
  it("POSTs the same budget plan body", async () => {
    const { default: Budgets } = await import("../../client/src/pages/Budgets");
    await renderPage(Budgets);
    await click(buttonByText(/new budget/i));
    await type(named("name"), "FY 2026 operating budget");
    await type(named("fiscalYear"), "2026");
    // WP-D (G1): start and end are the shared DatePicker, opening on the fiscal-year defaults.
    await pickDay("input-budget-start-date", 0, "1");
    await pickDay("input-budget-end-date", 0, "31");
    await type(named("notes"), "Board approved draft");
    await submit(dialog().querySelector('button[type="submit"]'));
    expect(body("POST", `${C}/budget-plans`)).toStrictEqual(BUDGET_BODY);
  });
});

describe("[D5b] cost centre form payload unchanged", () => {
  it("POSTs the same cost centre body", async () => {
    const { default: CostCenters } = await import("../../client/src/pages/CostCenters");
    await renderPage(CostCenters);
    await click(buttonByText(/add cost cent/i));
    await type(named("code"), "CC-110");
    await type(named("name"), "Retail branch");
    await type(named("nameAr"), "فرع التجزئة");
    await type(named("description"), "Mall kiosk");
    await submit(dialog().querySelector('button[type="submit"]'));
    expect(body("POST", `${C}/cost-centers`)).toStrictEqual(COST_CENTER_BODY);
  });
});

const COMPANY_ROW = {
  ...COMPANY,
  legalName: "Synthetic Trading L.L.C.",
  baseCurrency: "AED",
  fiscalYearStartMonth: 1,
  defaultVatRate: 0.05,
  addressStreet: "Office 1204, Bay Square",
  addressCity: "Dubai",
  addressCountry: "AE",
  contactPhone: "+971 4 555 0100",
  contactEmail: "finance@synthetic.example",
  industry: "Trading",
  logoUrl: "",
  dateFormat: "DD/MM/YYYY",
  legalStructure: "LLC",
  registrationNumber: "CN-1234567",
  businessAddress: "Office 1204, Bay Square, Dubai",
  websiteUrl: "https://synthetic.example",
  taxRegistrationType: "Standard",
  vatFilingFrequency: "Quarterly",
  taxRegistrationDate: "2024-01-01T00:00:00.000Z",
  corporateTaxId: "CT-998877",
};

describe("[D5b] company settings forms payload unchanged", () => {
  it("company settings PATCH body (settings and profile fields in one request)", async () => {
    setFixtures({ [`/api/companies/${COMPANY_ID}`]: COMPANY_ROW });
    const { default: CompanySettings } = await import("../../client/src/pages/CompanySettings");
    await renderPage(CompanySettings);
    const form = document.querySelector("form")!;
    await type(form.querySelector('[name="name"]'), "Synthetic Trading Group");
    await type(form.querySelector('[name="addressCity"]'), "Abu Dhabi");
    await type(form.querySelector('[name="websiteUrl"]'), "https://group.synthetic.example");
    await submit(byTestId("button-save-company-settings"));
    expect(body("PATCH", `${C}`)).toStrictEqual(COMPANY_BODY);
  });
});

describe("[D5b] validation: summary on submit, inline errors, focus first invalid", () => {
  it("invoice: empty submit shows the summary, marks the field and sends nothing", async () => {
    setFixtures({ [`${C}/invoices?limit=50`]: { items: [], nextCursor: null } });
    const { default: Invoices } = await import("../../client/src/pages/Invoices");
    await renderPage(Invoices);
    await click(byTestId("button-create-invoice"));
    await submit(byTestId("button-submit-invoice"));
    await flush(5);
    const summary = byTestId("form-error-summary");
    expect(summary).not.toBeNull();
    expect(summary!.getAttribute("role")).toBe("alert");
    expect(byTestId("input-customer-name")!.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-invalid")).toBe("true");
    expect(apiCalls("POST")).toHaveLength(0);
    // the live bilingual preview is part of the dialog
    const preview = byTestId("invoice-preview")!;
    expect(preview.textContent).toContain("Tax invoice");
    expect(preview.textContent).toContain("فاتورة ضريبية");
  });

  it("contact: required fields are summarised, focus moves to the first, nothing is posted", async () => {
    const { default: CustomerContacts } = await import("../../client/src/pages/CustomerContacts");
    await renderPage(CustomerContacts);
    await click(byTestId("button-add-contact"));
    await submit(byTestId("button-save-contact"));
    await flush(20);
    const summary = byTestId("form-error-summary")!;
    expect(summary.textContent).toMatch(/2 fields/);
    expect(summary.textContent).toContain("Name");
    expect(summary.textContent).toContain("Email");
    expect(byTestId("input-contact-name")!.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(byTestId("input-contact-name"));
    expect(apiCalls("POST")).toHaveLength(0);
  });

  it("single-field dialog submits on Enter (form submit), Escape is Radix-owned", async () => {
    const { RunsTab } = await import("../../client/src/pages/payroll/RunsTab");
    await renderPage(RunsTab, { companyId: COMPANY_ID });
    await click(byTestId("button-new-run"));
    const year = document.getElementById("run-year") as HTMLInputElement;
    await type(year, "2027");
    // Enter in a text field submits its form (implicit submission); jsdom needs requestSubmit.
    await act(async () => year.form!.requestSubmit());
    await flush(5);
    expect(body("POST", `${C}/payroll-runs`)).toStrictEqual({ periodMonth: 3, periodYear: 2027 });
  });
});

export { flush };
