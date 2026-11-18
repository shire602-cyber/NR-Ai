import type { Express, Request, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { db } from "../db";
import {
  accounts,
  companyUsers,
  journalAttachments,
  journalEntries,
  journalLines,
  journalTemplates,
  ledgerSettings,
  type JournalEntry,
  type JournalTemplate,
} from "../../shared/schema";
import {
  createJournalBody,
  createJournalTemplateBody,
  journalActionBody,
  journalAttachmentBody,
  journalSettingsBody,
  reverseJournalBody,
  runJournalTemplateBody,
  updateJournalBody,
  updateJournalTemplateBody,
  voidJournalBody,
  type CreateJournalBody,
  type CreateJournalTemplateBody,
  type JournalAttachmentBody,
  type JournalSettingsBody,
  type ReverseJournalBody,
  type UpdateJournalBody,
  type UpdateJournalTemplateBody,
  type VoidJournalBody,
} from "../../shared/validators/journal";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { toFils } from "../../shared/money";
import {
  deleteDraft,
  describeReversal,
  journalLifecycle,
  postDraft,
  postJournal,
  reverseEntry,
  submitForApproval,
  updateDraftEntry,
  voidEntry,
  type PostJournalLineInput,
} from "../ledger";
import { normalizeEntry, parseLedgerDate, todayIso } from "../ledger/normalize";
import {
  registerLedgerJobs,
  reverseIfAutoReverseDue,
  runJournalTemplate,
} from "../ledger/templates";
import {
  MANUAL_SOURCES,
  assertManualControlPosting,
  assertUserReversible,
  manualEntryControlState,
} from "../ledger/control-accounts";
import { recordAudit } from "../services/audit.service";
import { createLogger } from "../config/logger";
import { assertRetentionExpired } from "../services/retention.service";
import { inspectUpload } from "../services/upload-guard";
import { readReceiptImage, saveReceiptFile } from "../services/fileStorage";
import { buildManualJournalLines } from "../services/journal-lines.service";

const log = createLogger("journal");

/** Roles that may approve (check) another user's manual journal. */
const APPROVER_ROLES = new Set(["owner", "admin", "accountant", "cfo"]);
/** Roles that may change the maker-checker threshold. */
const SETTINGS_ROLES = new Set(["owner", "admin", "cfo"]);
/**
 * POST /api/journal/:id/attachments is in server/index.ts largeJsonRoutes (10 MB JSON),
 * so a base64 body of up to 10 MB carries a ~7 MB file (validator caps data at 10M chars).
 */
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;

function userIdOf(req: Request): string {
  return (req as Request & { user: { id: string } }).user.id;
}

// Resolve then authorise with the same semantics as the rest of the API —
// hasCompanyAccess covers direct membership, firm owners and assigned firm
// admins.
async function findJournalEntryForUser(
  userId: string,
  entryId: string
): Promise<JournalEntry | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) return undefined;
  const entry = await storage.getJournalEntryById(entryId);
  if (!entry) return undefined;
  const hasAccess = await storage.hasCompanyAccess(userId, entry.companyId);
  return hasAccess ? entry : undefined;
}

async function requireEntry(req: Request): Promise<JournalEntry> {
  const entry = await findJournalEntryForUser(userIdOf(req), req.params.id);
  if (!entry) throw new DomainError("ENTRY_NOT_FOUND", 404, undefined, "Journal entry not found");
  return entry;
}

async function requireCompanyAccess(req: Request, companyId: string): Promise<void> {
  if (!(await storage.hasCompanyAccess(userIdOf(req), companyId))) {
    throw new DomainError("ACCESS_DENIED", 403, undefined, "Access denied");
  }
}

