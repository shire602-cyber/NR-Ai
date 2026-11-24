import { addAbortListener } from "node:events";
import { sizeErrorBody } from "../http/upload-errors";
import { type Express, type Request, type Response } from "express";
import { parsedBody } from "../http/parsed-body";
import { strictBody } from "../http/strict-body";
import { ocrProcessBody } from "../../shared/validators/route-bodies";
import { EXCEL_EXPORT_LIMITS, excelWorkbookCellCount } from "../../shared/excel-export";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { createLogger } from "../config/logger";
import {
  buildGenericWorkbook,
  buildOcrReceiptsWorkbook,
  buildExportFilename,
  type OcrExportRow,
} from "../services/excel-export.service";
import { classifyOcrReceipt } from "../services/receipt-autopilot.service";
import { isStandardCategory } from "../services/receipt-classifier.service";
import { extractReceiptWithLocalOcr } from "../services/local-ocr.service";
import {
  createOcrClients,
  describeOcrProviders,
  summarizeOcrProviderError,
} from "../services/ocr-provider-clients";
import { parseReceiptOcrText } from "@shared/receipt-ocr-parser";
import { deriveConfidenceBand, type ValidationIssue } from "@shared/receipt-confidence";
import { buildLimiter, limiterProfiles } from "../middleware/rateLimit";
import { extractReceipt, type ExtractionClients } from "../services/ai/receipt-extraction";
import {
  normalizeModelConfidence,
  VALID_RECEIPT_CATEGORIES,
} from "../services/ai/structured-output";
import { sanityCheckReceipt } from "../services/ai/structured-output";
import { assertAiQuota, type AiContext } from "../services/ai/usage-meter";
import { inspectUpload, UploadRejectedError } from "../services/upload-guard";
import { errorCode, errorMessage, errorProperty } from "../errors";

const log = createLogger("ocr");

// Leave 20 seconds of the Vercel function budget for setup and the response.
const OCR_REQUEST_TIMEOUT_MS = 40_000;

function withOcrDeadline(
  handle: (
    req: Request,
    res: Response,
    signal: AbortSignal,
    waitForStep: <T>(work: Promise<T>) => Promise<T>
  ) => Promise<unknown>
) {
  return asyncHandler(async (req, res) => {
    const signal = AbortSignal.timeout(OCR_REQUEST_TIMEOUT_MS);
    const waitForStep = async <T>(work: Promise<T>): Promise<T> => {
      let listener: ReturnType<typeof addAbortListener> | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            listener = addAbortListener(signal, () => reject(signal.reason));
          }),
        ]);
      } finally {
        listener?.[Symbol.dispose]();
      }
    };
    try {
      await handle(req, res, signal, waitForStep);
    } catch (err) {
      if (!signal.aborted) throw err;
      res.status(504).json({
        code: "OCR_TIMEOUT",
        message: "Receipt reading took too long. Please try again.",
      });
    }
  });
}

export interface OcrRouteDeps {
  /** Inject (mock) provider clients. Omit to build them from the environment. */
  anthropic?: Anthropic | null;
  openai?: OpenAI | null;
}

