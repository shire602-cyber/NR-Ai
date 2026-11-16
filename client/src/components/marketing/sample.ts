/**
 * Sample data shown in the public previews. It is the same fictional company as
 * the /demo workspace (Pearl Trading LLC, Q2 2026) and every figure is labelled
 * as sample data on screen. Amounts are in AED.
 */
export const SAMPLE = {
  revenue: 364000,
  receivables: 48310,
  payables: 21740,
  cash: 212480.5,
  vatPayable: 11100,
  /** Monthly totals, Jan–Jun 2026. Q2 revenue = pl.income; Q2 expenses = costOfSales + operating. */
  trends: {
    revenue: [96400, 101200, 108900, 112000, 121500, 130500],
    expenses: [84300, 86900, 88700, 90100, 93250, 96500],
  },
  invoices: [
    { number: "INV-1042", customer: "Al Noor Retail FZCO", total: 19425, status: "paid" },
    { number: "INV-1043", customer: "Dhow Logistics LLC", total: 9660, status: "sent" },
    { number: "INV-1044", customer: "Palm Office Supplies", total: 6615, status: "draft" },
  ],
  vat: [
    { box: "1b", key: "marketing.vatRow1b", amount: 340000, vat: 17000 },
    { box: "4", key: "marketing.vatRow4", amount: 24000, vat: 0 },
    { box: "9", key: "marketing.vatRow9", amount: 118000, vat: 5900 },
  ],
  bankLines: [
    { date: "15/06", text: "AL NOOR RETAIL FZCO", amount: 19425, status: "matched" },
    { date: "14/06", text: "ETISALAT UAE", amount: -1260, status: "matched" },
    { date: "13/06", text: "ADCB BANK CHARGE", amount: -42, status: "review" },
  ],
  payroll: { employees: 14, net: 186450 },
  pl: { income: 364000, costOfSales: 151200, operating: 128650 },
} as const;
