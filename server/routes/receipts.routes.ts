import { sizeErrorBody } from "../http/upload-errors";
import { receiptHref } from "../../shared/app-links";
import { type Express, type Request, type Response } from "express";
import { receiptCheckSimilarBody } from "../../shared/validators/route-bodies";
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
  receiptReviewDecisionBody,
  type ReceiptReviewDecisionBody,
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
import {
  postReceipt,
  reviseReceipt,
  resolveReceiptRate,
} from "../services/receipt-posting.service";
import { zSupplyType } from "../../shared/validators/primitives";
import { type Receipt, receipts as receiptsTable } from "../../shared/schema";
import { and, eq } from "drizzle-orm";
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
import { notificationCopy } from "../../shared/server-copy";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import { withLedgerTx } from "../ledger";
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
import { renderReceiptPdf, renderReceiptsExportPdf } from "../services/pdf-receipt.service";
import { attachmentDisposition, downloadFileName } from "../utils/download-filename";
import { calendarDateKey } from "../../shared/uae-date";

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

/** Estimate the payment credit using the same per-leg rounding as receipt posting. */
function baseCurrencyAmountOf(
  amount: number,
  vat: number,
  rate: number,
  lines?: ReceiptLineInput[] | null,
  reverseCharge = false
): number {
  const items = lines?.length ? lines : [{ amount, vatAmount: vat }];
  return filsToNumber(
    sumFils(
      items.flatMap((line) => [
        mulRate(toFils(line.amount), rate),
        reverseCharge ? 0 : mulRate(toFils(line.vatAmount ?? 0), rate),
      ])
    )
  );
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
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
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
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const { ids, locale } = req.body as z.infer<typeof receiptsExportSchema>;
      const all = await storage.getReceiptsByCompanyId(companyId);
      const subset = ids && ids.length > 0 ? all.filter((r) => ids.includes(r.id)) : all;

      const rows = subset.map((r) =>
        receiptToExportRow({
          date: r.date,
          merchant: r.merchant,
          invoiceNumber: r.invoiceNumber,
          amount: r.amount as unknown as number,
          vatAmount: r.vatAmount as unknown as number,
          currency: r.currency,
        })
      );

      const buffer = await buildOcrReceiptsWorkbook(rows, {
        sheetName: "Receipts",
        title: "Muhasib Receipts Export",
        locale,
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
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
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
    strictBody(receiptCheckSimilarBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { merchant, amount, date } = parsedBody<{
        merchant?: string | null;
        amount?: number | string | null;
        date?: string | null;
      }>(req);

      // Check if user has access to this company
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      // merchant is optional (R05-18): similarity then relies on amount and date alone.
      const probe = {
        merchant: typeof merchant === "string" ? merchant : null,
        amount: Number(amount) || 0,
        date: typeof date === "string" ? date : null,
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
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const body = parsedBody<CreateReceiptBody>(req);
      if (body.captureId) {
        const existing = await storage.getCapturedReceipt(companyId, body.captureId);
        if (existing) return res.json(existing);
      }
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
      const date = receiptDateToDate(body.date);
      const quoted = await resolveReceiptRate(
        companyId,
        currency,
        date,
        body.exchangeRate ?? null,
        undefined,
        true
      );
      const exchangeRate = quoted.rate ?? 1;
      await assertReceiptAccounts(companyId, {
        accountId: body.accountId,
        paymentAccountId: body.paymentAccountId,
        lines: split,
      });

      const receiptData: {
        merchant: string | null;
        invoiceNumber: string | null;
        date: Date;
        amount: number;
        vatAmount: number;
        currency: string;
        exchangeRate: number;
        exchangeRateSource: Receipt["exchangeRateSource"];
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
        invoiceNumber: body.invoiceNumber ?? null,
        date,
        amount,
        vatAmount,
        currency,
        exchangeRate,
        exchangeRateSource: quoted.source,
        baseCurrencyAmount:
          quoted.rate === null
            ? 0
            : baseCurrencyAmountOf(amount, vatAmount, exchangeRate, split, body.reverseCharge),
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
            return res
              .status(err.status)
              .json(
                err.code === "FILE_TOO_LARGE"
                  ? sizeErrorBody(req, err.code)
                  : { message: err.message, code: err.code }
              );
          }
          throw err;
        }

        if (!confirmDuplicate) {
          const duplicate = await findReceiptByContentHash(companyId, inspected.sha256);
          if (duplicate) {
            if (body.captureId) {
              const replay = await storage.getCapturedReceipt(companyId, body.captureId);
              if (replay) return res.json(replay);
            }
            return res.status(409).json({
              code: "DUPLICATE_RECEIPT",
              message: "This file has already been uploaded",
              duplicateOf: {
                id: duplicate.id,
                merchant: duplicate.merchant,
                amount: duplicate.amount,
                date: duplicate.date,
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

      const result = await storage
        .createCapturedReceipt(
          {
            ...receiptData,
            captureId: body.captureId ?? null,
            supplierTrn: receiptData.supplierTrn ?? null,
            companyId,
            uploadedBy: userId,
            imagePath: imagePath ?? null,
            ...(fileMeta ?? {}),
            // imageData intentionally omitted — not stored in Postgres
          },
          confirmDuplicate === true
        )
        .catch(async (error) => {
          if (imagePath) await deleteReceiptImage(imagePath);
          throw error;
        });
      if (result.duplicate || result.replay) {
        if (imagePath) await deleteReceiptImage(imagePath);
        if (result.duplicate)
          return res.status(409).json({
            message: "This file has already been uploaded",
            code: "DUPLICATE_RECEIPT",
            duplicateOf: result.duplicate,
          });
        return res.json(result.receipt);
      }
      const receipt = result.receipt;

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
        ...notificationCopy(
          "notification.receiptUploaded.title",
          receipt.merchant
            ? "notification.receiptUploaded.message"
            : "notification.receiptUploadedUnknown.message",
          {
            merchant: receipt.merchant,
            // "AED 6100.00": the client formats this as money in the reader's language.
            amount:
              receipt.amount != null && Number.isFinite(Number(receipt.amount))
                ? `${receipt.currency || "AED"} ${Number(receipt.amount).toFixed(2)}`
                : "",
          }
        ),
        priority: "normal",
        relatedEntityType: "receipt",
        relatedEntityId: receipt.id,
        actionUrl: receiptHref(receipt.id),
      }).catch(() => {});

      res.json(duplicateWarnings.length > 0 ? { ...receipt, duplicateWarnings } : receipt);
    })
  );

  // Record the human decision on an AI-extracted receipt for audit (R05-23).
  app.post(
    "/api/companies/:companyId/receipts/:id/review-decision",
    authMiddleware,
    requireCustomer,
    strictBody(receiptReviewDecisionBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = req.user!.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const parsed = { data: parsedBody<ReceiptReviewDecisionBody>(req) };
      const receipt = await storage.getReceipt(id, companyId);
      if (!receipt)
        return res.status(404).json({ message: "Receipt not found", code: "RECEIPT_NOT_FOUND" });

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
        required: true,
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
    if (body.invoiceNumber !== undefined) patch.invoiceNumber = body.invoiceNumber ?? null;
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
    const currencyChanged = patch.currency !== undefined && patch.currency !== before.currency;
    const dateChanged = patch.date && calendarDateKey(patch.date) !== calendarDateKey(before.date);
    const reprice = currencyChanged || dateChanged;
    const date = patch.date ?? before.date ?? before.createdAt;
    const currency = patch.currency ?? before.currency;
    const manual =
      body.exchangeRate ??
      (!reprice && before.exchangeRateSource === "manual" ? before.exchangeRate : null);
    if (before.posted) {
      if (body.exchangeRate !== undefined) patch.exchangeRateSource = "manual";
      else if (reprice) {
        // Zero is a transient marker. The revision plan resolves and persists the booked rate.
        patch.exchangeRate = 0;
        patch.exchangeRateSource = null;
      }
    } else {
      const quote = await resolveReceiptRate(
        before.companyId,
        currency,
        date,
        manual,
        undefined,
        true
      );
      patch.exchangeRate = quote.rate ?? 1;
      patch.exchangeRateSource = quote.source;
      patch.baseCurrencyAmount =
        quote.rate === null
          ? 0
          : baseCurrencyAmountOf(
              amount,
              vatAmount,
              quote.rate,
              (patch.lines ?? before.lines) as ReceiptLineInput[] | null,
              patch.reverseCharge ?? before.reverseCharge
            );
    }

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
        return res.status(404).json({ message: "Receipt not found", code: "RECEIPT_NOT_FOUND" });
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

      // S02/S03: the change and its audit row commit together or not at all.
      const updatedReceipt = await withLedgerTx(async (tx) => {
        const updated = await storage.updateReceiptIfUnposted(id, before.companyId, patch, tx);
        await recordAudit({
          userId,
          companyId: updated.companyId,
          action: "receipt.update",
          entityType: "receipt",
          entityId: id,
          before: { merchant: before.merchant, amount: before.amount, accountId: before.accountId },
          after: {
            merchant: updated.merchant,
            amount: updated.amount,
            accountId: updated.accountId,
          },
          req,
          tx,
          required: true,
        });
        return updated;
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
        return res.status(404).json({ message: "Receipt not found", code: "RECEIPT_NOT_FOUND" });
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
      // S02/S03: the revision (reversal, re-post, receipt row) and its audit row are one
      // transaction: if the audit write fails the whole revision rolls back.
      const result = await reviseReceipt(
        before,
        userId,
        merged,
        patch,
        reason ?? null,
        async (revised, tx) => {
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
              amount: revised.receipt.amount,
              vatAmount: revised.receipt.vatAmount,
              journalEntryId: revised.entry.id,
              reversalEntryId: revised.reversal.id,
            },
            req,
            extra: { reason: reason ?? null },
            tx,
            required: true,
          });
        }
      );
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
      const { parts: partsInput } = req.body as SplitReceiptBody;

      const source = await findReceiptForUser(userId, id);
      if (!source) {
        return res.status(404).json({ message: "Receipt not found", code: "RECEIPT_NOT_FOUND" });
      }
      for (const part of partsInput) {
        if (part.date) await assertPeriodNotLocked(source.companyId, receiptDateToDate(part.date));
      }
      const parts = await Promise.all(
        partsInput.map(async (part) => {
          const date = part.date ? receiptDateToDate(part.date) : source.date;
          const keepManual =
            source.exchangeRateSource === "manual" &&
            calendarDateKey(date) === calendarDateKey(source.date);
          const quote = await resolveReceiptRate(
            source.companyId,
            source.currency,
            date ?? source.createdAt,
            keepManual ? source.exchangeRate : null,
            undefined,
            true
          );
          const vat = part.vatAmount ?? 0;
          return {
            merchant: part.merchant ?? source.merchant,
            date,
            amount: part.amount,
            vatAmount: vat,
            category: part.category ?? source.category,
            exchangeRate: quote.rate ?? 1,
            exchangeRateSource: quote.source,
            baseCurrencyAmount:
              quote.rate === null
                ? 0
                : baseCurrencyAmountOf(part.amount, source.reverseCharge ? 0 : vat, quote.rate),
          };
        })
      );
      const created = await withLedgerTx(async (tx) => {
        const rows = await storage.splitReceiptAtomic(
          { receiptId: id, companyId: source.companyId, parts },
          tx
        );
        await recordAudit({
          userId,
          companyId: source.companyId,
          action: "receipt.split",
          entityType: "receipt",
          entityId: id,
          before: { amount: source.amount, merchant: source.merchant },
          after: null,
          req,
          extra: { newReceiptIds: rows.map((r) => r.id) },
          tx,
          required: true,
        });
        return rows;
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

      const existing = await findReceiptForUser(userId, id);
      if (!existing) {
        return res.status(404).json({ message: "Receipt not found", code: "RECEIPT_NOT_FOUND" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
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

      await withLedgerTx(async (tx) => {
        const deleted = await storage.deleteReceipt(id, existing.companyId, tx);
        if (!deleted) {
          // Gone, or posted by a concurrent /post after the read above: nothing was deleted, so
          // nothing is audited.
          const [now] = await tx
            .select({ posted: receiptsTable.posted, journalEntryId: receiptsTable.journalEntryId })
            .from(receiptsTable)
            .where(and(eq(receiptsTable.id, id), eq(receiptsTable.companyId, existing.companyId)));
          if (!now) {
            throw new DomainError("RECEIPT_NOT_FOUND", 404, undefined, "Receipt not found");
          }
          throw new DomainError(
            "RECEIPT_POSTED",
            409,
            { receiptId: id, journalEntryId: now.journalEntryId },
            "A posted receipt cannot be deleted. Revise it or reverse its journal entry."
          );
        }
        await recordAudit({
          userId,
          companyId: existing.companyId,
          action: "receipt.delete",
          entityType: "receipt",
          entityId: id,
          before: { merchant: existing.merchant, amount: existing.amount },
          after: null,
          req,
          tx,
          required: true,
        });
      });

      // Row first, then the file: split parts share one stored image, so it is removed only when
      // no receipt of the company still points at it. Best-effort: the row is already gone.
      if (existing.imagePath) {
        try {
          if (!(await storage.isReceiptImageReferenced(existing.companyId, existing.imagePath))) {
            await deleteReceiptImage(existing.imagePath);
          }
        } catch (err) {
          log.warn(
            { err: (err as Error).message, receiptId: id },
            "Receipt image cleanup failed (non-fatal - receipt deleted)"
          );
        }
      }

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
      const receipt = await findReceiptForUser(userId, id);
      if (!receipt) {
        return res.status(404).json({ message: "Receipt not found", code: "RECEIPT_NOT_FOUND" });
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
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const company = await storage.getCompany(companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });

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
        return res
          .status(404)
          .json({ message: "No receipts found for the given filters", code: "RECEIPTS_NOT_FOUND" });
      }

      const pdfBuffer = await renderReceiptsExportPdf(receipts, company, { from, to, category });

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
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const receipt = await storage.getReceipt(id, companyId);
      if (!receipt) {
        return res.status(404).json({ message: "Receipt not found", code: "RECEIPT_NOT_FOUND" });
      }

      // S-L1: prevent MIME-sniffing and force the browser to treat receipt
      // images as downloads rather than rendering them inline (defence against
      // a malicious upload being served back as active content).
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "private, max-age=300");

      if (receipt.imagePath) {
        const image = await readReceiptImage(receipt.imagePath);
        if (!image) {
          return res.status(404).json({
            message: "No image available for this receipt",
            code: "RECEIPT_IMAGE_NOT_FOUND",
          });
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

      return res
        .status(404)
        .json({ message: "No image available for this receipt", code: "RECEIPT_IMAGE_NOT_FOUND" });
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
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const receipt = await storage.getReceipt(id, companyId);
      if (!receipt) {
        return res.status(404).json({ message: "Receipt not found", code: "RECEIPT_NOT_FOUND" });
      }

      const company = await storage.getCompany(companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });

      const pdfBuffer = await renderReceiptPdf(receipt, company);

      // P-f: named by the receipt's journal entry number once posted, else merchant and date,
      // never an id fragment ("receipt-8e671e03.pdf").
      const entry = receipt.journalEntryId
        ? await storage.getJournalEntry(receipt.journalEntryId, companyId)
        : undefined;
      const fileName = downloadFileName(
        "receipt",
        entry?.entryNumber
          ? [entry.entryNumber]
          : [receipt.merchant, receipt.date ? calendarDateKey(receipt.date) : null],
        "pdf"
      );

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": attachmentDisposition(fileName),
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );
}

// Body schema for the bulk Excel export. `ids` is optional — omitting it (or
// passing an empty array) exports every receipt the company has access to.
const receiptsExportSchema = z.object({
  ids: z.array(z.string().guid()).max(5000).optional(),
  locale: z.enum(["en", "ar"]).optional(),
});
