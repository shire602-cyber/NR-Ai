/**
 * Seven PINT AE fixture documents (R07-04 / R07-05). Each is the stored-data
 * shape the generator receives (invoice row, invoice_lines rows, company row,
 * buyer details) so the fixtures exercise exactly the production path.
 */
import type { Company, Invoice, InvoiceLine } from "../../../shared/schema";
import type { EInvoiceOptions, EInvoiceParty } from "../../../server/services/einvoice.service";

export const fixtureCompany = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Pearl Trading LLC",
  legalName: "Pearl Trading L.L.C.",
  trnVatNumber: "100123456700003",
  addressStreet: "Office 1204, Al Saqr Tower, Sheikh Zayed Road",
  addressCity: "Dubai",
  addressCountry: "AE",
  emirate: "dubai",
  businessAddress: null,
  registrationNumber: null,
  tradeLicenceNo: "CN-1234567",
  tradeLicenceAuthority: "Dubai Department of Economy and Tourism",
  peppolParticipantId: "1001234567",
  peppolScheme: "0235",
  einvoicePayeeIban: "AE070331234567890123456",
  einvoicePaymentMeansCode: "30",
  contactEmail: "billing@pearl.example",
  contactPhone: "+97140000000",
} as unknown as Company;

export const uaeBuyer: Partial<EInvoiceParty> & { name: string } = {
  name: "Acme Gulf FZ-LLC",
  trn: "100765432100003",
  address: "Building 7, Dubai Internet City",
  city: "Dubai",
  emirate: "dubai",
  country: "AE",
  endpointId: "1007654321",
  endpointScheme: "0235",
  legalId: "DIC-998877",
  legalIdType: "TL",
  legalAuthority: "Dubai Development Authority",
};

export const foreignBuyer: Partial<EInvoiceParty> & { name: string } = {
  name: "Globex GmbH",
  trn: null,
  address: "Hauptstrasse 1",
  city: "Berlin",
  emirate: "Berlin",
  country: "DE",
  endpointId: "DE123456789",
  endpointScheme: "9930",
};

function invoice(overrides: Record<string, unknown>): Invoice {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: fixtureCompany.id,
    number: "INV-2027-0001",
    customerName: uaeBuyer.name,
    customerTrn: uaeBuyer.trn,
    customerAddress: uaeBuyer.address,
    date: new Date("2027-01-15T09:30:00.000Z"),
    dueDate: new Date("2027-02-14T00:00:00.000Z"),
    supplyDate: null,
    paymentTerms: "net30",
    currency: "AED",
    exchangeRate: 1,
    subtotal: 0,
    vatAmount: 0,
    total: 0,
    invoiceType: "invoice",
    reverseCharge: false,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    notes: null,
    ...overrides,
  } as unknown as Invoice;
}

function line(
  description: string,
  quantity: number,
  unitPrice: number,
  vatRate: number,
  vatSupplyType: string,
  extra: Record<string, unknown> = {}
): InvoiceLine {
  return {
    id: `line-${description}`,
    invoiceId: "11111111-1111-4111-8111-111111111111",
    description,
    quantity,
    unitPrice,
    vatRate,
    vatSupplyType,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    netAmount: null,
    ...extra,
  } as unknown as InvoiceLine;
}

export interface PintAeFixture {
  name: string;
  invoice: Invoice;
  lines: InvoiceLine[];
  customer: Partial<EInvoiceParty> & { name: string };
  opts: EInvoiceOptions;
  expectCategories: string[];
  expectTypeCode: string;
}

