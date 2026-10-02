/**
 * D5 migration wizard: upload -> mapping -> dry run -> commit, plus the opening
 * position step. Owner and accountant only; every query is scoped by the
 * company in the URL and the job must belong to it.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";

import { authMiddleware, requireCustomer } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { asyncHandler } from "../middleware/errorHandler";
import { recordAudit } from "../services/audit.service";
import { MAX_IMPORT_BYTES } from "../services/import/parse";
import {
  ImportError,
  commitJob,
  commitOpening,
  createJob,
  dryRun,
  getJobForCompany,
  listJobs,
  listRows,
  presentJob,
  previewOpening,
  saveMapping,
} from "../services/import/jobs";

const base = "/api/companies/:companyId";

const uploadSchema = z.object({
  source: z.string().max(20),
  entity: z.string().max(30),
  filename: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
});

const mappingSchema = z.object({
  mapping: z.record(z.string(), z.string().nullable()).transform((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? ""]))),
  options: z
    .object({
      dateFormat: z.string().optional(),
      numberFormat: z.string().optional(),
      goLiveDate: z.string().optional(),
      currency: z.string().optional(),
      defaultContactType: z.string().optional(),
      foldProfitAndLoss: z.boolean().optional(),
    })
    .strict()
    .optional(),
});

const openingSchema = z.object({
  tbJobId: z.string(),
  invoicesJobId: z.string().optional().nullable(),
  billsJobId: z.string().optional().nullable(),
  asOfDate: z.string().optional(),
});

function decodeBase64(input: string): Buffer {
  const raw = input.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new ImportError(400, "FILE_ENCODING_INVALID", "contentBase64 is not valid base64");
  const buf = Buffer.from(raw, "base64");
  if (buf.length > MAX_IMPORT_BYTES) throw new ImportError(413, "FILE_TOO_LARGE", "The file is larger than 5 MB");
  return buf;
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ImportError) {
        return res.status(err.status).json({ message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
      }
      throw err;
    }
  });
}

export function registerImportJobRoutes(app: Express): void {
  const guard = [authMiddleware, requireCustomer, requireRole("owner", "accountant")] as const;

  app.post(
    `${base}/import-jobs`,
    ...guard,
    handle(async (req, res) => {
      const body = uploadSchema.safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "source, entity, filename and contentBase64 are required", code: "VALIDATION_ERROR" });
      const content = decodeBase64(body.data.contentBase64);
      const created = await createJob({
        companyId: req.params.companyId,
        userId: req.user!.id,
        source: body.data.source,
        entity: body.data.entity,
        filename: body.data.filename,
        content,
      });
      await recordAudit({ userId: req.user!.id, companyId: req.params.companyId, action: "import.upload", entityType: "import_job", entityId: created.job.id, after: { source: body.data.source, entity: body.data.entity, rows: created.job.rowCount }, req });
      res.status(201).json(created);
    })
  );

  app.get(
    `${base}/import-jobs`,
    ...guard,
    handle(async (req, res) => {
      res.json(await listJobs(req.params.companyId));
    })
  );

  app.get(
    `${base}/import-jobs/:id`,
    ...guard,
    handle(async (req, res) => {
      res.json(presentJob(await getJobForCompany(req.params.companyId, req.params.id)));
    })
  );

  app.put(
    `${base}/import-jobs/:id/mapping`,
    ...guard,
    handle(async (req, res) => {
      const body = mappingSchema.safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "mapping must map field names to column names", code: "VALIDATION_ERROR" });
      res.json(await saveMapping(req.params.companyId, req.params.id, body.data));
    })
  );

  app.post(
    `${base}/import-jobs/:id/dry-run`,
    ...guard,
    handle(async (req, res) => {
      res.json(await dryRun(req.params.companyId, req.params.id));
    })
  );

  app.post(
    `${base}/import-jobs/:id/commit`,
    ...guard,
    handle(async (req, res) => {
      res.json(await commitJob(req.params.companyId, req.params.id, req.user!, req));
    })
  );

  app.get(
    `${base}/import-jobs/:id/rows`,
    ...guard,
    handle(async (req, res) => {
      const page = Math.max(1, Number(req.query.page) || 1);
      const perPage = Math.min(200, Math.max(1, Number(req.query.perPage) || 50));
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const out = await listRows(req.params.companyId, req.params.id, { status, page, perPage });
      res.setHeader("X-Total-Count", String(out.total));
      res.setHeader("X-Page", String(page));
      res.setHeader("X-Per-Page", String(perPage));
      res.json(out.rows);
    })
  );

  // Preview the opening position; ?commit=1 posts it through the opening-balance service.
  app.post(
    `${base}/import-opening`,
    ...guard,
    handle(async (req, res) => {
      const body = openingSchema.safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "tbJobId is required", code: "VALIDATION_ERROR" });
      const companyId = req.params.companyId;
      if (req.query.commit === "1" || req.query.commit === "true") {
        const actor = { id: req.user!.id, isAdmin: req.user!.isAdmin, firmRole: req.user!.firmRole };
        const done = await commitOpening(companyId, body.data, actor, req);
        return res.status(201).json(done);
      }
      res.json(await previewOpening(companyId, body.data));
    })
  );
}
