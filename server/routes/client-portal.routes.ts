import type { Express,NextFunction,Request,Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { generateInvoicePDF } from '../services/pdf-invoice.service';
import { storage } from '../storage';

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
  // Resolve user's company. Portal users must map to exactly one company so
  // broad read-only portal views cannot drift across tenants.
  const userCompanies = await storage.getCompaniesByUserId(user.id);
  if (!userCompanies.length) {
    res.status(403).json({ message: 'No company associated with this account' });
    return;
  }
  if (user.userType === 'client_portal' && userCompanies.length !== 1) {
    res.status(403).json({ message: 'Client portal account must be linked to exactly one company' });
    return;
  }
  (req as any).portalCompanyId = userCompanies[0].id;
  (req as any).portalCompany = userCompanies[0];
  next();
}

function sanitizeCompany(company: any) {
  return {
    id: company.id,
    name: company.name,
    legalName: company.legalName ?? null,
    baseCurrency: company.baseCurrency,
    locale: company.locale,
    dateFormat: company.dateFormat,
    trnVatNumber: company.trnVatNumber ?? null,
    logoUrl: company.logoUrl ?? null,
  };
}

function sanitizeInvoice(inv: any) {
  return {
    id: inv.id,
    number: inv.number,
    customerName: inv.customerName,
    date: inv.date,
    dueDate: inv.dueDate ?? null,
    currency: inv.currency,
    subtotal: inv.subtotal,
    vatAmount: inv.vatAmount,
    total: inv.total,
    status: inv.status,
    createdAt: inv.createdAt,
  };
}

function sanitizeDocument(doc: any) {
  return {
    id: doc.id,
    name: doc.name,
    nameAr: doc.nameAr ?? null,
    category: doc.category,
    description: doc.description ?? null,
    fileUrl: doc.fileUrl,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    expiryDate: doc.expiryDate ?? null,
    tags: doc.tags ?? null,
    createdAt: doc.createdAt,
  };
}

function sanitizeMessage(message: any) {
  return {
    id: message.id,
    threadId: message.threadId ?? null,
    subject: message.subject ?? null,
    content: message.content,
    senderId: message.senderId,
    recipientId: message.recipientId ?? null,
    isRead: message.isRead,
    readAt: message.readAt ?? null,
    attachmentUrl: message.attachmentUrl ?? null,
    attachmentName: message.attachmentName ?? null,
    createdAt: message.createdAt,
  };
}

export function registerClientPortalRoutes(app: Express): void {
  const chain = [authMiddleware as any, requirePortalUser];

  // ─── Company Info ─────────────────────────────────────────────────────────
  app.get('/api/client-portal/company', ...chain, asyncHandler(async (req: Request, res: Response) => {
    res.json(sanitizeCompany((req as any).portalCompany));
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
      recentInvoices: recentInvoices.map(sanitizeInvoice),
    });
  }));

  // ─── Invoices (read-only list) ────────────────────────────────────────────
  app.get('/api/client-portal/invoices', ...chain, asyncHandler(async (req: Request, res: Response) => {
    const companyId: string = (req as any).portalCompanyId;
    const invoices = await storage.getInvoicesByCompanyId(companyId);
    const sorted = [...invoices].sort((a, b) =>
      new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    );
    res.json(sorted.map(sanitizeInvoice));
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
    res.json(docs.map(sanitizeDocument));
  }));

  app.post('/api/client-portal/documents', ...chain, asyncHandler(async (_req: Request, res: Response) => {
    res.status(405).json({ message: 'Client portal is read-only' });
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
    res.json(messages.map(sanitizeMessage));
  }));

  app.post('/api/client-portal/messages', ...chain, asyncHandler(async (_req: Request, res: Response) => {
    res.status(405).json({ message: 'Client portal is read-only' });
  }));
}
