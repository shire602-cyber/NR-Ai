// The approval gate: every approve route of a gated document calls it, inside
// withDocumentLock(documentId, LOCK_NS.APPROVAL), after re-reading the document.
//
//   1. No active rule above the amount: the gate says "none" and the route does exactly what it did before.
//   2. Otherwise the pending request is found (or, on the first signature, created with a snapshot of the
//      rule's roles and the amount). Step k needs a rank at or above its role; a person signs once; the
//      claim submitter and the journal creator never approve their own document.
//   3. A step below the last is recorded and the document waits in pending_approval.
//   4. The last step: the route posts as it always did, then records the step, which closes the request.
//
// Order of refusals, chosen so each message is the most useful one: already signed, then role rank, then
// self-approval.

import { and, eq } from "drizzle-orm";
import type { db } from "../db";
import { db as database } from "../db";
import { storage } from "../storage";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import {
  approvalRequests,
  approvalSteps,
  type ApprovalDocumentType,
  type ApprovalRequestRow,
} from "../../shared/schema-purchasing-hr";
import { actorRank, canSignStep, rankOfRole, roleForStep, ROLE_RANK } from "./approval-rules";
import { loadActiveRules, ruleForDocument, type ApprovalDocument } from "./approval-queue.service";
import { emailStatus, sendGenericEmail } from "./email.service";
import { recordAudit } from "./audit.service";

const log = createLogger("approval-gate");

type Tx = typeof db;

export interface GateActor {
  userId: string;
  rank: number;
}

export async function resolveActor(
  user: { id: string; isAdmin?: boolean; firmRole?: string | null },
  companyId: string
): Promise<GateActor> {
  const membership = await storage.getUserRole(companyId, user.id);
  return {
    userId: user.id,
    rank: actorRank({ companyRole: membership?.role ?? null, isAdmin: user.isAdmin, firmRole: user.firmRole }),
  };
}

export type GateResult =
  | { kind: "none" }
  | {
      kind: "step";
      request: ApprovalRequestRow;
      stepNumber: number;
      requiredRole: string;
      requiredSteps: number;
      /** True when this signature completes the request: the route posts, then records it. */
      isFinal: boolean;
    };

/** A refusal; its details (step, requiredSteps, requiredRole) are also top-level fields of the JSON so a toast can name the role. */
const refuse = (statusCode: number, code: string, message: string, details?: Record<string, unknown>) => {
  const error = new AppError({ message, statusCode, code, details });
  if (details) error.toJSON = () => ({ message, code, ...details, details });
  return error;
};

async function findPendingRequest(tx: Tx, documentType: ApprovalDocumentType, documentId: string): Promise<ApprovalRequestRow | undefined> {
  const [row] = await tx
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.documentType, documentType), eq(approvalRequests.documentId, documentId), eq(approvalRequests.status, "pending")))
    .limit(1);
  return row;
}

/** True when an approval request is in flight for the document (edit, delete, recalculate and pay are refused). */
export async function hasPendingApproval(documentType: ApprovalDocumentType, documentId: string): Promise<boolean> {
  return !!(await findPendingRequest(database as Tx, documentType, documentId));
}

/** True when the company has an active rule for the document type (a purchase order must then be approved to be received). */
export async function hasActiveRuleFor(companyId: string, documentType: ApprovalDocumentType): Promise<boolean> {
  return (await loadActiveRules(companyId, documentType)).length > 0;
}

/** Throw 409 APPROVAL_IN_PROGRESS when the document is waiting for approvals. */
export async function assertNoPendingApproval(documentType: ApprovalDocumentType, documentId: string, action: string): Promise<void> {
  if (await hasPendingApproval(documentType, documentId)) {
    throw refuse(409, "APPROVAL_IN_PROGRESS", `This document is waiting for approval and cannot be ${action}. Reject it first.`);
  }
}

/**
 * Decide whether and how this actor's approve call counts. Writes nothing for a refusal; creates the
 * request row on the first valid signature. Call inside the document lock with the document just re-read.
 */
