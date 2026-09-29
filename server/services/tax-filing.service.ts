/**
 * Generic "tax filing evidence" service shared by VAT (4.1) and corporate tax
 * (4.2): permissions, evidence files (private storage, soft-removal under the
 * 5-year retention rule), the settlement payments of a filed return, the
 * journal helper and the combined read model the UI renders.
 *
 * VAT- and CT-specific parts (snapshot content, clearing entries, period
 * lock, amendment) live in vat-filing.service.ts / ct-filing.service.ts and
 * call into this module.
 *
 * Muhasib never transmits a return to the FTA. A filing record is the user's
 * own record of a filing made on EmaraTax.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Request } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { AppError } from "../errors";
import {
  accounts,
  taxFilingEvidence,
  taxFilingPayments,
  taxFilings,
  type TaxFiling,
} from "../../shared/schema";
import { validateUpload } from "./document-validation";
import type { PostingBypass } from "./posting-lock";
import {
  removeStoredFile,
  storeUploadedFile,
  type StoredUpload,
} from "./document-upload.service";
import { resolveSettlementDate } from "./payment-date-guard.service";
import { recordAudit } from "./audit.service";
import { round2, toFils, fromFils, type BoxDifference } from "./tax-filing-core";
import {
  buildSettlementPaymentLines,
  remainingToSettle,
  type JournalLineInput,
} from "./tax-settlement";

export type FilingKind = "vat" | "corporate_tax";

export const EVIDENCE_CATEGORY = "tax-filing-evidence";
/** The FTA acknowledgement is a PDF or a screenshot of it. */
export const EVIDENCE_CONTENT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

export interface FilingActor {
  id: string;
  isAdmin?: boolean;
  firmRole?: string | null;
}

// ─── Permissions ─────────────────────────────────────────────────────────────

/** Company roles that may record filings, upload evidence and record payments. */
const FILING_ROLES = new Set(["owner", "accountant", "cfo"]);
/** Only an owner or accountant may remove an evidence file (it is audit-logged). */
const REMOVAL_ROLES = new Set(["owner", "accountant"]);

export async function assertFilingPermission(
  user: FilingActor,
  companyId: string,
  action: "write" | "remove"
): Promise<void> {
  if (!(await storage.hasCompanyAccess(user.id, companyId))) {
    throw new AppError({ message: "Access denied", statusCode: 403, code: "ACCESS_DENIED" });
  }
  if (user.isAdmin) return;
  const membership = await storage.getUserRole(companyId, user.id);
  if (!membership) {
    // access came from firm staff assignment, which hasCompanyAccess already vetted
    if (user.firmRole === "firm_owner" || user.firmRole === "firm_admin") return;
    throw new AppError({ message: "Access denied", statusCode: 403, code: "ACCESS_DENIED" });
  }
  const allowed = action === "remove" ? REMOVAL_ROLES : FILING_ROLES;
  if (!allowed.has(membership.role)) {
    throw new AppError({
      message:
        action === "remove"
          ? "Only a company owner or accountant can remove evidence files."
          : "Only a company owner, accountant or CFO can record filings, evidence and payments.",
      statusCode: 403,
      code: "FILING_FORBIDDEN",
    });
  }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

type Tx = any;

export interface AccountRef {
  id: string;
  code: string;
  nameEn: string;
}

/** Active account of the company with this code (and one of the given types), or null. */
export async function findAccountByCode(
  tx: Tx,
  companyId: string,
  code: string,
  types: string[]
): Promise<AccountRef | null> {
  const rows: Array<AccountRef & { type: string }> = await tx
    .select({ id: accounts.id, code: accounts.code, nameEn: accounts.nameEn, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code), eq(accounts.isActive, true)));
  return rows.find((a) => types.includes(a.type)) ?? null;
}

/** Active account by (case-insensitive) English name, for accounts a company created itself. */
export async function findAccountByName(
  tx: Tx,
  companyId: string,
  nameEn: string,
  types: string[]
): Promise<AccountRef | null> {
  const rows: Array<AccountRef & { type: string }> = await tx
    .select({ id: accounts.id, code: accounts.code, nameEn: accounts.nameEn, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.isActive, true)));
  const wanted = nameEn.trim().toLowerCase();
  return rows.find((a) => types.includes(a.type) && a.nameEn.trim().toLowerCase() === wanted) ?? null;
}

