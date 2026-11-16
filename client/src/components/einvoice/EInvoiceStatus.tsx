/**
 * E1: per-invoice UAE e-invoice status.
 *
 * - `EInvoiceTrackBadges`  compact two-track cell for the invoice list.
 * - `EInvoicePanel`        the full status: Delivery and FTA reporting tracks, report-by date,
 *                          named missing fields with Re-check, the rejection state with
 *                          "Fix and resubmit", the finalize checklist and the history drawer.
 * - `EInvoiceSheet`        the panel in a side sheet, opened from the invoice row.
 *
 * Self-contained (data via /api/invoices/:id/einvoice/*) so invoice screens mount it with one
 * line. Nothing here claims a transmission that did not happen: without a provider the panel
 * says "generated and validated — not sent".
 */
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDashed,
  History,
  Landmark,
  Loader2,
  Lock,
  MinusCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  DELIVERY_TONE,
  REPORTING_TONE,
  blockKey,
  checklistLabelKey,
  checklistStateKey,
  deliveryLabelKey,
  errorKey,
  fieldLabelKey,
  reportingLabelKey,
  sourceKey,
  type ChecklistState,
  type DeliveryStatus,
  type EInvoiceStatusView,
  type ReportingStatus,
} from "./einvoice-meta";
import { einvoiceStatusKey, useEInvoiceStatus } from "./use-einvoice";

// ─── Compact list cell ─────────────────────────────────────────────────

export function EInvoiceTrackBadges({
  delivery,
  reporting,
  className,
  testId,
}: {
  delivery: DeliveryStatus;
  reporting: ReportingStatus;
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  // The list cell is narrow: "Validated, not sent" reads "Not sent" there.
  const deliveryText =
    delivery === "validated"
      ? t["einvoicing.delivery_validated_short"]
      : t[deliveryLabelKey(delivery)];
  const reportingText = t[reportingLabelKey(reporting)];
  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-1", className)}
      data-testid={testId}
    >
      <StatusBadge
        tone={DELIVERY_TONE[delivery]}
        title={`${t["einvoicing.trackDelivery"]}: ${deliveryText}`}
      >
        <span className="sr-only">{t["einvoicing.trackDelivery"]}: </span>
        {deliveryText}
      </StatusBadge>
      {reporting !== "not_required" && (
        <StatusBadge
          tone={REPORTING_TONE[reporting]}
          title={`${t["einvoicing.trackReporting"]}: ${reportingText}`}
          className="px-1.5"
        >
          {/* Compact: an FTA mark coloured by the reporting state; the text is for screen readers
              and the tooltip, so the list row keeps its height. */}
          <Landmark aria-hidden className="h-3 w-3" />
          <span className="sr-only">
            {t["einvoicing.trackReporting"]}: {reportingText}
          </span>
        </StatusBadge>
      )}
    </span>
  );
}

// ─── Checklist ─────────────────────────────────────────────────────────

const STATE_ICON: Record<ChecklistState, typeof Circle> = {
  done: CheckCircle2,
  in_progress: Loader2,
  failed: XCircle,
  blocked: Lock,
  not_applicable: MinusCircle,
  todo: Circle,
};
const STATE_CLASS: Record<ChecklistState, string> = {
  done: "text-success",
  in_progress: "text-info",
  failed: "text-danger",
  blocked: "text-muted-foreground",
  not_applicable: "text-muted-foreground",
  todo: "text-muted-foreground",
};