export const PINT_AE_FIXTURES: PintAeFixture[] = [
  {
    name: "standard",
    // 2 x 500 at 5% with a 10% line discount on one line and a 50 AED document discount.
    invoice: invoice({
      number: "INV-2027-0001",
      discountType: "amount",
      discountValue: 50,
      discountAmount: 110,
      subtotal: 1690,
      vatAmount: 84.5,
      total: 1774.5,
    }),
    lines: [
      line("Consulting services - January", 2, 500, 0.05, "standard_rated", {
        discountType: "percent",
        discountValue: 6,
        discountAmount: 60,
      }),
      line("Implementation workshop", 1, 800, 0.05, "standard_rated"),
    ],
    customer: uaeBuyer,
    opts: { issueTime: "13:30:00" },
    expectCategories: ["S"],
    expectTypeCode: "380",
  },
  {
    name: "zero-rated export",
    invoice: invoice({
      number: "INV-2027-0002",
      customerName: foreignBuyer.name,
      customerTrn: null,
      subtotal: 4200,
      vatAmount: 0,
      total: 4200,
    }),
    lines: [line("Export of machine parts (FOB Jebel Ali)", 6, 700, 0, "zero_rated")],
    customer: foreignBuyer,
    opts: { issueTime: "10:00:00" },
    expectCategories: ["Z"],
    expectTypeCode: "380",
  },
  {
    name: "exempt",
    // Exempt residential lease alongside a standard-rated service charge.
    invoice: invoice({ number: "INV-2027-0003", subtotal: 3200, vatAmount: 10, total: 3210 }),
    lines: [
      line("Residential lease - Apartment 1102 (February)", 1, 3000, 0, "exempt"),
      line("Parking bay service fee", 1, 200, 0.05, "standard_rated"),
    ],
    customer: uaeBuyer,
    opts: { issueTime: "08:15:00" },
    expectCategories: ["E", "S"],
    expectTypeCode: "380",
  },
  {
    name: "out of scope",
    invoice: invoice({ number: "INV-2027-0004", subtotal: 1500, vatAmount: 0, total: 1500 }),
    lines: [line("Recharge of government visa fees (disbursement)", 1, 1500, 0, "out_of_scope")],
    customer: uaeBuyer,
    opts: { issueTime: "11:45:00" },
    expectCategories: ["O"],
    expectTypeCode: "480",
  },
  {
    name: "reverse charge",
    invoice: invoice({
      number: "INV-2027-0005",
      reverseCharge: true,
      subtotal: 25000,
      vatAmount: 0,
      total: 25000,
    }),
    lines: [line("Gold bullion 999.9 - 100g bar", 1, 25000, 0, "reverse_charge")],
    customer: uaeBuyer,
    opts: {
      issueTime: "12:00:00",
      lineExtras: [{ gtin: "06291234567890", rcmGoodsType: "DL8.48.3.1" }],
    },
    expectCategories: ["AE"],
    expectTypeCode: "380",
  },
  {
    name: "credit note",
    invoice: invoice({
      number: "CN-2027-0001",
      invoiceType: "credit_note",
      originalInvoiceId: "22222222-2222-4222-8222-222222222222",
      dueDate: null,
      subtotal: -500,
      vatAmount: -25,
      total: -525,
      notes: "Service credit for January outage",
    }),
    lines: [line("[Credit] Consulting services - January", -1, 500, 0.05, "standard_rated")],
    customer: uaeBuyer,
    opts: {
      issueTime: "16:20:00",
      originalInvoice: { number: "INV-2027-0001", date: "2027-01-15" },
      creditNoteReasonCode: "DL8.61.1.C",
    },
    expectCategories: ["S"],
    expectTypeCode: "381",
  },
  {
    name: "foreign currency",
    invoice: invoice({
      number: "INV-2027-0006",
      currency: "USD",
      exchangeRate: 3.6725,
      subtotal: 1000,
      vatAmount: 50,
      total: 1050,
    }),
    lines: [line("Software subscription (annual)", 1, 1000, 0.05, "standard_rated")],
    customer: uaeBuyer,
    opts: { issueTime: "09:00:00" },
    expectCategories: ["S"],
    expectTypeCode: "380",
  },
];

export const debitNoteFixture: PintAeFixture = {
  name: "debit note",
  invoice: invoice({
    number: "DN-2027-0001",
    invoiceType: "debit_note",
    subtotal: 200,
    vatAmount: 10,
    total: 210,
  }),
  lines: [line("Additional freight charge", 1, 200, 0.05, "standard_rated")],
  customer: uaeBuyer,
  opts: { issueTime: "10:10:00", originalInvoice: { number: "INV-2027-0001", date: "2027-01-15" } },
  expectCategories: ["S"],
  expectTypeCode: "380",
};
