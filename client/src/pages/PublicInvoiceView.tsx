import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, FileText, AlertCircle, Clock } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatCurrency as formatMoney, intlLocale } from "@/lib/format";
import { LanguageToggle } from "@/components/LanguageToggle";
import { messages as pageMessages } from "./PublicInvoiceView.i18n";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";
import { CustomFieldsDisplay } from "@/components/sales/CustomFieldsDisplay";
import { PayNowButton } from "@/components/sales/PayNowButton";
import { invoiceDisplayStatus, paymentReturnState, type DisplayField, type OnlinePaymentView } from "@/lib/sales-api";

interface PublicInvoiceData {
  invoice: {
    number: string;
    customerName: string;
    customerTrn: string | null;
    date: string;
    currency: string;
    subtotal: number;
    vatAmount: number;
    total: number;
    status: string;
    invoiceType?: string | null;
    dueDate?: string | null;
    discountAmount?: number | string | null;
    shippingAmount?: number | string | null;
    itemsSubtotal?: number | null;
    paid?: number | null;
    outstanding?: number | null;
  };
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatSupplyType: string | null;
    lineKind?: string | null;
    discountType?: string | null;
    discountValue?: number | string | null;
  }[];
  customFields?: DisplayField[];
  onlinePayment?: OnlinePaymentView;
  company: {
    name: string;
    trnVatNumber: string | null;
    businessAddress: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    websiteUrl: string | null;
    logoUrl: string | null;
  };
}

