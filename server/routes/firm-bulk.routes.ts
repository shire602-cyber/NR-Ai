import { createHash } from "node:crypto";
import { assertUploadSize } from "../http/upload-errors";
import { ocrTimeoutBody, withOcrDeadline } from "../http/ocr-deadline";
import { Router } from "express";
import { parsedBody } from "../http/parsed-body";
import type { Express, Request, Response } from "express";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { firmContextOf, requireFirmAccess, requireFirmPermission } from "../middleware/rbac";
import { strictBody } from "../http/strict-body";
import {
  buildReportPack,
  bulkScopeSchema,
  importJournalsAcrossClients,
  prepareJournalImport,
  resolveBulkPeriod,
  resolveBulkTargets,
  zBulkCompanyIds,
  zBulkPeriod,
} from "../services/firm/bulk.service";
import { requireFirmCompanyMfa } from "../services/security/policy";
import { asyncHandler } from "../middleware/errorHandler";
import { db } from "../db";
import { eq, and, gte, lte, inArray, count, sum, max, not, desc } from "drizzle-orm";
import { companies, invoices, receipts, bankTransactions, vatReturns } from "../../shared/schema";
import { storage } from "../storage";
import { UAE_VAT_RATE, DEFAULT_CURRENCY } from "../constants";
import { isUaeVatRateFraction } from "../../shared/vat-classification";
import { createLogger } from "../config/logger";
import {
  createOcrClients,
  formatProviderFailures,
  summarizeOcrProviderError,
} from "../services/ocr-provider-clients";
import { AppError, errorMessage } from "../errors";
import { zPositiveFils } from "../../shared/validators/invoices";
import { createInvoiceDraft } from "./invoices.routes";
import { todayIso } from "../ledger/normalize";

const router = Router();
router.use(authMiddleware);
// Multi-firm (R15-12): every bulk endpoint is scoped to the caller's firm.
router.use(requireFirmAccess());
const log = createLogger("firm-bulk");

// ─── OCR helpers ──────────────────────────────────────────────────────────────

const BULK_VALID_CATEGORIES = [
  "Office Supplies",
  "Utilities",
  "Travel",
  "Meals",
  "Rent",
  "Marketing",
  "Equipment",
  "Professional Services",
  "Insurance",
  "Maintenance",
  "Communication",
  "Other",
];

const BULK_OCR_PROMPT = `You are an expert receipt/invoice data extraction assistant for UAE businesses.
Extract receipt data and return a JSON object with EXACTLY these fields:
{
  "merchant": "Full business/store name",
  "date": "YYYY-MM-DD format",
  "subtotal": number (amount before VAT),
  "vatPercent": number (default 5 for UAE),
  "vatAmount": number (VAT amount),
  "total": number (final total including VAT),
  "currency": "AED or other 3-letter code",
  "category": "one of: ${BULK_VALID_CATEGORIES.join(", ")}",
  "confidence": number between 0 and 1
}
Return ONLY valid JSON. No markdown.`;

/** Untrusted model JSON: every field is coerced before use. */
interface BulkOcrJson {
  merchant?: unknown;
  date?: unknown;
  subtotal?: unknown;
  vatPercent?: unknown;
  vatAmount?: unknown;
  currency?: unknown;
  category?: unknown;
}

function extractJson(raw: string): BulkOcrJson {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : raw.trim());
}

const ALLOWED_OCR_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function bulkOcrCaptureId(image: Buffer): string {
  // UUIDv8 derived from the bytes so retried uploads share the company/capture constraint.
  const hash = createHash("sha256").update("firm-bulk-ocr\0").update(image).digest();
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex", 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateBulkOcrMime(imageData: string): void {
  const dataUrlMatch = imageData.match(/^data:([^;]+);base64,/);
  if (!dataUrlMatch) {
    throw Object.assign(
      new Error("Image must be a data URL with MIME type (e.g. data:image/jpeg;base64,...)"),
      { status: 400 }
    );
  }
  const declaredMime = dataUrlMatch[1].toLowerCase();
  if (!ALLOWED_OCR_MIME_TYPES.includes(declaredMime)) {
    throw Object.assign(new Error(`Unsupported image MIME type: ${declaredMime}`), { status: 400 });
  }
}

