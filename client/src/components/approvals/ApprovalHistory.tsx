import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ApprovalDocumentType, ApprovalHistoryResponse } from "@/lib/purchasing-hr";
import { ApprovalStatusBadge, useApproverRoleLabel } from "./ApprovalStatusBadge";
import { messages } from "./ApprovalHistory.i18n";

interface ApprovalHistoryProps {
  documentType: ApprovalDocumentType;
  documentId: string | null;
  onClose: () => void;
}

/** A drawer with every approval request of one document and each signed step. */
export function ApprovalHistory({ documentType, documentId, onClose }: ApprovalHistoryProps) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const roleLabel = useApproverRoleLabel();
  const { data, isLoading, isError } = useQuery<ApprovalHistoryResponse>({
    queryKey: ["/api/approvals", documentType, documentId],
    enabled: !!documentId,
  });

  return (
    <Sheet open={!!documentId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="drawer-approval-history">
        <SheetHeader>
          <SheetTitle>{tr("title")}</SheetTitle>
          <SheetDescription>{tr("description")}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {isLoading && <Skeleton className="h-24 w-full" aria-label={tr("loading")} />}
          {isError && <p className="text-sm text-destructive">{tr("loadFailed")}</p>}
          {data && data.requests.length === 0 && <p className="text-sm text-muted-foreground">{tr("empty")}</p>}
          {data?.requests.map((request) => (
            <section key={request.id} className="rounded-md border p-3 space-y-2" data-testid={`approval-request-${request.id}`}>
              <div className="flex items-center justify-between gap-2">
                <ApprovalStatusBadge status={request.status} completedSteps={request.completedSteps} requiredSteps={request.requiredSteps} />
                <span className="text-xs text-muted-foreground">{formatDate(request.createdAt, locale)}</span>
              </div>
              <p className="text-sm">{tr("rule", { name: request.ruleName })}</p>
              <p className="text-sm text-muted-foreground">{tr("amount", { amount: formatCurrency(Number(request.amountAed), "AED", locale) })}</p>
              <ol className="space-y-2">
                {request.steps.map((step) => (
                  <li key={`${request.id}-${step.stepNumber}-${step.decidedBy}`} className="text-sm border-s-2 ps-3">
                    <div className="font-medium">
                      {tr("stepRole", { step: step.stepNumber, role: roleLabel(step.requiredRole) })} -{" "}
                      {step.decision === "approved" ? tr("decisionApproved") : tr("decisionRejected")}
                    </div>
                    <div className="text-muted-foreground">
                      {step.decidedByName ? tr("by", { name: step.decidedByName }) : ""} {formatDate(step.decidedAt, locale)}
                    </div>
                    <div className="text-muted-foreground">{step.comment || tr("noComment")}</div>
                  </li>
                ))}
                {request.status === "pending" && request.completedSteps < request.requiredSteps && (
                  <li className="text-sm text-muted-foreground border-s-2 ps-3">
                    {tr("waiting", { role: roleLabel(request.requiredRoles[request.completedSteps]) })}
                  </li>
                )}
              </ol>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
