import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ClipboardList, Download, FileText, MoreHorizontal, Pencil, Plus, Truck, XCircle, CheckCircle2, Trash2, Receipt } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AvailabilityBadge } from "@/components/sales/AvailabilityBadge";
import { SalesOrderEditor } from "@/components/sales/SalesOrderEditor";
import { SalesOrderQuantitiesDialog, type QuantityMode } from "@/components/sales/SalesOrderQuantitiesDialog";
import { messages as sharedMessages } from "@/components/sales/SalesShared.i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/format";
import { downloadPdf } from "@/lib/download-pdf";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  deliveryStatusTone,
  invoicingStatusTone,
  salesErrorMessage,
  salesKeys,
  salesOrderActions,
  salesOrderStatusTone,
  type SalesOrderDetail,
  type SalesOrderSummary,
} from "@/lib/sales-api";
import { messages } from "./SalesOrders.i18n";

type StatusFilter = "all" | "open" | "closed" | "cancelled";

export default function SalesOrders() {
  const tr = messages.useT();
  const shared = sharedMessages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SalesOrderDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<{ mode: QuantityMode; order: SalesOrderDetail } | null>(null);

  const listKey = salesKeys.salesOrders(companyId);
  const { data: orders = [], isLoading } = useQuery<SalesOrderSummary[]>({
    queryKey: [...listKey, filter],
    enabled: !!companyId,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/sales-orders${filter === "all" ? "" : `?status=${filter}`}`),
  });
  const detail = useQuery<SalesOrderDetail>({
    queryKey: [...listKey, "detail", detailId],
    enabled: !!companyId && !!detailId,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/sales-orders/${detailId}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: listKey });
  const fail = (title: string) => (error: unknown) => toast({ variant: "destructive", title, description: salesErrorMessage(error, (k) => shared(k), shared("pleaseTryAgain")) });

  const act = useMutation({
    mutationFn: (args: { id: string; action: "close" | "cancel" | "delete" }) =>
      args.action === "delete"
        ? apiRequest("DELETE", `/api/companies/${companyId}/sales-orders/${args.id}`)
        : apiRequest("POST", `/api/companies/${companyId}/sales-orders/${args.id}/${args.action}`),
    onSuccess: (_r, args) => {
      toast({ title: args.action === "close" ? tr("closed") : args.action === "cancel" ? tr("cancelled") : tr("deleted") });
      if (args.action === "delete") setDetailId(null);
      refresh();
    },
    onError: fail(tr("actionFailed")),
  });

  const openOrder = async (id: string, then: (o: SalesOrderDetail) => void) => {
    try {
      then(await apiRequest("GET", `/api/companies/${companyId}/sales-orders/${id}`));
    } catch (error) {
      fail(tr("loadFailed"))(error);
    }
  };

  const pdf = (path: string, name: string) => downloadPdf(path, name).catch((e: Error) => toast({ variant: "destructive", title: tr("pdfFailed"), description: e.message }));

  const statusLabel = (s: string) => (s === "open" ? tr("statusOpen") : s === "closed" ? tr("statusClosed") : tr("statusCancelled"));
  const invoicingLabel = (s: string) => (s === "invoiced" ? tr("invoicingInvoiced") : s === "partially_invoiced" ? tr("invoicingPartial") : tr("invoicingNone"));
  const deliveryLabel = (s: string) => (s === "delivered" ? tr("deliveryDone") : s === "partially_delivered" ? tr("deliveryPartial") : tr("deliveryNone"));

  const d = detail.data;

  return (
    <div className="space-y-6" data-testid="page-sales-orders">
      <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} icon={ClipboardList} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <SelectTrigger className="w-44" aria-label={tr("filterStatus")} data-testid="select-so-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("filterAll")}</SelectItem>
            <SelectItem value="open">{tr("statusOpen")}</SelectItem>
            <SelectItem value="closed">{tr("statusClosed")}</SelectItem>
            <SelectItem value="cancelled">{tr("statusCancelled")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
          data-testid="button-new-sales-order"
        >
          <Plus className="me-2 h-4 w-4" />
          {tr("newOrder")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-72" />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={tr("emptyTitle")}
          description={tr("emptyBody")}
          action={{ label: tr("newOrder"), onClick: () => setEditorOpen(true) }}
          testId="empty-sales-orders"
        />
      ) : (
        <>
          {/* Phone: one card per order */}
          <div className="grid gap-3 lg:hidden" data-testid="mobile-sales-orders">
            {orders.map((o) => (
              <Card key={o.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <button className="text-start" onClick={() => setDetailId(o.id)}>
                    <p className="font-mono text-sm font-semibold" dir="ltr">{o.number}</p>
                    <p className="text-sm">{o.customerName}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(o.date, locale)}</p>
                  </button>
                  <p className="font-mono text-sm font-semibold" dir="ltr">{formatCurrency(Number(o.total), o.currency, locale)}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge tone={salesOrderStatusTone(o.status)}>{statusLabel(o.status)}</StatusBadge>
                  <StatusBadge tone={invoicingStatusTone(o.invoicingStatus)}>{invoicingLabel(o.invoicingStatus)}</StatusBadge>
                  <StatusBadge tone={deliveryStatusTone(o.deliveryStatus)}>{deliveryLabel(o.deliveryStatus)}</StatusBadge>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden lg:block">
            <div className="overflow-x-auto">
              <Table className="whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("colNumber")}</TableHead>
                    <TableHead>{tr("colCustomer")}</TableHead>
                    <TableHead>{tr("colDate")}</TableHead>
                    <TableHead>{tr("colExpected")}</TableHead>
                    <TableHead className="text-end">{tr("colTotal")}</TableHead>
                    <TableHead>{tr("colStatus")}</TableHead>
                    <TableHead>{tr("colInvoicing")}</TableHead>
                    <TableHead>{tr("colDelivery")}</TableHead>
                    <TableHead className="text-end">{tr("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => {
                    const actions = salesOrderActions(o);
                    return (
                      <TableRow key={o.id} data-testid={`so-row-${o.number}`}>
                        <TableCell className="font-mono font-medium" dir="ltr">
                          <button className="underline-offset-2 hover:underline" onClick={() => setDetailId(o.id)} data-testid={`button-open-so-${o.number}`}>
                            {o.number}
                          </button>
                        </TableCell>
                        <TableCell>{o.customerName}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(o.date, locale)}</TableCell>
                        <TableCell className="text-muted-foreground">{o.expectedDate ? formatDate(o.expectedDate, locale) : "-"}</TableCell>
                        <TableCell className="text-end font-mono" dir="ltr">{formatCurrency(Number(o.total), o.currency, locale)}</TableCell>
                        <TableCell><StatusBadge tone={salesOrderStatusTone(o.status)}>{statusLabel(o.status)}</StatusBadge></TableCell>
                        <TableCell><StatusBadge tone={invoicingStatusTone(o.invoicingStatus)}>{invoicingLabel(o.invoicingStatus)}</StatusBadge></TableCell>
                        <TableCell><StatusBadge tone={deliveryStatusTone(o.deliveryStatus)}>{deliveryLabel(o.deliveryStatus)}</StatusBadge></TableCell>
                        <TableCell className="text-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" aria-label={tr("rowActions", { number: o.number })}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setDetailId(o.id)}><FileText className="me-2 h-4 w-4" />{tr("view")}</DropdownMenuItem>
                              {actions.edit && (
                                <DropdownMenuItem onClick={() => openOrder(o.id, (full) => { setEditing(full); setEditorOpen(true); })}>
                                  <Pencil className="me-2 h-4 w-4" />{tr("edit")}
                                </DropdownMenuItem>
                              )}
                              {actions.invoice && (
                                <DropdownMenuItem onClick={() => openOrder(o.id, (full) => setQuantities({ mode: "invoice", order: full }))} data-testid={`menu-so-invoice-${o.number}`}>
                                  <Receipt className="me-2 h-4 w-4" />{tr("createInvoice")}
                                </DropdownMenuItem>
                              )}
                              {actions.deliver && (
                                <DropdownMenuItem onClick={() => openOrder(o.id, (full) => setQuantities({ mode: "deliver", order: full }))} data-testid={`menu-so-deliver-${o.number}`}>
                                  <Truck className="me-2 h-4 w-4" />{tr("createDelivery")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => pdf(`/api/companies/${companyId}/sales-orders/${o.id}/pdf`, `sales-order-${o.number}.pdf`)} data-testid={`menu-so-pdf-${o.number}`}>
                                <Download className="me-2 h-4 w-4" />{tr("downloadPdf")}
                              </DropdownMenuItem>
                              {actions.close && (
                                <DropdownMenuItem onClick={() => act.mutate({ id: o.id, action: "close" })}><CheckCircle2 className="me-2 h-4 w-4" />{tr("closeOrder")}</DropdownMenuItem>
                              )}
                              {actions.cancel && (
                                <DropdownMenuItem onClick={() => act.mutate({ id: o.id, action: "cancel" })}><XCircle className="me-2 h-4 w-4" />{tr("cancelOrder")}</DropdownMenuItem>
                              )}
                              {actions.remove && (
                                <DropdownMenuItem className="text-destructive" onClick={() => window.confirm(tr("confirmDelete")) && act.mutate({ id: o.id, action: "delete" })}>
                                  <Trash2 className="me-2 h-4 w-4" />{tr("delete")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {companyId && <SalesOrderEditor companyId={companyId} open={editorOpen} order={editing} onClose={() => { setEditorOpen(false); setEditing(null); }} />}
      {companyId && <SalesOrderQuantitiesDialog companyId={companyId} order={quantities?.order ?? null} mode={quantities?.mode ?? "invoice"} onClose={() => setQuantities(null)} onDone={() => { refresh(); if (quantities) setDetailId(quantities.order.id); }} />}

      <Dialog open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto" data-testid="so-detail">
          <DialogHeader>
            <DialogTitle>{d ? tr("detailTitle", { number: d.number }) : tr("loading")}</DialogTitle>
            <DialogDescription>{d ? `${d.customerName} - ${formatDate(d.date, locale)}` : ""}</DialogDescription>
          </DialogHeader>
          {d && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={salesOrderStatusTone(d.status)}>{statusLabel(d.status)}</StatusBadge>
                <StatusBadge tone={invoicingStatusTone(d.invoicingStatus)}>{invoicingLabel(d.invoicingStatus)}</StatusBadge>
                <StatusBadge tone={deliveryStatusTone(d.deliveryStatus)}>{deliveryLabel(d.deliveryStatus)}</StatusBadge>
                {d.quoteId && <span className="text-xs text-muted-foreground">{tr("fromQuote")}</span>}
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("lineDescription")}</TableHead>
                      <TableHead className="text-end">{tr("lineOrdered")}</TableHead>
                      <TableHead className="text-end">{tr("lineInvoiced")}</TableHead>
                      <TableHead className="text-end">{tr("lineDelivered")}</TableHead>
                      <TableHead>{tr("lineAvailability")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.lines.filter((l) => l.lineKind === "item" || l.lineKind === "shipping").map((l) => (
                      <TableRow key={l.id} data-testid={`so-detail-line-${l.id}`}>
                        <TableCell>{l.description}</TableCell>
                        <TableCell className="text-end font-mono" dir="ltr">{Number(l.quantity)}</TableCell>
                        <TableCell className="text-end font-mono" dir="ltr">{l.invoicedQty ?? 0}</TableCell>
                        <TableCell className="text-end font-mono" dir="ltr">{l.lineKind === "item" ? (l.deliveredQty ?? 0) : "-"}</TableCell>
                        <TableCell>
                          {l.availableToPromise !== null && l.availableToPromise !== undefined ? (
                            <span className="flex flex-wrap items-center gap-2" data-testid={`so-atp-${l.id}`}>
                              <span className="text-xs text-muted-foreground">{tr("atp", { qty: Math.max(0, l.availableToPromise) })}</span>
                              <AvailabilityBadge requested={l.remainingQty ?? Number(l.quantity)} availability={{ available: l.availableToPromise }} />
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <section className="space-y-2">
                  <h3 className="font-medium">{tr("invoicesHeading")}</h3>
                  {d.invoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tr("noInvoicesYet")}</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {d.invoices.map((i) => (
                        <li key={i.id} className="flex items-center justify-between rounded-md border px-3 py-2" data-testid={`so-invoice-${i.number}`}>
                          <Link href="/invoices" className="font-mono underline-offset-2 hover:underline" dir="ltr">{i.number}</Link>
                          <span className="text-muted-foreground">{i.status}</span>
                          <span className="font-mono" dir="ltr">{formatCurrency(Number(i.total), d.currency, locale)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="font-medium">{tr("deliveriesHeading")}</h3>
                  {d.deliveries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tr("noDeliveriesYet")}</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {d.deliveries.map((n) => (
                        <li key={n.id} className="flex items-center justify-between rounded-md border px-3 py-2" data-testid={`so-delivery-${n.number}`}>
                          <span className="font-mono" dir="ltr">{n.number}</span>
                          <span className="text-muted-foreground">{formatDate(n.date, locale)}</span>
                          <Button variant="ghost" size="sm" onClick={() => pdf(`/api/companies/${companyId}/sales-orders/${d.id}/deliveries/${n.id}/pdf`, `delivery-note-${n.number}.pdf`)} aria-label={tr("deliveryPdf", { number: n.number })}>
                            <Download className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                {salesOrderActions(d).invoice && <Button onClick={() => { setQuantities({ mode: "invoice", order: d }); setDetailId(null); }} data-testid="button-detail-invoice"><Receipt className="me-2 h-4 w-4" />{tr("createInvoice")}</Button>}
                {salesOrderActions(d).deliver && <Button variant="outline" onClick={() => { setQuantities({ mode: "deliver", order: d }); setDetailId(null); }} data-testid="button-detail-deliver"><Truck className="me-2 h-4 w-4" />{tr("createDelivery")}</Button>}
                <Button variant="outline" onClick={() => pdf(`/api/companies/${companyId}/sales-orders/${d.id}/pdf`, `sales-order-${d.number}.pdf`)} data-testid="button-detail-pdf"><Download className="me-2 h-4 w-4" />{tr("downloadPdf")}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
