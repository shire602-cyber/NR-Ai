import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { isoDateSchema, moneySchema, isUnsafePath } from "../../shared/validators";

// File-vault upload schema. The endpoint stores metadata for an out-of-band
// upload (the actual bytes never pass through this route), so we only
// validate the shape of the metadata. MIME type is constrained to a known
// allowlist; fileSize is bounded by MAX_DOC_SIZE; fileName must not contain
// path-traversal sequences.
const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
] as const;
const MAX_DOC_SIZE = 50 * 1024 * 1024; // 50MB

const documentBodySchema = z.object({
  name: z.string().trim().min(1).max(255).default('Uploaded Document'),
  nameAr: z.string().trim().max(255).nullish(),
  category: z.string().trim().max(64).default('other'),
  description: z.string().max(2000).nullish(),
  fileUrl: z.string().trim().min(1).max(2048).default('/uploads/placeholder.pdf'),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(v => !isUnsafePath(v), 'fileName contains illegal path characters')
    .default('document.pdf'),
  fileSize: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(MAX_DOC_SIZE, `File too large. Maximum size is ${MAX_DOC_SIZE} bytes.`)
    .optional(),
  mimeType: z
    .string()
    .transform(s => s.toLowerCase())
    .refine(v => (ALLOWED_DOC_TYPES as readonly string[]).includes(v), {
      message: 'Invalid file type. Allowed: PDF, images, Word, Excel, and text files.',
    })
    .default('application/pdf'),
  expiryDate: isoDateSchema().optional().nullable(),
  reminderDays: z.coerce.number().int().min(0).max(365).default(30),
  tags: z.string().max(2000).nullish(),
});

const taxReturnArchiveBodySchema = z
  .object({
    returnType: z.enum(['vat', 'corporate_tax', 'excise_tax']).default('vat'),
    periodLabel: z.string().trim().min(1).max(100),
    periodStart: isoDateSchema(),
    periodEnd: isoDateSchema(),
    filingDate: isoDateSchema({ noFuture: true }),
    ftaReferenceNumber: z.string().trim().max(100).nullish(),
    taxAmount: moneySchema.default(0),
    paymentStatus: z.enum(['paid', 'partial', 'unpaid']).default('paid'),
    fileUrl: z.string().trim().max(2048).nullish(),
    fileName: z
      .string()
      .trim()
      .max(255)
      .refine(v => !v || !isUnsafePath(v), 'fileName contains illegal path characters')
      .nullish(),
    notes: z.string().max(5000).nullish(),
  })
  .refine(d => d.periodStart <= d.periodEnd, {
    message: 'periodStart must be on or before periodEnd',
    path: ['periodEnd'],
  });

const complianceTaskBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
  titleAr: z.string().trim().max(255).nullish(),
  description: z.string().max(5000).nullish(),
  category: z.string().trim().max(64).default('other'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: isoDateSchema(),
  reminderDate: isoDateSchema().optional().nullable(),
  isRecurring: z.boolean().default(false),
  recurrencePattern: z.enum(['monthly', 'quarterly', 'yearly']).nullish(),
  assignedTo: z.string().uuid().nullish(),
  relatedDocumentId: z.string().uuid().nullish(),
  relatedVatReturnId: z.string().uuid().nullish(),
  notes: z.string().max(5000).nullish(),
});

const complianceTaskUpdateSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'overdue', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: isoDateSchema().optional(),
  notes: z.string().max(5000).nullish(),
});

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

    const parsed = documentBodySchema.parse(req.body);

    const documentData = {
      companyId,
      name: parsed.name,
      nameAr: parsed.nameAr ?? null,
      category: parsed.category,
      description: parsed.description ?? null,
      fileUrl: parsed.fileUrl,
      fileName: parsed.fileName,
      fileSize: parsed.fileSize ?? null,
      mimeType: parsed.mimeType,
      expiryDate: parsed.expiryDate ?? null,
      reminderDays: parsed.reminderDays,
      reminderSent: false,
      tags: parsed.tags ?? null,
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

    const parsed = taxReturnArchiveBodySchema.parse(req.body);

    const returnData = {
      companyId,
      returnType: parsed.returnType,
      periodLabel: parsed.periodLabel,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      filingDate: parsed.filingDate,
      ftaReferenceNumber: parsed.ftaReferenceNumber ?? null,
      taxAmount: parsed.taxAmount,
      paymentStatus: parsed.paymentStatus,
      fileUrl: parsed.fileUrl ?? null,
      fileName: parsed.fileName ?? null,
      notes: parsed.notes ?? null,
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

    const parsed = complianceTaskBodySchema.parse(req.body);

    const taskData = {
      companyId,
      title: parsed.title,
      titleAr: parsed.titleAr ?? null,
      description: parsed.description ?? null,
      category: parsed.category,
      priority: parsed.priority,
      status: 'pending',
      dueDate: parsed.dueDate,
      reminderDate: parsed.reminderDate ?? null,
      reminderSent: false,
      isRecurring: parsed.isRecurring,
      recurrencePattern: parsed.recurrencePattern ?? null,
      completedAt: null,
      completedBy: null,
      assignedTo: parsed.assignedTo ?? null,
      createdBy: userId,
      relatedDocumentId: parsed.relatedDocumentId ?? null,
      relatedVatReturnId: parsed.relatedVatReturnId ?? null,
      notes: parsed.notes ?? null,
    };

    const task = await storage.createComplianceTask(taskData);
    res.status(201).json(task);
  }));

  // Update compliance task
  app.patch("/api/compliance-tasks/:taskId", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const userId = (req as any).user.id;

    const parsed = complianceTaskUpdateSchema.parse(req.body);

    const updates: Record<string, unknown> = {};
    if (parsed.status) {
      updates.status = parsed.status;
      if (parsed.status === 'completed') {
        updates.completedAt = new Date();
        updates.completedBy = userId;
      }
    }
    if (parsed.priority) updates.priority = parsed.priority;
    if (parsed.dueDate) updates.dueDate = parsed.dueDate;
    if (parsed.notes !== undefined) updates.notes = parsed.notes ?? null;

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