export function registerOCRRoutes(app: Express, deps: OcrRouteDeps = {}) {
  const envClients =
    deps.anthropic === undefined && deps.openai === undefined ? createOcrClients() : null;
  const anthropic = deps.anthropic !== undefined ? deps.anthropic : (envClients?.anthropic ?? null);
  const openai = deps.openai !== undefined ? deps.openai : (envClients?.openai ?? null);
  const aiLimiter = buildLimiter("ocr-routes", limiterProfiles.ai);
  // X6b: one budget per company (not per user) so a company's scans cannot starve the platform
  // however many users it adds. Applied once the caller's access to the company is proven.
  const companyLimiter = buildLimiter("ocr-company", {
    ...limiterProfiles.ocrCompany,
    keyGenerator: (req) => `ocr:${(req as Request & { ocrCompanyId?: string }).ocrCompanyId}`,
  });
  const applyCompanyLimit = (req: Request, res: Response, companyId: string) =>
    new Promise<boolean>((resolve, reject) => {
      (req as Request & { ocrCompanyId?: string }).ocrCompanyId = companyId;
      companyLimiter(req, res, (err?: unknown) => (err ? reject(err) : resolve(true)));
      res.once("finish", () => resolve(false));
    });

  // X3 (J2): lets the Receipts page say up front that automatic reading is not enabled.
  app.get(
    "/api/ocr/status",
    authMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ aiConfigured: Boolean(anthropic || openai) });
    })
  );

  // ===========================
  // OCR Processing Endpoint
  // ===========================

  app.post(
    "/api/ocr/process",
    authMiddleware,
    aiLimiter,
    strictBody(ocrProcessBody, { allowServerOwned: ["companyId"] }),
    withOcrDeadline(async (req, res, signal, waitForStep) => {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized", code: "AUTH_REQUIRED" });
      }

      const {
        messageId,
        content,
        imageData,
        companyId: requestedCompanyId,
      } = parsedBody<{
        messageId?: string | null;
        content?: string | null;
        imageData?: string | null;
        companyId?: string | null;
      }>(req);

      // Phase 2 enriches the OCR result with the company's per-tenant classifier
      // (training data + rules). The active company MUST come from the request so
      // a multi-company user (firm_owner, firm_admin, or anyone with multiple
      // companies) gets predictions trained on the correct tenant's data — never
      // company A's model bleeding into a receipt being processed for company B.
      let companyId: string;
      if (requestedCompanyId && typeof requestedCompanyId === "string") {
        const hasAccess = await waitForStep(storage.hasCompanyAccess(userId, requestedCompanyId));
        if (!hasAccess) {
          return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
        }
        companyId = requestedCompanyId;
      } else {
        // Backwards-compat fallback for older clients: only safe when the user
        // has exactly one company. For multi-company users we require an
        // explicit companyId so we never silently pick the wrong tenant.
        const companies = await waitForStep(storage.getCompaniesByUserId(userId));
        if (companies.length === 0) {
          return res.status(404).json({ message: "No company found", code: "COMPANY_NOT_FOUND" });
        }
        if (companies.length > 1) {
          return res.status(400).json({
            message: "companyId is required when the user has access to multiple companies",
            code: "COMPANY_REQUIRED",
          });
        }
        companyId = companies[0].id;
      }

      // X6b (J2): with no AI provider, fail image-only requests early. Pasted text
      // still goes through the deterministic parser below.
      if (!anthropic && !openai && imageData && !content) {
        return res.status(503).json({
          message: "Automatic receipt reading is not enabled on this server.",
          code: "AI_NOT_CONFIGURED",
        });
      }

      // The limiter can write its own response and its Redis call has a 3-second timeout.
      if (!(await applyCompanyLimit(req, res, companyId))) return;
      signal.throwIfAborted();

      const sanitizedContent = content ? String(content).slice(0, 10000) : "";
      const sanitizedMessageId = messageId ? String(messageId).slice(0, 100) : null;

      const validCategories: string[] = [...VALID_RECEIPT_CATEGORIES];

      if (!imageData && !sanitizedContent) {
        return res
          .status(400)
          .json({ message: "Missing imageData or content", code: "IMAGE_REQUIRED" });
      }

      // Validate the image from its bytes before it goes to any provider (R05-06/R05-08).
      let imageDataUrl: string | null = null;
      if (imageData) {
        try {
          const inspected = await waitForStep(inspectUpload(String(imageData)));
          imageDataUrl = `data:${inspected.mime};base64,${inspected.buffer.toString("base64")}`;
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
      }

      // Monthly AI cap (R05-26): applies before any provider call, local fallbacks stay free.
      if (anthropic || openai) {
        try {
          await waitForStep(assertAiQuota(companyId));
        } catch (err: unknown) {
          signal.throwIfAborted();
          if (errorCode(err) === "AI_QUOTA_EXCEEDED") {
            return res.status(429).json({
              message: errorMessage(err),
              code: "AI_QUOTA_EXCEEDED",
              usage: errorProperty(err, "detail"),
            });
          }
          throw err;
        }
      }

      const ocrCtx: AiContext = { companyId, userId, task: "ocr" };
      const clients: ExtractionClients = { anthropic, openai };

      // Helper: post-process AI extraction → run our internal classifier on the
      // merchant. Overrides AI's category if our classifier is more confident
      // (≥ 0.8) — the same threshold as Phase 2's auto-fallback rule.
      const enrichWithInternalClassifier = async (aiResult: LooseOcrResult) => {
        try {
          const merchant =
            (aiResult?.merchant ? String(aiResult.merchant) : "") || "Unknown Merchant";
          const lineItems = Array.isArray(aiResult?.lineItems)
            ? (aiResult.lineItems as Array<{ description?: unknown } | null>).map((li) => ({
                description: String(li?.description || ""),
              }))
            : [];
          const subtotal = parseFloat(String(aiResult?.subtotal)) || 0;
          const result = await classifyOcrReceipt(companyId, {
            merchant,
            amount: subtotal,
            lineItems,
            supplierTrn: typeof aiResult?.supplierTrn === "string" ? aiResult.supplierTrn : null,
          });
          // Only override the AI category when our classifier is at-or-above its
          // own confidence threshold. The AI's confidence is on the OCR
          // extraction (numbers/date/total), not the category — so we surface
          // both and let the caller see how the category was determined.
          aiResult._aiCategory = aiResult.category;
          if (result.confidence >= 0.8 && isStandardCategory(result.category)) {
            aiResult.category = result.category;
          }
          aiResult._classifier = {
            method: result.method,
            confidence: result.confidence,
            reason: result.reason,
            // Agreement is only meaningful when the classifier is deterministic/internal.
            agreesWithAi:
              result.method === "openai" ? null : result.category === aiResult._aiCategory,
          };
        } catch (err: unknown) {
          log.warn({ err: errorMessage(err) || err }, "Internal classifier enrichment failed");
        }
        return aiResult;
      };

      const respondWithResult = async (
        result: LooseOcrResult,
        rawText: string,
        ocrSource: string
      ) => {
        result._ocrSource = result._ocrSource || ocrSource;
        await waitForStep(enrichWithInternalClassifier(result));
        return res.json(
          buildResult(result, rawText, companyId, sanitizedMessageId, validCategories)
        );
      };

      let localOcrErrorDetail: string | null = null;
      const tryLocalImageFallback = async (reason: string) => {
        if (!imageDataUrl) return null;
        try {
          const localResult = await waitForStep(extractReceiptWithLocalOcr(imageDataUrl, signal));
          localOcrErrorDetail = null;
          log.warn(
            {
              reason,
              confidence: localResult.confidence,
              textLength: localResult.rawText.length,
            },
            "AI OCR unavailable; used local Tesseract fallback"
          );
          return localResult;
        } catch (err: unknown) {
          signal.throwIfAborted();
          localOcrErrorDetail = summarizeOcrProviderError(err);
          log.error({ err: localOcrErrorDetail, reason }, "Local OCR fallback failed");
          return null;
        }
      };

      const parseTextFallback = (reason: string) => {
        if (!sanitizedContent) return null;
        const parsed = parseReceiptOcrText(sanitizedContent);
        log.warn(
          {
            reason,
            confidence: parsed.confidence,
            textLength: sanitizedContent.length,
          },
          "AI OCR unavailable; used deterministic text parser fallback"
        );
        return { ...parsed, _ocrSource: "text-parser" };
      };

      if (!anthropic && !openai) {
        log.warn("OCR called with no AI key configured; using the text parser only");
        const fallback = parseTextFallback("no configured AI provider");
        if (fallback) {
          return respondWithResult(
            fallback,
            fallback.rawText || sanitizedContent,
            fallback._ocrSource
          );
        }
        return res.status(503).json({
          message:
            "OCR service unavailable — AI provider not configured and local OCR fallback could not read the image.",
          code: "AI_NOT_CONFIGURED",
        });
      }

      // Strategy 1: Vision API with image (Anthropic preferred, OpenAI fallback)
      if (imageDataUrl) {
        try {
          const aiResult = await waitForStep(runVisionOCR(imageDataUrl, clients, ocrCtx, signal));
          return respondWithResult(aiResult, sanitizedContent, "ai-vision");
        } catch (visionError: unknown) {
          signal.throwIfAborted();
          if (errorCode(visionError) === "AI_QUOTA_EXCEEDED") {
            return res.status(429).json({
              message: errorMessage(visionError),
              code: "AI_QUOTA_EXCEEDED",
              usage: errorProperty(visionError, "detail"),
            });
          }
          const provider = describeOcrProviders({ anthropic, openai });
          const detail = summarizeOcrProviderError(visionError);
          log.error({ err: detail, provider }, "Vision OCR failed");

          const fallback = await tryLocalImageFallback(`vision OCR via ${provider} failed`);
          if (fallback) {
            return respondWithResult(fallback, fallback.rawText, fallback._ocrSource);
          }

          if (!sanitizedContent) {
            return res.status(502).json({
              message: `OCR vision request via ${provider} failed: ${detail}${
                localOcrErrorDetail ? `. Local OCR fallback failed: ${localOcrErrorDetail}` : ""
              }`,
            });
          }
          // Otherwise fall through to text-based extraction below
        }
      }

      // Strategy 2: Text-based extraction (no image, or vision failed but text given)
      if (sanitizedContent) {
        try {
          const aiResult = await waitForStep(runTextOCR(sanitizedContent, clients, ocrCtx, signal));
          return respondWithResult(aiResult, sanitizedContent, "ai-text");
        } catch (textError: unknown) {
          signal.throwIfAborted();
          if (errorCode(textError) === "AI_QUOTA_EXCEEDED") {
            return res.status(429).json({
              message: errorMessage(textError),
              code: "AI_QUOTA_EXCEEDED",
              usage: errorProperty(textError, "detail"),
            });
          }
          const provider = describeOcrProviders({ anthropic, openai });
          const detail = summarizeOcrProviderError(textError);
          log.error({ err: detail, provider }, "Text OCR failed");
          const fallback = parseTextFallback(`text OCR via ${provider} failed`);
          if (fallback) {
            return respondWithResult(fallback, sanitizedContent, fallback._ocrSource);
          }
          return res.status(502).json({
            message: `OCR text extraction via ${provider} failed: ${detail}`,
          });
        }
      }

      return res
        .status(400)
        .json({ message: "Missing imageData or content", code: "IMAGE_REQUIRED" });
    })
  );

  // ===========================
  // Excel Export — in-flight OCR rows
  // ===========================
  // Accepts the rows the client has just extracted (and possibly edited) and
  // streams back an .xlsx file with Date / Vendor / Invoice No. / Amount / VAT
  // columns. The same shape is reused for the saved-receipt bulk export so the
  // client only has to know one schema.
  app.post(
    "/api/ocr/export-excel",
    authMiddleware,
    validate({ body: ocrExportSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { rows, filename } = req.body as z.infer<typeof ocrExportSchema>;
      const buffer = await buildOcrReceiptsWorkbook(rows as OcrExportRow[], {
        sheetName: "OCR Receipts",
        title: "Muhasib OCR Export",
      });
      const safeName = filename
        ? `${filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}.xlsx`
        : buildExportFilename();

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Cache-Control", "no-store");
      res.send(buffer);
    })
  );

  app.post(
    "/api/export/excel",
    authMiddleware,
    validate({ body: genericExportSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { sheets, filename } = req.body as z.infer<typeof genericExportSchema>;
      const buffer = await buildGenericWorkbook(sheets, {
        title: filename ? filename.slice(0, 80) : "Muhasib Export",
      });
      const safeName = filename
        ? `${filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}.xlsx`
        : buildExportFilename("muhasib-export");

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Cache-Control", "no-store");
      res.send(buffer);
    })
  );
}

