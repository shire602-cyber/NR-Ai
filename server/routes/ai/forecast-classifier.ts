// Cash-flow forecast, classification feedback, receipt autopilot and classifier config handlers.
// Handlers moved from ai.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in ai.routes.ts.
import { DomainError, errorMessage, errorStatus, errorStatusCode } from "../../errors";
import type { Request, Response } from "express";
import {
  STORED_FORECAST_BASIS,
  readStoredForecast,
  regenerateStoredForecast,
} from "../../services/cashflow-forecast.service";
import { UploadRejectedError, inspectUpload } from "../../services/upload-guard";
import { aiErrorBody } from "../../services/ai/usage-meter";
import { assertWithinStorageQuota, saveReceiptFile } from "../../services/fileStorage";
import {
  getClassifierConfig,
  getModelStats,
  setClassifierConfig,
} from "../../services/training-data.service";
import { parsedBody } from "../../http/parsed-body";
import {
  recordClassificationFeedback,
  runAutopilot,
} from "../../services/receipt-autopilot.service";
import { storage } from "../../storage";
import { z } from "zod";
import { forecastCashflowBody } from "./shared";

// Transaction Classification Feedback (for ML learning)
const classificationFeedbackSchema = z.object({
  classificationId: z.string().guid(),
  wasAccepted: z.boolean(),
  // null clears the column; undefined leaves it untouched.
  userSelectedAccountId: z.string().guid().nullable().optional(),
});

// ===========================================
// Phase 2: Receipt Autopilot endpoints
// ===========================================

// Hard caps protect the receipts table from oversized payloads and keep auto-
// post side effects bounded; they also prevent setting accuracyThreshold low
// enough to disable the OpenAI fallback / failsafe entirely.
//
// `imagePath` is intentionally NOT accepted from the client. The server
// derives a sanitized path itself by writing `imageData` (base64) through
// saveReceiptImage(); accepting a client-supplied filesystem path would
// allow path traversal — a forged value like "../../../etc/passwd" would
// round-trip through resolveImagePath() in the receipts image-serve route
// and disclose arbitrary server-readable files to anyone with access to
// their own company.
const autopilotProcessSchema = z.object({
  companyId: z.string().guid(),
  ocr: z.object({
    merchant: z.string().min(1).max(200),
    amount: z.number().finite().nonnegative().optional().default(0),
    vatAmount: z.number().finite().nonnegative().optional().default(0),
    total: z.number().finite().nonnegative(),
    currency: z.string().min(1).max(8).optional().default("AED"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    lineItems: z
      .array(z.object({ description: z.string().max(500).optional() }).passthrough())
      .max(200)
      .optional()
      .default([]),
    rawText: z.string().max(50_000).nullable().optional(),
    imageData: z
      .string()
      .max(15 * 1024 * 1024)
      .nullable()
      .optional(),
  }),
});

const companyIdQuerySchema = z.object({
  companyId: z.string().guid(),
});

const classifierConfigPatchSchema = z.object({
  companyId: z.string().guid(),
  mode: z.enum(["hybrid", "openai_only"]).optional(),
  // Floor at 0.5 so a user cannot effectively disable the OpenAI fallback or
  // the auto-failsafe by setting an unreachable threshold. Cap at 0.99 so
  // the failsafe condition `internalAccuracy < threshold` stays satisfiable.
  accuracyThreshold: z.number().min(0.5).max(0.99).optional(),
  autopilotEnabled: z.boolean().optional(),
  // Auto-posting mutates the books — stricter 0.8 floor than the general
  // classification threshold.
  autopostThreshold: z.number().min(0.8).max(0.99).optional(),
});

/** POST /api/ai/forecast-cashflow */
export const handlePostAiForecastCashflow = async (req: Request, res: Response) => {
  const body = parsedBody<z.infer<typeof forecastCashflowBody>>(req);
  const userId = req.user!.id;
  if (!(await storage.hasCompanyAccess(userId, body.companyId))) {
    return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
  }
  const months = body.forecastMonths ?? (body.days ? Math.max(1, Math.ceil(body.days / 30)) : 3);
  const result = await regenerateStoredForecast(body.companyId, { months });
  if (result.insufficientData) {
    throw new DomainError(
      "INSUFFICIENT_DATA",
      400,
      { insights: result.insights, insightMessages: result.insightMessages },
      "Add invoices, vendor bills or scheduled cash items before generating a cash-flow forecast."
    );
  }
  res.json({
    basis: STORED_FORECAST_BASIS,
    forecasts: result.forecasts,
    insights: result.insights,
    insightMessages: result.insightMessages,
  });
};

/** GET /api/companies/:companyId/forecasts */
export const handleGetCompaniesForecasts = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    // Rows from the pre-0112 fabricated model are regenerated on read.
    const forecasts = await readStoredForecast(companyId);
    res.json(forecasts);
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};

