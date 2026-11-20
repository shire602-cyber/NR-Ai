import { useMemo, useState } from "react";
import { CreditCard, FileCode2, FileDown, FileText, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { Money, MoneyCell } from "@/components/ui/money";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateText } from "@/components/documents/DateText";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { downloadPortalFile } from "@/lib/portal-files";
import { formatMessage, useTranslation } from "@/lib/i18n";

export interface PortalInvoice {
  id: string;
  number: string;
  invoiceType: string;
  date: string | null;
  dueDate: string | null;
  currency: string;
  total: number;
  amountDue: number;
  paymentStatus: "paid" | "partially_paid" | "overdue" | "unpaid" | "credit";
  einvoice: { status: string; hasXml: boolean } | null;
}

const STATUS_TONE: Record<string, StatusTone> = {
  paid: "success",
  unpaid: "warning",
  partially_paid: "warning",
  overdue: "danger",
  credit: "neutral",
};

interface Job {
  (): Promise<boolean>;
}

type Filter = "all" | "unpaid" | "overdue" | "paid" | "credit";
const FILTERS: Filter[] = ["all", "unpaid", "overdue", "paid", "credit"];

const matches = (inv: PortalInvoice, f: Filter): boolean =>
  f === "all"
    ? true
    : f === "unpaid"
      ? inv.paymentStatus === "unpaid" ||
        inv.paymentStatus === "partially_paid" ||
        inv.paymentStatus === "overdue"
      : f === "overdue"
        ? inv.paymentStatus === "overdue"
        : f === "paid"
          ? inv.paymentStatus === "paid"
          : inv.paymentStatus === "credit";

/**
 * The customer's invoices and credit notes: filter tabs with counts, search by number, a table on
 * wide screens and cards on phones, PDF and e-invoice XML downloads with a spinner on the row, and
 * Pay now only when the supplier has an online gateway and the document has an open balance.
 */
