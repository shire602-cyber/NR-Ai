import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Plus, ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation, formatMessage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { ApiError, apiRequest, getQueryFn } from "@/lib/queryClient";
import { classifyLoadError } from "@/lib/loadError";
import { localizeApiError } from "@/lib/validation-messages";
import { formatDate } from "@/lib/format-date";
import { formatCurrency } from "@/lib/format";
import { uaeToday } from "@shared/uae-date";

interface ReliefClaim {
  id: string;
  invoiceId: string;
  claimDate: string;
  outstandingAmount: number | string;
  vatAmount: number | string;
  status: "claimed" | "reversed" | string;
  reversedAt: string | null;
  reversalReason: string | null;
  invoiceNumber: string | null;
  customerName: string | null;
  remainingRelief: number | string | null;
}

interface EligibleInvoice {
  id: string;
  number: string;
  customerName: string | null;
  date: string;
}

const today = () => uaeToday();

/** Mirrors the LIMIT in `listReliefEligibleInvoices`. */
const ELIGIBLE_PICKER_CAP = 500;

/** The server's fixed English closure reason, mapped to catalog copy for display. */
const PAYMENT_CLOSURE_REASON = "Payment received after bad-debt relief was claimed";

/** Catalog copy for the server code; else the (already localized) message the API client built. */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return localizeApiError(error.body) ?? (error.message || fallback);
  return fallback;
}

