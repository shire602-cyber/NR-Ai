import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, ClipboardCheck, History as HistoryIcon, Loader2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApprovalStatusBadge } from "@/components/approvals/ApprovalStatusBadge";
import { ApprovalHistory } from "@/components/approvals/ApprovalHistory";
import { ApprovalRulesPanel, documentTypeLabel, roleLabel } from "@/components/approvals/ApprovalRulesPanel";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useMyCompanyRole } from "@/hooks/useMyCompanyRole";
import { useSubscription } from "@/hooks/useSubscription";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { failureToast } from "@/lib/approval-feedback";
import {
  APPROVAL_DOCUMENT_TYPES,
  approvalActionPath,
  approvalDocumentHref,
  isPendingApprovalBody,
  type ApprovalDocumentType,
  type ApprovalQueueRow,
} from "@/lib/purchasing-hr";
import { messages } from "./Approvals.i18n";

type StatusFilter = "pending" | "approved" | "rejected" | "cancelled" | "all";

export default function Approvals() {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const { canAccess, getRequiredTier, isLoading: subLoading } = useSubscription();
  const { isOwner } = useMyCompanyRole(companyId ?? undefined);
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [type, setType] = useState<ApprovalDocumentType | "all">("all");
  const [historyFor, setHistoryFor] = useState<{ type: ApprovalDocumentType; id: string } | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalQueueRow | null>(null);
  const [comment, setComment] = useState("");

  const allowed = canAccess("approvals");
  const queueKey = ["/api/companies", companyId, "approvals"];

  const { data: rows = [], isLoading, isError } = useQuery<ApprovalQueueRow[]>({
    queryKey: [...queueKey, status, type],
    enabled: !!companyId && allowed,
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/approvals?status=${status}${type !== "all" ? `&documentType=${type}` : ""}`),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queueKey });
    for (const k of ["bills", "expense-claims", "purchase-orders", "payroll-runs"]) {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, k] });
    }
  };

  const approve = useMutation({
    mutationFn: (row: ApprovalQueueRow) =>
      apiRequest("POST", approvalActionPath(row.documentType, row.documentId), row.soleApprover ? { acknowledgeSoleApprover: true } : {}),
    onSuccess: (body: unknown) => {
      if (isPendingApprovalBody(body)) {
        toast({
          title: tr("stepToast"),
          description: tr("stepBody", { done: body.approval.completedSteps, total: body.approval.requiredSteps, role: roleLabel(tr, body.approval.nextRole ?? "") }),
        });
      } else {
        toast({ title: tr("approvedToast"), description: tr("approvedBody") });
      }
      refresh();
    },
    onError: (error: unknown) => toast(failureToast(error, tr("approveFailed"))),
  });

  const resubmit = useMutation({
    mutationFn: (row: ApprovalQueueRow) => apiRequest("POST", `/api/approvals/${row.documentType}/${row.documentId}/resubmit`, {}),
    onSuccess: () => {
      toast({ title: tr("resubmittedToast"), description: tr("resubmittedBody") });
      refresh();
    },
    onError: (error: unknown) => toast(failureToast(error, tr("resubmitFailed"))),
  });

  const reject = useMutation({
    mutationFn: (row: ApprovalQueueRow) => apiRequest("POST", `/api/approvals/${row.documentType}/${row.documentId}/reject`, { comment: comment.trim() || null }),
    onSuccess: () => {
      toast({ title: tr("rejectedToast") });
      setRejecting(null);
      setComment("");
      refresh();
    },
    onError: (error: unknown) => toast(failureToast(error, tr("rejectFailed"))),
  });

  if (!subLoading && !allowed) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} icon={ClipboardCheck} />
        <UpgradePrompt feature="approvals" requiredTier={getRequiredTier("approvals")} title={tr("upgradeTitle")} />
      </div>
    );
  }

  const renderActions = (row: ApprovalQueueRow, align: string) => (
    <div className={`flex flex-wrap gap-2 ${align}`}>
      {row.status === "pending" &&
        (row.canAct ? (
          <>
            <Button size="sm" onClick={() => approve.mutate(row)} disabled={approve.isPending} data-testid={`button-approve-${row.documentId}`}>
              {approve.isPending && approve.variables?.documentId === row.documentId ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 me-1" />}
              {tr("approve")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRejecting(row)} data-testid={`button-reject-${row.documentId}`}>
              <XCircle className="h-4 w-4 me-1" />
              {tr("reject")}
            </Button>
          </>
        ) : row.soleApprover ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.confirm(tr("soleConfirm")) && approve.mutate(row)}
            disabled={approve.isPending}
            data-testid={`button-approve-sole-${row.documentId}`}
          >
            <CheckCircle2 className="h-4 w-4 me-1" />
            {tr("approveAsSole")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground self-center">{tr("cannotAct")}</span>
        ))}
      {row.status === "rejected" && row.canResubmit && (
        <Button size="sm" onClick={() => resubmit.mutate(row)} disabled={resubmit.isPending} data-testid={`button-resubmit-${row.documentId}`}>
          {tr("resubmit")}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setHistoryFor({ type: row.documentType, id: row.documentId })} data-testid={`button-history-${row.documentId}`}>
        <HistoryIcon className="h-4 w-4 me-1" />
        {tr("history")}
      </Button>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-approvals">
      <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} icon={ClipboardCheck} />

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" data-testid="tab-approval-queue">{tr("tabQueue")}</TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-approval-rules">{tr("tabRules")}</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1 min-w-[160px]">
              <Label>{tr("filterStatus")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                <SelectTrigger data-testid="select-approval-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">{tr("statusPending")}</SelectItem>
                  <SelectItem value="approved">{tr("statusApproved")}</SelectItem>
                  <SelectItem value="rejected">{tr("statusRejected")}</SelectItem>
                  <SelectItem value="cancelled">{tr("statusCancelled")}</SelectItem>
                  <SelectItem value="all">{tr("statusAll")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[200px]">
              <Label>{tr("filterType")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as ApprovalDocumentType | "all")}>
                <SelectTrigger data-testid="select-approval-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("allTypes")}</SelectItem>
                  {APPROVAL_DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {documentTypeLabel(tr, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-48 w-full" aria-label={tr("loading")} />
          ) : isError ? (
            <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={tr("emptyTitle")} description={tr("emptyBody")} testId="empty-approvals" />
          ) : (
            <>
            <div className="space-y-3 md:hidden" data-testid="approval-cards">
              {rows.map((row) => (
                <div key={`card-${row.documentType}-${row.documentId}`} className="rounded-md border p-3 space-y-2" data-testid={`card-approval-${row.documentId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">{documentTypeLabel(tr, row.documentType)}</div>
                      <Link href={approvalDocumentHref(row.documentType, row.documentId)} className="font-medium hover:underline break-words">
                        {row.reference}
                      </Link>
                      {row.counterparty && <div className="text-sm text-muted-foreground break-words">{row.counterparty}</div>}
                    </div>
                    <div className="text-end tabular-nums font-medium shrink-0">{formatCurrency(row.amountAed, "AED", locale)}</div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-1">
                      <ApprovalStatusBadge status={row.status} completedSteps={row.completedSteps} requiredSteps={row.requiredSteps} />
                      {row.selfApproved && <StatusBadge tone="warning" data-testid={`badge-self-approved-${row.documentId}`}>{tr("selfApproved")}</StatusBadge>}
                    </span>
                    {row.status === "pending" && row.nextRole && <span className="text-xs text-muted-foreground">{roleLabel(tr, row.nextRole)}</span>}
                  </div>
                  {row.status === "rejected" && (
                    <p className="text-sm text-destructive break-words" data-testid={`text-rejection-reason-${row.documentId}`}>
                      {tr("rejectionReason", { reason: row.rejectionReason || tr("noReason"), by: row.rejectedByName || "-" })}
                    </p>
                  )}
                  {renderActions(row, "")}
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("colType")}</TableHead>
                    <TableHead>{tr("colReference")}</TableHead>
                    <TableHead>{tr("colWho")}</TableHead>
                    <TableHead className="text-end">{tr("colAmount")}</TableHead>
                    <TableHead>{tr("colProgress")}</TableHead>
                    <TableHead>{tr("colNext")}</TableHead>
                    <TableHead className="text-end">{tr("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.documentType}-${row.documentId}`} data-testid={`row-approval-${row.documentId}`}>
                      <TableCell>{documentTypeLabel(tr, row.documentType)}</TableCell>
                      <TableCell className="font-medium">
                        <Link href={approvalDocumentHref(row.documentType, row.documentId)} className="hover:underline" title={tr("open")}>
                          {row.reference}
                        </Link>
                      </TableCell>
                      <TableCell>{row.counterparty}</TableCell>
                      <TableCell className="text-end tabular-nums">{formatCurrency(row.amountAed, "AED", locale)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <ApprovalStatusBadge status={row.status} completedSteps={row.completedSteps} requiredSteps={row.requiredSteps} />
                          {row.selfApproved && <StatusBadge tone="warning" data-testid={`badge-self-approved-${row.documentId}`}>{tr("selfApproved")}</StatusBadge>}
                        </div>
                        {row.status === "rejected" && (
                          <p className="mt-1 max-w-xs text-xs text-destructive break-words" data-testid={`text-rejection-reason-${row.documentId}`}>
                            {tr("rejectionReason", { reason: row.rejectionReason || tr("noReason"), by: row.rejectedByName || "-" })}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{row.status === "pending" && row.nextRole ? roleLabel(tr, row.nextRole) : ""}</TableCell>
                      <TableCell className="text-end">{renderActions(row, "justify-end")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="rules">{companyId && <ApprovalRulesPanel companyId={companyId} isOwner={isOwner} />}</TabsContent>
      </Tabs>

      <ApprovalHistory documentType={historyFor?.type ?? "bill"} documentId={historyFor?.id ?? null} onClose={() => setHistoryFor(null)} />

      <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{tr("rejectTitle")}</DialogTitle>
            <DialogDescription>{tr("rejectBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="reject-comment">{tr("rejectComment")}</Label>
            <Textarea id="reject-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} data-testid="input-reject-comment" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              {tr("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => rejecting && reject.mutate(rejecting)} disabled={reject.isPending} data-testid="button-confirm-reject">
              {tr("rejectConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
