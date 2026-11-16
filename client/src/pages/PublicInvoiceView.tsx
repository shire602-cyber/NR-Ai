import { T } from "@/components/layout/T";
import { useTranslation } from "@/lib/i18n";
import { useParams } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
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
import { Download, AlertCircle, Clock, CreditCard, CheckCircle2 } from "lucide-react";
import { apiUrl } from "@/lib/api";

interface PublicInvoiceData {
  /** W4-D (R16-14): present only when a payment gateway is live or in sandbox. */
  onlinePayment?: { available: boolean; status: string; provider: string | null };
  einvoice?: { status: string; uuid: string | null } | null;
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
    // R03-14: tax-invoice label, due date and payment status for the customer.
    invoiceType?: string;
    isTaxInvoice?: boolean;
    dueDate?: string | null;
    supplyDate?: string | null;
    amountPaid?: number;
    amountDue?: number;
    paymentStatus?: "paid" | "partially_paid" | "unpaid" | "overdue" | "void";
  };
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatSupplyType: string | null;
  }[];
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

function formatCurrency(amount: number, currency: string = "AED"): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
      return "bg-danger-subtle text-danger-subtle-foreground";
    default:
      return "bg-muted text-foreground";
  }
}

export default function PublicInvoiceView() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();

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
  });

  const handleDownloadPDF = () => {
    window.open(apiUrl(`/api/public/invoices/${token}/pdf`), "_blank");
  };

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const paymentResult =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("payment")
      : null;

  const handlePay = async () => {
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch(apiUrl(`/api/portal/public-invoices/${token}/pay`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.message || "Payment could not be started");
      window.location.assign(body.url);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Payment could not be started");
      setPaying(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-3 border-info border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">
            <T k="pageLabels.loadingInvoice" />
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    const message = error instanceof Error ? error?.message : "Invoice not found";
    const isExpired = message.includes("expired");

    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            {isExpired ? (
              <Clock className="w-16 h-16 text-warning mb-4" />
            ) : (
              <AlertCircle className="w-16 h-16 text-destructive mb-4" />
            )}
            <h2 className="text-xl font-semibold mb-2">
              {isExpired ? t["portal.invoiceLinkExpired"] : t["portal.invoiceNotFound"]}
            </h2>
            <p className="text-muted-foreground">
              {isExpired
                ? "This invoice link has expired. Please contact the sender for a new link."
                : "This invoice link is invalid or has been removed."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invoice, lines, company } = data;
  const isVATRegistered = !!company.trnVatNumber;

  return (
    <div className="min-h-screen bg-muted py-8 px-4">
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
              <div className="text-right">
                <h2 className="text-lg font-bold uppercase" data-testid="public-invoice-title">
                  {invoice.invoiceType === "credit_note" ? (
                    <T k="invoices.publicCreditNote" />
                  ) : (invoice.isTaxInvoice ?? isVATRegistered) ? (
                    <T k="invoices.publicTaxInvoice" />
                  ) : (
                    <T k="invoices.publicInvoice" />
                  )}
                </h2>
                {isVATRegistered && company.trnVatNumber && (
                  <p className="text-info-foreground text-sm mt-1">TRN: {company.trnVatNumber}</p>
                )}
              </div>
            </div>
          </div>

          <CardContent className="p-6 space-y-6">
            {/* Invoice Details */}
            <div className="flex flex-wrap gap-6 justify-between bg-muted p-4 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">
                  {(invoice.isTaxInvoice ?? isVATRegistered) ? (
                    <T k="invoices.publicTaxInvoice" />
                  ) : (
                    <T k="invoices.publicInvoice" />
                  )}
                </p>
                <p className="font-semibold text-lg">{invoice.number}</p>
              </div>
              {invoice.supplyDate && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    <T k="invoices.publicSupplyDate" />
                  </p>
                  <p className="font-semibold">{formatDate(invoice.supplyDate)}</p>
                </div>
              )}
              {invoice.dueDate && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    <T k="invoices.publicDueDate" />
                  </p>
                  <p className="font-semibold" data-testid="public-invoice-due-date">
                    {formatDate(invoice.dueDate)}
                  </p>
                </div>
              )}
              {invoice.paymentStatus && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    <T k="invoices.publicPaymentStatus" />
                  </p>
                  <Badge
                    className={getStatusColor(
                      invoice.paymentStatus === "partially_paid"
                        ? "partial"
                        : invoice.paymentStatus === "unpaid"
                          ? "sent"
                          : invoice.paymentStatus
                    )}
                    data-testid="public-invoice-payment-status"
                  >
                    <T k={`invoices.payStatus.${invoice.paymentStatus}`} />
                  </Badge>
                </div>
              )}
              {invoice.amountDue !== undefined && invoice.invoiceType !== "credit_note" && (
                <div className="text-end">
                  <p className="text-sm text-muted-foreground">
                    <T k="invoices.publicAmountDue" />
                  </p>
                  <p className="font-bold text-2xl" data-testid="public-invoice-amount-due">
                    {formatCurrency(invoice.amountDue, invoice.currency)}
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-semibold">{formatDate(invoice.date)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  <T k="pages.status" />
                </p>
                <Badge className={getStatusColor(invoice.status)}>
                  {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                </Badge>
              </div>
            </div>

            {/* Bill To */}
            <div>
              <h3 className="text-sm font-semibold text-info uppercase mb-2">
                <T k="pageLabels.billTo" />
              </h3>
              <p className="font-semibold text-lg">{invoice.customerName}</p>
              {invoice.customerTrn && (
                <p className="text-sm text-muted-foreground">TRN: {invoice.customerTrn}</p>
              )}
            </div>

            {/* Line Items */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-info hover:bg-info">
                    <TableHead className="text-white font-semibold">
                      <T k="pages.description" />
                    </TableHead>
                    <TableHead className="text-white font-semibold text-center">Qty</TableHead>
                    <TableHead className="text-white font-semibold text-center">
                      <T k="pages.unitPrice" />
                    </TableHead>
                    <TableHead className="text-white font-semibold text-center">VAT</TableHead>
                    <TableHead className="text-white font-semibold text-right">
                      <T k="pages.amount" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => {
                    const lineTotal = line.quantity * line.unitPrice;
                    const vatPercent = ((line.vatRate ?? 0.05) * 100).toFixed(0);
                    return (
                      <TableRow key={index} className={index % 2 === 0 ? "bg-card" : "bg-muted"}>
                        <TableCell className="font-medium">{line.description}</TableCell>
                        <TableCell className="text-center">{line.quantity}</TableCell>
                        <TableCell className="text-center">
                          {formatCurrency(line.unitPrice, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-center">{vatPercent}%</TableCell>
                        <TableCell className="text-right">
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
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    <T k="pages.subtotal" />
                  </span>
                  <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">VAT</span>
                  <span>{formatCurrency(invoice.vatAmount, invoice.currency)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t bg-info text-white -mx-3 px-3 py-2 rounded-lg">
                  <span>
                    <T k="pages.total2" />
                  </span>
                  <span>{formatCurrency(invoice.total, invoice.currency)}</span>
                </div>
              </div>
            </div>

            {paymentResult === "success" && (
              <div
                className="flex items-center gap-2 rounded-lg bg-success-subtle text-success-subtle-foreground p-3"
                data-testid="public-invoice-payment-success"
              >
                <CheckCircle2 className="w-5 h-5" />
                <T k="portal.paymentProcessing" />
              </div>
            )}
            {data.einvoice && (
              <p className="text-sm text-muted-foreground" data-testid="public-invoice-einvoice">
                <T k="portal.einvoiceStatus" />: {data.einvoice.status}
              </p>
            )}

            {/* Download PDF / Pay now (only when a gateway is live) */}
            <div className="flex flex-wrap justify-center gap-3 pt-4 border-t">
              <Button onClick={handleDownloadPDF} className="bg-info hover:bg-info" size="lg">
                <Download className="w-5 h-5 mr-2" />
                <T k="pages.downloadPdf" />
              </Button>
              {data.onlinePayment?.available && (
                <Button
                  onClick={handlePay}
                  disabled={paying}
                  size="lg"
                  data-testid="public-invoice-pay-now"
                >
                  <CreditCard className="w-5 h-5 mr-2" />
                  <T k="portal.payNow" />
                  {data.onlinePayment.status === "sandbox" && (
                    <Badge variant="outline" className="ms-2">
                      <T k="portal.testMode" />
                    </Badge>
                  )}
                </Button>
              )}
            </div>
            {payError && (
              <p className="text-sm text-destructive text-center" role="alert">
                {payError}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground/70 pb-4">
          <p>
            <T k="pageLabels.thankYouForYourBusiness" />
          </p>
          {isVATRegistered && (
            <p className="mt-1">
              <T k="pageLabels.thisIsATaxInvoicePlease" />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
