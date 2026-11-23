/**
 * E1: per-invoice UAE e-invoice status.
 *
 * - `EInvoicePanel`        the full status: Delivery and FTA reporting tracks, report-by date,
 *                          named missing fields with Re-check, the rejection state with
 *                          "Fix and resubmit", the finalize checklist and the history drawer.
 *
 * Self-contained (data via /api/invoices/:id/einvoice/*) so invoice screens mount it with one
 * line. Nothing here claims a transmission that did not happen: without a provider the panel
 * says "generated and validated — not sent".
 */
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDashed,
  Download,
  History,
  Loader2,
  Lock,
  MinusCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AskNajmaButton } from "@/components/firm/AskNajmaButton";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { StatusBadge } from "@/components/ui/status-badge";
import { SheetClose } from "@/components/ui/sheet";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  einvoiceFieldHint,
  einvoiceIssuesFromError,
  einvoiceRuleTextKey,
  type EInvoiceIssueItem,
} from "@/lib/einvoice-issues";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  DELIVERY_TONE,
  REPORTING_TONE,
  blockKey,
  checklistLabelKey,
  checklistStateKey,
  deliveryOutcomeLabel,
  errorKey,
  fieldLabelKey,
  issueTextKey,
  isReportingOnlyFailure,
  reportingLabelKey,
  reportingObligationUnknown,
  reportingOutcomeConfirmed,
  trackOutcomeLabel,
  type ChecklistState,
  type EInvoiceStatusView,
} from "./einvoice-meta";
import { einvoiceStatusKey, useEInvoiceStatus } from "./use-einvoice";
import "./einvoice-theme.css";

