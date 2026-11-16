/**
 * Client side of the firm relationship (S4, W5-D follow-up): the company owner
 * accepts / declines a firm's invitation and revokes the firm's access; any
 * member answers engagement letters (typed-name acceptance) and uploads the
 * documents on the firm's request lists. APIs: server/routes/firm-practice.routes.ts
 * ("Client owner side").
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, FileSignature, Loader2, Upload, XCircle } from "lucide-react";
import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

export default function FirmRelationship() {
  const { companyId, company } = useDefaultCompany();
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
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
            return (
              <div
                key={inv.id}
                className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-end sm:justify-between"
                data-testid={`row-firm-invitation-${inv.id}`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{inv.firmName}</p>
                  {inv.message ? (
                    <p className="text-sm text-muted-foreground">{inv.message}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {owned.length > 0 ? (
                    <div className="space-y-1">
                      <Label className="text-xs">
                        <T k="portal.firmInvitationCompany" />
                      </Label>
                      <Select
                        value={target}
                        onValueChange={(v) => setChosen((c) => ({ ...c, [inv.id]: v }))}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {owned.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
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
      toast({ title: t["portal.firmAccessRevoked"] });
    },
    onError: (e: Error) =>
      toast({ title: t["portal.actionFailed"], description: e.message, variant: "destructive" }),
  });
  const links = data?.links ?? [];

  return (
    <Card data-testid="card-firm-access">
      <CardHeader>
        <CardTitle className="text-base">
          <T k="portal.firmAccess" /> {companyName ? `· ${companyName}` : null}
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
              <div className="flex items-center gap-2">
                <span className="font-medium">{link.firmName}</span>
                <Badge variant={STATUS_VARIANT[link.status] ?? "secondary"}>{link.status}</Badge>
              </div>
              {link.status === "active" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="w-64"
                    value={reason}
                    maxLength={500}
                    placeholder={t["portal.firmRevokeReason"]}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={revoke.isPending}
                    onClick={() => {
                      if (window.confirm(t["portal.firmRevokeConfirm"])) revoke.mutate(link.id);
                    }}
                    data-testid={`button-revoke-firm-${link.id}`}
                  >
                    <T k="portal.firmRevoke" />
                  </Button>
                </div>
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
            return (
              <div
                key={letter.id}
                className="space-y-2 rounded-md border p-3"
                data-testid={`row-engagement-letter-${letter.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{letter.title}</span>
                  <span className="text-xs text-muted-foreground">{letter.firmName}</span>
                  <Badge variant={STATUS_VARIANT[letter.status] ?? "secondary"}>
                    {letter.status}
                  </Badge>
                </div>
                <p className="whitespace-pre-wrap text-sm">{letter.body}</p>
                {letter.feeAmount != null ? (
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    AED {Number(letter.feeAmount).toFixed(2)}
                    {letter.billingCycle ? ` / ${letter.billingCycle}` : ""}
                  </p>
                ) : null}
                {letter.status === "sent" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">
                        <T k="portal.letterTypedName" />
                      </Label>
                      <Input
                        className="w-64"
                        value={typed}
                        maxLength={200}
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
                    <T k="portal.letterAcceptedBy" /> {letter.acceptedName}
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
  const { t } = useTranslation();
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
                    <span className="font-medium">{r.title}</span>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.firmName} · {r.listName}
                    {r.dueDate ? ` · ${r.dueDate}` : ""}
                  </p>
                  {r.description ? <p className="text-sm">{r.description}</p> : null}
                  {r.status === "rejected" && r.reviewNote ? (
                    <p className="text-xs text-destructive">{r.reviewNote}</p>
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
