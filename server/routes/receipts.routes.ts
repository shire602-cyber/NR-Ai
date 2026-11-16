import { type Express, type Request, type Response } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { filsToNumber, mulRate, sumFils, toFils } from "../../shared/money";
import {
  createReceiptBody,
  postReceiptBody,
  receiptDateToDate,
  reviseReceiptBody,
  splitReceiptBody,
  updateReceiptBody,
  type CreateReceiptBody,
  type PostReceiptBody,
  type ReceiptLineInput,
  type ReviseReceiptBody,
  type SplitReceiptBody,
  type UpdateReceiptBody,
} from "../../shared/validators/receipts";
import { postReceipt, reviseReceipt } from "../services/receipt-posting.service";
import { resolve } from "../platform/service-registry";
import type { FxGetRate } from "../services/fx";
import { zSupplyType } from "../../shared/validators/primitives";
import { type Receipt } from "../../shared/schema";
import {
  saveReceiptFile,
  deleteReceiptImage,
  readReceiptImage,
  assertStorageBootSafe,
  assertWithinStorageQuota,
  companyStorageQuotaBytes,
  getCompanyStorageUsage,
} from "../services/fileStorage";
import {
  inspectUpload,
  UploadRejectedError,
  getUploadScanStatus,
  generateThumbnail,
  extForMime,
  sniffFileType,
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
} from "../services/upload-guard";
import {
  checkSimilar,
  findFuzzyDuplicatesInDb,
  findReceiptByContentHash,
} from "../services/receipt-duplicates";
import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import { createAndEmitNotification } from "../services/socket.service";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import {
  recordClassificationFeedback,
  autoPostManualReceipt,
} from "../services/receipt-autopilot.service";
import { evaluateClassificationFeedback } from "../services/classification-feedback.util";
import { createLogger } from "../config/logger";
import { assertRetentionExpired } from "../services/retention.service";
import {
  buildOcrReceiptsWorkbook,
  buildExportFilename,
  receiptToExportRow,
} from "../services/excel-export.service";
// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";

const log = createLogger("receipts");

// Walk the user's companies and return the first match — storage.getReceipt is
// tenant-scoped, so a hit here also proves the user has access.
async function findReceiptForUser(userId: string, receiptId: string): Promise<Receipt | undefined> {
  // Resolve then authorise (covers firm owners/admins, not just members).
  const receipt = await storage.getReceiptById(receiptId);
  if (!receipt) return undefined;
  const hasAccess = await storage.hasCompanyAccess(userId, receipt.companyId);
  return hasAccess ? receipt : undefined;
}

/** VAT + FX derived columns shared by create / update / revise. */
function baseCurrencyAmountOf(amount: number, vat: number, rate: number): number {
  const total = toFils(amount) + toFils(vat);
  return filsToNumber(rate === 1 ? total : mulRate(total, rate));
}

/** Accounts referenced by a receipt write must belong to the receipt's company. */
async function assertReceiptAccounts(
  companyId: string,
  refs: {
    accountId?: string | null;
    paymentAccountId?: string | null;
    lines?: ReceiptLineInput[] | null;
  }
): Promise<void> {
  const ids = new Set<string>();
  if (refs.accountId) ids.add(refs.accountId);
  if (refs.paymentAccountId) ids.add(refs.paymentAccountId);
  for (const l of refs.lines ?? []) ids.add(l.accountId);
  if (ids.size === 0) return;
  const owned = new Set((await storage.getAccountsByCompanyId(companyId)).map((a) => a.id));
  for (const id of ids) {
    if (!owned.has(id)) {
      throw new DomainError("ACCOUNT_NOT_FOUND", 404, { accountId: id }, "Account not found");
    }
  }
}

/** Sum split lines into receipt-level amount / VAT (integer fils, then back to major units). */
function totalsOfLines(lines: ReceiptLineInput[]): { amount: number; vatAmount: number } {
  return {
    amount: filsToNumber(sumFils(lines.map((l) => toFils(l.amount)))),
    vatAmount: filsToNumber(sumFils(lines.map((l) => toFils(l.vatAmount ?? 0)))),
  };
}

function validateSupplierTrn(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const trn = validateUaeTrn(trimmed);
  if (!trn.valid) {
    throw new DomainError(
      "INVALID_TRN",
      400,
      undefined,
      trn.issue || "Supplier TRN must be a 15-digit UAE TRN"
    );
  }
  return trn.trn;
}

