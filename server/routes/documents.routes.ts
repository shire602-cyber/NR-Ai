// Authenticated downloads for privately stored files.
//
// Uploaded documents are never public: the DB holds a storage key, and the only
// way to read the bytes is through these routes, which check that the requester
// can access the document's company. Portal users are limited to their own
// company's non-archived documents (via /api/client-portal/documents/:id/download,
// the only prefix portal accounts may call).

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { sendStoredDocument } from "../services/document-upload.service";

const idParam = z.string().uuid();

export function registerDocumentRoutes(app: Express): void {
  app.get(
    "/api/documents/:documentId/download",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.documentId);
      if (!parsed.success) return res.status(404).json({ message: "Document not found" });

      const user = (req as any).user;
      const document = await storage.getDocument(parsed.data);
      if (!document) return res.status(404).json({ message: "Document not found" });

      if (!(await storage.hasCompanyAccess(user.id, document.companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const sent = await sendStoredDocument(res, {
        key: document.fileUrl,
        companyId: document.companyId,
        filename: document.fileName,
        contentType: document.mimeType,
      });
      if (!sent) return res.status(404).json({ message: "No file is stored for this document" });
    })
  );

  // Portal users are confined by authMiddleware to /api/client-portal/*, so they
  // get their own download path. They may read only their own company's
  // documents that are still shared with them (not archived).
  app.get(
    "/api/client-portal/documents/:documentId/download",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.documentId);
      if (!parsed.success) return res.status(404).json({ message: "Document not found" });

      const user = (req as any).user;
      if (user.userType !== "client_portal" && !user.isAdmin) {
        return res.status(403).json({ message: "Client portal access required" });
      }

      const document = await storage.getDocument(parsed.data);
      if (!document) return res.status(404).json({ message: "Document not found" });

      // Portal users have exactly one company; anything else is another tenant.
      const ownCompanies = await storage.getCompaniesByUserId(user.id);
      const allowed =
        ownCompanies.some((c) => c.id === document.companyId) ||
        (user.isAdmin === true && (await storage.hasCompanyAccess(user.id, document.companyId)));
      if (!allowed) return res.status(403).json({ message: "Access denied" });
      if (document.isArchived) return res.status(404).json({ message: "Document not found" });
      if (user.userType === "client_portal" && document.sharedWithPortal !== true) {
        return res.status(404).json({ message: "Document not found" });
      }

      const sent = await sendStoredDocument(res, {
        key: document.fileUrl,
        companyId: document.companyId,
        filename: document.fileName,
        contentType: document.mimeType,
      });
      if (!sent) return res.status(404).json({ message: "No file is stored for this document" });
    })
  );

  app.get(
    "/api/tax-returns-archive/:returnId/download",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params.returnId);
      if (!parsed.success) return res.status(404).json({ message: "Tax return not found" });

      const user = (req as any).user;
      const taxReturn = await storage.getTaxReturnArchiveItem(parsed.data);
      if (!taxReturn) return res.status(404).json({ message: "Tax return not found" });

      if (!(await storage.hasCompanyAccess(user.id, taxReturn.companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const sent = await sendStoredDocument(res, {
        key: taxReturn.fileUrl,
        companyId: taxReturn.companyId,
        filename: taxReturn.fileName || `${taxReturn.periodLabel || "tax-return"}.pdf`,
      });
      if (!sent) return res.status(404).json({ message: "No file is stored for this tax return" });
    })
  );
}