// Schema for the in-flight OCR export. Strict enough to reject obvious junk
// but tolerant of partial data — empty cells render as blanks, not "null".
const ocrExportRowSchema = z.object({
  date: z.union([z.string().max(40), z.null()]).optional(),
  vendor: z.union([z.string().max(200), z.null()]).optional(),
  invoiceNumber: z.union([z.string().max(100), z.null()]).optional(),
  amount: z.union([z.number(), z.string().max(40), z.null()]).optional(),
  vat: z.union([z.number(), z.string().max(40), z.null()]).optional(),
  currency: z.union([z.string().max(10), z.null()]).optional(),
});

const ocrExportSchema = z.object({
  rows: z.array(ocrExportRowSchema).min(1, "At least one row is required").max(5000),
  filename: z.string().max(80).optional(),
});

const genericExportColumnSchema = z.object({
  header: z.string().min(1).max(120),
  key: z.string().min(1).max(120),
  width: z.number().min(5).max(80).optional(),
});

const genericExportSchema = z.object({
  sheets: z
    .array(
      z.object({
        sheetName: z.string().max(80).optional(),
        rtl: z.boolean().optional(),
        columns: z
          .array(genericExportColumnSchema)
          .min(1)
          .max(EXCEL_EXPORT_LIMITS.columnsPerWorksheet),
        rows: z.array(z.record(z.string(), z.unknown())).max(EXCEL_EXPORT_LIMITS.rowsPerWorksheet),
      })
    )
    .min(1)
    .max(EXCEL_EXPORT_LIMITS.worksheets)
    .refine((sheets) => excelWorkbookCellCount(sheets) <= EXCEL_EXPORT_LIMITS.renderedCells, {
      message: "Excel export exceeds the workbook cell limit",
    }),
  filename: z.string().max(80).optional(),
});

