// FTA Audit File (FAF) download. UAE businesses must be able to produce it on
// request. The file is streamed (see faf-export.service.ts) and the column
// layout (faf-format.ts) must be verified against the FTA's published FAF
// specification before it is relied on for a real audit.

import type { Express, Request, Response } from "express";
import { once } from "node:events";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";
import {
  createDbFafSource,
  emptyFafTotals,
  streamFaf,
  validateFafRange,
} from "../services/faf-export.service";
import { FAF_PRODUCT_NAME } from "../services/faf-format";
import { createLogger } from "../config/logger";
import { uaeTodayYmd } from "../services/vat-period-status.service";

const log = createLogger("faf");
const PRODUCT_VERSION = `${FAF_PRODUCT_NAME} ${process.env.npm_package_version ?? "1.0.0"}`;

export function registerFafRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/reports/fta-audit-file",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const range = validateFafRange(req.query.from, req.query.to);
      if (!range.ok) {
        return res.status(400).json({ message: range.message, code: range.code });
      }
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });
      if (!company.trnVatNumber) {
        return res.status(422).json({
          message: "The company needs a TRN before an FTA Audit File can be produced. Add it in the company profile.",
          code: "NO_TRN",
        });
      }

      const totals = emptyFafTotals();
      const stream = streamFaf(
        createDbFafSource(companyId, range.from, range.to),
        {
          companyName: company.name,
          trn: company.trnVatNumber,
          from: range.from,
          to: range.to,
          createdOn: uaeTodayYmd(),
          productVersion: PRODUCT_VERSION,
        },
        totals
      );

      const filename = `FAF_${company.trnVatNumber}_${range.from}_${range.to}.csv`;
      res.status(200);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");

      let aborted = false;
      res.on("close", () => {
        aborted = !res.writableEnded;
      });
      try {
        for await (const chunk of stream) {
          if (aborted) return;
          if (!res.write(chunk)) await once(res, "drain");
        }
        res.end();
      } catch (err) {
        // Headers are already sent: cut the connection so a truncated file (which has no closing
        // block marker) can never be mistaken for a complete one.
        log.error({ err: (err as Error).message, companyId }, "FAF export failed mid-stream");
        res.destroy(err as Error);
        return;
      }

      await recordAudit({
        userId,
        companyId,
        action: "report.faf_export",
        entityType: "report",
        entityId: "fta-audit-file",
        extra: {
          from: range.from,
          to: range.to,
          purchaseLines: totals.purchases.count,
          supplyLines: totals.supplies.count,
          ledgerLines: totals.ledger.count,
        },
        req,
      });
    })
  );
}