async function companyRole(userId: string, companyId: string): Promise<string | null> {
  const [m] = await db
    .select({ role: companyUsers.role })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

/** Members need an allowed role; firm staff reaching the company via hasCompanyAccess pass. */
async function assertRole(req: Request, companyId: string, roles: Set<string>, code: string) {
  const role = await companyRole(userIdOf(req), companyId);
  if (role !== null && !roles.has(role)) {
    throw new DomainError(code, 403, { role }, `Role '${role}' cannot do this`);
  }
}

/** A2 (H8): a manual draft that touches a control account needs its stamped adjustment. */
async function assertDraftControl(entry: JournalEntry, userId: string): Promise<void> {
  if (!MANUAL_SOURCES.has(String(entry.source))) return;
  const state = await manualEntryControlState(entry.id);
  await assertManualControlPosting({
    companyId: entry.companyId,
    accountIds: state.accountIds,
    stampedReason: state.reason,
    role: await companyRole(userId, entry.companyId),
  });
}

/** A2 (H8): recurring templates never post to a control account (no adjustment path). */
async function assertTemplateControl(
  companyId: string,
  lines: Array<{ accountId: string }>
): Promise<void> {
  await assertManualControlPosting({
    companyId,
    accountIds: lines.map((l) => l.accountId),
    role: null,
  });
}

async function approvalThresholdFils(companyId: string): Promise<number | null> {
  const [row] = await db
    .select({ threshold: ledgerSettings.manualApprovalThreshold })
    .from(ledgerSettings)
    .where(eq(ledgerSettings.companyId, companyId));
  if (row?.threshold === null || row?.threshold === undefined) return null;
  return toFils(row.threshold, { rounding: "halfUp" });
}

/**
 * WQ3 (9.4): body lines -> kernel lines. Foreign-currency lines without a base amount convert at
 * the tenant rate (fx.convert); "standard" VAT lines get their derived, flagged VAT leg; contacts
 * and CT treatments are checked against this company (server/services/journal-lines.service.ts).
 */
function toLineInputs(
  companyId: string,
  date: string | Date,
  lines: CreateJournalBody["lines"]
): Promise<PostJournalLineInput[]> {
  return buildManualJournalLines(companyId, date, lines);
}

function memoOf(body: { memo?: string | null; description?: string | null }): string | null {
  // The client used to send `description`; the column is `memo`.
  return body.memo ?? body.description ?? null;
}

interface Cursor {
  d: string;
  id: string;
}

function encodeCursor(entry: JournalEntry): string {
  return Buffer.from(
    JSON.stringify({ d: new Date(entry.date).toISOString(), id: entry.id })
  ).toString("base64url");
}

function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof c?.d !== "string" || Number.isNaN(new Date(c.d).getTime())) throw new Error("bad");
    if (typeof c.id !== "string" || !/^[0-9a-f-]{36}$/i.test(c.id)) throw new Error("bad");
    return c;
  } catch {
    throw new DomainError("INVALID_CURSOR", 400, undefined, "cursor is not valid");
  }
}

/** Both sides of a reversal, for list/detail responses. */
type Peer = { id: string; entryNumber: string; date: Date };

async function reversalPeers(entries: JournalEntry[]): Promise<Map<string, Peer>> {
  const ids = new Set<string>();
  for (const e of entries) {
    const r = describeReversal(e);
    if (r.reversedByEntryId) ids.add(r.reversedByEntryId);
    if (r.reversalOf) ids.add(r.reversalOf);
  }
  if (ids.size === 0) return new Map<string, Peer>();
  const rows: Peer[] = await db
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      date: journalEntries.date,
    })
    .from(journalEntries)
    .where(inArray(journalEntries.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r]));
}

function presentEntry(entry: JournalEntry, peers: Map<string, Peer>) {
  const r = describeReversal(entry);
  return {
    ...entry,
    ...r,
    lifecycleStatus: journalLifecycle(entry),
    reversedByEntry: r.reversedByEntryId ? (peers.get(r.reversedByEntryId) ?? null) : null,
    reversalOfEntry: r.reversalOf ? (peers.get(r.reversalOf) ?? null) : null,
  };
}

