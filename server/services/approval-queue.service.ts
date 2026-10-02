// Approval documents, queue and history.
//
// One loader turns "a document type and id" into what the approval engine needs (company, status,
// AED amount, who created it, a label to show). The queue lists, per company, the requests in flight plus
// the documents a rule covers that nobody has signed yet.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { pool } from "../db";
import {
  APPROVAL_DOCUMENT_TYPES,
  approvalRequests,
  approvalRules,
  approvalSteps,
  type ApprovalDocumentType,
  type ApprovalRequestRow,
} from "../../shared/schema-purchasing-hr";
import { matchRule, roleForStep, canSignStep, type ApprovalRuleLike } from "./approval-rules";
import { resolveDocumentExchangeRate } from "./document-fx-rate";

export interface ApprovalDocument {
  documentType: ApprovalDocumentType;
  documentId: string;
  companyId: string;
  status: string;
  /** What a rule is compared with. AED. */
  amountAed: number;
  /** True when a foreign-currency amount could not be converted: a rule applies (the highest threshold). */
  rateMissing: boolean;
  /** The claim's submitter or the journal's creator; null for documents with no segregation rule. */
  creatorId: string | null;
  reference: string;
  counterparty: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Statuses from which a document is waiting for its first approval, per type. */
export const WAITING_STATUS: Record<ApprovalDocumentType, string> = {
  bill: "pending",
  expense_claim: "submitted",
  purchase_order: "sent",
  payroll_run: "calculated",
  manual_journal: "draft",
};

/** Statuses an approve call is accepted in (waiting, or already in progress). */
export const APPROVABLE_STATUSES: Record<ApprovalDocumentType, string[]> = {
  bill: ["pending", "pending_approval"],
  expense_claim: ["submitted", "pending_approval"],
  purchase_order: ["draft", "sent", "pending_approval"],
  payroll_run: ["calculated", "pending_approval"],
  manual_journal: ["draft"],
};

export function isApprovalDocumentType(value: unknown): value is ApprovalDocumentType {
  return typeof value === "string" && (APPROVAL_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export async function loadApprovalDocument(documentType: ApprovalDocumentType, documentId: string): Promise<ApprovalDocument | null> {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null;
  switch (documentType) {
    case "bill": {
      const r = await pool.query(
        `SELECT id::text, company_id::text, status, total_amount, exchange_rate, bill_number, vendor_name, created_by::text FROM vendor_bills WHERE id = $1`,
        [documentId]
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        documentType,
        documentId,
        companyId: row.company_id,
        status: row.status ?? "pending",
        amountAed: round2(num(row.total_amount) * (num(row.exchange_rate) > 0 ? num(row.exchange_rate) : 1)),
        rateMissing: false,
        creatorId: row.created_by ?? null,
        reference: row.bill_number || "Bill",
        counterparty: row.vendor_name,
      };
    }
    case "expense_claim": {
      const r = await pool.query(
        `SELECT c.id::text, c.company_id::text, c.status, c.total_amount, c.claim_number, c.title, c.submitted_by::text, u.name AS submitter
           FROM expense_claims c LEFT JOIN users u ON u.id = c.submitted_by WHERE c.id = $1`,
        [documentId]
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        documentType,
        documentId,
        companyId: row.company_id,
        status: row.status ?? "draft",
        amountAed: round2(num(row.total_amount)),
        rateMissing: false,
        creatorId: row.submitted_by,
        reference: row.claim_number || row.title,
        counterparty: row.submitter ?? "",
      };
    }
    case "purchase_order": {
      const r = await pool.query(
        `SELECT id::text, company_id::text, status, total, currency, number, vendor_name, created_by::text FROM purchase_orders WHERE id = $1`,
        [documentId]
      );
      const row = r.rows[0];
      if (!row) return null;
      const currency = String(row.currency || "AED").toUpperCase();
      let amountAed = num(row.total);
      let rateMissing = false;
      if (currency !== "AED") {
        const fx = await resolveDocumentExchangeRate({ currency, date: new Date(), companyId: row.company_id });
        if (fx.ok) amountAed = round2(amountAed * fx.rate);
        else rateMissing = true;
      }
      return {
        documentType,
        documentId,
        companyId: row.company_id,
        status: row.status,
        amountAed,
        rateMissing,
        creatorId: row.created_by ?? null,
        reference: row.number,
        counterparty: row.vendor_name,
      };
    }
    case "payroll_run": {
      const r = await pool.query(
        `SELECT id::text, company_id::text, status, total_basic, total_allowances, period_month, period_year FROM payroll_runs WHERE id = $1`,
        [documentId]
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        documentType,
        documentId,
        companyId: row.company_id,
        status: row.status,
        // Gross pay of the run (basic + allowances + overtime): the cost the approval authorises.
        amountAed: round2(num(row.total_basic) + num(row.total_allowances)),
        rateMissing: false,
        creatorId: null,
        reference: `Payroll ${String(row.period_month).padStart(2, "0")}/${row.period_year}`,
        counterparty: "",
      };
    }
    case "manual_journal": {
      const r = await pool.query(
        `SELECT je.id::text, je.company_id::text, je.status, je.source, je.entry_number, je.memo, je.created_by::text,
                COALESCE((SELECT SUM(debit) FROM journal_lines WHERE entry_id = je.id), 0) AS total_debit
           FROM journal_entries je WHERE je.id = $1`,
        [documentId]
      );
      const row = r.rows[0];
      if (!row || row.source !== "manual") return null;
      return {
        documentType,
        documentId,
        companyId: row.company_id,
        status: row.status,
        amountAed: round2(num(row.total_debit)),
        rateMissing: false,
        creatorId: row.created_by,
        reference: row.entry_number || "Journal",
        counterparty: row.memo ?? "",
      };
    }
  }
}

/** Active rules of a company (all document types or one). */
export async function loadActiveRules(companyId: string, documentType?: ApprovalDocumentType): Promise<Array<ApprovalRuleLike & { id: string }>> {
  const rows = await db
    .select()
    .from(approvalRules)
    .where(
      documentType
        ? and(eq(approvalRules.companyId, companyId), eq(approvalRules.documentType, documentType), eq(approvalRules.isActive, true))
        : and(eq(approvalRules.companyId, companyId), eq(approvalRules.isActive, true))
    );
  return rows.map((r: any) => ({
    id: r.id,
    documentType: r.documentType,
    name: r.name,
    thresholdAed: r.thresholdAed,
    approverRoles: r.approverRoles,
    isActive: r.isActive,
  }));
}

/** The rule that applies to a loaded document: a document with no usable rate meets the highest-threshold rule. */
export function ruleForDocument<R extends ApprovalRuleLike>(rules: R[], doc: ApprovalDocument): R | null {
  return matchRule(rules, doc.documentType, doc.rateMissing ? Number.MAX_SAFE_INTEGER : doc.amountAed);
}

export interface QueueRow {
  requestId: string | null;
  documentType: ApprovalDocumentType;
  documentId: string;
  reference: string;
  counterparty: string;
  amountAed: number;
  completedSteps: number;
  requiredSteps: number;
  nextRole: string | null;
  status: string;
  canAct: boolean;
  createdAt: string | null;
}

interface Actor {
  userId: string;
  rank: number;
}

function toQueueRow(doc: ApprovalDocument, request: ApprovalRequestRow | null, rule: ApprovalRuleLike | null, actor: Actor, signedBy: Set<string>): QueueRow {
  const roles = request ? request.requiredRoles : rule?.approverRoles ?? [];
  const completed = request ? request.completedSteps : 0;
  const nextRole = roleForStep(roles, completed + 1);
  const status = request ? request.status : "pending";
  const isSelf = doc.creatorId !== null && doc.creatorId === actor.userId;
  return {
    requestId: request?.id ?? null,
    documentType: doc.documentType,
    documentId: doc.documentId,
    reference: doc.reference,
    counterparty: doc.counterparty,
    amountAed: request ? request.amountAed : doc.amountAed,
    completedSteps: completed,
    requiredSteps: request ? request.requiredSteps : roles.length,
    nextRole,
    status,
    canAct: status === "pending" && !!nextRole && canSignStep(actor.rank, nextRole) && !signedBy.has(actor.userId) && !isSelf,
    createdAt: request ? request.createdAt.toISOString() : null,
  };
}

/** Documents of a type that are waiting for a first approval, with the facts a rule needs. */
async function waitingDocuments(companyId: string, documentType: ApprovalDocumentType): Promise<string[]> {
  const waiting = WAITING_STATUS[documentType];
  switch (documentType) {
    case "bill":
      return (await pool.query(`SELECT id::text FROM vendor_bills WHERE company_id = $1 AND status = $2`, [companyId, waiting])).rows.map((r: any) => r.id);
    case "expense_claim":
      return (await pool.query(`SELECT id::text FROM expense_claims WHERE company_id = $1 AND status = $2`, [companyId, waiting])).rows.map((r: any) => r.id);
    case "purchase_order":
      return (await pool.query(`SELECT id::text FROM purchase_orders WHERE company_id = $1 AND status IN ('sent', 'draft')`, [companyId])).rows.map((r: any) => r.id);
    case "payroll_run":
      return (await pool.query(`SELECT id::text FROM payroll_runs WHERE company_id = $1 AND status = $2`, [companyId, waiting])).rows.map((r: any) => r.id);
    case "manual_journal":
      return (await pool.query(`SELECT id::text FROM journal_entries WHERE company_id = $1 AND status = 'draft' AND source = 'manual'`, [companyId])).rows.map((r: any) => r.id);
  }
}

export async function listApprovalQueue(args: {
  companyId: string;
  actor: Actor;
  status: "pending" | "approved" | "rejected" | "cancelled" | "all";
  documentType?: ApprovalDocumentType;
  limit: number;
  offset: number;
}): Promise<QueueRow[]> {
  const types = args.documentType ? [args.documentType] : [...APPROVAL_DOCUMENT_TYPES];
  const rows: QueueRow[] = [];

  const requestFilter = [eq(approvalRequests.companyId, args.companyId)];
  if (args.status !== "all") requestFilter.push(eq(approvalRequests.status, args.status));
  if (args.documentType) requestFilter.push(eq(approvalRequests.documentType, args.documentType));
  const requests: ApprovalRequestRow[] = await db
    .select()
    .from(approvalRequests)
    .where(and(...requestFilter))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(500);

  const signed = new Map<string, Set<string>>();
  if (requests.length > 0) {
    const steps = await db
      .select({ requestId: approvalSteps.requestId, decidedBy: approvalSteps.decidedBy })
      .from(approvalSteps)
      .where(and(eq(approvalSteps.companyId, args.companyId), eq(approvalSteps.decision, "approved")));
    for (const s of steps) signed.set(s.requestId, (signed.get(s.requestId) ?? new Set()).add(s.decidedBy));
  }

  for (const request of requests) {
    const doc = await loadApprovalDocument(request.documentType as ApprovalDocumentType, request.documentId);
    if (!doc || doc.companyId !== args.companyId) continue;
    rows.push(toQueueRow(doc, request, null, args.actor, signed.get(request.id) ?? new Set()));
  }

  // Documents a rule covers that nobody has signed yet (no request exists for them).
  if (args.status === "pending" || args.status === "all") {
    const rules = await loadActiveRules(args.companyId);
    const inFlight = new Set(requests.filter((r) => r.status === "pending").map((r) => `${r.documentType}:${r.documentId}`));
    for (const type of types) {
      if (!rules.some((r: any) => r.documentType === type)) continue;
      for (const id of await waitingDocuments(args.companyId, type)) {
        if (inFlight.has(`${type}:${id}`)) continue;
        const doc = await loadApprovalDocument(type, id);
        if (!doc) continue;
        const rule = ruleForDocument(rules, doc);
        if (rule) rows.push(toQueueRow(doc, null, rule, args.actor, new Set()));
      }
    }
  }

  return rows.slice(args.offset, args.offset + args.limit);
}

export async function approvalHistory(companyId: string, documentType: ApprovalDocumentType, documentId: string) {
  const requests = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.companyId, companyId), eq(approvalRequests.documentType, documentType), eq(approvalRequests.documentId, documentId)))
    .orderBy(desc(approvalRequests.createdAt));
  const out = [];
  for (const request of requests) {
    const steps = await db
      .select({
        stepNumber: approvalSteps.stepNumber,
        requiredRole: approvalSteps.requiredRole,
        decidedBy: approvalSteps.decidedBy,
        decidedByName: sql<string | null>`(SELECT name FROM users WHERE id = ${approvalSteps.decidedBy})`,
        decision: approvalSteps.decision,
        comment: approvalSteps.comment,
        decidedAt: approvalSteps.decidedAt,
      })
      .from(approvalSteps)
      .where(eq(approvalSteps.requestId, request.id))
      .orderBy(asc(approvalSteps.decidedAt), asc(approvalSteps.stepNumber));
    out.push({ ...request, steps });
  }
  return out;
}
