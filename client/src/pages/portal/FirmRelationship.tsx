/**
 * Client side of the firm relationship (S4, W5-D follow-up): the company owner
 * accepts / declines a firm's invitation and revokes the firm's access; any
 * member answers engagement letters (typed-name acceptance) and uploads the
 * documents on the firm's request lists. APIs: server/routes/firm-practice.routes.ts
 * ("Client owner side").
 */
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSignature, Loader2, Upload, XCircle } from "lucide-react";
import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { openRequests, uploadCompanyDocument, type DocumentRequest } from "./firmRelationshipApi";

interface Invitation {
  id: string;
  firmId: string;
  firmName: string;
  message: string | null;
  invitedAt: string;
}
interface InvitationsPayload {
  invitations: Invitation[];
  ownedCompanies: Array<{ id: string; name: string }>;
}
interface FirmLink {
  id: string;
  firmId: string;
  firmName: string;
  status: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}
interface EngagementLetter {
  id: string;
  firmName: string;
  kind: string;
  title: string;
  body: string;
  feeAmount: string | number | null;
  billingCycle: string | null;
  status: "sent" | "accepted" | "declined";
  respondedAt: string | null;
  acceptedName: string | null;
}

const STATUS_VARIANT: Record<string, "secondary" | "success" | "danger" | "warning"> = {
  requested: "warning",
  rejected: "danger",
  uploaded: "secondary",
  accepted: "success",
  cancelled: "secondary",
  sent: "warning",
  declined: "danger",
  active: "success",
  revoked: "secondary",
  invited: "warning",
};

// WP-E (spec 3.15): statuses are shown as translated labels, never raw enums.
const STATUS_LABEL: Record<string, string> = {
  requested: "settingsPages.linkStatusRequested",
  rejected: "settingsPages.linkStatusRejected",
  uploaded: "settingsPages.linkStatusUploaded",
  accepted: "settingsPages.linkStatusAccepted",
  cancelled: "settingsPages.linkStatusCancelled",
  sent: "settingsPages.linkStatusSent",
  declined: "settingsPages.linkStatusDeclined",
  active: "settingsPages.linkStatusActive",
  revoked: "settingsPages.linkStatusRevoked",
  invited: "settingsPages.linkStatusInvited",
};

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const key = STATUS_LABEL[status];
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
      {key ? t[key] : t["settingsPages.linkStatusUnknown"]}
    </Badge>
  );
}

export default function FirmRelationship() {
  const { companyId, company } = useDefaultCompany();
  const { t } = useTranslation();
  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.settings}
          title={<T k="portal.firmRelationshipTitle" />}
          description={<T k="portal.firmRelationshipSubtitle" />}
        />
        <InvitationsCard />
        {companyId ? (
          <>
            <FirmAccessCard companyId={companyId} companyName={company?.name ?? ""} />
            <EngagementLettersCard companyId={companyId} />
            <RequestListCard companyId={companyId} />
          </>
        ) : null}
      </div>
    </SettingsLayout>
  );
}

function InvitationsCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const { data } = useQuery<InvitationsPayload>({ queryKey: ["/api/firm-invitations"] });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/firm-invitations"] });
    qc.invalidateQueries({ queryKey: ["/api/companies"] });
  };
  const accept = useMutation({
    mutationFn: ({ linkId, companyId }: { linkId: string; companyId: string }) =>
      apiRequest("POST", `/api/firm-invitations/${linkId}/accept`, { companyId }),
    onSuccess: () => {
      invalidate();
      toast({ title: t["portal.firmInvitationAccepted"] });
    },
    onError: (e: Error) =>
      toast({ title: t["portal.actionFailed"], description: e.message, variant: "destructive" }),
  });
  const decline = useMutation({
    mutationFn: (linkId: string) => apiRequest("POST", `/api/firm-invitations/${linkId}/decline`),
    onSuccess: () => {
      invalidate();
      toast({ title: t["portal.firmInvitationDeclined"] });
    },
    onError: (e: Error) =>
      toast({ title: t["portal.actionFailed"], description: e.message, variant: "destructive" }),
  });
  const invitations = data?.invitations ?? [];
  const owned = data?.ownedCompanies ?? [];

  return (
    <Card data-testid="card-firm-invitations">
      <CardHeader>
        <CardTitle className="text-base">
          <T k="portal.firmInvitations" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <T k="portal.noFirmInvitations" />
          </p>
        ) : (
          invitations.map((inv) => {
            const target = chosen[inv.id] ?? owned[0]?.id ?? "";
            const companyFieldId = `firm-invitation-company-${inv.id}`;
            return (
              <div
                key={inv.id}
                className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-end sm:justify-between"
                data-testid={`row-firm-invitation-${inv.id}`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    <bdi translate="no">{inv.firmName}</bdi>
                  </p>
                  {inv.message ? (
                    <p
                      className="text-sm text-muted-foreground [overflow-wrap:anywhere]"
                      dir="auto"
                      translate="no"
                    >
                      {inv.message}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {owned.length > 0 ? (
                    <div className="min-w-0 basis-full space-y-1 sm:basis-auto">
                      <Label htmlFor={companyFieldId} className="text-xs">
                        <T k="portal.firmInvitationCompany" />
                      </Label>
                      <Select
                        value={target}
                        onValueChange={(v) => setChosen((c) => ({ ...c, [inv.id]: v }))}
                      >
                        <SelectTrigger id={companyFieldId} className="w-full sm:w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {owned.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              <bdi translate="no">{c.name}</bdi>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      <T k="portal.firmInvitationOwnerOnly" />
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={!target || accept.isPending}
                    onClick={() => accept.mutate({ linkId: inv.id, companyId: target })}
                    data-testid={`button-accept-invitation-${inv.id}`}
                  >
                    <CheckCircle2 className="me-1 h-4 w-4" />
                    <T k="portal.accept" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decline.isPending}
                    onClick={() => decline.mutate(inv.id)}
                    data-testid={`button-decline-invitation-${inv.id}`}
                  >
                    <XCircle className="me-1 h-4 w-4" />
                    <T k="portal.decline" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function FirmAccessCard({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [revoking, setRevoking] = useState<FirmLink | null>(null);
  const key = ["/api/companies", companyId, "firm-links"];
  const { data, error } = useQuery<{ links: FirmLink[] }>({ queryKey: key, retry: false });
  const revoke = useMutation({
    mutationFn: (linkId: string) =>
      apiRequest("POST", `/api/companies/${companyId}/firm-links/${linkId}/revoke`, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setReason("");
      setRevoking(null);
      toast({ title: t["portal.firmAccessRevoked"] });
    },
    onError: (e: Error) =>
      toast({ title: t["portal.actionFailed"], description: e.message, variant: "destructive" }),
  });
  const links = data?.links ?? [];

  return (
    <Card data-testid="card-firm-access">
      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent data-testid="dialog-revoke-firm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t["settingsPages.revokeTitle"]}</AlertDialogTitle>
            <AlertDialogDescription>{t["portal.firmRevokeConfirm"]}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">{t["portal.firmRevokeReason"]}</Label>
            <Input
              id="revoke-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              dir="auto"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t["pages.cancel"]}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revoking && revoke.mutate(revoking.id)}
              data-testid="button-revoke-firm-confirm"
            >
              <T k="portal.firmRevoke" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CardHeader>
        <CardTitle className="text-base">
          <T k="portal.firmAccess" />
          {companyName ? (
            <>
              {" "}
              · <bdi translate="no">{companyName}</bdi>
            </>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="text-sm text-muted-foreground">
            <T k="portal.firmAccessOwnerOnly" />
          </p>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <T k="portal.noFirmAccess" />
          </p>
        ) : (
          links.map((link) => (
            <div
              key={link.id}
              className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`row-firm-link-${link.id}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <bdi className="font-medium [overflow-wrap:anywhere]" translate="no">
                  {link.firmName}
                </bdi>
                <StatusPill status={link.status} />
              </div>
              {link.status === "active" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-danger/40 text-danger hover:bg-danger-subtle hover:text-danger"
                  disabled={revoke.isPending}
                  onClick={() => setRevoking(link)}
                  data-testid={`button-revoke-firm-${link.id}`}
                >
                  <T k="portal.firmRevoke" />
                </Button>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function EngagementLettersCard({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const key = ["/api/companies", companyId, "engagement-letters"];
  const { data } = useQuery<{ letters: EngagementLetter[] }>({ queryKey: key, retry: false });
  const respond = useMutation({
    mutationFn: (input: { letterId: string; decision: "accept" | "decline"; typedName?: string }) =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/engagement-letters/${input.letterId}/respond`,
        input.decision === "accept"
          ? { decision: "accept", typedName: input.typedName }
          : { decision: "decline" }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast({ title: t["portal.letterResponded"] });
    },
    onError: (e: Error) =>
      toast({ title: t["portal.actionFailed"], description: e.message, variant: "destructive" }),
  });
  const letters = data?.letters ?? [];

  return (
    <Card data-testid="card-engagement-letters">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSignature className="h-4 w-4" />
          <T k="portal.engagementLetters" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {letters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <T k="portal.noEngagementLetters" />
          </p>
        ) : (
          letters.map((letter) => {
            const typed = names[letter.id] ?? "";
            const nameFieldId = `firm-letter-name-${letter.id}`;
            const billingCycle = letter.billingCycle;
            const billingCycleLabel =
              billingCycle && ["monthly", "quarterly", "annually"].includes(billingCycle)
                ? t[`pages.${billingCycle}`]
                : billingCycle;
            return (
              <div
                key={letter.id}
                className="space-y-2 rounded-md border p-3"
                data-testid={`row-engagement-letter-${letter.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <bdi className="font-medium [overflow-wrap:anywhere]" translate="no">
                    {letter.title}
                  </bdi>
                  <bdi
                    className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
                    translate="no"
                  >
                    {letter.firmName}
                  </bdi>
                  <StatusPill status={letter.status} />
                </div>
                <p
                  className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]"
                  dir="auto"
                  translate="no"
                >
                  {letter.body}
                </p>
                {letter.feeAmount != null ? (
                  <p className="text-xs text-muted-foreground">
                    <Money amount={Number(letter.feeAmount)} currency="AED" />
                    {billingCycleLabel ? (
                      <>
                        {" "}
                        / <bdi>{billingCycleLabel}</bdi>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {letter.status === "sent" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 basis-full space-y-1 sm:basis-auto">
                      <Label htmlFor={nameFieldId} className="text-xs">
                        <T k="portal.letterTypedName" />
                      </Label>
                      <Input
                        id={nameFieldId}
                        className="w-full sm:w-64"
                        value={typed}
                        maxLength={200}
                        dir="auto"
                        onChange={(e) => setNames((n) => ({ ...n, [letter.id]: e.target.value }))}
                        data-testid={`input-letter-name-${letter.id}`}
                      />
                    </div>
                    <Button
                      size="sm"
                      disabled={typed.trim().length < 2 || respond.isPending}
                      onClick={() =>
                        respond.mutate({
                          letterId: letter.id,
                          decision: "accept",
                          typedName: typed.trim(),
                        })
                      }
                      data-testid={`button-accept-letter-${letter.id}`}
                    >
                      <T k="portal.letterAccept" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ letterId: letter.id, decision: "decline" })}
                    >
                      <T k="portal.decline" />
                    </Button>
                    <p className="w-full text-xs text-muted-foreground">
                      <T k="portal.letterAcceptanceNote" />
                    </p>
                  </div>
                ) : letter.acceptedName ? (
                  <p className="text-xs text-muted-foreground">
                    <T k="portal.letterAcceptedBy" />{" "}
                    <bdi translate="no">{letter.acceptedName}</bdi>
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function RequestListCard({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const key = ["/api/companies", companyId, "firm-requests"];
  const { data } = useQuery<{ requests: DocumentRequest[] }>({ queryKey: key, retry: false });
  const requests = data?.requests ?? [];

  const upload = async (requestId: string, file: File) => {
    setBusy(requestId);
    try {
      const documentId = await uploadCompanyDocument(companyId, file);
      await apiRequest("POST", `/api/companies/${companyId}/firm-requests/${requestId}/fulfil`, {
        documentId,
      });
      qc.invalidateQueries({ queryKey: key });
      toast({ title: t["portal.requestUploaded"] });
    } catch (e) {
      toast({
        title: t["portal.actionFailed"],
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card data-testid="card-firm-requests">
      <CardHeader>
        <CardTitle className="text-base">
          <T k="portal.requestList" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <T k="portal.noRequests" />
          </p>
        ) : (
          requests.map((r) => {
            const open = openRequests([r]).length > 0;
            return (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`row-firm-request-${r.id}`}
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <bdi className="font-medium [overflow-wrap:anywhere]" translate="no">
                      {r.title}
                    </bdi>
                    <StatusPill status={r.status} />
                  </div>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    <bdi translate="no">{r.firmName}</bdi> · <bdi translate="no">{r.listName}</bdi>
                    {r.dueDate ? (
                      <>
                        {" "}
                        · <bdi>{formatDate(r.dueDate, locale)}</bdi>
                      </>
                    ) : null}
                  </p>
                  {r.description ? (
                    <p className="text-sm [overflow-wrap:anywhere]" dir="auto" translate="no">
                      {r.description}
                    </p>
                  ) : null}
                  {r.status === "rejected" && r.reviewNote ? (
                    <p
                      className="text-xs text-destructive [overflow-wrap:anywhere]"
                      dir="auto"
                      translate="no"
                    >
                      {r.reviewNote}
                    </p>
                  ) : null}
                </div>
                {open ? (
                  <div>
                    <input
                      type="file"
                      className="hidden"
                      ref={(el) => {
                        inputs.current[r.id] = el;
                      }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(r.id, file);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() => inputs.current[r.id]?.click()}
                      data-testid={`button-upload-request-${r.id}`}
                    >
                      {busy === r.id ? (
                        <Loader2 className="me-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="me-1 h-4 w-4" />
                      )}
                      <T k="portal.requestUpload" />
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