export function registerJournalRoutes(app: Express) {
  registerLedgerJobs();

  // ─── List (cursor pagination) ─────────────────────────────────────────
  // Response stays an array for existing consumers. Pass ?cursor=<X-Next-Cursor>
  // to page; ?limit caps the page (default and max 1000).
  app.get(
    "/api/companies/:companyId/journal",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireCompanyAccess(req, companyId);
      const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 1000);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const cursor = decodeCursor(req.query.cursor);
      const [page, accountRows] = await Promise.all([
        storage.getJournalEntriesByCompanyId(companyId, {
          limit: limit + 1,
          offset: cursor ? 0 : offset,
          before: cursor ? { date: new Date(cursor.d), id: cursor.id } : undefined,
        }),
        storage.getAccountsByCompanyId(companyId),
      ]);
      const entries = page.slice(0, limit);
      if (page.length > limit)
        res.setHeader("X-Next-Cursor", encodeCursor(entries[entries.length - 1]));
      const allLines = await storage.getJournalLinesByEntryIds(entries.map((e) => e.id));
      const accountById = new Map(accountRows.map((a) => [a.id, a]));
      const linesByEntryId = new Map<string, typeof allLines>();
      for (const line of allLines) {
        const list = linesByEntryId.get(line.entryId) ?? [];
        list.push(line);
        linesByEntryId.set(line.entryId, list);
      }
      const peers = await reversalPeers(entries);
      res.json(
        entries.map((entry) => ({
          ...presentEntry(entry, peers),
          lines: (linesByEntryId.get(entry.id) ?? []).map((line) => ({
            ...line,
            account: accountById.get(line.accountId),
          })),
        }))
      );
    })
  );

  // ─── Create ───────────────────────────────────────────────────────────
  app.post(
    "/api/companies/:companyId/journal",
    authMiddleware,
    requireCustomer,
    strictBody(createJournalBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = userIdOf(req);
      const body: CreateJournalBody = createJournalBody.parse(req.body);
      await requireCompanyAccess(req, companyId);

      // A2 (H8): control accounts take manual lines only as an explicit adjustment. The kernel
      // enforces the same rule (B1: NC1) and stamps the reason in the posting transaction.
      const role = await companyRole(userId, companyId);
      const control = await assertManualControlPosting({
        companyId,
        accountIds: body.lines.map((l) => l.accountId),
        adjustment: body.controlAdjustment ?? null,
        role,
      });
      const adjustmentReason = control.length ? (body.controlAdjustment?.reason ?? null) : null;
      const requested = body.status ?? "draft";
      const input = {
        companyId,
        date: body.date,
        memo: memoOf(body),
        reference: body.reference ?? null,
        source: "manual",
        idempotencyKey: body.idempotencyKey ?? null,
        autoReverseOn: body.autoReverseOn ?? null,
        lines: await toLineInputs(companyId, body.date, body.lines),
      };
      // Maker-checker: a manual entry above the company threshold is saved as
      // a draft pending approval instead of being posted by its maker.
      const threshold = await approvalThresholdFils(companyId);
      let status: "draft" | "posted" = requested;
      let pendingApproval = false;
      if (requested === "posted" && threshold !== null) {
        const n = normalizeEntry({ ...input, status: "posted" });
        if (n.totalDebitFils > threshold) {
          status = "draft";
          pendingApproval = true;
        }
      }
      const result = await postJournal(
        { ...input, status },
        {
          actorId: userId,
          req,
          audit: true,
          controlAdjustment: adjustmentReason ? { reason: adjustmentReason, role } : null,
        }
      );
      let entry = result.entry;
      if (pendingApproval && !result.replayed) {
        entry = await submitForApproval(entry.id, { actorId: userId, companyId });
      }
      // L8: a back-dated accrual whose reversal date has passed reverses now.
      if (entry.status === "posted") await reverseIfAutoReverseDue(entry.id, userId);
      res.status(pendingApproval ? 202 : 200).json({
        id: entry.id,
        entryNumber: entry.entryNumber,
        status: entry.status,
        approvalStatus: entry.approvalStatus ?? null,
        replayed: result.replayed,
        message: pendingApproval
          ? "Journal entry saved and sent for approval"
          : entry.status === "posted"
            ? "Journal entry posted successfully"
            : "Journal entry saved as draft",
      });
    })
  );

  // ─── Maker-checker settings ───────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/journal/settings",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireCompanyAccess(req, companyId);
      const [row] = await db
        .select()
        .from(ledgerSettings)
        .where(eq(ledgerSettings.companyId, companyId));
      res.json({ manualApprovalThreshold: row?.manualApprovalThreshold ?? null });
    })
  );

  app.put(
    "/api/companies/:companyId/journal/settings",
    authMiddleware,
    requireCustomer,
    strictBody(journalSettingsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = userIdOf(req);
      await requireCompanyAccess(req, companyId);
      await assertRole(req, companyId, SETTINGS_ROLES, "SETTINGS_FORBIDDEN");
      const body: JournalSettingsBody = journalSettingsBody.parse(req.body);
      const threshold =
        body.manualApprovalThreshold === null ? null : Number(body.manualApprovalThreshold);
      await db
        .insert(ledgerSettings)
        .values({
          companyId,
          manualApprovalThreshold: threshold,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: ledgerSettings.companyId,
          set: { manualApprovalThreshold: threshold, updatedBy: userId, updatedAt: new Date() },
        });
      await recordAudit({
        userId,
        companyId,
        action: "journal.settings_update",
        entityType: "ledger_settings",
        entityId: companyId,
        after: { manualApprovalThreshold: body.manualApprovalThreshold },
        req,
      });
      res.json({ manualApprovalThreshold: body.manualApprovalThreshold });
    })
  );

  // ─── Detail ───────────────────────────────────────────────────────────
  app.get(
    "/api/journal/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const entry = await requireEntry(req);
      const lines = await db
        .select({ line: journalLines, account: accounts })
        .from(journalLines)
        .leftJoin(accounts, eq(accounts.id, journalLines.accountId))
        .where(eq(journalLines.entryId, entry.id));
      const peers = await reversalPeers([entry]);
      const attachments = await db
        .select({
          id: journalAttachments.id,
          fileName: journalAttachments.fileName,
          contentType: journalAttachments.contentType,
          sizeBytes: journalAttachments.sizeBytes,
          createdAt: journalAttachments.createdAt,
        })
        .from(journalAttachments)
        .where(eq(journalAttachments.entryId, entry.id));
      res.json({
        ...presentEntry(entry, peers),
        lines: lines.map(
          (r: {
            line: typeof journalLines.$inferSelect;
            account: typeof accounts.$inferSelect | null;
          }) => ({
            ...r.line,
            account: r.account
              ? {
                  id: r.account.id,
                  code: r.account.code,
                  nameEn: r.account.nameEn,
                  nameAr: r.account.nameAr,
                  type: r.account.type,
                }
              : undefined,
          })
        ),
        attachments,
      });
    })
  );

  // ─── Update draft ─────────────────────────────────────────────────────
  app.put(
    "/api/journal/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateJournalBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const entry = await requireEntry(req);
      const body: UpdateJournalBody = updateJournalBody.parse(req.body);
      if (entry.status !== "draft") {
        throw new DomainError(
          entry.status === "posted" ? "ENTRY_POSTED" : "ENTRY_NOT_DRAFT",
          409,
          { status: entry.status },
          "Posted journal entries cannot be edited. Reverse them instead."
        );
      }
      const prior = await manualEntryControlState(entry.id);
      const role = await companyRole(userId, entry.companyId);
      const control = MANUAL_SOURCES.has(String(entry.source))
        ? await assertManualControlPosting({
            companyId: entry.companyId,
            accountIds: body.lines.map((l) => l.accountId),
            adjustment: body.controlAdjustment ?? null,
            stampedReason: body.controlAdjustment === null ? null : prior.reason,
            role,
          })
        : [];
      // B1 (NC1): the kernel re-checks the edited lines of every non-sub-ledger draft and stamps
      // (or clears) the adjustment reason with the edit.
      const reason =
        body.controlAdjustment === null
          ? null
          : (body.controlAdjustment?.reason ?? (control.length ? prior.reason : null));
      const ctx = {
        actorId: userId,
        companyId: entry.companyId,
        req,
        controlAdjustment: reason ? { reason, role } : null,
      };
      let result = await updateDraftEntry(
        entry.id,
        {
          date: body.date,
          memo: memoOf(body),
          reference: body.reference ?? null,
          autoReverseOn: body.autoReverseOn ?? null,
          lines: await toLineInputs(entry.companyId, body.date, body.lines),
        },
        ctx
      );
      if (body.status === "posted") {
        result = await postDraft(entry.id, ctx, {
          approvalThresholdFils: await approvalThresholdFils(entry.companyId),
        });
        await reverseIfAutoReverseDue(result.entry.id, userId);
      }
      log.info({ id: entry.id }, "Draft journal entry updated");
      res.json({
        id: result.entry.id,
        status: result.entry.status,
        message: "Draft entry updated successfully",
      });
    })
  );

  // ─── Post draft (conditional update; maker-checker aware) ─────────────
  async function postOrRequestApproval(req: Request, res: Response) {
    const userId = userIdOf(req);
    const entry = await requireEntry(req);
    const ctx = { actorId: userId, companyId: entry.companyId, req };
    await assertDraftControl(entry, userId);
    try {
      const result = await postDraft(entry.id, ctx, {
        approvalThresholdFils: await approvalThresholdFils(entry.companyId),
      });
      await reverseIfAutoReverseDue(result.entry.id, userId);
      return res.json({
        id: result.entry.id,
        status: "posted",
        message: "Entry posted successfully",
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === "APPROVAL_REQUIRED") {
        const pending = await submitForApproval(entry.id, ctx);
        return res.status(202).json({
          id: pending.id,
          status: pending.status,
          approvalStatus: pending.approvalStatus,
          code: "APPROVAL_REQUIRED",
          message: "This entry needs approval by another user before it can be posted",
        });
      }
      throw err;
    }
  }

  app.post(
    "/api/journal/:id/post",
    authMiddleware,
    requireCustomer,
    strictBody(journalActionBody),
    asyncHandler(postOrRequestApproval)
  );

  // Checker: a different user with an approver role approves and posts.
  app.post(
    "/api/journal/:id/approve",
    authMiddleware,
    requireCustomer,
    strictBody(journalActionBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const entry = await requireEntry(req);
      if (entry.createdBy === userId) {
        throw new DomainError("SELF_APPROVAL", 403, undefined, "You cannot approve your own entry");
      }
      await assertRole(req, entry.companyId, APPROVER_ROLES, "APPROVER_ROLE_REQUIRED");
      await assertDraftControl(entry, userId);
      const result = await postDraft(
        entry.id,
        { actorId: userId, companyId: entry.companyId, req },
        // Threshold 0 forces the approval stamp for any non-zero entry.
        { approvalThresholdFils: 0 }
      );
      await reverseIfAutoReverseDue(result.entry.id, userId);
      res.json({
        id: result.entry.id,
        status: result.entry.status,
        approvalStatus: result.entry.approvalStatus,
        message: "Entry approved and posted",
      });
    })
  );

  // ─── Reverse / void ───────────────────────────────────────────────────
  app.post(
    "/api/journal/:id/reverse",
    authMiddleware,
    requireCustomer,
    strictBody(reverseJournalBody),
    asyncHandler(async (req: Request, res: Response) => {
      const entry = await requireEntry(req);
      const body: ReverseJournalBody = reverseJournalBody.parse(req.body);
      // B1 (NH2): a document's journal is undone through the document, not here.
      assertUserReversible(entry);
      const r = await reverseEntry(
        entry.id,
        { date: body.date ?? null, reason: body.reason ?? null },
        { actorId: userIdOf(req), companyId: entry.companyId, req }
      );
      log.info({ id: entry.id, reversalEntryId: r.reversal.id }, "Entry reversed");
      res.json({
        originalId: entry.id,
        reversalId: r.reversal.id,
        reversalNumber: r.reversal.entryNumber,
        reversalDate: r.reversal.date,
        message: "Entry reversed successfully",
      });
    })
  );

  app.post(
    "/api/journal/:id/void",
    authMiddleware,
    requireCustomer,
    strictBody(voidJournalBody),
    asyncHandler(async (req: Request, res: Response) => {
      const entry = await requireEntry(req);
      const body: VoidJournalBody = voidJournalBody.parse(req.body);
      assertUserReversible(entry);
      const r = await voidEntry(
        entry.id,
        { reason: body.reason ?? null },
        { actorId: userIdOf(req), companyId: entry.companyId, req }
      );
      res.json({
        originalId: entry.id,
        reversalId: r.reversal.id,
        reversalNumber: r.reversal.entryNumber,
        lifecycleStatus: "voided",
        message: "Entry voided",
      });
    })
  );

  // ─── Delete draft ─────────────────────────────────────────────────────
  app.delete(
    "/api/journal/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const entry = await requireEntry(req);
      if (entry.status !== "draft") {
        throw new DomainError(
          entry.status === "posted" ? "ENTRY_POSTED" : "ENTRY_VOID",
          409,
          { status: entry.status },
          entry.status === "posted"
            ? "Posted entries cannot be deleted. Reverse or void the entry instead."
            : "Void entries cannot be deleted (required for audit trail)."
        );
      }
      assertRetentionExpired(
        entry as { createdAt: Date | string; retentionExpiresAt?: Date | string | null },
        "Journal entry"
      );
      // WP6: drafts are deleted only through the ledger kernel (audited,
      // draft-guarded inside the ledger transaction).
      const deleted = await deleteDraft(entry.id, {
        actorId: userId,
        companyId: entry.companyId,
        req,
      });
      if (!deleted) throw new DomainError("ENTRY_NOT_DRAFT", 409);
      await recordAudit({
        userId,
        companyId: entry.companyId,
        action: "journal.delete",
        entityType: "journal_entry",
        entityId: entry.id,
        before: { entryNumber: entry.entryNumber, status: entry.status },
        after: null,
        req,
      });
      res.json({ message: "Draft entry deleted successfully" });
    })
  );

  // ─── Attachments ──────────────────────────────────────────────────────
  app.get(
    "/api/journal/:id/attachments",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const entry = await requireEntry(req);
      const rows = await db
        .select({
          id: journalAttachments.id,
          fileName: journalAttachments.fileName,
          contentType: journalAttachments.contentType,
          sizeBytes: journalAttachments.sizeBytes,
          createdAt: journalAttachments.createdAt,
        })
        .from(journalAttachments)
        .where(eq(journalAttachments.entryId, entry.id))
        .orderBy(desc(journalAttachments.createdAt));
      res.json(rows);
    })
  );

  app.post(
    "/api/journal/:id/attachments",
    authMiddleware,
    requireCustomer,
    strictBody(journalAttachmentBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const entry = await requireEntry(req);
      const body: JournalAttachmentBody = journalAttachmentBody.parse(req.body);
      const inspected = await inspectUpload(body.data, { maxBytes: MAX_ATTACHMENT_BYTES });
      const storageKey = await saveReceiptFile(inspected.buffer, {
        mime: inspected.mime,
        ext: inspected.ext,
      });
      const [row] = await db
        .insert(journalAttachments)
        .values({
          entryId: entry.id,
          companyId: entry.companyId,
          fileName: body.fileName,
          contentType: inspected.mime,
          storageKey,
          sizeBytes: inspected.size,
          uploadedBy: userId,
        })
        .returning();
      await recordAudit({
        userId,
        companyId: entry.companyId,
        action: "journal.attachment_add",
        entityType: "journal_entry",
        entityId: entry.id,
        after: { attachmentId: row.id, fileName: row.fileName, sizeBytes: row.sizeBytes },
        req,
      });
      res.status(201).json({
        id: row.id,
        fileName: row.fileName,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt,
      });
    })
  );

  app.get(
    "/api/journal/:id/attachments/:attachmentId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const entry = await requireEntry(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.attachmentId)) {
        throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      }
      const [row] = await db
        .select()
        .from(journalAttachments)
        .where(
          and(
            eq(journalAttachments.id, req.params.attachmentId),
            eq(journalAttachments.entryId, entry.id)
          )
        );
      if (!row) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      const file = await readReceiptImage(row.storageKey);
      if (!file) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      res.setHeader("Content-Type", row.contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${row.fileName.replace(/[^\w.\- ]/g, "_")}"`
      );
      res.send(file.buffer);
    })
  );

  app.delete(
    "/api/journal/:id/attachments/:attachmentId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const entry = await requireEntry(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.attachmentId)) {
        throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      }
      const deleted = await db
        .delete(journalAttachments)
        .where(
          and(
            eq(journalAttachments.id, req.params.attachmentId),
            eq(journalAttachments.entryId, entry.id)
          )
        )
        .returning({ id: journalAttachments.id });
      if (deleted.length === 0) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      await recordAudit({
        userId,
        companyId: entry.companyId,
        action: "journal.attachment_remove",
        entityType: "journal_entry",
        entityId: entry.id,
        before: { attachmentId: req.params.attachmentId },
        req,
      });
      res.json({ message: "Attachment removed" });
    })
  );

  // ─── Recurring / auto-reversing templates ─────────────────────────────
  async function requireTemplate(req: Request): Promise<JournalTemplate> {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new DomainError("TEMPLATE_NOT_FOUND", 404);
    const [t] = await db
      .select()
      .from(journalTemplates)
      .where(eq(journalTemplates.id, req.params.id));
    if (!t || !(await storage.hasCompanyAccess(userIdOf(req), t.companyId))) {
      throw new DomainError("TEMPLATE_NOT_FOUND", 404);
    }
    return t;
  }

  /** Validate template lines/dates with the kernel's rules (422 on bad input). */
  function checkTemplate(
    companyId: string,
    body: Pick<CreateJournalTemplateBody, "lines" | "memo"> & {
      nextRunOn?: string | null;
      endOn?: string | null;
    }
  ) {
    normalizeEntry({
      companyId,
      date: todayIso(),
      status: "draft",
      memo: body.memo ?? null,
      lines: body.lines.map((l) => ({ ...l })),
    });
    const next = body.nextRunOn ? parseLedgerDate(body.nextRunOn, "nextRunOn").iso : null;
    const end = body.endOn ? parseLedgerDate(body.endOn, "endOn").iso : null;
    if (next && end && end < next)
      throw new DomainError("INVALID_END_DATE", 422, undefined, "endOn is before nextRunOn");
    return { next, end };
  }

  app.get(
    "/api/companies/:companyId/journal-templates",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireCompanyAccess(req, companyId);
      const rows = await db
        .select()
        .from(journalTemplates)
        .where(eq(journalTemplates.companyId, companyId))
        .orderBy(desc(journalTemplates.createdAt));
      res.json(rows);
    })
  );

  app.post(
    "/api/companies/:companyId/journal-templates",
    authMiddleware,
    requireCustomer,
    strictBody(createJournalTemplateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = userIdOf(req);
      await requireCompanyAccess(req, companyId);
      const body: CreateJournalTemplateBody = createJournalTemplateBody.parse(req.body);
      const { next, end } = checkTemplate(companyId, body);
      await assertTemplateControl(companyId, body.lines);
      const [row] = await db
        .insert(journalTemplates)
        .values({
          companyId,
          name: body.name,
          memo: body.memo ?? null,
          lines: body.lines,
          frequency: body.frequency,
          nextRunOn: next ?? todayIso(),
          endOn: end,
          postAs: body.postAs ?? "posted",
          autoReverseDays: body.autoReverseDays ?? null,
          isActive: body.isActive ?? true,
          createdBy: userId,
        })
        .returning();
      await recordAudit({
        userId,
        companyId,
        action: "journal.template_create",
        entityType: "journal_template",
        entityId: row.id,
        after: { name: row.name, frequency: row.frequency },
        req,
      });
      res.status(201).json(row);
    })
  );

  app.patch(
    "/api/journal-templates/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateJournalTemplateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const t = await requireTemplate(req);
      const body: UpdateJournalTemplateBody = updateJournalTemplateBody.parse(req.body);
      const merged = {
        lines: body.lines ?? (t.lines as CreateJournalTemplateBody["lines"]),
        memo: body.memo !== undefined ? body.memo : t.memo,
        nextRunOn: body.nextRunOn !== undefined ? body.nextRunOn : t.nextRunOn,
        endOn: body.endOn !== undefined ? body.endOn : t.endOn,
      };
      const { next, end } = checkTemplate(t.companyId, merged);
      if (body.lines !== undefined) await assertTemplateControl(t.companyId, body.lines);
      const patch: Partial<JournalTemplate> = {
        updatedAt: new Date(),
        nextRunOn: next,
        endOn: end,
      };
      if (body.name !== undefined) patch.name = body.name;
      if (body.memo !== undefined) patch.memo = body.memo ?? null;
      if (body.lines !== undefined) patch.lines = body.lines;
      if (body.frequency !== undefined) patch.frequency = body.frequency;
      if (body.postAs !== undefined) patch.postAs = body.postAs;
      if (body.autoReverseDays !== undefined) patch.autoReverseDays = body.autoReverseDays ?? null;
      if (body.isActive !== undefined) patch.isActive = body.isActive;
      const [row] = await db
        .update(journalTemplates)
        .set(patch)
        .where(and(eq(journalTemplates.id, t.id), eq(journalTemplates.companyId, t.companyId)))
        .returning();
      res.json(row);
    })
  );

  app.delete(
    "/api/journal-templates/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const t = await requireTemplate(req);
      await db
        .delete(journalTemplates)
        .where(and(eq(journalTemplates.id, t.id), eq(journalTemplates.companyId, t.companyId)));
      await recordAudit({
        userId: userIdOf(req),
        companyId: t.companyId,
        action: "journal.template_delete",
        entityType: "journal_template",
        entityId: t.id,
        before: { name: t.name },
        req,
      });
      res.json({ message: "Template deleted" });
    })
  );

  app.post(
    "/api/journal-templates/:id/run",
    authMiddleware,
    requireCustomer,
    strictBody(runJournalTemplateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const t = await requireTemplate(req);
      const { date: requested } = runJournalTemplateBody.parse(req.body);
      const date = requested ?? t.nextRunOn ?? todayIso();
      const result = await runJournalTemplate(t, date, userIdOf(req));
      res.json({
        id: result.entry.id,
        entryNumber: result.entry.entryNumber,
        status: result.entry.status,
        replayed: result.replayed,
      });
    })
  );
}
