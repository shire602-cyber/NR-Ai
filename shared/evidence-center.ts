export type EvidenceSeverity = "critical" | "warning" | "info" | "good";
export type EvidenceIssueStatus = "open" | "resolved" | "waived";

export type EvidenceWorkflowId =
  | "refund_pack"
  | "proof_drilldown"
  | "corporate_tax_workpaper"
  | "missing_evidence"
  | "client_request_autopilot"
  | "month_end_cockpit"
  | "filing_risk_scan"
  | "smart_excel_import"
  | "filing_timeline"
  | "owner_actions";

export interface EvidenceIssue {
  id: string;
  severity: EvidenceSeverity;
  workflowId: EvidenceWorkflowId;
  title: string;
  detail: string;
  resolutionStatus?: EvidenceIssueStatus;
  resolutionReason?: string;
  resolvedAt?: string;
  sourceType?: string;
  sourceId?: string | null;
  href?: string;
  amount?: number;
  actionLabel?: string;
}

export interface EvidenceProofLine {
  id: string;
  label: string;
  sourceType: string;
  sourceId?: string | null;
  sourceDocumentId?: string | null;
  documentNumber?: string | null;
  date?: string | null;
  party?: string | null;
  amount: number;
  vatAmount?: number;
  status: string;
  proofStatus: "ready" | "needs_review" | "missing";
  documentStatus: "attached" | "source_text" | "missing" | "generated" | "needs_review";
  documentLabel: string;
  documentPreview: string;
  documentHref?: string;
  attachmentCount: number;
  href?: string;
}

export interface EvidenceWorkflow {
  id: EvidenceWorkflowId;
  title: string;
  status: "ready" | "needs_review" | "blocked";
  score: number;
  metric: string;
  description: string;
  primaryHref: string;
  primaryAction: string;
  bullets: string[];
  issueCount: number;
  proofCount: number;
}

export interface EvidenceTimelineItem {
  id: string;
  title: string;
  dueDate: string;
  category: string;
  status: string;
  consequence: string;
  readinessScore: number;
  href: string;
}

export interface EvidenceOwnerAction {
  id: string;
  priority: "now" | "next" | "monitor";
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
}

export interface EvidenceAuditEntry {
  id: string;
  action: "resolve" | "waive" | "request_reviewed" | "refund_pack_exported";
  entityType: string;
  entityId: string | null;
  description: string;
  reason?: string;
  actorId?: string | null;
  createdAt: string;
}

export interface EvidenceRefundPack {
  workbookHref: string;
  coverHref: string;
  bundleHref: string;
  workbookFilename: string;
  coverFilename: string;
  bundleFilename: string;
  sheetCount: number;
  proofLineCount: number;
  readyAttachmentCount: number;
  missingAttachmentCount: number;
  gapCount: number;
  contents: string[];
}

export interface EvidenceCenterResponse {
  company: {
    id: string;
    name: string;
    trnVatNumber: string | null;
    contactEmail: string | null;
  };
  generatedAt: string;
  period: {
    vatStart: string;
    vatEnd: string;
    monthStart: string;
    monthEnd: string;
  };
  readinessScore: number;
  totals: {
    vatOutputAmount: number;
    vatOutputVat: number;
    vatInputAmount: number;
    vatInputVat: number;
    vatNetPayable: number;
    refundExposure: number;
    salesEvidenceAmount: number;
    purchaseEvidenceAmount: number;
    corporateTaxPayable: number;
  };
  workflows: EvidenceWorkflow[];
  missingEvidence: EvidenceIssue[];
  filingRiskScan: EvidenceIssue[];
  proofDrilldowns: EvidenceProofLine[];
  filingTimeline: EvidenceTimelineItem[];
  ownerActions: EvidenceOwnerAction[];
  refundPack: EvidenceRefundPack;
  actionTrail: EvidenceAuditEntry[];
  clientRequestDraft: {
    subject: string;
    body: string;
    itemCount: number;
    defaultRecipient: string | null;
  };
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreFromOpenItems(openItems: number, totalItems: number): number {
  if (totalItems <= 0) return 100;
  return clampScore(((totalItems - openItems) / totalItems) * 100);
}

export function statusFromScore(score: number): EvidenceWorkflow["status"] {
  if (score >= 80) return "ready";
  if (score >= 45) return "needs_review";
  return "blocked";
}

export function severityWeight(severity: EvidenceSeverity): number {
  switch (severity) {
    case "critical":
      return 18;
    case "warning":
      return 10;
    case "info":
      return 4;
    case "good":
      return 0;
    default:
      return 4;
  }
}

export function scoreEvidenceReadiness(issues: Pick<EvidenceIssue, "severity">[]): number {
  const penalty = issues.reduce((sum, issue) => sum + severityWeight(issue.severity), 0);
  return clampScore(100 - penalty);
}

export function formatEvidenceRequestDraft(input: {
  companyName: string;
  defaultRecipient?: string | null;
  issues: Array<Pick<EvidenceIssue, "title" | "detail">>;
}): { subject: string; body: string; itemCount: number; defaultRecipient: string | null } {
  const visibleIssues = input.issues.slice(0, 12);
  const lines =
    visibleIssues.length > 0
      ? visibleIssues.map((issue, index) => `${index + 1}. ${issue.title} - ${issue.detail}`)
      : ["1. No blocking evidence items are currently open."];

  return {
    subject: `Evidence request for ${input.companyName}`,
    itemCount: input.issues.length,
    defaultRecipient: input.defaultRecipient ?? null,
    body: [
      `Hi ${input.companyName},`,
      "",
      "We are preparing the accounting, VAT, tax, and close evidence pack. Please upload or confirm the following items:",
      "",
      ...lines,
      "",
      "Please do not reply with passwords, bank OTPs, or private portal credentials. Upload documents through the secure app workspace.",
    ].join("\n"),
  };
}
