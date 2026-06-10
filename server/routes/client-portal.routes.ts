import type { Express, Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { generateInvoicePDF } from '../services/pdf-invoice.service';
import { db } from '../db';
import { eq, and, or, desc } from 'drizzle-orm';
import {
  journalEntries,
  journalLines,
  accounts,
  companyUsers,
  companies,
} from '../../shared/schema';

/**
 * Middleware: restrict to client_portal (and client) userType.
 * Also resolves and attaches the user's first company to req.
 */
async function requirePortalUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user as any;
  if (!user) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  if (user.userType !== 'client_portal' && !user.isAdmin) {
    res.status(403).json({ message: 'Client portal access required' });
    return;
  }
  // Resolve user's company (portal users have exactly one)
  const userCompanies = await storage.getCompaniesByUserId(user.id);
  if (!userCompanies.length) {
    res.status(403).json({ message: 'No company associated with this account' });
    return;
  }
  (req as any).portalCompanyId = userCompanies[0].id;
  (req as any).portalCompany = userCompanies[0];
  next();
}

export function registerClientPortalRoutes(app: Express): void {
  const chain = [authMiddleware as any, requirePortalUser];

  // ─── Company Info ─────────────────────────────────────────────────────────
  app.get('/api/client-portal/company', ...chain, asyncHandler(async (req: Request, res: Response) => {
    res.json((req as any).portalCompany);
  }));

  // ─── Dashboard ────────────────────────────────────────────────────────────
  app.get('/api/client-portal/dashboard', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;

    const [allInvoices, vatReturns, documents] = await Promise.all([
      storage.getInvoicesByCompanyId(companyId),
      storage.getVatReturnsByCompanyId(companyId),
      storage.getDocuments(companyId),
    ]);

    const outstanding = allInvoices.filter(inv => inv.status === 'sent' || inv.status === 'partial');
    const outstandingTotal = outstanding.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

    const paid = allInvoices.filter(inv => inv.status === 'paid');
    const paidTotal = paid.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

    const latestVat = vatReturns.sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return db - da;
    })[0] ?? null;

    const recentInvoices = [...allInvoices]
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      .slice(0, 5);

    res.json({
      invoices: {
        total: allInvoices.length,
        outstanding: outstanding.length,
        outstandingTotal,
        paid: paid.length,
        paidTotal,
      },
      vatStatus: latestVat
        ? { status: latestVat.status, dueDate: latestVat.dueDate, periodEnd: latestVat.periodEnd }
        : null,
      documents: { total: documents.length },
      recentInvoices,
    });
  }));

  // ─── Invoices (read-only list) ────────────────────────────────────────────
  app.get('/api/client-portal/invoices', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;
    const invoices = await storage.getInvoicesByCompanyId(companyId);
    const sorted = [...invoices].sort((a, b) =>
      new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    );
    res.json(sorted);
  }));

  // ─── Invoice PDF download ─────────────────────────────────────────────────
  app.get('/api/client-portal/invoices/:id/pdf', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;
    const invoice = await storage.getInvoice(req.params.id, companyId);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
    const company = (req as any).portalCompany;
    const pdfBuffer = await generateInvoicePDF(invoice, lines, company);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${invoice.number}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }));

  // ─── Documents ────────────────────────────────────────────────────────────
  app.get('/api/client-portal/documents', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;
    const docs = await storage.getDocuments(companyId);
    res.json(docs);
  }));

  app.post('/api/client-portal/documents', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;
    const userId = (req.user as any).id;

    const ALLOWED_TYPES = [
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv',
    ];
    const mimeType: string = req.body.mimeType || 'application/pdf';
    if (!ALLOWED_TYPES.includes(mimeType.toLowerCase())) {
      return res.status(400).json({ message: 'Invalid file type' });
    }
    const fileSize = Number(req.body.fileSize) || 0;
    if (fileSize > 50 * 1024 * 1024) {
      return res.status(400).json({ message: 'File exceeds 50 MB limit' });
    }

    const doc = await storage.createDocument({
      companyId,
      name: req.body.name || 'Uploaded Document',
      nameAr: req.body.nameAr || null,
      category: req.body.category || 'other',
      description: req.body.description || null,
      fileUrl: req.body.fileUrl || '/uploads/placeholder.pdf',
      fileName: req.body.fileName || 'document.pdf',
      fileSize: fileSize || null,
      mimeType,
      expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
      reminderDays: req.body.reminderDays || 30,
      reminderSent: false,
      tags: req.body.tags || null,
      isArchived: false,
      uploadedBy: userId,
    });
    res.status(201).json(doc);
  }));

  // ─── Financial Statements (P&L + Balance Sheet summary) ──────────────────
  app.get('/api/client-portal/statements', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;

    const [allAccounts, allLines] = await Promise.all([
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
    ]);

    const accountMap = new Map(allAccounts.map(a => [a.id, a]));

    // Aggregate net balance per account (debit - credit for debit-normal; credit - debit for credit-normal)
    const balances: Record<string, number> = {};
    for (const line of allLines) {
      const acct = accountMap.get(line.accountId);
      if (!acct) continue;
      const debitNormal = acct.type === 'asset' || acct.type === 'expense';
      const net = debitNormal
        ? (Number(line.debit) || 0) - (Number(line.credit) || 0)
        : (Number(line.credit) || 0) - (Number(line.debit) || 0);
      balances[line.accountId] = (balances[line.accountId] || 0) + net;
    }

    const pnlItems: { name: string; type: string; balance: number }[] = [];
    const bsItems: { name: string; type: string; balance: number }[] = [];

    for (const acct of allAccounts) {
      const balance = balances[acct.id] || 0;
      if (balance === 0) continue;
      const item = { name: acct.nameEn, type: acct.type, balance };
      if (acct.type === 'income' || acct.type === 'expense') {
        pnlItems.push(item);
      } else {
        bsItems.push(item);
      }
    }

    const revenue = pnlItems
      .filter(i => i.type === 'income')
      .reduce((s, i) => s + i.balance, 0);
    const expenses = pnlItems
      .filter(i => i.type === 'expense')
      .reduce((s, i) => s + i.balance, 0);

    const assets = bsItems
      .filter(i => i.type === 'asset')
      .reduce((s, i) => s + i.balance, 0);
    const liabilities = bsItems
      .filter(i => i.type === 'liability')
      .reduce((s, i) => s + i.balance, 0);
    const equity = bsItems
      .filter(i => i.type === 'equity')
      .reduce((s, i) => s + i.balance, 0);

    res.json({
      profitAndLoss: {
        revenue,
        expenses,
        netProfit: revenue - expenses,
        items: pnlItems,
      },
      balanceSheet: {
        assets,
        liabilities,
        equity,
        items: bsItems,
      },
    });
  }));

  // ─── Messages ─────────────────────────────────────────────────────────────
  app.get('/api/client-portal/messages', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;
    const messages = await storage.getMessages(companyId);
    res.json(messages);
  }));

  app.post('/api/client-portal/messages', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;
    const userId = (req.user as any).id;
    if (!req.body.content?.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }
    const message = await storage.createMessage({
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
      messageType: 'general',
      isArchived: false,
    });
    res.status(201).json(message);
  }));
}