async function runOCR(
  dataUrl: string,
  anthropic: Anthropic | null,
  openai: OpenAI | null,
  signal: AbortSignal
): Promise<{
  merchant: string;
  date: string;
  amount: number;
  vatAmount: number;
  currency: string;
  category: string;
}> {
  let rawText = "";
  const failures: Array<{ provider: "Anthropic" | "OpenAI"; error: unknown }> = [];
  if (anthropic) {
    try {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) throw new Error("Invalid image data URL");
      const mediaType = match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      const base64Data = match[2];
      const response = await anthropic.messages.create(
        {
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType, data: base64Data },
                },
                { type: "text", text: BULK_OCR_PROMPT },
              ],
            },
          ],
        },
        { signal }
      );
      const block = response.content[0];
      if (block.type !== "text") throw new Error("Unexpected Anthropic response type");
      rawText = block.text;
    } catch (err) {
      signal.throwIfAborted();
      failures.push({ provider: "Anthropic", error: err });
      if (openai) {
        log.warn(
          { err: summarizeOcrProviderError(err) },
          "Anthropic bulk OCR failed; trying OpenAI"
        );
      }
    }
  }

  if (!rawText && openai) {
    signal.throwIfAborted();
    try {
      const aiResponse = await openai.chat.completions.create(
        {
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
                { type: "text", text: BULK_OCR_PROMPT },
              ],
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1000,
        },
        { signal }
      );
      const raw = aiResponse.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty OpenAI response");
      rawText = raw;
    } catch (err) {
      signal.throwIfAborted();
      failures.push({ provider: "OpenAI", error: err });
    }
  }

  if (!rawText) {
    throw new Error(
      failures.length ? formatProviderFailures(failures) : "No OCR API client available"
    );
  }

  const result = extractJson(rawText);
  const subtotal = parseFloat(String(result.subtotal)) || 0;
  const parsedVatPercent = parseFloat(String(result.vatPercent));
  const vatPercent = Number.isFinite(parsedVatPercent) ? parsedVatPercent : 5;
  const vatAmount =
    parseFloat(String(result.vatAmount)) || parseFloat(((subtotal * vatPercent) / 100).toFixed(2));
  const category =
    typeof result.category === "string" && BULK_VALID_CATEGORIES.includes(result.category)
      ? result.category
      : "Other";
  let parsedDate = new Date().toISOString().split("T")[0];
  if (typeof result.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
    parsedDate = result.date;
  }

  return {
    merchant: result.merchant ? String(result.merchant).slice(0, 200) : "Unknown Merchant",
    date: parsedDate,
    amount: subtotal,
    vatAmount,
    currency: result.currency
      ? String(result.currency).slice(0, 3).toUpperCase()
      : DEFAULT_CURRENCY,
    category,
  };
}

// ─── POST /api/firm/bulk/ocr ──────────────────────────────────────────────────

const bulkOcrSchema = z.object({
  items: z
    .array(
      z.object({
        companyId: z.string().guid(),
        imageData: z.string().min(1),
        filename: z.string().optional(),
      })
    )
    .min(1)
    .max(20),
});

router.post(
  "/bulk/ocr",
  requireFirmPermission("firm.clients.write"),
  strictBody(bulkOcrSchema),
  withOcrDeadline(async (req, res, signal, waitForStep) => {
    const { id: userId } = req.user!;
    const { items } = parsedBody<z.output<typeof bulkOcrSchema>>(req);
    await waitForStep(
      resolveBulkTargets(
        firmContextOf(res),
        items.map((item) => item.companyId),
        { required: true }
      )
    );

    const uploads = items.map((item) => {
      const bytes = Buffer.from(item.imageData.replace(/^data:[^;]+;base64,/, ""), "base64");
      assertUploadSize(bytes.length);
      return { ...item, captureId: bulkOcrCaptureId(bytes) };
    });
    const { anthropic, openai } = createOcrClients();
    if (!anthropic && !openai) {
      return res
        .status(503)
        .json({ message: "OCR service unavailable — set ANTHROPIC_API_KEY or OPENAI_API_KEY" });
    }

    const results: Array<{
      companyId: string;
      filename?: string;
      success: boolean;
      receiptId?: string;
      error?: string;
    }> = [];

    for (const item of uploads) {
      try {
        signal.throwIfAborted();
        validateBulkOcrMime(item.imageData);
        let receipt = await waitForStep(storage.getCapturedReceipt(item.companyId, item.captureId));
        if (!receipt) {
          const extracted = await waitForStep(runOCR(item.imageData, anthropic, openai, signal));
          // The unique capture ID makes this safe to retry even if COMMIT outlives the deadline.
          const saved = await waitForStep(
            storage.createCapturedReceipt(
              {
                companyId: item.companyId,
                captureId: item.captureId,
                merchant: extracted.merchant,
                date: extracted.date ? new Date(extracted.date) : null,
                amount: extracted.amount,
                vatAmount: extracted.vatAmount,
                currency: extracted.currency,
                exchangeRate: 1,
                baseCurrencyAmount: extracted.amount,
                category: extracted.category,
                posted: false,
                uploadedBy: userId,
              },
              true,
              signal
            )
          );
          if (!saved.receipt) throw new Error("Unable to save bulk OCR receipt");
          receipt = saved.receipt;
        }
        results.push({
          companyId: item.companyId,
          filename: item.filename,
          success: true,
          receiptId: receipt.id,
        });
      } catch (err: unknown) {
        if (signal.aborted) {
          return res.status(504).json({ ...ocrTimeoutBody, results });
        }
        results.push({
          companyId: item.companyId,
          filename: item.filename,
          success: false,
          error: errorMessage(err) || "OCR failed",
        });
      }
    }

    res.json({ results });
  })
);

