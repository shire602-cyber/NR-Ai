import { currencyLabel } from "@/lib/format-money";
import { T } from "@/components/layout/T";
// The light public root does not load the app shell's stylesheets; the invoice card needs the
// mobile row-card tables and the RTL rules.
import "@/styles/rtl.css";
import "@/styles/mobile.css";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { DateText } from "@/components/documents/DateText";
import { useParams } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkLanguageSwitch } from "@/components/customer-link/LinkLanguageSwitch";
import { useDocumentTitle, useLinkLocale } from "@/lib/customer-link";
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
import { Download, AlertCircle, Clock, CreditCard, Printer, RefreshCw } from "lucide-react";
import { apiUrl } from "@/lib/api";

interface PublicInvoiceData {
  /** W4-D (R16-14): present only when a payment gateway is live or in sandbox. */
  onlinePayment?: { available: boolean; status: string; provider: string | null };
  einvoice?: { status: string; uuid: string | null } | null;
  /** The customer's own language when the firm recorded one (en | ar). */
  preferredLanguage?: string | null;
  /** The company's language (en | ar): the page opens in it until the viewer switches. */
  companyLocale?: string | null;
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
/** An answer from the invoice API: the HTTP status alone decides what the page says. */
class InvoiceHttpError extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

/** Catalogs this page reads (declared so an in-page language switch loads them). */
const INVOICE_NAMESPACES = ["portal", "customerLink"];

function InvoiceMessage({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Clock;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const { locale } = useTranslation(INVOICE_NAMESPACES);
  useDocumentTitle(title);
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background p-4"
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-testid="public-invoice-state"
    >
      <div className="flex w-full max-w-md justify-end">
        <LinkLanguageSwitch testId="invoice-language" />
      </div>
      <div className="w-full max-w-md rounded-lg border border-border bg-card px-6 py-12 text-center">
        <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="mb-2 text-h3 font-semibold text-foreground">{title}</h1>
        <p className="text-small text-muted-foreground">{body}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </main>
  );
}

function InvoiceSkeleton() {
  const { t, locale } = useTranslation(INVOICE_NAMESPACES);
  return (
    <main
      className="min-h-screen bg-background px-4 py-6 sm:py-10"
      dir={locale === "ar" ? "rtl" : "ltr"}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{t["customerLink.loading"]}</span>
      <div
        className="mx-auto w-full max-w-[760px] space-y-6 rounded-lg border border-border bg-card p-6"
        aria-hidden
      >
        <div className="flex justify-between gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-20 w-48 ms-auto" />
      </div>
    </main>
  );
}

export default function PublicInvoiceView() {
  const { t, locale } = useTranslation(INVOICE_NAMESPACES);
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error, refetch } = useQuery<PublicInvoiceData>({
    queryKey: ["public-invoice", token],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/public/invoices/${token}`));
      // Always read the body so the connection is released (an unread body keeps the page "busy").
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new InvoiceHttpError(res.status);
      return body as PublicInvoiceData;
    },
    enabled: !!token,
    retry: false,
  });

  // An invalid or expired link has no language of its own: the browser's decides.
  useLinkLocale(!!data || !!error, data?.preferredLanguage, data?.companyLocale);
  useDocumentTitle(
    data
      ? formatMessage(t["customerLink.invoicePageTitle"], {
          number: data.invoice.number,
          company: data.company.name,
        })
      : ""
  );

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState(false);
  const paymentResult =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("payment")
      : null;

  const handlePay = async () => {
    if (paying) return;
    setPaying(true);
    setPayError(false);
    try {
      const res = await fetch(apiUrl(`/api/portal/public-invoices/${token}/pay`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error("pay");
      window.location.assign(body.url);
    } catch {
      setPayError(true);
      setPaying(false);
    }
  };

  if (isLoading) return <InvoiceSkeleton />;

  if (error || !data) {
    const status = error instanceof InvoiceHttpError ? error.status : 0;
    if (status === 410)
      return (
        <InvoiceMessage
          icon={Clock}
          title={t["customerLink.expiredTitle"]}
          body={t["customerLink.invoiceExpiredBody"]}
        />
      );
    if (status === 404)
      return (
        <InvoiceMessage
          icon={AlertCircle}
          title={t["customerLink.invalidTitle"]}
          body={t["customerLink.invoiceInvalidBody"]}
        />
      );
    return (
      <InvoiceMessage
        icon={AlertCircle}
        title={status === 429 ? t["customerLink.busyTitle"] : t["customerLink.loadFailedTitle"]}
        body={status === 429 ? t["customerLink.busyBody"] : t["customerLink.loadFailedBody"]}
        action={
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => void refetch()}
            data-testid="public-invoice-retry"
          >
            <RefreshCw className="h-4 w-4 me-2" aria-hidden />
            {t["customerLink.retry"]}
          </Button>
        }
      />
    );
  }

  const { invoice, lines, company } = data;
  const isVATRegistered = !!company.trnVatNumber;
  const isCreditNote = invoice.invoiceType === "credit_note";
  const isTax = invoice.isTaxInvoice ?? isVATRegistered;
  const money = (n: number) => <Money amount={n} currency={invoice.currency} />;
  const contact = [company.contactPhone, company.contactEmail].filter(Boolean) as string[];

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 print:min-h-0 print:p-0 sm:py-10"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <div className="mx-auto mb-3 flex w-full max-w-[760px] items-center justify-end gap-1 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          className="hidden min-h-11 sm:inline-flex"
          onClick={() => window.print()}
          data-testid="public-invoice-print"
        >
          <Printer className="h-4 w-4" aria-hidden />
          <T k="customerLink.print" />
        </Button>
        <LinkLanguageSwitch testId="invoice-language" />
      </div>
      <LedgerSheet data-testid="public-invoice">
        <LedgerHeader
          titleTestId="public-invoice-title"
          start={
            <LedgerCompany
              name={company.name}
              lines={[
                company.trnVatNumber && (
                  <>
                    {t["customerLink.trn"]} <bdi>{company.trnVatNumber}</bdi>
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
              <T k="customerLink.invoiceTitle" />
            )
          }
          aside={
            invoice.paymentStatus && (
              <StatusBadge
                tone={PAY_TONE[invoice.paymentStatus] ?? "neutral"}
                data-testid="public-invoice-payment-status"
              >
                {invoice.paymentStatus === "void" ? (
                  <T k="customerLink.statusVoid" />
                ) : (
                  <T k={`portal.payStatus.${invoice.paymentStatus}`} />
                )}
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
              label: t["customerLink.invoiceSupplyDate"],
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
                  {t["customerLink.trn"]} <bdi>{company.trnVatNumber}</bdi>
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
                  {t["customerLink.trn"]} <bdi>{invoice.customerTrn}</bdi>
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
          <Alert tone="success" role="status" data-testid="public-invoice-payment-success">
            <T k="customerLink.paymentSuccess" />
          </Alert>
        )}
        {paymentResult === "cancelled" && (
          <Alert tone="warning" role="status" data-testid="public-invoice-payment-cancelled">
            <T k="customerLink.paymentCancelled" />
          </Alert>
        )}
        {data.einvoice && (
          <p className="text-small text-muted-foreground" data-testid="public-invoice-einvoice">
            <T k="portal.doc.einvoice" />
            {data.einvoice.status === "delivered"
              ? ` · ${t["customerLink.einvoiceDelivered"]}`
              : data.einvoice.status === "accepted" || data.einvoice.status === "cleared"
                ? ` · ${t["customerLink.einvoiceAccepted"]}`
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
          <div className="flex flex-col gap-2 print:hidden sm:flex-row">
            {data.onlinePayment?.available && (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={handlePay}
                disabled={paying}
                data-testid="public-invoice-pay-now"
              >
                <CreditCard className="h-4 w-4 me-2" aria-hidden />
                {paying ? <T k="customerLink.paying" /> : <T k="portal.payNow" />}
                {!paying && data.onlinePayment.status === "sandbox" && (
                  <StatusBadge tone="neutral" className="ms-2">
                    <T k="portal.testMode" />
                  </StatusBadge>
                )}
              </Button>
            )}
            <a
              href={apiUrl(`/api/public/invoices/${token}/pdf`)}
              download
              className={cn(buttonVariants(), "min-h-11")}
              data-testid="public-invoice-download"
            >
              <Download className="h-4 w-4 me-2" aria-hidden />
              <T k="customerLink.invoiceDownload" />
            </a>
          </div>
        </div>
        {payError && (
          <p className="text-small text-destructive print:hidden" role="alert">
            {t["customerLink.payFailed"]}
          </p>
        )}
      </LedgerSheet>
      <LedgerFooter>
        <T k="portal.doc.sentWith" />
      </LedgerFooter>
    </main>
  );
}