const EInvoiceHistory = lazy(() => import("./EInvoiceHistory"));
const EInvoiceTrackingNotice = lazy(() => import("./EInvoiceTrackingNotice"));

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
        const obligationUnknown =
          item.key === "reported" &&
          reportingObligationUnknown(
            view.tracks.reporting.status,
            view.tracks.reporting.obligationKnown
          );
        const state = obligationUnknown ? "not_applicable" : item.state;
        const Icon = STATE_ICON[state];
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
                STATE_CLASS[state],
                state === "in_progress" && "motion-safe:animate-spin"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span
                  className={`text-small font-medium ${
                    state === "not_applicable" ? "text-muted-foreground" : ""
                  }`}
                >
                  {obligationUnknown
                    ? t["einvoicing.reportingObligationUnknown"]
                    : trackOutcomeLabel(
                        t,
                        checklistLabelKey(item.key),
                        item.state === "done" && (item.key === "sent" || item.key === "reported"),
                        view.transmission.environment
                      )}
                </span>
                {!obligationUnknown && (
                  <span className="text-caption text-muted-foreground">
                    {t[checklistStateKey(item.state)]}
                    {item.at && item.state === "done" ? ` · ${formatDate(item.at, locale)}` : ""}
                  </span>
                )}
              </div>
              {reason && !obligationUnknown && (
                <p className="mt-0.5 text-caption text-muted-foreground">{reason}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
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
  const { companyId: handoffCompanyId } = useDefaultCompany();
  const permission = useCompanyPermission();
  const submitAccess = permission.gate("tax.submit");
  const { t, locale } = useTranslation();
  const [historyOpen, setHistoryOpen] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState<"xml" | "pdf" | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const status = useEInvoiceStatus(invoiceId, true);
  // The generated e-invoice (UBL XML) and the invoice PDF, with a localized failure message.
  const download = async (kind: "xml" | "pdf") => {
    setDownloading(kind);
    setDownloadFailed(false);
    try {
      const { downloadServerFile } = await import("@/lib/export");
      await downloadServerFile(
        kind === "xml"
          ? `/api/invoices/${invoiceId}/einvoice-xml`
          : `/api/invoices/${invoiceId}/pdf`,
        `einvoice-${invoiceId}.${kind}`
      );
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(null);
    }
  };
  const key = einvoiceStatusKey(invoiceId);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    if (handoffCompanyId) {
      for (const query of ["einvoicing", "invoices"]) {
        void queryClient.invalidateQueries({
          queryKey: ["/api/companies", handoffCompanyId, query],
        });
      }
    }
  };
  const recheck = useMutation({
    mutationFn: (): Promise<{ valid: boolean }> =>
      apiRequest("GET", `/api/invoices/${invoiceId}/einvoice/validate`),
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
  if (view.applicable === false) {
    return (
      <p className={cn("text-small text-muted-foreground", className)}>
        {t["einvoicing.reporting_not_required"]}
      </p>
    );
  }
  const {
    tracks: { delivery, reporting },
    rejection,
    transmission,
  } = view;
  const rejectionErrorKey = errorKey(rejection?.code);
  const rejectionEnvironment = rejection?.environment;
  const correctionUnverified = transmission.correctionRevisionUnverified;
  const handedOver = !!transmission.providerDocumentId;
  const queuedForSubmission = view.submissionState === "queued";
  const reconciling = view.submissionState === "needs_reconciliation";
  const failedDelivery = delivery.status === "rejected" || delivery.status === "delivery_failed";
  const reportingOnlyFailure = isReportingOnlyFailure(delivery.status, reporting.status);
  const canCorrectRejection =
    !!rejection?.resubmittable && !!rejectionEnvironment && !reportingOnlyFailure && !reconciling;
  const acknowledgement = transmission.recipientAcknowledgement;
  const providerName = transmission.providerDisplayName ?? transmission.provider ?? "";
  const latestAction = send.submittedAt >= resubmit.submittedAt ? send : resubmit;
  const latestCheck = recheck.submittedAt > latestAction.submittedAt ? recheck.data : undefined;
  const actionError = (latestCheck?.valid ? null : latestAction.error) as
    | (Error & { body?: { code?: string } })
    | null;
  const actionErrorKey = errorKey(actionError?.body?.code);
  const actionIssues = einvoiceIssuesFromError(actionError?.body);
  const issues: EInvoiceIssueItem[] =
    view.issues.length > 0
      ? view.issues
      : latestCheck
        ? einvoiceIssuesFromError(latestCheck)
        : actionIssues;
  const validationPassed =
    latestCheck?.valid ??
    view.checklist.some((item) => item.key === "validated" && item.state === "done");

  const deliveryMeta =
    delivery.status === "delivered" && acknowledgement !== "received" && delivery.at
      ? formatMessage(t["einvoicing.deliveredOn"], { date: formatDate(delivery.at, locale) })
      : handedOver
        ? formatMessage(t["einvoicing.viaProvider"], { provider: providerName })
        : t["einvoicing.notSentYet"];
  const reportingDeadline =
    reporting.required && reporting.status !== "reported" && reporting.reportBy
      ? formatMessage(
          reporting.overdue ? t["einvoicing.reportByPassed"] : t["einvoicing.reportBy"],
          {
            date: formatDate(reporting.reportBy, locale),
          }
        )
      : null;
  const reportingMeta =
    reporting.status === "reported" && reporting.at
      ? formatMessage(t["einvoicing.reportedOn"], { date: formatDate(reporting.at, locale) })
      : reporting.confirmationUnavailable
        ? [reportingDeadline, t["einvoicing.reportingUnconfirmedHint"]].filter(Boolean).join(" · ")
        : reportingDeadline;

  return (
    <div className={cn("space-y-5", className)} data-testid="einvoice-panel">
      {/* Two tracks */}
      <div className="divide-hairline rounded-lg border border-border px-4">
        <TrackRow
          testId="einvoice-track-delivery"
          label={t["einvoicing.trackDelivery"]}
          meta={deliveryMeta}
          badge={
            <StatusBadge
              className="einvoice-status-badge"
              tone={
                delivery.confirmationUnavailable
                  ? "neutral"
                  : acknowledgement === "received"
                    ? "info"
                    : DELIVERY_TONE[delivery.status]
              }
              data-testid={queuedForSubmission ? "einvoice-queued" : undefined}
            >
              {deliveryOutcomeLabel(t, delivery.status, {
                queuedForSubmission,
                acknowledgement,
                confirmationUnavailable: delivery.confirmationUnavailable,
                environment: transmission.environment,
              })}
            </StatusBadge>
          }
        />
        <TrackRow
          testId="einvoice-track-reporting"
          label={t["einvoicing.trackReporting"]}
          meta={reportingMeta}
          metaTone={reporting.overdue ? "warning" : undefined}
          badge={
            <StatusBadge
              className="einvoice-status-badge"
              tone={
                reportingObligationUnknown(reporting.status, reporting.obligationKnown)
                  ? "neutral"
                  : REPORTING_TONE[reporting.status]
              }
            >
              {trackOutcomeLabel(
                t,
                reportingLabelKey(
                  reporting.status,
                  reporting.confirmationUnavailable,
                  reporting.obligationKnown
                ),
                reportingOutcomeConfirmed(reporting.status, reporting.confirmationUnavailable),
                transmission.environment
              )}
            </StatusBadge>
          }
        />
      </div>

      {/* Honest boundary: nothing is sent without a connected provider. */}
      {transmission.block && !handedOver && !reconciling && (
        <div
          className="rounded-lg bg-surface-sunken p-4 text-small"
          data-testid="einvoice-not-sent"
          role="note"
        >
          <p className="font-medium text-foreground">{t["einvoicing.notSentTitle"]}</p>
          <p className="mt-1 text-muted-foreground">{t[blockKey(transmission.block)]}</p>
          <Link
            href="/settings/einvoicing"
            className="mt-2 inline-block font-medium text-accent underline-offset-4 hover:underline"
          >
            {t["einvoicing.setUpLink"]}
          </Link>
        </div>
      )}
      {(transmission.environmentVerification ||
        (handedOver && !transmission.canRefresh && transmission.block === "no_provider")) && (
        <Suspense>
          <EInvoiceTrackingNotice
            key={invoiceId}
            invoiceId={invoiceId}
            verification={transmission.environmentVerification}
            providerName={providerName}
            onVerified={invalidate}
          />
        </Suspense>
      )}

      {/* Validate-on-save: named missing fields with an in-place re-check. */}
      {issues.length > 0 ? (
        <div
          className="rounded-lg border border-warning/40 bg-warning-subtle p-4"
          data-testid="einvoice-issues"
          role="status"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-small font-medium text-warning-subtle-foreground">
                {formatMessage(t["einvoicing.issuesTitle"], { count: issues.length })}
              </p>
              <ul className="mt-2 space-y-1.5">
                {issues.map((issue, i) => {
                  const hint = einvoiceFieldHint(issue.field, {
                    contactId: view.contactId,
                    invoiceId,
                  });
                  const label = fieldLabelKey(issue.field);
                  const fixKey = issueTextKey(issue.code) ?? einvoiceRuleTextKey(issue.ruleId);
                  const detail =
                    (fixKey && t[fixKey]) ||
                    (locale === "ar" ? t["einvoicing.validationFinding"] : issue.message);
                  return (
                    <li key={`${issue.field}-${i}`} className="text-small text-foreground">
                      {label && <span className="font-medium">{t[label]} </span>}
                      <span
                        className="text-muted-foreground"
                        data-testid={issue.code ? `einvoice-issue-${issue.code}` : undefined}
                      >
                        {detail}
                      </span>
                      {issue.ruleId && (
                        <bdi dir="ltr" translate="no" className="ms-2">
                          {issue.ruleId}
                        </bdi>
                      )}
                      {hint.href && hint.whereKey && (
                        <SheetClose asChild>
                          <Link
                            href={hint.href}
                            className="ms-2 inline-flex min-h-11 items-center text-accent hover:underline"
                            data-testid={`link-einvoice-fix-${i}`}
                          >
                            {t[hint.whereKey]}
                          </Link>
                        </SheetClose>
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
            data-testid={validationPassed ? "einvoice-ready" : undefined}
          >
            <span
              className={cn(
                "inline-flex items-center gap-2",
                validationPassed && "text-success-subtle-foreground"
              )}
            >
              {validationPassed && <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />}
              {t[validationPassed ? "einvoicing.readyLine" : "einvoicing.runValidation"]}
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

      {/* X6a: a lost response the provider may already hold: not a rejection, never resent. */}
      {(delivery.status === "needs_link" || correctionUnverified) && (
        <div
          className="rounded-lg border border-warning/40 bg-warning-subtle p-4"
          data-testid="einvoice-needs-link"
          role="status"
        >
          <p className="text-small font-semibold text-foreground">
            {formatMessage(
              t[
                correctionUnverified
                  ? "einvoicing.correctionUnverifiedTitle"
                  : "einvoicing.needsLinkTitle"
              ],
              { provider: providerName || "ASP" }
            )}
          </p>
          <p className="mt-1 text-small text-foreground">
            {formatMessage(
              t[
                correctionUnverified
                  ? "einvoicing.correctionUnverifiedBody"
                  : "einvoicing.needsLinkBody"
              ],
              { provider: providerName || "ASP" }
            )}
          </p>
        </div>
      )}

      {/* Rejection / delivery failure: the reason, where, and the way back. */}
      {rejection && !correctionUnverified && (
        <div
          className="rounded-lg border border-danger/40 bg-danger-subtle p-4"
          data-testid="einvoice-rejection"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <XCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-small font-semibold text-danger-subtle-foreground">
                {formatMessage(
                  trackOutcomeLabel(
                    t,
                    delivery.status === "rejected"
                      ? "einvoicing.rejectedTitle"
                      : reportingOnlyFailure
                        ? "einvoicing.reporting_report_failed"
                        : "einvoicing.deliveryFailedTitle",
                    true,
                    rejectionEnvironment
                  ),
                  {
                    provider: rejection.providerDisplayName ?? (providerName || "ASP"),
                  }
                )}
              </p>
              <p className="mt-1 text-small text-foreground">
                {rejectionErrorKey
                  ? t[rejectionErrorKey]
                  : (rejection.message ?? t["einvoicing.err_unknown"])}
              </p>
              {rejection.reasons.length > 0 && (
                <ul className="mt-3 space-y-2" data-testid="einvoice-rejection-reasons">
                  {rejection.reasons.map((r, i) => {
                    const hint =
                      canCorrectRejection && r.field
                        ? einvoiceFieldHint(r.field, { contactId: view.contactId, invoiceId })
                        : null;
                    return (
                      <li key={i} className="rounded-md bg-card px-3 py-2 text-small">
                        <p dir="auto" className="text-foreground">
                          {r.message}
                        </p>
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
                        {hint?.href && hint.whereKey && (
                          <SheetClose asChild>
                            <Link
                              href={hint.href}
                              className="inline-flex min-h-11 items-center text-accent hover:underline"
                            >
                              {t[hint.whereKey]}
                            </Link>
                          </SheetClose>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canCorrectRejection && (
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
              )}
              {rejection.retryScheduledAt && (
                <p className="mt-2 text-caption text-muted-foreground">
                  {formatMessage(t["einvoicing.retryScheduled"], {
                    date: formatDate(rejection.retryScheduledAt, locale),
                  })}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {canCorrectRejection && (
                  <>
                    {onEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onEdit}
                        data-testid="einvoice-fix"
                      >
                        {t["einvoicing.fixInvoice"]}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => resubmit.mutate()}
                      {...submitAccess}
                      disabled={!permission.known || submitAccess.disabled || resubmit.isPending}
                      data-testid="einvoice-resubmit"
                    >
                      {resubmit.isPending && (
                        <Loader2 aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />
                      )}
                      {trackOutcomeLabel(t, "einvoicing.resubmit", true, rejectionEnvironment)}
                    </Button>
                  </>
                )}
                <AskNajmaButton
                  companyId={handoffCompanyId}
                  topic="einvoice"
                  reference={invoiceId.slice(0, 8)}
                  figures={[
                    {
                      label: t["launchProof.figureErrorCode"],
                      value: rejection.code ?? "",
                    },
                    {
                      label: t["launchProof.figureDeliveryState"],
                      value: delivery.status,
                    },
                  ]}
                  testId="button-ask-najma-einvoice"
                />
              </div>
              {(reportingOnlyFailure ? rejection.providerHoldsDocument : !canCorrectRejection) && (
                <p className="mt-2 text-caption text-muted-foreground">
                  {
                    t[
                      rejectionEnvironment === "sandbox"
                        ? "einvoicing.rejectionSandboxGuidance"
                        : rejectionEnvironment !== "production"
                          ? "einvoicing.rejectionUnknownGuidance"
                          : !reportingOnlyFailure && rejection.creditNoteRequired
                            ? "einvoicing.resubmitNewDocument"
                            : rejection.providerHoldsDocument
                              ? "einvoicing.resubmitHeld"
                              : "einvoicing.resubmitBlocked"
                    ]
                  }
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {actionError && actionIssues.length === 0 && (
        <p
          className="text-small text-danger-subtle-foreground"
          role="alert"
          data-testid="einvoice-action-error"
        >
          {actionErrorKey
            ? t[actionErrorKey]
            : locale === "ar"
              ? t["einvoicing.submissionFailed"]
              : actionError.message}
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
        {transmission.canSubmit && !reconciling && (
          <Button
            size="sm"
            onClick={() => send.mutate()}
            {...submitAccess}
            disabled={
              !permission.known || submitAccess.disabled || send.isPending || issues.length > 0
            }
            data-testid="einvoice-send"
          >
            {send.isPending && (
              <Loader2 aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />
            )}
            {formatMessage(t["einvoicing.sendVia"], { provider: providerName })}
          </Button>
        )}
        {transmission.canRefresh && !reconciling && (
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
        {view.status !== "not_generated" && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void download("xml")}
              disabled={downloading !== null}
              data-testid="einvoice-download-xml"
            >
              <Download aria-hidden className="h-3.5 w-3.5" />
              {t["einvoicing.downloadXml"]}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void download("pdf")}
              disabled={downloading !== null}
              data-testid="einvoice-download-pdf"
            >
              <Download aria-hidden className="h-3.5 w-3.5" />
              {t["einvoicing.downloadPdf"]}
            </Button>
          </>
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
        {!!transmission.provider && transmission.environment === "sandbox" && (
          <span className="ms-auto inline-flex items-center gap-1 text-caption text-muted-foreground">
            <CircleDashed aria-hidden className="h-3.5 w-3.5" />
            {t["einvoicing.sandboxNote"]}
          </span>
        )}
      </div>

      {downloadFailed && (
        <p className="text-small text-danger" role="alert" data-testid="einvoice-download-error">
          {t["einvoicing.downloadFailed"]}
        </p>
      )}

      {historyOpen !== null && (
        <Suspense>
          <EInvoiceHistory view={view} open={historyOpen} onOpenChange={setHistoryOpen} />
        </Suspense>
      )}
    </div>
  );
}