function parseImageDataUrl(imageData: string): { base64: string; mediaType: string } {
  const m = imageData.match(/^data:([^;]+);base64,(.+)$/s);
  return m ? { mediaType: m[1], base64: m[2] } : { mediaType: "image/jpeg", base64: imageData };
}

/** Classifier note attached to an OCR result by enrichWithInternalClassifier. */
interface OcrClassifierNote {
  method: string;
  confidence: number;
  reason: string;
  agreesWithAi: boolean | null;
}

/**
 * The loose OCR shape buildResult/enrichment consume: provider (AI) extraction,
 * deterministic text parsing or local Tesseract output. Field values are not
 * trusted, so they stay `unknown` and are coerced in buildResult.
 */
interface LooseOcrResult {
  merchant?: unknown;
  date?: unknown;
  invoiceNumber?: unknown;
  subtotal?: unknown;
  vatAmount?: unknown;
  vatPercentage?: unknown;
  total?: unknown;
  currency?: unknown;
  category?: unknown;
  lineItems?: unknown;
  supplierTrn?: unknown;
  supplierTrnIssue?: unknown;
  isTaxInvoice?: unknown;
  simplifiedInvoice?: unknown;
  reverseChargeSuggested?: unknown;
  confidence?: unknown;
  _issues?: ValidationIssue[];
  _ocrSource?: string;
  _provider?: string;
  _model?: string;
  _aiCategory?: unknown;
  _classifier?: OcrClassifierNote;
}