export async function beginApprovalStep(tx: Tx, doc: ApprovalDocument, actor: GateActor, opts: { previousStatus: string }): Promise<GateResult> {
  let request = await findPendingRequest(tx, doc.documentType, doc.documentId);
  let roles: string[];
  let rule: Awaited<ReturnType<typeof loadActiveRules>>[number] | null = null;
  if (request) {
    roles = request.requiredRoles;
  } else {
    rule = ruleForDocument(await loadActiveRules(doc.companyId, doc.documentType), doc);
    if (!rule) return { kind: "none" };
    roles = rule.approverRoles;
  }

  const completed = request?.completedSteps ?? 0;
  const stepNumber = completed + 1;
  const requiredRole = roleForStep(roles, stepNumber);
  if (!requiredRole) throw refuse(409, "APPROVAL_ALREADY_COMPLETE", "This document has already collected all of its approvals.");

  if (request) {
    const [signed] = await tx
      .select({ id: approvalSteps.id })
      .from(approvalSteps)
      .where(and(eq(approvalSteps.requestId, request.id), eq(approvalSteps.decidedBy, actor.userId), eq(approvalSteps.decision, "approved")))
      .limit(1);
    if (signed) throw refuse(403, "APPROVER_ALREADY_SIGNED", "You have already signed this document. A different person must give the next approval.");
  }
  // Nobody can sign this step for this document (the only holders of the role created it, or already signed):
  // say so, and which role to add, instead of a refusal the person can do nothing about.
  const actorCanSign = canSignStep(actor.rank, requiredRole) && !(doc.creatorId && doc.creatorId === actor.userId);
  if (!actorCanSign && !(await hasEligibleApprover(tx, doc, request, requiredRole, actor.userId))) {
    throw refuse(409, "NO_ELIGIBLE_APPROVER", `Nobody else can give approval step ${stepNumber}: add a ${requiredRole} (or higher) to the company.`, {
      step: stepNumber,
      requiredSteps: roles.length,
      requiredRole,
    });
  }
  if (!canSignStep(actor.rank, requiredRole)) {
    throw refuse(403, "APPROVAL_REQUIRED", `Step ${stepNumber} of ${roles.length} needs approval from a ${requiredRole} or higher.`, {
      step: stepNumber,
      requiredSteps: roles.length,
      requiredRole,
    });
  }
  if (doc.creatorId && doc.creatorId === actor.userId) {
    throw refuse(403, "SELF_APPROVAL", "You cannot approve a document you created or submitted.");
  }

  if (!request) {
    const [created] = await tx
      .insert(approvalRequests)
      .values({
        companyId: doc.companyId,
        documentType: doc.documentType,
        documentId: doc.documentId,
        ruleId: rule!.id,
        ruleName: rule!.name,
        requiredRoles: roles,
        amountAed: doc.amountAed,
        requiredSteps: roles.length,
        completedSteps: 0,
        status: "pending",
        previousStatus: opts.previousStatus,
        requestedBy: doc.creatorId ?? actor.userId,
      })
      .returning();
    request = created as ApprovalRequestRow;
  }
  return { kind: "step", request: request as ApprovalRequestRow, stepNumber, requiredRole, requiredSteps: roles.length, isFinal: stepNumber >= roles.length };
}

/** Another active member who may sign this step of this document: not its creator, not someone who already signed. */
async function hasEligibleApprover(tx: Tx, doc: ApprovalDocument, request: ApprovalRequestRow | undefined, role: string, actorId: string): Promise<boolean> {
  const members = await storage.getCompanyUsersByCompanyId(doc.companyId);
  const signed = new Set<string>();
  if (request) {
    const rows = await tx
      .select({ by: approvalSteps.decidedBy })
      .from(approvalSteps)
      .where(and(eq(approvalSteps.requestId, request.id), eq(approvalSteps.decision, "approved")));
    for (const r of rows) signed.add(r.by);
  }
  for (const m of members) {
    if (m.userId === actorId || m.userId === doc.creatorId || signed.has(m.userId)) continue;
    if (!canSignStep(rankOfRole(m.role), role)) continue;
    const user = await storage.getUser(m.userId);
    if (user && user.isActive !== false) return true;
  }
  return false;
}

