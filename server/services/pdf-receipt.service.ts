/**
 * Expense receipt PDFs (single receipt, A5; filtered export, A4) in the "Ledger" layout.
 *
 * Figures are the stored ones: `receipts.amount` is the net subtotal and the receipt total is
 * amount + vatAmount, exactly as the receipts list shows them. OCR text is never printed.
 */
import type { Company, Receipt } from "../../shared/schema";
import { pdfLocale } from "./pdf-fonts";
import { bi, companyDetails, date, Ledger, money, sellerIdentity } from "./pdf-ledger";

type ReceiptLike = Pick<
  Receipt,
  "id" | "merchant" | "date" | "category" | "currency" | "amount" | "vatAmount"
>;

const total = (r: ReceiptLike) => (r.amount ?? 0) + (r.vatAmount ?? 0);

function receiptMeta(ledger: Ledger, r: ReceiptLike) {
  ledger.meta([
    {
      label: bi("Merchant", "التاجر"),
      value: r.merchant || ledger.pair(bi("Not read", "غير مقروء"))[0],
    },
    { label: bi("Date", "التاريخ"), value: date(r.date) },
    {
      label: bi("Category", "الفئة"),
      value: r.category || ledger.pair(bi("Uncategorised", "غير مصنف"))[0],
    },
    { label: bi("Currency", "العملة"), value: r.currency || "AED" },
  ]);
}

function receiptTotals(ledger: Ledger, r: ReceiptLike, width?: number) {
  const cur = r.currency || "AED";
  const rows =
    r.vatAmount && r.vatAmount > 0
      ? [
          {
            label: bi("Amount before VAT", "المبلغ قبل الضريبة"),
            value: money(r.amount ?? 0, cur),
          },
          { label: bi("VAT", "الضريبة"), value: money(r.vatAmount, cur) },
        ]
      : [];
  ledger.totals(rows, { label: bi("Total", "الإجمالي"), value: money(total(r), cur) }, { width });
}

/** One receipt on an A5 page. */
export function renderReceiptPdf(r: ReceiptLike, company: Company): Promise<Buffer> {
  const ledger = new Ledger({
    locale: pdfLocale(company),
    size: "A5",
    info: { Title: `Receipt ${r.merchant ?? r.id}`, Author: company.name },
  });
  ledger.header({
    companyName: sellerIdentity(company, ledger.locale).name,
    details: companyDetails(ledger, { trn: company.trnVatNumber }),
    title: bi("Expense receipt", "إيصال مصروف"),
  });
  receiptMeta(ledger, r);
  receiptTotals(ledger, r, ledger.width);
  return ledger.finish();
}

/** Filtered receipts export: a summary table, then one page per receipt. */
export function renderReceiptsExportPdf(
  receipts: ReceiptLike[],
  company: Company,
  filters: { from?: string; to?: string; category?: string }
): Promise<Buffer> {
  const ledger = new Ledger({
    locale: pdfLocale(company),
    info: { Title: "Expense receipts", Author: company.name },
  });
  const totalSubtotal = receipts.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const totalVat = receipts.reduce((sum, r) => sum + (r.vatAmount ?? 0), 0);
  const totalAmount = totalSubtotal + totalVat;
  const range =
    filters.from && filters.to
      ? `${date(filters.from)} – ${date(filters.to)}`
      : filters.from
        ? ledger.pair(bi(`From ${date(filters.from)}`, `من ${date(filters.from)}`))[0]
        : filters.to
          ? ledger.pair(bi(`To ${date(filters.to)}`, `حتى ${date(filters.to)}`))[0]
          : ledger.pair(bi("All dates", "كل التواريخ"))[0];

  ledger.header({
    companyName: sellerIdentity(company, ledger.locale).name,
    details: companyDetails(ledger, { trn: company.trnVatNumber }),
    title: bi("Expense receipts", "إيصالات المصروفات"),
    subtitle: range,
  });
  ledger.meta([
    { label: bi("Period", "الفترة"), value: range },
    {
      label: bi("Category", "الفئة"),
      value: filters.category && filters.category !== "all" ? filters.category : null,
    },
    { label: bi("Receipts", "عدد الإيصالات"), value: String(receipts.length) },
  ]);
  ledger.table(
    [
      { key: "n", label: bi("#", "#"), weight: 0.4 },
      { key: "date", label: bi("Date", "التاريخ"), weight: 1.1 },
      { key: "merchant", label: bi("Merchant", "التاجر"), weight: 2.4 },
      { key: "category", label: bi("Category", "الفئة"), weight: 1.6 },
      { key: "amount", label: bi("Amount", "المبلغ"), weight: 1.5, align: "end" },
    ],
    receipts.map((r, i) => ({
      cells: {
        n: String(i + 1),
        date: date(r.date),
        merchant: r.merchant || "—",
        category: r.category || "—",
        amount: money(total(r), r.currency || "AED"),
      },
    })),
    { size: 8.5 }
  );
  ledger.totals(
    totalVat > 0 ? [{ label: bi("Total VAT", "إجمالي الضريبة"), value: money(totalVat) }] : [],
    { label: bi("Total", "الإجمالي"), value: money(totalAmount) }
  );

  for (const r of receipts) {
    ledger.doc.addPage();
    ledger.y = ledger.margin;
    ledger.header({
      companyName: sellerIdentity(company, ledger.locale).name,
      details: [],
      title: bi("Expense receipt", "إيصال مصروف"),
    });
    receiptMeta(ledger, r);
    receiptTotals(ledger, r);
  }
  return ledger.finish();
}
