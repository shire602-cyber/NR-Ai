import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { db } from "../db";
import { companies } from "../../shared/schema";
import { storage } from "../storage";
import { AppError } from "../errors";
import { storeUploadedFile } from "../services/document-upload.service";
import { parsePdfStatementText } from "../services/bank-statement-parsers";
import { extractStatementWithAi, isAiStatementConfigured, MAX_AI_PAGES, type AiOutcome } from "../services/bank-statement-ai";
import {
  MAX_COMMIT_ROWS,
  commitStagedImport,
  createStagedImport,
  discardStagedImport,
  getImport,
  listImports,
  unprocessable,
  type StagedRow,
} from "../services/bank-import.service";
import { assertCanPostBanking } from "../services/bank-access";
import { recordAudit } from "../services/audit.service";
import { createLogger } from "../config/logger";

const log = createLogger("bank-statement-imports");

const uuid = z.string().uuid();
const companyParams = z.object({ companyId: uuid }).passthrough();
const importParams = z.object({ companyId: uuid, importId: uuid }).passthrough();

const MAX_PAGE_CHARS = 200_000;

const pdfImportSchema = z.object({
  bankAccountId: uuid,
  fileName: z.string().min(1).max(255),
  fileData: z.string().min(20),
  pages: z.array(z.string()).max(10).default([]),
});

const commitSchema = z.object({
  rows: z
    .array(
      z.object({
        date: z.string(),
        valueDate: z.string().nullable().optional(),
        description: z.string().max(500),
        reference: z.string().max(120).nullable().optional().transform((v) => v ?? null),
        amount: z.number(),
        balance: z.number().nullable().optional().transform((v) => v ?? null),
      })
    )
    .max(MAX_COMMIT_ROWS),
});