/** Record the signature; the last one closes the request. Returns the updated request. */
export async function recordApprovalStep(tx: Tx, step: Extract<GateResult, { kind: "step" }>, actor: GateActor, comment?: string | null): Promise<ApprovalRequestRow> {
  await tx.insert(approvalSteps).values({
    companyId: step.request.companyId,
    requestId: step.request.id,
    stepNumber: step.stepNumber,
    requiredRole: step.requiredRole,
    decidedBy: actor.userId,
    decision: "approved",
    comment: comment ?? null,
  });
  const [updated] = await tx
    .update(approvalRequests)
    .set(step.isFinal ? { completedSteps: step.stepNumber, status: "approved", decidedAt: new Date() } : { completedSteps: step.stepNumber })
    .where(eq(approvalRequests.id, step.request.id))
    .returning();
  return updated;
}

/** Reject: closes the request with a rejecting step. The caller restores the document status. */
export async function rejectApproval(
  tx: Tx,
  doc: ApprovalDocument,
  actor: GateActor,
  opts: { comment?: string | null; previousStatus: string }
): Promise<ApprovalRequestRow> {
  let request = await findPendingRequest(tx, doc.documentType, doc.documentId);
  if (!request) {
    const rule = ruleForDocument(await loadActiveRules(doc.companyId, doc.documentType), doc);
    if (!rule) throw refuse(409, "NO_PENDING_APPROVAL", "No approval is pending for this document.");
    const [created] = await tx
      .insert(approvalRequests)
      .values({
        companyId: doc.companyId,
        documentType: doc.documentType,
        documentId: doc.documentId,
        ruleId: rule.id,
        ruleName: rule.name,
        requiredRoles: rule.approverRoles,
        amountAed: doc.amountAed,
        requiredSteps: rule.approverRoles.length,
        completedSteps: 0,
        status: "pending",
        previousStatus: opts.previousStatus,
        requestedBy: doc.creatorId ?? actor.userId,
      })
      .returning();
    request = created as ApprovalRequestRow;
  }
  const stepNumber = request.completedSteps + 1;
  const requiredRole = roleForStep(request.requiredRoles, stepNumber) ?? request.requiredRoles[request.requiredRoles.length - 1];
  if (!canSignStep(actor.rank, requiredRole)) {
    throw refuse(403, "APPROVAL_REQUIRED", `Rejecting at step ${stepNumber} needs a ${requiredRole} or higher.`, {
      step: stepNumber,
      requiredSteps: request.requiredSteps,
      requiredRole,
    });
  }
  await tx.insert(approvalSteps).values({
    companyId: request.companyId,
    requestId: request.id,
    stepNumber,
    requiredRole,
    decidedBy: actor.userId,
    decision: "rejected",
    comment: opts.comment ?? null,
  });
  const [updated] = await tx
    .update(approvalRequests)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(eq(approvalRequests.id, request.id))
    .returning();
  return updated;
}

/** The body a route returns when an approval was recorded but more are needed. */
export function pendingApprovalBody(step: Extract<GateResult, { kind: "step" }>) {
  return {
    status: "pending_approval",
    approval: {
      requestId: step.request.id,
      completedSteps: step.stepNumber,
      requiredSteps: step.requiredSteps,
      nextRole: roleForStep(step.request.requiredRoles, step.stepNumber + 1),
    },
  };
}

// ---------------------------------------------------------------------------
// Audit and notifications (best effort: never block an approval)
// ---------------------------------------------------------------------------

