/**
 * Migration import wizard API (W5-B, R19-13, R19-18, R02-16b).
 *
 *   POST /api/companies/:companyId/imports/preview              parse + map a CSV export (job: previewed)
 *   POST /api/companies/:companyId/imports/:jobId/validate      check against the books (job: validated)
 *   POST /api/companies/:companyId/imports/:jobId/commit        write it (job: committed)
 *   GET  /api/companies/:companyId/imports                      job history
 *   GET  /api/companies/:companyId/imports/:jobId               one job with rows and issues
 *   GET  /api/companies/:companyId/imports/templates/:kind      CSV template
 *   GET  /api/companies/:companyId/imports/chart-of-accounts/export   COA as CSV (round-trips)
 *
 * Imports write the ledger, so every route needs `ledger.post` (owner, admin,
 * accountant, bookkeeper).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { parsedBody } from "../http/parsed-body";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { zDate, zText, zUuid } from "../../shared/validators/primitives";
import { storage } from "../storage";
import {
  IMPORT_KINDS,
  SOURCE_SYSTEMS,
  commitImport,
  exportChartOfAccountsCsv,
  getImportJob,
  listImportJobs,
  previewImport,
  templateCsv,
  validateImport,
  type ImportKind,
} from "../services/migration-import";

const previewBody = z
  .object({
    kind: z.enum(IMPORT_KINDS),
    sourceSystem: z.enum(SOURCE_SYSTEMS),
    csv: z.string().min(1, "The file is empty").max(900_000, "File too large; split it"),
    fileName: zText(255).optional().nullable(),
    cutOverDate: zDate.optional().nullable(),
    arApMode: z.enum(["balance", "documents"]).optional().nullable(),
  })
  .strict();

function jobId(req: Request): string {
  const parsed = zUuid.safeParse(req.params.jobId);
  if (!parsed.success) throw new DomainError("NOT_FOUND", 404, undefined, "Import job not found");
  return parsed.data;
}

export function registerImportRoutes(app: Express) {
  const guard = [authMiddleware, requireCustomer, requirePermission("ledger.post")];

  app.get(
    "/api/companies/:companyId/imports",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await listImportJobs(req.params.companyId));
    })
  );

  app.get(
    "/api/companies/:companyId/imports/templates/:kind",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const kind = z.enum(IMPORT_KINDS).safeParse(req.params.kind);
      if (!kind.success) throw new DomainError("UNKNOWN_IMPORT_KIND", 404);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${kind.data}-template.csv"`);
      res.send(templateCsv(kind.data as ImportKind));
    })
  );

  app.get(
    "/api/companies/:companyId/imports/chart-of-accounts/export",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const csv = await exportChartOfAccountsCsv(req.params.companyId);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="chart-of-accounts.csv"`);
      res.send(csv);
    })
  );

  app.post(
    "/api/companies/:companyId/imports/preview",
    ...guard,
    strictBody(previewBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof previewBody>>(req);
      const job = await previewImport({
        companyId: req.params.companyId,
        userId: req.user!.id,
        kind: body.kind,
        sourceSystem: body.sourceSystem,
        csv: body.csv,
        fileName: body.fileName ?? null,
        cutOverDate: body.cutOverDate ?? null,
        arApMode: body.arApMode ?? null,
      });
      res.status(201).json(job);
    })
  );

  app.get(
    "/api/companies/:companyId/imports/:jobId",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await getImportJob(req.params.companyId, jobId(req)));
    })
  );

  app.post(
    "/api/companies/:companyId/imports/:jobId/validate",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await validateImport(req.params.companyId, jobId(req)));
    })
  );

  app.post(
    "/api/companies/:companyId/imports/:jobId/commit",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const job = await commitImport(req.params.companyId, jobId(req), req.user!.id);
      await storage.createActivityLog({
        companyId: req.params.companyId,
        userId: req.user!.id,
        action: "create",
        entityType: "import",
        entityId: job.id,
        description: `Imported ${job.kind.replace(/_/g, " ")} from ${job.sourceSystem} (${job.rowCount} rows)`,
        metadata: JSON.stringify(job.result ?? {}),
      });
      res.json(job);
    })
  );
}