/** Number of /Type /Page objects in the PDF bytes (cheap page count; /Pages nodes are not counted). */
export function countPdfPages(base64: string): number {
  const raw = base64.replace(/^data:[^,]*,/, "");
  const text = Buffer.from(raw, "base64").toString("latin1");
  return (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

export function registerBankStatementImportRoutes(app: Express) {
  const guard = [authMiddleware, requireCustomer, validate({ params: companyParams }), requireCompanyAccess("params")];

  // Whether scanned PDF statements may be read by the AI provider (default off).
  app.get(
    "/api/companies/:companyId/bank-statements/settings",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const [row] = await db.select({ on: companies.bankPdfAiFallback }).from(companies).where(eq(companies.id, req.params.companyId));
      res.json({ pdfAiFallback: row?.on === true, aiConfigured: isAiStatementConfigured(), maxAiPages: MAX_AI_PAGES });
    })
  );

  app.put(
    "/api/companies/:companyId/bank-statements/settings",
    ...guard,
    validate({ body: z.object({ pdfAiFallback: z.boolean() }) }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCanPostBanking(req.user!.id, companyId);
      await db.update(companies).set({ bankPdfAiFallback: req.body.pdfAiFallback }).where(eq(companies.id, companyId));
      await recordAudit({ userId: req.user!.id, companyId, action: "bank.settings", entityType: "company", entityId: companyId, after: { pdfAiFallback: req.body.pdfAiFallback }, req });
      res.json({ pdfAiFallback: req.body.pdfAiFallback, aiConfigured: isAiStatementConfigured(), maxAiPages: MAX_AI_PAGES });
    })
  );

  // PDF statement: text (extracted in the browser) -> staged rows for the review grid.
  app.post(
    "/api/companies/:companyId/bank-statements/imports/pdf",
    ...guard,
    validate({ body: pdfImportSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const { bankAccountId, fileName, fileData, pages } = req.body as z.infer<typeof pdfImportSchema>;

      const account = await storage.getBankAccountById(bankAccountId);
      if (!account || account.companyId !== companyId) throw new AppError({ message: "Bank account not found", statusCode: 404, code: "BANK_ACCOUNT_NOT_FOUND" });
      if (pages.some((p) => p.length > MAX_PAGE_CHARS) || pages.reduce((n, p) => n + p.length, 0) > MAX_PAGE_CHARS) {
        throw unprocessable("STATEMENT_TEXT_TOO_LARGE", `The extracted text is larger than ${MAX_PAGE_CHARS} characters.`);
      }

      // validate and keep the PDF (type, size and magic bytes are checked there); a storage outage is a warning
      const warnings: string[] = [];
      let storedKey: string | null = null;
      try {
        const stored = await storeUploadedFile({ companyId, category: "bank-statements", fileName, mimeType: "application/pdf", fileData, uploadedBy: userId });
        storedKey = stored.key;
      } catch (err) {
        if (err instanceof AppError && err.statusCode < 500) throw err;
        log.warn({ err: (err as Error).message }, "Statement PDF could not be stored");
        warnings.push("STATEMENT_FILE_NOT_STORED: the original file could not be kept.");
      }

      const pageCount = countPdfPages(fileData);
      if (pageCount > pages.length && pages.length > 0) warnings.push(`PDF_PAGES_NOT_READ: the file has ${pageCount} pages; the text of ${pages.length} was sent.`);

      let parsed = parsePdfStatementText(pages);
      let parser: "text" | "ai" = "text";
      let ai: "off" | "not_configured" | "failed" | "too_long" | null = null;
      if (parsed.rows.length === 0) {
        const [row] = await db.select({ on: companies.bankPdfAiFallback }).from(companies).where(eq(companies.id, companyId));
        if (!row?.on) ai = "off";
        else if (pageCount > MAX_AI_PAGES) ai = "too_long";
        else {
          const outcome: AiOutcome = await extractStatementWithAi({ pages, pdfBase64: fileData.replace(/^data:[^,]*,/, "") });
          if (outcome.status === "ok") {
            parsed = outcome.result;
            parser = "ai";
            warnings.push("AI_EXTRACTED: these rows were read by the AI provider; check every row before importing.");
          } else ai = outcome.status === "not_configured" ? "not_configured" : "failed";
        }
      }
      if (parsed.rows.length === 0) {
        throw unprocessable(
          "PDF_NO_TRANSACTIONS",
          ai === "not_configured"
            ? "No transactions were found in the PDF text, and the AI provider is not configured."
            : "No transactions were found in the PDF. A scanned statement needs OCR text or the AI fallback.",
          { ai }
        );
      }

      const staged = await createStagedImport({
        companyId,
        userId,
        account,
        filename: fileName,
        parser,
        rows: parsed.rows as StagedRow[],
        summary: { from: parsed.statementFrom, to: parsed.statementTo, openingBalance: parsed.openingBalance, closingBalance: parsed.closingBalance, currency: account.currency },
        storedFileKey: storedKey,
        warnings,
      });
      res.status(201).json({
        importId: staged.id,
        status: "staged",
        parser,
        rows: parsed.rows,
        statement: { from: parsed.statementFrom, to: parsed.statementTo, openingBalance: parsed.openingBalance, closingBalance: parsed.closingBalance, currency: account.currency },
        warnings,
      });
    })
  );

  app.get(
    "/api/companies/:companyId/bank-statements/imports",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const bankAccountId = typeof req.query.bankAccountId === "string" && uuid.safeParse(req.query.bankAccountId).success ? req.query.bankAccountId : undefined;
      res.json(await listImports(req.params.companyId, bankAccountId));
    })
  );

  app.get(
    "/api/companies/:companyId/bank-statements/imports/:importId",
    authMiddleware,
    requireCustomer,
    validate({ params: importParams }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const row = await getImport(req.params.companyId, req.params.importId);
      if (!row) throw new AppError({ message: "Import not found", statusCode: 404, code: "IMPORT_NOT_FOUND" });
      res.json({ ...row, rows: row.stagedRows ?? [] });
    })
  );

  app.post(
    "/api/companies/:companyId/bank-statements/imports/:importId/commit",
    authMiddleware,
    requireCustomer,
    validate({ params: importParams, body: commitSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, importId } = req.params;
      const outcome = await commitStagedImport({ companyId, userId: req.user!.id, importId, rows: req.body.rows as StagedRow[] });
      res.status(201).json({ ...outcome, detectedFormat: outcome.format });
    })
  );

  app.post(
    "/api/companies/:companyId/bank-statements/imports/:importId/discard",
    authMiddleware,
    requireCustomer,
    validate({ params: importParams }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      await discardStagedImport(req.params.companyId, req.params.importId);
      res.json({ status: "discarded" });
    })
  );
}