export default function VatBadDebtRelief() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { companyId, error: companyError, isLoading: isLoadingCompany } = useDefaultCompany();
  const { gate } = useCompanyPermission();
  const [createOpen, setCreateOpen] = useState(false);
  const [reversing, setReversing] = useState<ReliefClaim | null>(null);

  const claimsKey = ["/api/companies", companyId, "vat", "bad-debt-relief"];
  const claimsQuery = useQuery<ReliefClaim[]>({
    queryKey: claimsKey,
    queryFn: getQueryFn<ReliefClaim[]>({ on401: "throw" }),
    enabled: !!companyId,
  });
  // The server decides which return a date lands in (and refuses filed or locked periods), so the
  // screen names the date, not a predicted return.
  const periodLabel = (date: string) =>
    formatMessage(t["vatBadDebtRelief.periodNeutral"], { date: formatDate(date, locale) });

  const claims = Array.isArray(claimsQuery.data) ? claimsQuery.data : undefined;

  const refresh = async () => {
    await queryClient.cancelQueries({ queryKey: claimsKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: claimsKey });
  };

  // Offline and server failures are transient, so cached rows stay usable; denied access or a
  // missing company replaces them.
  const error = claimsQuery.error;
  const errorKind = error ? classifyLoadError(error) : null;
  const isBlocked = errorKind === "forbidden" || errorKind === "notFound";
  const refreshFailed = claimsQuery.isRefetchError && !isBlocked;
  const blockingError = !companyId
    ? companyError
    : claimsQuery.isLoadingError || isBlocked
      ? error
      : null;
  const isWaiting = !blockingError && !!companyId && claimsQuery.fetchStatus === "paused";
  const emptyUnresolved =
    !!claims && claims.length === 0 && (refreshFailed || claimsQuery.fetchStatus !== "idle");
  const showList = !!claims && !blockingError && !emptyUnresolved;

  if (!isWaiting && (isLoadingCompany || (claimsQuery.isPending && !blockingError))) {
    return (
      <div className="space-y-6" data-testid="relief-loading">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.complianceEyebrow}
        title={t["vatBadDebtRelief.title"]}
        description={t["vatBadDebtRelief.description"]}
        primaryAction={
          companyId ? (
            <Button
              onClick={() => setCreateOpen(true)}
              data-testid="button-claim-relief"
              {...gate("ledger.post")}
            >
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t["vatBadDebtRelief.create"]}
            </Button>
          ) : undefined
        }
      />

      {isWaiting ? (
        <div role="status" data-testid="relief-waiting">
          <EmptyState
            icon={Clock}
            title={t["vatBadDebtRelief.waitingTitle"]}
            description={t["vatBadDebtRelief.waitingBody"]}
          />
        </div>
      ) : null}

      {refreshFailed ? (
        <div
          role="alert"
          data-testid="relief-refresh-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-danger-subtle px-4 py-3 text-start text-small text-danger-subtle-foreground"
        >
          <p>{t["vatBadDebtRelief.refreshFailed"]}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => claimsQuery.refetch()}
            disabled={claimsQuery.fetchStatus !== "idle"}
            data-testid="button-retry-refresh"
          >
            {t["firm.retry"]}
          </Button>
        </div>
      ) : null}

      {blockingError ? (
        <LoadErrorState
          error={blockingError}
          onRetry={() =>
            companyId
              ? claimsQuery.refetch()
              : queryClient.refetchQueries({ queryKey: ["/api/companies"], exact: true })
          }
          testId="relief-load-error"
        />
      ) : null}

      {showList ? (
        claims.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={t["vatBadDebtRelief.emptyTitle"]}
            description={t["vatBadDebtRelief.emptyBody"]}
          />
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["vatBadDebtRelief.colInvoice"]}</TableHead>
                    <TableHead>{t["vatBadDebtRelief.colCustomer"]}</TableHead>
                    <TableHead data-numeric>{t["vatBadDebtRelief.colWrittenOff"]}</TableHead>
                    <TableHead data-numeric>{t["vatBadDebtRelief.colRelief"]}</TableHead>
                    <TableHead>{t["vatBadDebtRelief.colClaimDate"]}</TableHead>
                    <TableHead>{t["vatBadDebtRelief.colPeriod"]}</TableHead>
                    <TableHead>{t["vatBadDebtRelief.colStatus"]}</TableHead>
                    <TableHead>{t["vatBadDebtRelief.colReversal"]}</TableHead>
                    <TableHead>{t["vatBadDebtRelief.colActions"]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.map((claim) => {
                    const claimed = claim.status === "claimed";
                    return (
                      <TableRow key={claim.id} data-testid={`relief-row-${claim.id}`}>
                        <TableCell>
                          <Link
                            href={`/invoices/${claim.invoiceId}`}
                            className="text-primary underline"
                            aria-label={
                              claim.invoiceNumber
                                ? formatMessage(t["vatBadDebtRelief.openInvoice"], {
                                    invoice: claim.invoiceNumber,
                                  })
                                : undefined
                            }
                          >
                            {claim.invoiceNumber ? (
                              <bdi>{claim.invoiceNumber}</bdi>
                            ) : (
                              t["vatBadDebtRelief.unknownInvoice"]
                            )}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <bdi>{claim.customerName ?? "—"}</bdi>
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={Number(claim.outstandingAmount)} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={Number(claim.vatAmount)} />
                        </TableCell>
                        <TableCell>{formatDate(claim.claimDate, locale)}</TableCell>
                        <TableCell data-testid={`relief-period-${claim.id}`}>
                          {periodLabel(claim.claimDate)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={claimed ? "default" : "secondary"}>
                            {claimed
                              ? t["vatBadDebtRelief.statusClaimed"]
                              : t["vatBadDebtRelief.statusReversed"]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {claim.reversedAt ? (
                            <div className="space-y-1 text-small">
                              <p>
                                {formatMessage(t["vatBadDebtRelief.reversalLine"], {
                                  date: formatDate(claim.reversedAt, locale),
                                })}
                              </p>
                              <p className="text-muted-foreground">
                                {claim.reversalReason === PAYMENT_CLOSURE_REASON
                                  ? // Closed by customer payments: the add-backs were posted on each
                                    // payment date, so no single return carries them.
                                    t["vatBadDebtRelief.reversalPeriodRecovered"]
                                  : periodLabel(claim.reversedAt)}
                              </p>
                              {claim.reversalReason ? (
                                <p className="text-muted-foreground">
                                  {formatMessage(t["vatBadDebtRelief.reversalReason"], {
                                    reason:
                                      claim.reversalReason === PAYMENT_CLOSURE_REASON
                                        ? t["vatBadDebtRelief.reasonPayment"]
                                        : claim.reversalReason,
                                  })}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {claimed ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setReversing(claim)}
                              data-testid={`button-reverse-${claim.id}`}
                              {...gate("ledger.post")}
                            >
                              {t["vatBadDebtRelief.reverse"]}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      ) : null}

      {companyId && createOpen ? (
        <CreateClaimDialog
          companyId={companyId}
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            void refresh();
            toast({ title: t["vatBadDebtRelief.createDone"] });
          }}
          onError={(e) =>
            toast({
              variant: "destructive",
              title: t["vatBadDebtRelief.createFailed"],
              description: errorText(e, t["vatBadDebtRelief.createFailed"]),
            })
          }
        />
      ) : null}

      {companyId && reversing ? (
        <ReverseClaimDialog
          companyId={companyId}
          claim={reversing}
          onClose={() => setReversing(null)}
          onDone={() => {
            setReversing(null);
            void refresh();
            toast({ title: t["vatBadDebtRelief.reverseDone"] });
          }}
          onError={(e) => {
            toast({
              variant: "destructive",
              title: t["vatBadDebtRelief.reverseFailed"],
              description: errorText(e, t["vatBadDebtRelief.reverseFailed"]),
            });
            // A stale row (already reversed elsewhere) is fixed by reloading the list.
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function ReverseClaimDialog({
  companyId,
  claim,
  onClose,
  onDone,
  onError,
}: {
  companyId: string;
  claim: ReliefClaim;
  onClose: () => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const { t, locale } = useTranslation();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/vat/bad-debt-relief/${claim.id}/reverse`, {
        date,
        reason: trimmed,
      }),
    onSuccess: onDone,
    onError,
  });
  // The server never dates a reversal before the claim.
  const effectiveDate = date < String(claim.claimDate) ? String(claim.claimDate) : date;
  const remaining = Number(claim.remainingRelief ?? 0);
  const invoice = claim.invoiceNumber || t["vatBadDebtRelief.unknownInvoice"];
  // Mirrors reverseBadDebtReliefClaim: only relief not yet recovered through customer payments
  // is added back; with nothing left the claim just closes.
  const effect =
    remaining > 0
      ? formatMessage(t["vatBadDebtRelief.reverseBody"], {
          invoice,
          amount: formatCurrency(remaining, "AED", locale),
          date: formatDate(effectiveDate, locale),
        })
      : formatMessage(t["vatBadDebtRelief.reverseBodyNothing"], { invoice });
  return (
    <Dialog open onOpenChange={(open) => (!open && !mutation.isPending ? onClose() : undefined)}>
      <DialogContent data-testid="reverse-dialog">
        <DialogHeader>
          <DialogTitle>{t["vatBadDebtRelief.reverseTitle"]}</DialogTitle>
          <DialogDescription data-testid="reverse-effect">{effect}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="relief-reverse-date">{t["vatBadDebtRelief.reverseDate"]}</Label>
            <DatePicker
              id="relief-reverse-date"
              value={date}
              onChange={setDate}
              data-testid="input-reverse-date"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="relief-reverse-reason">{t["vatBadDebtRelief.reverseReason"]}</Label>
            <Textarea
              id="relief-reverse-reason"
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
              data-testid="input-reverse-reason"
            />
            <p className="text-small text-muted-foreground">
              {t["vatBadDebtRelief.reverseReasonHint"]}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t["vatBadDebtRelief.cancel"]}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !date || trimmed.length < 3}
            data-testid="button-confirm-reverse"
          >
            {t["vatBadDebtRelief.reverseConfirm"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateClaimDialog({
  companyId,
  onClose,
  onDone,
  onError,
}: {
  companyId: string;
  onClose: () => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const [invoiceId, setInvoiceId] = useState("");
  const [claimDate, setClaimDate] = useState(today);
  const [writtenOff, setWrittenOff] = useState(false);
  const [customerNotified, setCustomerNotified] = useState(false);
  const [notifiedAt, setNotifiedAt] = useState("");
  const [notes, setNotes] = useState("");
  // Written-off invoices without an active claim; the server decides the rest (six months from
  // supply, VAT on the invoice).
  const eligibleQuery = useQuery<EligibleInvoice[]>({
    queryKey: ["/api/companies", companyId, "vat", "bad-debt-relief", "eligible-invoices"],
    queryFn: getQueryFn<EligibleInvoice[]>({ on401: "throw" }),
  });
  const choices = Array.isArray(eligibleQuery.data) ? eligibleQuery.data : [];
  // The server lists at most this many (newest first); say so when the list may be cut short.
  const capped = choices.length >= ELIGIBLE_PICKER_CAP;
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/vat/bad-debt-relief`, {
        invoiceId,
        claimDate,
        writtenOff,
        customerNotified,
        customerNotifiedAt: notifiedAt || null,
        notes: notes.trim() || null,
      }),
    onSuccess: onDone,
    onError,
  });
  return (
    <Dialog open onOpenChange={(open) => (!open && !mutation.isPending ? onClose() : undefined)}>
      <DialogContent data-testid="create-dialog">
        <DialogHeader>
          <DialogTitle>{t["vatBadDebtRelief.createTitle"]}</DialogTitle>
          <DialogDescription>{t["vatBadDebtRelief.createIntro"]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="relief-invoice">{t["vatBadDebtRelief.createInvoice"]}</Label>
            <Select value={invoiceId} onValueChange={setInvoiceId}>
              <SelectTrigger id="relief-invoice" data-testid="select-relief-invoice">
                <SelectValue placeholder={t["vatBadDebtRelief.createInvoicePlaceholder"]} />
              </SelectTrigger>
              <SelectContent>
                {choices.length === 0 ? (
                  <div className="px-3 py-2 text-small text-muted-foreground">
                    {t["vatBadDebtRelief.createNoInvoices"]}
                  </div>
                ) : (
                  choices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.number} · {i.customerName ?? "—"}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {capped ? (
              <p className="text-small text-muted-foreground" data-testid="relief-picker-capped">
                {t["vatBadDebtRelief.createCapNote"]}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="relief-claim-date">{t["vatBadDebtRelief.createClaimDate"]}</Label>
            <DatePicker
              id="relief-claim-date"
              value={claimDate}
              onChange={setClaimDate}
              data-testid="input-claim-date"
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="relief-written-off"
              checked={writtenOff}
              onCheckedChange={(v) => setWrittenOff(v === true)}
              data-testid="check-written-off"
            />
            <Label htmlFor="relief-written-off">{t["vatBadDebtRelief.createWrittenOff"]}</Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="relief-notified"
              checked={customerNotified}
              onCheckedChange={(v) => setCustomerNotified(v === true)}
              data-testid="check-notified"
            />
            <Label htmlFor="relief-notified">{t["vatBadDebtRelief.createNotified"]}</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="relief-notified-at">{t["vatBadDebtRelief.createNotifiedAt"]}</Label>
            <DatePicker id="relief-notified-at" value={notifiedAt} onChange={setNotifiedAt} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="relief-notes">{t["vatBadDebtRelief.createNotes"]}</Label>
            <Textarea
              id="relief-notes"
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t["vatBadDebtRelief.cancel"]}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending || !invoiceId || !claimDate || !writtenOff || !customerNotified
            }
            data-testid="button-confirm-claim"
          >
            {t["vatBadDebtRelief.createConfirm"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
