import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storeUploadedFile, removeStoredFile } from "../services/document-upload.service";
import { recordAudit } from "../services/audit.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerPortalRoutes(app: Express) {
  // =====================================
  // CUSTOMER ACTIVITY LOGS (History)
  // =====================================

  // Get activity logs for user's company
  app.get(
    "/api/companies/:companyId/activity-logs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      // Phase 8 D4: `limit` is capped (it used to be unbounded); the full trail is the paginated Audit Trail report.
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 1000);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const logs = await storage.getActivityLogsByCompany(companyId, limit);
      res.json(logs);
    })
  );

  // =====================================
  // CLIENT PORTAL - DOCUMENT VAULT
  // =====================================

  // Get all documents for a company
  app.get(
    "/api/companies/:companyId/documents",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user?.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      const documents = await storage.getDocuments(companyId);
      res.json(documents);
    })
  );

  // Upload a document. The file itself is sent as base64 (`fileData`) and is
  // validated (type allow-list, magic bytes, 10 MB cap) and stored durably; a
  // client-supplied `fileUrl`/`fileSize` is never read. Download goes through
  // GET /api/documents/:documentId/download (documents.routes.ts).
  app.post(
    "/api/companies/:companyId/documents",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const stored = await storeUploadedFile({
        companyId,
        category: "documents",
        fileName: req.body.fileName,
        mimeType: req.body.mimeType,
        fileData: req.body.fileData,
        uploadedBy: userId,
      });

      const documentData = {
        companyId,
        name: req.body.name || "Uploaded Document",
        nameAr: req.body.nameAr || null,
        category: req.body.category || "other",
        description: req.body.description || null,
        fileUrl: stored.key, // private storage key, not a URL
        fileName: stored.filename,
        fileSize: stored.sizeBytes,
        mimeType: stored.contentType,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        reminderDays: req.body.reminderDays || 30,
        reminderSent: false,
        tags: req.body.tags || null,
        isArchived: false,
        sharedWithPortal: req.body.sharedWithPortal === true,
        uploadedBy: userId,
      };

      let document;
      try {
        document = await storage.createDocument(documentData);
      } catch (err) {
        await removeStoredFile(stored.key);
        throw err;
      }
      res.status(201).json(document);
    })
  );

  // Delete document
  app.delete(
    "/api/documents/:documentId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { documentId } = req.params;
      const userId = (req as any).user?.id;
      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, document.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteDocument(documentId);
      await removeStoredFile(document.fileUrl);
      res.json({ success: true });
    })
  );

  // Share a document with the client portal, or take it back. Firm side only: portal accounts are confined to
  // /api/client-portal/* by authMiddleware, and the user type is checked as well. The portal listing and
  // download honour documents.shared_with_portal (client-portal.routes.ts, documents.routes.ts).
  app.patch(
    "/api/documents/:documentId/portal-sharing",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { documentId } = req.params;
      const user = (req as any).user;
      if (user?.userType === "client_portal") {
        return res.status(403).json({ message: "Access denied" });
      }
      if (typeof req.body?.sharedWithPortal !== "boolean") {
        return res.status(400).json({ message: "sharedWithPortal must be true or false", code: "INVALID_BODY" });
      }
      const document = UUID_RE.test(documentId) ? await storage.getDocument(documentId) : undefined;
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      if (!(await storage.hasCompanyAccess(user.id, document.companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const updated = await storage.updateDocument(documentId, { sharedWithPortal: req.body.sharedWithPortal });
      await recordAudit({
        userId: user.id,
        companyId: document.companyId,
        action: req.body.sharedWithPortal ? "document.share_portal" : "document.unshare_portal",
        entityType: "document",
        entityId: documentId,
        before: { sharedWithPortal: document.sharedWithPortal === true },
        after: { sharedWithPortal: req.body.sharedWithPortal },
        req,
      });
      res.json(updated);
    })
  );

  // =====================================
  // CLIENT PORTAL - TAX RETURN ARCHIVE
  // =====================================

  // Get tax return archive for a company
  app.get(
    "/api/companies/:companyId/tax-returns-archive",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user?.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      const returns = await storage.getTaxReturnArchive(companyId);
      res.json(returns);
    })
  );

  // Add tax return to archive
  app.post(
    "/api/companies/:companyId/tax-returns-archive",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const returnData = {
        companyId,
        returnType: req.body.returnType || "vat",
        periodLabel: req.body.periodLabel,
        periodStart: new Date(req.body.periodStart),
        periodEnd: new Date(req.body.periodEnd),
        filingDate: new Date(req.body.filingDate),
        ftaReferenceNumber: req.body.ftaReferenceNumber || null,
        taxAmount: parseFloat(req.body.taxAmount) || 0,
        paymentStatus: req.body.paymentStatus || "paid",
        fileUrl: null as string | null,
        fileName: null as string | null,
        notes: req.body.notes || null,
        filedBy: userId,
      };

      // Optional PDF/scan of the filed return. Stored privately; a client
      // supplied fileUrl is ignored. Downloaded via
      // GET /api/tax-returns-archive/:id/download.
      let storedKey: string | null = null;
      if (req.body.fileData) {
        const stored = await storeUploadedFile({
          companyId,
          category: "tax-returns",
          fileName: req.body.fileName,
          mimeType: req.body.mimeType,
          fileData: req.body.fileData,
          uploadedBy: userId,
        });
        storedKey = stored.key;
        returnData.fileUrl = stored.key;
        returnData.fileName = stored.filename;
      }

      try {
        const taxReturn = await storage.createTaxReturnArchive(returnData);
        res.status(201).json(taxReturn);
      } catch (err) {
        await removeStoredFile(storedKey);
        throw err;
      }
    })
  );

  // =====================================
  // CLIENT PORTAL - COMPLIANCE TASKS
  // =====================================

  // Get compliance tasks for a company
  app.get(
    "/api/companies/:companyId/compliance-tasks",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user?.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      const tasks = await storage.getComplianceTasks(companyId);
      res.json(tasks);
    })
  );

  // Create compliance task
  app.post(
    "/api/companies/:companyId/compliance-tasks",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const taskData = {
        companyId,
        title: req.body.title,
        titleAr: req.body.titleAr || null,
        description: req.body.description || null,
        category: req.body.category || "other",
        priority: req.body.priority || "medium",
        status: "pending",
        dueDate: new Date(req.body.dueDate),
        reminderDate: req.body.reminderDate ? new Date(req.body.reminderDate) : null,
        reminderSent: false,
        isRecurring: req.body.isRecurring || false,
        recurrencePattern: req.body.recurrencePattern || null,
        completedAt: null,
        completedBy: null,
        assignedTo: req.body.assignedTo || null,
        createdBy: userId,
        relatedDocumentId: req.body.relatedDocumentId || null,
        relatedVatReturnId: req.body.relatedVatReturnId || null,
        notes: req.body.notes || null,
      };

      const task = await storage.createComplianceTask(taskData);
      res.status(201).json(task);
    })
  );

  // Update compliance task
  app.patch(
    "/api/compliance-tasks/:taskId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { taskId } = req.params;
      const userId = (req as any).user.id;

      const existing = await storage.getComplianceTask(taskId);
      if (!existing) {
        return res.status(404).json({ message: "Compliance task not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const updates: any = {};
      if (req.body.status) {
        updates.status = req.body.status;
        if (req.body.status === "completed") {
          updates.completedAt = new Date();
          updates.completedBy = userId;
        }
      }
      if (req.body.priority) updates.priority = req.body.priority;
      if (req.body.dueDate) updates.dueDate = new Date(req.body.dueDate);
      if (req.body.notes !== undefined) updates.notes = req.body.notes;

      const task = await storage.updateComplianceTask(taskId, updates);
      res.json(task);
    })
  );

  // Delete compliance task
  app.delete(
    "/api/compliance-tasks/:taskId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { taskId } = req.params;
      const userId = (req as any).user?.id;
      const existing = await storage.getComplianceTask(taskId);
      if (!existing) {
        return res.status(404).json({ message: "Compliance task not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteComplianceTask(taskId);
      res.json({ success: true });
    })
  );

  // =====================================
  // CLIENT PORTAL - MESSAGES
  // =====================================

  // Get messages for a company
  app.get(
    "/api/companies/:companyId/messages",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user?.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      const messages = await storage.getMessages(companyId);
      res.json(messages);
    })
  );

  // Send message
  app.post(
    "/api/companies/:companyId/messages",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const messageData = {
        companyId,
        threadId: req.body.threadId || null,
        subject: req.body.subject || null,
        content: req.body.content,
        senderId: userId,
        recipientId: req.body.recipientId || null,
        isRead: false,
        readAt: null,
        attachmentUrl: req.body.attachmentUrl || null,
        attachmentName: req.body.attachmentName || null,
        messageType: req.body.messageType || "general",
        isArchived: false,
      };

      const message = await storage.createMessage(messageData);
      res.status(201).json(message);
    })
  );

  // =====================================
  // CLIENT PORTAL - NEWS FEED
  // =====================================

  // Get news items
  app.get(
    "/api/news",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const news = await storage.getNewsItems();
      res.json(news);
    })
  );
}
