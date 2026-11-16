import { T } from "@/components/layout/T";
import { formatMessage, useTranslation } from "@/lib/i18n";
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
import { formatDate as formatDisplayDate } from "@/lib/format-date";
import { localizeEvidenceText } from "@shared/server-copy";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  EvidenceCenterResponse,
  EvidenceCopyRef,
  EvidenceIssue,
  EvidenceOwnerAction,
  EvidenceProofLine,
  EvidenceWorkflowId,
} from "@shared/evidence-center";

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

interface CtEvidencePackSummary {
  readinessScore: number;
  adviserReviewPending: boolean;
  workbookFilename: string;
  ctReturn: {
    id: string;
    status: string;
    taxPeriodStart: string;
    taxPeriodEnd: string;
    filingDeadline: string;
  } | null;
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
    copy?: { label: EvidenceCopyRef; detail: EvidenceCopyRef };
  }>;
}

export default function EvidenceCenter() {
  const { t, locale } = useTranslation();
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

  /** Server sentence in the active language: stable key + params from the payload, else the English text. */
  const ev = (text: string, copy?: EvidenceCopyRef | null) =>
    localizeEvidenceText(text, t, copy ?? null);
  /** Enum-like value (status, category, entity type) from the catalog; humanised when unknown. */
  const st = (value: string | null | undefined) => {
    const slug = String(value ?? "").trim();
    if (!slug) return "-";
    return t[`evidenceCenter.status.${slug}`] ?? slug.replace(/_/g, " ");
  };
  const formatDate = (value: string | null | undefined) =>
    value ? formatDisplayDate(value, locale) || "-" : "-";

  const evidenceQueryKey = useMemo(
    () => ["/api/companies", companyId, "evidence-center"],
    [companyId]
  );

  const { data, isLoading, error } = useQuery<EvidenceCenterResponse>({
    queryKey: evidenceQueryKey,
    enabled: !!companyId,
  });
  // W4-A (R08-22): corporate tax evidence pack next to the VAT refund pack.
  const { data: ctPack } = useQuery<CtEvidencePackSummary>({
    queryKey: ["/api/companies", companyId, "evidence-center", "ct-pack"],
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
        id: "readiness",
        label: t["evidenceCenter.metric.readiness"],
        value: `${data.readinessScore}%`,
        detail: t["evidenceCenter.metric.readinessDetail"],
      },
      {
        id: "refund",
        label: t["evidenceCenter.metric.refund"],
        value: formatCurrency(data.totals.refundExposure, "AED", locale),
        detail: t["evidenceCenter.metric.refundDetail"],
      },
      {
        id: "missing",
        label: t["evidenceCenter.metric.missing"],
        value: String(openMissingEvidenceCount),
        detail: t["evidenceCenter.metric.missingDetail"],
      },
      {
        id: "risk",
        label: t["evidenceCenter.metric.risk"],
        value: String(openRiskSignalCount),
        detail: t["evidenceCenter.metric.riskDetail"],
      },
    ];
  }, [data, t, locale]);

  useEffect(() => {
    if (!data || typeof window === "undefined") return;

    const targetId = window.location.hash.slice(1);
    if (!targetId) return;

    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });
  }, [data]);

  // Reset the recipient to the draft default whenever a new payload arrives.
  const [recipientSourceData, setRecipientSourceData] = useState<typeof data>(undefined);
  if (data && recipientSourceData !== data) {
    setRecipientSourceData(data);
    setRequestRecipient(data.clientRequestDraft.defaultRecipient ?? "");
  }

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
        title:
          issueDialog?.action === "resolve"
            ? t["evidenceCenter.issueResolved"]
            : t["evidenceCenter.toast.issueWaived"],
        description: t["evidenceCenter.toast.actionLogged"],
      });
      setIssueDialog(null);
      setIssueReason("");
    },
    onError: (mutationError: any) => {
      toast({
        variant: "destructive",
        title: t["evidenceCenter.toast.updateFailed"],
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
        title: t["evidenceCenter.toast.requestReviewed"],
        description: t["evidenceCenter.toast.requestLogged"],
      });
      setRequestDialogOpen(false);
      setRequestAcknowledged(false);
    },
    onError: (mutationError: any) => {
      toast({
        variant: "destructive",
        title: t["evidenceCenter.toast.requestFailed"],
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
      toast({ title: t["evidenceCenter.toast.downloaded"], description: link.download });
    } catch (downloadError: any) {
      toast({
        variant: "destructive",
        title: t["evidenceCenter.toast.downloadFailed"],
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
            <CardTitle>
              <T k="pageLabels.proofTrailUnavailable" />
            </CardTitle>
            <CardDescription>{t["evidenceCenter.theProofWorkspaceCouldNot"]}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="evidence-center-page">
      <PageHeader
        eyebrow={t["evidenceCenter.eyebrow"]}
        title={t["evidenceCenter.proofTrail"]}
        description={t["evidenceCenter.contextualEvidenceBehindVatInvoices"]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/vat-filing">
                <T k="pageLabels.openVATWorkpaper" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/corporate-tax">
                <T k="pageLabels.openCorporateTax" />
              </Link>
            </Button>
            <Button asChild>
              <Link href="#owner-actions">
                <T k="pageLabels.whatShouldIDo" />
              </Link>
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
              <Archive className="mr-2 h-4 w-4" />
              <T k="pageLabels.zIPBundle" />
            </Button>
          </div>
        }
      />

      {sourceFilter ? (
        <section className="rounded-md border bg-muted/40 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold">
                <T k="pageLabels.focusedSourceProof" />
              </h2>
              <p className="text-sm text-muted-foreground">
                {formatMessage(t["evidenceCenter.focus.showing"], {
                  source: `${st(sourceFilter.sourceType)}${
                    sourceFilter.sourceId ? ` ${sourceFilter.sourceId}` : ""
                  }`,
                })}
              </p>
            </div>
            <Badge variant={visibleProofLines.length ? "default" : "secondary"}>
              {formatMessage(t["evidenceCenter.focus.matching"], {
                count: visibleProofLines.length,
              })}
            </Badge>
          </div>
        </section>
      ) : null}

      {ctPack ? (
        <Card data-testid="ct-evidence-pack">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">
                <T k="compliance.ctPackTitle" />
              </CardTitle>
              <CardDescription>
                <T k="compliance.ctPackDescription" />
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={ctPack.readinessScore >= 80 ? "default" : "secondary"}>
                {ctPack.readinessScore}%
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={exportingPack !== null || !ctPack.ctReturn}
                onClick={() =>
                  void downloadEvidenceArtifact(
                    `/api/companies/${companyId}/evidence-center/ct-pack.xlsx`,
                    ctPack.workbookFilename,
                    "xlsx"
                  )
                }
                data-testid="button-download-ct-pack"
              >
                <T k="compliance.ctPackDownload" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {ctPack.ctReturn ? (
              <p className="text-muted-foreground">
                {ctPack.ctReturn.taxPeriodStart} – {ctPack.ctReturn.taxPeriodEnd} ·{" "}
                {st(ctPack.ctReturn.status)} · <T k="compliance.ctPackDue" />{" "}
                {ctPack.ctReturn.filingDeadline}
              </p>
            ) : (
              <p className="text-muted-foreground">
                <T k="compliance.ctPackNoReturn" />
              </p>
            )}
            <ul className="grid gap-1 md:grid-cols-2">
              {ctPack.checks.map((check) => (
                <li key={check.key} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      check.passed ? "bg-success" : "bg-warning"
                    }`}
                  />
                  <span>
                    {ev(check.label, check.copy?.label)}
                    <span className="block text-xs text-muted-foreground">
                      {ev(check.detail, check.copy?.detail)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {ctPack.adviserReviewPending ? (
              <p className="text-xs text-warning">
                <T k="compliance.ctPackAdviserPending" />
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4" data-testid="evidence-center-summary">
        {topMetrics.map((metric) => (
          <div key={metric.id} className="rounded-md border bg-card p-4">
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                metric.id === "readiness" ? scoreTone(data.readinessScore) : ""
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
                    <CardTitle className="text-base">
                      {ev(workflow.title, workflow.copy?.title)}
                    </CardTitle>
                  </div>
                  <Badge variant={workflow.status === "ready" ? "default" : "secondary"}>
                    {st(workflow.status)}
                  </Badge>
                </div>
                <CardDescription>
                  {ev(workflow.description, workflow.copy?.description)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      <T k="reportCenter.score" />
                    </p>
                    <p className={`text-2xl font-semibold ${scoreTone(workflow.score)}`}>
                      {workflow.score}%
                    </p>
                  </div>
                  <p className="max-w-40 text-end text-sm font-medium">
                    {ev(workflow.metric, workflow.copy?.metric)}
                  </p>
                </div>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {workflow.bullets.slice(0, 3).map((bullet, index) => (
                    <li key={bullet}>{ev(bullet, workflow.copy?.bullets[index])}</li>
                  ))}
                </ul>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={workflow.primaryHref}>
                    {ev(workflow.primaryAction, workflow.copy?.primaryAction)}
                    <ArrowRight className="ms-2 h-3.5 w-3.5 rtl:rotate-180" />
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
            <h2 className="font-semibold">
              <T k="pageLabels.vATRefundSupportPack" />
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t["evidenceCenter.downloadOneSourceEvidenceBundle"]}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {formatMessage(t["evidenceCenter.pack.sheets"], {
                  count: data.refundPack.sheetCount,
                })}
              </Badge>
              <Badge variant="outline">
                {formatMessage(t["evidenceCenter.pack.proofLines"], {
                  count: data.refundPack.proofLineCount,
                })}
              </Badge>
              <Badge variant="outline">
                {formatMessage(t["evidenceCenter.pack.linkedFiles"], {
                  count: data.refundPack.readyAttachmentCount,
                })}
              </Badge>
              <Badge variant={data.refundPack.gapCount ? "secondary" : "default"}>
                {formatMessage(t["evidenceCenter.pack.openGaps"], {
                  count: data.refundPack.gapCount,
                })}
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
              <Archive className="mr-2 h-4 w-4" />
              <T k="pageLabels.sourceZIP" />
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
              <Download className="mr-2 h-4 w-4" />
              <T k="pageLabels.workbook" />
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
              <FileDown className="mr-2 h-4 w-4" />
              <T k="pageLabels.coverPDF" />
            </Button>
          </div>
        </div>
      </section>

      <section id="owner-actions" className="rounded-md border bg-card" data-testid="owner-actions">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">
            <T k="pageLabels.ownerFriendlyWhatShouldIDo" />
          </h2>
          <p className="text-sm text-muted-foreground">
            {t["evidenceCenter.plainLanguageNextActionsGenerated"]}
          </p>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {data.ownerActions.map((action) => (
            <div key={action.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium">{ev(action.title, action.copy?.title)}</h3>
                <Badge variant={priorityBadge(action) as any}>{st(action.priority)}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {ev(action.detail, action.copy?.detail)}
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href={action.href}>{ev(action.actionLabel, action.copy?.actionLabel)}</Link>
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
            <h2 className="font-semibold">
              <T k="pageLabels.missingEvidenceInbox" />
            </h2>
            <p className="text-sm text-muted-foreground">
              {t["evidenceCenter.documentsTrnsAttachmentsAndSource"]}
            </p>
          </div>
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="pageLabels.severity" />
                  </TableHead>
                  <TableHead>
                    <T k="banking.common.status" />
                  </TableHead>
                  <TableHead>{t["evidenceCenter.table.item"]}</TableHead>
                  <TableHead>
                    <T k="journal.source" />
                  </TableHead>
                  <TableHead className="text-right">
                    <T k="banking.common.amount" />
                  </TableHead>
                  <TableHead className="text-right">
                    <T k="pages.action" />
                  </TableHead>
                  <TableHead className="text-right">
                    <T k="pages.audit" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.missingEvidence.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      <T k="pageLabels.noMissingEvidenceItems" />
                    </TableCell>
                  </TableRow>
                ) : (
                  data.missingEvidence.slice(0, 12).map((issue) => (
                    <TableRow key={issue.id}>
                      <TableCell>
                        <Badge variant={severityBadge(issue)}>{st(issue.severity)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={resolutionBadge(issue) as any}>
                          {st(issue.resolutionStatus ?? "open")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{ev(issue.title, issue.copy?.title)}</p>
                        <p className="text-sm text-muted-foreground">
                          {ev(issue.detail, issue.copy?.detail)}
                        </p>
                        {issue.resolutionReason ? (
                          <p className="mt-1 text-xs text-muted-foreground" translate="no">
                            {formatMessage(t["evidenceCenter.auditReason"], {
                              reason: issue.resolutionReason,
                            })}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>{st(issue.sourceType || "company")}</TableCell>
                      <TableCell className="text-right">
                        {issue.amount ? formatCurrency(issue.amount, "AED", locale) : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {issue.href ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={issue.href}>
                              {issue.actionLabel
                                ? ev(issue.actionLabel, issue.copy?.actionLabel)
                                : t["evidenceCenter.table.open"]}
                            </Link>
                          </Button>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
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
                            <T k="pages.resolve" />
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
                            <T k="pageLabels.waive" />
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
            <h2 className="font-semibold">
              <T k="pageLabels.clientRequestAutopilot" />
            </h2>
            <p className="text-sm text-muted-foreground">
              <T k="pageLabels.draftOnlyNothingIsSentFromThisScreen" />
            </p>
          </div>
          <div className="space-y-3 p-4">
            <div className="space-y-2">
              <Label htmlFor="evidence-request-recipient">
                <T k="pageLabels.recipientEmail" />
              </Label>
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
              <p className="text-xs text-muted-foreground">
                <T k="firm.emailTasksSubject" />
              </p>
              <p className="font-medium" lang="en" dir="ltr">
                {data.clientRequestDraft.subject}
              </p>
            </div>
            <Textarea
              readOnly
              value={data.clientRequestDraft.body}
              lang="en"
              dir="ltr"
              className="min-h-72 font-mono text-xs"
              data-testid="evidence-request-draft"
            />
            <p className="text-xs text-muted-foreground">
              {t["evidenceCenter.thisDraftDeliberatelyWarnsAgainst"]}
            </p>
            <p className="text-xs text-muted-foreground">{t["evidenceCenter.draftEnglishNote"]}</p>
            <Button
              className="w-full"
              onClick={() => {
                setRequestAcknowledged(false);
                setRequestDialogOpen(true);
              }}
              data-testid="button-review-evidence-request"
            >
              <Send className="mr-2 h-4 w-4" />
              <T k="pageLabels.reviewExactRequest" />
            </Button>
          </div>
        </section>
      </div>

      <section id="proof-drilldown" className="min-w-0 overflow-hidden rounded-md border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">
            <T k="pageLabels.everyNumberHasProof" />
          </h2>
          <p className="text-sm text-muted-foreground">
            <T k="pageLabels.sourceRowsBehindVATSalesPurchaseAndTaxNumbers" />
          </p>
        </div>
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <T k="journal.source" />
                </TableHead>
                <TableHead>{t["evidenceCenter.table.date"]}</TableHead>
                <TableHead>
                  <T k="pageLabels.party" />
                </TableHead>
                <TableHead>
                  <T k="pageLabels.document" />
                </TableHead>
                <TableHead>
                  <T k="banking.common.status" />
                </TableHead>
                <TableHead>
                  <T k="pageLabels.evidenceFile" />
                </TableHead>
                <TableHead className="text-right">
                  <T k="banking.common.amount" />
                </TableHead>
                <TableHead className="text-right">{t["evidenceCenter.table.vat"]}</TableHead>
                <TableHead className="text-right">{t["evidenceCenter.table.open"]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProofLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {sourceFilter
                      ? t["evidenceCenter.noProof.filtered"]
                      : t["evidenceCenter.noProof.empty"]}
                  </TableCell>
                </TableRow>
              ) : (
                visibleProofLines.slice(0, 20).map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{ev(line.label, line.copy?.label)}</TableCell>
                    <TableCell>{formatDate(line.date)}</TableCell>
                    <TableCell>{line.party || "-"}</TableCell>
                    <TableCell>{line.documentNumber || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">{st(line.status)}</Badge>
                        <Badge
                          variant={
                            line.proofStatus === "ready"
                              ? "default"
                              : line.proofStatus === "missing"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {st(line.proofStatus)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-52 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={documentBadge(line) as any}>
                            {st(line.documentStatus)}
                          </Badge>
                          <span className="text-sm font-medium">
                            {ev(line.documentLabel, line.copy?.documentLabel)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ev(line.documentPreview, line.copy?.documentPreview)}
                        </p>
                        {line.documentHref ? (
                          <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                            <Link href={line.documentHref}>
                              <Eye className="mr-1.5 h-3.5 w-3.5" />
                              <T k="pageLabels.previewSource" />
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(line.amount, "AED", locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(line.vatAmount || 0), "AED", locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.href ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={line.href}>{t["evidenceCenter.table.open"]}</Link>
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
            <h2 className="font-semibold">
              <T k="pageLabels.errorDetectorBeforeFiling" />
            </h2>
            <p className="text-sm text-muted-foreground">
              {t["evidenceCenter.riskSignalsCaughtBeforeVat"]}
            </p>
          </div>
          <div className="divide-y">
            {data.filingRiskScan.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <T k="pageLabels.noFilingRiskSignals" />
              </div>
            ) : (
              data.filingRiskScan.slice(0, 12).map((issue) => (
                <div key={issue.id} className="flex items-start gap-3 p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{ev(issue.title, issue.copy?.title)}</p>
                      <Badge variant={severityBadge(issue)}>{st(issue.severity)}</Badge>
                      <Badge variant={resolutionBadge(issue) as any}>
                        {st(issue.resolutionStatus ?? "open")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {ev(issue.detail, issue.copy?.detail)}
                    </p>
                    {issue.resolutionReason ? (
                      <p className="mt-1 text-xs text-muted-foreground" translate="no">
                        {formatMessage(t["evidenceCenter.auditReason"], {
                          reason: issue.resolutionReason,
                        })}
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
                        <T k="pages.resolve" />
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
                        <T k="pageLabels.waive" />
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
            <h2 className="font-semibold">
              <T k="pageLabels.filingTimelineWithConsequences" />
            </h2>
            <p className="text-sm text-muted-foreground">
              {t["evidenceCenter.deadlinesAreShownWithWhat"]}
            </p>
          </div>
          <div className="divide-y">
            {data.filingTimeline.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                <T k="pageLabels.noUpcomingFilingEvents" />
              </div>
            ) : (
              data.filingTimeline.slice(0, 12).map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 p-4 md:grid-cols-[9rem_minmax(0,1fr)_5rem]"
                >
                  <div>
                    <p className="text-sm font-medium">{formatDate(item.dueDate)}</p>
                    <Badge variant="outline">{st(item.category)}</Badge>
                  </div>
                  <div>
                    <p className="font-medium">{ev(item.title, item.copy?.title)}</p>
                    <p className="text-sm text-muted-foreground">
                      {ev(item.consequence, item.copy?.consequence)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${scoreTone(item.readinessScore)}`}>
                      {item.readinessScore}%
                    </p>
                    <Button asChild size="sm" variant="outline" className="mt-2">
                      <Link href={item.href}>{t["evidenceCenter.table.open"]}</Link>
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
            <h2 className="font-semibold">
              <T k="pageLabels.evidenceAuditTrail" />
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {t["evidenceCenter.resolveWaiverRequestReviewAnd"]}
          </p>
        </div>
        <div className="divide-y">
          {data.actionTrail.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              <T k="pageLabels.noProofTrailActionsHaveBeenLoggedYet" />
            </div>
          ) : (
            data.actionTrail.slice(0, 12).map((entry) => (
              <div key={entry.id} className="grid gap-2 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
                <div>
                  <p className="text-sm font-medium">{formatDate(entry.createdAt)}</p>
                  <Badge variant="outline">{st(entry.action)}</Badge>
                </div>
                <div>
                  <p className="font-medium">{ev(entry.description, entry.copy?.description)}</p>
                  <p className="text-sm text-muted-foreground">
                    {st(entry.entityType)}
                    {entry.entityId ? ` - ${entry.entityId}` : ""}
                  </p>
                  {entry.reason ? (
                    <p className="mt-1 text-xs text-muted-foreground" translate="no">
                      {formatMessage(t["evidenceCenter.reason"], { reason: entry.reason })}
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
                ? t["evidenceCenter.resolveEvidenceIssue"]
                : t["evidenceCenter.waiveEvidenceIssue"]}
            </DialogTitle>
            <DialogDescription>{t["evidenceCenter.thisActionWritesAnAudit"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">
                {issueDialog ? ev(issueDialog.issue.title, issueDialog.issue.copy?.title) : null}
              </p>
              <p className="text-sm text-muted-foreground">
                {issueDialog ? ev(issueDialog.issue.detail, issueDialog.issue.copy?.detail) : null}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-action-reason">
                <T k="banking.line.excludeReason" />
              </Label>
              <Textarea
                id="evidence-action-reason"
                value={issueReason}
                onChange={(event) => setIssueReason(event.target.value)}
                placeholder={t["evidenceCenter.explainTheEvidenceReceivedReviewer"]}
                data-testid="textarea-evidence-action-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueDialog(null)}>
              <T k="pages.cancel" />
            </Button>
            <Button
              onClick={() => issueActionMutation.mutate()}
              disabled={issueReason.trim().length < 5 || issueActionMutation.isPending}
              data-testid="button-confirm-evidence-action"
            >
              {issueDialog?.action === "waive"
                ? t["evidenceCenter.confirmWaive"]
                : t["evidenceCenter.confirmResolve"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.reviewExactEvidenceRequest" />
            </DialogTitle>
            <DialogDescription>
              {t["evidenceCenter.confirmTheRecipientSubjectAnd"]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pageLabels.recipient" />
                </p>
                <p className="break-all font-medium">
                  {requestRecipient || t["evidenceCenter.noRecipient"]}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  <T k="firm.emailTasksSubject" />
                </p>
                <p className="font-medium" lang="en" dir="ltr">
                  {data.clientRequestDraft.subject}
                </p>
              </div>
            </div>
            <Textarea
              readOnly
              value={data.clientRequestDraft.body}
              lang="en"
              dir="ltr"
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
              <span>{t["evidenceCenter.iReviewedTheExactRecipient"]}</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>
              <T k="pages.cancel" />
            </Button>
            <Button
              onClick={() => requestReviewMutation.mutate()}
              disabled={
                !requestRecipient || !requestAcknowledged || requestReviewMutation.isPending
              }
              data-testid="button-confirm-evidence-request"
            >
              <T k="pageLabels.confirmReviewedRequest" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
