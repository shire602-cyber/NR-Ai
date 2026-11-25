/**
 * Sample data for the homepage tour. Every company, merchant and figure is fictional and shown
 * under a "Sample data" label. Money is integer fils. Names are `{en, ar}` pairs so they follow the
 * page language.
 */
import type { SiteLocale } from "../../routes";

export type Localised = Record<SiteLocale, string>;

export interface SampleLine {
  id: string;
  item: Localised;
  qty: number;
  unitFils: number;
}

export const INVOICE_NUMBER = "INV-2001";
export const INVOICE_CUSTOMER: Localised = {
  en: "Al Noor Retail FZCO",
  ar: "النور للتجزئة ش.م.ح.",
};

/** Default lines: 4 x 450.00 + 10 x 120.00 = 3,000.00, VAT 150.00, total 3,150.00. */
export const INVOICE_LINES: readonly SampleLine[] = [
  {
    id: "line-1",
    item: { en: "Design consultation", ar: "استشارة تصميم" },
    qty: 4,
    unitFils: 45_000,
  },
  {
    id: "line-2",
    item: { en: "Office fit-out supplies", ar: "مستلزمات تجهيز المكتب" },
    qty: 10,
    unitFils: 12_000,
  },
];

export interface TourTransaction {
  ref: string;
  kind: "sale" | "expense";
  rate: "standard" | "zero";
  netFils: number;
}

/** The ledger behind the VAT 201 tab, the bank CSV and the accountant summary. */
export const TOUR_TRANSACTIONS: readonly TourTransaction[] = [
  { ref: "INV-2001", kind: "sale", rate: "standard", netFils: 300_000 },
  { ref: "INV-2002", kind: "sale", rate: "standard", netFils: 800_000 },
  { ref: "INV-2003", kind: "sale", rate: "zero", netFils: 200_000 },
  { ref: "EXP-301", kind: "expense", rate: "standard", netFils: 25_000 },
  { ref: "EXP-302", kind: "expense", rate: "standard", netFils: 120_000 },
];

export interface BankRow {
  id: string;
  /** dd/mm */
  date: string;
  text: string;
  /** Signed: money in is positive. */
  amountFils: number;
}

export const BANK_FILE_NAME = "bank-statement.csv";

export const BANK_ROWS: readonly BankRow[] = [
  { id: "row-1", date: "20/11", text: "AL NOOR RETAIL FZCO", amountFils: 315_000 },
  { id: "row-2", date: "19/11", text: "DHOW LOGISTICS LLC", amountFils: 840_000 },
  { id: "row-3", date: "18/11", text: "ETISALAT UAE", amountFils: -126_000 },
  { id: "row-4", date: "17/11", text: "GULF STATIONERY TRADING", amountFils: -26_250 },
  { id: "row-5", date: "16/11", text: "TRANSFER REF 88213", amountFils: -50_000 },
];

export const RECEIPT = {
  merchant: { en: "Gulf Stationery Trading", ar: "الخليج للقرطاسية" } as Localised,
  /** Matches EXP-301: 250.00 net + 12.50 VAT. */
  ref: "EXP-301",
  date: "17/11/2026",
  totalFils: 26_250,
  vatFils: 1_250,
} as const;

export interface TourClient {
  id: string;
  name: Localised;
  /** Pearl Trading's figures equal the ones derived from the tour transactions (pinned by a test). */
  openInvoices: number;
  openAmountFils: number;
  /** ISO date of the next VAT 201 deadline. */
  vatDue: string;
  review: number;
}

export const TOUR_CLIENTS: readonly TourClient[] = [
  {
    id: "pearl",
    name: { en: "Pearl Trading LLC", ar: "لؤلؤة للتجارة ذ.م.م" },
    openInvoices: 1,
    openAmountFils: 200_000,
    vatDue: "2027-01-28",
    review: 1,
  },
  {
    id: "dhow",
    name: { en: "Dhow Logistics LLC", ar: "الداو للخدمات اللوجستية ذ.م.م" },
    openInvoices: 4,
    openAmountFils: 1_873_500,
    vatDue: "2026-12-28",
    review: 6,
  },
  {
    id: "palm",
    name: { en: "Palm Office Supplies", ar: "النخلة للمستلزمات المكتبية" },
    openInvoices: 0,
    openAmountFils: 0,
    vatDue: "2027-01-28",
    review: 0,
  },
];