// ─── POST /api/firm/bulk/vat-queue ────────────────────────────────────────────

router.post(
  "/bulk/vat-queue",
  strictBody(bulkScopeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    // R15-07: shared bulk contract { companyIds?, period? } (docs/api/firm-bulk.md).
    const scope = parsedBody<z.output<typeof bulkScopeSchema>>(req);
    const targetIds = await resolveBulkTargets(firmContextOf(res), scope.companyIds);
    if (!(await requireFirmCompanyMfa(req.user!, res, targetIds))) return;
    const clientCompanies: (typeof companies.$inferSelect)[] = targetIds.length
      ? await db.select().from(companies).where(inArray(companies.id, targetIds))
      : [];

    // Restrict aggregation to the requested (default: current) quarter so the
    // queue reflects only the live VAT period rather than all-time totals.
    const resolved = resolveBulkPeriod(scope.period);
    const period = resolved.label;
    const periodStart = new Date(`${resolved.start}T00:00:00`);
    const periodEnd = new Date(`${resolved.end}T23:59:59`);

    const queue = await Promise.all(
      clientCompanies.map(async (company) => {
        const [salesRow] = await db
          .select({ total: sum(invoices.subtotal), vat: sum(invoices.vatAmount) })
          .from(invoices)
          .where(
            and(
              eq(invoices.companyId, company.id),
              gte(invoices.date, periodStart),
              lte(invoices.date, periodEnd),
              not(inArray(invoices.status, ["draft", "void", "cancelled"]))
            )
          );

        const [purchasesRow] = await db
          .select({ total: sum(receipts.amount), vat: sum(receipts.vatAmount) })
          .from(receipts)
          .where(
            and(
              eq(receipts.companyId, company.id),
              eq(receipts.posted, true),
              gte(receipts.date, periodStart),
              lte(receipts.date, periodEnd)
            )
          );

        const [latestVat] = await db
          .select({ status: vatReturns.status })
          .from(vatReturns)
          .where(eq(vatReturns.companyId, company.id))
          .orderBy(desc(vatReturns.periodEnd))
          .limit(1);

        const totalSales = Number(salesRow?.total ?? 0);
        const totalPurchases = Number(purchasesRow?.total ?? 0);
        const salesVat = Number(salesRow?.vat ?? 0);
        const purchasesVat = Number(purchasesRow?.vat ?? 0);
        const vatPayable = Math.max(0, salesVat - purchasesVat);

        return {
          companyId: company.id,
          companyName: company.name,
          trn: company.trnVatNumber ?? "N/A",
          period,
          totalSales,
          totalPurchases,
          vatPayable,
          status: (latestVat?.status ?? "draft") as string,
        };
      })
    );

    res.json(queue);
  })
);

// ─── POST /api/firm/bulk/invoices ─────────────────────────────────────────────

const bulkInvoicesSchema = z.object({
  companyIds: zBulkCompanyIds,
  period: zBulkPeriod.optional(),
  serviceDescription: z.string().min(1).max(500),
  amount: z.number().transform((amount, ctx) => {
    const result = zPositiveFils.safeParse(amount);
    if (result.success) return result.data;
    for (const issue of result.error.issues)
      ctx.addIssue({ code: "custom", message: issue.message });
    return z.NEVER;
  }),
  vatRate: z
    .number()
    .refine(isUaeVatRateFraction, "VAT rate must be 0% or 5%")
    .default(UAE_VAT_RATE),
});

