import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';

export function registerDocumentVersionRoutes(app: Express) {
  // =====================================
  // DOCUMENT VERSION HISTORY (Audit Trail)
  // =====================================

  // Get version history for a specific document
  app.get("/api/companies/:companyId/document-versions/:documentType/:documentId", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { companyId, documentType, documentId } = req.params;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const validTypes = ['invoice', 'quote', 'credit_note', 'purchase_order', 'receipt'];
    if (!validTypes.includes(documentType)) {
      return res.status(400).json({ message: `Invalid document type. Must be one of: ${validTypes.join(', ')}` });
    }

    const versions = await storage.getDocumentVersions(companyId, documentType, documentId);
    res.json(versions);
  }));

  // Create a new version snapshot for a document
  app.post("/api/companies/:companyId/document-versions", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { companyId } = req.params;
    const { documentType, documentId, changeDescription, snapshotData } = req.body;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!documentType || !documentId) {
      return res.status(400).json({ message: 'documentType and documentId are required' });
    }

    const validTypes = ['invoice', 'quote', 'credit_note', 'purchase_order', 'receipt'];
    if (!validTypes.includes(documentType)) {
      return res.status(400).json({ message: `Invalid document type. Must be one of: ${validTypes.join(', ')}` });
    }

    // Auto-increment version number
    const existingCount = await storage.getDocumentVersionCount(companyId, documentType, documentId);
    const nextVersion = existingCount + 1;

    const version = await storage.createDocumentVersion({
      companyId,
      documentType,
      documentId,
      version: nextVersion,
      changeDescription: changeDescription || null,
      changedBy: userId,
      snapshotData: snapshotData ? JSON.stringify(snapshotData) : null,
    });

    res.status(201).json(version);
  }));
}