export function missingAccountError(name: string, code: string, type: string): AppError {
  return new AppError({
    message: `The chart of accounts has no "${name}" account (${type}, code ${code}). Create it under Accounts, then try again. Nothing was posted.`,
    statusCode: 422,
    code: "ACCOUNT_MISSING",
    details: { accountName: name, suggestedCode: code, type },
  });
}

/** The payment account must belong to the company, be active and be an asset (bank / cash). */
export async function resolvePaymentAccount(companyId: string, accountId: unknown): Promise<AccountRef> {
  if (typeof accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(accountId)) {
    throw new AppError({ message: "A bank or cash account is required.", statusCode: 400, code: "ACCOUNT_REQUIRED" });
  }
  const rows = await db
    .select({ id: accounts.id, code: accounts.code, nameEn: accounts.nameEn, type: accounts.type, isActive: accounts.isActive })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)));
  const account = rows[0];
  if (!account) {
    throw new AppError({ message: "That account does not belong to this company.", statusCode: 404, code: "ACCOUNT_NOT_FOUND" });
  }
  if (account.type !== "asset" || account.isActive === false) {
    throw new AppError({
      message: "Payments are made from a bank or cash account: choose an active asset account.",
      statusCode: 422,
      code: "ACCOUNT_NOT_ASSET",
    });
  }
  return { id: account.id, code: account.code, nameEn: account.nameEn };
}

// ─── Journal ─────────────────────────────────────────────────────────────────

export async function postSettlementJournal(
  tx: Tx,
  input: {
    companyId: string;
    ymd: string;
    memo: string;
    source: string;
    sourceId: string;
    userId: string;
    lines: JournalLineInput[];
    /** Narrow, server-constructed exception to the period lock (never from a request). */
    allowLockedPeriod?: PostingBypass;
  }
): Promise<string | null> {
  if (input.lines.length === 0) return null;
  const date = new Date(`${input.ymd}T00:00:00Z`);
  const entry = await storage.createJournalEntry(
    {
      companyId: input.companyId,
      entryNumber: "", // assigned inside the transaction (advisory-locked)
      date,
      memo: input.memo,
      status: "posted",
      source: input.source,
      sourceId: input.sourceId,
      createdBy: input.userId,
      postedBy: input.userId,
      postedAt: new Date(),
    } as any,
    input.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    })),
    { tx, allowLockedPeriod: input.allowLockedPeriod }
  );
  return entry.id;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getFilingByReturn(kind: FilingKind, returnId: string): Promise<TaxFiling | null> {
  const rows = await db
    .select()
    .from(taxFilings)
    .where(and(eq(taxFilings.kind, kind), eq(taxFilings.returnId, returnId)));
  return rows[0] ?? null;
}

export async function getFilingById(filingId: string): Promise<TaxFiling | null> {
  const rows = await db.select().from(taxFilings).where(eq(taxFilings.id, filingId));
  return rows[0] ?? null;
}

export async function listEvidence(filingId: string) {
  return db
    .select({
      id: taxFilingEvidence.id,
      filename: taxFilingEvidence.filename,
      contentType: taxFilingEvidence.contentType,
      sizeBytes: taxFilingEvidence.sizeBytes,
      uploadedBy: taxFilingEvidence.uploadedBy,
      createdAt: taxFilingEvidence.createdAt,
    })
    .from(taxFilingEvidence)
    .where(and(eq(taxFilingEvidence.filingId, filingId), isNull(taxFilingEvidence.removedAt)))
    .orderBy(asc(taxFilingEvidence.createdAt));
}

export async function listPayments(filingId: string) {
  return db
    .select({
      id: taxFilingPayments.id,
      amount: taxFilingPayments.amount,
      paidAt: taxFilingPayments.paidAt,
      accountId: taxFilingPayments.accountId,
      accountName: accounts.nameEn,
      reference: taxFilingPayments.reference,
      journalEntryId: taxFilingPayments.journalEntryId,
      createdAt: taxFilingPayments.createdAt,
    })
    .from(taxFilingPayments)
    .leftJoin(accounts, eq(accounts.id, taxFilingPayments.accountId))
    .where(eq(taxFilingPayments.filingId, filingId))
    .orderBy(asc(taxFilingPayments.createdAt));
}