/** POST /api/ai/classification-feedback */
export const handlePostAiClassificationFeedback = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const parsed = classificationFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        fields: parsed.error.flatten().fieldErrors,
        errors: parsed.error.flatten(),
      });
    }
    const { classificationId, wasAccepted, userSelectedAccountId } = parsed.data;

    // Verify the classification belongs to a company the caller can access
    // BEFORE mutating it. Without this read-then-check, a malicious user
    // could mutate (and corrupt the training data of) any tenant's row by
    // submitting that row's id.
    const existing = await storage.getTransactionClassification(classificationId);
    if (!existing) {
      return res
        .status(404)
        .json({ code: "CLASSIFICATION_NOT_FOUND", message: "Classification not found" });
    }
    const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
    if (!hasAccess) {
      return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
    }

    // Cross-tenant guard: a feedback submission for our own classification id
    // could still smuggle a sibling company's accountId into the row. That
    // bad row then leaks back via training-data joins (e.g. autonomous-gl's
    // few-shot prompt joins user_selected_account_id and would pull the
    // foreign account name into another tenant's OpenAI context). Reject
    // outright when the account doesn't belong to this classification's
    // company.
    if (typeof userSelectedAccountId === "string") {
      const account = await storage.getAccount(userSelectedAccountId, existing.companyId);
      if (!account) {
        return res.status(403).json({
          code: "ACCOUNT_NOT_IN_COMPANY",
          message: "userSelectedAccountId does not belong to this company",
        });
      }
    }

    // Single write via recordClassificationFeedback — also invalidates the
    // cached classifier model and re-evaluates the accuracy failsafe for the
    // company that owns this classification.
    await recordClassificationFeedback(
      existing.companyId,
      classificationId,
      wasAccepted,
      userSelectedAccountId
    );

    const classification = await storage.getTransactionClassification(classificationId);
    res.json(classification);
  } catch (error: unknown) {
    res
      .status(errorStatus(error) || errorStatusCode(error) || 500)
      .json({ message: errorMessage(error), ...aiErrorBody(error) });
  }
};

/** POST /api/ai/autopilot/process */
export const handlePostAiAutopilotProcess = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const parsed = autopilotProcessSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Invalid request body",
      fields: parsed.error.flatten().fieldErrors,
      errors: parsed.error.flatten(),
    });
  }
  const { companyId, ocr } = parsed.data;
  const hasAccess = await storage.hasCompanyAccess(userId, companyId);
  if (!hasAccess)
    return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });

  // Persist any submitted image bytes through the sanitizing helper so the
  // DB only ever sees a server-generated relative path under uploads/receipts.
  let safeImagePath: string | null = null;
  let fileFacts: { contentSha256: string; fileMime: string; fileSize: number } | null = null;
  if (ocr.imageData) {
    try {
      const inspected = await inspectUpload(ocr.imageData);
      await assertWithinStorageQuota(companyId, inspected.size);
      safeImagePath = await saveReceiptFile(inspected.buffer, {
        mime: inspected.mime,
        ext: inspected.ext,
      });
      fileFacts = {
        contentSha256: inspected.sha256,
        fileMime: inspected.mime,
        fileSize: inspected.size,
      };
    } catch (err) {
      if (err instanceof UploadRejectedError) {
        return res.status(err.status).json({ message: err.message, code: err.code });
      }
      throw err;
    }
  }

  const result = await runAutopilot(companyId, userId, {
    merchant: ocr.merchant.slice(0, 200),
    amount: ocr.amount,
    vatAmount: ocr.vatAmount,
    total: ocr.total,
    currency: ocr.currency,
    date: ocr.date || new Date().toISOString().slice(0, 10),
    lineItems: ocr.lineItems,
    rawText: ocr.rawText ?? null,
    imagePath: safeImagePath,
    imageData: null,
    ...(fileFacts ?? {}),
  });
  res.json(result);
};

/** GET /api/ai/classifier-stats */
export const handleGetAiClassifierStats = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const parsed = companyIdQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ code: "COMPANY_ID_REQUIRED", message: "companyId is required (uuid)" });
  }
  const { companyId } = parsed.data;
  const hasAccess = await storage.hasCompanyAccess(userId, companyId);
  if (!hasAccess)
    return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
  const stats = await getModelStats(companyId);
  res.json(stats);
};

/** GET /api/ai/classifier-config */
export const handleGetAiClassifierConfig = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const parsed = companyIdQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ code: "COMPANY_ID_REQUIRED", message: "companyId is required (uuid)" });
  }
  const { companyId } = parsed.data;
  const hasAccess = await storage.hasCompanyAccess(userId, companyId);
  if (!hasAccess)
    return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
  const config = await getClassifierConfig(companyId);
  res.json(config);
};

/** PATCH /api/ai/classifier-config */
export const handlePatchAiClassifierConfig = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const parsed = classifierConfigPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Invalid request body",
      fields: parsed.error.flatten().fieldErrors,
      errors: parsed.error.flatten(),
    });
  }
  const { companyId, mode, accuracyThreshold, autopilotEnabled, autopostThreshold } = parsed.data;
  const hasAccess = await storage.hasCompanyAccess(userId, companyId);
  if (!hasAccess)
    return res.status(403).json({ code: "COMPANY_ACCESS_DENIED", message: "Access denied" });
  const patch: Partial<{
    mode: "hybrid" | "openai_only";
    accuracyThreshold: number;
    autopilotEnabled: boolean;
    autopostThreshold: number;
  }> = {};
  if (mode !== undefined) patch.mode = mode;
  if (accuracyThreshold !== undefined) patch.accuracyThreshold = accuracyThreshold;
  if (autopilotEnabled !== undefined) patch.autopilotEnabled = autopilotEnabled;
  if (autopostThreshold !== undefined) patch.autopostThreshold = autopostThreshold;
  const config = await setClassifierConfig(companyId, patch);
  res.json(config);
};