// Shared formatters keep Western digits in both languages (see lib/format). The language is
// read at call time; the component re-renders on a language switch through its message hook.
function formatCurrency(amount: number, currency: string = "AED"): string {
  return formatMoney(amount, currency, useI18n.getState().locale);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(intlLocale(useI18n.getState().locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

function getStatusColor(status: string): string {
  switch (status) {
    case "paid":
      return "bg-success-subtle text-success-subtle-foreground";
    case "sent":
      return "bg-info-subtle text-info-subtle-foreground";
    case "draft":
      return "bg-muted text-foreground";
    case "void":
    case "overdue":
      return "bg-danger-subtle text-danger-subtle-foreground";
    default:
      return "bg-muted text-foreground";
  }
}

export default function PublicInvoiceView() {
  const tr = pageMessages.useT();

  const { token } = useParams<{ token: string }>();
  const salesTr = salesMessages.useT();
  // Coming back from the payment page: the receipt is posted by the provider's webhook, so look again for a short while.
  const returned = typeof window !== "undefined" ? paymentReturnState(window.location.search) : null;

  const { data, isLoading, error } = useQuery<PublicInvoiceData>({
    queryKey: ["public-invoice", token],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/public/invoices/${token}`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load invoice");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data as PublicInvoiceData | undefined;
      return returned === "success" && d && (d.invoice.outstanding ?? 0) > 0.004 && query.state.dataUpdateCount < 12 ? 3000 : false;
    },
  });

  const handleDownloadPDF = () => {
    window.open(apiUrl(`/api/public/invoices/${token}/pdf`), "_blank");
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-3 border-info border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">{tr("loadingInvoice")}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    const message = error instanceof Error ? error?.message : tr("invoiceNotFound");
    const isExpired = message.includes("expired");

    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <LanguageToggle floating />
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            {isExpired ? (
              <Clock className="w-16 h-16 text-warning mb-4" />
            ) : (
              <AlertCircle className="w-16 h-16 text-destructive mb-4" />
            )}
            <h2 className="text-xl font-semibold mb-2">
              {isExpired ? tr("linkExpired") : tr("invoiceNotFound2")}
            </h2>
            <p className="text-muted-foreground">
              {isExpired ? tr("thisInvoiceLinkHasExpiredPlease") : tr("thisInvoiceLinkIsInvalidOr")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invoice, lines, company } = data;
  const isVATRegistered = !!company.trnVatNumber;
  const isAdvance = invoice.invoiceType === "advance";
  // Sent or partly paid and past its due date reads "Overdue" (display only; the stored status is unchanged).
  const shownStatus = invoiceDisplayStatus({ status: invoice.status, dueDate: invoice.dueDate, invoiceType: invoice.invoiceType });
  const statusText = (s: string) =>
    s === "draft" ? salesTr("invStatusDraft")
    : s === "sent" ? salesTr("invStatusSent")
    : s === "paid" ? salesTr("invStatusPaid")
    : s === "partial" ? salesTr("invStatusPartial")
    : s === "void" ? salesTr("invStatusVoid")
    : s === "credited" ? salesTr("invStatusCredited")
    : s === "overdue" ? salesTr("invStatusOverdue")
    : s;
  const visibleLines = lines.filter((l) => l.lineKind !== "discount" && l.lineKind !== "shipping");
  const outstanding = Number(invoice.outstanding ?? 0);
  const discountAmount = Number(invoice.discountAmount ?? 0);
  const shippingAmount = Number(invoice.shippingAmount ?? 0);
  const advanceTotal = lines.filter((l) => l.lineKind === "advance").reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const hasAdjustments = discountAmount > 0 || shippingAmount > 0 || advanceTotal < 0;

  return (
    <main className="min-h-screen bg-muted py-8 px-4">
      <LanguageToggle floating />
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header Card */}
        <Card className="overflow-hidden">
          {/* Blue Header */}
          <div className="bg-info text-white p-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold">{company.name}</h1>
                {company.businessAddress && (
                  <p className="text-info-foreground text-sm mt-1">{company.businessAddress}</p>
                )}
                {company.contactPhone && (
                  <p className="text-info-foreground text-sm">{company.contactPhone}</p>
                )}
                {company.contactEmail && (
                  <p className="text-info-foreground text-sm">{company.contactEmail}</p>
                )}
              </div>
              <div className="text-end">
                <h2 className="text-lg font-bold">
                  {isAdvance
                    ? isVATRegistered
                      ? salesTr("advanceTaxInvoice")
                      : salesTr("advanceInvoice")
                    : isVATRegistered
                      ? tr("taxInvoice")
                      : tr("invoice")}
                </h2>
                {isVATRegistered && company.trnVatNumber && (
                  <p className="text-info-foreground text-sm mt-1">
                    {tr("trn", { trnVatNumber: company.trnVatNumber })}
                  </p>
                )}
              </div>
            </div>
          </div>

          <CardContent className="p-6 space-y-6">
            {returned === "success" && (
              <div role="status" className="rounded-lg border border-success/40 bg-success-subtle p-3 text-sm text-success" data-testid="payment-return-success">
                {outstanding > 0.004 ? salesTr("paymentProcessing") : salesTr("paymentReceived")}
              </div>
            )}
            {returned === "cancelled" && (
              <div role="status" className="rounded-lg border bg-muted p-3 text-sm" data-testid="payment-return-cancelled">
                {salesTr("paymentCancelled")}
              </div>
            )}
            {/* Invoice Details */}
            <div className="flex flex-wrap gap-6 justify-between bg-muted p-4 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">{tr("invoiceNumber")}</p>
                <p className="font-semibold text-lg">{invoice.number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{tr("date")}</p>
                <p className="font-semibold">{formatDate(invoice.date)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{tr("status")}</p>
                <Badge className={getStatusColor(shownStatus)} data-testid="public-invoice-status">
                  {statusText(shownStatus)}
                </Badge>
              </div>
            </div>

            <CustomFieldsDisplay fields={data.customFields} className="grid gap-x-6 gap-y-1 rounded-lg bg-muted p-4 text-sm sm:grid-cols-2" />

            {/* Bill To */}
            <div>
              <h3 className="text-sm font-semibold text-info uppercase mb-2">{tr("billTo")}</h3>
              <p className="font-semibold text-lg">{invoice.customerName}</p>
              {invoice.customerTrn && (
                <p className="text-sm text-muted-foreground">
                  {tr("trn2", { customerTrn: invoice.customerTrn })}
                </p>
              )}
            </div>

            {/* Line Items: stacked cards on a phone (the table clips the price column at 375 px) */}
            <div className="space-y-2 sm:hidden" data-testid="public-lines-stacked">
              {visibleLines.map((line, index) => (
                <div key={index} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{line.description}</p>
                  {line.discountType && Number(line.discountValue) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {line.discountType === "percent"
                        ? salesTr("lineDiscountPercent", { value: Number(line.discountValue) })
                        : salesTr("lineDiscountAmount", { value: formatCurrency(Number(line.discountValue), invoice.currency) })}
                    </p>
                  )}
                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{tr("qty")}</dt>
                      <dd>{line.quantity}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{tr("unitPrice")}</dt>
                      <dd dir="ltr">{formatCurrency(line.unitPrice, invoice.currency)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{tr("vat")}</dt>
                      <dd>{((line.vatRate ?? 0.05) * 100).toFixed(0)}%</dd>
                    </div>
                    <div className="flex justify-between gap-3 font-medium">
                      <dt>{tr("amount")}</dt>
                      <dd dir="ltr">{formatCurrency(line.quantity * line.unitPrice, invoice.currency)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            <div className="hidden overflow-hidden rounded-lg border sm:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-info hover:bg-info">
                    <TableHead className="text-white font-semibold">{tr("description")}</TableHead>
                    <TableHead className="text-white font-semibold text-center">
                      {tr("qty")}
                    </TableHead>
                    <TableHead className="text-white font-semibold text-center">
                      {tr("unitPrice")}
                    </TableHead>
                    <TableHead className="text-white font-semibold text-center">
                      {tr("vat")}
                    </TableHead>
                    <TableHead className="text-white font-semibold text-end">
                      {tr("amount")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Discounts and shipping appear in the totals below, not as table rows. */}
                  {lines.filter((l) => l.lineKind !== "discount" && l.lineKind !== "shipping").map((line, index) => {
                    const lineTotal = line.quantity * line.unitPrice;
                    const vatPercent = ((line.vatRate ?? 0.05) * 100).toFixed(0);
                    return (
                      <TableRow key={index} className={index % 2 === 0 ? "bg-card" : "bg-muted"}>
                        <TableCell className="font-medium">
                          {line.description}
                          {line.discountType && Number(line.discountValue) > 0 && (
                            <span className="block text-xs font-normal text-muted-foreground">
                              {line.discountType === "percent"
                                ? salesTr("lineDiscountPercent", { value: Number(line.discountValue) })
                                : salesTr("lineDiscountAmount", { value: formatCurrency(Number(line.discountValue), invoice.currency) })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{line.quantity}</TableCell>
                        <TableCell className="text-center">
                          {formatCurrency(line.unitPrice, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-center">{vatPercent}%</TableCell>
                        <TableCell className="text-end">
                          {formatCurrency(lineTotal, invoice.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-64 space-y-2">
                {hasAdjustments && invoice.itemsSubtotal !== undefined && invoice.itemsSubtotal !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{salesTr("itemsSubtotal")}</span>
                    <span dir="ltr">{formatCurrency(invoice.itemsSubtotal + discountAmount, invoice.currency)}</span>
                  </div>
                )}
                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm" data-testid="public-discount">
                    <span className="text-muted-foreground">{salesTr("discountTotal")}</span>
                    <span dir="ltr">-{formatCurrency(discountAmount, invoice.currency)}</span>
                  </div>
                )}
                {shippingAmount > 0 && (
                  <div className="flex justify-between text-sm" data-testid="public-shipping">
                    <span className="text-muted-foreground">{salesTr("shipping")}</span>
                    <span dir="ltr">{formatCurrency(shippingAmount, invoice.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tr("subtotal")}</span>
                  <span dir="ltr">{formatCurrency(invoice.subtotal, invoice.currency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tr("vat")}</span>
                  <span dir="ltr">{formatCurrency(invoice.vatAmount, invoice.currency)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t bg-info text-white -mx-3 px-3 py-2 rounded-lg">
                  <span>{tr("total")}</span>
                  <span dir="ltr">{formatCurrency(invoice.total, invoice.currency)}</span>
                </div>
              </div>
            </div>

            {(invoice.paid ?? 0) > 0 && (
              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{salesTr("amountPaid")}</span>
                    <span dir="ltr" data-testid="public-paid">{formatCurrency(invoice.paid ?? 0, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>{salesTr("amountDue")}</span>
                    <span dir="ltr" data-testid="public-outstanding">{formatCurrency(outstanding, invoice.currency)}</span>
                  </div>
                </div>
              </div>
            )}

            {token && (
              <PayNowButton
                onlinePayment={data.onlinePayment}
                outstanding={outstanding}
                currency={invoice.currency}
                checkoutPath={`/api/public/invoices/${token}/checkout`}
              />
            )}

            {/* Download PDF */}
            <div className="flex justify-center pt-4 border-t">
              <Button onClick={handleDownloadPDF} className="bg-info hover:bg-info" size="lg">
                <Download className="w-5 h-5 me-2" />
                {tr("downloadPdf")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground/70 pb-4">
          <p>{tr("thankYouForYourBusiness")}</p>
          {isVATRegistered && <p className="mt-1">{tr("thisIsATaxInvoicePlease")}</p>}
        </div>
      </div>
    </main>
  );
}