export function FinalizeChecklist({ view }: { view: EInvoiceStatusView }) {
  const { t, locale } = useTranslation();
  return (
    <ol className="space-y-2.5" data-testid="einvoice-checklist">
      {view.checklist.map((item) => {
        const Icon = STATE_ICON[item.state];
        const reason =
          item.state === "blocked" && view.transmission.block
            ? t[blockKey(view.transmission.block)]
            : item.state === "failed" && errorKey(item.code)
              ? t[errorKey(item.code) as string]
              : null;
        return (
          <li
            key={item.key}
            className="flex items-start gap-3"
            data-testid={`einvoice-check-${item.key}`}
            data-state={item.state}
          >
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                STATE_CLASS[item.state],
                item.state === "in_progress" && "motion-safe:animate-spin"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span
                  className={`text-small font-medium ${
                    item.state === "not_applicable" ? "text-muted-foreground" : ""
                  }`}
                >
                  {t[checklistLabelKey(item.key)]}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t[checklistStateKey(item.state)]}
                  {item.at && item.state === "done" ? ` · ${formatDate(item.at, locale)}` : ""}
                </span>
              </div>
              {reason && <p className="mt-0.5 text-caption text-muted-foreground">{reason}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── History drawer ────────────────────────────────────────────────────

function eventLabel(e: EInvoiceStatusView["events"][number], t: Record<string, string>) {
  if (e.track === "validation") {
    return e.to === "passed" ? t["einvoicing.historyValidated"] : t["einvoicing.historyInvalid"];
  }
  const key =
    e.track === "delivery"
      ? deliveryLabelKey(e.to as DeliveryStatus)
      : reportingLabelKey(e.to as ReportingStatus);
  const track =
    e.track === "delivery" ? t["einvoicing.trackDelivery"] : t["einvoicing.trackReporting"];
  return `${track}: ${t[key] ?? e.to}`;
}

export function EInvoiceHistory({
  view,
  open,
  onOpenChange,
}: {
  view: EInvoiceStatusView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useTranslation();
  const timeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={locale === "ar" ? "left" : "right"}
        className="w-full overflow-y-auto sm:max-w-md"
        data-testid="einvoice-history"
      >
        <SheetHeader>
          <SheetTitle>{t["einvoicing.historyTitle"]}</SheetTitle>
          <SheetDescription>{t["einvoicing.historyDescription"]}</SheetDescription>
        </SheetHeader>
        {view.events.length === 0 ? (
          <p className="mt-6 text-small text-muted-foreground">{t["einvoicing.historyEmpty"]}</p>
        ) : (
          <ol className="mt-6 space-y-4 border-s border-border ps-4">
            {view.events.map((e) => {
              const err = errorKey(e.code);
              const failed =
                e.to === "rejected" ||
                e.to === "delivery_failed" ||
                e.to === "report_failed" ||
                (e.track === "validation" && e.to === "failed");
              return (
                <li key={e.id} className="relative">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -start-[1.3rem] top-1.5 h-2 w-2 rounded-full",
                      failed ? "bg-danger" : "bg-muted-foreground"
                    )}
                  />
                  <p className="text-small font-medium">{eventLabel(e, t)}</p>
                  <p className="text-caption text-muted-foreground">
                    {e.at ? `${formatDate(e.at, locale)} · ${timeFmt.format(new Date(e.at))}` : ""}
                    {" · "}
                    {t[sourceKey(e.source)] ?? e.source}
                    {e.providerStatus ? (
                      <>
                        {" · "}
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {e.providerStatus}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {(err || e.message) && failed && (
                    <p className="mt-1 text-caption text-danger-subtle-foreground">
                      {err ? t[err] : e.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Panel ─────────────────────────────────────────────────────────────

function TrackRow({
  label,
  badge,
  meta,
  metaTone,
  testId,
}: {
  label: string;
  badge: ReactNode;
  meta?: ReactNode;
  metaTone?: "warning";
  testId: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
      data-testid={testId}
    >
      <div className="min-w-0">
        <p className="text-small font-medium text-foreground">{label}</p>
        {meta && (
          <p
            className={`text-caption ${
              metaTone === "warning" ? "text-warning-subtle-foreground" : "text-muted-foreground"
            }`}
          >
            {meta}
          </p>
        )}
      </div>
      {badge}
    </div>
  );
}

export interface EInvoicePanelProps {
  invoiceId: string;
  /** Opens the invoice editor (the "Fix" step of "Fix and resubmit"). */
  onEdit?: () => void;
  /** Hide the checklist (e.g. in a narrow header). */
  compact?: boolean;
  className?: string;
}

export function EInvoicePanel({ invoiceId, onEdit, compact, className }: EInvoicePanelProps) {
  const { t, locale } = useTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const status = useEInvoiceStatus(invoiceId);
  const key = einvoiceStatusKey(invoiceId);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["/api/companies"], exact: false });
  };
  const recheck = useMutation({
    mutationFn: () => apiRequest("GET", `/api/invoices/${invoiceId}/einvoice/validate`),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const resubmit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/invoices/${invoiceId}/einvoice/resubmit`, {}),
    onSettled: invalidate,
  });
  const send = useMutation({
    mutationFn: () => apiRequest("POST", `/api/invoices/${invoiceId}/einvoice/submit`, {}),
    onSettled: invalidate,
  });
  const refresh = useMutation({
    mutationFn: () => apiRequest("POST", `/api/invoices/${invoiceId}/einvoice/refresh-status`, {}),
    onSettled: invalidate,
  });

  if (status.isLoading) {
    return (
      <div className={cn("space-y-3", className)} aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-10 animate-pulse rounded bg-muted" />
        <div className="h-10 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (status.isError || !status.data) {
    return (
      <div className={`text-small text-muted-foreground ${className ?? ""}`} role="status">
        {t["einvoicing.loadFailed"]}{" "}
        <Button variant="link" size="sm" onClick={() => void status.refetch()}>
          {t["einvoicing.retry"]}
        </Button>
      </div>
    );
  }

  const view = status.data;
  const { delivery, reporting } = view.tracks;
  const handedOver = !!view.transmission.providerDocumentId;
  const failedDelivery = delivery.status === "rejected" || delivery.status === "delivery_failed";
  const providerName =
    view.transmission.provider === "acube" ? "A-Cube" : (view.transmission.provider ?? "");
  const actionError = (send.error ?? resubmit.error) as
    | (Error & { body?: { code?: string } })
    | null;
  const actionErrorKey = errorKey(actionError?.body?.code);

  const deliveryMeta =
    delivery.status === "delivered" && delivery.at
      ? formatMessage(t["einvoicing.deliveredOn"], { date: formatDate(delivery.at, locale) })
      : handedOver
        ? formatMessage(t["einvoicing.viaProvider"], { provider: providerName })
        : t["einvoicing.notSentYet"];
  const reportingMeta = !reporting.required
    ? t["einvoicing.reportingNotRequiredHint"]
    : reporting.status === "reported" && reporting.at
      ? formatMessage(t["einvoicing.reportedOn"], { date: formatDate(reporting.at, locale) })
      : reporting.reportBy
        ? formatMessage(
            reporting.overdue ? t["einvoicing.reportByPassed"] : t["einvoicing.reportBy"],
            { date: formatDate(reporting.reportBy, locale) }
          )
        : null;

  return (
    <div className={cn("space-y-5", className)} data-testid="einvoice-panel">
      {/* Two tracks */}
      <div className="divide-hairline rounded-lg border border-border px-4">
        <TrackRow
          testId="einvoice-track-delivery"
          label={t["einvoicing.trackDelivery"]}
          meta={deliveryMeta}
          badge={
            <StatusBadge tone={DELIVERY_TONE[delivery.status]}>
              {t[deliveryLabelKey(delivery.status)]}
            </StatusBadge>
          }
        />
        <TrackRow
          testId="einvoice-track-reporting"
          label={t["einvoicing.trackReporting"]}
          meta={reportingMeta}
          metaTone={reporting.overdue ? "warning" : undefined}
          badge={
            <StatusBadge tone={REPORTING_TONE[reporting.status]}>
              {t[reportingLabelKey(reporting.status)]}
            </StatusBadge>
          }
        />
      </div>

      {/* Honest boundary: nothing is sent without a connected provider. */}
      {view.transmission.block && !handedOver && (
        <div
          className="rounded-lg bg-surface-sunken p-4 text-small"
          data-testid="einvoice-not-sent"
          role="note"
        >
          <p className="font-medium text-foreground">{t["einvoicing.notSentTitle"]}</p>
          <p className="mt-1 text-muted-foreground">{t[blockKey(view.transmission.block)]}</p>
          <Link
            href="/settings/einvoicing"
            className="mt-2 inline-block font-medium text-accent underline-offset-4 hover:underline"
          >
            {t["einvoicing.setUpLink"]}
          </Link>
        </div>
      )}

      {/* Validate-on-save: named missing fields with an in-place re-check. */}
      {view.issues.length > 0 ? (
        <div
          className="rounded-lg border border-warning/40 bg-warning-subtle p-4"
          data-testid="einvoice-issues"
          role="status"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-small font-medium text-warning-subtle-foreground">
                {formatMessage(t["einvoicing.issuesTitle"], { count: view.issues.length })}
              </p>
              <ul className="mt-2 space-y-1.5">
                {view.issues.map((issue, i) => {
                  const label = fieldLabelKey(issue.field);
                  return (
                    <li key={`${issue.field}-${i}`} className="text-small text-foreground">
                      <span className="font-medium">{label ? t[label] : issue.field}</span>
                      {/* The validator message is English source text: in Arabic show the
                          localised field label plus the LTR rule code, never a mixed sentence. */}
                      {locale === "ar" && label ? (
                        issue.message.match(/\(([a-z0-9-]+)\)\s*$/i) ? (
                          <bdi
                            dir="ltr"
                            translate="no"
                            className="ms-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                          >
                            {issue.message.match(/\(([a-z0-9-]+)\)\s*$/i)?.[1]}
                          </bdi>
                        ) : null
                      ) : (
                        <span className="text-muted-foreground"> — {issue.message}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 ps-7">
            {onEdit && (
              <Button size="sm" variant="outline" onClick={onEdit} data-testid="einvoice-fix">
                {t["einvoicing.fixInvoice"]}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => recheck.mutate()}
              disabled={recheck.isPending}
              data-testid="einvoice-recheck"
            >
              <RefreshCw
                aria-hidden
                className={cn("h-3.5 w-3.5", recheck.isPending && "motion-safe:animate-spin")}
              />
              {t["einvoicing.recheck"]}
            </Button>
          </div>
        </div>
      ) : (
        !failedDelivery && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 text-small"
            data-testid="einvoice-ready"
          >
            <span className="inline-flex items-center gap-2 text-success-subtle-foreground">
              <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
              {t["einvoicing.readyLine"]}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => recheck.mutate()}
              disabled={recheck.isPending}
              data-testid="einvoice-recheck"
            >
              <RefreshCw
                aria-hidden
                className={cn("h-3.5 w-3.5", recheck.isPending && "motion-safe:animate-spin")}
              />
              {t["einvoicing.recheck"]}
            </Button>
          </div>
        )
      )}

      {/* Rejection / delivery failure: the reason, where, and the way back. */}
      {view.rejection && (
        <div
          className="rounded-lg border border-danger/40 bg-danger-subtle p-4"
          data-testid="einvoice-rejection"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <XCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-small font-semibold text-danger-subtle-foreground">
                {delivery.status === "rejected"
                  ? formatMessage(t["einvoicing.rejectedTitle"], {
                      provider: providerName || "ASP",
                    })
                  : t["einvoicing.deliveryFailedTitle"]}
              </p>
              <p className="mt-1 text-small text-foreground">
                {errorKey(view.rejection.code)
                  ? t[errorKey(view.rejection.code) as string]
                  : (view.rejection.message ?? t["einvoicing.err_unknown"])}
              </p>
              {view.rejection.reasons.length > 0 && (
                <ul className="mt-3 space-y-2" data-testid="einvoice-rejection-reasons">
                  {view.rejection.reasons.map((r, i) => (
                    <li key={i} className="rounded-md bg-card px-3 py-2 text-small">
                      <p className="text-foreground">{r.message}</p>
                      {(r.field || r.code) && (
                        <p className="mt-0.5 text-caption text-muted-foreground">
                          {r.field && (
                            <>
                              {t["einvoicing.reasonWhere"]}{" "}
                              <span dir="ltr" className="[unicode-bidi:isolate] break-all">
                                {r.field}
                              </span>
                            </>
                          )}
                          {r.field && r.code ? " · " : ""}
                          {r.code && (
                            <>
                              {t["einvoicing.reasonRule"]}{" "}
                              <span dir="ltr" className="[unicode-bidi:isolate]">
                                {r.code}
                              </span>
                            </>
                          )}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <ol
                className="mt-3 space-y-1 text-small text-foreground"
                data-testid="einvoice-fix-steps"
              >
                <li>
                  1.{" "}
                  {delivery.status === "rejected"
                    ? t["einvoicing.fixStepCorrect"]
                    : t["einvoicing.fixStepCheckBuyer"]}
                </li>
                <li>2. {t["einvoicing.fixStepRecheck"]}</li>
                <li>3. {t["einvoicing.fixStepResubmit"]}</li>
              </ol>
              {view.rejection.retryScheduledAt && (
                <p className="mt-2 text-caption text-muted-foreground">
                  {formatMessage(t["einvoicing.retryScheduled"], {
                    date: formatDate(view.rejection.retryScheduledAt, locale),
                  })}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {onEdit && (
                  <Button size="sm" variant="outline" onClick={onEdit} data-testid="einvoice-fix">
                    {t["einvoicing.fixInvoice"]}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => resubmit.mutate()}
                  disabled={resubmit.isPending || !view.rejection.resubmittable}
                  data-testid="einvoice-resubmit"
                >
                  {resubmit.isPending && (
                    <Loader2 aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />
                  )}
                  {t["einvoicing.resubmit"]}
                </Button>
              </div>
              {!view.rejection.resubmittable && (
                <p className="mt-2 text-caption text-muted-foreground">
                  {t["einvoicing.resubmitBlocked"]}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {actionError && (
        <p
          className="text-small text-danger-subtle-foreground"
          role="alert"
          data-testid="einvoice-action-error"
        >
          {actionErrorKey ? t[actionErrorKey] : actionError.message}
        </p>
      )}

      {!compact && (
        <section aria-labelledby={`einvoice-checklist-${invoiceId}`} className="space-y-3">
          <h3
            id={`einvoice-checklist-${invoiceId}`}
            className="text-small font-semibold text-foreground"
          >
            {t["einvoicing.checklistTitle"]}
          </h3>
          <FinalizeChecklist view={view} />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {!view.transmission.block && !handedOver && !failedDelivery && (
          <Button
            size="sm"
            onClick={() => send.mutate()}
            disabled={send.isPending || view.issues.length > 0}
            data-testid="einvoice-send"
          >
            {send.isPending && (
              <Loader2 aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />
            )}
            {formatMessage(t["einvoicing.sendVia"], { provider: providerName })}
          </Button>
        )}
        {handedOver && !view.transmission.block && view.status !== "cleared" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            data-testid="einvoice-refresh"
          >
            <RefreshCw
              aria-hidden
              className={cn("h-3.5 w-3.5", refresh.isPending && "motion-safe:animate-spin")}
            />
            {t["einvoicing.refreshStatus"]}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setHistoryOpen(true)}
          data-testid="einvoice-history-open"
        >
          <History aria-hidden className="h-3.5 w-3.5" />
          {formatMessage(t["einvoicing.historyButton"], { count: view.events.length })}
        </Button>
        {view.transmission.provider === "acube" && view.transmission.environment === "sandbox" && (
          <span className="ms-auto inline-flex items-center gap-1 text-caption text-muted-foreground">
            <CircleDashed aria-hidden className="h-3.5 w-3.5" />
            {t["einvoicing.sandboxNote"]}
          </span>
        )}
      </div>

      <EInvoiceHistory view={view} open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

export function EInvoiceSheet({
  invoiceId,
  invoiceNumber,
  open,
  onOpenChange,
  onEdit,
}: {
  invoiceId: string | null;
  invoiceNumber?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
}) {
  const { t, locale } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={locale === "ar" ? "left" : "right"}
        className="w-full overflow-y-auto sm:max-w-lg"
        data-testid="einvoice-sheet"
      >
        <SheetHeader className="mb-5">
          <SheetTitle>
            {t["einvoicing.sheetTitle"]}
            {invoiceNumber ? (
              <>
                {" · "}
                <span dir="ltr" className="[unicode-bidi:isolate]">
                  {invoiceNumber}
                </span>
              </>
            ) : null}
          </SheetTitle>
          <SheetDescription>{t["einvoicing.sheetDescription"]}</SheetDescription>
        </SheetHeader>
        {invoiceId && <EInvoicePanel invoiceId={invoiceId} onEdit={onEdit} />}
      </SheetContent>
    </Sheet>
  );
}
