import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  FolderSearch,
  History,
  Mail,
  SearchCheck,
  Send,
  ShieldCheck,
  Target,
} from "lucide-react";

import { apiUrl } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  EvidenceCenterResponse,
  EvidenceIssue,
  EvidenceOwnerAction,
  EvidenceProofLine,
  EvidenceWorkflowId,
} from "@shared/evidence-center";
import { messages as pageMessages } from "./EvidenceCenter.i18n";

const WORKFLOW_ICONS: Record<EvidenceWorkflowId, any> = {
  refund_pack: FolderSearch,
  proof_drilldown: SearchCheck,
  corporate_tax_workpaper: FileText,
  missing_evidence: ClipboardList,
  client_request_autopilot: Mail,
  month_end_cockpit: ClipboardCheck,
  filing_risk_scan: ShieldCheck,
  smart_excel_import: FileSpreadsheet,
  filing_timeline: CalendarDays,
  owner_actions: Target,
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "destructive",
  warning: "secondary",
  info: "outline",
  good: "default",
};

function scoreTone(score: number) {
  if (score >= 80) return "text-success";
  if (score >= 55) return "text-warning";
  return "text-destructive";
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-AE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function severityBadge(issue: Pick<EvidenceIssue, "severity">) {
  return (SEVERITY_BADGE[issue.severity] ?? "outline") as
    | "default"
    | "secondary"
    | "destructive"
    | "outline";
}

function priorityBadge(action: EvidenceOwnerAction) {
  if (action.priority === "now") return "destructive";
  if (action.priority === "next") return "secondary";
  return "outline";
}

function issueIsOpen(issue: EvidenceIssue) {
  return (issue.resolutionStatus ?? "open") === "open";
}

function resolutionBadge(issue: EvidenceIssue) {
  const status = issue.resolutionStatus ?? "open";
  if (status === "resolved") return "default";
  if (status === "waived") return "secondary";
  return "outline";
}

function documentBadge(line: EvidenceProofLine) {
  if (line.documentStatus === "attached" || line.documentStatus === "generated") return "default";
  if (line.documentStatus === "missing") return "destructive";
  return "secondary";
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

function getSourceFilter(search: string) {
  const params = new URLSearchParams(search);
  const sourceType = params.get("sourceType");
  if (!sourceType) return null;
  return {
    sourceType,
    sourceId: params.get("sourceId"),
  };
}

export default function EvidenceCenter() {
  const tr = pageMessages.useT();

  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { toast } = useToast();
  const search = useSearch();
  const [exportingPack, setExportingPack] = useState<"xlsx" | "pdf" | "zip" | null>(null);
  const [issueDialog, setIssueDialog] = useState<{
    issue: EvidenceIssue;
    action: "resolve" | "waive";
  } | null>(null);
  const [issueReason, setIssueReason] = useState("");
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestRecipient, setRequestRecipient] = useState("");
  const [requestAcknowledged, setRequestAcknowledged] = useState(false);

  const evidenceQueryKey = useMemo(
    () => ["/api/companies", companyId, "evidence-center"],
    [companyId]
  );

  const { data, isLoading, error } = useQuery<EvidenceCenterResponse>({
    queryKey: evidenceQueryKey,
    enabled: !!companyId,
  });

  const sourceFilter = useMemo(() => getSourceFilter(search), [search]);
  const visibleProofLines = useMemo(() => {
    if (!data || !sourceFilter) return data?.proofDrilldowns ?? [];
    return data.proofDrilldowns.filter((line) => {
      if (line.sourceType !== sourceFilter.sourceType) return false;
      if (!sourceFilter.sourceId) return true;
      return (
        line.sourceId === sourceFilter.sourceId || line.sourceDocumentId === sourceFilter.sourceId
      );
    });
  }, [data, sourceFilter]);

  const topMetrics = useMemo(() => {
    if (!data) return [];
    const openMissingEvidenceCount = data.missingEvidence.filter(issueIsOpen).length;
    const openRiskSignalCount = data.filingRiskScan.filter(issueIsOpen).length;
    return [
      {
        label: tr("evidenceReadiness"),
        value: `${data.readinessScore}%`,
        detail: tr("allOpenEvidenceAndFilingRisks"),
      },
      {
        label: tr("refundExposure"),
        value: formatCurrency(data.totals.refundExposure),
        detail: tr("inputVatAboveOutputVat"),
      },
      {
        label: tr("missingEvidence"),
        value: String(openMissingEvidenceCount),
        detail: tr("documentsTrnsSourceProof"),
      },
      {
        label: tr("riskSignals"),
        value: String(openRiskSignalCount),
        detail: tr("preFilingDetectorOutput"),
      },
    ];
  }, [data]);

  useEffect(() => {
    if (!data || typeof window === "undefined") return;

    const targetId = window.location.hash.slice(1);
    if (!targetId) return;

    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    setRequestRecipient(data.clientRequestDraft.defaultRecipient ?? "");
  }, [data]);

  const issueActionMutation = useMutation({
    mutationFn: async () => {
      if (!companyId || !issueDialog) throw new Error("Missing evidence issue");
      return apiRequest(
        "POST",
        `/api/companies/${companyId}/evidence-center/issues/${encodeURIComponent(
          issueDialog.issue.id
        )}/actions`,
        {
          action: issueDialog.action,
          reason: issueReason,
        }
      );
    },
    onSuccess: (result: EvidenceCenterResponse) => {
      queryClient.setQueryData(evidenceQueryKey, result);
      toast({
        title: issueDialog?.action === "resolve" ? tr("issueResolved") : tr("issueWaived"),
        description: tr("theEvidenceActionWasAuditLogged"),
      });
      setIssueDialog(null);
      setIssueReason("");
    },
    onError: (mutationError: any) => {
      toast({
        variant: "destructive",
        title: tr("couldNotUpdateEvidenceIssue"),
        description: mutationError?.message,
      });
    },
  });

  const requestReviewMutation = useMutation({
    mutationFn: async () => {
      if (!companyId || !data) throw new Error("Missing evidence request");
      return apiRequest(
        "POST",
        `/api/companies/${companyId}/evidence-center/client-request/review`,
        {
          recipient: requestRecipient,
          subject: data.clientRequestDraft.subject,
          body: data.clientRequestDraft.body,
          acknowledgedExactContent: requestAcknowledged,
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evidenceQueryKey });
      toast({
        title: tr("requestReviewed"),
        description: tr("auditLoggedForManualDeliveryNo"),
      });
      setRequestDialogOpen(false);
      setRequestAcknowledged(false);
    },
    onError: (mutationError: any) => {
      toast({
        variant: "destructive",
        title: tr("couldNotLogReviewedRequest"),
        description: mutationError?.message,
      });
    },
  });

  const downloadEvidenceArtifact = async (
    href: string,
    fallbackName: string,
    type: "xlsx" | "pdf" | "zip"
  ) => {
    setExportingPack(type);
    try {
      const response = await fetch(apiUrl(href), { credentials: "include" });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filenameFromDisposition(
        response.headers.get("Content-Disposition"),
        fallbackName
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      queryClient.invalidateQueries({ queryKey: evidenceQueryKey });
      toast({ title: tr("evidencePackDownloaded"), description: link.download });
    } catch (downloadError: any) {
      toast({
        variant: "destructive",
        title: tr("evidencePackDownloadFailed"),
        description: downloadError?.message,
      });
    } finally {
      setExportingPack(null);
    }
  };

  if (isLoadingCompany || isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>{tr("proofTrailUnavailable")}</CardTitle>
            <CardDescription>{tr("theProofWorkspaceCouldNotLoad")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="evidence-center-page">
      <PageHeader
        eyebrow={tr("compliance")}
        title={tr("proofTrail")}
        description={tr("contextualEvidenceBehindVatInvoicesPurchases")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/vat-filing">{tr("openVatWorkpaper")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/corporate-tax">{tr("openCorporateTax")}</Link>
            </Button>
            <Button asChild>
              <Link href="#owner-actions">{tr("whatShouldIDo")}</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void downloadEvidenceArtifact(
                  data.refundPack.bundleHref,
                  data.refundPack.bundleFilename,
                  "zip"
                )
              }
              disabled={exportingPack !== null}
              data-testid="button-download-refund-bundle"
            >
              <Archive className="me-2 h-4 w-4" />
              {tr("zipBundle")}
            </Button>
          </div>
        }
      />

      {sourceFilter ? (
        <section className="rounded-md border bg-muted/40 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold">{tr("focusedSourceProof")}</h2>
              <p className="text-sm text-muted-foreground">
                {tr("showingProofRowsFor", { replace: sourceFilter.sourceType.replace(/_/g, " ") })}
                {sourceFilter.sourceId ? ` ${sourceFilter.sourceId}` : ""}.
              </p>
            </div>
            <Badge variant={visibleProofLines.length ? "default" : "secondary"}>
              {tr.plural("matchingRows", visibleProofLines.length)}
            </Badge>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4" data-testid="evidence-center-summary">
        {topMetrics.map((metric) => (
          <div key={metric.label} className="rounded-md border bg-card p-4">
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                metric.label === "Evidence readiness" ? scoreTone(data.readinessScore) : ""
              }`}
            >
              {metric.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
        {data.workflows.map((workflow) => {
          const Icon = WORKFLOW_ICONS[workflow.id];
          return (
            <Card key={workflow.id} data-testid={`evidence-workflow-${workflow.id}`}>
              <CardHeader className="space-y-2 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                      <Icon className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-base">{workflow.title}</CardTitle>
                  </div>
                  <Badge variant={workflow.status === "ready" ? "default" : "secondary"}>
                    {statusLabel(workflow.status)}
                  </Badge>
                </div>
                <CardDescription>{workflow.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{tr("score")}</p>
                    <p className={`text-2xl font-semibold ${scoreTone(workflow.score)}`}>
                      {workflow.score}%
                    </p>
                  </div>
                  <p className="max-w-40 text-end text-sm font-medium">{workflow.metric}</p>
                </div>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {workflow.bullets.slice(0, 3).map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={workflow.primaryHref}>
                    {workflow.primaryAction}
                    <ArrowRight className="ms-2 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section
        id="refund-pack-export"
        className="rounded-md border bg-card"
        data-testid="refund-pack-export"
      >
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <h2 className="font-semibold">{tr("vatRefundSupportPack")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {tr("downloadOneSourceEvidenceBundleOr")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {tr("sheets", { sheetCount: data.refundPack.sheetCount })}
              </Badge>
              <Badge variant="outline">
                {tr("proofLines", { proofLineCount: data.refundPack.proofLineCount })}
              </Badge>
              <Badge variant="outline">
                {tr("linkedSourceFiles", {
                  readyAttachmentCount: data.refundPack.readyAttachmentCount,
                })}
              </Badge>
              <Badge variant={data.refundPack.gapCount ? "secondary" : "default"}>
                {tr("openGaps", { gapCount: data.refundPack.gapCount })}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void downloadEvidenceArtifact(
                  data.refundPack.bundleHref,
                  data.refundPack.bundleFilename,
                  "zip"
                )
              }
              disabled={exportingPack !== null}
            >
              <Archive className="me-2 h-4 w-4" />
              {tr("sourceZip")}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void downloadEvidenceArtifact(
                  data.refundPack.workbookHref,
                  data.refundPack.workbookFilename,
                  "xlsx"
                )
              }
              disabled={exportingPack !== null}
            >
              <Download className="me-2 h-4 w-4" />
              {tr("workbook")}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void downloadEvidenceArtifact(
                  data.refundPack.coverHref,
                  data.refundPack.coverFilename,
                  "pdf"
                )
              }
              disabled={exportingPack !== null}
            >
              <FileDown className="me-2 h-4 w-4" />
              {tr("coverPdf")}
            </Button>
          </div>
        </div>
      </section>

      <section id="owner-actions" className="rounded-md border bg-card" data-testid="owner-actions">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{tr("ownerFriendlyWhatShouldIDo")}</h2>
          <p className="text-sm text-muted-foreground">
            {tr("plainLanguageNextActionsGeneratedFrom")}
          </p>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {data.ownerActions.map((action) => (
            <div key={action.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium">{action.title}</h3>
                <Badge variant={priorityBadge(action) as any}>{action.priority}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{action.detail}</p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href={action.href}>{action.actionLabel}</Link>
              </Button>
            </div>
          ))}
        </div>
      </section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
        <section
          id="missing-evidence"
          className="min-w-0 overflow-hidden rounded-md border bg-card"
        >
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">{tr("missingEvidenceInbox")}</h2>
            <p className="text-sm text-muted-foreground">
              {tr("documentsTrnsAttachmentsAndSourceProof")}
            </p>
          </div>
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("severity")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                  <TableHead>{tr("item")}</TableHead>
                  <TableHead>{tr("source")}</TableHead>
                  <TableHead className="text-end">{tr("amount")}</TableHead>
                  <TableHead className="text-end">{tr("action")}</TableHead>
                  <TableHead className="text-end">{tr("audit")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.missingEvidence.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {tr("noMissingEvidenceItems")}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.missingEvidence.slice(0, 12).map((issue) => (
                    <TableRow key={issue.id}>
                      <TableCell>
                        <Badge variant={severityBadge(issue)}>{issue.severity}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={resolutionBadge(issue) as any}>
                          {issue.resolutionStatus ?? tr("open")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{issue.title}</p>
                        <p className="text-sm text-muted-foreground">{issue.detail}</p>
                        {issue.resolutionReason ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tr("auditReason", { resolutionReason: issue.resolutionReason })}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>{issue.sourceType || tr("company")}</TableCell>
                      <TableCell className="text-end">
                        {issue.amount ? formatCurrency(issue.amount) : "-"}
                      </TableCell>
                      <TableCell className="text-end">
                        {issue.href ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={issue.href}>{issue.actionLabel || tr("open2")}</Link>
                          </Button>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!issueIsOpen(issue)}
                            data-testid={`button-resolve-evidence-${issue.id}`}
                            onClick={() => {
                              setIssueDialog({ issue, action: "resolve" });
                              setIssueReason("");
                            }}
                          >
                            {tr("resolve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!issueIsOpen(issue)}
                            data-testid={`button-waive-evidence-${issue.id}`}
                            onClick={() => {
                              setIssueDialog({ issue, action: "waive" });
                              setIssueReason("");
                            }}
                          >
                            {tr("waive")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section id="request-draft" className="min-w-0 overflow-hidden rounded-md border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">{tr("clientRequestAutopilot")}</h2>
            <p className="text-sm text-muted-foreground">{tr("draftOnlyNothingIsSentFrom")}</p>
          </div>
          <div className="space-y-3 p-4">
            <div className="space-y-2">
              <Label htmlFor="evidence-request-recipient">{tr("recipientEmail")}</Label>
              <Input
                id="evidence-request-recipient"
                type="email"
                value={requestRecipient}
                onChange={(event) => setRequestRecipient(event.target.value)}
                placeholder="client@example.com"
                data-testid="input-evidence-request-recipient"
              />
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{tr("subject")}</p>
              <p className="font-medium">{data.clientRequestDraft.subject}</p>
            </div>
            <Textarea
              readOnly
              value={data.clientRequestDraft.body}
              className="min-h-72 font-mono text-xs"
              data-testid="evidence-request-draft"
            />
            <p className="text-xs text-muted-foreground">
              {tr("thisDraftDeliberatelyWarnsAgainstSharing")}
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setRequestAcknowledged(false);
                setRequestDialogOpen(true);
              }}
              data-testid="button-review-evidence-request"
            >
              <Send className="me-2 h-4 w-4" />
              {tr("reviewExactRequest")}
            </Button>
          </div>
        </section>
      </div>

      <section id="proof-drilldown" className="min-w-0 overflow-hidden rounded-md border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{tr("everyNumberHasProof")}</h2>
          <p className="text-sm text-muted-foreground">{tr("sourceRowsBehindVatSalesPurchase")}</p>
        </div>
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("source")}</TableHead>
                <TableHead>{tr("date")}</TableHead>
                <TableHead>{tr("party")}</TableHead>
                <TableHead>{tr("document")}</TableHead>
                <TableHead>{tr("status")}</TableHead>
                <TableHead>{tr("evidenceFile")}</TableHead>
                <TableHead className="text-end">{tr("amount")}</TableHead>
                <TableHead className="text-end">{tr("vat")}</TableHead>
                <TableHead className="text-end">{tr("open2")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProofLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {sourceFilter ? tr("noProofRowIsLinkedTo") : tr("noProofRowsYetStartFrom")}
                  </TableCell>
                </TableRow>
              ) : (
                visibleProofLines.slice(0, 20).map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.label}</TableCell>
                    <TableCell>{formatDate(line.date)}</TableCell>
                    <TableCell>{line.party || "-"}</TableCell>
                    <TableCell>{line.documentNumber || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">{line.status}</Badge>
                        <Badge
                          variant={
                            line.proofStatus === "ready"
                              ? "default"
                              : line.proofStatus === "missing"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {statusLabel(line.proofStatus)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-52 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={documentBadge(line) as any}>
                            {statusLabel(line.documentStatus)}
                          </Badge>
                          <span className="text-sm font-medium">{line.documentLabel}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{line.documentPreview}</p>
                        {line.documentHref ? (
                          <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                            <Link href={line.documentHref}>
                              <Eye className="me-1.5 h-3.5 w-3.5" />
                              {tr("previewSource")}
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-end">{formatCurrency(line.amount)}</TableCell>
                    <TableCell className="text-end">
                      {formatCurrency(Number(line.vatAmount || 0))}
                    </TableCell>
                    <TableCell className="text-end">
                      {line.href ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={line.href}>{tr("open2")}</Link>
                        </Button>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <section id="risk-scan" className="min-w-0 overflow-hidden rounded-md border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">{tr("errorDetectorBeforeFiling")}</h2>
            <p className="text-sm text-muted-foreground">
              {tr("riskSignalsCaughtBeforeVatCorporate")}
            </p>
          </div>
          <div className="divide-y">
            {data.filingRiskScan.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                {tr("noFilingRiskSignals")}
              </div>
            ) : (
              data.filingRiskScan.slice(0, 12).map((issue) => (
                <div key={issue.id} className="flex items-start gap-3 p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{issue.title}</p>
                      <Badge variant={severityBadge(issue)}>{issue.severity}</Badge>
                      <Badge variant={resolutionBadge(issue) as any}>
                        {issue.resolutionStatus ?? tr("open")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{issue.detail}</p>
                    {issue.resolutionReason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tr("auditReason", { resolutionReason: issue.resolutionReason })}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!issueIsOpen(issue)}
                        data-testid={`button-resolve-evidence-${issue.id}`}
                        onClick={() => {
                          setIssueDialog({ issue, action: "resolve" });
                          setIssueReason("");
                        }}
                      >
                        {tr("resolve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!issueIsOpen(issue)}
                        data-testid={`button-waive-evidence-${issue.id}`}
                        onClick={() => {
                          setIssueDialog({ issue, action: "waive" });
                          setIssueReason("");
                        }}
                      >
                        {tr("waive")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-md border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">{tr("filingTimelineWithConsequences")}</h2>
            <p className="text-sm text-muted-foreground">{tr("deadlinesAreShownWithWhatBreaks")}</p>
          </div>
          <div className="divide-y">
            {data.filingTimeline.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                {tr("noUpcomingFilingEvents")}
              </div>
            ) : (
              data.filingTimeline.slice(0, 12).map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 p-4 md:grid-cols-[9rem_minmax(0,1fr)_5rem]"
                >
                  <div>
                    <p className="text-sm font-medium">{formatDate(item.dueDate)}</p>
                    <Badge variant="outline">{statusLabel(item.category)}</Badge>
                  </div>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-muted-foreground">{item.consequence}</p>
                  </div>
                  <div className="text-end">
                    <p className={`font-semibold ${scoreTone(item.readinessScore)}`}>
                      {item.readinessScore}%
                    </p>
                    <Button asChild size="sm" variant="outline" className="mt-2">
                      <Link href={item.href}>{tr("open2")}</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="rounded-md border bg-card" data-testid="evidence-audit-trail">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4" />
            <h2 className="font-semibold">{tr("evidenceAuditTrail")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {tr("resolveWaiverRequestReviewAndRefund")}
          </p>
        </div>
        <div className="divide-y">
          {data.actionTrail.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {tr("noProofTrailActionsHaveBeen")}
            </div>
          ) : (
            data.actionTrail.slice(0, 12).map((entry) => (
              <div key={entry.id} className="grid gap-2 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
                <div>
                  <p className="text-sm font-medium">{formatDate(entry.createdAt)}</p>
                  <Badge variant="outline">{statusLabel(entry.action)}</Badge>
                </div>
                <div>
                  <p className="font-medium">{entry.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {entry.entityType}
                    {entry.entityId ? ` - ${entry.entityId}` : ""}
                  </p>
                  {entry.reason ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tr("reason", { reason: entry.reason })}
                    </p>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <Dialog open={!!issueDialog} onOpenChange={(open) => !open && setIssueDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {issueDialog?.action === "resolve"
                ? tr("resolveEvidenceIssue")
                : tr("waiveEvidenceIssue")}
            </DialogTitle>
            <DialogDescription>{tr("thisActionWritesAnAuditTrail")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">{issueDialog?.issue.title}</p>
              <p className="text-sm text-muted-foreground">{issueDialog?.issue.detail}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-action-reason">{tr("reason2")}</Label>
              <Textarea
                id="evidence-action-reason"
                value={issueReason}
                onChange={(event) => setIssueReason(event.target.value)}
                placeholder={tr("explainTheEvidenceReceivedReviewerConclusion")}
                data-testid="textarea-evidence-action-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueDialog(null)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={() => issueActionMutation.mutate()}
              disabled={issueReason.trim().length < 5 || issueActionMutation.isPending}
              data-testid="button-confirm-evidence-action"
            >
              {tr("confirm", { action: issueDialog?.action })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tr("reviewExactEvidenceRequest")}</DialogTitle>
            <DialogDescription>{tr("confirmTheRecipientSubjectAndFull")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{tr("recipient")}</p>
                <p className="break-all font-medium">{requestRecipient || tr("noRecipientSet")}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{tr("subject")}</p>
                <p className="font-medium">{data.clientRequestDraft.subject}</p>
              </div>
            </div>
            <Textarea
              readOnly
              value={data.clientRequestDraft.body}
              className="min-h-72 font-mono text-xs"
            />
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={requestAcknowledged}
                onChange={(event) => setRequestAcknowledged(event.target.checked)}
                data-testid="checkbox-evidence-request-ack"
              />
              <span>{tr("iReviewedTheExactRecipientSubject")}</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={() => requestReviewMutation.mutate()}
              disabled={
                !requestRecipient || !requestAcknowledged || requestReviewMutation.isPending
              }
              data-testid="button-confirm-evidence-request"
            >
              {tr("confirmReviewedRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
