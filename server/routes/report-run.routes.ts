import type { Express, Request, Response } from "express";
import { authMiddleware, requireCompanyAccess } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { buildLimiter } from "../middleware/rateLimit";
import { storage } from "../storage";
import { canViewSensitive } from "../reports/access";
import { getReport } from "../reports/registry";
import { prepareReportRun, renderReportFile, runReport } from "../reports/service";

// Exports (CSV / XLSX / PDF) cost a render; the JSON form is paginated and cheap.
const exportLimiter = buildLimiter({
  windowMs: 60_000,
  max: 120, // a month-end pack is dozens of files; the render cost is bounded by the per-request row cap
  message: "Too many report exports. Wait a minute and try again.",
  skipIf: (req) => {
    const f = req.query?.format;
    return f === undefined || f === "" || f === "json";
  },
});

/**
 * Phase 8 D4: the one run route for every server report.
 * GET /api/companies/:companyId/reports/run/:reportId?from&to&asOf&compare...&format=json|csv|xlsx|pdf&lang=en|ar
 */
export function registerReportRunRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/reports/run/:reportId",
    authMiddleware,
    requireCompanyAccess("params"),
    exportLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, reportId } = req.params;
      const user = (req as any).user as { id: string; isAdmin?: boolean; firmRole?: string | null };

      // Role first: a user who may not see a sensitive report learns nothing about it (not even a parameter error).
      const known = getReport(reportId);
      if (known?.sensitive && !(await canViewSensitive(user, companyId))) {
        return res.status(403).json({ message: "This report is limited to owners, accountants and CFOs.", code: "ROLE_FORBIDDEN" });
      }

      const prepared = await prepareReportRun(companyId, reportId, req.query as Record<string, unknown>);
      if (!prepared.ok) return res.status(prepared.issue.status).json({ message: prepared.issue.message, code: prepared.issue.code });
      const { report, company, params } = prepared;

      let result;
      try {
        result = await runReport({
          report,
          company,
          params,
          userId: user.id,
          paginate: params.format === "json",
          canAccessCompany: (id) => (id === companyId ? Promise.resolve(true) : storage.hasCompanyAccess(user.id, id)),
        });
      } catch (err: any) {
        // 42P01: a table the report reads is not installed in this database.
        if (err?.code === "42P01") {
          return res.status(409).json({ message: "This report is not available yet.", code: "REPORT_NOT_AVAILABLE" });
        }
        throw err;
      }

      if (params.format === "json") {
        res.setHeader("Cache-Control", "private, no-store");
        return res.json(result);
      }
      const file = await renderReportFile(result, params.format, company.name, params.lang);
      res.setHeader("Content-Type", file.mime);
      res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(file.buffer);
    })
  );
}