export function registerReceiptRoutes(app: Express) {
  // Production must not run on ephemeral local-disk storage unless explicitly allowed (R05-07).
  assertStorageBootSafe();

  // =====================================
  // Receipt Routes
  // =====================================

  // Customer-only: Full receipts/expenses access
  app.get(
    "/api/companies/:companyId/receipts",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const receipts = await storage.getReceiptsByCompanyId(companyId);
      res.json(receipts);
    })
  );

  // Bulk Excel export for saved receipts. Optional `ids` filters down to a
  // specific subset (e.g. user selected rows in the UI). All filtering happens
  // server-side after a tenant scope check so cross-company leaks are
  // impossible.
  app.post(
    "/api/companies/:companyId/receipts/export-excel",
    authMiddleware,
    requireCustomer,
    validate({ body: receiptsExportSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { ids } = req.body as z.infer<typeof receiptsExportSchema>;
      const all = await storage.getReceiptsByCompanyId(companyId);
      const subset = ids && ids.length > 0 ? all.filter((r) => ids.includes(r.id)) : all;

      const rows = subset.map((r) =>
        receiptToExportRow({
          date: r.date,
          merchant: r.merchant,
          // receipts table doesn't store invoiceNumber; export it as blank.
          invoiceNumber: null,
          amount: r.amount as unknown as number,
          vatAmount: r.vatAmount as unknown as number,
          currency: r.currency,
        })
      );

      const buffer = await buildOcrReceiptsWorkbook(rows, {
        sheetName: "Receipts",
        title: "Muhasib Receipts Export",
      });
      const filename = buildExportFilename("muhasib-receipts");

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Cache-Control", "no-store");
      res.send(buffer);
    })
  );

  // Upload policy: limits, accepted types, antivirus status and storage quota (R05-07, R05-20)
  app.get(
    "/api/companies/:companyId/receipts/upload-policy",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      let usedBytes: number | null = null;
      try {
        usedBytes = await getCompanyStorageUsage(companyId);
      } catch {
        usedBytes = null;
      }
      res.json({
        maxFileBytes: MAX_UPLOAD_BYTES,
        allowedTypes: ALLOWED_UPLOAD_MIME,
        virusScan: getUploadScanStatus(), // "enabled" | "requires_external"
        storage: { usedBytes, quotaBytes: companyStorageQuotaBytes() },
      });
    })
  );

  // Check for similar transactions
  // Customer-only: Check for similar receipts/transactions
  app.post(
    "/api/companies/:companyId/receipts/check-similar",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { merchant, amount, date } = req.body ?? {};

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // merchant is optional (R05-18): similarity then relies on amount and date alone.
      const probe = {
        merchant: typeof merchant === "string" ? merchant : null,
        amount: Number(amount) || 0,
        date: typeof date === "string" || date instanceof Date ? date : null,
      };

      const receipts = await storage.getReceiptsByCompanyId(companyId);
      const similarTransactions = checkSimilar(probe, receipts);

      res.json({
        hasSimilar: similarTransactions.length > 0,
        similarTransactions: similarTransactions.slice(0, 5).map((receipt) => ({
          id: receipt.id,
          merchant: receipt.merchant,
          amount: receipt.amount,
          date: receipt.date,
          category: receipt.category,
        })),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/receipts",
    authMiddleware,
    requireCustomer,
    strictBody(createReceiptBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const body = parsedBody<CreateReceiptBody>(req);
      const {
        imageData,
        suggestedCategory,
        classifierMethod,
        classifierConfidence,
        classifierReason,
        confirmDuplicate,
      } = body;

      // Split lines define the totals; otherwise amount is required (enforced by the schema).
      const split = body.lines && body.lines.length > 0 ? body.lines : null;
      const derived = split ? totalsOfLines(split) : null;
      const amount = derived ? derived.amount : (body.amount as number);
      const vatAmount = derived ? derived.vatAmount : (body.vatAmount ?? 0);
      if (vatAmount > amount) {
        throw new DomainError("VALIDATION_ERROR", 400, undefined, "VAT cannot exceed the amount");
      }
      const currency = body.currency ?? "AED";
      const exchangeRate = body.exchangeRate ?? 1;
      await assertReceiptAccounts(companyId, {
        accountId: body.accountId,
        paymentAccountId: body.paymentAccountId,
        lines: split,
      });

      const receiptData: {
        merchant: string | null;
        date: Date;
        amount: number;
        vatAmount: number;
        currency: string;
        exchangeRate: number;
        baseCurrencyAmount: number;
        category: string | null;
        accountId: string | null;
        paymentAccountId: string | null;
        reverseCharge: boolean;
        rawText: string | null;
        supplierTrn: string | null | undefined;
        lines: ReceiptLineInput[] | null;
      } = {
        merchant: body.merchant ?? null,
        date: receiptDateToDate(body.date),
        amount,
        vatAmount,
        currency,
        exchangeRate,
        baseCurrencyAmount: baseCurrencyAmountOf(amount, vatAmount, exchangeRate),
        category: body.category ?? null,
        accountId: body.accountId ?? null,
        paymentAccountId: body.paymentAccountId ?? null,
        reverseCharge: body.reverseCharge ?? false,
        rawText: body.rawText ?? null,
        supplierTrn: body.supplierTrn,
        lines: split,
      };

      // Block receipt creation in a locked period — receipts are eventually
      // posted as journal entries dated on receipt.date.
      await assertPeriodNotLocked(companyId, receiptData.date);

      log.info(
        {
          companyId,
          userId,
          merchant: receiptData.merchant,
          amount: receiptData.amount,
          hasImageData: !!imageData,
          imageDataLength: imageData?.length,
        },
        "Creating receipt"
      );

      // Validate the upload from its BYTES (magic-byte sniff, size/dimension caps, EXIF strip,
      // optional antivirus) and store it with its true type; only the path goes to Postgres.
      let imagePath: string | undefined;
      let fileMeta: { contentSha256: string; fileMime: string; fileSize: number } | null = null;
      let duplicateWarnings: unknown[] = [];

      try {
        receiptData.supplierTrn = validateSupplierTrn(receiptData.supplierTrn);
      } catch (err) {
        if (err instanceof DomainError && err.code === "INVALID_TRN") {
          return res.status(400).json({ message: err.message, code: "INVALID_TRN" });
        }
        throw err;
      }

      if (imageData) {
        if (typeof imageData !== "string") {
          return res.status(400).json({ message: "Invalid image data", code: "UNSUPPORTED_FILE" });
        }
        let inspected;
        try {
          inspected = await inspectUpload(imageData);
          await assertWithinStorageQuota(companyId, inspected.size);
        } catch (err) {
          if (err instanceof UploadRejectedError) {
            return res.status(err.status).json({ message: err.message, code: err.code });
          }
          throw err;
        }

        // Exact duplicate (same stored content) -> 409 with the matching receipt.
        if (!confirmDuplicate) {
          const exact = await findReceiptByContentHash(companyId, inspected.sha256);
          if (exact) {
            return res.status(409).json({
              message: "This file has already been uploaded",
              code: "DUPLICATE_RECEIPT",
              duplicateOf: {
                id: exact.id,
                merchant: exact.merchant,
                amount: exact.amount,
                date: exact.date,
              },
            });
          }
        }

        imagePath = await saveReceiptFile(inspected.buffer, {
          mime: inspected.mime,
          ext: inspected.ext,
        });
        fileMeta = {
          contentSha256: inspected.sha256,
          fileMime: inspected.mime,
          fileSize: inspected.size,
        };
      }

      // Fuzzy duplicate (similar merchant + same amount + nearby date) -> warning only.
      if (receiptData.merchant && receiptData.date instanceof Date) {
        try {
          duplicateWarnings = await findFuzzyDuplicatesInDb(companyId, {
            merchant: receiptData.merchant,
            amount: Number(receiptData.amount) || 0,
            vatAmount: Number(receiptData.vatAmount) || 0,
            date: receiptData.date,
          });
        } catch (err) {
          log.warn({ err: (err as Error).message }, "Fuzzy duplicate check failed (non-fatal)");
        }
      }

      const receipt = await storage.createReceipt({
        ...receiptData,
        supplierTrn: receiptData.supplierTrn ?? null,
        companyId,
        uploadedBy: userId,
        imagePath: imagePath ?? null,
        ...(fileMeta ?? {}),
        // imageData intentionally omitted — not stored in Postgres
      });

      log.info({ receiptId: receipt.id }, "Receipt created successfully");

      await recordAudit({
        userId,
        companyId,
        action: "receipt.create",
        entityType: "receipt",
        entityId: receipt.id,
        before: null,
        after: { merchant: receipt.merchant, amount: receipt.amount, currency: receipt.currency },
        req,
      });

      // Learning loop: record the AI's suggested category against the user's
      // final category so the per-tenant classifier learns from manual uploads.
      // This is non-fatal and must never block saving the receipt.
      let userKeptSuggestion = false;
      if (suggestedCategory && typeof suggestedCategory === "string") {
        try {
          const gross = (Number(receipt.amount) || 0) + (Number(receipt.vatAmount) || 0);
          const { wasAccepted, method } = evaluateClassificationFeedback(
            suggestedCategory,
            receipt.category,
            classifierMethod
          );
          userKeptSuggestion = wasAccepted;
          const classificationRow = await storage.createTransactionClassification({
            companyId,
            description: receipt.merchant ?? "",
            merchant: receipt.merchant ?? "",
            amount: gross,
            suggestedAccountId: receipt.accountId ?? null,
            suggestedCategory,
            aiConfidence: Number(classifierConfidence) || 0,
            aiReason:
              typeof classifierReason === "string" && classifierReason
                ? classifierReason
                : "Manual receipt upload",
            classifierMethod: method,
          });
          await recordClassificationFeedback(
            companyId,
            classificationRow.id,
            wasAccepted,
            receipt.accountId ?? null,
            receipt.supplierTrn ?? null
          );
        } catch (err) {
          log.warn(
            { err: (err as Error).message, receiptId: receipt.id },
            "Classification feedback recording failed (non-fatal)"
          );
        }
      }

      // Guarded auto-post: only companies that explicitly enabled autopilot can
      // auto-post, and only if the user kept the AI category. Non-fatal by design.
      try {
        const auto = await autoPostManualReceipt({
          companyId,
          uploadedBy: userId,
          receipt: {
            id: receipt.id,
            merchant: receipt.merchant,
            amount: receipt.amount,
            vatAmount: receipt.vatAmount,
            currency: receipt.currency,
            date: receipt.date,
          },
          userKeptSuggestion,
        });
        if (auto.autoPosted) {
          receipt.posted = true;
          receipt.autoPosted = true;
          receipt.journalEntryId = auto.journalEntryId;
          log.info(
            { receiptId: receipt.id, journalEntryId: auto.journalEntryId },
            "Receipt auto-posted on manual upload"
          );
        }
      } catch (err) {
        log.warn(
          { err: (err as Error).message, receiptId: receipt.id },
          "Manual auto-post attempt failed (non-fatal - receipt saved)"
        );
      }

      createAndEmitNotification({
        userId,
        companyId,
        type: "document_uploaded",
        title: "Receipt uploaded",
        message:
          `New receipt from ${receipt.merchant || "unknown merchant"} for ${receipt.amount ?? ""} ${receipt.currency || ""}`.trim(),
        priority: "normal",
        relatedEntityType: "receipt",
        relatedEntityId: receipt.id,
        actionUrl: "/receipts",
      }).catch(() => {});

      res.json(duplicateWarnings.length > 0 ? { ...receipt, duplicateWarnings } : receipt);
    })
  );

  // Record the human decision on an AI-extracted receipt for audit (R05-23).
  app.post(
    "/api/companies/:companyId/receipts/:id/review-decision",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = req.user!.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const parsed = z
        .object({
          decision: z.enum(["accepted", "corrected", "rejected"]),
          band: z.enum(["high", "review", "low"]),
          note: z.string().max(500).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid review decision", code: "VALIDATION_ERROR" });
      }
      const receipt = await storage.getReceipt(id, companyId);
      if (!receipt) return res.status(404).json({ message: "Receipt not found" });

      await recordAudit({
        userId,
        companyId,
        action: "receipt.ai_review",
        entityType: "receipt",
        entityId: id,
        before: null,
        after: {
          reviewerId: userId,
          decision: parsed.data.decision,
          confidenceBand: parsed.data.band,
          note: parsed.data.note ?? null,
        },
        req,
      });
      res.json({ ok: true, reviewerId: userId, ...parsed.data });
    })
  );

  /**
   * Resolve an update/revise body into receipt columns plus the merged (after) values, enforcing
   * the cross-field rules against what is already stored (VAT <= amount, split totals).
   */
  async function resolveReceiptPatch(
    before: Receipt,
    body: UpdateReceiptBody | ReviseReceiptBody
  ): Promise<{ patch: Partial<Receipt>; merged: Receipt }> {
    const patch: Partial<Receipt> = {};
    const split = body.lines === undefined ? undefined : body.lines;
    if (split !== undefined) patch.lines = split && split.length > 0 ? split : null;

    let amount = body.amount ?? before.amount ?? 0;
    let vatAmount = body.vatAmount === undefined ? (before.vatAmount ?? 0) : (body.vatAmount ?? 0);
    if (split && split.length > 0) {
      const totals = totalsOfLines(split);
      if (body.amount !== undefined && toFils(body.amount) !== toFils(totals.amount)) {
        throw new DomainError(
          "RECEIPT_LINES_MISMATCH",
          400,
          undefined,
          "Lines must add up to amount"
        );
      }
      amount = totals.amount;
      vatAmount = totals.vatAmount;
    } else if (split === undefined && Array.isArray(before.lines) && before.lines.length > 0) {
      if (body.amount !== undefined || body.vatAmount !== undefined) {
        throw new DomainError(
          "RECEIPT_LINES_MISMATCH",
          400,
          undefined,
          "This receipt is split across accounts: send the updated lines to change its amount"
        );
      }
    }
    if (toFils(vatAmount) > toFils(amount)) {
      throw new DomainError("VALIDATION_ERROR", 400, undefined, "VAT cannot exceed the amount");
    }
    if (toFils(amount) <= 0) {
      throw new DomainError("VALIDATION_ERROR", 400, undefined, "Amount must be greater than zero");
    }

    if (body.merchant !== undefined) patch.merchant = body.merchant ?? null;
    if (body.date !== undefined) patch.date = receiptDateToDate(body.date);
    if (body.category !== undefined) patch.category = body.category ?? null;
    if (body.accountId !== undefined) patch.accountId = body.accountId ?? null;
    if (body.paymentAccountId !== undefined) patch.paymentAccountId = body.paymentAccountId ?? null;
    if (body.reverseCharge !== undefined) patch.reverseCharge = body.reverseCharge;
    if (body.currency !== undefined) patch.currency = body.currency;
    if (body.exchangeRate !== undefined) patch.exchangeRate = body.exchangeRate;
    if ("supplierTrn" in body && body.supplierTrn !== undefined) {
      patch.supplierTrn = validateSupplierTrn(body.supplierTrn) ?? null;
    }
    if (
      body.amount !== undefined ||
      body.vatAmount !== undefined ||
      (split && split.length > 0) ||
      body.exchangeRate !== undefined
    ) {
      patch.amount = amount;
      patch.vatAmount = vatAmount;
    }
    const rate = Number(patch.exchangeRate ?? before.exchangeRate) || 1;
    patch.baseCurrencyAmount = baseCurrencyAmountOf(amount, vatAmount, rate);

    await assertReceiptAccounts(before.companyId, {
      accountId: patch.accountId,
      paymentAccountId: patch.paymentAccountId,
      lines: split && split.length > 0 ? split : null,
    });
    return { patch, merged: { ...before, ...patch } as Receipt };
  }

  // Customer-only: Update an UNPOSTED receipt. Posted receipts are immutable (R05-01):
  // use POST /api/receipts/:id/revise, which reverses and re-posts.
  app.put(
    "/api/receipts/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateReceiptBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      const body = parsedBody<UpdateReceiptBody>(req);

      const before = await findReceiptForUser(userId, id);
      if (!before) {
        return res.status(404).json({ message: "Receipt not found" });
      }
      if (before.posted) {
        throw new DomainError(
          "RECEIPT_POSTED",
          409,
          { receiptId: id, journalEntryId: before.journalEntryId },
          "This receipt is posted and cannot be edited. Use POST /api/receipts/:id/revise."
        );
      }

      const { patch } = await resolveReceiptPatch(before, body);
      // Receipts become journal entries dated on receipt.date: respect closed periods for both
      // the stored date and the new one.
      if (before.date) await assertPeriodNotLocked(before.companyId, before.date);
      if (patch.date) await assertPeriodNotLocked(before.companyId, patch.date as Date);

      const updatedReceipt = await storage.updateReceiptIfUnposted(id, before.companyId, patch);
      await recordAudit({
        userId,
        companyId: updatedReceipt.companyId,
        action: "receipt.update",
        entityType: "receipt",
        entityId: id,
        before: { merchant: before.merchant, amount: before.amount, accountId: before.accountId },
        after: {
          merchant: updatedReceipt.merchant,
          amount: updatedReceipt.amount,
          accountId: updatedReceipt.accountId,
        },
        req,
      });
      log.info({ id }, "Receipt updated successfully");
      res.json(updatedReceipt);
    })
  );

  // Customer-only: Revise a POSTED receipt. Reverses the original journal entry and posts the
  // corrected one in one transaction; the pair nets the books to the new amount.
  app.post(
    "/api/receipts/:id/revise",
    authMiddleware,
    requireCustomer,
    strictBody(reviseReceiptBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      const { reason, ...fields } = req.body as ReviseReceiptBody;

      const before = await findReceiptForUser(userId, id);
      if (!before) {
        return res.status(404).json({ message: "Receipt not found" });
      }
      if (!before.posted) {
        throw new DomainError(
          "RECEIPT_NOT_POSTED",
          409,
          { receiptId: id },
          "Only a posted receipt can be revised. Edit unposted receipts with PUT."
        );
      }
      const { patch, merged } = await resolveReceiptPatch(before, fields);
      const result = await reviseReceipt(before, userId, merged, patch, reason ?? null);

      await recordAudit({
        userId,
        companyId: before.companyId,
        action: "receipt.revise",
        entityType: "receipt",
        entityId: id,
        before: {
          amount: before.amount,
          vatAmount: before.vatAmount,
          journalEntryId: before.journalEntryId,
        },
        after: {
          amount: result.receipt.amount,
          vatAmount: result.receipt.vatAmount,
          journalEntryId: result.entry.id,
          reversalEntryId: result.reversal.id,
        },
        req,
        extra: { reason: reason ?? null },
      });
      res.json({
        ...result.receipt,
        revision: { reversalEntryId: result.reversal.id, journalEntryId: result.entry.id },
      });
    })
  );

  // Customer-only: Split an unposted multi-receipt upload into separate receipts.
  app.post(
    "/api/receipts/:id/split",
    authMiddleware,
    requireCustomer,
    strictBody(splitReceiptBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      const { parts } = req.body as SplitReceiptBody;

      const source = await findReceiptForUser(userId, id);
      if (!source) {
        return res.status(404).json({ message: "Receipt not found" });
      }
      for (const part of parts) {
        if (part.date) await assertPeriodNotLocked(source.companyId, receiptDateToDate(part.date));
      }
      const created = await storage.splitReceiptAtomic({
        receiptId: id,
        companyId: source.companyId,
        parts: parts.map((part) => {
          const amount = part.amount;
          const vat = part.vatAmount ?? 0;
          const rate = Number(source.exchangeRate) || 1;
          return {
            merchant: part.merchant ?? source.merchant,
            date: part.date ? receiptDateToDate(part.date) : source.date,
            amount,
            vatAmount: vat,
            category: part.category ?? source.category,
            baseCurrencyAmount: baseCurrencyAmountOf(amount, vat, rate),
          };
        }),
      });
      await recordAudit({
        userId,
        companyId: source.companyId,
        action: "receipt.split",
        entityType: "receipt",
        entityId: id,
        before: { amount: source.amount, merchant: source.merchant },
        after: null,
        req,
        extra: { newReceiptIds: created.map((r) => r.id) },
      });
      res.status(201).json({ receipts: created });
    })
  );

  // Customer-only: Delete receipt
  app.delete(
    "/api/receipts/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;

      // Remove image file before deleting DB row (best-effort; don't block on failure)
      const existing = await findReceiptForUser(userId, id);
      if (!existing) {
        return res.status(404).json({ message: "Receipt not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (existing.posted) {
        throw new DomainError(
          "RECEIPT_POSTED",
          409,
          { receiptId: id, journalEntryId: existing.journalEntryId },
          "A posted receipt cannot be deleted. Revise it or reverse its journal entry."
        );
      }
      // FTA 5-year retention.
      assertRetentionExpired(
        existing as { createdAt: Date | string; retentionExpiresAt?: Date | string | null },
        "Receipt"
      );

      if (existing.imagePath) {
        await deleteReceiptImage(existing.imagePath);
      }

      await storage.deleteReceipt(id, existing.companyId);

      await recordAudit({
        userId,
        companyId: existing.companyId,
        action: "receipt.delete",
        entityType: "receipt",
        entityId: id,
        before: { merchant: existing.merchant, amount: existing.amount },
        after: null,
        req,
      });

      res.json({ message: "Receipt deleted successfully" });
    })
  );

  // Customer-only: Post receipt to journal entry (once: the claim is a conditional UPDATE).
  // W4-E (R05-28): the post body may name the purchase's supply type (receipt-level or per split
  // line). Blocked / partly recoverable input VAT is applied by receipt-posting.service.
  const postReceiptVatBody = postReceiptBody
    .extend({
      vatSupplyType: zSupplyType.optional().nullable(),
      lineSupplyTypes: z.array(zSupplyType.nullable()).max(50).optional().nullable(),
    })
    .strict();
  type PostReceiptVatBody = PostReceiptBody & z.output<typeof postReceiptVatBody>;

  app.post(
    "/api/receipts/:id/post",
    authMiddleware,
    requireCustomer,
    strictBody(postReceiptVatBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      const body = parsedBody<PostReceiptVatBody>(req);

      // Get receipt — findReceiptForUser also enforces tenant access.
      let receipt = await findReceiptForUser(userId, id);
      if (!receipt) {
        return res.status(404).json({ message: "Receipt not found" });
      }
      const hasLines = Array.isArray(receipt.lines) && receipt.lines.length > 0;
      if (!hasLines && !body.accountId) {
        return res
          .status(400)
          .json({ message: "Expense account and payment account are required" });
      }

      // W4-E: a foreign-currency receipt with no stated rate (stored default 1) takes the
      // company's rate for the receipt date from fx.getRate (company row, then system row).
      const currency = (receipt.currency || "AED").toUpperCase();
      const storedRate = Number(receipt.exchangeRate);
      if (currency !== "AED" && !receipt.posted && (!(storedRate > 0) || storedRate === 1)) {
        const getRate = resolve<FxGetRate>("fx.getRate");
        const dateIso = new Date(receipt.date ?? receipt.createdAt).toISOString().slice(0, 10);
        const fx = await getRate(receipt.companyId, currency, "AED", dateIso);
        receipt = await storage.updateReceipt(receipt.id, receipt.companyId, {
          exchangeRate: fx.rate,
          baseCurrencyAmount: baseCurrencyAmountOf(
            Number(receipt.amount ?? 0),
            Number(receipt.vatAmount ?? 0),
            fx.rate
          ),
        });
      }

      const result = await postReceipt(receipt, userId, {
        accountId: body.accountId ?? null,
        paymentAccountId: body.paymentAccountId,
        vat: {
          vatSupplyType: body.vatSupplyType ?? null,
          lineSupplyTypes: body.lineSupplyTypes ?? null,
        },
      });
      log.info({ id, journalEntryId: result.entryId }, "Receipt posted successfully");
      res.json(result.receipt);
    })
  );

  // Customer-only: Batch export receipts as multi-page PDF
  app.get(
    "/api/companies/:companyId/receipts/export-pdf",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { from, to, category } = req.query as { from?: string; to?: string; category?: string };
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      let receipts = await storage.getReceiptsByCompanyId(companyId);

      if (from) {
        const fromDate = new Date(from);
        receipts = receipts.filter((r) => r.date && new Date(r.date) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        receipts = receipts.filter((r) => r.date && new Date(r.date) <= toDate);
      }
      if (category && category !== "all") {
        receipts = receipts.filter((r) => r.category === category);
      }

      if (!receipts.length) {
        return res.status(404).json({ message: "No receipts found for the given filters" });
      }

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: false });
        const chunks: Buffer[] = [];
        doc.on("data", (c: Buffer) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const pageWidth = 595.28;
        const margin = 50;
        const contentWidth = pageWidth - 2 * margin;
        const labelColor = "#6B7280";
        const valueColor = "#111827";

        // Summary page
        doc.addPage();
        doc.rect(0, 0, pageWidth, 80).fill("#1E40AF");
        doc.fontSize(20).fillColor("#FFFFFF").font("Helvetica-Bold");
        doc.text(company.name, margin, 20, { width: contentWidth });
        doc.fontSize(12).font("Helvetica");
        doc.text("EXPENSE RECEIPTS EXPORT", margin, 48, { width: contentWidth });

        let sy = 100;
        // receipts.amount stores the net subtotal (VAT excluded); the receipt
        // total displayed to the user is amount + vatAmount.
        const totalSubtotal = receipts.reduce((sum, r) => sum + (r.amount ?? 0), 0);
        const totalVat = receipts.reduce((sum, r) => sum + (r.vatAmount ?? 0), 0);
        const totalAmount = totalSubtotal + totalVat;
        const dateRangeStr =
          from && to ? `${from} to ${to}` : from ? `From ${from}` : to ? `To ${to}` : "All time";

        doc
          .fontSize(11)
          .fillColor(labelColor)
          .font("Helvetica-Bold")
          .text("Export Summary", margin, sy);
        sy += 20;
        doc
          .moveTo(margin, sy)
          .lineTo(margin + contentWidth, sy)
          .stroke("#E5E7EB");
        sy += 14;

        const summaryRow = (label: string, value: string) => {
          doc
            .fontSize(10)
            .fillColor(labelColor)
            .font("Helvetica")
            .text(label, margin, sy, { width: 200 });
          doc
            .fontSize(10)
            .fillColor(valueColor)
            .font("Helvetica-Bold")
            .text(value, margin + 200, sy, { width: contentWidth - 200 });
          sy += 18;
        };

        summaryRow("Date Range:", dateRangeStr);
        if (category && category !== "all") summaryRow("Category:", category);
        summaryRow("Total Receipts:", receipts.length.toString());
        summaryRow("Total Amount:", `AED ${totalAmount.toFixed(2)}`);
        if (totalVat > 0) summaryRow("Total VAT:", `AED ${totalVat.toFixed(2)}`);

        sy += 20;
        // Summary table header
        doc.rect(margin, sy, contentWidth, 24).fill("#F3F4F6");
        doc.fontSize(9).fillColor("#374151").font("Helvetica-Bold");
        doc.text("#", margin + 4, sy + 7, { width: 24 });
        doc.text("Date", margin + 30, sy + 7, { width: 70 });
        doc.text("Merchant", margin + 105, sy + 7, { width: 160 });
        doc.text("Category", margin + 270, sy + 7, { width: 110 });
        doc.text("Amount", margin + 385, sy + 7, { width: contentWidth - 385, align: "right" });
        sy += 26;

        receipts.forEach((r, idx) => {
          if (sy > 750) {
            doc.addPage();
            sy = margin;
          }
          if (idx % 2 === 1) doc.rect(margin, sy - 2, contentWidth, 18).fill("#F9FAFB");
          doc.fontSize(8).fillColor(valueColor).font("Helvetica");
          doc.text((idx + 1).toString(), margin + 4, sy, { width: 24 });
          doc.text(r.date ? new Date(r.date).toLocaleDateString("en-AE") : "-", margin + 30, sy, {
            width: 70,
          });
          doc.text(r.merchant || "Unknown", margin + 105, sy, { width: 160 });
          doc.text(r.category || "Uncategorized", margin + 270, sy, { width: 110 });
          const rowTotal = (r.amount ?? 0) + (r.vatAmount ?? 0);
          doc.text(`${r.currency || "AED"} ${rowTotal.toFixed(2)}`, margin + 385, sy, {
            width: contentWidth - 385,
            align: "right",
          });
          sy += 16;
        });

        // Total row
        sy += 4;
        doc
          .moveTo(margin, sy)
          .lineTo(margin + contentWidth, sy)
          .stroke("#E5E7EB");
        sy += 8;
        doc.fontSize(9).fillColor("#1E40AF").font("Helvetica-Bold");
        doc.text("TOTAL", margin + 270, sy, { width: 110 });
        doc.text(`AED ${totalAmount.toFixed(2)}`, margin + 385, sy, {
          width: contentWidth - 385,
          align: "right",
        });

        // Individual receipt pages
        receipts.forEach((r) => {
          doc.addPage();

          doc.rect(0, 0, pageWidth, 70).fill("#1E40AF");
          doc.fontSize(16).fillColor("#FFFFFF").font("Helvetica-Bold");
          doc.text(company.name, margin, 14, { width: contentWidth });
          doc.fontSize(10).font("Helvetica");
          doc.text("EXPENSE RECEIPT", margin, 40, { width: contentWidth, align: "right" });

          let y = 88;
          const addRow = (label: string, value: string) => {
            doc
              .fontSize(9)
              .fillColor(labelColor)
              .font("Helvetica-Bold")
              .text(label, margin, y, { width: 120 });
            doc
              .fontSize(9)
              .fillColor(valueColor)
              .font("Helvetica")
              .text(value, margin + 130, y, { width: contentWidth - 130 });
            y += 18;
          };

          addRow("Merchant:", r.merchant || "N/A");
          addRow("Date:", r.date ? new Date(r.date).toLocaleDateString("en-AE") : "N/A");
          addRow("Category:", r.category || "Uncategorized");
          addRow("Currency:", r.currency || "AED");
          y += 6;

          doc.rect(margin, y, contentWidth, 44).fill("#F9FAFB").stroke("#E5E7EB");
          doc.fontSize(11).fillColor("#1F2937").font("Helvetica-Bold");
          doc.text("Total Amount", margin + 12, y + 8);
          doc.fontSize(15).fillColor("#1E40AF");
          const receiptTotal = (r.amount ?? 0) + (r.vatAmount ?? 0);
          doc.text(`${r.currency || "AED"} ${receiptTotal.toFixed(2)}`, margin + 12, y + 22, {
            width: contentWidth - 24,
            align: "right",
          });
          y += 58;

          if (r.vatAmount && r.vatAmount > 0) {
            doc.fontSize(9).fillColor(labelColor).font("Helvetica");
            const base = (r.amount ?? 0).toFixed(2);
            doc.text(
              `Base: ${r.currency || "AED"} ${base}   VAT: ${r.currency || "AED"} ${r.vatAmount.toFixed(2)}`,
              margin,
              y
            );
            y += 18;
          }

          if (r.rawText) {
            y += 6;
            doc
              .fontSize(9)
              .fillColor(labelColor)
              .font("Helvetica-Bold")
              .text("OCR Text:", margin, y);
            y += 14;
            doc
              .fontSize(8)
              .fillColor(valueColor)
              .font("Helvetica")
              .text(r.rawText.slice(0, 300), margin, y, { width: contentWidth });
          }

          doc.fontSize(7).fillColor("#9CA3AF").font("Helvetica");
          doc.text(
            `Generated by ${company.name} · ${new Date().toLocaleDateString("en-AE")}`,
            margin,
            780,
            { width: contentWidth, align: "center" }
          );
        });

        doc.end();
      });

      const dateTag = from && to ? `_${from}_to_${to}` : "";
      const catTag = category && category !== "all" ? `_${category.replace(/\s+/g, "-")}` : "";

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="receipts${dateTag}${catTag}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );

  // Customer-only: Serve receipt image (new file-based or legacy base64)
  app.get(
    "/api/companies/:companyId/receipts/:id/image",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const receipt = await storage.getReceipt(id, companyId);
      if (!receipt) {
        return res.status(404).json({ message: "Receipt not found" });
      }

      // S-L1: prevent MIME-sniffing and force the browser to treat receipt
      // images as downloads rather than rendering them inline (defence against
      // a malicious upload being served back as active content).
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "private, max-age=300");

      if (receipt.imagePath) {
        const image = await readReceiptImage(receipt.imagePath);
        if (!image) {
          return res.status(404).json({ message: "No image available for this receipt" });
        }
        // Serve the TRUE type (sniffed from the stored bytes), with a matching extension.
        const trueMime = sniffFileType(image.buffer)?.mime ?? receipt.fileMime ?? image.contentType;

        if (req.query.size === "thumb") {
          const thumb = await generateThumbnail(image.buffer, trueMime);
          if (thumb) {
            res.set("Content-Type", "image/jpeg");
            res.set("Content-Disposition", `inline; filename="receipt-${id}-thumb.jpg"`);
            return res.send(thumb);
          }
          res.set("X-Thumbnail", "unavailable");
        }

        res.set("Content-Type", trueMime);
        res.set(
          "Content-Disposition",
          `attachment; filename="receipt-${id}.${extForMime(trueMime)}"`
        );
        return res.send(image.buffer);
      }
      res.set("Content-Disposition", `attachment; filename="receipt-${id}.jpg"`);

      // Backward compat: legacy records that have base64 imageData but no imagePath
      if (receipt.imageData) {
        const raw = receipt.imageData.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(raw, "base64");
        res.set("Content-Type", "image/jpeg");
        return res.send(buffer);
      }

      return res.status(404).json({ message: "No image available for this receipt" });
    })
  );

  // Customer-only: Download receipt as PDF
  app.get(
    "/api/companies/:companyId/receipts/:id/pdf",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const receipt = await storage.getReceipt(id, companyId);
      if (!receipt) {
        return res.status(404).json({ message: "Receipt not found" });
      }

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ size: "A5", margin: 40 });
        const chunks: Buffer[] = [];
        doc.on("data", (c: Buffer) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const pageWidth = 419.53;
        const margin = 40;
        const contentWidth = pageWidth - 2 * margin;

        // Header
        doc.rect(0, 0, pageWidth, 70).fill("#1E40AF");
        doc.fontSize(16).fillColor("#FFFFFF").font("Helvetica-Bold");
        doc.text(company.name, margin, 15, { width: contentWidth });
        doc.fontSize(10).font("Helvetica");
        doc.text("EXPENSE RECEIPT", margin, 40, { width: contentWidth, align: "right" });

        // Receipt details
        let y = 85;
        const labelColor = "#6B7280";
        const valueColor = "#111827";

        const addRow = (label: string, value: string) => {
          doc.fontSize(9).fillColor(labelColor).font("Helvetica-Bold").text(label, margin, y);
          doc
            .fontSize(9)
            .fillColor(valueColor)
            .font("Helvetica")
            .text(value, margin + 100, y);
          y += 16;
        };

        addRow("Merchant:", receipt.merchant || "N/A");
        addRow("Date:", receipt.date ? new Date(receipt.date).toLocaleDateString("en-AE") : "N/A");
        addRow("Category:", receipt.category || "Uncategorized");
        addRow("Currency:", receipt.currency || "AED");
        y += 4;

        // Amount box
        doc.rect(margin, y, contentWidth, 40).fill("#F9FAFB").stroke("#E5E7EB");
        doc.fontSize(11).fillColor("#1F2937").font("Helvetica-Bold");
        doc.text("Total Amount", margin + 10, y + 8);
        doc.fontSize(14).fillColor("#1E40AF");
        const total = ((receipt.amount ?? 0) + (receipt.vatAmount ?? 0)).toFixed(2);
        doc.text(`${receipt.currency || "AED"} ${total}`, margin + 10, y + 22, {
          width: contentWidth - 20,
          align: "right",
        });
        y += 55;

        if (receipt.vatAmount && receipt.vatAmount > 0) {
          doc.fontSize(9).fillColor(labelColor).font("Helvetica");
          const base = (receipt.amount ?? 0).toFixed(2);
          doc.text(
            `Base: ${receipt.currency || "AED"} ${base}   VAT (5%): ${receipt.currency || "AED"} ${receipt.vatAmount.toFixed(2)}`,
            margin,
            y
          );
          y += 16;
        }

        if (receipt.rawText) {
          y += 4;
          doc.fontSize(9).fillColor(labelColor).font("Helvetica-Bold").text("OCR Text:", margin, y);
          y += 12;
          const preview = receipt.rawText.slice(0, 200);
          doc
            .fontSize(8)
            .fillColor(valueColor)
            .font("Helvetica")
            .text(preview, margin, y, { width: contentWidth });
        }

        // Footer
        doc.fontSize(7).fillColor("#9CA3AF").font("Helvetica");
        doc.text(
          `Generated by ${company.name} · ${new Date().toLocaleDateString("en-AE")}`,
          margin,
          560,
          { width: contentWidth, align: "center" }
        );

        doc.end();
      });

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="receipt-${id.slice(0, 8)}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );
}

// Body schema for the bulk Excel export. `ids` is optional — omitting it (or
// passing an empty array) exports every receipt the company has access to.
const receiptsExportSchema = z.object({
  ids: z.array(z.string().uuid()).max(5000).optional(),
});
