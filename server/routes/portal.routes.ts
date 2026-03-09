import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

export function registerPortalRoutes(app: Express) {
  // =====================================
  // CUSTOMER ACTIVITY LOGS (History)
  // =====================================

  // Get activity logs for user's company
  app.get("/api/companies/:companyId/activity-logs", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const logs = await storage.getActivityLogsByCompany(companyId, limit);
    res.json(logs);
  }));

  // =====================================
  // CLIENT PORTAL - DOCUMENT VAULT
  // =====================================

  // Get all documents for a company
  app.get("/api/companies/:companyId/documents", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const documents = await storage.getDocuments(companyId);
    res.json(documents);
  }));

  // Upload document (stub - would need file upload middleware in production)
  app.post("/api/companies/:companyId/documents", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    // For now, accept document metadata directly
    // In production, this would handle file uploads to storage
    const documentData = {
      companyId,
      name: req.body.name || 'Uploaded Document',
      nameAr: req.body.nameAr || null,
      category: req.body.category || 'other',
      description: req.body.description || null,
      fileUrl: req.body.fileUrl || '/uploads/placeholder.pdf',
      fileName: req.body.fileName || 'document.pdf',
      fileSize: req.body.fileSize || null,
      mimeType: req.body.mimeType || 'application/pdf',
      expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
      reminderDays: req.body.reminderDays || 30,
      reminderSent: false,
      tags: req.body.tags || null,
      isArchived: false,
      uploadedBy: userId,
    };

    const document = await storage.createDocument(documentData);
    res.status(201).json(document);
  }));

  // Delete document
  app.delete("/api/documents/:documentId", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { documentId } = req.params;
    await storage.deleteDocument(documentId);
    res.json({ success: true });
  }));

  // =====================================
  // CLIENT PORTAL - TAX RETURN ARCHIVE
  // =====================================

  // Get tax return archive for a company
  app.get("/api/companies/:companyId/tax-returns-archive", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const returns = await storage.getTaxReturnArchive(companyId);
    res.json(returns);
  }));

  // Add tax return to archive
  app.post("/api/companies/:companyId/tax-returns-archive", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const returnData = {
      companyId,
      returnType: req.body.returnType || 'vat',
      periodLabel: req.body.periodLabel,
      periodStart: new Date(req.body.periodStart),
      periodEnd: new Date(req.body.periodEnd),
      filingDate: new Date(req.body.filingDate),
      ftaReferenceNumber: req.body.ftaReferenceNumber || null,
      taxAmount: parseFloat(req.body.taxAmount) || 0,
      paymentStatus: req.body.paymentStatus || 'paid',
      fileUrl: req.body.fileUrl || null,
      fileName: req.body.fileName || null,
      notes: req.body.notes || null,
      filedBy: userId,
    };

    const taxReturn = await storage.createTaxReturnArchive(returnData);
    res.status(201).json(taxReturn);
  }));

  // =====================================
  // CLIENT PORTAL - COMPLIANCE TASKS
  // =====================================

  // Get compliance tasks for a company
  app.get("/api/companies/:companyId/compliance-tasks", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const tasks = await storage.getComplianceTasks(companyId);
    res.json(tasks);
  }));

  // Create compliance task
  app.post("/api/companies/:companyId/compliance-tasks", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const taskData = {
      companyId,
      title: req.body.title,
      titleAr: req.body.titleAr || null,
      description: req.body.description || null,
      category: req.body.category || 'other',
      priority: req.body.priority || 'medium',
      status: 'pending',
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
  }));

  // Update compliance task
  app.patch("/api/compliance-tasks/:taskId", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const userId = (req as any).user.id;

    const updates: any = {};
    if (req.body.status) {
      updates.status = req.body.status;
      if (req.body.status === 'completed') {
        updates.completedAt = new Date();
        updates.completedBy = userId;
      }
    }
    if (req.body.priority) updates.priority = req.body.priority;
    if (req.body.dueDate) updates.dueDate = new Date(req.body.dueDate);
    if (req.body.notes !== undefined) updates.notes = req.body.notes;

    const task = await storage.updateComplianceTask(taskId, updates);
    res.json(task);
  }));

  // Delete compliance task
  app.delete("/api/compliance-tasks/:taskId", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { taskId } = req.params;
    await storage.deleteComplianceTask(taskId);
    res.json({ success: true });
  }));

  // =====================================
  // CLIENT PORTAL - MESSAGES
  // =====================================

  // Get messages for a company
  app.get("/api/companies/:companyId/messages", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const messages = await storage.getMessages(companyId);
    res.json(messages);
  }));

  // Send message
  app.post("/api/companies/:companyId/messages", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

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
      messageType: req.body.messageType || 'general',
      isArchived: false,
    };

    const message = await storage.createMessage(messageData);
    res.status(201).json(message);
  }));

  // =====================================
  // CLIENT PORTAL - NEWS FEED
  // =====================================

  // Get news items
  app.get("/api/news", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const news = await storage.getNewsItems();
    res.json(news);
  }));
}
