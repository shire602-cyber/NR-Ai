/**
 * WQ5: Settings › E-invoicing "Your e-invoicing partner" card.
 *
 * Every accredited provider compiled into this build is offered (the list comes from the
 * server registry, so this file names none of them). There is no default: the company picks.
 * EINVOICE_PROVIDER decides which one this deployment can actually connect; any other choice
 * reads "Not connected on this workspace". "Verify with partner" only runs when the chosen
 * partner is the configured one (it calls that provider's own sync route). Otherwise the
 * company can record "Confirmed by you, not yet verified".
 *
 * Appointment: "I'll approve it" shows the EmaraTax steps; "Someone else approves" creates a
 * single-purpose, expiring (14 days), revocable no-login link.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, Copy, Link2, ShieldCheck } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FormGrid } from "@/components/ui/form-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { useToast } from "@/hooks/use-toast";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { cn } from "@/lib/utils";
import { EmaraTaxSteps } from "./EmaraTaxSteps";
import { useTaxIdentity } from "./tax-identity";

export interface PartnerOptionView {
  id: string;
  displayName: string;
  legalName: string;
  accreditationNumber: string;
  website: string;
  emaraTaxListing: string;
  live: boolean;
}

export interface PartnerViewData {
  partners: PartnerOptionView[];
  chosen: string | null;
  liveProvider: string | null;
  verifyAvailable: boolean;
  appointment: {
    state: "not_started" | "awaiting_approval" | "approver_done" | "self_confirmed" | "verified";
    confirmedAt: string | null;
    legalEntityStatus: string | null;
  };
}

export interface ApproverLinkRow {
  id: string;
  approverName: string | null;
  approverEmail: string | null;
  state: "active" | "completed" | "expired" | "revoked";
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  url?: string;
  emailQueued?: boolean;
}

const APPOINTMENT_TONE: Record<PartnerViewData["appointment"]["state"], StatusTone> = {
  not_started: "neutral",
  awaiting_approval: "info",
  approver_done: "info",
  self_confirmed: "warning",
  verified: "success",
};

const LINK_TONE: Record<ApproverLinkRow["state"], StatusTone> = {
  active: "info",
  completed: "success",
  expired: "neutral",
  revoked: "neutral",
};

const partnerKey = (companyId: string) =>
  ["/api/companies", companyId, "einvoicing", "partner"] as const;
const linksKey = (companyId: string) =>
  ["/api/companies", companyId, "einvoicing", "approver-links"] as const;

export function EInvoicePartnerCard({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { gate, can, known } = useCompanyPermission();
  // `can` answers true while the role is unknown; do not ask the admin-only list until it is.
  const isAdmin = can("settings.company");
  const view = useQuery<PartnerViewData>({
    queryKey: partnerKey(companyId),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/partner`),
  });
  const identity = useTaxIdentity(companyId);
  const links = useQuery<ApproverLinkRow[]>({
    queryKey: linksKey(companyId),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/approver-links`),
    enabled: known && isAdmin,
  });
  const [whoChoice, setWho] = useState<"me" | "someone" | null>(null);
  const [approverName, setApproverName] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [created, setCreated] = useState<ApproverLinkRow | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = (next?: PartnerViewData) => {
    if (next) queryClient.setQueryData(partnerKey(companyId), next);
    void queryClient.invalidateQueries({ queryKey: linksKey(companyId) });
  };
  const onError = (err: Error) =>
    toast({
      variant: "destructive",
      title: t["einvoicing.partnerChoice.failed"],
      description: err.message,
    });

  const choose = useMutation({
    mutationFn: (partner: string | null) =>
      apiRequest("PUT", `/api/companies/${companyId}/einvoicing/partner`, { partner }),
    onSuccess: refresh,
    onError,
  });
  const selfConfirm = useMutation({
    mutationFn: (confirmed: boolean) =>
      apiRequest("POST", `/api/companies/${companyId}/einvoicing/partner/self-confirm`, {
        confirmed,
      }),
    onSuccess: refresh,
    onError,
  });
  const createLink = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/einvoicing/approver-links`, {
        approverName: approverName || null,
        approverEmail: approverEmail || null,
      }),
    onSuccess: (row: ApproverLinkRow) => {
      setCreated(row);
      setCopied(false);
      refresh();
      void queryClient.invalidateQueries({ queryKey: partnerKey(companyId) });
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/companies/${companyId}/einvoicing/approver-links/${id}/revoke`, {}),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: partnerKey(companyId) });
    },
    onError,
  });
  const verify = useMutation({
    mutationFn: (providerId: string) =>
      apiRequest("POST", `/api/companies/${companyId}/einvoicing/${providerId}/sync`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partnerKey(companyId) });
      toast({ title: t["einvoicing.partnerChoice.verifyDone"] });
    },
    onError,
  });

  // With requests already sent, show them (and their outcome) without another click.
  const who: "me" | "someone" = whoChoice ?? (links.data?.length ? "someone" : "me");
  const data = view.data;
  const chosen = data?.partners.find((p) => p.id === data.chosen) ?? null;
  const missing = identity.data?.missing.length ?? 0;
  const state = data?.appointment.state ?? "not_started";

  return (
    <SectionCard
      testId="einvoice-partner-card"
      title={t["einvoicing.partnerChoice.title"]}
      description={t["einvoicing.partnerChoice.description"]}
      actions={
        data && (
          <StatusBadge tone={APPOINTMENT_TONE[state]} data-testid="einvoice-appointment-state">
            {t[`einvoicing.partnerChoice.state_${state}`]}
          </StatusBadge>
        )
      }
    >
      {!data ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      ) : (
        <div className="space-y-6">
          <fieldset className="space-y-2">
            <legend className="text-small font-semibold text-foreground">
              {t["einvoicing.partnerChoice.pick"]}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
              {data.partners.map((p) => {
                const selected = p.id === data.chosen;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!isAdmin || choose.isPending}
                    onClick={() => choose.mutate(selected ? null : p.id)}
                    data-testid={`einvoice-partner-option-${p.id}`}
                    className={cn(
                      "rounded-xl border bg-card p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-brand-500 ring-1 ring-brand-500"
                        : "border-border hover:border-brand-300"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{p.displayName}</p>
                        <p className="truncate text-caption text-muted-foreground" translate="no">
                          {p.legalName}
                        </p>
                      </div>
                      {selected && (
                        <Check className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
                      )}
                    </div>
                    <p className="mt-2 text-caption text-muted-foreground">
                      {formatMessage(t["einvoicing.partnerChoice.accreditation"], {
                        number: p.accreditationNumber,
                      })}
                    </p>
                    <StatusBadge tone={p.live ? "success" : "neutral"} className="mt-2">
                      {p.live
                        ? t["einvoicing.partnerChoice.live"]
                        : t["einvoicing.partnerChoice.notConnected"]}
                    </StatusBadge>
                  </button>
                );
              })}
            </div>
            <p className="text-caption text-muted-foreground">
              {t["einvoicing.partnerChoice.noDefault"]}
            </p>
          </fieldset>

          {chosen && (
            <ol className="space-y-5">
              <li className="space-y-1" data-testid="partner-step-details">
                <p className="text-small font-semibold text-foreground">
                  {t["einvoicing.partnerChoice.stepDetails"]}
                </p>
                <p className="text-small text-muted-foreground">
                  {missing
                    ? formatMessage(t["einvoicing.partnerChoice.detailsMissing"], {
                        count: missing,
                      })
                    : t["einvoicing.partnerChoice.detailsDone"]}{" "}
                  <Link href="/settings/company" className="font-medium text-brand-700 underline">
                    {t["einvoicing.partnerChoice.detailsLink"]}
                  </Link>
                </p>
              </li>

              <li className="space-y-3" data-testid="partner-step-appoint">
                <p className="text-small font-semibold text-foreground">
                  {formatMessage(t["einvoicing.partnerChoice.stepAppoint"], {
                    partner: chosen.displayName,
                  })}
                </p>
                <div className="flex flex-wrap gap-2" role="group">
                  <Button
                    type="button"
                    size="sm"
                    variant={who === "me" ? "default" : "outline"}
                    aria-pressed={who === "me"}
                    onClick={() => setWho("me")}
                    data-testid="appoint-me"
                  >
                    {t["einvoicing.partnerChoice.whoMe"]}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={who === "someone" ? "default" : "outline"}
                    aria-pressed={who === "someone"}
                    onClick={() => setWho("someone")}
                    data-testid="appoint-someone"
                  >
                    {t["einvoicing.partnerChoice.whoSomeone"]}
                  </Button>
                </div>
                {who === "me" ? (
                  <EmaraTaxSteps partner={chosen} companyName={companyName} />
                ) : (
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <p className="text-small text-muted-foreground">
                      {t["einvoicing.partnerChoice.linkIntro"]}
                    </p>
                    <FormGrid>
                      <Field id="approver-name" label={t["einvoicing.partnerChoice.linkName"]}>
                        <Input
                          dir="auto"
                          value={approverName}
                          onChange={(e) => setApproverName(e.target.value)}
                          data-testid="approver-link-name"
                        />
                      </Field>
                      <Field
                        id="approver-email"
                        label={t["einvoicing.partnerChoice.linkEmail"]}
                        help={t["einvoicing.partnerChoice.linkEmailHelp"]}
                      >
                        <Input
                          type="email"
                          ltr
                          value={approverEmail}
                          onChange={(e) => setApproverEmail(e.target.value)}
                          data-testid="approver-link-email"
                        />
                      </Field>
                    </FormGrid>
                    <Button
                      type="button"
                      onClick={() => createLink.mutate()}
                      disabled={createLink.isPending}
                      data-testid="approver-link-create"
                      {...gate("settings.company")}
                    >
                      <Link2 className="h-4 w-4" aria-hidden />
                      {t["einvoicing.partnerChoice.linkCreate"]}
                    </Button>
                    {created?.url && (
                      <div
                        className="space-y-2 rounded-lg bg-surface-sunken p-3"
                        data-testid="approver-link-created"
                      >
                        <p className="text-small font-medium text-foreground">
                          {created.emailQueued
                            ? t["einvoicing.partnerChoice.linkCreatedEmailed"]
                            : t["einvoicing.partnerChoice.linkCreated"]}
                        </p>
                        <div className="flex gap-2">
                          <Input
                            ltr
                            readOnly
                            value={created.url}
                            aria-label={t["einvoicing.partnerChoice.linkUrl"]}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              void navigator.clipboard?.writeText(created.url!);
                              setCopied(true);
                            }}
                          >
                            <Copy className="h-4 w-4" aria-hidden />
                            {copied
                              ? t["einvoicing.partnerChoice.copied"]
                              : t["einvoicing.partnerChoice.copy"]}
                          </Button>
                        </div>
                        <p className="text-caption text-muted-foreground">
                          {t["einvoicing.partnerChoice.linkShownOnce"]}
                        </p>
                      </div>
                    )}
                    {!!links.data?.length && (
                      <ul className="divide-y divide-border" data-testid="approver-link-list">
                        {links.data.map((l) => (
                          <li
                            key={l.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-small text-foreground">
                                {l.approverName ||
                                  l.approverEmail ||
                                  t["einvoicing.partnerChoice.linkUnnamed"]}
                              </p>
                              <p className="text-caption text-muted-foreground">
                                {formatMessage(t["einvoicing.partnerChoice.linkExpires"], {
                                  date: formatDate(l.expiresAt, locale),
                                })}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge tone={LINK_TONE[l.state]}>
                                {t[`einvoicing.partnerChoice.link_${l.state}`]}
                              </StatusBadge>
                              {l.state === "active" && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => revoke.mutate(l.id)}
                                  data-testid={`approver-link-revoke-${l.id}`}
                                  {...gate("settings.company")}
                                >
                                  {t["einvoicing.partnerChoice.linkRevoke"]}
                                </Button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>

              <li className="space-y-3" data-testid="partner-step-verify">
                <p className="text-small font-semibold text-foreground">
                  {formatMessage(t["einvoicing.partnerChoice.stepVerify"], {
                    partner: chosen.displayName,
                  })}
                </p>
                {data.verifyAvailable ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => verify.mutate(chosen.id)}
                    disabled={verify.isPending}
                    data-testid="partner-verify"
                    {...gate("settings.company")}
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    {formatMessage(t["einvoicing.partnerChoice.verify"], {
                      partner: chosen.displayName,
                    })}
                  </Button>
                ) : (
                  <p
                    className="text-small text-muted-foreground"
                    data-testid="partner-verify-unavailable"
                  >
                    {formatMessage(t["einvoicing.partnerChoice.verifyUnavailable"], {
                      partner: chosen.displayName,
                    })}
                  </p>
                )}
                {state !== "verified" && (
                  <label className="flex min-h-11 items-start gap-2 py-1 text-small text-foreground">
                    <Checkbox
                      checked={!!data.appointment.confirmedAt}
                      disabled={!isAdmin || selfConfirm.isPending}
                      onCheckedChange={(v) => selfConfirm.mutate(v === true)}
                      data-testid="partner-self-confirm"
                    />
                    <span>
                      {formatMessage(t["einvoicing.partnerChoice.selfConfirm"], {
                        partner: chosen.displayName,
                      })}
                      {data.appointment.confirmedAt && (
                        <span className="block text-caption text-muted-foreground">
                          {formatMessage(t["einvoicing.partnerChoice.selfConfirmedOn"], {
                            date: formatDate(data.appointment.confirmedAt, locale),
                          })}
                        </span>
                      )}
                    </span>
                  </label>
                )}
                <p className="text-caption text-muted-foreground">
                  {t["einvoicing.partnerChoice.transmissionOff"]}
                </p>
              </li>
            </ol>
          )}
        </div>
      )}
    </SectionCard>
  );
}