router.post(
  "/bulk/invoices",
  requireFirmPermission("firm.clients.write"),
  strictBody(bulkInvoicesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { serviceDescription, amount, vatRate, ...scope } =
      parsedBody<z.output<typeof bulkInvoicesSchema>>(req);
    const companyIds = await resolveBulkTargets(firmContextOf(res), scope.companyIds, {
      required: true,
    });

    const targetCompanies = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(inArray(companies.id, companyIds));

    const date = todayIso();

    const results: Array<{
      companyId: string;
      companyName: string;
      success: boolean;
      invoiceId?: string;
      invoiceNumber?: string;
      error?: string;
      code?: string;
    }> = [];

    for (const company of targetCompanies) {
      try {
        const { invoice } = await createInvoiceDraft(company.id, {
          customerName: company.name,
          customerTrn: undefined,
          date,
          currency: DEFAULT_CURRENCY,
          lines: [
            {
              description: serviceDescription,
              quantity: 1,
              unitPrice: amount,
              vatRate,
              vatSupplyType: vatRate === 0 ? "zero_rated" : "standard_rated",
            },
          ],
        });

        results.push({
          companyId: company.id,
          companyName: company.name,
          success: true,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
        });
      } catch (err: unknown) {
        results.push({
          companyId: company.id,
          companyName: company.name,
          success: false,
          error: err instanceof AppError ? err.message : "Invoice creation failed",
          code: err instanceof AppError ? err.code : undefined,
        });
      }
    }

    res.json({ results });
  })
);

// ─── POST /api/firm/bulk/period-close ────────────────────────────────────────

// R15-07: same contract as every bulk endpoint — period is optional (default:
// current quarter) instead of the old required free-text field.
router.post(
  "/bulk/period-close",
  strictBody(bulkScopeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = parsedBody<z.output<typeof bulkScopeSchema>>(req);
    const period = resolveBulkPeriod(scope.period).label;
    const companyIds = await resolveBulkTargets(firmContextOf(res), scope.companyIds);
    if (companyIds.length === 0) return res.json([]);

    const targetCompanies = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(inArray(companies.id, companyIds));

    const statuses = await Promise.all(
      targetCompanies.map(async (company: { id: string; name: string }) => {
        const issues: string[] = [];

        // Check unposted receipts
        const [unpostedReceipts] = await db
          .select({ cnt: count() })
          .from(receipts)
          .where(and(eq(receipts.companyId, company.id), eq(receipts.posted, false)));
        const allReceiptsPosted = Number(unpostedReceipts?.cnt ?? 0) === 0;
        if (!allReceiptsPosted) issues.push(`${unpostedReceipts?.cnt} unposted receipt(s)`);

        // Check unreconciled bank transactions
        const [unreconciledTx] = await db
          .select({ cnt: count() })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.companyId, company.id),
              eq(bankTransactions.isReconciled, false)
            )
          );
        const bankRecDone = Number(unreconciledTx?.cnt ?? 0) === 0;
        if (!bankRecDone) issues.push(`${unreconciledTx?.cnt} unreconciled transaction(s)`);

        // Check VAT return prepared
        const [latestVat] = await db
          .select({ status: vatReturns.status })
          .from(vatReturns)
          .where(eq(vatReturns.companyId, company.id))
          .orderBy(desc(vatReturns.periodEnd))
          .limit(1);
        const vatStatus = latestVat?.status ?? "none";
        const vatPrepared = vatStatus !== "none" && vatStatus !== "draft";
        if (!vatPrepared) issues.push("VAT return not prepared");

        // Trial balance: check invoices and receipts are balanced (simplified check)
        const [invoiceSum] = await db
          .select({ total: sum(invoices.total) })
          .from(invoices)
          .where(eq(invoices.companyId, company.id));
        const [receiptSum] = await db
          .select({ total: sum(receipts.amount) })
          .from(receipts)
          .where(eq(receipts.companyId, company.id));
        const hasActivity =
          Number(invoiceSum?.total ?? 0) > 0 || Number(receiptSum?.total ?? 0) > 0;
        const trialBalanceOk = hasActivity;
        if (!hasActivity) issues.push("No financial activity found");

        return {
          companyId: company.id,
          companyName: company.name,
          period,
          checks: {
            trialBalanceOk,
            bankRecDone,
            allReceiptsPosted,
            vatPrepared,
          },
          issues,
          readyToClose: issues.length === 0,
        };
      })
    );

    res.json(statuses);
  })
);