export function PortalInvoiceList({
  invoices,
  loading,
  onlinePayment,
}: {
  invoices: PortalInvoice[];
  loading?: boolean;
  onlinePayment: boolean;
}) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f, invoices.filter((i) => matches(i, f)).length])),
    [invoices]
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((i) => matches(i, filter) && (!q || i.number.toLowerCase().includes(q)));
  }, [invoices, filter, search]);

  const run = async (key: string, job: Job) => {
    setBusy(key);
    const failureTitle =
      t[key.startsWith("pdf:") ? "portal.doc.downloadFailed" : "portal.list.downloadFailed"];
    try {
      if (!(await job())) toast({ title: failureTitle, variant: "destructive" });
    } catch {
      toast({ title: failureTitle, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const pay = (inv: PortalInvoice) =>
    run(`pay:${inv.id}`, async () => {
      const res = (await apiRequest("POST", `/api/client-portal/invoices/${inv.id}/pay`, {})) as {
        url?: string;
      };
      if (!res?.url) return false;
      window.location.assign(res.url);
      return true;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex gap-1 overflow-x-auto [scrollbar-width:none]"
          role="tablist"
          aria-label={t["portal.list.filters"]}
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-small font-medium ${
                filter === f
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60"
              }`}
              data-testid={`portal-filter-${f}`}
            >
              {t[`portal.list.filter.${f}`]}
              <span className="rounded-full bg-background px-1.5 text-caption tabular-nums">
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t["portal.list.search"]}
            aria-label={t["portal.list.search"]}
            className="h-11 ps-9 text-base"
            dir="auto"
            data-testid="portal-invoice-search"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4" aria-busy="true">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={t["portal.doc.noInvoicesTitle"]}
              description={t["portal.doc.noInvoicesBody"]}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              size="sm"
              icon={FileText}
              title={t["portal.list.noMatches"]}
              action={{
                label: t["portal.list.clearFilters"],
                onClick: () => {
                  setFilter("all");
                  setSearch("");
                },
              }}
            />
          ) : (
            <Table className="row-cards" data-testid="portal-invoice-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t["portal.doc.invoiceCol"]}</TableHead>
                  <TableHead>{t["portal.doc.date"]}</TableHead>
                  <TableHead>{t["portal.doc.dueDate"]}</TableHead>
                  <TableHead data-numeric="">{t["portal.list.total"]}</TableHead>
                  <TableHead data-numeric="">{t["portal.doc.amountDue"]}</TableHead>
                  <TableHead>{t["portal.doc.status"]}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.actions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((inv) => {
                  const isCredit = inv.paymentStatus === "credit";
                  const canPay = onlinePayment && !isCredit && inv.amountDue > 0;
                  return (
                    <TableRow key={inv.id} data-testid={`portal-invoice-row-${inv.id}`}>
                      <TableCell data-cell="title" className="font-medium text-foreground">
                        <MiddleTruncate text={String(inv.number ?? "")} />
                        {isCredit ? (
                          <span className="ms-2 text-caption text-muted-foreground">
                            {t["portal.payStatus.credit"]}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell
                        data-nowrap=""
                        data-cell="meta"
                        data-keep=""
                        className="text-muted-foreground"
                      >
                        {inv.date ? <DateText value={inv.date} locale={locale} /> : "—"}
                      </TableCell>
                      <TableCell data-nowrap="" className="text-muted-foreground">
                        {inv.dueDate && !isCredit ? (
                          <DateText value={inv.dueDate} locale={locale} />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell data-numeric="" data-nowrap="">
                        <Money
                          amount={isCredit ? -Math.abs(Number(inv.total)) : Number(inv.total)}
                          currency={inv.currency}
                        />
                      </TableCell>
                      <MoneyCell
                        amount={Number(inv.amountDue) || 0}
                        currency={inv.currency ?? "AED"}
                        className="font-semibold text-foreground"
                        data-cell="amount"
                      />
                      <TableCell data-nowrap="" data-cell="status">
                        <StatusBadge tone={STATUS_TONE[inv.paymentStatus] ?? "neutral"}>
                          {t[`portal.payStatus.${inv.paymentStatus}`] ?? t["portal.doc.status"]}
                        </StatusBadge>
                      </TableCell>
                      <TableCell data-cell="actions">
                        <div className="flex flex-wrap items-center gap-2">
                          {canPay ? (
                            <Button
                              size="sm"
                              className="min-h-11"
                              disabled={busy !== null}
                              onClick={() => void pay(inv)}
                              data-testid={`portal-pay-${inv.id}`}
                            >
                              {busy === `pay:${inv.id}` ? (
                                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <CreditCard className="me-1.5 h-4 w-4" aria-hidden />
                              )}
                              {t["portal.list.payNow"]}
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            disabled={busy !== null}
                            aria-label={`${t["portal.doc.downloadPdf"]} ${inv.number}`}
                            onClick={() =>
                              void run(`pdf:${inv.id}`, () =>
                                downloadPortalFile(
                                  `/api/client-portal/invoices/${inv.id}/pdf`,
                                  `invoice-${inv.number}.pdf`
                                )
                              )
                            }
                            data-testid={`portal-pdf-${inv.id}`}
                          >
                            {busy === `pdf:${inv.id}` ? (
                              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <FileDown className="me-1.5 h-4 w-4" aria-hidden />
                            )}
                            PDF
                          </Button>
                          {inv.einvoice?.hasXml ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-11"
                              disabled={busy !== null}
                              aria-label={`${t["portal.list.einvoiceXml"]} ${inv.number}`}
                              onClick={() =>
                                void run(`xml:${inv.id}`, () =>
                                  downloadPortalFile(
                                    `/api/client-portal/invoices/${inv.id}/einvoice`,
                                    `einvoice-${inv.number}.xml`
                                  )
                                )
                              }
                            >
                              <FileCode2 className="me-1.5 h-4 w-4" aria-hidden />
                              XML
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="sr-only" role="status">
        {formatMessage(t["portal.list.resultCount"], { count: rows.length })}
      </p>
    </div>
  );
}