export interface SettlementView {
  net: number;
  paid: number;
  remaining: number;
  direction: "pay" | "receive" | "none";
  status: "none" | "unpaid" | "partial" | "paid";
}

export function buildSettlementView(net: number, paymentAmounts: number[]): SettlementView {
  const paid = fromFils(paymentAmounts.reduce((s, p) => s + toFils(p), 0));
  const rem = remainingToSettle(net, paymentAmounts);
  let status: SettlementView["status"];
  if (rem.direction === "none") status = "none";
  else if (rem.remaining === 0) status = "paid";
  else status = paid > 0 ? "partial" : "unpaid";
  return { net: round2(net), paid, remaining: rem.remaining, direction: rem.direction, status };
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export interface EvidenceUploadInput {
  fileName?: unknown;
  mimeType?: unknown;
  fileData?: unknown;
}

/** Validate (PDF / PNG / JPEG only) and store an acknowledgement file privately. */
export async function storeEvidenceFile(
  companyId: string,
  userId: string,
  input: EvidenceUploadInput
): Promise<StoredUpload> {
  const checked = validateUpload({
    filename: typeof input.fileName === "string" ? input.fileName : null,
    contentType: typeof input.mimeType === "string" ? input.mimeType : null,
    base64: typeof input.fileData === "string" ? input.fileData : null,
  });
  if (!checked.ok) {
    throw new AppError({ message: checked.message, statusCode: checked.status, code: checked.code });
  }
  if (!(EVIDENCE_CONTENT_TYPES as readonly string[]).includes(checked.contentType)) {
    throw new AppError({
      message: "The FTA acknowledgement must be a PDF, PNG or JPEG file.",
      statusCode: 400,
      code: "FILE_TYPE_NOT_ALLOWED",
    });
  }
  return storeUploadedFile({
    companyId,
    category: EVIDENCE_CATEGORY,
    fileName: checked.filename,
    mimeType: checked.contentType,
    fileData: input.fileData,
    uploadedBy: userId,
  });
}

export function evidenceRow(companyId: string, filingId: string, userId: string, stored: StoredUpload) {
  return {
    companyId,
    filingId,
    storageKey: stored.key,
    filename: stored.filename,
    contentType: stored.contentType,
    sizeBytes: stored.sizeBytes,
    uploadedBy: userId,
  };
}

export async function addEvidence(args: {
  user: FilingActor;
  companyId: string;
  filing: TaxFiling;
  upload: EvidenceUploadInput;
  req?: Request;
}) {
  await assertFilingPermission(args.user, args.companyId, "write");
  const stored = await storeEvidenceFile(args.companyId, args.user.id, args.upload);
  try {
    const [row] = await db
      .insert(taxFilingEvidence)
      .values(evidenceRow(args.companyId, args.filing.id, args.user.id, stored))
      .returning();
    await recordAudit({
      userId: args.user.id,
      companyId: args.companyId,
      action: "tax_filing.evidence_add",
      entityType: "tax_filing",
      entityId: args.filing.id,
      after: { evidenceId: row.id, filename: stored.filename, sizeBytes: stored.sizeBytes },
      req: args.req,
    });
    return row;
  } catch (err) {
    await removeStoredFile(stored.key);
    throw err;
  }
}

export async function getEvidenceForDownload(companyId: string, filingId: string, evidenceId: string) {
  const rows = await db
    .select()
    .from(taxFilingEvidence)
    .where(
      and(
        eq(taxFilingEvidence.id, evidenceId),
        eq(taxFilingEvidence.filingId, filingId),
        eq(taxFilingEvidence.companyId, companyId),
        isNull(taxFilingEvidence.removedAt)
      )
    );
  return rows[0] ?? null;
}

/**
 * Remove an evidence file. FTA retention (5 years, retention.service.ts) means the
 * stored object and its row are KEPT: the row is marked removed (who, when, why)
 * and disappears from the list and from downloads. Audit-logged.
 */
export async function removeEvidence(args: {
  user: FilingActor;
  companyId: string;
  filing: TaxFiling;
  evidenceId: string;
  reason: unknown;
  req?: Request;
}) {
  await assertFilingPermission(args.user, args.companyId, "remove");
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < 5) {
    throw new AppError({
      message: "A reason (at least 5 characters) is required to remove an evidence file.",
      statusCode: 400,
      code: "REASON_REQUIRED",
    });
  }
  const evidence = await getEvidenceForDownload(args.companyId, args.filing.id, args.evidenceId);
  if (!evidence) {
    throw new AppError({ message: "Evidence file not found", statusCode: 404, code: "EVIDENCE_NOT_FOUND" });
  }
  await db
    .update(taxFilingEvidence)
    .set({ removedAt: new Date(), removedBy: args.user.id, removedReason: reason })
    .where(eq(taxFilingEvidence.id, evidence.id));
  await recordAudit({
    userId: args.user.id,
    companyId: args.companyId,
    action: "tax_filing.evidence_remove",
    entityType: "tax_filing",
    entityId: args.filing.id,
    before: { evidenceId: evidence.id, filename: evidence.filename },
    extra: { reason, retained: true },
    req: args.req,
  });
}