// ─── GET /api/firm/bulk/bank-import-status ────────────────────────────────────

router.get(
  "/bulk/bank-import-status",
  asyncHandler(async (req: Request, res: Response) => {
    const companyIds = await resolveBulkTargets(firmContextOf(res), undefined);
    if (!(await requireFirmCompanyMfa(req.user!, res, companyIds))) return;
    if (!companyIds.length) return res.json([]);
    const clientCompanies = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(inArray(companies.id, companyIds));

    const statuses = await Promise.all(
      clientCompanies.map(async (company) => {
        const [lastImport] = await db
          .select({ lastDate: max(bankTransactions.createdAt) })
          .from(bankTransactions)
          .where(eq(bankTransactions.companyId, company.id));

        const [totalTx] = await db
          .select({ cnt: count() })
          .from(bankTransactions)
          .where(eq(bankTransactions.companyId, company.id));

        const [reconciledTx] = await db
          .select({ cnt: count() })
          .from(bankTransactions)
          .where(
            and(eq(bankTransactions.companyId, company.id), eq(bankTransactions.isReconciled, true))
          );

        const [unreconciledTx] = await db
          .select({ cnt: count() })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.companyId, company.id),
              eq(bankTransactions.isReconciled, false)
            )
          );

        const total = Number(totalTx?.cnt ?? 0);
        const reconciled = Number(reconciledTx?.cnt ?? 0);
        const unreconciled = Number(unreconciledTx?.cnt ?? 0);
        const matchRate = total > 0 ? Math.round((reconciled / total) * 100) : 0;

        return {
          companyId: company.id,
          companyName: company.name,
          lastImportDate: lastImport?.lastDate ?? null,
          unreconciledCount: unreconciled,
          totalTransactions: total,
          matchRate,
        };
      })
    );

    res.json(statuses);
  })
);

// ─── POST /api/firm/bulk/journal-import (R15-16) ──────────────────────────────
// One CSV for many clients; each entry validated per client and posted through
// server/ledger. dryRun validates only. Per-row errors are returned.

const journalImportSchema = z.object({
  csv: z.string().min(1, "csv is required").max(2_000_000, "csv is limited to 2 MB"),
  dryRun: z.boolean().optional(),
});

router.post(
  "/bulk/journal-import",
  requireFirmPermission("firm.bulk.run"),
  strictBody(journalImportSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = parsedBody<z.output<typeof journalImportSchema>>(req);
    const ctx = firmContextOf(res);
    const plan = await prepareJournalImport(ctx, body.csv);
    if (!(await requireFirmCompanyMfa(req.user!, res, plan.companyIds))) return;
    const result = await importJournalsAcrossClients(ctx, plan, {
      dryRun: body.dryRun,
      req,
    });
    const status = result.summary.posted + result.summary.replayed > 0 || body.dryRun ? 200 : 422;
    res.status(status).json(result);
  })
);

// ─── POST /api/firm/bulk/report-pack (R15-16) ────────────────────────────────
// Zip of one trial-balance workbook per client for the period.

router.post(
  "/bulk/report-pack",
  strictBody(bulkScopeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = parsedBody<z.output<typeof bulkScopeSchema>>(req);
    const ctx = firmContextOf(res);
    const companyIds = await resolveBulkTargets(ctx, scope.companyIds);
    if (companyIds.length === 0) {
      return res.status(400).json({
        message: "Validation error",
        code: "BULK_VALIDATION_ERROR",
        fields: { companyIds: ["No accessible clients to include"] },
      });
    }
    if (!(await requireFirmCompanyMfa(req.user!, res, companyIds))) return;
    const period = resolveBulkPeriod(scope.period);
    const pack = await buildReportPack(ctx, companyIds, period);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="client-report-pack-${period.start}-${period.end}.zip"`
    );
    res.setHeader("X-Report-Pack-Files", String(pack.files.length));
    res.send(Buffer.from(pack.zip));
  })
);

// ─── Registration ──────────────────────────────────────────────────────────────

export function registerFirmBulkRoutes(app: Express): void {
  app.use("/api/firm", router);
}