export async function auditApprovalStep(args: {
  req: any;
  actor: GateActor;
  doc: ApprovalDocument;
  request: ApprovalRequestRow;
  stepNumber: number;
  decision: "approved" | "rejected";
}): Promise<void> {
  await recordAudit({
    userId: args.actor.userId,
    companyId: args.doc.companyId,
    action: args.decision === "approved" ? "approval.step_approved" : "approval.rejected",
    entityType: args.doc.documentType,
    entityId: args.doc.documentId,
    after: {
      requestId: args.request.id,
      step: args.stepNumber,
      requiredSteps: args.request.requiredSteps,
      status: args.request.status,
      amountAed: args.request.amountAed,
    },
    req: args.req,
  });
}

/**
 * Tell the people who can act next (in-app, plus email when a provider is configured) or, when the
 * request has finished, the person who started it.
 */
export async function notifyApprovalProgress(args: {
  doc: ApprovalDocument;
  request: ApprovalRequestRow;
  actor: GateActor;
  outcome: "needs_next_step" | "approved" | "rejected";
}): Promise<void> {
  try {
    const { doc, request } = args;
    const label = `${doc.documentType.replace("_", " ")} ${doc.reference}`;
    const targets: Array<{ userId: string; title: string; message: string }> = [];
    if (args.outcome === "needs_next_step") {
      const role = roleForStep(request.requiredRoles, request.completedSteps + 1);
      if (!role) return;
      const members = await storage.getCompanyUsersByCompanyId(doc.companyId);
      for (const m of members) {
        if (m.userId === args.actor.userId || rankOfRole(m.role) < (ROLE_RANK[role] ?? 0)) continue;
        targets.push({ userId: m.userId, title: "Approval needed", message: `${label} (AED ${request.amountAed.toFixed(2)}) is waiting for a ${role} to approve it (step ${request.completedSteps + 1} of ${request.requiredSteps}).` });
      }
    } else if (request.requestedBy && request.requestedBy !== args.actor.userId) {
      targets.push({
        userId: request.requestedBy,
        title: args.outcome === "approved" ? "Approved" : "Rejected",
        message: `${label} was ${args.outcome}.`,
      });
    }
    for (const t of targets) {
      await storage.createNotification({
        userId: t.userId,
        companyId: doc.companyId,
        type: "system",
        title: t.title,
        message: t.message,
        priority: "normal",
        relatedEntityType: doc.documentType,
        relatedEntityId: doc.documentId,
        actionUrl: "/approvals",
      } as any);
    }
    if (emailStatus().configured) {
      for (const t of targets) {
        const user = await storage.getUser(t.userId);
        if (user?.email) await sendGenericEmail(user.email, t.title, t.message).catch(() => undefined);
      }
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, "approval notification failed");
  }
}

// ---------------------------------------------------------------------------
// Reject (shared by POST /api/approvals/:type/:id/reject and the claim reject route)
// ---------------------------------------------------------------------------

/** What a rejection puts the document back to. */
async function restoreRejectedDocument(doc: ApprovalDocument, actor: GateActor, comment: string | null): Promise<void> {
  const { pool } = await import("../db");
  switch (doc.documentType) {
    case "bill":
      await pool.query(`UPDATE vendor_bills SET status = 'pending' WHERE id = $1 AND status = 'pending_approval'`, [doc.documentId]);
      return;
    case "expense_claim":
      await pool.query(
        `UPDATE expense_claims SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), review_notes = $3 WHERE id = $1 AND status IN ('submitted', 'pending_approval')`,
        [doc.documentId, actor.userId, comment]
      );
      return;
    case "purchase_order":
      await pool.query(`UPDATE purchase_orders SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status IN ('sent', 'pending_approval')`, [doc.documentId]);
      return;
    case "payroll_run":
      await pool.query(`UPDATE payroll_runs SET status = 'calculated' WHERE id = $1 AND status = 'pending_approval'`, [doc.documentId]);
      return;
    case "manual_journal":
      return; // stays a draft; the closed request releases the edit lock
  }
}