// ─── Payments ────────────────────────────────────────────────────────────────

export interface PaymentInput {
  amount?: unknown;
  date?: unknown;
  accountId?: unknown;
  reference?: unknown;
}

export interface PaymentControlAccount {
  /** Resolves the account the payment settles (FTA VAT control / Corporate Tax Payable). */
  resolve: (tx: Tx, companyId: string) => Promise<AccountRef>;
  journalSource: string;
  label: string;
}

/**
 * Record a (possibly partial) payment of a filed return: Dr control / Cr bank when
 * paying the FTA, Dr bank / Cr control when a refund is received. Serialised on
 * the filing row so two concurrent payments can never settle the same fils twice;
 * a fully settled return answers 409 ALREADY_SETTLED.
 */
export async function recordFilingPayment(args: {
  user: FilingActor;
  companyId: string;
  filing: TaxFiling;
  input: PaymentInput;
  control: PaymentControlAccount;
  /** Called inside the transaction to mirror payment state on the return row (legacy columns). */
  onSettled?: (tx: Tx, view: SettlementView, paidAtYmd: string) => Promise<void>;
  req?: Request;
}) {
  await assertFilingPermission(args.user, args.companyId, "write");
  const { filing, input } = args;

  const amount = typeof input.amount === "number" ? input.amount : Number(input.amount);
  if (!Number.isFinite(amount) || toFils(amount) <= 0) {
    throw new AppError({ message: "The payment amount must be greater than zero.", statusCode: 400, code: "AMOUNT_INVALID" });
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    throw new AppError({ message: "The payment amount can have at most 2 decimals.", statusCode: 400, code: "AMOUNT_INVALID" });
  }
  const bank = await resolvePaymentAccount(args.companyId, input.accountId);
  // Validates the date (not future, real day) and refuses a locked period.
  const settle = await resolveSettlementDate(args.companyId, {
    requested: typeof input.date === "string" ? input.date : null,
  });
  const reference =
    typeof input.reference === "string" && input.reference.trim() ? input.reference.trim().slice(0, 100) : null;

  const result = await db.transaction(async (tx: Tx) => {
    // Serialise payments per filing.
    const locked = await tx.execute(sql`SELECT id, settlement_net FROM tax_filings WHERE id = ${filing.id} FOR UPDATE`);
    const lockedRow = ((locked as any).rows ?? locked)[0];
    if (!lockedRow) throw new AppError({ message: "Filing not found", statusCode: 404, code: "FILING_NOT_FOUND" });
    const net = Number(lockedRow.settlement_net);

    const existing = await tx
      .select({ amount: taxFilingPayments.amount })
      .from(taxFilingPayments)
      .where(eq(taxFilingPayments.filingId, filing.id));
    const paidBefore = existing.map((p: { amount: number }) => p.amount);
    const rem = remainingToSettle(net, paidBefore);
    if (rem.direction === "none") {
      throw new AppError({ message: "This return has a nil balance: there is nothing to pay or receive.", statusCode: 409, code: "ALREADY_SETTLED" });
    }
    if (rem.remaining === 0) {
      throw new AppError({ message: "This return is already fully settled.", statusCode: 409, code: "ALREADY_SETTLED" });
    }
    if (toFils(amount) > toFils(rem.remaining)) {
      throw new AppError({
        message: `The payment (${round2(amount).toFixed(2)}) is more than the ${rem.remaining.toFixed(2)} still ${rem.direction === "pay" ? "owed" : "to be received"}.`,
        statusCode: 422,
        code: "PAYMENT_EXCEEDS_BALANCE",
        details: { remaining: rem.remaining },
      });
    }

    const control = await args.control.resolve(tx, args.companyId);
    const lines = buildSettlementPaymentLines({
      direction: rem.direction,
      amount,
      bankId: bank.id,
      controlId: control.id,
      label: args.control.label,
    });
    const entryId = await postSettlementJournal(tx, {
      companyId: args.companyId,
      ymd: settle.ymd,
      memo: `${args.control.label} ${rem.direction === "pay" ? "payment to" : "refund from"} FTA${reference ? ` (${reference})` : ""}`,
      source: args.control.journalSource,
      sourceId: filing.returnId,
      userId: args.user.id,
      lines,
    });

    const [payment] = await tx
      .insert(taxFilingPayments)
      .values({
        companyId: args.companyId,
        filingId: filing.id,
        amount: round2(amount),
        paidAt: settle.ymd,
        accountId: bank.id,
        reference,
        journalEntryId: entryId,
        createdBy: args.user.id,
      })
      .returning();

    const view = buildSettlementView(net, [...paidBefore, payment.amount]);
    if (args.onSettled) await args.onSettled(tx, view, settle.ymd);
    return { payment, view, entryId };
  });

  await recordAudit({
    userId: args.user.id,
    companyId: args.companyId,
    action: "tax_filing.payment",
    entityType: "tax_filing",
    entityId: filing.id,
    after: { paymentId: result.payment.id, amount: result.payment.amount, journalEntryId: result.entryId, status: result.view.status },
    req: args.req,
  });
  return result;
}

