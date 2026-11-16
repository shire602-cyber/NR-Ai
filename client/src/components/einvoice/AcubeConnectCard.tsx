/**
 * E1: Settings → E-invoicing "Connect A-Cube" card.
 *
 * Explains the five-corner model in plain words, walks the taxpayer through
 * reserve TIN → approve A-Cube in EmaraTax → synced, with each step's live state from
 * GET /api/companies/:id/einvoicing/acube, and shows the Peppol address once active, the
 * go-live date, A-Cube's MoF accreditation number with a link to the official register, the
 * mandate timeline and the scope notes. When A-Cube is not connected on this server it says so
 * and offers nothing that would pretend otherwise.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

type StepState = "done" | "current" | "todo" | "failed";

export interface AcubeConnectionView {
  configured: boolean;
  environment: "sandbox" | "production";
  accreditationNumber: string;
  registerUrl: string;
  emaraTaxListing: string;
  tin: string | null;
  legalEntity: {
    status: "reserved" | "pending" | "active" | "inactive";
    legalEntityId: string | null;
    tin: string;
    nameEn: string | null;
    nameAr: string | null;
    peppolAddress: string | null;
    capabilities: string[];
    approver: "me" | "someone_else" | null;
    approverEmail: string | null;
    lastAction: string | null;
    reservationExpiresAt: string | null;
    lastSyncAt: string | null;
    activatedAt: string | null;
  } | null;
  canSend: boolean;
  steps: Array<{ key: "reserve" | "approve" | "synced"; state: StepState }>;
  goLive: {
    goLiveDate: string | null;
    appointAspBy: string | null;
    band: string | null;
    timeline: Record<string, { appointAspBy: string; goLive: string }>;
  };
}

const STATUS_TONE: Record<string, StatusTone> = {
  reserved: "warning",
  pending: "warning",
  active: "success",
  inactive: "danger",
};

const STEP_ICON: Record<StepState, typeof Circle> = {
  done: CheckCircle2,
  current: Circle,
  todo: Circle,
  failed: XCircle,
};

function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="[unicode-bidi:isolate]">
      {children}
    </span>
  );
}

/** The five corners, in plain words. */
function FiveCorners() {
  const { t } = useTranslation();
  const corners = [1, 2, 3, 4].map((n) => ({
    n,
    title: t[`einvoicing.corner${n}Title`],
    body: t[`einvoicing.corner${n}Body`],
  }));
  return (
    <div data-testid="acube-five-corners">
      <ol className="grid gap-2 sm:grid-cols-4 sm:gap-0">
        {corners.map((c, i) => (
          <li key={c.n} className="flex items-stretch gap-2 sm:gap-0">
            <div
              className={cn(
                "flex-1 rounded-lg border border-border bg-card p-3",
                c.n === 2 && "border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950"
              )}
            >
              <p className="text-caption text-muted-foreground">
                {formatMessage(t["einvoicing.cornerLabel"], { n: c.n })}
              </p>
              <p className="text-small font-semibold text-foreground">{c.title}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">{c.body}</p>
            </div>
            {i < corners.length - 1 && (
              <ArrowRight
                aria-hidden
                className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:mx-1 sm:block rtl:-scale-x-100"
              />
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-caption text-muted-foreground">
        <span className="font-medium text-foreground">
          {formatMessage(t["einvoicing.cornerLabel"], { n: 5 })} · {t["einvoicing.corner5Title"]}
        </span>{" "}
        — {t["einvoicing.corner5Body"]}
      </p>
    </div>
  );
}

export function AcubeConnectCard({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const key = ["/api/companies", companyId, "einvoicing", "acube"];
  const view = useQuery<AcubeConnectionView>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/acube`),
    retry: false,
  });
  const [approver, setApprover] = useState<"me" | "someone_else">("me");
  const [approverEmail, setApproverEmail] = useState("");
  const reserve = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/einvoicing/acube/reserve`, {
        approver,
        approverEmail: approver === "someone_else" ? approverEmail : null,
      }),
    onSuccess: (data: AcubeConnectionView) => queryClient.setQueryData(key, data),
  });
  const sync = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/einvoicing/acube/sync`, {}),
    onSuccess: (data: AcubeConnectionView) => queryClient.setQueryData(key, data),
  });

  const v = view.data;
  const le = v?.legalEntity ?? null;
  const statusLabel = !v?.configured
    ? t["einvoicing.acubeNotConnected"]
    : le
      ? t[`einvoicing.leStatus_${le.status}`]
      : t["einvoicing.leStatus_none"];
  const statusTone: StatusTone = !v?.configured
    ? "neutral"
    : le
      ? STATUS_TONE[le.status]
      : "neutral";
  const err = (reserve.error ?? sync.error) as (Error & { body?: { code?: string } }) | null;

  const stepCopy = {
    reserve: { title: t["einvoicing.stepReserveTitle"], body: t["einvoicing.stepReserveBody"] },
    approve: { title: t["einvoicing.stepApproveTitle"], body: t["einvoicing.stepApproveBody"] },
    synced: { title: t["einvoicing.stepSyncedTitle"], body: t["einvoicing.stepSyncedBody"] },
  };

  return (
    <SectionCard
      testId="acube-connect-card"
      title={t["einvoicing.acubeTitle"]}
      description={t["einvoicing.acubeDescription"]}
      actions={
        <span className="inline-flex flex-wrap items-center gap-2">
          {v?.configured && v.environment === "sandbox" && (
            <StatusBadge tone="info">{t["einvoicing.sandbox"]}</StatusBadge>
          )}
          <StatusBadge tone={statusTone} data-testid="acube-status">
            {statusLabel}
          </StatusBadge>
        </span>
      }
    >
      <div className="space-y-6">
        <section aria-labelledby="acube-model-title" className="space-y-3">
          <h3 id="acube-model-title" className="text-small font-semibold text-foreground">
            {t["einvoicing.modelTitle"]}
          </h3>
          <FiveCorners />
        </section>

        {view.isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
        ) : !v ? (
          <p className="text-small text-muted-foreground" role="status">
            {t["einvoicing.loadFailed"]}
          </p>
        ) : !v.configured ? (
          <div
            className="rounded-lg bg-surface-sunken p-4 text-small"
            data-testid="acube-not-configured"
          >
            <p className="font-medium text-foreground">{t["einvoicing.acubeNotConnectedTitle"]}</p>
            <p className="mt-1 text-muted-foreground">{t["einvoicing.acubeNotConnectedBody"]}</p>
          </div>
        ) : (
          <section aria-labelledby="acube-steps-title" className="space-y-3">
            <h3 id="acube-steps-title" className="text-small font-semibold text-foreground">
              {t["einvoicing.stepsTitle"]}
            </h3>
            <ol
              className="divide-hairline rounded-lg border border-border"
              data-testid="acube-steps"
            >
              {v.steps.map((step, i) => {
                const Icon = STEP_ICON[step.state];
                return (
                  <li
                    key={step.key}
                    className="flex gap-3 p-4"
                    data-testid={`acube-step-${step.key}`}
                    data-state={step.state}
                  >
                    <Icon
                      aria-hidden
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        step.state === "done" && "text-success",
                        step.state === "current" && "text-warning",
                        step.state === "failed" && "text-danger",
                        step.state === "todo" && "text-muted-foreground"
                      )}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-small font-medium text-foreground">
                          {i + 1}. {stepCopy[step.key].title}
                        </p>
                        <span className="text-caption text-muted-foreground">
                          {t[`einvoicing.stepState_${step.state}`]}
                        </span>
                      </div>
                      <p className="text-small text-muted-foreground">{stepCopy[step.key].body}</p>

                      {step.key === "reserve" && !le && (
                        <div className="space-y-3 pt-1">
                          <p className="text-small text-foreground">
                            {t["einvoicing.tinLabel"]}{" "}
                            <span className="font-medium">
                              {v.tin ? <Ltr>{v.tin}</Ltr> : t["einvoicing.tinMissing"]}
                            </span>
                          </p>
                          <fieldset className="space-y-2">
                            <legend className="text-small font-medium text-foreground">
                              {t["einvoicing.approverQuestion"]}
                            </legend>
                            <div className="flex flex-wrap gap-4">
                              {(["me", "someone_else"] as const).map((opt) => (
                                <label
                                  key={opt}
                                  className="inline-flex min-h-9 items-center gap-2 text-small"
                                >
                                  <input
                                    type="radio"
                                    name={`acube-approver-${companyId}`}
                                    value={opt}
                                    checked={approver === opt}
                                    onChange={() => setApprover(opt)}
                                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                                  />
                                  {t[`einvoicing.approver_${opt}`]}
                                </label>
                              ))}
                            </div>
                            {approver === "someone_else" && (
                              <div className="max-w-sm space-y-1.5">
                                <Label htmlFor={`acube-approver-email-${companyId}`}>
                                  {t["einvoicing.approverEmail"]}
                                </Label>
                                <Input
                                  id={`acube-approver-email-${companyId}`}
                                  type="email"
                                  dir="ltr"
                                  value={approverEmail}
                                  onChange={(e) => setApproverEmail(e.target.value)}
                                  autoComplete="email"
                                />
                                <p className="text-caption text-muted-foreground">
                                  {t["einvoicing.approverEmailHelp"]}
                                </p>
                              </div>
                            )}
                          </fieldset>
                          <Button
                            onClick={() => reserve.mutate()}
                            disabled={
                              reserve.isPending ||
                              !v.tin ||
                              (approver === "someone_else" && !approverEmail.includes("@"))
                            }
                            data-testid="acube-reserve"
                          >
                            {reserve.isPending && (
                              <Loader2 aria-hidden className="h-4 w-4 motion-safe:animate-spin" />
                            )}
                            {t["einvoicing.connectAcube"]}
                          </Button>
                        </div>
                      )}

                      {step.key === "approve" && le && le.status !== "active" && (
                        <div className="space-y-2 pt-1">
                          <ol className="list-decimal space-y-1 ps-5 text-small text-foreground">
                            <li>{t["einvoicing.emaraStep1"]}</li>
                            <li>{t["einvoicing.emaraStep2"]}</li>
                            <li>
                              {t["einvoicing.emaraStep3"]}{" "}
                              <span className="font-medium">
                                <Ltr>{v.emaraTaxListing}</Ltr>
                              </span>
                            </li>
                            <li>{t["einvoicing.emaraStep4"]}</li>
                          </ol>
                          {le.approver === "someone_else" && le.approverEmail && (
                            <p className="text-caption text-muted-foreground">
                              {formatMessage(t["einvoicing.approverPending"], {
                                email: le.approverEmail,
                              })}
                            </p>
                          )}
                          {le.reservationExpiresAt && (
                            <p className="text-caption text-muted-foreground">
                              {formatMessage(t["einvoicing.reservationExpires"], {
                                date: formatDate(le.reservationExpiresAt, locale),
                              })}
                            </p>
                          )}
                          {le.status === "inactive" && (
                            <p className="text-small text-danger-subtle-foreground">
                              {t["einvoicing.delinkedBody"]}
                            </p>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => sync.mutate()}
                            disabled={sync.isPending}
                            data-testid="acube-sync"
                          >
                            <RefreshCw
                              aria-hidden
                              className={cn(
                                "h-3.5 w-3.5",
                                sync.isPending && "motion-safe:animate-spin"
                              )}
                            />
                            {t["einvoicing.checkStatus"]}
                          </Button>
                        </div>
                      )}

                      {step.key === "synced" && le?.status === "active" && (
                        <dl
                          className="grid gap-x-6 gap-y-2 pt-1 text-small sm:grid-cols-2"
                          data-testid="acube-connected"
                        >
                          <div>
                            <dt className="text-caption text-muted-foreground">
                              {t["einvoicing.peppolAddress"]}
                            </dt>
                            <dd className="font-medium text-foreground">
                              <Ltr>{le.peppolAddress}</Ltr>
                            </dd>
                            <dd className="text-caption text-success-subtle-foreground">
                              {t["einvoicing.publishedOnPeppol"]}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-caption text-muted-foreground">
                              {t["einvoicing.legalName"]}
                            </dt>
                            <dd className="font-medium text-foreground" dir="auto">
                              {(locale === "ar" ? le.nameAr : le.nameEn) ?? le.nameEn ?? "—"}
                            </dd>
                          </div>
                          {le.lastSyncAt && (
                            <div>
                              <dt className="text-caption text-muted-foreground">
                                {t["einvoicing.lastSync"]}
                              </dt>
                              <dd className="text-foreground">
                                {formatDate(le.lastSyncAt, locale)}
                              </dd>
                            </div>
                          )}
                        </dl>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {err && (
              <p className="text-small text-danger-subtle-foreground" role="alert">
                {err.body?.code && t[`einvoicing.err_${err.body.code}`]
                  ? t[`einvoicing.err_${err.body.code}`]
                  : err.message}
              </p>
            )}
          </section>
        )}

        {v && (
          <dl className="grid gap-4 border-t border-border pt-5 text-small sm:grid-cols-3">
            <div>
              <dt className="text-caption text-muted-foreground">{t["einvoicing.goLive"]}</dt>
              <dd className="font-medium text-foreground" data-testid="acube-go-live">
                {v.goLive.goLiveDate
                  ? formatDate(v.goLive.goLiveDate, locale)
                  : t["einvoicing.goLiveUnset"]}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">
                {t["einvoicing.accreditation"]}
              </dt>
              <dd className="font-medium text-foreground">
                <Ltr>{v.accreditationNumber}</Ltr>
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">
                {t["einvoicing.registerLabel"]}
              </dt>
              <dd>
                <a
                  href={v.registerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline"
                  data-testid="acube-register-link"
                >
                  {t["einvoicing.registerLink"]}
                  <ExternalLink aria-hidden className="h-3.5 w-3.5 rtl:-scale-x-100" />
                </a>
              </dd>
            </div>
          </dl>
        )}

        {v && (
          <section aria-labelledby="acube-timeline-title" className="space-y-2">
            <h3 id="acube-timeline-title" className="text-small font-semibold text-foreground">
              {t["einvoicing.timelineTitle"]}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-small" data-testid="acube-timeline">
                <thead>
                  <tr className="border-b border-border text-caption text-muted-foreground">
                    <th scope="col" className="h-9 px-3 text-start font-medium">
                      {t["einvoicing.timelineWho"]}
                    </th>
                    <th scope="col" className="h-9 px-3 text-start font-medium whitespace-nowrap">
                      {t["einvoicing.timelineAppoint"]}
                    </th>
                    <th scope="col" className="h-9 px-3 text-start font-medium whitespace-nowrap">
                      {t["einvoicing.timelineGoLive"]}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(["large", "standard", "government"] as const).map((band) => {
                    const row = v.goLive.timeline[band];
                    if (!row) return null;
                    return (
                      <tr key={band} className={cn(v.goLive.band === band && "bg-muted/50")}>
                        <td className="px-3 py-2.5 text-foreground">
                          {t[`einvoicing.band_${band}`]}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {formatDate(row.appointAspBy, locale)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {formatDate(row.goLive, locale)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-caption text-muted-foreground">{t["einvoicing.timelineSource"]}</p>
          </section>
        )}

        <section aria-labelledby="acube-scope-title" className="space-y-2">
          <h3 id="acube-scope-title" className="text-small font-semibold text-foreground">
            {t["einvoicing.scopeNotesTitle"]}
          </h3>
          <ul className="list-disc space-y-1 ps-5 text-small text-muted-foreground">
            <li>{t["einvoicing.scopeB2b"]}</li>
            <li>{t["einvoicing.scopeB2c"]}</li>
            <li>{t["einvoicing.scopeCreditNotes"]}</li>
            <li>{t["einvoicing.scopeVoid"]}</li>
          </ul>
        </section>
      </div>
    </SectionCard>
  );
}