export async function rejectDocumentApproval(args: {
  req: any;
  documentType: ApprovalDocumentType;
  documentId: string;
  actor: GateActor;
  comment: string | null;
}): Promise<ApprovalRequestRow> {
  const { withDocumentLock, LOCK_NS } = await import("./document-lock");
  const { loadApprovalDocument, APPROVABLE_STATUSES } = await import("./approval-queue.service");
  const initial = await loadApprovalDocument(args.documentType, args.documentId);
  if (!initial) throw refuse(404, "DOCUMENT_NOT_FOUND", "Document not found.");
  return await withDocumentLock(args.documentId, LOCK_NS.APPROVAL, async (tx: Tx) => {
    const doc = await loadApprovalDocument(args.documentType, args.documentId);
    if (!doc) throw refuse(404, "DOCUMENT_NOT_FOUND", "Document not found.");
    if (!APPROVABLE_STATUSES[args.documentType].includes(doc.status)) {
      throw refuse(409, "NOT_AWAITING_APPROVAL", `This document is ${doc.status} and is not waiting for approval.`);
    }
    const request = await rejectApproval(tx, doc, args.actor, { comment: args.comment, previousStatus: doc.status });
    await restoreRejectedDocument(doc, args.actor, args.comment);
    await auditApprovalStep({ req: args.req, actor: args.actor, doc, request, stepNumber: request.completedSteps + 1, decision: "rejected" });
    void notifyApprovalProgress({ doc, request, actor: args.actor, outcome: "rejected" });
    return request;
  });
}

// ---------------------------------------------------------------------------
// Manual journal created straight as posted
// ---------------------------------------------------------------------------

export interface JournalCreateApproval {
  ruleId: string;
  ruleName: string;
  role: string;
}

/**
 * A journal created as posted skips the draft stage, so a covering rule is honoured only when it needs a single
 * step the creator is allowed to sign; any other covering rule says "save it as a draft" (403 APPROVAL_REQUIRED).
 * Returns null when no rule covers the amount.
 */
export async function checkJournalCreateAsPosted(companyId: string, amountAed: number, actor: GateActor): Promise<JournalCreateApproval | null> {
  const { matchRule } = await import("./approval-rules");
  const rules = await loadActiveRules(companyId, "manual_journal");
  const rule = matchRule(rules, "manual_journal", amountAed);
  if (!rule) return null;
  const role = rule.approverRoles[0];
  if (rule.approverRoles.length > 1 || !canSignStep(actor.rank, role)) {
    throw refuse(
      403,
      "APPROVAL_REQUIRED",
      "This journal needs approval before it is posted. Save it as a draft and submit it for approval.",
      { step: 1, requiredSteps: rule.approverRoles.length, requiredRole: role }
    );
  }
  return { ruleId: rule.id, ruleName: rule.name, role };
}

/** Leave the approval trail of a journal that was created as posted under a one-step rule its creator may sign. */
export async function recordJournalCreateApproval(args: {
  req: any;
  companyId: string;
  entryId: string;
  entryNumber: string | null;
  amountAed: number;
  approval: JournalCreateApproval;
  actor: GateActor;
}): Promise<void> {
  const [request] = await database
    .insert(approvalRequests)
    .values({
      companyId: args.companyId,
      documentType: "manual_journal",
      documentId: args.entryId,
      ruleId: args.approval.ruleId,
      ruleName: args.approval.ruleName,
      requiredRoles: [args.approval.role],
      amountAed: args.amountAed,
      requiredSteps: 1,
      completedSteps: 1,
      status: "approved",
      previousStatus: "draft",
      requestedBy: args.actor.userId,
      decidedAt: new Date(),
    })
    .returning();
  await database.insert(approvalSteps).values({
    companyId: args.companyId,
    requestId: request.id,
    stepNumber: 1,
    requiredRole: args.approval.role,
    decidedBy: args.actor.userId,
    decision: "approved",
    comment: "Created as posted by an approver",
  });
  await recordAudit({
    userId: args.actor.userId,
    companyId: args.companyId,
    action: "approval.step_approved",
    entityType: "manual_journal",
    entityId: args.entryId,
    after: { requestId: request.id, step: 1, requiredSteps: 1, status: "approved", amountAed: args.amountAed, createdAsPosted: true },
    req: args.req,
  });
}