// ─── Combined read model ─────────────────────────────────────────────────────

export interface FilingViewBase {
  filed: boolean;
  filing: null | {
    /** Created from the stored figures of a return filed before filing records existed. */
    legacy: boolean;
    id: string;
    referenceNumber: string;
    filedAt: string;
    notes: string | null;
    snapshotHash: string;
    filedBy: string | null;
    createdAt: Date;
    baseFilingId: string | null;
    clearingEntryId: string | null;
    settlement: { output: number; input: number; net: number };
  };
  evidence: Awaited<ReturnType<typeof listEvidence>>;
  payments: Awaited<ReturnType<typeof listPayments>>;
  settlement: SettlementView | null;
  driftDetected: boolean;
  driftDifferences: BoxDifference[];
  /** "ok" | "unavailable" (live figures could not be computed) | "not_applicable" */
  driftCheck: "ok" | "unavailable" | "not_applicable";
  driftMessage?: string;
}

export async function buildFilingViewBase(
  filing: TaxFiling | null,
  drift: { detected: boolean; differences: BoxDifference[]; check: FilingViewBase["driftCheck"]; message?: string }
): Promise<FilingViewBase> {
  if (!filing) {
    return {
      filed: false, filing: null, evidence: [], payments: [], settlement: null,
      driftDetected: false, driftDifferences: [], driftCheck: "not_applicable",
    };
  }
  const [evidence, payments] = await Promise.all([listEvidence(filing.id), listPayments(filing.id)]);
  return {
    filed: true,
    filing: {
      legacy: (filing.snapshot as { legacy?: boolean } | null)?.legacy === true,
      id: filing.id,
      referenceNumber: filing.referenceNumber,
      filedAt: String(filing.filedAt).slice(0, 10),
      notes: filing.notes,
      snapshotHash: filing.snapshotHash,
      filedBy: filing.filedBy,
      createdAt: filing.createdAt,
      baseFilingId: filing.baseFilingId,
      clearingEntryId: filing.clearingEntryId,
      settlement: {
        output: filing.settlementOutput,
        input: filing.settlementInput,
        net: filing.settlementNet,
      },
    },
    evidence,
    payments,
    settlement: buildSettlementView(filing.settlementNet, payments.map((p: { amount: number }) => p.amount)),
    driftDetected: drift.detected,
    driftDifferences: drift.differences,
    driftCheck: drift.check,
    ...(drift.message ? { driftMessage: drift.message } : {}),
  };
}