/** Provider result -> the loose shape buildResult/enrichment consume (+ validation issues). */
function toAiResult(outcome: Awaited<ReturnType<typeof extractReceipt>>): LooseOcrResult {
  return {
    ...outcome.data,
    _issues: outcome.issues,
    _ocrSource: "ai",
    _provider: outcome.provider,
    _model: outcome.model,
  };
}

async function runVisionOCR(
  imageData: string,
  clients: ExtractionClients,
  ctx: AiContext,
  signal: AbortSignal
): Promise<LooseOcrResult> {
  if (!clients.anthropic && !clients.openai) throw new Error("No vision client available");
  const { base64, mediaType } = parseImageDataUrl(imageData);
  return toAiResult(
    await extractReceipt({ clients, input: { kind: "image", base64, mediaType }, ctx, signal })
  );
}

async function runTextOCR(
  textContent: string,
  clients: ExtractionClients,
  ctx: AiContext,
  signal: AbortSignal
): Promise<LooseOcrResult> {
  if (!clients.anthropic && !clients.openai) throw new Error("No text client available");
  return toAiResult(
    await extractReceipt({ clients, input: { kind: "text", text: textContent }, ctx, signal })
  );
}

function buildResult(
  aiResult: LooseOcrResult,
  rawText: string,
  companyId: string,
  messageId: string | null,
  validCategories: string[]
) {
  const subtotal = parseNonNegative(aiResult.subtotal);
  const vatAmount = parseNonNegative(aiResult.vatAmount);
  // Treat null/undefined as missing (default to 5% for UAE); explicit 0 means zero-rated
  const vatPercentage =
    aiResult.vatPercentage === null || aiResult.vatPercentage === undefined
      ? 5
      : parseNonNegative(aiResult.vatPercentage);
  let total = parseNonNegative(aiResult.total);

  // Reconcile amounts if any are missing
  if (total === 0 && subtotal > 0) {
    total = parseFloat((subtotal + vatAmount).toFixed(2));
  }
  const derivedSubtotal =
    subtotal > 0
      ? subtotal
      : total > 0
        ? parseFloat((total / (1 + vatPercentage / 100)).toFixed(2))
        : 0;
  const derivedVat =
    vatAmount > 0 ? vatAmount : parseFloat(((derivedSubtotal * vatPercentage) / 100).toFixed(2));
  const derivedTotal = total > 0 ? total : parseFloat((derivedSubtotal + derivedVat).toFixed(2));

  const category =
    typeof aiResult.category === "string" && validCategories.includes(aiResult.category)
      ? aiResult.category
      : "Other";

  let parsedDate = new Date().toISOString().split("T")[0];
  if (typeof aiResult.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(aiResult.date)) {
    parsedDate = aiResult.date;
  }

  const lineItems = Array.isArray(aiResult.lineItems)
    ? (aiResult.lineItems as Array<Record<string, unknown>>).map((item) => ({
        description: String(item.description || "").slice(0, 500),
        quantity: parseNonNegative(item.quantity) || 1,
        unitPrice: parseNonNegative(item.unitPrice),
        total: parseNonNegative(item.total),
      }))
    : [];

  // A missing model confidence is LOW, never a flattering default (R05-15).
  const confidence = normalizeModelConfidence(aiResult.confidence);

  // Validation: issues the provider path already found, plus checks on the final reconciled
  // figures (so deterministic-parser results are checked too).
  const issues: ValidationIssue[] = Array.isArray(aiResult._issues) ? [...aiResult._issues] : [];
  const have = new Set(issues.map((i) => i.code));
  const finalIssues = sanityCheckReceipt({
    merchant: aiResult.merchant as string | undefined,
    date: (aiResult.date as string | null | undefined) ?? null,
    subtotal: derivedSubtotal,
    vatAmount: derivedVat,
    total: derivedTotal,
    currency: (aiResult.currency as string | null | undefined) ?? null,
    supplierTrn: (aiResult.supplierTrn as string | null | undefined) ?? null,
    vatPercentage,
  });
  for (const issue of finalIssues) if (!have.has(issue.code)) issues.push(issue);
  if (aiResult.supplierTrnIssue && !have.has("TRN_INVALID")) {
    issues.push({
      code: "TRN_INVALID",
      severity: "warning",
      message: String(aiResult.supplierTrnIssue),
    });
  }

  const classifier = aiResult._classifier || null;
  const band = deriveConfidenceBand({
    extractionConfidence: typeof aiResult.confidence === "number" ? aiResult.confidence : undefined,
    classifierConfidence:
      classifier && classifier.method !== "openai" ? classifier.confidence : null,
    classifierAgrees: classifier ? (classifier.agreesWithAi ?? null) : null,
    issues,
  });

  return {
    merchant: aiResult.merchant ? String(aiResult.merchant).slice(0, 200) : "Unknown Merchant",
    date: parsedDate,
    invoiceNumber: aiResult.invoiceNumber ? String(aiResult.invoiceNumber).slice(0, 100) : null,
    subtotal: derivedSubtotal,
    vatPercentage,
    vatAmount: derivedVat,
    total: derivedTotal,
    // Legacy field names for backward compatibility with client
    amount: derivedSubtotal,
    currency: aiResult.currency ? String(aiResult.currency).slice(0, 10) : "AED",
    category,
    lineItems,
    supplierTrn: typeof aiResult.supplierTrn === "string" ? aiResult.supplierTrn : null,
    isTaxInvoice: Boolean(aiResult.isTaxInvoice),
    simplifiedInvoice: Boolean(aiResult.simplifiedInvoice),
    reverseChargeSuggested: Boolean(aiResult.reverseChargeSuggested),
    confidence,
    confidenceBand: band.band,
    confidenceScore: band.score,
    reviewReasons: band.reasons,
    reviewReasonCodes: band.reasonCodes,
    validationIssues: issues,
    classifier,
    ocrSource: aiResult._ocrSource || "ai",
    rawText,
    companyId,
    messageId,
  };
}

function parseNonNegative(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return !isNaN(n) && n >= 0 ? n : 0;
}
