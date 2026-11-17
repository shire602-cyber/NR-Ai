import { currencyLabel } from "@/lib/format-money";
import { T } from "@/components/layout/T";
import { useTranslation } from "@/lib/i18n";
import { DateText } from "@/components/documents/DateText";
import { useParams } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Alert } from "@/components/ui/alert";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  LedgerCompany,
  LedgerFooter,
  LedgerHeader,
  LedgerLines,
  LedgerMeta,
  LedgerParty,
  LedgerSheet,
  LedgerTotals,
} from "@/components/documents/LedgerSheet";
import { Download, AlertCircle, Clock, CreditCard, Loader2 } from "lucide-react";
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

const PAY_TONE: Record<NonNullable<PublicInvoiceData["invoice"]["paymentStatus"]>, StatusTone> = {
  paid: "success",
  partially_paid: "warning",
  unpaid: "warning",
  overdue: "danger",
  void: "neutral",
};

/**
 * Public invoice view (/view/invoice/:token): the HTML twin of the "Ledger" invoice PDF
 * (WP-F). White document card, accent rule, company block, stacked title, meta row, parties,
 * line table (stacked rows under 480 px), totals with the amount-due row; Download PDF is the
 * primary action and Pay appears only when a payment gateway is configured.
 */
export default function PublicInvoiceView() {
  const { t, locale } = useTranslation();
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
      if (!res.ok || !body.url) throw new Error(t["invoices.publicPayFailed"]);
      window.location.assign(body.url);
    } catch {
      setPayError(t["invoices.publicPayFailed"]);
      setPaying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="flex items-center gap-2 text-small text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <T k="portal.doc.loading" />
        </p>
      </div>
    );
  }

  if (error || !data) {
    const message = error instanceof Error ? error?.message : "Invoice not found";
    const isExpired = message.includes("expired");
    const Icon = isExpired ? Clock : AlertCircle;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card px-6 py-12 text-center">
          <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
            <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
          </span>
          <h1 className="text-h3 font-semibold text-foreground">
            {isExpired ? t["portal.invoiceLinkExpired"] : t["portal.invoiceNotFound"]}
          </h1>
          <p className="mt-2 text-small text-muted-foreground">
            {isExpired ? t["invoices.publicLinkExpiredBody"] : t["invoices.publicLinkInvalidBody"]}
          </p>
        </div>
      </div>
    );
  }

  const { invoice, lines, company } = data;
  const isVATRegistered = !!company.trnVatNumber;
  const isCreditNote = invoice.invoiceType === "credit_note";
  const isTax = invoice.isTaxInvoice ?? isVATRegistered;
  const money = (n: number) => <Money amount={n} currency={invoice.currency} />;
  const contact = [company.contactPhone, company.contactEmail].filter(Boolean) as string[];

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
      <LedgerSheet data-testid="public-invoice">
        <LedgerHeader
          titleTestId="public-invoice-title"
          start={
            <LedgerCompany
              name={company.name}
              lines={[
                company.trnVatNumber && (
                  <>
                    {t["invoices.publicTrn"]} <bdi>{company.trnVatNumber}</bdi>
                  </>
                ),
                company.businessAddress,
                contact.length > 0 && (
                  <span className="flex flex-wrap gap-x-3">
                    {contact.map((c) => (
                      <bdi key={c} dir="ltr">
                        {c}
                      </bdi>
                    ))}
                  </span>
                ),
              ]}
            />
          }
          title={
            isCreditNote ? (
              <T k="portal.doc.taxCreditNote" />
            ) : isTax ? (
              <T k="portal.doc.taxInvoice" />
            ) : (
              <T k="invoices.publicInvoice" />
            )
          }
          aside={
            invoice.paymentStatus && (
              <StatusBadge
                tone={PAY_TONE[invoice.paymentStatus] ?? "neutral"}
                data-testid="public-invoice-payment-status"
              >
                <T k={`invoices.payStatus.${invoice.paymentStatus}`} />
              </StatusBadge>
            )
          }
        />

        <LedgerMeta
          items={[
            {
              label: isCreditNote ? t["portal.doc.creditNoteNo"] : t["portal.doc.invoiceNo"],
              value: <bdi>{invoice.number}</bdi>,
            },
            {
              label: t["portal.doc.issueDate"],
              value: <DateText value={invoice.date} locale={locale} />,
            },
            !!invoice.supplyDate && {
              label: t["invoices.publicSupplyDate"],
              value: <DateText value={invoice.supplyDate} locale={locale} />,
            },
            !!invoice.dueDate && {
              label: t["portal.doc.dueDate"],
              value: <DateText value={invoice.dueDate} locale={locale} />,
              testId: "public-invoice-due-date",
            },
            {
              label: t["portal.doc.currency"],
              value: <bdi>{currencyLabel(invoice.currency, locale === "ar" ? "ar" : "en")}</bdi>,
            },
          ]}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <LedgerParty
            label={<T k="portal.doc.from" />}
            name={company.name}
            lines={[
              company.trnVatNumber && (
                <>
                  {t["invoices.publicTrn"]} <bdi>{company.trnVatNumber}</bdi>
                </>
              ),
            ]}
          />
          <LedgerParty
            label={<T k="portal.doc.billTo" />}
            name={invoice.customerName}
            lines={[
              invoice.customerTrn && (
                <>
                  {t["invoices.publicTrn"]} <bdi>{invoice.customerTrn}</bdi>
                </>
              ),
            ]}
          />
        </div>

        <LedgerLines
          primaryKey="description"
          amountKey="amount"
          columns={[
            { key: "description", label: t["portal.doc.description"] },
            { key: "qty", label: t["portal.doc.qty"], numeric: true, mobile: true },
            { key: "price", label: t["portal.doc.unitPrice"], numeric: true, mobile: true },
            { key: "vat", label: t["portal.doc.vat"], numeric: true, mobile: true },
            { key: "amount", label: t["portal.doc.amount"], numeric: true },
          ]}
          rows={lines.map((line) => ({
            description: <span dir="auto">{line.description}</span>,
            qty: line.quantity,
            price: money(line.unitPrice),
            vat: <bdi>{((line.vatRate ?? 0.05) * 100).toFixed(0)}%</bdi>,
            amount: money(line.quantity * line.unitPrice),
          }))}
        />

        <LedgerTotals
          rows={[
            { label: t["portal.doc.subtotal"], value: money(invoice.subtotal) },
            { label: t["portal.doc.vat"], value: money(invoice.vatAmount) },
            { label: t["portal.doc.total"], value: money(invoice.total), strong: true },
            !isCreditNote &&
              !!invoice.amountPaid &&
              invoice.amountPaid > 0 && {
                label: t["portal.doc.paymentsReceived"],
                value: money(-invoice.amountPaid),
              },
          ]}
          due={
            invoice.amountDue !== undefined && !isCreditNote
              ? {
                  label: t["portal.doc.amountDue"],
                  value: money(invoice.amountDue),
                  testId: "public-invoice-amount-due",
                }
              : null
          }
        />

        {paymentResult === "success" && (
          <Alert tone="success" data-testid="public-invoice-payment-success">
            <T k="portal.paymentProcessing" />
          </Alert>
        )}
        {data.einvoice && (
          <p className="text-small text-muted-foreground" data-testid="public-invoice-einvoice">
            <T k="portal.doc.einvoice" />
            {t[`einvoicing.delivery_${data.einvoice.status}`]
              ? ` · ${t[`einvoicing.delivery_${data.einvoice.status}`]}`
              : ""}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-caption text-muted-foreground">
            <T k="portal.doc.thankYou" />
            {isVATRegistered && !isCreditNote && (
              <>
                {" "}
                <T k="portal.doc.keepForRecords" />
              </>
            )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {data.onlinePayment?.available && (
              <Button
                variant="outline"
                onClick={handlePay}
                disabled={paying}
                data-testid="public-invoice-pay-now"
              >
                <CreditCard className="h-4 w-4 me-2" aria-hidden />
                <T k="portal.payNow" />
                {data.onlinePayment.status === "sandbox" && (
                  <StatusBadge tone="neutral" className="ms-2">
                    <T k="portal.testMode" />
                  </StatusBadge>
                )}
              </Button>
            )}
            <Button onClick={handleDownloadPDF} data-testid="public-invoice-download">
              <Download className="h-4 w-4 me-2" aria-hidden />
              <T k="portal.doc.downloadPdf" />
            </Button>
          </div>
        </div>
        {payError && (
          <p className="text-small text-destructive" role="alert">
            {payError}
          </p>
        )}
      </LedgerSheet>
      <LedgerFooter>
        <T k="portal.doc.sentWith" />
      </LedgerFooter>
    </div>
  );
}
