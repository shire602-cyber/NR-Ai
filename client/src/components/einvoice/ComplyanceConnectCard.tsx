/**
 * E2: Settings → E-invoicing "Connect Complyance" card.
 *
 * Complyance's onboarding differs from A-Cube's: nothing is reserved first. The company's
 * administrator authorises Complyance in EmaraTax with an email; Muhasib then registers the
 * company at Complyance with its TIN and that email, and Complyance confirms it is ready for
 * invoicing. Each step's live state comes from GET /api/companies/:id/einvoicing/complyance.
 * Shows Complyance's MoF accreditation number with a link to the official register; when
 * Complyance is not connected on this server it says so and claims nothing.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  FiveCorners,
  Ltr,
  MandateTimeline,
  ProviderFacts,
  RequestConnection,
  ScopeNotes,
  type GoLiveView,
} from "./ProviderCardParts";
import { STEP_ICON, stepIconClass, type StepState } from "./provider-card-steps";

type StepKey = "request" | "authorize" | "ready";

export interface ComplyanceConnectionView {
  provider: "complyance";
  displayName: string;
  legalName: string;
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
    adminEmail: string | null;
    sourceName: string | null;
    sourceVersion: string | null;
    mappingReadinessCode: string | null;
    readyForInvoicing: boolean;
    lastError: string | null;
    lastSyncAt: string | null;
  } | null;
  canSend: boolean;
  steps: Array<{ key: StepKey; state: StepState }>;
  goLive: GoLiveView;
}

const STATUS_TONE: Record<string, StatusTone> = {
  reserved: "warning",
  pending: "warning",
  active: "success",
  inactive: "danger",
};

const STEP_COPY: Record<StepKey, { title: string; body: string }> = {
  request: { title: "einvoicing.cmpStepRequestTitle", body: "einvoicing.cmpStepRequestBody" },
  authorize: { title: "einvoicing.cmpStepAuthorizeTitle", body: "einvoicing.cmpStepAuthorizeBody" },
  ready: { title: "einvoicing.cmpStepReadyTitle", body: "einvoicing.cmpStepReadyBody" },
};

export function ComplyanceConnectCard({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const { gate } = useCompanyPermission();
  const setupGate = gate("settings.company");
  const key = ["/api/companies", companyId, "einvoicing", "complyance"];
  const view = useQuery<ComplyanceConnectionView>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/complyance`),
    retry: false,
  });
  const [adminEmail, setAdminEmail] = useState("");
  const applyConnection = (data: ComplyanceConnectionView) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({
      queryKey: ["/api/companies", companyId, "einvoicing", "settings"],
    });
  };
  const connect = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/einvoicing/complyance/connect`, {
        adminEmail,
      }),
    onSuccess: applyConnection,
  });
  const sync = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/einvoicing/complyance/sync`, {}),
    onSuccess: applyConnection,
  });

  const v = view.data;
  const le = v?.legalEntity ?? null;
  const name = v?.displayName ?? "Complyance";
  const statusLabel = !v?.configured
    ? t["einvoicing.notConnected"]
    : le
      ? t[`einvoicing.leStatus_${le.status}`]
      : t["einvoicing.leStatus_none"];
  const statusTone: StatusTone = !v?.configured
    ? "neutral"
    : le
      ? STATUS_TONE[le.status]
      : "neutral";
  const err = (connect.error ?? sync.error) as (Error & { body?: { code?: string } }) | null;
  const emailId = `cmp-admin-email-${companyId}`;

  return (
    <SectionCard
      testId="complyance-connect-card"
      title={t["einvoicing.cmpTitle"]}
      description={t["einvoicing.cmpDescription"]}
      actions={
        <span className="inline-flex flex-wrap items-center gap-2">
          {v?.configured && v.environment === "sandbox" && (
            <StatusBadge tone="info">{t["einvoicing.sandbox"]}</StatusBadge>
          )}
          <StatusBadge tone={statusTone} data-testid="complyance-status">
            {statusLabel}
          </StatusBadge>
        </span>
      }
    >
      <div className="space-y-6">
        <section aria-labelledby="complyance-model-title" className="space-y-3">
          <h3 id="complyance-model-title" className="text-small font-semibold text-foreground">
            {t["einvoicing.modelTitle"]}
          </h3>
          <FiveCorners
            prefix="complyance"
            corner2Title={formatMessage(t["einvoicing.corner2TitleProvider"], { provider: name })}
            corner5Body={formatMessage(t["einvoicing.corner5BodyProvider"], { provider: name })}
          />
        </section>

        {view.isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
        ) : !v ? (
          <p className="text-small text-muted-foreground" role="status">
            {t["einvoicing.loadFailed"]}
          </p>
        ) : !v.configured ? (
          <RequestConnection
            testId="complyance-not-configured"
            buttonTestId="complyance-request-connection"
            title={t["einvoicing.providerNotConnectedHeading"]}
            body={t["einvoicing.providerNotConnectedBody"]}
            subject={t["einvoicing.requestConnectionSubjectNeutral"]}
          />
        ) : (
          <section aria-labelledby="complyance-steps-title" className="space-y-3">
            <h3 id="complyance-steps-title" className="text-small font-semibold text-foreground">
              {t["einvoicing.stepsTitle"]}
            </h3>
            <ol
              className="divide-hairline rounded-lg border border-border"
              data-testid="complyance-steps"
            >
              {v.steps.map((step, i) => {
                const Icon = STEP_ICON[step.state];
                return (
                  <li
                    key={step.key}
                    className="flex gap-3 p-4"
                    data-testid={`complyance-step-${step.key}`}
                    data-state={step.state}
                  >
                    <Icon aria-hidden className={stepIconClass(step.state)} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-small font-medium text-foreground">
                          {i + 1}. {t[STEP_COPY[step.key].title]}
                        </p>
                        <span className="text-caption text-muted-foreground">
                          {t[`einvoicing.stepState_${step.state}`]}
                        </span>
                      </div>
                      <p className="text-small text-muted-foreground">
                        {t[STEP_COPY[step.key].body]}
                      </p>

                      {step.key === "request" && !le && (
                        <div className="space-y-3 pt-1">
                          <p className="text-small text-foreground">
                            {t["einvoicing.tinLabel"]}{" "}
                            <span className="font-medium">
                              {v.tin ? <Ltr>{v.tin}</Ltr> : t["einvoicing.tinMissing"]}
                            </span>
                          </p>
                          <div className="max-w-sm space-y-1.5">
                            <Label htmlFor={emailId}>{t["einvoicing.cmpAdminEmail"]}</Label>
                            <Input
                              id={emailId}
                              type="email"
                              dir="ltr"
                              value={adminEmail}
                              onChange={(e) => setAdminEmail(e.target.value)}
                              autoComplete="email"
                              aria-describedby={`${emailId}-help`}
                            />
                            <p
                              id={`${emailId}-help`}
                              className="text-caption text-muted-foreground"
                            >
                              {t["einvoicing.cmpAdminEmailHelp"]}
                            </p>
                          </div>
                          <Button
                            onClick={() => connect.mutate()}
                            {...setupGate}
                            disabled={
                              setupGate.disabled ||
                              connect.isPending ||
                              !v.tin ||
                              !adminEmail.includes("@")
                            }
                            data-testid="complyance-connect"
                          >
                            {connect.isPending && (
                              <Loader2 aria-hidden className="h-4 w-4 motion-safe:animate-spin" />
                            )}
                            {t["einvoicing.cmpConnect"]}
                          </Button>
                        </div>
                      )}

                      {step.key === "request" && le?.adminEmail && (
                        <p className="text-caption text-muted-foreground">
                          {t["einvoicing.cmpAdminEmail"]}: <Ltr>{le.adminEmail}</Ltr>
                        </p>
                      )}

                      {step.key === "authorize" &&
                        le &&
                        (le.status === "reserved" || le.status === "inactive") && (
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
                              <li>{t["einvoicing.cmpEmaraStep4"]}</li>
                            </ol>
                            {le.status === "reserved" && (
                              <p
                                className="text-caption text-muted-foreground"
                                data-testid="complyance-awaiting"
                              >
                                {t["einvoicing.cmpAwaitingAuth"]}
                              </p>
                            )}
                            {le.status === "inactive" && (
                              <p className="text-small text-danger-subtle-foreground">
                                {t["einvoicing.cmpInactive"]}
                              </p>
                            )}
                          </div>
                        )}

                      {step.key === "ready" && le?.status === "pending" && (
                        <p
                          className="text-caption text-muted-foreground"
                          data-testid="complyance-mapping-pending"
                        >
                          {t["einvoicing.cmpMappingPending"]}
                        </p>
                      )}

                      {((step.key === "authorize" && le?.status === "reserved") ||
                        (step.key === "ready" && le?.status === "pending") ||
                        (step.key === "authorize" && le?.status === "inactive")) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => sync.mutate()}
                          {...setupGate}
                          disabled={setupGate.disabled || sync.isPending}
                          data-testid="complyance-sync"
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
                      )}

                      {step.key === "ready" && le?.status === "active" && (
                        <dl
                          className="grid gap-x-6 gap-y-2 pt-1 text-small sm:grid-cols-2"
                          data-testid="complyance-connected"
                        >
                          <div>
                            <dt className="text-caption text-muted-foreground">
                              {t["einvoicing.peppolAddress"]}
                            </dt>
                            <dd className="font-medium text-foreground">
                              <Ltr>{le.peppolAddress}</Ltr>
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
                          {le.sourceName && (
                            <div>
                              <dt className="text-caption text-muted-foreground">
                                {t["einvoicing.cmpSource"]}
                              </dt>
                              <dd className="break-all text-foreground">
                                <Ltr>
                                  {le.sourceName}:{le.sourceVersion}
                                </Ltr>
                              </dd>
                            </div>
                          )}
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
          <ProviderFacts
            prefix="complyance"
            goLiveDate={v.goLive.goLiveDate}
            accreditationLabel={formatMessage(t["einvoicing.accreditationProvider"], {
              provider: name,
            })}
            accreditationNumber={v.accreditationNumber}
            registerUrl={v.registerUrl}
          />
        )}

        {v && (
          <MandateTimeline
            prefix="complyance"
            goLive={v.goLive}
            reportWindowText={formatMessage(t["einvoicing.reportWindowAssumptionProvider"], {
              provider: name,
            })}
          />
        )}

        <ScopeNotes prefix="complyance" />
      </div>
    </SectionCard>
  );
}
